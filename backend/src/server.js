import './env.js';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSeed, ensureAdmin } from './seed.js';
import { publicRouter } from './routes/public.js';
import { ordersRouter } from './routes/orders.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const seedResult = runSeed();
const newAdmin = ensureAdmin();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Banner rasmlari va boshqa statik fayllar
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
app.use(express.static(path.join(__dirname, '..', '..')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'index.html'));
});

app.get('/app', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'app.html'));
});

app.get('/admin', (_req, res) => {
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
  if (seedResult.seeded) console.log('Baza seed qilindi (prototip ma’lumotlari).');
  if (newAdmin) console.log(`Admin yaratildi — login: ${newAdmin.username}, parol: ${newAdmin.password}`);
});
