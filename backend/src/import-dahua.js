/* Dahua narxlar ro'yxati (DAHUA PRICE.xlsx) mahsulotlarini qo'shish / yangilash.
   Ro'yxatdagi dollar narxi tannarx (price_usd) sifatida olinadi; mijoz va usta narxlari standart narx dvigateli
   (computeProduct: kurs × (1 + marja%)) bilan hisoblanadi. Tavsiflar rasmiy dahuasecurity.com jadvallari asosida.
   Ishga tushirish: node backend/src/import-dahua.js   (Heroku: heroku run -a kamera-optom-qarshi -- node backend/src/import-dahua.js) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { getCurrency, computeProduct } from './currency.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'dahua-products.json'), 'utf8'));
const WARRANTY = { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' };
const DEFAULT_QTY = 10;
const NEW_CATEGORIES = [['Kirish nazorati', '⚿', 9], ['Signalizatsiya', '⚑', 10]];

async function main() {
  const cur = await getCurrency();
  if (!(cur.usdRate > 0)) throw new Error('Dollar kursi o\'rnatilmagan — admin panelda kursni belgilang');
  for (const [name, mark, sort] of NEW_CATEGORIES) {
    await db.run('INSERT INTO categories (name, mark, sort) VALUES (?,?,?) ON CONFLICT DO NOTHING', name, mark, sort);
  }
  let added = 0, updated = 0;
  for (const p of items) {
    const cost = p.cost_usd;
    const specs = [...p.rows.map(([k, v]) => ({ k, v })), { k: 'Diler (optom) narxi', v: `$${cost.toFixed(2)}` }, WARRANTY];
    const row = await db.get('SELECT sku, margin, margin_usta FROM products WHERE sku = ?', p.sku);
    const calc = computeProduct({ price_usd: cost, margin: row ? row.margin : null, margin_usta: row ? row.margin_usta : null }, cur);
    if (row) {
      await db.run(`UPDATE products SET name = ?, cat = ?, badge = ?, spec = ?, tags = ?, specs = ?, "desc" = ?, poe = ?, mp = ?, night = ?, spin = ?,
        images = ?, price_usd = ?, price = ?, price_usta = ? WHERE sku = ?`,
        p.name, p.cat, p.badge, p.spec, JSON.stringify(p.tags), JSON.stringify(specs), p.desc, p.flags.poe, p.flags.mp, p.flags.night, p.flags.spin,
        JSON.stringify(p.images), cost, calc.price, calc.price_usta, p.sku);
      updated++;
    } else {
      await db.run(`INSERT INTO products (sku, name, cat, price, price_usd, price_usta, badge, spec, "desc", tags, specs, poe, mp, night, spin, qty, images, active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        p.sku, p.name, p.cat, calc.price, cost, calc.price_usta, p.badge, p.spec, p.desc, JSON.stringify(p.tags), JSON.stringify(specs),
        p.flags.poe, p.flags.mp, p.flags.night, p.flags.spin, DEFAULT_QTY, JSON.stringify(p.images));
      added++;
    }
  }
  console.log(`✓ Dahua: ${added} ta qo'shildi, ${updated} ta yangilandi (kurs ${cur.usdRate}, marja ${cur.margins.default}% / usta ${cur.margins.usta}%, ${db.dialect})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
