import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting } from '../db.js';
import { login, requireAdmin } from '../auth.js';
import { getCurrency, parseRate, parsePct, computeProduct, planPricing, summarize, applyPricing, fetchCbuRate, ROUNDING_STEPS } from '../currency.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'assets', 'products');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const adminRouter = Router();

const loginAttempts = new Map();

adminRouter.post('/login', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, resetAt: now + 60000 };

  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + 60000;
  }

  if (rec.count >= 10) {
    return res.status(429).json({ error: 'Ko\'p urinish bo\'ldi — 1 daqiqadan so\'ng qayta urinib ko\'ring' });
  }

  const { username, password } = req.body || {};
  const result = login(username, password);
  if (!result) {
    rec.count++;
    loginAttempts.set(ip, rec);
    return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
  }

  loginAttempts.delete(ip);
  res.json(result);
});

adminRouter.use(requireAdmin);

const parseOrder = (row) => ({ ...row, items: JSON.parse(row.items), install: !!row.install, cloud: !!row.cloud });

// GET /api/admin/orders?status=Yangi&q=...
adminRouter.get('/orders', (req, res) => {
  let rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map(parseOrder);
  if (req.query.status) rows = rows.filter(o => o.status === req.query.status);
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    rows = rows.filter(o => `${o.id} ${o.client_name} ${o.phone} ${o.region}`.toLowerCase().includes(q));
  }
  res.json(rows);
});

// PATCH /api/admin/orders/:id/status  body: { status? } — status berilmasa keyingi bosqichga o'tadi
adminRouter.patch('/orders/:id/status', (req, res) => {
  const id = `#${String(req.params.id).replace(/^#/, '')}`;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });

  const flow = getSetting('statusFlow');
  let next = req.body?.status;
  if (!next) {
    const i = flow.indexOf(order.status);
    next = flow[(i + 1) % flow.length]; // Yopildi → Yangi (prototipdagi kabi aylanadi)
  }
  if (![...flow, 'Bekor'].includes(next)) return res.status(400).json({ error: `Status noto'g'ri. Ruxsat: ${flow.join(' → ')} yoki Bekor` });

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(next, id);
  db.prepare('INSERT INTO order_events (order_id, status) VALUES (?, ?)').run(id, next);

  // Bekor qilinganda ombor qoldig'i qaytariladi
  if (next === 'Bekor' && order.status !== 'Bekor') {
    const inc = db.prepare('UPDATE products SET qty = qty + ? WHERE sku = ?');
    for (const it of JSON.parse(order.items)) inc.run(it.qty, it.sku);
  }
  res.json(parseOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)));
});

// PATCH /api/admin/orders/:id  body: { note?, install_at? }
adminRouter.patch('/orders/:id', (req, res) => {
  const id = `#${String(req.params.id).replace(/^#/, '')}`;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  const note = req.body?.note ?? order.note;
  const installAt = req.body?.install_at ?? order.install_at;
  db.prepare('UPDATE orders SET note = ?, install_at = ? WHERE id = ?').run(String(note), installAt, id);
  res.json(parseOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)));
});

