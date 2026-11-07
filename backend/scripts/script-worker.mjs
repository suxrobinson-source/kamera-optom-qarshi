#!/usr/bin/env node
/* KAMERA OPTOM — klon studiya ssenariy ishchisi (egasining kompyuterida ishlaydi).
   Admin paneldagi yangi mavzularni oladi, ssenariy variantlarini Claude Code (`claude -p`) orqali yozdiradi —
   bu Claude obunangiz limitidan sarflanadi, API kaliti kerak emas — va natijani serverga qaytaradi.

   Ishga tushirish (kalit admin paneldagi «Klon studiya» bo'limida ko'rsatilgan):
     node backend/scripts/script-worker.mjs --api https://kamera-optom-qarshi-129c3b4fde7e.herokuapp.com --key <ISHCHI_KALITI>
   yoki backend/.env ga STUDIO_API va STUDIO_WORKER_KEY yozib: node backend/scripts/script-worker.mjs
   Qo'shimcha: --model opus|sonnet (standart: Claude Code sozlamangizdagi model), --once (bitta ishni bajarib chiqish). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const f of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  break;
}
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const API = String(arg('api') || process.env.STUDIO_API || '').replace(/\/+$/, '');
const KEY = arg('key') || process.env.STUDIO_WORKER_KEY || '';
const MODEL = arg('model') || process.env.STUDIO_CLAUDE_MODEL || '';
const ONCE = process.argv.includes('--once');
if (!API || !KEY) {
  console.error('Foydalanish: node backend/scripts/script-worker.mjs --api <server manzili> --key <ishchi kaliti>');
  process.exit(1);
}

function claudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === 'win32') {
    const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return 'claude';
}

const log = (...a) => console.log(new Date().toLocaleTimeString('uz-UZ'), ...a);
async function api(p, opt = {}) {
  const r = await fetch(API + p, { ...opt, headers: { 'x-worker-key': KEY, 'Content-Type': 'application/json', ...(opt.headers || {}) }, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

/* claude -p: prompt stdin orqali, tizim prompti va JSON sxema argument bilan; vositalarsiz, sessiya saqlanmaydi */
function runClaude(job) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(job.schema), '--system-prompt', job.system,
      '--no-session-persistence', '--restricted', '--strict-mcp-config'];
    if (MODEL) args.push('--model', MODEL);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-script-'));   // loyiha CLAUDE.md lari aralashmasin
    const p = spawn(claudeBin(), args, { cwd, windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('Claude 6 daqiqada javob bermadi')); }, 6 * 60000);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    p.on('error', e => { clearTimeout(t); reject(new Error('claude ishga tushmadi: ' + e.message)); });
    p.on('close', code => {
      clearTimeout(t);
      fs.rmSync(cwd, { recursive: true, force: true });
      let j;
      try { j = JSON.parse(out); } catch (e) { return reject(new Error(`claude javobi JSON emas (kod ${code}): ` + (err || out).slice(0, 300))); }
      if (j.is_error) return reject(new Error('Claude: ' + String(j.result || j.subtype || 'xato').slice(0, 300)));
      let data = j.structured_output;
      if (!data && typeof j.result === 'string') { try { data = JSON.parse(j.result); } catch (e) { } }
      if (!data || !Array.isArray(data.variants)) return reject(new Error('Claude ssenariy qaytarmadi'));
      resolve(data.variants);
    });
    p.stdin.end(job.prompt);
  });
}

let backoff = 15000;
log(`Ssenariy ishchisi ishga tushdi → ${API}`);
for (;;) {
  try {
    const { job } = await api('/api/studio-worker/next');
    backoff = 15000;
    if (job) {
      log(`#${job.id} — ssenariy yozilmoqda…`);
      try {
        const variants = await runClaude(job);
        await api('/api/studio-worker/' + job.id, { method: 'POST', body: JSON.stringify({ variants }) });
        log(`#${job.id} — ${variants.length} ta variant yuborildi ✓`);
      } catch (e) {
        log(`#${job.id} — xato: ${e.message}`);
        await api('/api/studio-worker/' + job.id, { method: 'POST', body: JSON.stringify({ error: e.message }) }).catch(() => { });
      }
      if (ONCE) break;
      continue;
    }
    if (ONCE) { log('Navbatda ish yo‘q'); break; }
  } catch (e) {
    log('Server bilan aloqa yo‘q: ' + e.message);
    backoff = Math.min(backoff * 2, 5 * 60000);
  }
  await new Promise(r => setTimeout(r, backoff));
}
