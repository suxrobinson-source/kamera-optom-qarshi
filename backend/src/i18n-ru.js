/* Mahsulot ma'lumotlarining ruscha tarjimasi — o'zbekcha matn lug'at bo'yicha ruschaga o'giriladi.
   Lug'at: backend/data/i18n-ru.json → { sentences, fragments, names } (o'zbekcha → ruscha).
   - Raqamlar kalitda {n} bo'ladi; tarjimada {n} — tartib bo'yicha, {1}, {2}… — asl matndagi aniq o'rin.
   - "~ dum" kalitlari: "Model — tavsif." gaplarida model nomi o'zgarmaydi, faqat dumi tarjima qilinadi.
   Bazada products.ru ustuni (JSON): { name?, badge, spec, tags[], desc, specs[{k,v}], manual[] }.
   Faqat mijoz ilovasi uchun (admin panel o'zbekcha). manual[] — bazada qo'lda tuzatilgan maydonlar;
   avtomatik qayta hisoblashda ular saqlanadi. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DICT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'i18n-ru.json');
const NUM = /\d+(?:[.,]\d+)?/g;
const SENT = /(?<=[.!?])\s+/;
const FRAG = /( · | — |, )/;
const BRAND = /^(Dahua|HiLook|Hikvision|Ezviz|EZVIZ|Tapo|TP-Link|NEOCAM|Mercusys|Imou|IMOU|Linkff|Baofeng|Tenda)\b/;
const isModel = (h) => /^[A-Za-z0-9{}+\-\/(). ,_&]+$/.test(h) && (BRAND.test(h) || !/(^|[^A-Za-z])[a-z]{4,}/.test(h));
export const RU_FIELDS = ['name', 'badge', 'spec', 'tags', 'desc', 'specs'];

let DICT = null;
export function loadDict() {
  if (!DICT) {
    try { DICT = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8')); } catch (e) { DICT = {}; }
    DICT.sentences = DICT.sentences || {}; DICT.fragments = DICT.fragments || {}; DICT.names = DICT.names || {};
  }
  return DICT;
}

const fill = (tpl, nums) => {
  let i = 0;
  return tpl.replace(/\{(n|\d+)\}/g, (_, k) => (k === 'n' ? (nums[i++] ?? '') : (nums[+k - 1] ?? '')));
};
function look(map, s) {
  const key = s.replace(NUM, '{n}');
  return Object.prototype.hasOwnProperty.call(map, key) ? fill(map[key], s.match(NUM) || []) : null;
}
const hasWords = (s) => /[a-z]{3,}/i.test(s);

function trFrag(s, d) {
  const t = s.trim();
  if (!t || !hasWords(t)) return s;
  return look(d.fragments, t) ?? look(d.names, t) ?? s;
}
/* badge / spec / teg / xususiyat: " · ", " — ", ", " bo'yicha bo'laklab */
export function trList(s, d = loadDict()) {
  return String(s ?? '').split(FRAG).map((p, i) => (i % 2 ? p : trFrag(p, d))).join('');
}
function trSentence(s, d) {
  const t = s.trim();
  if (!hasWords(t)) return t;
  const r = look(d.sentences, t);
  if (r != null) return r;
  const i = t.indexOf(' — ');
  if (i > 0 && isModel(t.slice(0, i))) {
    const tail = look(d.sentences, '~ ' + t.slice(i + 3));
    if (tail != null) return t.slice(0, i) + ' — ' + tail;
  }
  return t;
}
/* Uzun tavsif: gapma-gap; lug'atda yo'q gap o'zbekcha qoladi */
export function trDesc(s, d = loadDict()) {
  return String(s ?? '').split(SENT).filter(Boolean).map((x) => trSentence(x, d)).join(' ');
}
export function trName(s, d = loadDict()) {
  const t = String(s ?? '').trim();
  return (t && look(d.names, t)) || t;
}

const parseArr = (v) => {
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
};
export function parseRu(v) {
  if (v && typeof v === 'object') return v;
  try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}

/* Mahsulotning (bazadagi qator) avtomatik ruscha maydonlari */
export function buildRu(p, d = loadDict()) {
  return {
    name: trName(p.name, d),
    badge: trList(p.badge, d),
    spec: trList(p.spec, d),
    tags: parseArr(p.tags).map((t) => trList(t, d)),
    desc: trDesc(p.desc, d),
    specs: parseArr(p.specs).map((s) => ({ k: trList(s && s.k, d), v: trList(s && s.v, d) })),
  };
}

/* Avtomatik tarjimani hisoblab, admin qo'lda yozgan (manual) maydonlarni saqlab qoladi */
export function refreshRu(row, d = loadDict()) {
  const old = parseRu(row.ru);
  const manual = Array.isArray(old.manual) ? old.manual.filter((f) => RU_FIELDS.includes(f)) : [];
  const ru = buildRu(row, d);
  for (const f of manual) if (old[f] !== undefined) ru[f] = old[f];
  if (manual.length) ru.manual = manual;
  return ru;
}

/* Mijozga beriladigan ko'rinish: faqat asl matndan farq qiladigan maydonlar; maxfiy xususiyatlar indeks bo'yicha olib tashlanadi */
export function publicRu(row, keepSpec = () => true) {
  const ru = parseRu(row.ru);
  if (!ru || !Object.keys(ru).length) return null;
  const out = {};
  if (ru.name && ru.name !== row.name) out.name = ru.name;
  for (const f of ['badge', 'spec', 'desc']) if (ru[f] && ru[f] !== row[f]) out[f] = ru[f];
  const tags = parseArr(row.tags);
  if (Array.isArray(ru.tags) && ru.tags.some((t, i) => t !== tags[i])) out.tags = ru.tags;
  const specs = parseArr(row.specs);
  if (Array.isArray(ru.specs) && ru.specs.length === specs.length) {
    const kept = ru.specs.filter((_, i) => keepSpec(specs[i]));
    if (kept.length) out.specs = kept;
  }
  return Object.keys(out).length ? out : null;
}
