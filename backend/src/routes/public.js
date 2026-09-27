import { db, getSetting, nowStr } from '../db.js';
import { asyncRouter, parseDataUrl, saveUpload } from '../uploads.js';

export const publicRouter = asyncRouter();

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
publicRouter.get('/products', async (req, res) => {
  const { cat, poe, mp, night, popular, min, max, q, sort } = req.query;
  let rows = (await db.all('SELECT * FROM products WHERE active = 1')).map(parseProduct);

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

publicRouter.get('/products/:sku', async (req, res) => {
  const row = await db.get('SELECT * FROM products WHERE sku = ? AND active = 1', req.params.sku);
  if (!row) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  res.json(parseProduct(row));
});

publicRouter.get('/categories', async (_req, res) => {
  const cats = await db.all(`
    SELECT c.name, c.mark, COUNT(p.sku) AS count
    FROM categories c LEFT JOIN products p ON p.cat = c.name AND p.active = 1
    GROUP BY c.name, c.mark, c.sort ORDER BY c.sort`);
  res.json(cats);
});

publicRouter.get('/banners', async (_req, res) => {
  res.json(await db.all('SELECT * FROM banners WHERE active = 1 ORDER BY sort'));
});

// ── "Ishlarimiz" videolari: layk va izohlar ──
// Mijoz akkauntsiz — qurilma localStorage'dagi tasodifiy `cid` bilan tanib olinadi.
const normCid = (v) => { const s = String(v || ''); return /^[A-Za-z0-9-]{8,64}$/.test(s) ? s : ''; };
const cleanText = (v, max) => String(v || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const commentAttempts = new Map();

publicRouter.get('/stories', async (req, res) => {
  const cid = normCid(req.query.cid);
  const likes = Object.fromEntries((await db.all('SELECT story_id, COUNT(*) AS n FROM story_likes GROUP BY story_id')).map(r => [r.story_id, r.n]));
  const comments = Object.fromEntries((await db.all('SELECT story_id, COUNT(*) AS n FROM story_comments WHERE hidden = 0 GROUP BY story_id')).map(r => [r.story_id, r.n]));
  const mine = cid ? new Set((await db.all('SELECT story_id FROM story_likes WHERE client_id = ?', cid)).map(r => r.story_id)) : new Set();
  const rows = (await db.all('SELECT * FROM stories ORDER BY sort'))
    .map(s => ({ ...s, tags: JSON.parse(s.tags), live: !!s.live, likes: likes[s.id] || 0, comments: comments[s.id] || 0, liked: mine.has(s.id) }));
  res.json(rows);
});

// POST /api/stories/:id/like — { cid, like?: boolean } → { liked, likes }
publicRouter.post('/stories/:id/like', async (req, res) => {
  const cid = normCid(req.body?.cid);
  if (!cid) return res.status(400).json({ error: 'cid kerak' });
  const story = await db.get('SELECT id FROM stories WHERE id = ?', req.params.id);
  if (!story) return res.status(404).json({ error: 'Video topilmadi' });
  const has = !!(await db.get('SELECT 1 AS x FROM story_likes WHERE story_id = ? AND client_id = ?', story.id, cid));
  const want = typeof req.body.like === 'boolean' ? req.body.like : !has;
  if (want && !has) await db.run('INSERT INTO story_likes (story_id, client_id) VALUES (?, ?) ON CONFLICT DO NOTHING', story.id, cid);
  if (!want && has) await db.run('DELETE FROM story_likes WHERE story_id = ? AND client_id = ?', story.id, cid);
  const likes = (await db.get('SELECT COUNT(*) AS n FROM story_likes WHERE story_id = ?', story.id)).n;
  res.json({ liked: want, likes });
});

// GET /api/stories/:id/comments?cid= — ko'rinadigan izohlar (yangilari yuqorida)
publicRouter.get('/stories/:id/comments', async (req, res) => {
  const cid = normCid(req.query.cid);
  const rows = (await db.all('SELECT id, client_id, name, text, created_at FROM story_comments WHERE story_id = ? AND hidden = 0 ORDER BY id DESC LIMIT 200', req.params.id))
    .map(({ client_id, ...c }) => ({ ...c, mine: !!cid && client_id === cid }));
  res.json(rows);
});

// POST /api/stories/:id/comments — { cid, name, text }
publicRouter.post('/stories/:id/comments', async (req, res) => {
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
  const story = await db.get('SELECT id FROM stories WHERE id = ?', req.params.id);
  if (!story) return res.status(404).json({ error: 'Video topilmadi' });

  rec.n++; commentAttempts.set(ip, rec);
  const c = await db.get('INSERT INTO story_comments (story_id, client_id, name, text) VALUES (?, ?, ?, ?) RETURNING id, name, text, created_at', story.id, cid, name, text);
  res.status(201).json({ ...c, mine: true });
});

// DELETE /api/stories/comments/:cmt?cid= — mijoz faqat o'z izohini o'chiradi
publicRouter.delete('/stories/comments/:cmt', async (req, res) => {
  const cid = normCid(req.query.cid);
  const id = parseInt(req.params.cmt, 10);
  const r = cid && Number.isInteger(id) ? await db.run('DELETE FROM story_comments WHERE id = ? AND client_id = ?', id, cid) : { changes: 0 };
  if (!r.changes) return res.status(404).json({ error: 'Izoh topilmadi' });
  res.json({ ok: true });
});

publicRouter.get('/regions', async (_req, res) => {
  res.json(await db.all('SELECT * FROM regions ORDER BY sort'));
});

// Biznes sozlamalari: kredit stavkalari, modul flaglari, kalkulyator narxlari
publicRouter.get('/config', async (_req, res) => {
  const pricing = { ...((await getSetting('pricing')) || {}) };
  // xotira variantlarining tannarxi ($) va usta narxi mijozga berilmaydi
  if (Array.isArray(pricing.hddOptions)) pricing.hddOptions = pricing.hddOptions.map(({ usd, priceUsta, ...o }) => o);
  res.json({
    pricing,
    credit: await getSetting('credit'),
    modules: await getSetting('modules'),
    statusFlow: await getSetting('statusFlow'),
  });
});

// POST /api/kit/calc — komplekt kalkulyatori
// body: { camSku, cams, cableMeters, hddSize, install, cloudMonths, region, extras: {sku: qty} }
publicRouter.post('/kit/calc', async (req, res) => {
  const { camSku, cams = 4, cableMeters = 0, hddSize, install = false, cloud = false, region, extras = {} } = req.body || {};
  const pricing = await getSetting('pricing');
  const cam = await db.get('SELECT * FROM products WHERE sku = ?', String(camSku || 'IPC-2410'));
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
  for (const [sku, qty] of Object.entries(extras || {})) {
    const p = await db.get('SELECT * FROM products WHERE sku = ?', String(sku));
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
  const reg = region ? await db.get('SELECT * FROM regions WHERE name = ?', String(region)) : null;
  const ship = reg ? reg.price : 0;
  lines.push({ k: `Yetkazish · ${reg ? reg.name : 'Qarshi shahri'}`, v: ship });
  total += ship;

  // Muddatli to'lov variantlari
  const credit = await getSetting('credit');
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
// Rasmlar bazada saqlanadi (/assets/ustas/<nom>).
const USTA_MAX_PHOTOS = 6;
const ustaAttempts = new Map();
const normPhone = (v) => String(v || '').replace(/[^0-9]/g, '').slice(-9);

// POST /api/ustas — { name, phone, region?, experience?, note?, photos: [dataUrl, ...] }
publicRouter.post('/ustas', async (req, res) => {
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

  const prev = await db.get('SELECT * FROM ustas WHERE phone = ?', phone);
  if (prev && prev.status === 'Tasdiqlangan') return res.status(409).json({ error: 'Bu raqam allaqachon usta sifatida tasdiqlangan' });
  if (prev && prev.status === 'Kutilmoqda') return res.status(409).json({ error: 'Arizangiz ko‘rib chiqilmoqda — admin tez orada javob beradi' });

  let parsed;
  try { parsed = photos.map(p => parseDataUrl(p)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  rec.n++; ustaAttempts.set(ip, rec);

  await db.tx(async () => {
    const saved = [];
    for (const { buf, ext } of parsed) saved.push(await saveUpload('ustas', buf, ext));
    const fields = [name, String(b.region || '').slice(0, 80), String(b.experience || '').slice(0, 80), String(b.note || '').slice(0, 500), JSON.stringify(saved)];
    if (prev) {
      // Rad etilgan ariza qayta yuboriladi
      await db.run("UPDATE ustas SET name=?, region=?, experience=?, note=?, photos=?, status='Kutilmoqda', admin_note='', created_at=?, reviewed_at=NULL WHERE id=?",
        ...fields, nowStr(), prev.id);
    } else {
      await db.run('INSERT INTO ustas (name, region, experience, note, photos, phone) VALUES (?,?,?,?,?,?)', ...fields, phone);
    }
  });
  res.status(201).json({ status: 'Kutilmoqda', message: 'Ariza qabul qilindi — admin rasmlarni ko‘rib chiqib tasdiqlaydi' });
});

// GET /api/ustas/status?phone=901234567 — ariza holati; tasdiqlangan ustaga usta narxlari
publicRouter.get('/ustas/status', async (req, res) => {
  const phone = normPhone(req.query.phone);
  if (phone.length !== 9) return res.status(400).json({ error: 'phone parametri kerak' });
  const u = await db.get('SELECT name, status, admin_note, reviewed_at FROM ustas WHERE phone = ?', phone);
  if (!u) return res.json({ status: null });
  const out = { status: u.status, name: u.name, admin_note: u.admin_note || '', reviewed_at: u.reviewed_at };
  if (u.status === 'Tasdiqlangan') {
    const prices = {};
    for (const p of await db.all('SELECT sku, price_usta FROM products WHERE active = 1 AND price_usta > 0')) prices[p.sku] = p.price_usta;
    const pricing = (await getSetting('pricing')) || {};
    for (const o of (pricing.hddOptions || [])) if (o.sku && o.priceUsta > 0) prices[o.sku] = o.priceUsta;
    out.prices = prices;
    out.margin = ((await getSetting('margins')) || {}).usta ?? 12;
  }
  res.json(out);
});
