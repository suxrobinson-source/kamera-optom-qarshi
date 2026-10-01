/* NEOCAM narxlar ro'yxati (19.08.2026) mahsulotlarini qo'shish / yangilash.
   Tannarx = ro'yxat narxi − 10% (so'm). Tizimdagi tannarx dollarda saqlanadi, shuning uchun joriy kurs bo'yicha o'giriladi;
   mijoz va usta narxlari standart narx dvigateli (computeProduct: kurs × (1 + marja%)) bilan hisoblanadi.
   Ishga tushirish: node backend/src/import-neocam.js   (Heroku: heroku run -a kamera-optom-qarshi -- node backend/src/import-neocam.js) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { getCurrency, computeProduct } from './currency.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'neocam-products.json'), 'utf8'));
const WARRANTY = { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' };
const DEFAULT_QTY = 10;
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

async function main() {
  const cur = await getCurrency();
  if (!(cur.usdRate > 0)) throw new Error('Dollar kursi o\'rnatilmagan — admin panelda kursni belgilang');
  let added = 0, updated = 0;
  for (const p of items) {
    const cost = Math.round(p.cost_som / cur.usdRate * 10000) / 10000;
    const calc = computeProduct({ price_usd: cost, margin: null, margin_usta: null }, cur);
    const specs = [...p.rows.map(([k, v]) => ({ k, v })), { k: 'Diler (optom) narxi', v: `${fmt(p.cost_som)} so'm` }, WARRANTY];
    const row = await db.get('SELECT sku, margin, margin_usta FROM products WHERE sku = ?', p.sku);
    if (row) {
      const c2 = computeProduct({ price_usd: cost, margin: row.margin, margin_usta: row.margin_usta }, cur);
      await db.run(`UPDATE products SET name = ?, cat = ?, badge = ?, spec = ?, tags = ?, specs = ?, "desc" = ?, poe = ?, mp = ?, night = ?, spin = ?,
        images = ?, price_usd = ?, price = ?, price_usta = ? WHERE sku = ?`,
        p.name, p.cat, p.badge, p.spec, JSON.stringify(p.tags), JSON.stringify(specs), p.desc, p.flags.poe, p.flags.mp, p.flags.night, p.flags.spin,
        JSON.stringify(p.images), cost, c2.price, c2.price_usta, p.sku);
      updated++;
    } else {
      await db.run(`INSERT INTO products (sku, name, cat, price, price_usd, price_usta, badge, spec, "desc", tags, specs, poe, mp, night, spin, qty, images, active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        p.sku, p.name, p.cat, calc.price, cost, calc.price_usta, p.badge, p.spec, p.desc, JSON.stringify(p.tags), JSON.stringify(specs),
        p.flags.poe, p.flags.mp, p.flags.night, p.flags.spin, DEFAULT_QTY, JSON.stringify(p.images));
      added++;
    }
    console.log(`${p.sku.padEnd(20)} tannarx ${fmt(p.cost_som).padStart(10)} → mijoz ${fmt(calc.price).padStart(10)} · usta ${fmt(calc.price_usta).padStart(10)}`);
  }
  console.log(`✓ ${added} ta qo'shildi, ${updated} ta yangilandi (kurs ${cur.usdRate}, marja ${cur.margins.default}% / usta ${cur.margins.usta}%, ${db.dialect})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
