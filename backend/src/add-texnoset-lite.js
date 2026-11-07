/* «TEXNOSET LITE» to'plamini katalogga qo'shadi (yoki mavjudini yangilaydi).
   Narx qat'iy: SKU pricing.fixedSkus ga yoziladi, kurs/marja qayta qo'llanganda o'zgarmaydi.
   Ishga tushirish: node backend/src/add-texnoset-lite.js
   Heroku:          heroku run -a kamera-optom-qarshi -- node backend/src/add-texnoset-lite.js
   Rasmlar backend/assets/products/txn-lite-1..3.jpg — Heroku'ga git push bilan tushadi. */
import { db, getSetting, setSetting } from './db.js';

const P = {
  sku: 'TXN-LITE',
  name: 'TEXNOSET LITE to‘plami — 2 × NEOCAM 4MP + PoE registrator + 500 GB disk',
  cat: 'Komplekt',
  price: 1549000,
  badge: 'Chegirma',
  spec: '2 × 4MP kamera · 4 kanalli PoE NVR · 500 GB disk · 30 m kabel bonus',
  desc: 'Kichik biznes va uy uchun ekonom tanlov. To‘plamda ikkita NEOCAM 4MP kamera (ovoz yozadi, gapiradi, LED chiroqli), '
    + '4 kanalli PoE registrator (NVR) va 500 GB WD Purple disk bor. O‘rnatish uchun kerakli narsalar ichida, ustiga 30 metrlik kabel bonus. '
    + 'Televizor va telefoningizga ulab beriladi, xorijdan turib ham jonli ko‘rish mumkin. Chegirma narxi: 2 400 000 so‘mdan 1 549 000 so‘mga.',
  tags: ['Komplekt', '4MP', 'PoE', 'Bonus kabel'],
  specs: [
    { k: 'Kameralar', v: '2 × NEOCAM NEO-NSW638M-E4A, 4MP' },
    { k: 'Registrator', v: 'NEOCAM NEO-N61004A1-P (4 PoE port)' },
    { k: 'Disk', v: 'WD Purple 500 GB' },
    { k: 'Bonus', v: '30 m kabel' },
  ],
  poe: 1, mp: 1, night: 1, spin: 0,
  qty: 20,                       // ombordagi to'plamlar soni — kerak bo'lsa admin panelda o'zgartiring
  promo: 'CHEGIRMA',
  is_popular: 1,
  images: ['/assets/products/txn-lite-1.jpg', '/assets/products/txn-lite-2.jpg', '/assets/products/txn-lite-3.jpg'],
};

async function main() {
  const has = await db.get('SELECT 1 AS x FROM products WHERE sku = ?', P.sku);
  const vals = [P.name, P.cat, P.price, P.badge, P.spec, P.desc, JSON.stringify(P.tags), JSON.stringify(P.specs),
    P.poe, P.mp, P.night, P.spin, P.qty, P.promo, P.is_popular, JSON.stringify(P.images)];
  if (has) {
    await db.run(`UPDATE products SET name = ?, cat = ?, price = ?, badge = ?, spec = ?, "desc" = ?, tags = ?, specs = ?,
      poe = ?, mp = ?, night = ?, spin = ?, qty = ?, promo = ?, is_popular = ?, images = ?, price_usd = NULL, margin = NULL,
      margin_usta = NULL, price_usta = NULL, active = 1 WHERE sku = ?`, ...vals, P.sku);
  } else {
    await db.run(`INSERT INTO products (sku,name,cat,price,badge,spec,"desc",tags,specs,poe,mp,night,spin,qty,promo,is_popular,images,active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`, P.sku, ...vals);
  }
  const pricing = (await getSetting('pricing')) || {};
  const fixed = new Set([...(Array.isArray(pricing.fixedSkus) ? pricing.fixedSkus : []), P.sku]);
  await setSetting('pricing', { ...pricing, fixedSkus: [...fixed] });
  console.log(`✓ ${P.sku} ${has ? 'yangilandi' : 'qo‘shildi'}: ${P.price} so‘m (${db.dialect})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
