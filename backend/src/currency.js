import { db, getSetting, setSetting } from './db.js';

/* Narx dvigateli: dollar kursi + marja.
   `price_usd`  — tovarning dollardagi tannarxi (diler/optom narxi)
   `margin`, `margin_usta` — tovarga xos marja, NULL bo'lsa standart ishlatiladi
   `price`      — oddiy mijoz uchun sotuv narxi (so'm) = tannarx × kurs × (1 + marja%)
   `price_usta` — tasdiqlangan usta uchun narx (so'm) = tannarx × kurs × (1 + usta marjasi%)
   Mijoz ilovasi, savat va buyurtma summasi aynan so'mdagi narxlardan hisoblanadi,
   shuning uchun kurs yoki marja o'zgarsa ular shu yerda qayta yoziladi.
   Joriy kurs — `pricing.usdRate` (mahsulotlar shu kursda import qilingan). */

export const ROUNDING_STEPS = [100, 500, 1000, 5000];
export const RATE_MIN = 100;
export const RATE_MAX = 1000000;
export const MARGIN_MAX = 300;
export const DEFAULT_MARGINS = { default: 15, usta: 12 };

const round4 = v => Math.round(v * 10000) / 10000;
export const roundSom = (v, step) => Math.max(0, Math.round(v / step) * step);

export function parseRate(v) {
  const n = Math.round(Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) * 100) / 100;
  return Number.isFinite(n) && n >= RATE_MIN && n <= RATE_MAX ? n : null;
}

