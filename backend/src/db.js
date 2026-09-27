import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/* Ma'lumotlar bazasi qatlami — ikki rejim, bitta asinxron API:
   • DATABASE_URL berilmagan → lokal SQLite fayl (backend/data/kamera.db)
   • DATABASE_URL berilgan  → PostgreSQL (Heroku Postgres)
   Barcha so'rovlar `?` joy belgilari bilan yoziladi; Postgres uchun $1, $2 … ga o'giriladi.
   API: await db.get(sql, ...p) · db.all · db.run → { changes } · db.exec(sql) · db.tx(async () => …) */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
const PG_URL = process.env.DATABASE_URL || '';
export const dialect = PG_URL ? 'pg' : 'sqlite';

/* UTC vaqt "YYYY-MM-DD HH:MM:SS" — ikkala bazada bir xil matn ko'rinishida saqlanadi */
export const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

const NOW_SQL = dialect === 'pg' ? `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')` : `(datetime('now'))`;
const ID = dialect === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const MONEY = dialect === 'pg' ? 'BIGINT' : 'INTEGER';
const FLOAT = dialect === 'pg' ? 'DOUBLE PRECISION' : 'REAL';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  sku         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cat         TEXT NOT NULL,
  price       ${MONEY} NOT NULL,
  badge       TEXT DEFAULT '',
  spec        TEXT DEFAULT '',
  "desc"      TEXT DEFAULT '',
  tags        TEXT DEFAULT '[]',
  specs       TEXT DEFAULT '[]',
  poe         INTEGER DEFAULT 0,
  mp          INTEGER DEFAULT 0,
  night       INTEGER DEFAULT 0,
  spin        INTEGER DEFAULT 0,
  qty         INTEGER DEFAULT 0,
  promo       TEXT DEFAULT NULL,
  is_popular  INTEGER DEFAULT 0,
  active      INTEGER DEFAULT 1,
  images      TEXT,
  price_usd   ${FLOAT} DEFAULT NULL,
  margin      ${FLOAT} DEFAULT NULL,
  margin_usta ${FLOAT} DEFAULT NULL,
  price_usta  ${MONEY} DEFAULT NULL,
  created_at  TEXT DEFAULT ${NOW_SQL}
);

CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY,
  mark TEXT DEFAULT '',
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS banners (
  id     ${ID},
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
  price ${MONEY} DEFAULT 0,
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
  goods_sum       ${MONEY} DEFAULT 0,
  install         INTEGER DEFAULT 0,
  install_price   ${MONEY} DEFAULT 0,
  cloud           INTEGER DEFAULT 0,
  cloud_price     ${MONEY} DEFAULT 0,
  ship_price      ${MONEY} DEFAULT 0,
  total           ${MONEY} DEFAULT 0,
  status          TEXT DEFAULT 'Yangi',
  note            TEXT DEFAULT '',
  install_at      TEXT DEFAULT NULL,
  usta            INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT ${NOW_SQL}
);

CREATE TABLE IF NOT EXISTS order_events (
  id       ${ID},
  order_id TEXT NOT NULL REFERENCES orders(id),
  status   TEXT NOT NULL,
  at       TEXT DEFAULT ${NOW_SQL}
);

CREATE TABLE IF NOT EXISTS callbacks (
  id         ${ID},
  name       TEXT DEFAULT '',
  phone      TEXT NOT NULL,
  note       TEXT DEFAULT '',
  slot       TEXT DEFAULT 'Tezroq',
  topic      TEXT DEFAULT '',
  channel    TEXT DEFAULT 'Telefon',
  status     TEXT DEFAULT 'Yangi',
  created_at TEXT DEFAULT ${NOW_SQL}
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id        ${ID},
  username  TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  salt      TEXT NOT NULL,
  name      TEXT DEFAULT '',
  role      TEXT DEFAULT 'menejer'
);

