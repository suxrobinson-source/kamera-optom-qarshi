import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'kamera.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  sku        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  cat        TEXT NOT NULL,
  price      INTEGER NOT NULL,
  badge      TEXT DEFAULT '',
  spec       TEXT DEFAULT '',
  desc       TEXT DEFAULT '',
  tags       TEXT DEFAULT '[]',
  specs      TEXT DEFAULT '[]',
  poe        INTEGER DEFAULT 0,
  mp         INTEGER DEFAULT 0,
  night      INTEGER DEFAULT 0,
  spin       INTEGER DEFAULT 0,
  qty        INTEGER DEFAULT 0,
  promo      TEXT DEFAULT NULL,
  is_popular INTEGER DEFAULT 0,
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY,
  mark TEXT DEFAULT '',
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS banners (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  tag    TEXT NOT NULL,
  title  TEXT NOT NULL,
  sub    TEXT DEFAULT '',
  cta    TEXT DEFAULT '',
  action TEXT DEFAULT '',
  image  TEXT DEFAULT '',
  sort   INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stories (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  mark  TEXT DEFAULT '',
  title TEXT DEFAULT '',
  meta  TEXT DEFAULT '',
  dur   TEXT DEFAULT '',
  views INTEGER DEFAULT 0,
  live  INTEGER DEFAULT 1,
  file  TEXT DEFAULT '',
  tags  TEXT DEFAULT '[]',
  text  TEXT DEFAULT '',
  sort  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS regions (
  name  TEXT PRIMARY KEY,
  note  TEXT DEFAULT '',
  eta   TEXT DEFAULT '',
  price INTEGER DEFAULT 0,
  zone  TEXT DEFAULT '',
  sort  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  client_name     TEXT DEFAULT '',
  phone           TEXT NOT NULL,
  region          TEXT DEFAULT '',
  address         TEXT DEFAULT '',
  addr_note       TEXT DEFAULT '',
  recipient_name  TEXT DEFAULT '',
  recipient_phone TEXT DEFAULT '',
  items           TEXT NOT NULL DEFAULT '[]',
  goods_sum       INTEGER DEFAULT 0,
  install         INTEGER DEFAULT 0,
  install_price   INTEGER DEFAULT 0,
  cloud           INTEGER DEFAULT 0,
  cloud_price     INTEGER DEFAULT 0,
  ship_price      INTEGER DEFAULT 0,
  total           INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'Yangi',
  note            TEXT DEFAULT '',
  install_at      TEXT DEFAULT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  status   TEXT NOT NULL,
  at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS callbacks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT DEFAULT '',
  phone      TEXT NOT NULL,
  note       TEXT DEFAULT '',
  slot       TEXT DEFAULT 'Tezroq',
  topic      TEXT DEFAULT '',
  channel    TEXT DEFAULT 'Telefon',
  status     TEXT DEFAULT 'Yangi',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  salt      TEXT NOT NULL,
  name      TEXT DEFAULT '',
  role      TEXT DEFAULT 'menejer'
);

CREATE INDEX IF NOT EXISTS idx_orders_phone  ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_events_order  ON order_events(order_id);
`);

try {
  const pCols = db.prepare("PRAGMA table_info(products)").all().map(c => c.name);
  if (!pCols.includes('desc')) {
    db.exec("ALTER TABLE products ADD COLUMN desc TEXT DEFAULT ''");
  }
  // Narx dvigateli: dollardagi tannarx, tovarga xos marjalar (NULL = standart) va usta narxi
  if (!pCols.includes('price_usd')) db.exec('ALTER TABLE products ADD COLUMN price_usd REAL DEFAULT NULL');
  if (!pCols.includes('margin')) db.exec('ALTER TABLE products ADD COLUMN margin REAL DEFAULT NULL');
  if (!pCols.includes('margin_usta')) db.exec('ALTER TABLE products ADD COLUMN margin_usta REAL DEFAULT NULL');
  if (!pCols.includes('price_usta')) db.exec('ALTER TABLE products ADD COLUMN price_usta INTEGER DEFAULT NULL');
  const oCols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!oCols.includes('usta')) db.exec('ALTER TABLE orders ADD COLUMN usta INTEGER DEFAULT 0');
} catch (e) {
  console.warn('Migration warning:', e.message);
}

// Usta sifatida ro'yxatdan o'tish arizalari (tasdiq — oldin o'rnatilgan kameralar rasmlari)
db.exec(`
CREATE TABLE IF NOT EXISTS ustas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  region      TEXT DEFAULT '',
  experience  TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  photos      TEXT DEFAULT '[]',
  status      TEXT DEFAULT 'Kutilmoqda',
  admin_note  TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ustas_status ON ustas(status);
`);

// "Ishlarimiz" videolari: layklar (qurilma bo'yicha bittadan) va izohlar (admin yashirishi mumkin)
db.exec(`
CREATE TABLE IF NOT EXISTS story_likes (
  story_id   TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (story_id, client_id)
);
CREATE TABLE IF NOT EXISTS story_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id   TEXT NOT NULL,
  client_id  TEXT DEFAULT '',
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  hidden     INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_story_comments_story ON story_comments(story_id, hidden);
`);

export const getSetting = (key, fallback = null) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
};

export const setSetting = (key, value) => {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
};
