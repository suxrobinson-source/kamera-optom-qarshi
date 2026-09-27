import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting } from '../db.js';

export const publicRouter = Router();

// Tannarx, marja va usta narxi mijozlarga berilmaydi (usta narxi — faqat /ustas/status orqali).
// Import qilingan xususiyatlardagi diler (optom) va chakana narx qatorlari ham faqat adminda qoladi.
const PRIVATE_SPEC = /diler|dealer|optom|ulgurji|chakana|retail|tannarx|narx/i;
const parseProduct = ({ price_usd, margin, margin_usta, price_usta, ...row }) => {
  let images = [];
  if (row.images) {
    try { images = JSON.parse(row.images); } catch (e) { }
  }
  let specs = [];
  try { specs = row.specs ? JSON.parse(row.specs) : []; } catch (e) { }
  return {
    ...row,
    desc: row.desc || '',
    images: Array.isArray(images) ? images : [],
    tags: row.tags ? JSON.parse(row.tags) : [],
    specs: (Array.isArray(specs) ? specs : []).filter(sp => !PRIVATE_SPEC.test(String(sp && sp.k || ''))),
    poe: !!row.poe, mp: !!row.mp, night: !!row.night, spin: !!row.spin, active: !!row.active,
    is_popular: !!row.is_popular,
  };
};

// GET /api/products?cat=Tashqi&poe=1&mp=1&night=1&popular=1&min=0&max=2000000&q=4mp&sort=price-asc
publicRouter.get('/products', (req, res) => {
  const { cat, poe, mp, night, popular, min, max, q, sort } = req.query;
  let rows = db.prepare('SELECT * FROM products WHERE active = 1').all().map(parseProduct);

  if (popular === '1' || popular === 'true') rows = rows.filter(p => p.is_popular);
  if (cat && cat !== 'Hammasi') rows = rows.filter(p => p.cat === cat);
  if (poe === '1') rows = rows.filter(p => p.poe);
  if (mp === '1') rows = rows.filter(p => p.mp);
  if (night === '1') rows = rows.filter(p => p.night);
  if (min) rows = rows.filter(p => p.price >= +min);
  if (max) rows = rows.filter(p => p.price <= +max);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    rows = rows.filter(p =>
      `${p.name} ${p.spec} ${p.tags.join(' ')} ${p.sku} ${p.cat}`.toLowerCase().includes(needle));
  }
  if (sort === 'price-asc') rows.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') rows.sort((a, b) => b.price - a.price);
  else if (sort === 'new') rows.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));

  res.json(rows);
});

publicRouter.get('/products/:sku', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE sku = ? AND active = 1').get(req.params.sku);
  if (!row) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  res.json(parseProduct(row));
});

publicRouter.get('/categories', (_req, res) => {
  const cats = db.prepare(`
    SELECT c.name, c.mark, COUNT(p.sku) AS count
    FROM categories c LEFT JOIN products p ON p.cat = c.name AND p.active = 1
    GROUP BY c.name ORDER BY c.sort`).all();
  res.json(cats);
});

publicRouter.get('/banners', (_req, res) => {
  res.json(db.prepare('SELECT * FROM banners WHERE active = 1 ORDER BY sort').all());
});