// O'rnatish jadvali — o'rnatish xizmati bor, hali yopilmagan buyurtmalar
adminRouter.get('/schedule', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM orders WHERE install = 1 AND status NOT IN ('Yopildi','Bekor')
    ORDER BY COALESCE(install_at, created_at)`).all();
  res.json(rows.map(parseOrder));
});

// Ombor
adminRouter.get('/stock', (_req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY cat, name').all()
    .map(p => {
      let images = [];
      if (p.images) {
        try { images = JSON.parse(p.images); } catch (e) { }
      }
      return {
        ...p,
        images: Array.isArray(images) ? images : [],
        active: !!p.active,
        is_popular: !!p.is_popular,
        low: (p.qty ?? 0) < 10
      };
    }));
});

// POST /api/admin/products/:sku/toggle-popular — 1-klikda ommabop holatini almashtirish
adminRouter.post('/products/:sku/toggle-popular', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  const nextVal = p.is_popular ? 0 : 1;
  db.prepare('UPDATE products SET is_popular = ? WHERE sku = ?').run(nextVal, p.sku);
  const updated = db.prepare('SELECT * FROM products WHERE sku = ?').get(p.sku);
  if (updated && updated.images) {
    try { updated.images = JSON.parse(updated.images); } catch (e) { updated.images = []; }
  } else if (updated) {
    updated.images = [];
  }
  res.json({ ...updated, is_popular: !!updated.is_popular });
});

const parseImages = (row) => {
  if (!row) return row;
  let images = [];
  if (row.images) { try { images = JSON.parse(row.images); } catch (e) { } }
  return { ...row, images: Array.isArray(images) ? images : [], is_popular: !!row.is_popular };
};

/* Tannarx ($) va marjalarni so'rov tanasidan o'qish.
   Tannarx berilmasa-yu so'mdagi sotuv narxi berilsa — tannarx shu narxdan orqaga hisoblanadi. */
function readPricing(b, prev = {}) {
  const margin = b.margin !== undefined ? parsePct(b.margin) : (prev.margin ?? null);
  const marginUsta = b.margin_usta !== undefined ? parsePct(b.margin_usta) : (prev.margin_usta ?? null);
  if (margin === undefined || marginUsta === undefined) return { error: "Marja 0–300 % oralig'ida bo'lishi kerak" };
  const cur = getCurrency();
  let cost = prev.price_usd ?? null;
  if (b.price_usd !== undefined && b.price_usd !== null && String(b.price_usd).trim() !== '') {
    const c = Number(String(b.price_usd).replace(',', '.'));
    if (!(c > 0)) return { error: "Tannarx ($) musbat son bo'lishi kerak" };
    cost = Math.round(c * 10000) / 10000;
  } else if (b.price != null && Number.isFinite(+b.price) && +b.price > 0 && Math.round(+b.price) !== prev.price && cur.usdRate > 0) {
    cost = Math.round(+b.price / cur.usdRate / (1 + (margin ?? cur.margins.default) / 100) * 10000) / 10000;
  }
  const calc = computeProduct({ price_usd: cost, margin, margin_usta: marginUsta }, cur);
  const price = calc ? calc.price : (+b.price > 0 ? Math.round(+b.price) : (prev.price ?? 0));
  return { cost, margin, marginUsta, price, priceUsta: calc ? calc.price_usta : (prev.price_usta ?? null) };
}

// PATCH /api/admin/products/:sku — { price_usd?, margin?, margin_usta?, price?, ... }
adminRouter.patch('/products/:sku', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  const b = req.body || {};
  const pr = readPricing(b, p);
  if (pr.error) return res.status(400).json({ error: pr.error });
  db.prepare(`UPDATE products SET
    name = ?, cat = ?, spec = ?, badge = ?,
    price = ?, price_usd = ?, margin = ?, margin_usta = ?, price_usta = ?,
    qty = ?, promo = ?, is_popular = ?, active = ?
    WHERE sku = ?`).run(
    b.name !== undefined ? String(b.name) : p.name,
    b.cat !== undefined ? String(b.cat) : p.cat,
    b.spec !== undefined ? String(b.spec) : p.spec,
    b.badge !== undefined ? String(b.badge) : p.badge,
    pr.price, pr.cost, pr.margin, pr.marginUsta, pr.priceUsta,
    Number.isFinite(+b.qty) && b.qty != null ? Math.max(0, Math.round(+b.qty)) : p.qty,
    b.promo === undefined ? p.promo : (b.promo || null),
    b.is_popular !== undefined ? (b.is_popular ? 1 : 0) : (p.is_popular ? 1 : 0),
    b.active === undefined ? p.active : (b.active ? 1 : 0),
    p.sku,
  );
  res.json(parseImages(db.prepare('SELECT * FROM products WHERE sku = ?').get(p.sku)));
});

// POST /api/admin/products — yangi mahsulot (tannarx $ + marja yoki so'mdagi narx)
adminRouter.post('/products', (req, res) => {
  const b = req.body || {};
  if (!b.sku || !b.name || !b.cat) return res.status(400).json({ error: 'sku, name, cat majburiy' });
  const sku = String(b.sku).toUpperCase().trim();
  if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku)) return res.status(409).json({ error: 'Bu SKU allaqachon mavjud' });
  const pr = readPricing(b, {});
  if (pr.error) return res.status(400).json({ error: pr.error });
  if (!(pr.price > 0)) return res.status(400).json({ error: "Tannarx ($) yoki sotuv narxi (so'm) majburiy" });
  db.prepare(`INSERT INTO products (sku,name,cat,price,price_usd,margin,margin_usta,price_usta,badge,spec,tags,specs,poe,mp,night,spin,qty,promo,is_popular,images)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    sku, String(b.name).trim(), String(b.cat).trim(), pr.price, pr.cost, pr.margin, pr.marginUsta, pr.priceUsta,
    String(b.badge || ''), String(b.spec || ''),
    JSON.stringify(b.tags || []), JSON.stringify(b.specs || []),
    b.poe ? 1 : 0, b.mp ? 1 : 0, b.night ? 1 : 0, b.spin ? 1 : 0,
    Math.max(0, +b.qty || 0), b.promo || null,
    b.is_popular ? 1 : 0,
    JSON.stringify(b.images || [])
  );
  res.status(201).json(parseImages(db.prepare('SELECT * FROM products WHERE sku = ?').get(sku)));
});

