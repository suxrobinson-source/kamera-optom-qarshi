import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';

export const ordersRouter = Router();

const normPhone = (v) => String(v || '').replace(/[^0-9]/g, '').slice(-9);

const parseOrder = (row) => ({
  ...row,
  items: JSON.parse(row.items),
  install: !!row.install, cloud: !!row.cloud,
});

// POST /api/orders — buyurtma yaratish
// body: { phone, clientName?, region, address?, addrNote?, recipient?: {name, phone},
//         items: [{sku, qty}], install?, cloud? }
ordersRouter.post('/orders', (req, res) => {
  const b = req.body || {};
  const phone = normPhone(b.phone);
  if (phone.length !== 9) return res.status(400).json({ error: 'Telefon raqami 9 raqamdan iborat bo’lishi kerak (masalan 901234567)' });
  if (!Array.isArray(b.items) || b.items.length === 0) return res.status(400).json({ error: 'Savat bo’sh' });
  if (b.items.length > 50) return res.status(400).json({ error: 'Buyurtmada tovarlar soni 50 tadan oshmasligi kerak' });

  const pricing = getSetting('pricing');
  const getP = db.prepare('SELECT * FROM products WHERE sku = ? AND active = 1');

  // Tarkibni tekshirish va summani serverda hisoblash
  const items = [];
  let goodsSum = 0, cams = 0;
  for (const it of b.items) {
    let p = getP.get(String(it.sku || ''));
    if (!p && pricing && Array.isArray(pricing.hddOptions)) {
      const hdd = pricing.hddOptions.find(h => h.sku === it.sku || h.size === it.sku);
      if (hdd) {
        p = { sku: hdd.sku || it.sku, name: `microSD ${hdd.size} (${hdd.days})`, price: hdd.price, qty: 999, cat: 'Xotira' };
      }
    }
    const qty = Math.max(1, Math.min(999, +it.qty || 1));
    if (!p) return res.status(400).json({ error: `Mahsulot topilmadi: ${it.sku}` });
    if (p.qty < qty) return res.status(409).json({ error: `"${p.name}" omborda yetarli emas (qoldiq: ${p.qty})` });
    items.push({ sku: p.sku, name: p.name, price: p.price, qty });
    goodsSum += p.price * qty;
    if (['Tashqi', 'Ichki', 'Aylanuvchi'].includes(p.cat)) cams += qty;
    if (p.cat === 'Komplekt') cams += qty * 4;
  }

  const installPrice = b.install ? Math.max(1, cams) * pricing.installPerCamera : 0;
  const cloudPrice = b.cloud ? Math.max(1, cams) * pricing.cloudPerCameraMonth * 12 : 0;
  const reg = b.region ? db.prepare('SELECT * FROM regions WHERE name = ?').get(String(b.region)) : null;
  const shipPrice = reg ? reg.price : 0;
  const total = goodsSum + installPrice + cloudPrice + shipPrice;

  const seq = (getSetting('orderSeq') || 4822) + 1;
  setSetting('orderSeq', seq);
  const id = `#KO-${seq}`;

  const insert = db.prepare(`INSERT INTO orders
    (id, client_name, phone, region, address, addr_note, recipient_name, recipient_phone,
     items, goods_sum, install, install_price, cloud, cloud_price, ship_price, total, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Yangi')`);
  const decQty = db.prepare('UPDATE products SET qty = qty - ? WHERE sku = ?');

  insert.run(
    id, String(b.clientName || ''), phone, reg ? reg.name : String(b.region || ''),
    String(b.address || ''), String(b.addrNote || ''),
    String(b.recipient?.name || ''), normPhone(b.recipient?.phone) || '',
    JSON.stringify(items), goodsSum,
    b.install ? 1 : 0, installPrice, b.cloud ? 1 : 0, cloudPrice, shipPrice, total,
  );
  for (const it of items) decQty.run(it.qty, it.sku);
  db.prepare('INSERT INTO order_events (order_id, status) VALUES (?, ?)').run(id, 'Yangi');

  res.status(201).json(parseOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)));
});

// GET /api/orders?phone=901234567 — mijozning buyurtmalari
const getMyOrders = (req, res) => {
  const phone = normPhone(req.query.phone);
  if (phone.length !== 9) return res.status(400).json({ error: 'phone parametri kerak' });
  const rows = db.prepare('SELECT * FROM orders WHERE phone = ? ORDER BY created_at DESC').all(phone);
  res.json(rows.map(parseOrder));
};
ordersRouter.get('/orders', getMyOrders);
ordersRouter.get('/orders/my', getMyOrders);

// GET /api/orders/:id?phone=... — bitta buyurtma (telefon bilan tasdiqlanadi)
ordersRouter.get('/orders/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(`#${String(req.params.id).replace(/^#/, '')}`);
  if (!row || normPhone(req.query.phone) !== row.phone) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  const events = db.prepare('SELECT status, at FROM order_events WHERE order_id = ? ORDER BY at').all(row.id);
  res.json({ ...parseOrder(row), events });
});

// POST /api/callbacks — qo'ng'iroq / mutaxassis so'rovi
ordersRouter.post('/callbacks', (req, res) => {
  const b = req.body || {};
  const phone = normPhone(b.phone);
  if (phone.length !== 9) return res.status(400).json({ error: 'Telefon raqami noto’g’ri' });
  const info = db.prepare('INSERT INTO callbacks (name, phone, note, slot, topic, channel) VALUES (?,?,?,?,?,?)')
    .run(String(b.name || ''), phone, String(b.note || ''), String(b.slot || 'Tezroq'), String(b.topic || ''), String(b.channel || 'Telefon'));
  res.status(201).json({ id: info.lastInsertRowid, status: 'Yangi', message: 'Mutaxassis 15 daqiqada qo’ng’iroq qiladi' });
});
