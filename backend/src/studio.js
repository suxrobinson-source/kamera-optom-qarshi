import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting, nowStr } from './db.js';
import { mediaPut, mediaGet, mediaDelete } from './media.js';
import { parseDataUrl, saveUpload, deleteUpload } from './uploads.js';
import { falConf, falFetch, ffmpegPath } from './social.js';

/* ═══ Klon studiya ═══
   Mavzu → ssenariy variantlari → tasdiq → sahnalar → yakuniy video → «AI video · Instagram» ro'yxati.
   • Ssenariylarni egasining kompyuteridagi ishchi (backend/scripts/script-worker.mjs) Claude obunasi orqali
     (`claude -p`, API kalitisiz) yozadi: /api/studio-worker/next → claude → /api/studio-worker/:id.
   • Ovoz: ElevenLabs (egasining klonlangan ovozi, Eleven v4/v3 — o'zbek tili qo'llanadi).
   • Avatar sahna: egasining surati + ovoz → HeyGen Avatar IV (fal.ai). Mahsulot sahnasi: mahsulot rasmi → Kling (fal.ai).
   • Har sahna alohida: matni o'zgarsa — faqat shu sahna qayta yasaladi, keyin hammasi ffmpeg bilan qayta yig'iladi.
   Holat studio_projects.scenes (JSON) da; fon ishchisi server qayta ishga tushsa ham davom etadi. */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', 'assets');
const EL = process.env.ELEVENLABS_BASE || 'https://api.elevenlabs.io/v1';
const EL_MODELS = ['eleven_v4', 'eleven_v3'];
const AVATAR_MODEL = 'fal-ai/heygen/avatar4/image-to-video';
const BROLL_MODEL = 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';
const MAX_RENDER = 2;                       // bir loyihada bir vaqtda nechta sahna fal.ai da yasaladi
const RENDER_TIMEOUT = 25 * 60 * 1000;
const short = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const mask = (k) => (k ? k.slice(0, 4) + '…' + k.slice(-4) : '');
const rid = () => crypto.randomBytes(4).toString('hex');
const queueUrl = () => process.env.FAL_QUEUE_URL || 'https://queue.fal.run/';

/* ─── Sozlamalar ─── */
async function elConf() {
  const s = (await getSetting('eleven', {})) || {};
  return { ...s, key: process.env.ELEVENLABS_API_KEY || s.apiKey || '', fromEnv: !!process.env.ELEVENLABS_API_KEY, model: s.model || EL_MODELS[0] };
}
/* Render rejimi: 'free' (standart) — ffmpeg bilan o'z kompyuter/serverda, pul sarflanmaydi; 'fal' — fal.ai da AI avatar/klip (pullik) */
async function renderMode() { return ((await getSetting('studio_mode', {})) || {}).mode === 'fal' ? 'fal' : 'free'; }
export async function setMode({ mode }) {
  if (!['free', 'fal'].includes(mode)) throw new Error('Rejim noto‘g‘ri');
  await setSetting('studio_mode', { mode });
  return studioStatus();
}
async function faceConf() { return ((await getSetting('studio_face', {})) || {}).photo || ''; }
async function workerConf() {
  const s = (await getSetting('studio_worker', {})) || {};
  if (!s.key && !process.env.STUDIO_WORKER_KEY) { s.key = crypto.randomBytes(20).toString('hex'); await setSetting('studio_worker', s); }
  return { ...s, key: process.env.STUDIO_WORKER_KEY || s.key };
}

export async function studioStatus() {
  const el = await elConf(), f = await falConf(), w = await workerConf();
  const seen = Date.parse(String(w.seenAt || '').replace(' ', 'T') + 'Z') || 0;
  return {
    eleven: { ok: !!el.key, fromEnv: el.fromEnv, key: mask(el.key), voiceId: el.voiceId || '', voiceName: el.voiceName || '', model: el.model, tier: el.tier || '', canClone: el.canClone ?? null, chars: el.chars || null },
    face: await faceConf(),
    mode: await renderMode(),
    fal: { ok: !!f.key },
    ffmpeg: !!(await ffmpegPath()),
    worker: { key: w.key, seenAt: w.seenAt || '', online: Date.now() - seen < 90000 },
  };
}