// ── Dollar kursi va marjalar ──
function readPricingOpts(b) {
  const out = {};
  if (b.usdRate !== undefined) {
    const r = parseRate(b.usdRate);
    if (!r) return { error: "Kurs 100 dan 1 000 000 so'mgacha bo'lishi kerak" };
    out.usdRate = r;
  }
  if (b.rounding !== undefined) {
    if (!ROUNDING_STEPS.includes(+b.rounding)) return { error: 'Yaxlitlash: ' + ROUNDING_STEPS.join(', ') };
    out.rounding = +b.rounding;
  }
  if (b.margins) {
    const m = {};
    for (const k of ['default', 'usta']) {
      if (b.margins[k] === undefined) continue;
      const v = parsePct(b.margins[k]);
      if (v === undefined || v === null) return { error: "Marja 0–300 % oralig'ida bo'lishi kerak" };
      m[k] = v;
    }
    out.margins = m;
  }
  return out;
}

adminRouter.get('/currency', (_req, res) => {
  const c = db.prepare(`SELECT COUNT(*) AS n,
    SUM(CASE WHEN price_usd > 0 THEN 1 ELSE 0 END) AS tracked,
    SUM(CASE WHEN margin IS NOT NULL OR margin_usta IS NOT NULL THEN 1 ELSE 0 END) AS custom
    FROM products`).get();
  res.json({ ...getCurrency(), roundingSteps: ROUNDING_STEPS, products: c.n, tracked: c.tracked || 0, custom: c.custom || 0 });
});

// POST /api/admin/currency/preview — { usdRate?, rounding?, margins? } → qancha narx o'zgarishi (yozmaydi)
adminRouter.post('/currency/preview', (req, res) => {
  const o = readPricingOpts(req.body || {});
  if (o.error) return res.status(400).json({ error: o.error });
  res.json(summarize(planPricing(o)));
});

