import './env.js';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema, ensureAdmin } from './seed.js';
import { publicRouter } from './routes/public.js';
import { ordersRouter } from './routes/orders.js';
import { adminRouter } from './routes/admin.js';

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('kamera_optom_qarshi_jwt_secret_key')) {
  console.warn('⚠️ DIQQAT: JWT_SECRET xavfsiz emas yoki o‘rnatilmagan! .env faylida kuchli kalit o‘rnating.');
}

ensureSchema();
const newAdmin = ensureAdmin();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Banner rasmlari va boshqa statik fayllar
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
app.use(express.static(path.join(__dirname, '..', '..')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'index.html'));
});

// Mijoz ilovasi
app.get('/app', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname, '..', '..', 'app.html'));
});

// Admin panel
app.get('/admin', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname, '..', '..', 'admin.html'));
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'kamera-optom-backend' }));

app.use('/api', publicRouter);
app.use('/api', ordersRouter);
app.use('/api/admin', adminRouter);

app.use((req, res) => res.status(404).json({ error: `Yo'l topilmadi: ${req.method} ${req.path}` }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server xatosi' });
});

app.listen(PORT, () => {
  console.log(`KAMERA OPTOM QARSHI backend — http://localhost:${PORT}`);
  if (newAdmin) console.log(`Admin yaratildi — login: ${newAdmin.username}, parol: ${newAdmin.password}`);
});