// ── "Ishlarimiz" videolari: layk va izohlar ──
// Mijoz akkauntsiz — qurilma localStorage'dagi tasodifiy `cid` bilan tanib olinadi.
const normCid = (v) => { const s = String(v || ''); return /^[A-Za-z0-9-]{8,64}$/.test(s) ? s : ''; };
const cleanText = (v, max) => String(v || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const commentAttempts = new Map();

publicRouter.get('/stories', (req, res) => {
  const cid = normCid(req.query.cid);
  const likes = Object.fromEntries(db.prepare('SELECT story_id, COUNT(*) AS n FROM story_likes GROUP BY story_id').all().map(r => [r.story_id, r.n]));
  const comments = Object.fromEntries(db.prepare('SELECT story_id, COUNT(*) AS n FROM story_comments WHERE hidden = 0 GROUP BY story_id').all().map(r => [r.story_id, r.n]));
  const mine = cid ? new Set(db.prepare('SELECT story_id FROM story_likes WHERE client_id = ?').all(cid).map(r => r.story_id)) : new Set();
  const rows = db.prepare('SELECT * FROM stories ORDER BY sort').all()
    .map(s => ({ ...s, tags: JSON.parse(s.tags), live: !!s.live, likes: likes[s.id] || 0, comments: comments[s.id] || 0, liked: mine.has(s.id) }));
  res.json(rows);
});

// POST /api/stories/:id/like — { cid, like?: boolean } → { liked, likes }
publicRouter.post('/stories/:id/like', (req, res) => {
  const cid = normCid(req.body?.cid);
  if (!cid) return res.status(400).json({ error: 'cid kerak' });
  const story = db.prepare('SELECT id FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Video topilmadi' });
  const has = !!db.prepare('SELECT 1 FROM story_likes WHERE story_id = ? AND client_id = ?').get(story.id, cid);
  const want = typeof req.body.like === 'boolean' ? req.body.like : !has;
  if (want && !has) db.prepare('INSERT INTO story_likes (story_id, client_id) VALUES (?, ?)').run(story.id, cid);
  if (!want && has) db.prepare('DELETE FROM story_likes WHERE story_id = ? AND client_id = ?').run(story.id, cid);
  const likes = db.prepare('SELECT COUNT(*) AS n FROM story_likes WHERE story_id = ?').get(story.id).n;
  res.json({ liked: want, likes });
});

// GET /api/stories/:id/comments?cid= — ko'rinadigan izohlar (yangilari yuqorida)
publicRouter.get('/stories/:id/comments', (req, res) => {
  const cid = normCid(req.query.cid);
  const rows = db.prepare('SELECT id, client_id, name, text, created_at FROM story_comments WHERE story_id = ? AND hidden = 0 ORDER BY id DESC LIMIT 200').all(req.params.id)
    .map(({ client_id, ...c }) => ({ ...c, mine: !!cid && client_id === cid }));
  res.json(rows);
});

// POST /api/stories/:id/comments — { cid, name, text }
publicRouter.post('/stories/:id/comments', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'local';
  const now = Date.now();
  const rec = commentAttempts.get(ip) || { n: 0, resetAt: now + 600000 };
  if (now > rec.resetAt) { rec.n = 0; rec.resetAt = now + 600000; }
  if (rec.n >= 10) return res.status(429).json({ error: 'Juda ko‘p izoh — birozdan keyin qayta yozing' });

  const b = req.body || {};
  const cid = normCid(b.cid);
  const name = cleanText(b.name, 40).replace(/\s+/g, ' ');
  const text = cleanText(b.text, 500);
  if (!cid) return res.status(400).json({ error: 'cid kerak' });
  if (name.length < 2) return res.status(400).json({ error: 'Ismingizni yozing' });
  if (text.length < 2) return res.status(400).json({ error: 'Izoh juda qisqa' });
  const story = db.prepare('SELECT id FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Video topilmadi' });

  rec.n++; commentAttempts.set(ip, rec);
  const r = db.prepare('INSERT INTO story_comments (story_id, client_id, name, text) VALUES (?, ?, ?, ?)').run(story.id, cid, name, text);
  const c = db.prepare('SELECT id, name, text, created_at FROM story_comments WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json({ ...c, mine: true });
});

// DELETE /api/stories/comments/:cmt?cid= — mijoz faqat o'z izohini o'chiradi
publicRouter.delete('/stories/comments/:cmt', (req, res) => {
  const cid = normCid(req.query.cid);
  const r = cid ? db.prepare('DELETE FROM story_comments WHERE id = ? AND client_id = ?').run(+req.params.cmt, cid) : { changes: 0 };
  if (!r.changes) return res.status(404).json({ error: 'Izoh topilmadi' });
  res.json({ ok: true });
});

publicRouter.get('/regions', (_req, res) => {
  res.json(db.prepare('SELECT * FROM regions ORDER BY sort').all());
});

