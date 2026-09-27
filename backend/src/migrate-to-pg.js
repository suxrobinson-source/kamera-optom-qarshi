/* Lokal SQLite bazasini (backend/data/kamera.db) PostgreSQL'ga ko'chirish.
 *
 *   DATABASE_URL=postgres://... node src/migrate-to-pg.js [--force] [--with-admins]
 *
 * • Maqsad bazada mahsulotlar bo'lsa, --force berilmaguncha to'xtaydi (tasodifan ustidan yozmaslik uchun).
 * • Admin akkauntlari standart holatda ko'chirilmaydi — serverda ADMIN_PASSWORD bilan yangisi yaratiladi.
 * • Usta rasmlari va git'da yo'q mahsulot rasmlari diskdan `uploads` jadvaliga yuklanadi.
 */
import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { db, DATA_DIR } from './db.js';
import { IMAGE_TYPES } from './uploads.js';

if (db.dialect !== 'pg') {
  console.error('DATABASE_URL berilmagan — maqsad PostgreSQL bazasi kerak.');
  process.exit(1);
}
const force = process.argv.includes('--force');
const withAdmins = process.argv.includes('--with-admins');
const ASSETS = path.join(DATA_DIR, '..', 'assets');

const src = new DatabaseSync(path.join(DATA_DIR, 'kamera.db'), { readOnly: true });
const srcTables = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));

// Tartib muhim: order_events → orders ga bog'langan
const TABLES = ['products', 'categories', 'banners', 'stories', 'regions', 'orders', 'order_events', 'callbacks',
  'settings', 'ustas', 'story_likes', 'story_comments', ...(withAdmins ? ['admins'] : [])];
const SERIAL = ['banners', 'order_events', 'callbacks', 'ustas', 'story_comments', 'admins'];

const targetCols = async (table) => (await db.all(
  'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', table)).map(r => r.column_name);

const existing = (await db.get('SELECT COUNT(*) AS n FROM products')).n;
if (existing > 0 && !force) {
  console.error(`Maqsad bazada allaqachon ${existing} ta mahsulot bor. Ustidan yozish uchun --force qo'shing.`);
  await db.close();
  process.exit(1);
}

// Diskdagi rasm → uploads (git'dagi statik rasmlar Heroku'da baribir bor, ularni yuklamaymiz)
let tracked = new Set();
try {
  const root = path.join(ASSETS, '..', '..');
  tracked = new Set(execFileSync('git', ['ls-files', 'backend/assets'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).map(p => '/' + p.replace(/^backend\//, '')));
} catch (e) { console.warn('git ls-files ishlamadi — barcha havola qilingan rasmlar yuklanadi'); }

const files = new Set();
for (const u of srcTables.has('ustas') ? src.prepare('SELECT photos FROM ustas').all() : []) {
  try { for (const p of JSON.parse(u.photos || '[]')) files.add(p); } catch (e) { }
}
for (const p of src.prepare('SELECT images FROM products').all()) {
  try { for (const i of JSON.parse(p.images || '[]')) files.add(i); } catch (e) { }
}

const summary = {};
await db.tx(async () => {
  for (const t of [...TABLES].reverse()) await db.run(`DELETE FROM ${t}`);
  for (const t of TABLES) {
    if (!srcTables.has(t)) { summary[t] = 0; continue; }
    const cols = await targetCols(t);
    const rows = src.prepare(`SELECT * FROM ${t}`).all();
    let n = 0;
    for (const row of rows) {
      const keys = Object.keys(row).filter(k => cols.includes(k));
      const vals = keys.map(k => (typeof row[k] === 'bigint' ? Number(row[k]) : row[k]));
      await db.run(`INSERT INTO ${t} (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...vals);
      n++;
    }
    summary[t] = n;
  }
  for (const t of SERIAL) {
    await db.exec(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
  }
  let up = 0;
  for (const p of files) {
    if (!p || !p.startsWith('/assets/') || tracked.has(p)) continue;
    const fp = path.join(ASSETS, p.slice('/assets/'.length));
    if (!fs.existsSync(fp)) continue;
    const ext = path.extname(fp).slice(1).toLowerCase();
    await db.run('INSERT INTO uploads (path, mime, data) VALUES (?, ?, ?) ON CONFLICT (path) DO UPDATE SET mime = excluded.mime, data = excluded.data',
      p, IMAGE_TYPES[ext] || 'application/octet-stream', fs.readFileSync(fp).toString('base64'));
    up++;
  }
  summary.uploads = up;
});

console.log('PostgreSQL ga ko‘chirildi:');
for (const [t, n] of Object.entries(summary)) console.log(`  ${t.padEnd(15)} ${n}`);
if (!withAdmins) console.log('  (admins ko‘chirilmadi — server ADMIN_PASSWORD bilan admin yaratadi)');
src.close();
await db.close();