// PUT /api/admin/currency — kurs/marjalarni qo'llash, barcha narxlar qayta hisoblanadi
adminRouter.put('/currency', (req, res) => {
  const o = readPricingOpts(req.body || {});
  if (o.error) return res.status(400).json({ error: o.error });
  if (!(o.usdRate || getCurrency().usdRate)) return res.status(400).json({ error: 'Avval dollar kursini kiriting' });
  const summary = applyPricing(o, req.admin?.username || '');
  res.json({ ...summary, currency: getCurrency() });
});

// GET /api/admin/currency/cbu — Markaziy bank rasmiy kursi (faqat taklif, avtomatik qo'llanmaydi)
adminRouter.get('/currency/cbu', async (_req, res) => {
  try { res.json(await fetchCbuRate()); }
  catch (e) { res.status(502).json({ error: "Markaziy bank kursini olib bo'lmadi: " + e.message }); }
});

// ── Usta arizalari ──
const USTA_STATUSES = ['Kutilmoqda', 'Tasdiqlangan', 'Rad etildi'];
const parseUsta = (u) => ({ ...u, photos: (() => { try { return JSON.parse(u.photos || '[]'); } catch (e) { return []; } })() });

adminRouter.get('/ustas', (_req, res) => {
  res.json(db.prepare(`SELECT * FROM ustas ORDER BY CASE status WHEN 'Kutilmoqda' THEN 0 WHEN 'Tasdiqlangan' THEN 1 ELSE 2 END, created_at DESC`).all().map(parseUsta));
});

// PATCH /api/admin/ustas/:id — { status, admin_note? }
adminRouter.patch('/ustas/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM ustas WHERE id = ?').get(+req.params.id);
  if (!u) return res.status(404).json({ error: 'Ariza topilmadi' });
  const status = String(req.body?.status || '');
  if (!USTA_STATUSES.includes(status)) return res.status(400).json({ error: 'Status: ' + USTA_STATUSES.join(', ') });
  db.prepare("UPDATE ustas SET status = ?, admin_note = ?, reviewed_at = datetime('now') WHERE id = ?")
    .run(status, String(req.body?.admin_note ?? u.admin_note ?? ''), u.id);
  res.json(parseUsta(db.prepare('SELECT * FROM ustas WHERE id = ?').get(u.id)));
});


// DELETE /api/admin/products/:sku — mahsulotni o'chirish
adminRouter.delete('/products/:sku', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  if (p.images) {
    try {
      const imgs = JSON.parse(p.images);
      if (Array.isArray(imgs)) {
        for (const imgPath of imgs) {
          if (imgPath && imgPath.startsWith('/assets/products/')) {
            const fp = path.join(__dirname, '..', '..', imgPath);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
          }
        }
      }
    } catch (e) { }
  }
  db.prepare('DELETE FROM products WHERE sku = ?').run(p.sku);
  res.json({ ok: true, sku: p.sku });
});

// POST /api/admin/products/:sku/images — base64 rasm yuklash
adminRouter.post('/products/:sku/images', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  const { dataUrl } = req.body || {};
  if (!dataUrl) return res.status(400).json({ error: 'dataUrl majburiy' });

  const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    return res.status(400).json({ error: 'Noto\'g\'ri rasm formati (base64 kutiladi)' });
  }

  const ext = (matches[1].split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const safeSku = p.sku.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const filename = `${safeSku}-${Date.now()}.${ext}`;
  const filePath = path.join(uploadsDir, filename);
  const buffer = Buffer.from(matches[2], 'base64');
  fs.writeFileSync(filePath, buffer);

  let currentImages = [];
  if (p.images) {
    try { currentImages = JSON.parse(p.images); } catch (e) { }
  }
  if (!Array.isArray(currentImages)) currentImages = [];
  const relPath = `/assets/products/${filename}`;
  currentImages.push(relPath);

  db.prepare('UPDATE products SET images = ? WHERE sku = ?').run(JSON.stringify(currentImages), p.sku);
  res.json({ ok: true, images: currentImages, image: relPath });
});

