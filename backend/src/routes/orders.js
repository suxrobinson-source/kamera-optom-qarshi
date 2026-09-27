import { db, getSetting, nextSeq } from '../db.js';
import { asyncRouter } from '../uploads.js';

export const ordersRouter = asyncRouter();

const normPhone = (v) => String(v || '').replace(/[^0-9]/g, '').slice(-9);

const parseOrder = (row) => ({
  ...row,
  items: JSON.parse(row.items),
  install: !!row.install, cloud: !!row.cloud, usta: !!row.usta,
});

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// POST /api/orders — buyurtma yaratish
// body: { phone, clientName?, region, address?, addrNote?, recipient?: {name, phone},
//         items: [{sku, qty}], install?, cloud? }
ordersRouter.post('/orders', async (req, res) => {
  const b = req.body || {};
  const phone = normPhone(b.phone);
  if (phone.length !== 9) return res.status(400).json({ error: 'Telefon raqami 9 raqamdan iborat bo’lishi kerak (masalan 901234567)' });
  if (!Array.isArray(b.items) || b.items.length === 0) return res.status(400).json({ error: 'Savat bo’sh' });
  if (b.items.length > 50) return res.status(400).json({ error: 'Buyurtmada tovarlar soni 50 tadan oshmasligi kerak' });

  const pricing = await getSetting('pricing');
  // Tasdiqlangan usta — narxlar usta marjasi bo'yicha
  const isUsta = !!(await db.get("SELECT 1 AS x FROM ustas WHERE phone = ? AND status = 'Tasdiqlangan'", phone));

  let order;
  try {
    // Qoldiqni tekshirish, kamaytirish va buyurtma raqami — bitta tranzaksiyada
    order = await db.tx(async () => {
      const items = [];
      let goodsSum = 0, cams = 0;
      for (const it of b.items) {
        let p = await db.get('SELECT * FROM products WHERE sku = ? AND active = 1' + db.forUpdate, String(it.sku || ''));
        if (!p && pricing && Array.isArray(pricing.hddOptions)) {
          const hdd = pricing.hddOptions.find(h => h.sku === it.sku || h.size === it.sku);
          if (hdd) {
            p = { sku: hdd.sku || it.sku, name: `microSD ${hdd.size} (${hdd.days})`, price: hdd.price, price_usta: hdd.priceUsta, qty: 999, cat: 'Xotira' };
          }
        }
        const qty = Math.max(1, Math.min(999, +it.qty || 1));
        if (!p) throw new HttpError(400, `Mahsulot topilmadi: ${it.sku}`);
        if (p.qty < qty) throw new HttpError(409, `"${p.name}" omborda yetarli emas (qoldiq: ${p.qty})`);
        const unit = isUsta && p.price_usta > 0 ? p.price_usta : p.price;
        items.push({ sku: p.sku, name: p.name, price: unit, qty });
        goodsSum += unit * qty;
        if (['Tashqi', 'Ichki', 'Aylanuvchi'].includes(p.cat)) cams += qty;
        if (p.cat === 'Komplekt') cams += qty * 4;
      }

      const installPrice = b.install ? Math.max(1, cams) * pricing.installPerCamera : 0;
      const cloudPrice = b.cloud ? Math.max(1, cams) * pricing.cloudPerCameraMonth * 12 : 0;
      const reg = b.region ? await db.get('SELECT * FROM regions WHERE name = ?', String(b.region)) : null;
      const shipPrice = reg ? reg.price : 0;
      const total = goodsSum + installPrice + cloudPrice + shipPrice;

      const id = `#KO-${await nextSeq('orderSeq', 4822)}`;
      await db.run(`INSERT INTO orders
        (id, client_name, phone, region, address, addr_note, recipient_name, recipient_phone,
         items, goods_sum, install, install_price, cloud, cloud_price, ship_price, total, usta, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Yangi')`,
        id, String(b.clientName || ''), phone, reg ? reg.name : String(b.region || ''),
        String(b.address || ''), String(b.addrNote || ''),
        String(b.recipient?.name || ''), normPhone(b.recipient?.phone) || '',
        JSON.stringify(items), goodsSum,
        b.install ? 1 : 0, installPrice, b.cloud ? 1 : 0, cloudPrice, shipPrice, total, isUsta ? 1 : 0,
      );
      for (const it of items) await db.run('UPDATE products SET qty = qty - ? WHERE sku = ?', it.qty, it.sku);
      await db.run('INSERT INTO order_events (order_id, status) VALUES (?, ?)', id, 'Yangi');
      return db.get('SELECT * FROM orders WHERE id = ?', id);
    });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
  res.status(201).json(parseOrder(order));
});

// GET /api/orders?phone=901234567 — mijozning buyurtmalari
const getMyOrders = async (req, res) => {
  const phone = normPhone(req.query.phone);
  if (phone.length !== 9) return res.status(400).json({ error: 'phone parametri kerak' });
  const rows = await db.all('SELECT * FROM orders WHERE phone = ? ORDER BY created_at DESC', phone);
  res.json(rows.map(parseOrder));
};
ordersRouter.get('/orders', getMyOrders);
ordersRouter.get('/orders/my', getMyOrders);

// GET /api/orders/:id?phone=... — bitta buyurtma (telefon bilan tasdiqlanadi)
ordersRouter.get('/orders/:id', async (req, res) => {
  const row = await db.get('SELECT * FROM orders WHERE id = ?', `#${String(req.params.id).replace(/^#/, '')}`);
  if (!row || normPhone(req.query.phone) !== row.phone) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  const events = await db.all('SELECT status, at FROM order_events WHERE order_id = ? ORDER BY at, id', row.id);
  res.json({ ...parseOrder(row), events });
});

// POST /api/callbacks — qo'ng'iroq / mutaxassis so'rovi
ordersRouter.post('/callbacks', async (req, res) => {
  const b = req.body || {};
  const phone = normPhone(b.phone);
  if (phone.length !== 9) return res.status(400).json({ error: "Telefon raqami noto'g'ri" });
  const info = await db.get('INSERT INTO callbacks (name, phone, note, slot, topic, channel) VALUES (?,?,?,?,?,?) RETURNING id',
    String(b.name || ''), phone, String(b.note || ''), String(b.slot || 'Tezroq'), String(b.topic || ''), String(b.channel || 'Telefon'));
  res.status(201).json({ id: info.id, status: 'Yangi', message: "Mutaxassis 15 daqiqada qo'ng'iroq qiladi" });
});
