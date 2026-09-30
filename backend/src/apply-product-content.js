/* Mahsulot tavsiflari va texnik jadvallarini rasmiy ma'lumotlar asosida yangilash.
   Manba: product-content.json (EZVIZ — ezviz.com rasmiy jadvallari, HiLook — Hikvision rasmiy datasheet'lari).
   Narx qatorlari (Diler / chakana narx) bazadagi holicha qoldiriladi.
   Ishga tushirish: node backend/src/apply-product-content.js   (Heroku: heroku run -a kamera-optom-qarshi -- node backend/src/apply-product-content.js) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const content = JSON.parse(fs.readFileSync(path.join(__dirname, 'product-content.json'), 'utf8'));
const WARRANTY = { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' };

async function main() {
  let updated = 0;
  const missing = [];
  for (const [sku, c] of Object.entries(content)) {
    const row = await db.get('SELECT sku, name, specs FROM products WHERE sku = ?', sku);
    if (!row) { missing.push(sku); continue; }
    let old = [];
    try { old = JSON.parse(row.specs) || []; } catch (e) { }
    const priceRows = old.filter((s) => /narx/i.test(s.k || ''));
    const specs = [...c.rows.map(([k, v]) => ({ k, v })), ...priceRows, WARRANTY];
    await db.run(
      `UPDATE products SET name = ?, badge = ?, spec = ?, tags = ?, specs = ?, "desc" = ?, poe = ?, mp = ?, night = ?, spin = ? WHERE sku = ?`,
      c.name || row.name, c.badge, c.spec, JSON.stringify(c.tags), JSON.stringify(specs), c.desc,
      c.flags.poe, c.flags.mp, c.flags.night, c.flags.spin, sku,
    );
    updated++;
  }
  console.log(`✓ ${updated} ta mahsulot yangilandi (${db.dialect})`);
  if (missing.length) console.log(`— bazada topilmadi: ${missing.join(', ')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