/* ─── ElevenLabs ─── */
function elErr(j, status) {
  const d = j && j.detail;
  const code = (d && (d.status || d.code)) || '';
  const msg = typeof d === 'string' ? d : (d && d.message) || (j && j.message) || '';
  if (status === 401 || /invalid_api_key/.test(code)) return 'ElevenLabs kaliti noto‘g‘ri yoki ruxsati yetarli emas';
  if (/instant_voice_cloning|can_not_use_instant/.test(code + msg)) return 'Ovoz klonlash ElevenLabs’ning pullik tarifida (Starter va undan yuqori) ishlaydi — tarifni oshiring';
  if (/quota_exceeded|character_limit/.test(code + msg)) return 'ElevenLabs’dagi oylik belgilar limiti tugadi';
  return 'ElevenLabs: ' + short(msg || code || 'HTTP ' + status, 300);
}
async function elFetch(p, key, { method = 'GET', json, form, raw } = {}) {
  const headers = { 'xi-api-key': key };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const r = await fetch(EL + p, { method, headers, body, signal: AbortSignal.timeout(120000) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(elErr(j, r.status)); e.status = r.status; e.raw = JSON.stringify(j).slice(0, 400); throw e; }
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

export async function saveEleven({ apiKey, model }) {
  const s = (await getSetting('eleven', {})) || {};
  if (model !== undefined) {
    if (!/^eleven_[a-z0-9_]+$/.test(String(model))) throw new Error('Model nomi noto‘g‘ri (masalan: eleven_v4)');
    s.model = model;
  }
  if (apiKey !== undefined) {
    apiKey = String(apiKey || '').trim();
    if (apiKey) {
      const sub = await elFetch('/user/subscription', apiKey);
      s.tier = sub.tier || ''; s.canClone = !!sub.can_use_instant_voice_cloning;
      s.chars = { used: sub.character_count, limit: sub.character_limit };
    } else { s.tier = ''; s.canClone = null; s.chars = null; }
    s.apiKey = apiKey;
  }
  await setSetting('eleven', s);
  return studioStatus();
}

const AUDIO_IN = { mpeg: 'mp3', mp3: 'mp3', wav: 'wav', 'x-wav': 'wav', wave: 'wav', webm: 'webm', ogg: 'ogg', mp4: 'm4a', 'x-m4a': 'm4a', m4a: 'm4a', aac: 'aac' };
function parseAudio(dataUrl) {
  const m = String(dataUrl || '').match(/^data:audio\/([a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/i);
  const ext = m && AUDIO_IN[m[1].toLowerCase()];
  if (!ext) throw new Error('Ovoz fayli MP3, WAV, M4A yoki WEBM bo‘lishi kerak');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 20000) throw new Error('Ovoz yozuvi juda qisqa — kamida 30 soniya kerak');
  if (buf.length > 7 * 1024 * 1024) throw new Error('Ovoz fayli 7 MB dan oshmasin — 1–2 daqiqalik MP3 yetarli');
  return { buf, ext };
}

export async function cloneVoice({ audio, name }) {
  const el = await elConf();
  if (!el.key) throw new Error('Avval ElevenLabs kalitini kiriting');
  let { buf, ext } = parseAudio(audio);
  if (!['mp3', 'wav'].includes(ext)) buf = await ffConvert(buf, ext, 'mp3', ['-ac', '1', '-ar', '44100', '-b:a', '160k']);
  const fd = new FormData();
  fd.append('name', short(name, 60) || 'Kamera Optom — egasi');
  fd.append('description', 'KAMERA OPTOM QARSHI egasining ovozi (o‘zbekcha)');
  fd.append('remove_background_noise', 'false');
  fd.append('labels', JSON.stringify({ language: 'uz' }));
  fd.append('files', new Blob([buf], { type: ext === 'wav' ? 'audio/wav' : 'audio/mpeg' }), 'ovoz.' + (ext === 'wav' ? 'wav' : 'mp3'));
  const r = await elFetch('/voices/add', el.key, { method: 'POST', form: fd });
  const s = (await getSetting('eleven', {})) || {};
  const old = s.voiceOwned ? s.voiceId : '';   // faqat studiya o'zi yaratgan ovoz o'chiriladi — saytdan tanlangan ovozga tegilmaydi
  s.voiceId = r.voice_id; s.voiceName = short(name, 60) || 'Kamera Optom — egasi'; s.voiceOwned = true;
  await setSetting('eleven', s);
  if (old && old !== r.voice_id) elFetch('/voices/' + encodeURIComponent(old), el.key, { method: 'DELETE' }).catch(() => { });
  return studioStatus();
}

/* ElevenLabs hisobidagi o'zingizning (tayyor bo'lmagan) ovozlaringiz */
export async function listVoices() {
  const el = await elConf();
  if (!el.key) throw new Error('Avval ElevenLabs kalitini kiriting');
  const r = await elFetch('/voices', el.key);
  return (r.voices || []).filter(v => v.category && v.category !== 'premade')
    .map(v => ({ id: v.voice_id, name: short(v.name, 60), category: v.category, lang: (v.labels && v.labels.language) || '' }));
}
export async function selectVoice({ voiceId }) {
  const el = await elConf();
  const v = (await listVoices()).find(x => x.id === String(voiceId || ''));
  if (!v) throw new Error('Bunday ovoz hisobingizda topilmadi');
  const s = (await getSetting('eleven', {})) || {};
  s.voiceId = v.id; s.voiceName = v.name; s.voiceOwned = false;
  await setSetting('eleven', s);
  return studioStatus();
}

/* ElevenLabs tariflari bir vaqtda cheklangan so'rovga ruxsat beradi (Starter: 3) — navbat + limit xatosida qayta urinish */
let _ttsActive = 0;
const _ttsWait = [];
async function ttsSlot() {
  if (_ttsActive < 2) { _ttsActive++; return; }
  await new Promise(r => _ttsWait.push(r));
}
function ttsFree() { const n = _ttsWait.shift(); if (n) n(); else _ttsActive--; }
async function tts(text, el) {
  if (!el.key) throw new Error('ElevenLabs kaliti kiritilmagan');
  if (!el.voiceId) throw new Error('Ovoz hali klonlanmagan');
  const models = [el.model, ...EL_MODELS.filter(m => m !== el.model)];
  await ttsSlot();
  try {
    let last;
    for (const model_id of models) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await elFetch(`/text-to-speech/${encodeURIComponent(el.voiceId)}?output_format=mp3_44100_128`, el.key,
            { method: 'POST', json: { text, model_id }, raw: true });
        } catch (e) {
          last = e;
          if (e.status === 429 || /concurrent/i.test(e.message)) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }   // limit — kutib qayta urinadi
          if (!(e.status === 400 || e.status === 422) || !/model/i.test(e.raw || '')) throw e;   // faqat model topilmasa keyingisiga o'tiladi
          break;
        }
      }
      if (last && (last.status === 429 || /concurrent/i.test(last.message))) throw last;
    }
    throw last;
  } finally { ttsFree(); }
}
export async function testVoice(text) {
  text = short(text, 300);
  if (text.length < 3) throw new Error('Sinov matnini yozing');
  const mp3 = await tts(text, await elConf());
  return { audio: 'data:audio/mpeg;base64,' + mp3.toString('base64') };
}

export async function setFace(dataUrl) {
  const { buf, ext } = parseDataUrl(dataUrl, { allow: ['jpeg', 'jpg', 'png'], maxBytes: 6 * 1024 * 1024 });
  const p = await saveUpload('studio', buf, ext, 'face');
  const old = await faceConf();
  await setSetting('studio_face', { photo: p });
  if (old && old !== p) await deleteUpload(old);
  return studioStatus();
}

/* ─── Fayllar ─── */
async function saveAudio(buf) {
  const p = `/assets/studio/a-${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}.mp3`;
  await db.run('INSERT INTO uploads (path, mime, data) VALUES (?, ?, ?)', p, 'audio/mpeg', buf.toString('base64'));
  return p;
}
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
async function readAsset(p) {
  p = String(p || '');
  if (/^https?:\/\//.test(p)) {
    const r = await fetch(p, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('Fayl yuklab olinmadi: ' + p.slice(0, 80));
    return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'application/octet-stream' };
  }
  if (!p.startsWith('/assets/')) throw new Error('Noto‘g‘ri fayl yo‘li');
  const disk = path.normalize(path.join(ASSETS, decodeURIComponent(p.slice('/assets/'.length))));
  if (disk.startsWith(ASSETS + path.sep) && fs.existsSync(disk)) return { buf: fs.readFileSync(disk), mime: MIME[path.extname(disk).toLowerCase()] || 'application/octet-stream' };
  const u = await db.get('SELECT mime, data FROM uploads WHERE path = ?', p);
  if (u) return { buf: Buffer.from(u.data, 'base64'), mime: u.mime };
  const m = await mediaGet(p);
  if (m) return { buf: m, mime: 'video/mp4' };
  throw new Error('Fayl topilmadi: ' + p);
}
const dataUri = ({ buf, mime }) => `data:${mime};base64,${buf.toString('base64')}`;
async function dropFiles(...ps) {
  for (const p of ps) if (p && String(p).startsWith('/assets/')) { await deleteUpload(p); await mediaDelete(p); }
}

