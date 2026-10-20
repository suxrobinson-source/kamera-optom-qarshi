/* Komplekt kabeli: faqat 2 xil — tashqi (ko'cha) va ichki, metr narxi qat'iy (mijoz va usta uchun bir xil).
   Narx qat'iy: SKU'lar pricing.fixedSkus ga yoziladi, kurs/marja qayta qo'llanganda o'zgarmaydi.
   pricing.cablePerMeter (oddiy kalkulyator va aqlli yordamchi) tashqi kabel narxiga tenglanadi.
   Komplekt bosqichidagi ro'yxat kits.js dagi KB_CABLES bilan bir xil bo'lishi kerak.
   Ishga tushirish: node backend/src/set-cable-prices.js   (Heroku: heroku run -a kamera-optom-qarshi -- node backend/src/set-cable-prices.js) */
import { db, getSetting, setSetting } from './db.js';

const CABLES = [
  { sku: 'KAB-KABEL-KSVPP-4-2-0-52-CHERNYY-YUTP', price: 1950, where: 'tashqi' },
  { sku: 'KAB-KABEL-KSVPV-4-2-0-52-SERYY-YUTP', price: 1850, where: 'ichki' },
];

async function main() {
  for (const c of CABLES) {
    const r = await db.run('UPDATE products SET price = ?, price_usta = ?, price_usd = NULL, margin = NULL, margin_usta = NULL, active = 1 WHERE sku = ?',
      c.price, c.price, c.sku);
    if (!r.changes) throw new Error(`Kabel topilmadi: ${c.sku}`);
  }
  const pricing = (await getSetting('pricing')) || {};
  const fixed = new Set([...(Array.isArray(pricing.fixedSkus) ? pricing.fixedSkus : []), ...CABLES.map(c => c.sku)]);
  await setSetting('pricing', { ...pricing, fixedSkus: [...fixed], cablePerMeter: CABLES[0].price });
  console.log(`✓ Kabel narxlari: ${CABLES.map(c => `${c.where} ${c.price} so'm/m`).join(', ')} (${db.dialect})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
