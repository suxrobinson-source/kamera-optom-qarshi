import './env.js';
import crypto from 'node:crypto';
import { db } from './db.js';

const fromArg = !!process.argv[2];
const password = process.argv[2] || process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('Parol berilmadi: node src/reset-admin.js <parol> yoki ADMIN_PASSWORD muhit o‘zgaruvchisi');
  process.exit(1);
}
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const shown = fromArg ? password : '(ADMIN_PASSWORD)';

const exists = await db.get('SELECT id FROM admins WHERE username = ?', 'admin');
if (exists) {
  await db.run('UPDATE admins SET pass_hash = ?, salt = ? WHERE username = ?', hash, salt, 'admin');
  console.log(`Admin paroli yangilandi — login: admin, yangi parol: ${shown}`);
} else {
  await db.run('INSERT INTO admins (username, pass_hash, salt, name, role) VALUES (?,?,?,?,?)', 'admin', hash, salt, 'Dilshod', 'menejer');
  console.log(`Admin yaratildi — login: admin, parol: ${shown}`);
}
await db.close();