// Biznes sozlamalari: kredit stavkalari, modul flaglari, kalkulyator narxlari
publicRouter.get('/config', (_req, res) => {
  const pricing = { ...(getSetting('pricing') || {}) };
  // xotira variantlarining tannarxi ($) va usta narxi mijozga berilmaydi
  if (Array.isArray(pricing.hddOptions)) pricing.hddOptions = pricing.hddOptions.map(({ usd, priceUsta, ...o }) => o);
  res.json({
    pricing,
    credit: getSetting('credit'),
    modules: getSetting('modules'),
    statusFlow: getSetting('statusFlow'),
  });
});

// POST /api/kit/calc — komplekt kalkulyatori
// body: { camSku, cams, cableMeters, hddSize, install, cloudMonths, region, extras: {sku: qty} }
publicRouter.post('/kit/calc', (req, res) => {
  const { camSku, cams = 4, cableMeters = 0, hddSize, install = false, cloud = false, region, extras = {} } = req.body || {};
  const pricing = getSetting('pricing');
  const cam = db.prepare('SELECT * FROM products WHERE sku = ?').get(camSku || 'IPC-2410');
  if (!cam) return res.status(400).json({ error: 'Kamera SKU noto\'g\'ri' });

  const nCams = Math.max(1, Math.min(64, +cams || 1));
  const lines = [];
  let total = 0;

  const camSum = cam.price * nCams;
  lines.push({ k: `${cam.name} × ${nCams}`, v: camSum });
  total += camSum;

  if (+cableMeters > 0) {
    const c = Math.round(+cableMeters * pricing.cablePerMeter);
    lines.push({ k: `UTP kabel ${+cableMeters} m`, v: c });
    total += c;
  }
  if (hddSize) {
    const hdd = pricing.hddOptions.find(h => h.size === hddSize);
    if (hdd) { lines.push({ k: `Xotira ${hdd.size}`, v: hdd.price }); total += hdd.price; }
  }
  for (const [sku, qty] of Object.entries(extras)) {
    const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
    if (p && +qty > 0) { const s = p.price * +qty; lines.push({ k: `${p.name} × ${+qty}`, v: s }); total += s; }
  }
  if (install) {
    const s = nCams * pricing.installPerCamera;
    lines.push({ k: 'O\'rnatish xizmati', v: s });
    total += s;
  }
  if (cloud) {
    const s = nCams * pricing.cloudPerCameraMonth * 12;
    lines.push({ k: 'Bulut arxiv 12 oy', v: s });
    total += s;
  }
  const reg = region ? db.prepare('SELECT * FROM regions WHERE name = ?').get(region) : null;
  const ship = reg ? reg.price : 0;
  lines.push({ k: `Yetkazish · ${reg ? reg.name : 'Qarshi shahri'}`, v: ship });
  total += ship;

  // Muddatli to'lov variantlari
  const credit = getSetting('credit');
  const creditOptions = Object.entries(credit.rates).map(([months, rate]) => {
    const downPct = credit.down[months] ?? 0;
    const downSum = Math.round(total * downPct / 100);
    const withMarkup = Math.round((total - downSum) * (1 + rate / 100));
    return { months: +months, ratePct: rate, downPct, downSum, monthly: Math.round(withMarkup / +months), total: withMarkup + downSum };
  });

  res.json({ lines, total, creditOptions });
});

// ── Usta sifatida ro'yxatdan o'tish ──
// Tasdiq uchun mijoz oldin o'rnatgan kameralaridan 1–6 ta rasm yuboradi, admin ko'rib chiqadi.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ustaDir = path.join(__dirname, '..', '..', 'assets', 'ustas');
const USTA_MAX_PHOTOS = 6;
const USTA_MAX_BYTES = 4 * 1024 * 1024;
const ustaAttempts = new Map();
const normPhone = (v) => String(v || '').replace(/[^0-9]/g, '').slice(-9);

function saveUstaPhoto(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Rasm formati JPG, PNG yoki WEBP bo‘lishi kerak');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > USTA_MAX_BYTES) throw new Error('Har bir rasm 4 MB dan oshmasligi kerak');
  fs.mkdirSync(ustaDir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(ustaDir, name), buf);
  return `/assets/ustas/${name}`;
}

