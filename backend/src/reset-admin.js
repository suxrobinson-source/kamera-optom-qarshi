import './env.js';
import crypto from 'node:crypto';
import { db } from './db.js';

const password = process.argv[2] || process.env.ADMIN_PASSWORD || 'admin123';
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

const exists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
if (exists) {
  db.prepare('UPDATE admins SET pass_hash = ?, salt = ? WHERE username = ?').run(hash, salt, 'admin');
  console.log(`Admin paroli yangilandi — login: admin, yangi parol: ${password}`);
} else {
  db.prepare('INSERT INTO admins (username, pass_hash, salt, name, role) VALUES (?,?,?,?,?)')
    .run('admin', hash, salt, 'Dilshod', 'menejer');
  console.log(`Admin yaratildi — login: admin, parol: ${password}`);
}
