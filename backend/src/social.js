import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db, getSetting, setSetting, nowStr } from './db.js';
import { mediaPut, mediaDelete, MEDIA_MAX } from './media.js';
import { parseDataUrl, saveUpload, deleteUpload } from './uploads.js';

/* ═══ AI video → Instagram ═══
   1) Admin panel brauzerda 9:16 boshlang'ich kadr (mahsulot rasmi) va shaffof yozuv qatlami (nomi, narxi, telefon) chizadi.
   2) Kadr fal.ai navbatiga yuboriladi (Kling image-to-video) — 1–3 daqiqada klip tayyor bo'ladi.
   3) ffmpeg klipni 1080×1920 ga keltiradi, yozuv qatlamini ustiga qo'yadi, jim AAC audio va faststart qo'shadi
      (Instagram Reels talablari: H.264, yuv420p, 23–60 fps, AAC, moov boshida).
   4) Tayyor video bazaga (media) yoziladi va /assets/ai/... ommaviy manzildan beriladi —
      Instagram videoni shu manzildan o'zi yuklab oladi (graph.instagram.com, "Instagram Login" tokeni).
   Barcha bosqichlar ai_videos jadvalida — server qayta ishga tushsa, fon ishchisi davom ettiradi. */

export const DEFAULT_MODEL = 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';
/* $ / soniya — admin oldindan narxni ko'rsin (fal.ai narxlari o'zgarishi mumkin) */
const PRICE_PER_SEC = { [DEFAULT_MODEL]: 0.07 };
const MAX_ACTIVE = 2;                      // bir vaqtda nechta video yaratiladi (tasodifiy xarajatdan himoya)
const FAL_TIMEOUT = 20 * 60 * 1000;        // 20 daqiqada tayyor bo'lmasa — xato
const IG_TIMEOUT = 20 * 60 * 1000;
const IG_VER = process.env.IG_API_VERSION || 'v24.0';
const IG = `https://graph.instagram.com/${IG_VER}`;
const FB = `https://graph.facebook.com/${IG_VER}`;        // yangi Meta ilovalari: Facebook (Unified login) tokeni shu yerdan ishlaydi
const igBase = (ig) => (ig && ig.api === 'fb' ? FB : IG);

const short = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const mask = (k) => (k ? k.slice(0, 4) + '…' + k.slice(-4) : '');

/* ─── Kalitlar: muhit o'zgaruvchisi (Heroku config) ustun, aks holda admin paneldan kiritilgani ─── */
export async function falConf() {
  const s = (await getSetting('ai_keys', {})) || {};
  return { key: process.env.FAL_KEY || s.falKey || '', fromEnv: !!process.env.FAL_KEY, model: process.env.FAL_MODEL || s.model || DEFAULT_MODEL };
}
async function igConf() {
  const s = (await getSetting('instagram', {})) || {};
  return { ...s, token: s.token || process.env.IG_ACCESS_TOKEN || '' };
}

export async function socialStatus() {
  const f = await falConf(), ig = await igConf();
  return {
    fal: { ok: !!f.key, fromEnv: f.fromEnv, key: mask(f.key), model: f.model, perSec: PRICE_PER_SEC[f.model] ?? null },
    ig: { connected: !!(ig.token && ig.userId), username: ig.username || '', accountType: ig.accountType || '', expiresAt: ig.expiresAt || '', error: ig.error || '' },
    ffmpeg: !!(await ffmpegPath()),
    publicUrl: process.env.PUBLIC_URL || '',
  };
}

export async function saveFalKey({ falKey, model }) {
  const s = (await getSetting('ai_keys', {})) || {};
  if (falKey !== undefined) {
    falKey = String(falKey || '').trim();
    if (falKey && !/^[A-Za-z0-9_:\-.]{20,200}$/.test(falKey)) throw new Error('fal.ai kaliti noto‘g‘ri ko‘rinishda');
    s.falKey = falKey;
  }
  if (model !== undefined) {
    model = String(model || '').trim();
    if (model && !/^[a-z0-9\-]+\/[a-z0-9.\-/]+$/i.test(model)) throw new Error('Model nomi noto‘g‘ri (masalan: ' + DEFAULT_MODEL + ')');
    s.model = model;
  }
  await setSetting('ai_keys', s);
}