/* ─── ffmpeg ─── */
function ffRun(bin, args, timeout = 300000, cwd) {
  return new Promise((resolve, reject) => {
    let err = '';
    const p = spawn(bin, args, { windowsHide: true, cwd });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg vaqtidan oshdi')); }, timeout);
    p.stderr.on('data', d => { err = (err + d).slice(-6000); });
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); resolve({ code, err }); });
  });
}
async function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(process.env.AI_TMP || os.tmpdir(), 'kostudio-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
async function needFf() {
  const ff = await ffmpegPath();
  if (!ff) throw new Error('Serverda ffmpeg yo‘q — studiya sahnalarni yig‘a olmaydi');
  return ff;
}
async function ffConvert(buf, from, to, extra = []) {
  const ff = await needFf();
  return withTmp(async (dir) => {
    const a = path.join(dir, 'in.' + from), b = path.join(dir, 'out.' + to);
    fs.writeFileSync(a, buf);
    const r = await ffRun(ff, ['-hide_banner', '-y', '-i', a, ...extra, b]);
    if (r.code !== 0) throw new Error('Ovozni o‘girib bo‘lmadi');
    return fs.readFileSync(b);
  });
}
async function probeDur(buf, ext = 'mp3') {
  const ff = await needFf();
  return withTmp(async (dir) => {
    const a = path.join(dir, 'x.' + ext);
    fs.writeFileSync(a, buf);
    const r = await ffRun(ff, ['-hide_banner', '-i', a, '-f', 'null', '-'], 120000);
    const all = [...r.err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop() || /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.err);
    if (!all) throw new Error('Ovoz davomiyligi aniqlanmadi');
    return +all[1] * 3600 + +all[2] * 60 + +all[3];
  });
}
/* Sahna bo'lagi: 1080×1920, 30 fps, sahna ovozi (avatar klipining o'z ovozi o'rniga aynan shu mp3), davomiylik = ovoz + 0.35 s */
async function makeSeg(clip, audio, kind, dur) {
  const ff = await needFf();
  const D = (Math.max(1, dur) + 0.35).toFixed(2);
  const tail = `setsar=1,tpad=stop_mode=clone:stop_duration=30,trim=duration=${D},setpts=PTS-STARTPTS[v]`;
  const vf = kind === 'product'
    ? `[0:v]fps=30,split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:2,eq=brightness=-0.08[bg];[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,${tail}`
    : `[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${tail}`;
  return withTmp(async (dir) => {
    const v = path.join(dir, 'v.mp4'), a = path.join(dir, 'a.mp3'), o = path.join(dir, 'o.mp4');
    fs.writeFileSync(v, clip); fs.writeFileSync(a, audio);
    const r = await ffRun(ff, ['-hide_banner', '-y', '-i', v, '-i', a, '-filter_complex',
      `${vf};[1:a]aresample=44100,aformat=channel_layouts=stereo,apad=pad_dur=2,atrim=duration=${D},asetpts=PTS-STARTPTS[a]`,
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-r', '30', '-g', '60', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', o]);
    if (r.code !== 0) throw new Error('Sahnani yig‘ib bo‘lmadi: ' + short(r.err.split('\n').slice(-3).join(' '), 200));
    return fs.readFileSync(o);
  });
}
/* ─── Bepul rejim: rasm → harakatli sahna (sekin yaqinlashish/uzoqlashish) + so'zma-so'z subtitr + sahna ovozi ─── */
const FONT = path.join(ASSETS, 'fonts', 'DejaVuSans-Bold.ttf');
async function imgAspect(buf) {
  const ff = await needFf();
  return withTmp(async (dir) => {
    const f = path.join(dir, 'i.img');
    fs.writeFileSync(f, buf);
    const r = await ffRun(ff, ['-hide_banner', '-i', f], 60000);
    const m = /Video:.*?,\s(\d{2,5})x(\d{2,5})/.exec(r.err);
    if (!m) throw new Error('Rasm o‘qilmadi');
    return +m[1] / +m[2];
  });
}
/* Matnni 2 qatorli qisqa bo'laklarga bo'ladi va har bo'lakka ovoz davomiyligiga mutanosib vaqt beradi */
export function captionChunks(text, dur) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks = [];
  let cur = [];
  const len = (a) => a.join(' ').length;
  for (const w of words) {
    if (cur.length && (cur.length >= 4 || len([...cur, w]) > 34)) { chunks.push(cur); cur = []; }
    cur.push(w);
    if (/[.!?]$/.test(w)) { chunks.push(cur); cur = []; }
  }
  if (cur.length) chunks.push(cur);
  const wrap = (ws) => {
    const t = ws.join(' ');
    if (t.length <= 18 || ws.length < 2) return t;
    let best = 1, diff = 1e9;
    for (let i = 1; i < ws.length; i++) { const d = Math.abs(ws.slice(0, i).join(' ').length - ws.slice(i).join(' ').length); if (d < diff) { diff = d; best = i; } }
    return ws.slice(0, best).join(' ') + '\n' + ws.slice(best).join(' ');
  };
  const weights = chunks.map(c => c.join(' ').length + 6);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0.5, dur - 0.05);
  let t = 0.05;
  return chunks.map((c, i) => { const a = t; t += span * weights[i] / sum; return { text: wrap(c), a, b: i === chunks.length - 1 ? span + 0.35 + 5 : t }; });
}
const sum = (n) => String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function twoLines(t, max = 24) {
  t = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 54);
  if (t.length <= max) return t;
  const mid = t.length / 2;
  let best = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? t : t.slice(0, best) + '\n' + t.slice(best + 1);
}
function headLines(head) {
  const words = String(head || '').toUpperCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) { if (cur && (cur + ' ' + w).length > 12) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}
/* Bepul rejim sahnasi (1080×1920, 30 fps): harakatlanuvchi gradient fon, "REC" belgisi, o'suvchi chiziq, katta animatsiyali sarlavha (head),
   sakrab chiquvchi subtitr, narx belgisi; har sahna yorug' "zarba" bilan boshlanadi (tovush effekti assemble() da qo'shiladi) */