/* Marja: bo'sh → null (standartga qaytadi), noto'g'ri → undefined */
export function parsePct(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Math.round(Number(String(v).replace('%', '').replace(',', '.').trim()) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n <= MARGIN_MAX ? n : undefined;
}

export async function getMargins() {
  const m = (await getSetting('margins')) || {};
  const ok = v => v !== null && v !== undefined && Number.isFinite(+v) && +v >= 0 && +v <= MARGIN_MAX;
  return { default: ok(m.default) ? +m.default : DEFAULT_MARGINS.default, usta: ok(m.usta) ? +m.usta : DEFAULT_MARGINS.usta };
}

export async function getCurrency() {
  const pricing = (await getSetting('pricing')) || {};
  const meta = (await getSetting('currency')) || {};
  return {
    usdRate: +pricing.usdRate > 0 ? +pricing.usdRate : 0,
    rounding: ROUNDING_STEPS.includes(+meta.rounding) ? +meta.rounding : 1000,
    margins: await getMargins(),
    marginsApplied: !!meta.marginsApplied,
    updatedAt: meta.updatedAt || null,
    history: Array.isArray(meta.history) ? meta.history : [],
  };
}

export const sellPrice = (cost, marginPct, rate, step) => roundSom(cost * rate * (1 + marginPct / 100), step);

/* Bitta tovarning so'mdagi ikkala narxi (tannarx yoki kurs bo'lmasa — null). cur — await getCurrency() */
export function computeProduct({ price_usd, margin, margin_usta }, cur) {
  if (!(price_usd > 0) || !(cur.usdRate > 0)) return null;
  return {
    price: sellPrice(price_usd, margin ?? cur.margins.default, cur.usdRate, cur.rounding),
    price_usta: sellPrice(price_usd, margin_usta ?? cur.margins.usta, cur.usdRate, cur.rounding),
  };
}

/* Yangi kurs/marjalarda har bir narx qanday bo'lishini hisoblaydi (bazaga yozmaydi).
   Hali tannarxi yo'q tovarlarda joriy so'm narxi tannarx deb olinadi
   (import skripti diler narxini × kurs qilib yozgan). */
export async function planPricing(opts = {}) {
  const cur = await getCurrency();
  const rate = opts.usdRate > 0 ? opts.usdRate : cur.usdRate;
  const step = ROUNDING_STEPS.includes(+opts.rounding) ? +opts.rounding : cur.rounding;
  const margins = { ...cur.margins, ...(opts.margins || {}) };
  const baseRate = cur.usdRate > 0 ? cur.usdRate : rate;
  const items = (await db.all('SELECT sku, name, price, price_usta, price_usd, margin, margin_usta FROM products')).map(p => {
    const baselined = !(p.price_usd > 0);
    const cost = baselined ? round4(p.price / baseRate) : p.price_usd;
    return {
      sku: p.sku, name: p.name, cost, baselined,
      old: p.price, next: sellPrice(cost, p.margin ?? margins.default, rate, step),
      nextUsta: sellPrice(cost, p.margin_usta ?? margins.usta, rate, step),
      custom: p.margin !== null || p.margin_usta !== null,
    };
  });
  const pricing = (await getSetting('pricing')) || {};
  const hdd = Array.isArray(pricing.hddOptions)
    ? pricing.hddOptions.map(o => {
      const usd = o.usd > 0 ? o.usd : round4(o.price / baseRate);
      return { ...o, usd, price: sellPrice(usd, margins.default, rate, step), priceUsta: sellPrice(usd, margins.usta, rate, step) };
    })
    : null;
  return { cur, rate, step, margins, items, hdd };
}

export function summarize(plan) {
  const changed = plan.items.filter(i => i.next !== i.old);
  const avg = changed.length ? changed.reduce((n, i) => n + (i.next - i.old) / (i.old || 1), 0) / changed.length * 100 : 0;
  return {
    oldRate: plan.cur.usdRate,
    newRate: plan.rate,
    rounding: plan.step,
    margins: plan.margins,
    total: plan.items.length,
    changed: changed.length,
    up: changed.filter(i => i.next > i.old).length,
    down: changed.filter(i => i.next < i.old).length,
    avgPct: Math.round(avg * 100) / 100,
    baselined: plan.items.filter(i => i.baselined).length,
    custom: plan.items.filter(i => i.custom).length,
    samples: [...changed]
      .sort((a, b) => Math.abs(b.next - b.old) - Math.abs(a.next - a.old))
      .slice(0, 5)
      .map(({ sku, name, cost, old, next, nextUsta }) => ({ sku, name, cost, old, next, nextUsta })),
  };
}

/* Kurs va/yoki marjalarni qo'llaydi: barcha narxlar bitta tranzaksiyada qayta yoziladi */
export async function applyPricing(opts = {}, by = '') {
  const plan = await db.tx(async () => {
    const plan = await planPricing(opts);
    for (const i of plan.items) await db.run('UPDATE products SET price_usd = ?, price = ?, price_usta = ? WHERE sku = ?', i.cost, i.next, i.nextUsta, i.sku);
    const pricing = (await getSetting('pricing')) || {};
    await setSetting('pricing', { ...pricing, usdRate: plan.rate, ...(plan.hdd ? { hddOptions: plan.hdd } : {}) });
    await setSetting('margins', plan.margins);
    const meta = (await getSetting('currency')) || {};
    const at = new Date().toISOString();
    const entry = { rate: plan.rate, prev: plan.cur.usdRate, margins: plan.margins, at, changed: plan.items.filter(i => i.next !== i.old).length, by };
    await setSetting('currency', {
      ...meta, rounding: plan.step, marginsApplied: true, updatedAt: at,
      history: [entry, ...(Array.isArray(meta.history) ? meta.history : [])].slice(0, 20),
    });
    return plan;
  });
  return summarize(plan);
}

/* O'zbekiston Markaziy banki rasmiy kursi */
export async function fetchCbuRate() {
  const r = await fetch('https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/', { signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  const row = Array.isArray(data) ? data[0] : null;
  const rate = row ? parseFloat(String(row.Rate).replace(',', '.')) : NaN;
  if (!(rate > 0)) throw new Error('javobda kurs topilmadi');
  return { rate: Math.round(rate * 100) / 100, date: row.Date || null, source: 'cbu.uz' };
}
