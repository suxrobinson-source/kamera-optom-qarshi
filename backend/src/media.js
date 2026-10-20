import crypto from 'node:crypto';
import { once } from 'node:events';
import { db } from './db.js';

/* Videolar (story, mahsulot, banner) bazada 1 MB lik bo'laklarda saqlanadi — Heroku diski vaqtinchalik.
   Admin faylni bo'laklab yuklaydi (katta JSON o'rniga), server esa Range so'rovlariga faqat kerakli
   bo'laklarni o'qib beradi: iPhone (Safari) video ijrosi uchun 206 javob shart, xotira ham tejaladi. */

export const CHUNK = 1024 * 1024;
export const MEDIA_MAX = 60 * 1024 * 1024;          // bitta video
export const MEDIA_TOTAL = 700 * 1024 * 1024;       // barcha videolar (Heroku Postgres essential-0: 1 GB)
export const MEDIA_FOLDERS = ['stories', 'products', 'banners'];
export const VIDEO_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

const toBuf = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v.buffer, v.byteOffset, v.byteLength));

export async function mediaUsage() {
  const r = await db.get('SELECT COALESCE(SUM(size), 0) AS used, COUNT(*) AS n FROM media WHERE done = 1');
  return { used: +r.used || 0, count: +r.n || 0, limit: MEDIA_TOTAL, max: MEDIA_MAX };
}

/* Yangi video: yo'l beriladi, bo'laklar keyin keladi */
export async function mediaStart({ folder, name, mime, size }) {
  if (!MEDIA_FOLDERS.includes(folder)) throw new Error('Noto‘g‘ri papka');
  const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,4})$/)?.[1]
    || Object.keys(VIDEO_TYPES).find(k => VIDEO_TYPES[k] === mime) || '';
  const type = VIDEO_TYPES[ext];
  if (!type) throw new Error('Video formati MP4, WEBM yoki MOV bo‘lishi kerak');
  size = Math.round(+size || 0);
  if (size <= 0) throw new Error('Fayl bo‘sh');
  if (size > MEDIA_MAX) throw new Error(`Video ${MEDIA_MAX / 1048576} MB dan oshmasligi kerak — qisqaroq yoki siqilgan video yuklang`);
  // bir kundan eski, tugallanmagan yuklashlar tozalanadi
  const stale = await db.all("SELECT path FROM media WHERE done = 0 AND created_at < ?", new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' '));
  for (const s of stale) await mediaDelete(s.path);
  const u = await mediaUsage();
  if (u.used + size > MEDIA_TOTAL) throw new Error(`Video uchun joy yetmaydi (${Math.round(u.used / 1048576)} / ${MEDIA_TOTAL / 1048576} MB band) — eski videolarni o‘chiring`);
  const path = `/assets/${folder}/v-${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}.${ext === 'm4v' ? 'mp4' : ext}`;
  const chunks = Math.ceil(size / CHUNK);
  await db.run('INSERT INTO media (path, mime, size, chunks, done) VALUES (?, ?, ?, ?, 0)', path, type, size, chunks);
  return { path, chunk: CHUNK, chunks };
}

export async function mediaChunk(path, idx, body) {
  const m = await db.get('SELECT size, chunks, done FROM media WHERE path = ?', String(path || ''));
  if (!m) throw new Error('Yuklash topilmadi — qaytadan boshlang');
  if (m.done) throw new Error('Video allaqachon yuklangan');
  idx = parseInt(idx, 10);
  if (!(idx >= 0 && idx < m.chunks)) throw new Error('Noto‘g‘ri bo‘lak');
  const want = idx === m.chunks - 1 ? m.size - idx * CHUNK : CHUNK;
  const buf = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  if (buf.length !== want) throw new Error(`Bo‘lak hajmi noto‘g‘ri (${buf.length} ≠ ${want})`);
  await db.run('INSERT INTO media_chunks (path, idx, data) VALUES (?, ?, ?) ON CONFLICT (path, idx) DO UPDATE SET data = excluded.data', path, idx, buf);
}

export async function mediaDone(path) {
  const m = await db.get('SELECT chunks, done FROM media WHERE path = ?', String(path || ''));
  if (!m) throw new Error('Yuklash topilmadi');
  const n = (await db.get('SELECT COUNT(*) AS n FROM media_chunks WHERE path = ?', path)).n;
  if (+n !== +m.chunks) throw new Error(`Video to‘liq yuklanmadi (${n} / ${m.chunks})`);
  await db.run('UPDATE media SET done = 1 WHERE path = ?', path);
  return { path };
}

export async function mediaDelete(path) {
  path = String(path || '');
  if (!path.startsWith('/assets/')) return;
  await db.run('DELETE FROM media_chunks WHERE path = ?', path);
  await db.run('DELETE FROM media WHERE path = ?', path);
}

/* /assets/... — diskda ham, rasmlar jadvalida ham topilmasa: video bo'laklardan (Range bilan) */
export async function serveMedia(req, res, next) {
  let p;
  try { p = '/assets' + decodeURIComponent(req.path); } catch (e) { return next(); }
  const m = await db.get('SELECT mime, size FROM media WHERE path = ? AND done = 1', p);
  if (!m) return next();
  const size = +m.size;
  let start = 0, end = size - 1, status = 200;
  const r = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  if (r && (r[1] || r[2])) {
    if (r[1] === '') { start = Math.max(0, size - +r[2]); }
    else { start = +r[1]; end = r[2] ? Math.min(+r[2], size - 1) : size - 1; }
    if (start >= size || start > end) {
      res.status(416).set('Content-Range', `bytes */${size}`).end();
      return;
    }
    status = 206;
    res.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.status(status).set({
    'Content-Type': m.mime, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  for (let i = Math.floor(start / CHUNK); i <= Math.floor(end / CHUNK); i++) {
    if (res.destroyed) return;
    const row = await db.get('SELECT data FROM media_chunks WHERE path = ? AND idx = ?', p, i);
    if (!row) { res.destroy(); return; }
    const buf = toBuf(row.data), base = i * CHUNK;
    const part = buf.subarray(Math.max(0, start - base), Math.min(buf.length, end - base + 1));
    if (!res.write(part)) await once(res, 'drain');
  }
  res.end();
}