// DELETE /api/admin/products/:sku/images/:idx — rasmni o'chirish
adminRouter.delete('/products/:sku/images/:idx', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  let currentImages = [];
  if (p.images) {
    try { currentImages = JSON.parse(p.images); } catch (e) { }
  }
  if (!Array.isArray(currentImages)) currentImages = [];
  const idx = parseInt(req.params.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= currentImages.length) {
    return res.status(400).json({ error: 'Noto\'g\'ri rasm indeksi' });
  }
  const removed = currentImages.splice(idx, 1)[0];
  if (removed && removed.startsWith('/assets/products/')) {
    const fullPath = path.join(__dirname, '..', '..', removed);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (e) { }
    }
  }
  db.prepare('UPDATE products SET images = ? WHERE sku = ?').run(JSON.stringify(currentImages), p.sku);
  res.json({ ok: true, images: currentImages });
});

// Qo'ng'iroq so'rovlari
adminRouter.get('/callbacks', (_req, res) => {
  res.json(db.prepare('SELECT * FROM callbacks ORDER BY created_at DESC').all());
});
adminRouter.patch('/callbacks/:id', (req, res) => {
  const status = String(req.body?.status || 'Bajarildi');
  db.prepare('UPDATE callbacks SET status = ? WHERE id = ?').run(status, +req.params.id);
  res.json({ ok: true });
});

// KPI panel
adminRouter.get('/kpis', (_req, res) => {
  const today = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS sum FROM orders WHERE date(created_at) = date('now')").get();
  const open = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('Yangi','Tasdiqlandi')").get().n;
  const installing = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'O''rnatishda'").get().n;
  const lowStock = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND qty < 10').get().n;
  const newCallbacks = db.prepare("SELECT COUNT(*) AS n FROM callbacks WHERE status = 'Yangi'").get().n;
  const pendingUstas = db.prepare("SELECT COUNT(*) AS n FROM ustas WHERE status = 'Kutilmoqda'").get().n;
  res.json({
    todayOrders: today.n,
    todayRevenue: today.sum,
    openOrders: open,
    installing,
    lowStock,
    newCallbacks,
    pendingUstas,
  });
});

// Sozlamalar (kredit, narxlar, modullar)
adminRouter.get('/settings', (_req, res) => {
  res.json({ pricing: getSetting('pricing'), credit: getSetting('credit'), modules: getSetting('modules') });
});
adminRouter.patch('/settings/:key', (req, res) => {
  const key = req.params.key;
  if (!['pricing', 'credit', 'modules'].includes(key)) return res.status(400).json({ error: 'Faqat pricing, credit, modules o\'zgartiriladi' });
  const current = getSetting(key) || {};
  setSetting(key, { ...current, ...(req.body || {}) });
  res.json(getSetting(key));
});