// POST /api/ustas — { name, phone, region?, experience?, note?, photos: [dataUrl, ...] }
publicRouter.post('/ustas', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'local';
  const now = Date.now();
  const rec = ustaAttempts.get(ip) || { n: 0, resetAt: now + 3600000 };
  if (now > rec.resetAt) { rec.n = 0; rec.resetAt = now + 3600000; }
  if (rec.n >= 5) return res.status(429).json({ error: 'Juda ko‘p ariza — 1 soatdan keyin qayta urinib ko‘ring' });

  const b = req.body || {};
  const phone = normPhone(b.phone);
  const name = String(b.name || '').trim();
  const photos = Array.isArray(b.photos) ? b.photos : [];
  if (phone.length !== 9) return res.status(400).json({ error: 'Telefon raqami 9 raqamdan iborat bo‘lishi kerak' });
  if (name.length < 3) return res.status(400).json({ error: 'Ism-familiyangizni to‘liq yozing' });
  if (photos.length < 1) return res.status(400).json({ error: 'Tasdiq uchun kamida 1 ta o‘rnatgan kamerangiz rasmini yuklang' });
  if (photos.length > USTA_MAX_PHOTOS) return res.status(400).json({ error: `Ko‘pi bilan ${USTA_MAX_PHOTOS} ta rasm yuklash mumkin` });

  const prev = db.prepare('SELECT * FROM ustas WHERE phone = ?').get(phone);
  if (prev && prev.status === 'Tasdiqlangan') return res.status(409).json({ error: 'Bu raqam allaqachon usta sifatida tasdiqlangan' });
  if (prev && prev.status === 'Kutilmoqda') return res.status(409).json({ error: 'Arizangiz ko‘rib chiqilmoqda — admin tez orada javob beradi' });

  let saved;
  try { saved = photos.map(saveUstaPhoto); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  rec.n++; ustaAttempts.set(ip, rec);

  const fields = [name, String(b.region || '').slice(0, 80), String(b.experience || '').slice(0, 80), String(b.note || '').slice(0, 500), JSON.stringify(saved)];
  if (prev) {
    // Rad etilgan ariza qayta yuboriladi
    db.prepare("UPDATE ustas SET name=?, region=?, experience=?, note=?, photos=?, status='Kutilmoqda', admin_note='', created_at=datetime('now'), reviewed_at=NULL WHERE id=?")
      .run(...fields, prev.id);
  } else {
    db.prepare('INSERT INTO ustas (name, region, experience, note, photos, phone) VALUES (?,?,?,?,?,?)').run(...fields, phone);
  }
  res.status(201).json({ status: 'Kutilmoqda', message: 'Ariza qabul qilindi — admin rasmlarni ko‘rib chiqib tasdiqlaydi' });
});

// GET /api/ustas/status?phone=901234567 — ariza holati; tasdiqlangan ustaga usta narxlari
publicRouter.get('/ustas/status', (req, res) => {
  const phone = normPhone(req.query.phone);
  if (phone.length !== 9) return res.status(400).json({ error: 'phone parametri kerak' });
  const u = db.prepare('SELECT name, status, admin_note, reviewed_at FROM ustas WHERE phone = ?').get(phone);
  if (!u) return res.json({ status: null });
  const out = { status: u.status, name: u.name, admin_note: u.admin_note || '', reviewed_at: u.reviewed_at };
  if (u.status === 'Tasdiqlangan') {
    const prices = {};
    for (const p of db.prepare('SELECT sku, price_usta FROM products WHERE active = 1 AND price_usta > 0').all()) prices[p.sku] = p.price_usta;
    const pricing = getSetting('pricing') || {};
    for (const o of (pricing.hddOptions || [])) if (o.sku && o.priceUsta > 0) prices[o.sku] = o.priceUsta;
    out.prices = prices;
    out.margin = (getSetting('margins') || {}).usta ?? 12;
  }
  res.json(out);
});