-- Usta sifatida ro'yxatdan o'tish arizalari (tasdiq — oldin o'rnatilgan kameralar rasmlari)
CREATE TABLE IF NOT EXISTS ustas (
  id          ${ID},
  phone       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  region      TEXT DEFAULT '',
  experience  TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  photos      TEXT DEFAULT '[]',
  status      TEXT DEFAULT 'Kutilmoqda',
  admin_note  TEXT DEFAULT '',
  created_at  TEXT DEFAULT ${NOW_SQL},
  reviewed_at TEXT
);

-- "Ishlarimiz" videolari: layklar (qurilma bo'yicha bittadan) va izohlar (admin yashirishi mumkin)
CREATE TABLE IF NOT EXISTS story_likes (
  story_id   TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  created_at TEXT DEFAULT ${NOW_SQL},
  PRIMARY KEY (story_id, client_id)
);
CREATE TABLE IF NOT EXISTS story_comments (
  id         ${ID},
  story_id   TEXT NOT NULL,
  client_id  TEXT DEFAULT '',
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  hidden     INTEGER DEFAULT 0,
  created_at TEXT DEFAULT ${NOW_SQL}
);

-- Admin va mijozlar yuklagan rasmlar. Heroku diski vaqtinchalik, shuning uchun fayl bazada
-- (base64) saqlanadi va /assets/<papka>/<nom> manzilidan beriladi.
CREATE TABLE IF NOT EXISTS uploads (
  path       TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT DEFAULT ${NOW_SQL}
);

CREATE INDEX IF NOT EXISTS idx_orders_phone  ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_events_order  ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_ustas_status  ON ustas(status);
CREATE INDEX IF NOT EXISTS idx_story_comments_story ON story_comments(story_id, hidden);
`;

/* SQLite: eski bazalarda keyin qo'shilgan ustunlar */
const SQLITE_COLUMNS = {
  products: [['desc', `"desc" TEXT DEFAULT ''`], ['images', 'images TEXT'], ['is_popular', 'is_popular INTEGER DEFAULT 0'],
    ['price_usd', 'price_usd REAL DEFAULT NULL'], ['margin', 'margin REAL DEFAULT NULL'],
    ['margin_usta', 'margin_usta REAL DEFAULT NULL'], ['price_usta', 'price_usta INTEGER DEFAULT NULL']],
  orders: [['usta', 'usta INTEGER DEFAULT 0']],
};

/* `?` → `$n` (satr va identifikator ichidagilarga tegmaydi) */
export function toPg(sql) {
  let out = '', n = 0, q = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (q) { if (c === q) q = null; out += c; continue; }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    out += c === '?' ? '$' + (++n) : c;
  }
  return out;
}

const txStore = new AsyncLocalStorage();
let driver;

async function makeSqlite() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const conn = new DatabaseSync(path.join(DATA_DIR, 'kamera.db'));
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // Eski bazada jadvallar oldinroq yaratilgan bo'lishi mumkin — avval yetishmayotgan ustunlarni qo'shamiz
  for (const [table, cols] of Object.entries(SQLITE_COLUMNS)) {
    const have = conn.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!have.length) continue;
    for (const [name, ddl] of cols) if (!have.includes(name)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
  conn.exec(SCHEMA);
  // Tranzaksiya paytida boshqa so'rovlar uning ichiga aralashmasligi uchun navbat
  let txTail = Promise.resolve();
  const wait = () => (txStore.getStore() ? null : txTail);
  return {
    async get(sql, p) { await wait(); return conn.prepare(sql).get(...p); },
    async all(sql, p) { await wait(); return conn.prepare(sql).all(...p); },
    async run(sql, p) { await wait(); const r = conn.prepare(sql).run(...p); return { changes: Number(r.changes) }; },
    async exec(sql) { await wait(); conn.exec(sql); },
    async tx(fn) {
      const prev = txTail;
      let release;
      txTail = new Promise(r => { release = r; });
      await prev;
      try {
        return await txStore.run({ sqlite: true }, async () => {
          conn.exec('BEGIN IMMEDIATE');
          try { const out = await fn(); conn.exec('COMMIT'); return out; }
          catch (e) { conn.exec('ROLLBACK'); throw e; }
        });
      } finally { release(); }
    },
    async close() { conn.close(); },
  };
}

async function makePg() {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));   // BIGINT, COUNT(*)
  pg.types.setTypeParser(1700, v => (v === null ? null : Number(v))); // NUMERIC, SUM()
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(PG_URL) || /sslmode=disable/.test(PG_URL);
  const pool = new pg.Pool({
    connectionString: PG_URL.replace(/[?&]sslmode=disable/, ''),
    ssl: local ? false : { rejectUnauthorized: false },
    max: +process.env.PG_POOL_MAX || 5,
  });
  const cx = () => txStore.getStore()?.client || pool;
  const q = (sql, p = []) => cx().query(toPg(sql), p);
  await pool.query(SCHEMA);
  return {
    async get(sql, p) { return (await q(sql, p)).rows[0]; },
    async all(sql, p) { return (await q(sql, p)).rows; },
    async run(sql, p) { return { changes: (await q(sql, p)).rowCount }; },
    async exec(sql) { await cx().query(sql); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        return await txStore.run({ client }, async () => {
          await client.query('BEGIN');
          try { const out = await fn(); await client.query('COMMIT'); return out; }
          catch (e) { await client.query('ROLLBACK'); throw e; }
        });
      } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}

export const ready = (dialect === 'pg' ? makePg() : makeSqlite()).then(d => { driver = d; return d; });
const use = async () => driver || ready;

export const db = {
  dialect,
  get: async (sql, ...p) => (await use()).get(sql, p),
  all: async (sql, ...p) => (await use()).all(sql, p),
  run: async (sql, ...p) => (await use()).run(sql, p),
  exec: async (sql) => (await use()).exec(sql),
  /* Tranzaksiya: fn ichidagi barcha db.* chaqiruvlari bitta ulanishda bajariladi (ichma-ich — bitta tranzaksiya) */
  tx: async (fn) => (txStore.getStore() ? fn() : (await use()).tx(fn)),
  close: async () => (await use()).close(),
  /* SELECT … FOR UPDATE — faqat Postgres'da (SQLite tranzaksiyasi baribir bitta yozuvchi) */
  forUpdate: dialect === 'pg' ? ' FOR UPDATE' : '',
};

export const getSetting = async (key, fallback = null) => {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
};

export const setSetting = async (key, value) => {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value));
};

/* Buyurtma raqami: tranzaksiya ichida o'qib-yozish (bir vaqtdagi ikki buyurtma bir xil raqam olmasin) */
export const nextSeq = (key, start) => db.tx(async () => {
  const row = await db.get('SELECT value FROM settings WHERE key = ?' + db.forUpdate, key);
  const n = (row ? JSON.parse(row.value) : start) + 1;
  await setSetting(key, n);
  return n;
});