// Bannerlar CRUD
adminRouter.get('/banners', (_req, res) => {
  res.json(db.prepare('SELECT * FROM banners ORDER BY sort').all());
});
adminRouter.post('/banners', (req, res) => {
  const b = req.body || {};
  if (!b.tag || !b.title) return res.status(400).json({ error: 'tag va title majburiy' });
  const info = db.prepare('INSERT INTO banners (tag,title,sub,cta,action,image,sort,active) VALUES (?,?,?,?,?,?,?,1)')
    .run(String(b.tag), String(b.title), String(b.sub || ''), String(b.cta || ''), String(b.action || ''), String(b.image || ''), +b.sort || 0);
  res.status(201).json(db.prepare('SELECT * FROM banners WHERE id = ?').get(info.lastInsertRowid));
});
adminRouter.patch('/banners/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM banners WHERE id = ?').get(+req.params.id);
  if (!row) return res.status(404).json({ error: 'Banner topilmadi' });
  const b = { ...row, ...(req.body || {}) };
  db.prepare('UPDATE banners SET tag=?,title=?,sub=?,cta=?,action=?,image=?,sort=?,active=? WHERE id=?')
    .run(String(b.tag), String(b.title), String(b.sub), String(b.cta), String(b.action), String(b.image), +b.sort || 0, b.active ? 1 : 0, row.id);
  res.json(db.prepare('SELECT * FROM banners WHERE id = ?').get(row.id));
});
adminRouter.delete('/banners/:id', (req, res) => {
  db.prepare('DELETE FROM banners WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

// Stories CRUD
adminRouter.get('/stories', (_req, res) => {
  const likes = Object.fromEntries(db.prepare('SELECT story_id, COUNT(*) AS n FROM story_likes GROUP BY story_id').all().map(r => [r.story_id, r.n]));
  const comments = Object.fromEntries(db.prepare('SELECT story_id, COUNT(*) AS n FROM story_comments GROUP BY story_id').all().map(r => [r.story_id, r.n]));
  const rows = db.prepare('SELECT * FROM stories ORDER BY sort').all()
    .map(s => ({ ...s, tags: JSON.parse(s.tags || '[]'), live: !!s.live, likes: likes[s.id] || 0, comments: comments[s.id] || 0 }));
  res.json(rows);
});

// "Ishlarimiz" izohlari: moderatsiya (yashirish / qayta ko'rsatish / o'chirish)
adminRouter.get('/story-comments', (_req, res) => {
  res.json(db.prepare(`SELECT c.id, c.story_id, c.name, c.text, c.hidden, c.created_at, s.label AS story_label
    FROM story_comments c LEFT JOIN stories s ON s.id = c.story_id ORDER BY c.id DESC LIMIT 500`).all()
    .map(c => ({ ...c, hidden: !!c.hidden })));
});
adminRouter.patch('/story-comments/:id', (req, res) => {
  const r = db.prepare('UPDATE story_comments SET hidden = ? WHERE id = ?').run(req.body?.hidden ? 1 : 0, +req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Izoh topilmadi' });
  res.json({ ok: true, hidden: !!req.body?.hidden });
});
adminRouter.delete('/story-comments/:id', (req, res) => {
  db.prepare('DELETE FROM story_comments WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});
adminRouter.post('/stories', (req, res) => {
  const b = req.body || {};
  const id = String(b.id || ('s' + Date.now()));
  db.prepare('INSERT INTO stories (id,label,mark,title,meta,dur,views,live,file,tags,text,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      id, String(b.label || ''), String(b.mark || ''), String(b.title || ''),
      String(b.meta || ''), String(b.dur || '0:30'), +b.views || 0,
      b.live ? 1 : 0, String(b.file || ''), JSON.stringify(b.tags || []),
      String(b.text || ''), +b.sort || 0
    );
  const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  res.status(201).json({ ...row, tags: JSON.parse(row.tags || '[]'), live: !!row.live });
});
adminRouter.patch('/stories/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Story topilmadi' });
  const b = { ...row, ...(req.body || {}) };
  db.prepare('UPDATE stories SET label=?,mark=?,title=?,meta=?,dur=?,views=?,live=?,file=?,tags=?,text=?,sort=? WHERE id=?')
    .run(
      String(b.label || ''), String(b.mark || ''), String(b.title || ''),
      String(b.meta || ''), String(b.dur || '0:30'), +b.views || 0,
      b.live ? 1 : 0, String(b.file || ''), JSON.stringify(Array.isArray(b.tags) ? b.tags : JSON.parse(b.tags || '[]')),
      String(b.text || ''), +b.sort || 0, row.id
    );
  const updated = db.prepare('SELECT * FROM stories WHERE id = ?').get(row.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags || '[]'), live: !!updated.live });
});
adminRouter.delete('/stories/:id', (req, res) => {
  db.prepare('DELETE FROM stories WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM story_likes WHERE story_id = ?').run(req.params.id);
  db.prepare('DELETE FROM story_comments WHERE story_id = ?').run(req.params.id);
  res.json({ ok: true });
});