/* ─── fal.ai navbat API ─── */
function falErr(j, status) {
  const d = j && (j.detail ?? j.error ?? j.message);
  const msg = Array.isArray(d) ? d.map(x => x.msg || JSON.stringify(x)).join('; ') : typeof d === 'string' ? d : d ? JSON.stringify(d) : '';
  if (status === 401) return 'fal.ai kaliti noto‘g‘ri yoki o‘chirilgan';
  if (status === 403 || /balance|credit|locked|billing/i.test(msg)) return 'fal.ai hisobida mablag‘ yetarli emas — fal.ai/dashboard/billing da balansni to‘ldiring';
  return 'fal.ai: ' + short(msg || 'HTTP ' + status, 300);
}
export async function falFetch(url, key, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json', ...(opt.headers || {}) }, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(falErr(j, r.status)); e.status = r.status; throw e; }
  return j;
}

/* ─── ffmpeg: FFMPEG_PATH → ffmpeg-static (Heroku) → PATH dagi ffmpeg ─── */
let _ff, _ffMissAt = 0;
export function runProc(bin, args, { timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    let err = '';
    const p = spawn(bin, args, { windowsHide: true });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg vaqtidan oshdi')); }, timeout);
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve() : reject(new Error('ffmpeg xatosi: ' + short(err.split('\n').slice(-4).join(' '), 300))); });
  });
}
export async function ffmpegPath() {
  if (_ff) return _ff;
  if (Date.now() - _ffMissAt < 5 * 60000) return null;   // topilmagan bo'lsa — 5 daqiqadan keyin qayta qidiriladi
  const cands = [process.env.FFMPEG_PATH];
  try { cands.push((await import('ffmpeg-static')).default); } catch (e) { }
  cands.push('ffmpeg');
  for (const c of cands.filter(Boolean)) {
    try { await runProc(c, ['-hide_banner', '-version'], { timeout: 45000 }); _ff = c; return c; }
    catch (e) { console.warn('[ai] ffmpeg tekshiruvi:', c, e.message); }
  }
  _ffMissAt = Date.now();
  console.warn('[ai] ffmpeg topilmadi — videolar ishlovsiz saqlanadi');
  return null;
}