export async function makeFreeSeg({ img, audio, kind, dur, text, idx, info, head }) {
  const ff = await needFf();
  if (!fs.existsSync(FONT)) throw new Error('Subtitr shrifti topilmadi (backend/assets/fonts)');
  const Dn = Math.max(1, dur) + 0.35, D = Dn.toFixed(2);
  const frames = Math.ceil(Dn * 30);
  const product = kind === 'product' && !!img;
  const face = kind !== 'product' && !!img;
  const card = !img;
  const hl = face ? [] : headLines(head);
  const hasHead = hl.length > 0;
  const palette = product ? ['0xF4EFEA', '0xFFC8A6'] : (idx % 2 ? ['0x0F1317', '0x4A1A08'] : ['0x0F1317', '0x1B2A44']);
  const bg = `gradients=s=1080x1920:r=30:d=${D}:c0=${palette[0]}:c1=${palette[1]}:speed=0.03:seed=${(idx % 5) + 3}`;
  const zexp = idx % 2 === 0 ? `min(1+0.0005*on,1.2)` : `max(1.18-0.0005*on,1)`;
  const P = (t0) => `min(1,max(0,(t-${t0})*3))`;                      // kirish animatsiyasi 0→1
  const caps = captionChunks(text, dur);
  const dark = product ? '0x14161A' : 'white';
  const draws = [];
  draws.push(`eq=brightness='0.5*max(0,1-t/0.14)':eval=frame`);      // sahna boshidagi yorug' zarba
  draws.push(`fade=t=in:st=0:d=0.12`);
  for (let k = 0; k < 40; k++) draws.push(`drawbox=x=${k * 27}:y=0:w=27:h=12:color=0xFF4F12:t=fill:enable='gte(t,${(Dn * k / 40).toFixed(2)})'`);   // drawbox da t = qalinlik — chiziq zinapoya bilan o'sadi
  draws.push(`drawtext=fontfile=font.ttf:text=●:fontsize=46:fontcolor=0xFF2A2A:x=64:y=70:enable='lt(mod(t,1),0.65)'`);
  draws.push(`drawtext=fontfile=font.ttf:text=REC:fontsize=40:fontcolor=${product ? '0x222222' : 'white'}:x=122:y=74`);
  let y = 140, prodTop = 520, prodBox = 880, capY = 1500, capSize = 62, capBox = 1;
  // katta sarlavha: har qator ketma-ket "sakrab" chiqadi
  const drawHead = (y0, size, step) => hl.forEach((ln, k) => {
    const t0 = (0.12 + 0.18 * k).toFixed(2);
    draws.push(`drawtext=fontfile=font.ttf:textfile=h${k}.txt:fontsize='${size}*(1+0.35*max(0,1-(t-${t0})*7))':fontcolor=${k === hl.length - 1 ? '0xFF4F12' : dark}:borderw=${product ? 0 : 6}:bordercolor=black@0.85:x=(w-text_w)/2:y=${Math.round(y0 + k * step)}:enable='gte(t,${t0})'`);
  });
  const hSize = hasHead ? Math.max(64, Math.min(product ? 104 : 128, Math.floor(960 / (0.8 * Math.max(...hl.map(l => l.length)))))) : 0;
  if (card) {
    draws.push(`drawtext=fontfile=font.ttf:text=KAMERA OPTOM:fontsize=${hasHead ? 62 : 96}:fontcolor=0xFF4F12:x=(w-text_w)/2:y='${hasHead ? 190 : 300}-260*pow(1-${P(0)},2)'`);
    draws.push(`drawtext=fontfile=font.ttf:text=Q A R S H I:fontsize=${hasHead ? 34 : 46}:fontcolor=white@0.75:x=(w-text_w)/2:y=${hasHead ? 270 : 420}`);
    if (hasHead) { drawHead(560, hSize, hSize * 1.22); capY = 1300; capSize = 66; capBox = 0; }
    else { draws.push(`drawbox=x=430:y=500:w=220:h=6:color=0xFF4F12:t=fill:enable='gte(t,0.2)'`); capY = '(h-text_h)/2+120'; capSize = 78; capBox = 0; }
  }
  if (product) {
    if (hasHead) { drawHead(150, hSize, hSize * 1.18); y = 150 + hl.length * hSize * 1.18 + 20; } else y = 230;
    if (info) {
      draws.push(`drawtext=fontfile=font.ttf:textfile=price.txt:fontsize=78:fontcolor=white:box=1:boxcolor=0xFF4F12:boxborderw=26:x='1080-(1080-70)*(1-pow(1-${P(0.3)},2))':y=${Math.round(y)}`);
      draws.push(`drawtext=fontfile=font.ttf:textfile=name.txt:fontsize=44:fontcolor=0x222222:line_spacing=10:x=70:y='${Math.round(y + 130)}+40*pow(1-${P(0.5)},2)':alpha='${P(0.5)}'`);
      prodTop = Math.round(y + 130 + 125);
    } else prodTop = Math.round(y + 30);
    prodBox = Math.max(520, Math.min(860, 1480 - prodTop));
    capY = 1520;
  }
  caps.forEach((c, i) => draws.push(`drawtext=fontfile=font.ttf:textfile=c${i}.txt:fontsize='${capSize}*(1+0.24*max(0,1-(t-${c.a.toFixed(2)})*9))':fontcolor=white:borderw=5:bordercolor=black@0.9:line_spacing=14:box=${capBox}:boxcolor=black@0.45:boxborderw=22:x=(w-text_w)/2:y=${capY}:enable='between(t,${c.a.toFixed(2)},${c.b.toFixed(2)})'`));
  let g;
  if (product) {
    g = `[1:v]scale=1500:1500:force_original_aspect_ratio=decrease,pad=1500:1500:(ow-iw)/2:(oh-ih)/2:white,zoompan=z='${zexp}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${prodBox}x${prodBox}:fps=30,pad=1080:1920:${Math.round((1080 - prodBox) / 2)}:${prodTop}:white,format=gbrp[fgr];[0:v]format=gbrp[bgr];[bgr][fgr]blend=all_mode=multiply[m]`;
  } else if (face) {
    g = `[1:v]scale=1440:1920:force_original_aspect_ratio=increase,crop=1440:1920,zoompan=z='${zexp}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=960x1280:fps=30[fgz];[0:v][fgz]overlay=60:230:shortest=1[m]`;
  } else g = `[0:v]null[m]`;
  const vf = `${g};[m]scale=out_range=tv,format=yuv420p,setsar=1,${draws.join(',')},trim=duration=${D},setpts=PTS-STARTPTS[v]`;
  const aIdx = img ? 2 : 1;
  return withTmp(async (dir) => {
    if (img) fs.writeFileSync(path.join(dir, 'img.bin'), img);
    fs.writeFileSync(path.join(dir, 'a.mp3'), audio);
    fs.copyFileSync(FONT, path.join(dir, 'font.ttf'));
    caps.forEach((c, i) => fs.writeFileSync(path.join(dir, `c${i}.txt`), c.text));
    hl.forEach((l, k) => fs.writeFileSync(path.join(dir, `h${k}.txt`), l));
    if (product && info) {
      fs.writeFileSync(path.join(dir, 'price.txt'), `${sum(info.price)} so‘m`);
      fs.writeFileSync(path.join(dir, 'name.txt'), twoLines(info.name));
    }
    const r = await ffRun(ff, ['-hide_banner', '-y', '-f', 'lavfi', '-t', D, '-i', bg, ...(img ? ['-loop', '1', '-framerate', '30', '-t', D, '-i', 'img.bin'] : []), '-i', 'a.mp3', '-filter_complex',
      `${vf};[${aIdx}:a]aresample=44100,aformat=channel_layouts=stereo,apad=pad_dur=2,atrim=duration=${D},asetpts=PTS-STARTPTS[a]`,
      '-map', '[v]', '-map', '[a]', '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-r', '30', '-g', '60', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', 'o.mp4'], 600000, dir);
    if (r.code !== 0) throw new Error('Sahnani yasab bo‘lmadi: ' + short(r.err.split('\n').slice(-4).join(' '), 300));
    return fs.readFileSync(path.join(dir, 'o.mp4'));
  });
}
async function concatSegs(bufs) {
  const ff = await needFf();
  return withTmp(async (dir) => {
    const list = bufs.map((b, i) => { const f = path.join(dir, `s${i}.mp4`); fs.writeFileSync(f, b); return `file '${f.replace(/\\/g, '/')}'`; });
    fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'));
    const o = path.join(dir, 'final.mp4');
    const r = await ffRun(ff, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', o]);
    if (r.code !== 0) throw new Error('Videoni yig‘ib bo‘lmadi: ' + short(r.err.split('\n').slice(-3).join(' '), 200));
    return fs.readFileSync(o);
  });
}

/* ─── Loyihalar ─── */
const J = (s, d) => { try { return JSON.parse(s || ''); } catch (e) { return d; } };
const pubProject = (r) => r && ({ ...r, variants: J(r.variants, []), scenes: J(r.scenes, []).map(({ job, ...s }) => s), claimed_at: undefined });
export async function listProjects() {
  return (await db.all('SELECT * FROM studio_projects ORDER BY id DESC LIMIT 40')).map(pubProject);
}
export async function getProject(id) { return pubProject(await db.get('SELECT * FROM studio_projects WHERE id = ?', +id)); }

export async function createProject({ topic, brief, seconds }, admin) {
  topic = short(topic, 300);
  if (topic.length < 5) throw new Error('Mavzuni yozing (kamida bir jumla)');
  seconds = [20, 30, 45, 60].includes(+seconds) ? +seconds : 30;
  const r = await db.get(`INSERT INTO studio_projects (topic, brief, seconds, status, admin) VALUES (?, ?, ?, 'scripting', ?) RETURNING id`,
    topic, short(brief, 1000), seconds, short(admin, 60));
  return getProject(r.id);
}
export async function rescript(id, { brief }) {
  const p = await db.get('SELECT * FROM studio_projects WHERE id = ?', +id);
  if (!p) throw new Error('Loyiha topilmadi');
  if (p.status === 'producing') throw new Error('Video yasalayotganda ssenariyni almashtirib bo‘lmaydi');
  await db.run(`UPDATE studio_projects SET status = 'scripting', variants = '[]', claimed_at = NULL, error = '', brief = ?, updated_at = ? WHERE id = ?`,
    brief !== undefined ? short(brief, 1000) : p.brief, nowStr(), p.id);
  return getProject(id);
}
export async function deleteProject(id) {
  const p = await db.get('SELECT scenes FROM studio_projects WHERE id = ?', +id);
  if (!p) return;
  for (const s of J(p.scenes, [])) await dropFiles(s.audio, s.seg, s.raw);
  await db.run('DELETE FROM studio_projects WHERE id = ?', +id);
}

function mkScene(s = {}) {
  const kind = s.kind === 'product' ? 'product' : 'avatar';
  return { id: rid(), kind, text: short(s.text, 600), sku: kind === 'product' ? short(s.sku, 60) : '', visual: kind === 'product' ? short(s.visual, 500) : '',
    head: short(s.head, 40).toUpperCase(), q: short(s.broll || s.q, 80),
    audio: '', dur: 0, seg: '', raw: '', rawKey: '', rawDur: 0, status: 'pending', job: null, error: '', rev: 1 };
}
async function writeScenes(id, scenes, extra = {}) {
  const keys = Object.keys(extra);
  await db.run(`UPDATE studio_projects SET scenes = ?, ${keys.map(k => k + ' = ?').join(', ')}${keys.length ? ', ' : ''}updated_at = ? WHERE id = ?`,
    JSON.stringify(scenes), ...keys.map(k => extra[k]), nowStr(), +id);
}

export async function approveVariant(id, { index }) {
  const p = await db.get('SELECT * FROM studio_projects WHERE id = ?', +id);
  if (!p) throw new Error('Loyiha topilmadi');
  if (p.status === 'producing') throw new Error('Video allaqachon yasalmoqda');
  const v = J(p.variants, [])[+index];
  if (!v) throw new Error('Variant topilmadi');
  for (const s of J(p.scenes, [])) await dropFiles(s.audio, s.seg, s.raw);
  await writeScenes(p.id, v.scenes.map((s, i) => { const m = mkScene(s); if (i === 0) m.mood = v.mood === 'tense' ? 'tense' : 'upbeat'; return m; }), { status: 'producing', title: short(v.title, 200), caption: String(v.caption || '').slice(0, 2200), error: '' });
  kick();
  return getProject(id);
}

/* Sahnani tahrirlash: matn o'zgarsa — ovoz ham, klip ham qayta; faqat ko'rinish (tur, mahsulot, harakat) o'zgarsa — faqat klip */
export async function editScene(id, sid, b = {}) {
  const drop = [];
  const out = await db.tx(async () => {
    const p = await db.get('SELECT * FROM studio_projects WHERE id = ?' + db.forUpdate, +id);
    if (!p) throw new Error('Loyiha topilmadi');
    const scenes = J(p.scenes, []);
    const s = scenes.find(x => x.id === sid);
    if (!s) throw new Error('Sahna topilmadi');
    const kind = b.kind === undefined ? s.kind : (b.kind === 'product' ? 'product' : 'avatar');
    const text = b.text === undefined ? s.text : short(b.text, 600);
    const sku = kind === 'product' ? (b.sku === undefined ? s.sku : short(b.sku, 60)) : '';
    const visual = kind === 'product' ? (b.visual === undefined ? s.visual : short(b.visual, 500)) : '';
    const head = b.head === undefined ? (s.head || '') : short(b.head, 40).toUpperCase();
    const q = b.q === undefined ? (s.q || '') : short(b.q, 80);
    if (text.length < 2) throw new Error('Sahna matni bo‘sh');
    if (kind === 'product' && !sku) throw new Error('Mahsulot sahnasi uchun mahsulotni tanlang');
    const voiceChanged = text !== s.text;
    const lookChanged = voiceChanged || kind !== s.kind || sku !== s.sku || visual !== s.visual || head !== (s.head || '') || q !== (s.q || '');
    if (!lookChanged && !b.retry) return false;
    const rawGone = kind !== 'product' || sku !== s.sku || visual !== s.visual;
    if (voiceChanged) drop.push(s.audio);
    drop.push(s.seg);
    if (rawGone) drop.push(s.raw);
    Object.assign(s, { kind, text, sku, visual, head, q, rev: (s.rev || 1) + 1, job: null, error: '', seg: '' });
    if (voiceChanged) Object.assign(s, { audio: '', dur: 0 });
    if (rawGone) Object.assign(s, { raw: '', rawKey: '', rawDur: 0 });
    s.status = s.audio ? 'voiced' : 'pending';
    await writeScenes(p.id, scenes, { status: 'producing', error: '' });
    return true;
  });
  if (out) { await dropFiles(...drop); kick(); }
  return getProject(id);
}
export async function addScene(id, { after, kind, text, sku, visual, head, q }) {
  const p = await db.get('SELECT * FROM studio_projects WHERE id = ?', +id);
  if (!p) throw new Error('Loyiha topilmadi');
  if (short(text).length < 2) throw new Error('Sahna matnini yozing');
  const scenes = J(p.scenes, []);
  const s = mkScene({ kind, text, sku, visual, head, q });
  if (s.kind === 'product' && !s.sku) throw new Error('Mahsulot sahnasi uchun mahsulotni tanlang');
  const i = scenes.findIndex(x => x.id === after);
  scenes.splice(i < 0 ? scenes.length : i + 1, 0, s);
  await writeScenes(p.id, scenes, { status: 'producing', error: '' });
  kick();
  return getProject(id);
}
export async function removeScene(id, sid) {
  const p = await db.get('SELECT * FROM studio_projects WHERE id = ?', +id);
  if (!p) throw new Error('Loyiha topilmadi');
  const scenes = J(p.scenes, []);
  const s = scenes.find(x => x.id === sid);
  if (!s) return getProject(id);
  if (scenes.length <= 1) throw new Error('Kamida bitta sahna qolishi kerak');
  await writeScenes(p.id, scenes.filter(x => x.id !== sid), { status: 'producing', error: '' });
  await dropFiles(s.audio, s.seg, s.raw);
  kick();
  return getProject(id);
}
export async function moveScene(id, sid, dir) {
  const p = await db.get('SELECT * FROM studio_projects WHERE id = ?', +id);
  if (!p) throw new Error('Loyiha topilmadi');
  const scenes = J(p.scenes, []);
  const i = scenes.findIndex(x => x.id === sid), j = i + (+dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= scenes.length) return getProject(id);
  [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
  await writeScenes(p.id, scenes, { status: 'producing', error: '' });
  kick();
  return getProject(id);
}
export async function updateProjectMeta(id, { title, caption }) {
  const sets = [], vals = [];
  if (title !== undefined) { sets.push('title = ?'); vals.push(short(title, 200)); }
  if (caption !== undefined) { sets.push('caption = ?'); vals.push(String(caption || '').slice(0, 2200)); }
  if (sets.length) await db.run(`UPDATE studio_projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...vals, nowStr(), +id);
  return getProject(id);
}

/* ─── Lokal ssenariy ishchisi (Claude obunasi) ─── */
export async function checkWorkerKey(k) {
  const w = await workerConf();
  const a = Buffer.from(String(k || '')), b = Buffer.from(String(w.key || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
async function touchWorker() {
  const s = (await getSetting('studio_worker', {})) || {};
  s.seenAt = nowStr();
  await setSetting('studio_worker', s);
}

const SCRIPT_SCHEMA = {
  type: 'object', required: ['variants'],
  properties: {
    variants: {
      type: 'array', minItems: 1, maxItems: 5,
      items: {
        type: 'object', required: ['title', 'angle', 'caption', 'scenes'],
        properties: {
          title: { type: 'string' }, angle: { type: 'string' }, caption: { type: 'string' }, mood: { type: 'string', enum: ['tense', 'upbeat'] },
          scenes: {
            type: 'array', minItems: 4, maxItems: 12,
            items: {
              type: 'object', required: ['kind', 'text', 'head', 'broll'],
              properties: { kind: { type: 'string', enum: ['avatar', 'product'] }, text: { type: 'string' }, head: { type: 'string' }, broll: { type: 'string' }, sku: { type: 'string' }, visual: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};
const SCRIPT_SYSTEM = `You write short vertical (9:16) Instagram Reels scripts in Uzbek for KAMERA OPTOM QARSHI — a shop in Qarshi, Uzbekistan that sells security cameras (CCTV), recorders, cables and installs them. The voice is the shop owner's own cloned voice; the picture is stock footage, product photos and animated text.

GOAL: a viewer who scrolls past must stay until the end and then call. Retention beats information. Boring = failure.

STRUCTURE (keep this rhythm):
1. HOOK (scene 1, at most 2.5 seconds, 5–9 words): a pain question, a vivid "what if", a surprising contrast or a direct challenge. NEVER start with a greeting, the shop name or "Assalomu alaykum".
2. PROBLEM (1–2 scenes): ONE concrete everyday situation in Qarshi — shop at night, kids home alone, dacha, courtyard, warehouse, parking. Make the viewer feel the loss or fear; no abstractions.
3. TURN + SOLUTION (2–3 scenes): the product as a benefit the viewer can feel ("kechasi ham rangli ko‘rasiz", "telefoningizdan hamma narsa ko‘rinadi"), not a list of specs. At most one fact per scene.
4. PROOF / OFFER (0–1 scene): only facts that are in the brief or the catalog (price, what is included).
5. CTA (last scene): ONE clear action — call or come to the shop in Qarshi. Short and confident.

PACING: every scene is ONE punchy sentence of 5–12 words (a second very short sentence is allowed). Use 7–10 scenes for a 30-second video (scale with the target length); a scene lasts 2.5–4.5 seconds. Alternate short and slightly longer lines. Use ?, !, … and commas to steer the voice's intonation. Speak like a neighbour, not like an advertisement: no clichés such as "eng sifatli va arzon" unless backed by a fact.

LANGUAGE: natural, warm, spoken Uzbek in Latin script. Write o‘ and g‘ with the ‘ character (U+2018) and the tutuq with ’ (U+2019), e.g. "ma’lumot", "so‘m", "g‘amxo‘rlik". Avoid Russian or English words when an Uzbek word exists. No emoji, no hashtags in scene text.
The "text" is read by text-to-speech: write every number, price, year and the phone number in words (e.g. "olti yuz o‘n olti ming so‘m"). Phone in words: "plus to‘qqiz yuz to‘qson sakkiz, yetmish sakkiz, bir yuz yigirma, nol-nol, yigirma".

SCENE FIELDS:
- "kind": "product" when the scene shows a catalog product (then "sku" must be copied exactly from the catalog and "visual" is a short English camera-motion hint, no text, no people), otherwise "avatar" (a mood scene with stock footage; leave sku and visual empty). Use 2–4 product scenes when the topic suits it.
- "head": 2–4 WORDS in UPPERCASE Uzbek shown BIG on screen as an animated headline — the punch of that scene (e.g. "O‘G‘RI KIRDIMI?", "KECHASI HAM RANGLI", "ATIGI 616 000 SO‘M"). Digits are allowed here. Never repeat the whole sentence.
- "broll": 2–5 English words to search stock video for this scene's mood (e.g. "dark street night", "worried shop owner", "security camera building", "burglar alley night", "family house garden"). Concrete, filmable, no brand names.

VARIANTS: 3 variants with clearly different angles (e.g. fear → solution, myth-busting, price/offer, short story, mistakes to avoid). "angle" names it in Uzbek in a few words.
"mood": "tense" for fear/problem-led variants (dark music), "upbeat" for solution/offer-led ones (energetic music).
"title": short Uzbek title. "caption": Instagram caption in Uzbek (digits allowed): first line is a hook, then 2–3 short lines, one call to action, then 5–7 relevant hashtags.
Never invent prices, discounts, warranties or facts that are not in the brief or the catalog.`;

export async function claimScriptJob() {
  await touchWorker();
  const stale = new Date(Date.now() - 10 * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const p = await db.tx(async () => {
    const row = await db.get(`SELECT * FROM studio_projects WHERE status = 'scripting' AND (claimed_at IS NULL OR claimed_at < ?) ORDER BY id LIMIT 1` + db.forUpdate, stale);
    if (row) await db.run('UPDATE studio_projects SET claimed_at = ? WHERE id = ?', nowStr(), row.id);
    return row;
  });
  if (!p) return null;
  const words = p.topic.toLowerCase().split(/[^a-z0-9а-яё‘’'-]+/i).filter(w => w.length > 2).slice(0, 6);
  const seen = new Set(), cat = [];
  const add = rows => rows.forEach(r => { if (!seen.has(r.sku)) { seen.add(r.sku); cat.push(`${r.sku} | ${r.name} | ${r.price || 0} so‘m`); } });
  for (const w of words) add(await db.all("SELECT sku, name, price FROM products WHERE images IS NOT NULL AND images <> '[]' AND (LOWER(name) LIKE ? OR LOWER(cat) LIKE ?) LIMIT 8", `%${w}%`, `%${w}%`));
  add(await db.all("SELECT sku, name, price FROM products WHERE images IS NOT NULL AND images <> '[]' ORDER BY is_popular DESC, sku LIMIT 30"));
  const prompt = `Mavzu: ${p.topic}
${p.brief ? 'Qo‘shimcha ko‘rsatma: ' + p.brief + '\n' : ''}Maqsadli davomiylik: ${p.seconds} soniya. 3 ta turli variant yoz.
Mahsulotlar katalogi (sku | nomi | narxi):
${cat.slice(0, 50).join('\n')}`;
  return { id: p.id, prompt, system: SCRIPT_SYSTEM, schema: SCRIPT_SCHEMA };
}

export async function submitScripts(id, { variants, error }) {
  await touchWorker();
  const p = await db.get('SELECT * FROM studio_projects WHERE id = ?', +id);
  if (!p || p.status !== 'scripting') throw new Error('Bu loyiha ssenariy kutmayapti');
  if (error) {
    await db.run(`UPDATE studio_projects SET status = 'failed', error = ?, claimed_at = NULL, updated_at = ? WHERE id = ?`, 'Ssenariy yozilmadi: ' + short(error, 300), nowStr(), p.id);
    return;
  }
  const skus = new Set((await db.all('SELECT sku FROM products')).map(r => r.sku));
  const clean = (Array.isArray(variants) ? variants : []).slice(0, 5).map(v => ({
    title: short(v.title, 200), angle: short(v.angle, 120), mood: v.mood === 'tense' ? 'tense' : 'upbeat', caption: String(v.caption || '').slice(0, 2200),
    scenes: (Array.isArray(v.scenes) ? v.scenes : []).slice(0, 12).map(s => {
      const prod = s.kind === 'product' && skus.has(String(s.sku || '').trim());
      return { kind: prod ? 'product' : 'avatar', text: short(s.text, 600), sku: prod ? String(s.sku).trim() : '', visual: prod ? short(s.visual, 500) : '', head: short(s.head, 40), broll: short(s.broll, 80) };
    }).filter(s => s.text.length > 1),
  })).filter(v => v.scenes.length >= 2);
  if (!clean.length) throw new Error('Ssenariylar bo‘sh yoki noto‘g‘ri');
  await db.run(`UPDATE studio_projects SET status = 'choose', variants = ?, error = '', updated_at = ? WHERE id = ?`, JSON.stringify(clean), nowStr(), p.id);
}

/* ─── Fon ishchisi: sahnalar → yakuniy video ─── */
const busy = new Set();
let _timer = null, _running = false;

async function patchScene(pid, sid, rev, ch) {
  return db.tx(async () => {
    const row = await db.get('SELECT scenes FROM studio_projects WHERE id = ?' + db.forUpdate, pid);
    if (!row) return false;
    const scenes = J(row.scenes, []);
    const s = scenes.find(x => x.id === sid);
    if (!s || s.rev !== rev) return false;          // shu orada tahrirlangan — natija eskirgan
    Object.assign(s, ch);
    await db.run('UPDATE studio_projects SET scenes = ?, updated_at = ? WHERE id = ?', JSON.stringify(scenes), nowStr(), pid);
    return true;
  });
}

async function sceneInput(s) {
  if (s.kind === 'avatar') {
    const face = await faceConf();
    if (!face) throw new Error('Yuz surati yuklanmagan');
    const [img, aud] = await Promise.all([readAsset(face), readAsset(s.audio)]);
    return { model: AVATAR_MODEL, input: { image_url: dataUri(img), audio_url: dataUri(aud), aspect_ratio: '9:16', resolution: '720p', talking_style: 'expressive' } };
  }
  const prod = await db.get('SELECT name, images FROM products WHERE sku = ?', s.sku);
  const img0 = prod && J(prod.images, [])[0];
  if (!img0) throw new Error('Mahsulot rasmi topilmadi: ' + s.sku);
  const img = await readAsset(img0);
  return {
    model: BROLL_MODEL,
    input: {
      prompt: s.visual || `Premium commercial shot of a security camera (${prod.name}). Slow smooth camera orbit, soft studio light, subtle reflections, product sharp and unchanged, no text, no people.`,
      image_url: dataUri(img), duration: s.dur > 5.2 ? '10' : '5',
      negative_prompt: 'blur, distort, low quality, deformed product, warped text, extra logos, watermark',
    },
  };
}

let _freeActive = 0;
async function stepScene(p, s) {
  const rev = s.rev;
  const fail = (msg) => patchScene(p.id, s.id, rev, { status: 'failed', error: short(msg, 400), job: null });
  try {
    if (s.status === 'pending') {
      const el = await elConf();
      const mp3 = await tts(s.text, el);
      const dur = await probeDur(mp3);
      const a = await saveAudio(mp3);
      if (!(await patchScene(p.id, s.id, rev, { audio: a, dur, status: 'voiced', error: '' }))) await dropFiles(a);
      return;
    }
    if (s.status === 'voiced' && (await renderMode()) === 'free') {
      if (_freeActive >= 1) return;                      // zaif kompyuterda ffmpeg bittadan ishlaydi
      _freeActive++;
      try {
        let imgPath, info;
        if (s.kind === 'avatar') {
          imgPath = await faceConf();          // surat ixtiyoriy: bo'lmasa brend kartasi chiqadi
        } else {
          const prod = await db.get('SELECT name, price, images FROM products WHERE sku = ?', s.sku);
          imgPath = prod && J(prod.images, [])[0];
          info = prod && { name: prod.name, price: prod.price };
          if (!imgPath) return fail('Mahsulot rasmi topilmadi: ' + s.sku);
        }
        const [img, aud] = await Promise.all([imgPath ? readAsset(imgPath) : null, readAsset(s.audio)]);
        const idx = J(p.scenes, []).findIndex(x => x.id === s.id);
        const seg = await mediaPut('studio', await makeFreeSeg({ img: img ? img.buf : null, audio: aud.buf, kind: s.kind, dur: s.dur, text: s.text, idx, info, head: s.head }), 'mp4');
        const ok = await patchScene(p.id, s.id, rev, { seg, raw: '', rawKey: '', rawDur: 0, status: 'ready', job: null, error: '' });
        if (!ok) await dropFiles(seg);
        else if (s.raw) await dropFiles(s.raw);
      } finally { _freeActive--; }
      return;
    }
    if (s.status === 'voiced') {
      const key = s.kind === 'product' ? s.sku + '|' + s.visual : '';
      if (s.kind === 'product' && s.raw && s.rawKey === key && s.rawDur + 1 >= s.dur) {   // klip qayta ishlatiladi — faqat ovoz yangilangan
        const [clip, aud] = await Promise.all([mediaGet(s.raw), readAsset(s.audio)]);
        if (clip) {
          const seg = await mediaPut('studio', await makeSeg(clip, aud.buf, s.kind, s.dur), 'mp4');
          if (!(await patchScene(p.id, s.id, rev, { seg, status: 'ready', error: '' }))) await dropFiles(seg);
          return;
        }
      }
      const f = await falConf();
      if (!f.key) return fail('fal.ai kaliti kiritilmagan («AI video» bo‘limida)');
      const { model, input } = await sceneInput(s);
      const job = await falFetch(queueUrl() + model, f.key, { method: 'POST', body: JSON.stringify(input) });
      await patchScene(p.id, s.id, rev, { status: 'rendering', job: { st: job.status_url, res: job.response_url, at: Date.now() }, error: '' });
      return;
    }
    if (s.status === 'rendering' && s.job) {
      const f = await falConf();
      if (!f.key) return fail('fal.ai kaliti o‘chirildi');
      let st;
      try { st = await falFetch(s.job.st, f.key); }
      catch (e) { if (e.status && e.status < 500 && e.status !== 429) return fail(e.message); return; }
      if (st.status !== 'COMPLETED') { if (Date.now() - s.job.at > RENDER_TIMEOUT) return fail('fal.ai 25 daqiqada klip tayyorlamadi'); return; }
      if (st.error) return fail('fal.ai: ' + short(st.error, 300));
      let res;
      try { res = await falFetch(s.job.res, f.key); }
      catch (e) { if (e.status && e.status < 500) return fail(e.message); return; }
      const url = res?.video?.url;
      if (!url) return fail('fal.ai natijasida video yo‘q');
      const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) { if (r.status >= 400 && r.status < 500 && r.status !== 429) return fail(`Klipni yuklab bo‘lmadi (HTTP ${r.status})`); return; }
      const clip = Buffer.from(await r.arrayBuffer());
      const aud = await readAsset(s.audio);
      const seg = await mediaPut('studio', await makeSeg(clip, aud.buf, s.kind, s.dur), 'mp4');
      let raw = '', rawDur = 0;
      if (s.kind === 'product') { raw = await mediaPut('studio', clip, 'mp4'); rawDur = await probeDur(clip, 'mp4').catch(() => 5); }
      const ok = await patchScene(p.id, s.id, rev, { seg, raw, rawKey: s.kind === 'product' ? s.sku + '|' + s.visual : '', rawDur, status: 'ready', job: null, error: '' });
      if (!ok) await dropFiles(seg, raw);
      else if (s.raw && s.raw !== raw) await dropFiles(s.raw);
    }
  } catch (e) {
    console.error('[studio] sahna', p.id, s.id, e.message);
    await fail(e.message);
  }
}

/* Yakuniy tovush: fon musiqasi (ovoz kelganda pasayadi), kesish joylarida whoosh, sarlavha/narx chiqqanda pop, ochilishda zarba; −14 LUFS */
const SOUND = path.join(ASSETS, 'sound');
async function mixSound(video, scenes) {
  const ff = await needFf();
  const has = (f) => fs.existsSync(path.join(SOUND, f));
  const music = scenes[0] && scenes[0].mood === 'tense' ? 'music-tense.mp3' : 'music-tech.mp3';
  if (!has(music)) return video;
  const ev = [];
  let t = 0;
  scenes.forEach((s, i) => {
    if (i === 0 && has('hit.mp3')) ev.push({ f: 'hit.mp3', at: 0.02, g: 0.55 });
    if (i > 0 && has('whoosh1.mp3')) ev.push({ f: i % 2 ? 'whoosh1.mp3' : 'whoosh2.mp3', at: Math.max(0, t - 0.08), g: 0.8 });
    if (s.head && has('pop1.mp3')) ev.push({ f: i % 2 ? 'pop1.mp3' : 'pop2.mp3', at: t + 0.14, g: 0.6 });
    if (s.kind === 'product' && has('pop2.mp3')) ev.push({ f: 'pop2.mp3', at: t + 0.34, g: 0.55 });
    t += (s.dur || 0) + 0.35;
  });
  const T = t.toFixed(2);
  return withTmp(async (dir) => {
    fs.writeFileSync(path.join(dir, 'in.mp4'), video);
    const args = ['-hide_banner', '-y', '-i', 'in.mp4', '-stream_loop', '-1', '-i', path.join(SOUND, music)];
    ev.forEach(e => args.push('-i', path.join(SOUND, e.f)));
    const parts = [
      `[0:a]aresample=44100,aformat=channel_layouts=stereo,asplit=2[vo][vk]`,
      `[1:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${T},asetpts=PTS-STARTPTS,afade=t=in:d=0.6,afade=t=out:st=${Math.max(0, t - 1.4).toFixed(2)}:d=1.4,volume=0.55[mu]`,
      `[mu][vk]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350:makeup=1[md]`,
    ];
    ev.forEach((e, i) => { const ms = Math.round(e.at * 1000); parts.push(`[${i + 2}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${e.g}[s${i}]`); });
    parts.push(`[vo][md]${ev.map((e, i) => `[s${i}]`).join('')}amix=inputs=${2 + ev.length}:normalize=0:duration=first[mx]`);
    parts.push(`[mx]loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.95[a]`);
    args.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-movflags', '+faststart', 'out.mp4');
    const r = await ffRun(ff, args, 300000, dir);
    if (r.code !== 0) throw new Error('Tovushni aralashtirib bo‘lmadi: ' + short(r.err.split('\n').slice(-3).join(' '), 250));
    return fs.readFileSync(path.join(dir, 'out.mp4'));
  });
}

async function assemble(p) {
  const scenes = J(p.scenes, []);
  const bufs = [];
  for (const s of scenes) {
    const b = await mediaGet(s.seg);
    if (!b) { await patchScene(p.id, s.id, s.rev, { status: s.audio ? 'voiced' : 'pending', seg: '' }); return; }
    bufs.push(b);
  }
  let final = await concatSegs(bufs);
  try { final = await mixSound(final, scenes); } catch (e) { console.error('[studio] musiqa qo‘shilmadi:', e.message); }
  // yig'ish davomida tahrir bo'lsa — bu natija eskirgan
  const now = await db.get('SELECT scenes, status, ai_video_id FROM studio_projects WHERE id = ?', p.id);
  if (!now || now.status !== 'producing' || now.scenes !== p.scenes) return;
  const video = await mediaPut('ai', final, 'mp4');
  const total = scenes.reduce((n, s) => n + s.dur + 0.35, 0);
  const face = await faceConf();
  const prev = now.ai_video_id ? await db.get('SELECT * FROM ai_videos WHERE id = ?', now.ai_video_id) : null;
  if (prev && prev.ig_status !== 'published' && prev.ig_status !== 'uploading') {
    await mediaDelete(prev.video);
    await db.run("UPDATE ai_videos SET video = ?, title = ?, caption = ?, duration = ?, frame = ?, ig_status = '', error = '', updated_at = ? WHERE id = ?",
      video, p.title, p.caption, Math.round(total), face || prev.frame, nowStr(), prev.id);
    await db.run("UPDATE studio_projects SET status = 'ready', video = ?, error = '', updated_at = ? WHERE id = ?", video, nowStr(), p.id);
  } else {
    const r = await db.get(`INSERT INTO ai_videos (sku, title, prompt, model, duration, status, frame, video, caption, admin)
      VALUES ('', ?, ?, 'studio', ?, 'ready', ?, ?, ?, ?) RETURNING id`, p.title, 'Klon studiya #' + p.id + ': ' + p.topic, Math.round(total), face, video, p.caption, p.admin);
    await db.run("UPDATE studio_projects SET status = 'ready', video = ?, ai_video_id = ?, error = '', updated_at = ? WHERE id = ?", video, r.id, nowStr(), p.id);
  }
}

async function tick() {
  if (_running) return;
  _running = true;
  try {
    for (const p of await db.all("SELECT * FROM studio_projects WHERE status = 'producing'")) {
      const scenes = J(p.scenes, []);
      const failed = scenes.findIndex(s => s.status === 'failed');
      if (failed >= 0) {
        await db.run("UPDATE studio_projects SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND scenes = ?",
          `${failed + 1}-sahna: ${scenes[failed].error}`, nowStr(), p.id, p.scenes);
        continue;
      }
      if (scenes.length && scenes.every(s => s.status === 'ready')) {
        const k = 'asm:' + p.id;
        if (!busy.has(k)) {
          busy.add(k);
          assemble(p).catch(e => db.run("UPDATE studio_projects SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", short(e.message, 400), nowStr(), p.id))
            .finally(() => busy.delete(k));
        }
        continue;
      }
      let rendering = scenes.filter(s => s.status === 'rendering').length;
      for (const s of scenes) {
        const k = `${p.id}:${s.id}:${s.rev}`;
        if (busy.has(k) || s.status === 'ready' || s.status === 'failed') continue;
        if (s.status === 'voiced') { if (rendering >= MAX_RENDER) continue; rendering++; }
        busy.add(k);
        stepScene(p, s).finally(() => busy.delete(k));
      }
    }
  } catch (e) { console.error('[studio] tick:', e.message); }
  finally { _running = false; }
}
function kick() { setTimeout(tick, 1000); }
export function startStudioWorker() {
  if (_timer) return;
  _timer = setInterval(tick, 8000);
  _timer.unref?.();
  kick();
}
