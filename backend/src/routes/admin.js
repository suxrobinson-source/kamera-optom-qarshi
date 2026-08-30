import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { login, requireAdmin } from '../auth.js';

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
    return res.status(401).json({ error: 'Login yoki parol noto’g’ri' });
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
  if (![...flow, 'Bekor'].includes(next)) return res.status(400).json({ error: `Status noto’g’ri. Ruxsat: ${flow.join(' → ')} yoki Bekor` });

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
  res.json(db.prepare('SELECT sku, name, cat, price, qty, promo, active FROM products ORDER BY cat, name').all()
    .map(p => ({ ...p, active: !!p.active, low: p.qty < 10 })));
});

// PATCH /api/admin/products/:sku  body: { price?, qty?, promo?, active? }
adminRouter.patch('/products/:sku', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  const b = req.body || {};
  db.prepare('UPDATE products SET price = ?, qty = ?, promo = ?, active = ? WHERE sku = ?').run(
    Number.isFinite(+b.price) && b.price != null ? Math.max(0, Math.round(+b.price)) : p.price,
    Number.isFinite(+b.qty) && b.qty != null ? Math.max(0, Math.round(+b.qty)) : p.qty,
    b.promo === undefined ? p.promo : (b.promo || null),
    b.active === undefined ? p.active : (b.active ? 1 : 0),
    p.sku,
  );
  res.json(db.prepare('SELECT * FROM products WHERE sku = ?').get(p.sku));
});

// POST /api/admin/products — yangi mahsulot
adminRouter.post('/products', (req, res) => {
  const b = req.body || {};
  if (!b.sku || !b.name || !b.cat || !+b.price) return res.status(400).json({ error: 'sku, name, cat, price majburiy' });
  if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(b.sku)) return res.status(409).json({ error: 'Bu SKU allaqachon mavjud' });
  db.prepare(`INSERT INTO products (sku,name,cat,price,badge,spec,tags,specs,poe,mp,night,spin,qty,promo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    String(b.sku), String(b.name), String(b.cat), Math.round(+b.price),
    String(b.badge || ''), String(b.spec || ''),
    JSON.stringify(b.tags || []), JSON.stringify(b.specs || []),
    b.poe ? 1 : 0, b.mp ? 1 : 0, b.night ? 1 : 0, b.spin ? 1 : 0,
    Math.max(0, +b.qty || 0), b.promo || null,
  );
  res.status(201).json(db.prepare('SELECT * FROM products WHERE sku = ?').get(b.sku));
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
  res.json({
    todayOrders: today.n,
    todayRevenue: today.sum,
    openOrders: open,
    installing,
    lowStock,
    newCallbacks,
  });
});

// Sozlamalar (kredit, narxlar, modullar)
adminRouter.get('/settings', (_req, res) => {
  res.json({ pricing: getSetting('pricing'), credit: getSetting('credit'), modules: getSetting('modules') });
});
adminRouter.patch('/settings/:key', (req, res) => {
  const key = req.params.key;
  if (!['pricing', 'credit', 'modules'].includes(key)) return res.status(400).json({ error: 'Faqat pricing, credit, modules o’zgartiriladi' });
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
  const rows = db.prepare('SELECT * FROM stories ORDER BY sort').all()
    .map(s => ({ ...s, tags: JSON.parse(s.tags || '[]'), live: !!s.live }));
  res.json(rows);
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
  res.json({ ok: true });
});

