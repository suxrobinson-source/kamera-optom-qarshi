import './env.js';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = '12h';

export async function login(username, password) {
  const admin = await db.get('SELECT * FROM admins WHERE username = ?', String(username || ''));
  if (!admin) return null;
  const hash = crypto.scryptSync(String(password || ''), admin.salt, 64).toString('hex');
  const ok = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(admin.pass_hash, 'hex'));
  if (!ok) return null;
  const token = jwt.sign({ sub: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, admin: { id: admin.id, username: admin.username, name: admin.name, role: admin.role } };
}

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token kerak' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token yaroqsiz yoki muddati o’tgan' });
  }
}
