import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from './db.js';

/* Yuklangan rasmlar bazada saqlanadi (Heroku diski vaqtinchalik — fayl qayta ishga tushganda o'chadi).
   Manzil o'zgarmaydi: /assets/<papka>/<nom>. Repodagi statik rasmlar avvalgidek diskdan beriladi. */

export const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

/* data:image/...;base64,... → { buf, ext } yoki xato */
export function parseDataUrl(dataUrl, { allow = ['jpeg', 'jpg', 'png', 'webp'], maxBytes = 4 * 1024 * 1024 } = {}) {
  const m = String(dataUrl || '').match(/^data:image\/([a-z+]+);base64,([A-Za-z0-9+/=]+)$/);
  const type = m ? (m[1] === 'svg+xml' ? 'svg' : m[1]) : '';
  if (!m || !allow.includes(type)) throw new Error('Rasm formati ' + allow.filter(a => a !== 'jpeg').join(', ').toUpperCase() + ' bo‘lishi kerak');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > maxBytes) throw new Error(`Har bir rasm ${Math.round(maxBytes / 1048576)} MB dan oshmasligi kerak`);
  return { buf, ext: type === 'jpeg' ? 'jpg' : type };
}

export async function saveUpload(folder, buf, ext, prefix = '') {
  const name = `${prefix ? prefix + '-' : ''}${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const p = `/assets/${folder}/${name}`;
  await db.run('INSERT INTO uploads (path, mime, data) VALUES (?, ?, ?)', p, IMAGE_TYPES[ext] || 'application/octet-stream', buf.toString('base64'));
  return p;
}

export const deleteUpload = (p) => db.run('DELETE FROM uploads WHERE path = ?', String(p || ''));

/* express.static dan keyin: diskda topilmagan /assets/... fayli bazadan beriladi */
export async function serveUpload(req, res, next) {
  let p;
  try { p = '/assets' + decodeURIComponent(req.path); } catch (e) { return next(); }
  const row = await db.get('SELECT mime, data FROM uploads WHERE path = ?', p);
  if (!row) return next();
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  if (row.mime === 'image/svg+xml') res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.send(Buffer.from(row.data, 'base64'));
}

/* Express 4 async xatolarni o'zi ushlamaydi — marshrutlardagi rad etilgan Promise'lar next(err) ga */
export const wrap = (fn) => (typeof fn !== 'function' || fn.length >= 4) ? fn : (req, res, next) => {
  try { const p = fn(req, res, next); if (p && typeof p.catch === 'function') p.catch(next); }
  catch (e) { next(e); }
};
export function asyncRouter() {
  const r = Router();
  for (const m of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    const orig = r[m].bind(r);
    r[m] = (...args) => orig(...args.map(wrap));
  }
  return r;
}
