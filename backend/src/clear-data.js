import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, setSetting } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function clearAllData() {
  console.log('🧹 Barcha test ma\'lumotlarini o\'chirish boshlandi...');

  // 1. Truncate test tables in SQLite
  db.exec(`
    DELETE FROM order_events;
    DELETE FROM orders;
    DELETE FROM callbacks;
    DELETE FROM products;
    DELETE FROM banners;
    DELETE FROM stories;
  `);

  // 2. Reset order sequence counter
  setSetting('orderSeq', 1001);

  // 3. Clean uploaded product images from assets/products
  const prodAssetsDir = path.join(__dirname, '..', 'assets', 'products');
  if (fs.existsSync(prodAssetsDir)) {
    const files = fs.readdirSync(prodAssetsDir);
    for (const file of files) {
      const fullPath = path.join(prodAssetsDir, file);
      try {
        if (fs.statSync(fullPath).isFile()) {
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        console.warn(`Faylni o'chirishda xatolik: ${file}`, err.message);
      }
    }
  }

  // Vacuum SQLite database to reclaim disk space
  try {
    db.exec('VACUUM;');
  } catch (e) { }

  console.log('✅ Barcha test ma\'lumotlari to\'liq o\'chirildi:');
  console.log('   - Mahsulotlar (products): 0');
  console.log('   - Buyurtmalar (orders): 0');
  console.log('   - Arizalar (callbacks): 0');
  console.log('   - Bannerlar (banners): 0');
  console.log('   - Hikoyalar (stories): 0');
  console.log('   - Mahsulot rasmlari tozalandi');
  console.log('   - Admin akkaunti va tizim sozlamalari saqlab qolindi');
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  clearAllData();
}

