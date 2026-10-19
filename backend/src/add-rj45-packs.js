/* RJ45 konnektor to'plamlari: 10 / 20 / 30 dona, dona narxi 650 so'm (mijoz va usta uchun bir xil).
   Narx qat'iy: SKU'lar pricing.fixedSkus ga yoziladi, kurs/marja qayta qo'llanganda o'zgarmaydi.
   Komplekt yig'ishda UTP kabel yoqilganda shu to'plamlardan biri tanlanadi.
   Ishga tushirish: node backend/src/add-rj45-packs.js   (Heroku: heroku run -a kamera-optom-qarshi -- node backend/src/add-rj45-packs.js) */
import { db, getSetting, setSetting } from './db.js';

const UNIT = 650;
const PACKS = [10, 20, 30];
const DEFAULT_QTY = 100;

async function main() {
  const skus = [];
  for (const n of PACKS) {
    const sku = `RJ45-${n}`;
    const price = UNIT * n;
    const p = {
      name: `RJ45 konnektor — ${n} dona`,
      cat: 'Tarmoq',
      badge: `${n} dona`,
      spec: `RJ45 · CAT5 · ${n} dona to‘plam`,
      desc: `RJ45 (8P8C) konnektorlar to‘plami — ${n} dona, CAT5. Tarmoq (UTP) kabeli uchlariga qisiladi: har bir kamera kabeliga 2 ta kerak bo‘ladi. Dona narxi ${UNIT} so‘m.`,
      tags: ['RJ45', 'Konnektor', `${n} dona`],
      specs: [
        { k: 'Turi', v: 'RJ45 (8P8C) konnektor' },
        { k: 'Kategoriya', v: 'CAT5' },
        { k: 'To‘plamda', v: `${n} dona` },
        { k: 'Dona narxi', v: `${UNIT} so‘m` },
        { k: 'Kerakli miqdor', v: 'Har bir kamera kabeliga 2 ta' },
      ],
      images: [1, 2, 3].map(i => `/assets/products/rj45-${n}-${i}.jpg?v=hd1`),
    };
    const row = await db.get('SELECT sku FROM products WHERE sku = ?', sku);
    if (row) {
      await db.run(`UPDATE products SET name = ?, cat = ?, badge = ?, spec = ?, "desc" = ?, tags = ?, specs = ?, images = ?,
        price = ?, price_usta = ?, price_usd = NULL, margin = NULL, margin_usta = NULL WHERE sku = ?`,
        p.name, p.cat, p.badge, p.spec, p.desc, JSON.stringify(p.tags), JSON.stringify(p.specs), JSON.stringify(p.images), price, price, sku);
    } else {
      await db.run(`INSERT INTO products (sku, name, cat, price, price_usd, price_usta, badge, spec, "desc", tags, specs, poe, mp, night, spin, qty, images, active)
        VALUES (?,?,?,?,NULL,?,?,?,?,?,?,0,0,0,0,?,?,1)`,
        sku, p.name, p.cat, price, price, p.badge, p.spec, p.desc, JSON.stringify(p.tags), JSON.stringify(p.specs), DEFAULT_QTY, JSON.stringify(p.images));
    }
    skus.push(sku);
  }
  const pricing = (await getSetting('pricing')) || {};
  const fixed = new Set([...(Array.isArray(pricing.fixedSkus) ? pricing.fixedSkus : []), ...skus]);
  await setSetting('pricing', { ...pricing, fixedSkus: [...fixed] });
  console.log(`✓ RJ45 to'plamlari: ${skus.join(', ')} (dona ${UNIT} so'm, ${db.dialect})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
