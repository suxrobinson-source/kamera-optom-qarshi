import { db, getSetting, nextSeq, normCid, deviceCode } from '../db.js';
import { asyncRouter, overLimit, clientIp } from '../uploads.js';
import { shippingFee } from '../currency.js';

export const ordersRouter = asyncRouter();

const normPhone = (v) => String(v || '').replace(/[^0-9]/g, '').slice(-9);
const TEN_MIN = 600000;
const orderHits = new Map(), cbHits = new Map(), readHits = new Map();

const parseCredit = (v) => { try { const c = v ? JSON.parse(v) : null; return c && c.provider ? c : null; } catch (e) { return null; } };
const parseOrder = (row) => ({
  ...row,
  items: JSON.parse(row.items),
  install: !!row.install, cloud: !!row.cloud, usta: !!row.usta,
  credit: parseCredit(row.credit),
});
const clip = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
/* Nasiya tanlovi admin sozlamalari bo'yicha tekshiriladi: yoqilgan provayder va muddat, minimal summa.
   Oylik to'lov mijozdan olinmaydi — server foiz bo'yicha qayta hisoblaydi. */
export const CREDIT_TERMS = { commission: 2.5, minSum: 1000000, penalty: 0.2, docs: 'Pasport + ish joyi ma’lumoti' };
const PROVIDERS = ['Uzum Nasiya', 'Alif Nasiya', 'Hamkor Nasiya'];
const fmtSum = n => Math.round(n).toLocaleString('ru-RU').replace(/\s/g, ' ') + ' so‘m';
function cleanCredit(c, total, cs) {
  if (!c || typeof c !== 'object') return '';
  const term = parseInt(c.term, 10);
  const provider = clip(c.provider, 40);
  const st = cs || {};
  const terms = { ...CREDIT_TERMS, ...(st.terms || {}) };
  if (!PROVIDERS.includes(provider) || (st.provOn && st.provOn[provider] === false)) throw new HttpError(400, `${provider || 'Nasiya'} hozir ishlamayapti — boshqa servisni tanlang`);
  if (![3, 6, 12, 24].includes(term) || (st.rateOn && st.rateOn[term] === false)) throw new HttpError(400, 'Bu muddatga muddatli to‘lov hozir yo‘q');
  if (total < +terms.minSum) throw new HttpError(400, `Muddatli to‘lov ${fmtSum(+terms.minSum)} dan boshlab`);
  const rate = +((st.rates || {})[term] || 0);
  const monthly = Math.round(total * (1 + rate / 100) / term / 1000) * 1000;
  return JSON.stringify({ provider, term, rate, monthly, down: +((st.down || {})[term] || 0) });
}

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

  // Spamdan himoya: bitta manzil, raqam yoki qurilmadan qisqa vaqtda ko'p buyurtma qabul qilinmaydi
  // (har bir buyurtma ombor qoldig'ini band qiladi). Mobil operatorlarda ko'p mijoz bitta IP ortida — IP chegarasi kengroq.
  const cid = normCid(b.cid);
  if (overLimit(orderHits, 'ip:' + clientIp(req), 20, TEN_MIN) || overLimit(orderHits, 'ph:' + phone, 6, TEN_MIN)
    || (cid && overLimit(orderHits, 'cid:' + cid, 6, TEN_MIN))) {
    return res.status(429).json({ error: 'Juda ko‘p buyurtma yuborildi — 10 daqiqadan keyin qayta urinib ko‘ring yoki bizga qo‘ng‘iroq qiling' });
  }

  const pricing = await getSetting('pricing');
  // Buyurtma shu qurilmaga bog'lanadi: keyin faqat shu qurilma (maxfiy cid) uni ko'ra oladi.
  // Eski (keshlangan) ilova cid yubormaydi — unda qurilma kodi so'rovdan olinadi.
  const device = cid ? await deviceCode(cid, { create: true, phone }) : String(b.device || '').replace(/[^0-9]/g, '').slice(0, 6);
  // Tasdiqlangan usta — narxlar usta marjasi bo'yicha; faqat usta maqomi bog'langan qurilmadan
  const usta = await db.get("SELECT device FROM ustas WHERE phone = ? AND status = 'Tasdiqlangan'", phone);
  const isUsta = !!(usta && cid && usta.device && usta.device === device);

  // Bir xil mahsulot bir necha qatorda kelsa — qo'shiladi (qoldiq umumiy son bo'yicha tekshiriladi); son faqat butun
  const want = new Map();
  for (const it of b.items) {
    const sku = String(it?.sku || ''), q = Math.floor(+it?.qty);
    want.set(sku, (want.get(sku) || 0) + (q >= 1 ? q : 1));
  }

  let order;
  try {
    // Qoldiqni tekshirish, kamaytirish va buyurtma raqami — bitta tranzaksiyada
    order = await db.tx(async () => {
      const items = [];
      let goodsSum = 0, cams = 0;
      for (const [sku, n] of want) {
        const it = { sku };
        let p = await db.get('SELECT * FROM products WHERE sku = ? AND active = 1' + db.forUpdate, sku);
        if (!p && pricing && Array.isArray(pricing.hddOptions)) {
          const hdd = pricing.hddOptions.find(h => h.sku === it.sku || h.size === it.sku);
          if (hdd) {
            p = { sku: hdd.sku || it.sku, name: `microSD ${hdd.size} (${hdd.days})`, price: hdd.price, price_usta: hdd.priceUsta, qty: 999, cat: 'Xotira' };
          }
        }
        const qty = Math.min(999, n);
        if (!p) throw new HttpError(400, `Mahsulot topilmadi: ${clip(it.sku, 40)}`);
        if (p.qty < qty) throw new HttpError(409, `"${p.name}" omborda yetarli emas (qoldiq: ${p.qty})`);
        const unit = isUsta && p.price_usta > 0 ? p.price_usta : p.price;
        items.push({ sku: p.sku, name: p.name, price: unit, qty });
        goodsSum += unit * qty;
        if (['Tashqi', 'Ichki', 'Aylanuvchi'].includes(p.cat)) cams += qty;
        if (p.cat === 'Komplekt') cams += qty * (p.sku === 'TXN-LITE' ? 2 : 4);
      }

      const installPrice = b.install ? Math.max(1, cams) * pricing.installPerCamera : 0;
      const cloudPrice = b.cloud ? Math.max(1, cams) * pricing.cloudPerCameraMonth * 12 : 0;
      const reg = b.region ? await db.get('SELECT * FROM regions WHERE name = ?', String(b.region)) : null;
      const shipPrice = shippingFee(goodsSum, pricing);
      const total = goodsSum + installPrice + cloudPrice + shipPrice;
      const creditJson = b.credit ? cleanCredit(b.credit, total, await getSetting('credit')) : '';

      const id = `#KO-${await nextSeq('orderSeq', 4822)}`;
      await db.run(`INSERT INTO orders
        (id, client_name, phone, region, address, addr_note, recipient_name, recipient_phone,
         items, goods_sum, install, install_price, cloud, cloud_price, ship_price, total, usta, title, device, credit, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Yangi')`,
        id, clip(b.clientName, 80), phone, reg ? reg.name : clip(b.region, 80),
        clip(b.address, 300), clip(b.addrNote, 300),
        clip(b.recipient?.name, 80), normPhone(b.recipient?.phone) || '',
        JSON.stringify(items), goodsSum,
        b.install ? 1 : 0, installPrice, b.cloud ? 1 : 0, cloudPrice, shipPrice, total, isUsta ? 1 : 0,
        clip(b.title, 160), device, creditJson,
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

// GET /api/orders?phone=901234567&cid=... — mijozning SHU QURILMADAN bergan buyurtmalari.
// Telefon raqamining o'zi yetmaydi (uni har kim biladi): qurilmaning maxfiy cid si ham kerak.
const getMyOrders = async (req, res) => {
  const phone = normPhone(req.query.phone);
  if (phone.length !== 9) return res.status(400).json({ error: 'phone parametri kerak' });
  if (!normCid(req.query.cid)) return res.status(400).json({ error: 'cid kerak' });
  if (overLimit(readHits, clientIp(req), 120, TEN_MIN)) return res.status(429).json({ error: 'Juda ko‘p so‘rov — birozdan keyin urinib ko‘ring' });
  const code = await deviceCode(req.query.cid);
  const rows = code ? await db.all('SELECT * FROM orders WHERE phone = ? AND device = ? ORDER BY created_at DESC', phone, code) : [];
  res.json(rows.map(parseOrder));
};
ordersRouter.get('/orders', getMyOrders);
ordersRouter.get('/orders/my', getMyOrders);

// GET /api/orders/:id?phone=...&cid=... — bitta buyurtma (telefon va qurilma bilan tasdiqlanadi)
ordersRouter.get('/orders/:id', async (req, res) => {
  if (overLimit(readHits, clientIp(req), 120, TEN_MIN)) return res.status(429).json({ error: 'Juda ko‘p so‘rov — birozdan keyin urinib ko‘ring' });
  const row = await db.get('SELECT * FROM orders WHERE id = ?', `#${String(req.params.id).replace(/^#/, '')}`);
  const code = await deviceCode(req.query.cid);
  if (!row || normPhone(req.query.phone) !== row.phone || !code || row.device !== code) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  const events = await db.all('SELECT status, at FROM order_events WHERE order_id = ? ORDER BY at, id', row.id);
  res.json({ ...parseOrder(row), events });
});

// POST /api/callbacks — qo'ng'iroq / mutaxassis so'rovi
ordersRouter.post('/callbacks', async (req, res) => {
  const b = req.body || {};
  const phone = normPhone(b.phone);
  if (phone.length !== 9) return res.status(400).json({ error: "Telefon raqami noto'g'ri" });
  if (overLimit(cbHits, 'ip:' + clientIp(req), 12, TEN_MIN) || overLimit(cbHits, 'ph:' + phone, 3, TEN_MIN)) {
    return res.status(429).json({ error: 'So‘rovingiz qabul qilingan — mutaxassis tez orada qo‘ng‘iroq qiladi' });
  }
  const info = await db.get('INSERT INTO callbacks (name, phone, note, slot, topic, channel) VALUES (?,?,?,?,?,?) RETURNING id',
    clip(b.name, 80), phone, clip(b.note, 1000), clip(b.slot, 40) || 'Tezroq', clip(b.topic, 120), clip(b.channel, 40) || 'Telefon');
  res.status(201).json({ id: info.id, status: 'Yangi', message: "Mutaxassis 15 daqiqada qo'ng'iroq qiladi" });
});