/* Klip → 1080×1920, yozuv qatlami, jim audio, Instagram uchun mos kodlash */
export async function finishVideo(clip, overlayBuf) {
  const ff = await ffmpegPath();
  if (!ff) return clip;                   // ffmpeg yo'q — klip o'zgarishsiz (Instagram odatda baribir qabul qiladi)
  const dir = fs.mkdtempSync(path.join(process.env.AI_TMP || os.tmpdir(), 'koai-'));
  try {
    const inp = path.join(dir, 'in.mp4'), out = path.join(dir, 'out.mp4'), ov = path.join(dir, 'ov.png');
    fs.writeFileSync(inp, clip);
    const args = ['-hide_banner', '-y', '-i', inp];
    let fc = '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x141311,setsar=1,fps=30';
    if (overlayBuf) {
      fs.writeFileSync(ov, overlayBuf);
      args.push('-i', ov);
      fc += '[b];[1:v]scale=1080:1920[o];[b][o]overlay=0:0:format=auto[v]';
    } else fc += '[v]';
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-filter_complex', fc, '-map', '[v]', '-map', (overlayBuf ? 2 : 1) + ':a', '-shortest',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', '60',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-movflags', '+faststart', out);
    await runProc(ff, args);
    return fs.readFileSync(out);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/* ─── Yangi video ─── */
export function costOf(model, duration) {
  const p = PRICE_PER_SEC[model];
  return p == null ? null : Math.round(p * duration * 100) / 100;
}

export async function createAiVideo({ frame, overlay, prompt, duration, sku, title, caption }, admin) {
  const f = await falConf();
  if (!f.key) throw new Error('fal.ai kaliti kiritilmagan — «AI video» bo‘limidagi sozlamaga kiriting');
  const active = await db.get("SELECT COUNT(*) AS n FROM ai_videos WHERE status IN ('generating', 'processing')");
  if (+active.n >= MAX_ACTIVE) throw new Error(`Bir vaqtda ${MAX_ACTIVE} tadan ortiq video yaratilmaydi — avvalgilari tayyor bo‘lishini kuting`);
  prompt = short(prompt, 1500);
  if (prompt.length < 10) throw new Error('Video tavsifi (prompt) juda qisqa');
  duration = String(duration) === '10' ? 10 : 5;
  const fr = parseDataUrl(frame, { allow: ['jpeg', 'jpg', 'png'], maxBytes: 4 * 1024 * 1024 });
  const ov = overlay ? parseDataUrl(overlay, { allow: ['png'], maxBytes: 3 * 1024 * 1024 }) : null;

  // avval fal.ai ga yuboriladi — kalit/balans xatosi bo'lsa, bazada ortiqcha narsa qolmaydi
  const job = await falFetch((process.env.FAL_QUEUE_URL || 'https://queue.fal.run/') + f.model, f.key, {
    method: 'POST',
    body: JSON.stringify({
      prompt, duration: String(duration),
      image_url: `data:image/${fr.ext === 'png' ? 'png' : 'jpeg'};base64,${fr.buf.toString('base64')}`,
      negative_prompt: 'blur, distort, low quality, deformed product, warped text, extra logos, watermark',
    }),
  });
  if (!job.status_url || !job.response_url) throw new Error('fal.ai javobi kutilmagan ko‘rinishda');

  const framePath = await saveUpload('ai', fr.buf, fr.ext, 'frame');
  const ovPath = ov ? await saveUpload('ai', ov.buf, 'png', 'overlay') : '';
  const r = await db.get(
    `INSERT INTO ai_videos (sku, title, prompt, model, duration, status, fal_status, fal_response, frame, overlay, caption, admin)
     VALUES (?, ?, ?, ?, ?, 'generating', ?, ?, ?, ?, ?, ?) RETURNING id`,
    short(sku, 60), short(title, 200), prompt, f.model, duration, job.status_url, job.response_url, framePath, ovPath, String(caption || '').slice(0, 2200), short(admin, 60));
  kick();
  return getAiVideo(r.id);
}

const pub = (row) => row && ({
  ...row, cost: costOf(row.model, row.duration), fal_status: undefined, fal_response: undefined, ig_container: undefined,
});
export async function getAiVideo(id) { return pub(await db.get('SELECT * FROM ai_videos WHERE id = ?', +id)); }
export async function listAiVideos() { return (await db.all('SELECT * FROM ai_videos ORDER BY id DESC LIMIT 60')).map(pub); }

export async function updateAiVideo(id, { caption }) {
  if (caption !== undefined) await db.run('UPDATE ai_videos SET caption = ?, updated_at = ? WHERE id = ?', String(caption || '').slice(0, 2200), nowStr(), +id);
  return getAiVideo(id);
}

export async function deleteAiVideo(id) {
  const row = await db.get('SELECT * FROM ai_videos WHERE id = ?', +id);
  if (!row) return;
  if (row.ig_status === 'uploading') throw new Error('Video hozir Instagram’ga joylanmoqda — tugashini kuting');
  for (const p of [row.frame, row.overlay]) if (p) await deleteUpload(p);
  if (row.video) await mediaDelete(row.video);
  await db.run('DELETE FROM ai_videos WHERE id = ?', +id);
}

/* ─── Instagram ─── */
async function igCall(method, url, params, token) {
  const q = new URLSearchParams({ ...params, access_token: token });
  const r = method === 'GET'
    ? await fetch(url + '?' + q, { signal: AbortSignal.timeout(60000) })
    : await fetch(url, { method, body: q, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    const err = new Error(e.code === 190 ? 'Instagram tokeni muddati o‘tgan yoki bekor qilingan — yangi token kiriting'
      : 'Instagram: ' + short(e.error_user_msg || e.message || 'HTTP ' + r.status, 300));
    err.code = e.code; err.raw = short(e.message, 300);
    throw err;
  }
  return j;
}

export async function connectInstagram(token) {
  token = String(token || '').trim();
  if (token.length < 30) throw new Error('Instagram tokeni juda qisqa');
  if (!/^IG/.test(token)) {              // Facebook / Business (system user) tokeni: akkaunt sahifa orqali topiladi
    const pages = await igCall('GET', FB + '/me/accounts', { fields: 'name,instagram_business_account{id,username}', limit: '50' }, token);
    const pg = (pages.data || []).find(p => p.instagram_business_account);
    if (!pg) throw new Error('Token orqali Instagram Business akkaunt topilmadi — akkaunt Facebook sahifaga ulangan va token ruxsatlari (pages_show_list, instagram_basic, instagram_content_publish) berilganini tekshiring');
    const ia = pg.instagram_business_account;
    await setSetting('instagram', { token, api: 'fb', userId: String(ia.id), username: ia.username || '', accountType: 'BUSINESS', pageName: pg.name || '', tokenAt: nowStr(), refreshedAt: nowStr(), expiresAt: '' });
    return socialStatus();
  }
  const me =await igCall('GET', IG + '/me', { fields: 'user_id,username,account_type' }, token);
  if (me.account_type && !/BUSINESS|CREATOR|MEDIA_CREATOR/i.test(me.account_type)) {
    throw new Error('Bu shaxsiy akkaunt — Instagram ilovasida Professional (Biznes yoki Kreator) akkauntga o‘tkazing');
  }
  const s = { token, userId: String(me.user_id || me.id), username: me.username || '', accountType: me.account_type || '', tokenAt: nowStr(), refreshedAt: nowStr(), expiresAt: '' };
  await setSetting('instagram', s);
  await refreshToken(true).catch(() => { });   // 24 soatdan yangi token yangilanmaydi — keyin fon ishchisi qiladi
  return socialStatus();
}
export async function disconnectInstagram() { await setSetting('instagram', {}); }

/* Uzoq muddatli token 60 kun yashaydi — har 3 kunda yangilanadi (yangilangan token yana 60 kun) */
async function refreshToken(force = false) {
  const s = (await getSetting('instagram', {})) || {};
  if (!s.token || s.api === 'fb') return;     // Facebook (system user) tokeni muddatsiz, yangilanmaydi
  const last =Date.parse(String(s.refreshedAt || '').replace(' ', 'T') + 'Z') || 0;
  if (!force && Date.now() - last < 3 * 86400000) return;
  try {
    const j = await igCall('GET', 'https://graph.instagram.com/refresh_access_token', { grant_type: 'ig_refresh_token' }, s.token);
    if (j.access_token) {
      s.token = j.access_token;
      s.expiresAt = j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString().slice(0, 10) : s.expiresAt;
      s.error = '';
    }
  } catch (e) {
    if (e.code === 190) s.error = e.message;
  }
  s.refreshedAt = nowStr();
  await setSetting('instagram', s);
}

export async function publishAiVideo(id, { type, caption, aiLabel = true }, baseUrl) {
  const row = await db.get('SELECT * FROM ai_videos WHERE id = ?', +id);
  if (!row) throw new Error('Video topilmadi');
  if (row.status !== 'ready' || !row.video) throw new Error('Video hali tayyor emas');
  if (row.ig_status === 'uploading') throw new Error('Video allaqachon joylanmoqda');
  const ig = await igConf();
  if (!ig.token || !ig.userId) throw new Error('Instagram ulanmagan — avval tokenni kiriting');
  const base = String(process.env.PUBLIC_URL || baseUrl || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1|\[::1\]/.test(base)) {
    throw new Error('Instagram videoni faqat internetdagi (https) serverdan oladi — buni Heroku’dagi admin paneldan bajaring');
  }
  type = type === 'STORIES' ? 'STORIES' : 'REELS';
  if (caption !== undefined) row.caption = String(caption || '').slice(0, 2200);
  const params = { media_type: type, video_url: base + row.video };
  if (type === 'REELS') {
    params.caption = row.caption || '';
    params.share_to_feed = 'true';
    if (aiLabel) params.is_ai_generated = 'true';
  }
  let c;
  try { c = await igCall('POST', `${igBase(ig)}/${ig.userId}/media`, params, ig.token); }
  catch (e) {
    // API versiyasi is_ai_generated ni tanimasa — belgisiz qayta urinish
    if (!params.is_ai_generated || !/is_ai_generated/i.test(e.raw || e.message)) throw e;
    delete params.is_ai_generated;
    c = await igCall('POST', `${igBase(ig)}/${ig.userId}/media`, params, ig.token);
  }
  await db.run(`UPDATE ai_videos SET ig_type = ?, ig_status = 'uploading', ig_container = ?, ig_media_id = '', ig_permalink = '', caption = ?, error = '', ig_at = ?, updated_at = ? WHERE id = ?`,
    type, String(c.id), row.caption || '', nowStr(), nowStr(), +id);
  kick();
  return getAiVideo(id);
}

/* ─── Fon ishchisi ─── */
const busy = new Set();
const lastIgCheck = new Map();
let _timer = null, _running = false;
const age = (ts) => Date.now() - (Date.parse(String(ts || '').replace(' ', 'T') + 'Z') || Date.now());
const fail = (id, msg, col = 'status') => db.run(`UPDATE ai_videos SET ${col} = 'failed', error = ?, updated_at = ? WHERE id = ?`, short(msg, 500), nowStr(), id);

async function stepFal(row) {
  const f = await falConf();
  if (!f.key) return fail(row.id, 'fal.ai kaliti o‘chirildi');
  if (row.status === 'generating') {
    let st;
    try { st = await falFetch(row.fal_status, f.key); }
    catch (e) { if (e.status && e.status < 500 && e.status !== 429) return fail(row.id, e.message); return; }
    if (st.status !== 'COMPLETED') {
      if (age(row.created_at) > FAL_TIMEOUT) return fail(row.id, 'fal.ai 20 daqiqada video tayyorlamadi');
      return;
    }
    if (st.error) return fail(row.id, 'fal.ai: ' + short(st.error, 300));
    await db.run("UPDATE ai_videos SET status = 'processing', updated_at = ? WHERE id = ?", nowStr(), row.id);
  }
  // natija: klipni yuklab olish → ffmpeg → bazaga
  let res;
  try { res = await falFetch(row.fal_response, f.key); }
  catch (e) { if (e.status && e.status < 500) return fail(row.id, e.message); return; }
  const url = res?.video?.url || res?.videos?.[0]?.url;
  if (!url) return fail(row.id, 'fal.ai natijasida video yo‘q');
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) {                                          // 5xx/429 — keyingi aylanishda qayta urinadi
    if (r.status >= 400 && r.status < 500 && r.status !== 429) return fail(row.id, `AI videoni yuklab bo‘lmadi (HTTP ${r.status})`);
    return;
  }
  const clip = Buffer.from(await r.arrayBuffer());
  if (clip.length > MEDIA_MAX) return fail(row.id, 'AI video juda katta');
  let overlay = null;
  if (row.overlay) {
    const o = await db.get('SELECT data FROM uploads WHERE path = ?', row.overlay);
    if (o) overlay = Buffer.from(o.data, 'base64');
  }
  let out;
  try { out = await finishVideo(clip, overlay); }
  catch (e) { console.error('[ai] ffmpeg:', e.message); out = clip; }   // ishlov bo'lmasa ham asl klip saqlanadi
  const p = await mediaPut('ai', out, 'mp4');
  const n = await db.run("UPDATE ai_videos SET status = 'ready', video = ?, error = '', updated_at = ? WHERE id = ? AND status = 'processing'", p, nowStr(), row.id);
  if (!n.changes) await mediaDelete(p);                 // shu orada o'chirilgan bo'lsa
}

async function stepIg(row) {
  if (Date.now() - (lastIgCheck.get(row.id) || 0) < 30000) return;   // Meta: holatni tez-tez so'ramang
  lastIgCheck.set(row.id, Date.now());
  const ig = await igConf();
  if (!ig.token) return fail(row.id, 'Instagram uzildi', 'ig_status');
  let st;
  try { st = await igCall('GET', `${igBase(ig)}/${row.ig_container}`, { fields: 'status_code,status' }, ig.token); }
  catch (e) { if (e.code === 190 || e.code === 100) return fail(row.id, e.message, 'ig_status'); return; }
  if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') {
    return fail(row.id, 'Instagram videoni qabul qilmadi: ' + short(st.status || st.status_code, 300), 'ig_status');
  }
  if (st.status_code !== 'FINISHED' && st.status_code !== 'PUBLISHED') {
    if (age(row.ig_at) > IG_TIMEOUT) return fail(row.id, 'Instagram 20 daqiqada videoni qayta ishlamadi', 'ig_status');
    return;
  }
  let mediaId = '';
  if (st.status_code === 'FINISHED') {
    try { mediaId = String((await igCall('POST', `${igBase(ig)}/${ig.userId}/media_publish`, { creation_id: row.ig_container }, ig.token)).id || ''); }
    catch (e) { return fail(row.id, e.message, 'ig_status'); }
  }
  let link = '';
  if (mediaId) { try { link = (await igCall('GET', `${igBase(ig)}/${mediaId}`, { fields: 'permalink' }, ig.token)).permalink || ''; } catch (e) { } }
  await db.run("UPDATE ai_videos SET ig_status = 'published', ig_media_id = ?, ig_permalink = ?, error = '', updated_at = ? WHERE id = ?", mediaId, link, nowStr(), row.id);
  lastIgCheck.delete(row.id);
}

async function tick() {
  if (_running) return;
  _running = true;
  try {
    const rows = await db.all("SELECT * FROM ai_videos WHERE status IN ('generating', 'processing') OR ig_status = 'uploading'");
    for (const row of rows) {
      if (busy.has(row.id)) continue;
      busy.add(row.id);
      const step = row.ig_status === 'uploading' ? stepIg(row) : stepFal(row);
      step.catch(e => console.error('[ai] #' + row.id, e.message)).finally(() => busy.delete(row.id));
    }
    await refreshToken().catch(() => { });
  } catch (e) { console.error('[ai] tick:', e.message); }
  finally { _running = false; }
}
function kick() { setTimeout(tick, 1500); }

export function startSocialWorker() {
  if (_timer) return;
  _timer = setInterval(tick, 10000);
  _timer.unref?.();
  kick();
}
