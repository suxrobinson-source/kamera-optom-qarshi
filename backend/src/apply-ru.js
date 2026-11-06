/* Barcha mahsulotlarning ruscha maydonini (products.ru) lug'at bo'yicha to'ldiradi/yangilaydi.
   Lug'at: backend/data/i18n-ru.json. Admin qo'lda yozgan maydonlar (ru.manual) o'zgarmaydi.
   Ishga tushirish: node backend/src/apply-ru.js   (Heroku: heroku run -a kamera-optom-qarshi -- node backend/src/apply-ru.js)
   Mahsulot tavsiflari yangilangandan keyin (apply-product-content.js va h.k.) qayta ishga tushiring. */
import { db } from './db.js';
import { refreshRu, parseRu, loadDict } from './i18n-ru.js';

const SENT = /(?<=[.!?])\s+/;
const hasLatinWords = (s) => /[a-z]{3,}/i.test(s) && !/[а-яё]/i.test(s);

async function main() {
  loadDict();
  const rows = await db.all('SELECT * FROM products');
  let changed = 0, sentTotal = 0, sentLeft = 0;
  const left = new Map();
  /* bitta tranzaksiyada — har bir qator uchun alohida diskka yozish juda sekin */
  await db.tx(async () => { for (const row of rows) {
    const ru = refreshRu(row);
    String(ru.desc || '').split(SENT).filter(Boolean).forEach((s) => {
      sentTotal++;
      if (hasLatinWords(s.replace(/^[^—]*— /, ''))) { sentLeft++; left.set(s, (left.get(s) || 0) + 1); }
    });
    const next = JSON.stringify(ru);
    if (next !== JSON.stringify(parseRu(row.ru)) || !row.ru) {
      await db.run('UPDATE products SET ru = ? WHERE sku = ?', next, row.sku);
      changed++;
    }
  } });
  console.log(`✓ ${rows.length} ta mahsulot tekshirildi, ${changed} tasining ruscha maydoni yangilandi (${db.dialect})`);
  console.log(`  Tavsif gaplari: ${sentTotal - sentLeft}/${sentTotal} ruscha` + (sentLeft ? ` — ${sentLeft} ta gap lug'atda yo'q (o'zbekcha qoladi)` : ''));
  [...left.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([s, n]) => console.log(`    ×${n} ${s.slice(0, 110)}`));
}

main().catch((err) => { console.error(err); process.exit(1); });
