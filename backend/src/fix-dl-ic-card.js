/* CS-DL-IC-CPU-R200 — bu qulf emas, EZVIZ qulflari uchun IC (CPU) karta-brelok.
   Tavsif, qisqa spec va texnik jadvalni JSON fayllarda va bazada (SQLite yoki Postgres) to'g'rilaydi.
   Ishga tushirish: node src/fix-dl-ic-card.js */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SKU = 'CS-DL-IC-CPU-R200';

const CARD_DESC = (name) => `${name} — EZVIZ aqlli eshik qulflari uchun shifrlangan IC (CPU) karta-brelok. Qulfga bir tegizish bilan eshikni kontaktsiz ochadi. Nusxa ko'chirishdan himoyalangan EZVIZ shifrlash algoritmi bilan ishlaydi. Oila a'zolari, xodimlar yoki ijarachilar uchun qo'shimcha kalit sifatida qulay: yo'qolgan brelokni qulf menyusi yoki EZVIZ ilovasi orqali ro'yxatdan o'chirib qo'yish mumkin. Ixcham (40 × 32 mm), kalitlar to'plamiga taqish uchun halqa teshigi bor, batareya talab qilmaydi. Rasmiy 1 yil kafolat bilan beriladi.`;
const SPEC = 'IC CPU karta · Shifrlangan · Batareyasiz';
const TAGS = ['Ezviz', 'Qulf uchun', 'RFID'];

function fixSpecs(specs) {
  const keep = (Array.isArray(specs) ? specs : []).filter((s) => /narx|kafolat/i.test(s.k || ''));
  return [
    { k: 'Turi', v: 'IC (CPU) shifrlangan karta-brelok' },
    { k: 'Moslik', v: 'Karta o\'quvchisi bor EZVIZ aqlli qulflari' },
    { k: 'O\'lcham', v: '40 × 32 mm' },
    { k: 'Quvvat', v: 'Batareyasiz (passiv RFID)' },
    ...keep,
  ];
}

async function main() {
  for (const file of ['all-imported-products.json', 'ezviz-products.json']) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) continue;
    const items = JSON.parse(fs.readFileSync(p, 'utf8'));
    const it = items.find((x) => x.sku === SKU);
    if (!it) continue;
    Object.assign(it, { desc: CARD_DESC(it.name), spec: SPEC, tags: TAGS, specs: fixSpecs(it.specs) });
    fs.writeFileSync(p, JSON.stringify(items, null, 2) + '\n', 'utf8');
    console.log(`✓ ${file}`);
  }

  const row = await db.get('SELECT name, specs FROM products WHERE sku = ?', SKU);
  if (!row) return console.log(`— bazada ${SKU} yo'q`);
  let specs = [];
  try { specs = JSON.parse(row.specs); } catch (e) { }
  await db.run('UPDATE products SET "desc" = ?, spec = ?, tags = ?, specs = ? WHERE sku = ?',
    CARD_DESC(row.name), SPEC, JSON.stringify(TAGS), JSON.stringify(fixSpecs(specs)), SKU);
  console.log(`✓ baza (${db.dialect})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
