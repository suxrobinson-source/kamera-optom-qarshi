/* KAMERA OPTOM — komplekt hisoblari (mijoz ilovasi va admin call-markaz uchun umumiy).
   Global `DATA` ({ products, config }) dan o'qiydi: ilovada — DATA, adminda — call-markaz uchun yuklangan ommaviy ma'lumot.
   Tayyor komplektlar shu ma'lumotdan yig'iladi va har biriga tahallus (kod) beriladi. */

/* RJ45 konnektor to'plamlari (RJ45-10/20/30): har kamera kabeliga 2 ta konnektor kerak */
function rjPacks() { return [10, 20, 30].map(n => (DATA.products || []).find(p => p.sku === 'RJ45-' + n)).filter(Boolean); }
function rjBest(cams) {
  const ps = rjPacks(), need = Math.max(1, +cams || 1) * 2;
  return (ps.find(p => +p.sku.slice(5) >= need) || ps[ps.length - 1] || {}).sku || null;
}

/* ═══ Komplekt v2.1 — taxminsiz, aniq tanlovlar asosida ═══
   Yo'l: Brend → Tur (IP / analog / Wi-Fi) → Kameralar (Ko'cha / Xona) → Registrator → Ulanish → Xotira → Xulosa.
   Qaysi brend/kameradan boshlansa, keyingi bosqichlar faqat shu brend va shu texnologiyaga mos mahsulotlarni ko'rsatadi.
   Tayyor komplektlar ham shu bosqichlarga yuklanadi — har birini o'zgartirish mumkin. */
const KB_BRANDS = ['Dahua', 'HiLook', 'NEOCAM', 'Ezviz', 'Tapo'];
const KB_TECH = {
  ip: { n: 'IP kameralar (simli, PoE)', s: 'Tarmoq kabeli orqali NVR registratorga ulanadi — eng ishonchli tizim' },
  analog: { n: 'Analog kameralar (HDCVI / Turbo HD)', s: 'XVR / DVR registrator va 12V quvvat bloki bilan ishlaydi' },
  wifi: { n: 'Wi-Fi / 4G kameralar (simsiz)', s: 'Har kamera o‘zi yozadi (microSD), telefon ilovasida ko‘rasiz' }
};
const KB_STEPS = [['brand', 'Brend'], ['tech', 'Tur'], ['cams', 'Kameralar'], ['rec', 'Registrator'], ['net', 'Ulanish'], ['store', 'Xotira'], ['sum', 'Xulosa']];
const KB_OUT = new Set(['DH-P3AE-PV', 'DH-P5AE-PV', 'TAPO-C675D-KIT']);
const kbAll = () => (DATA.products || []).filter(p => p.active !== 0 && p.active !== false);
const kbInStock = p => (p.qty ?? 1) > 0;
const kbTxt = p => ((p.spec || '') + ' ' + (Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags || '')) + ' ' + (p.name || '')).toLowerCase();

function kbBrand(p) {
  if (!p) return null;
  const n = String(p.name || '');
  if (/^HL-/.test(n)) return 'HiLook';
  const b = n.split(' ')[0];
  return KB_BRANDS.includes(b) ? b : null;
}
function kbIsCam(p) { return !!p && ['Tashqi', 'Ichki', 'Aylanuvchi'].includes(p.cat) && !!kbBrand(p); }
function kbTech(p) {
  const b = kbBrand(p), t = kbTxt(p);
  if (b === 'Ezviz' || b === 'Tapo') return 'wifi';
  if (/hdcvi|turbo hd|analog/.test(t)) return 'analog';
  if (p.poe || /\bpoe\b|onvif/.test(t)) return 'ip';
  if (/wi-?fi|\b4g\b|akkumulyator|quyosh/.test(t)) return 'wifi';
  return 'ip';
}
function kbPlace(p) {
  if (p.cat === 'Tashqi' || KB_OUT.has(p.sku)) return 'out';
  if (p.cat === 'Ichki') return 'in';
  const t = kbTxt(p);
  if (/ichki/.test(t)) return 'in';
  if (/ip6[5-7]|tashqi|ko.cha|quyosh|\b4g\b|zoom|ptz/.test(t)) return 'out';
  return 'in';
}
function kbMp(p) {
  const t = (p.badge || '') + ' ' + kbTxt(p);
  const ms = [...t.matchAll(/(\d+)\s*mp/gi)].map(m => +m[1]).filter(n => n > 0 && n < 50);
  if (ms.length) return Math.max(...ms);
  if (/\b4k\b/i.test(t)) return 8;
  if (/\b3k/i.test(t)) return 5;
  if (/\b2k\+/i.test(t)) return 4;
  if (/\b2k\b/i.test(t)) return 3;
  return 2;
}
function kbRecTech(p) {
  if (!p || p.cat !== 'Yozuvchi' || !kbBrand(p)) return null;
  const s = String(p.spec || '');
  if (/simsiz nvr/i.test(s)) return 'wifi';
  if (/^NVR/.test(s)) return 'ip';
  if (/XVR|DVR/.test(s)) return 'analog';
  return null;
}
const kbCh = p => { const m = String(p.badge || p.spec || '').match(/(\d+)\s*kanal/); return m ? +m[1] : 0; };
function kbRecMax(p) {
  const s = String(p.spec || '');
  const m = s.match(/(\d+)\s*MP gacha/);
  if (m) return +m[1];
  if (/1080N|1080p/i.test(s)) return 2;
  const m2 = s.match(/·\s*(\d+)\s*MP\b/);
  if (m2) return +m2[1];
  if (/\b4K\b/.test(s)) return 8;
  return 99;
}
function kbSata(p) { const m = String(p.spec || '').match(/(\d+)\s*SATA/); return m ? +m[1] : 1; }
function kbSwPorts(p) {
  if (!p || p.cat !== 'Tarmoq' || !/switch/i.test((p.name || '') + ' ' + (p.spec || ''))) return 0;
  const m = String(p.badge || '').match(/(\d+)\s*PoE/);
  return m ? +m[1] : 0;
}
function sdOptions() { return ((DATA.config && DATA.config.pricing && DATA.config.pricing.hddOptions) || []).filter(o => o.sku); }
/* microSD — narx sozlamalaridagi variant; savat va komplekt uchun mahsulot ko'rinishida */
function sdProd(sku) {
  const o = sdOptions().find(x => x.sku === sku);
  if (!o) return null;
  const usta = typeof isUsta === 'function' && isUsta() && o.priceUsta > 0;
  return { sku: o.sku, name: 'microSD ' + o.size, cat: 'Xotira', badge: o.size, spec: 'microSD karta · ' + o.size + ' · ' + (o.days || '') + ' uzluksiz yozuv', price: usta ? o.priceUsta : o.price, images: [], qty: 999, sd: true };
}
const kbProd = sku => (DATA.products || []).find(p => p.sku === sku) || sdProd(sku) || null;

function kbCamList(k) { return Object.keys(k.cams || {}).map(s => ({ p: kbProd(s), q: +k.cams[s] || 0 })).filter(x => x.p && x.q > 0); }
const kbCamCount = k => kbCamList(k).reduce((n, x) => n + x.q, 0);
const kbMaxMp = k => kbCamList(k).reduce((m, x) => Math.max(m, kbMp(x.p)), 0);
const kbBrandCams = (brand, tech) => kbAll().filter(p => kbIsCam(p) && kbBrand(p) === brand && (!tech || kbTech(p) === tech));
function kbRecs(k) {
  const n = Math.max(1, kbCamCount(k)), mp = kbMaxMp(k);
  const ok = kbAll().filter(p => kbBrand(p) === k.brand && kbRecTech(p) === k.tech && kbCh(p) >= n && kbRecMax(p) >= mp && kbInStock(p))
    .sort((a, b) => kbCh(a) - kbCh(b) || a.price - b.price);
  const tiers = [...new Set(ok.map(kbCh))].slice(0, 2);
  return ok.filter(p => tiers.includes(kbCh(p)) || p.sku === k.rec || p.sku === k.recWant);
}
function kbNeedSwitch(k) {
  if (k.tech !== 'ip') return false;
  const r = k.rec && k.rec !== 'none' ? kbProd(k.rec) : null;
  return !(r && r.poe && kbCamCount(k) <= kbCh(r));
}
function kbSwitches(k) {
  const n = Math.max(1, kbCamCount(k));
  const all = kbAll().filter(p => kbSwPorts(p) >= n && kbInStock(p)).sort((a, b) => kbSwPorts(a) - kbSwPorts(b) || a.price - b.price);
  const same = all.filter(p => kbBrand(p) === k.brand || (k.brand === 'HiLook' && /^NS-/.test(p.sku)));
  return [...same, ...all.filter(p => !same.includes(p))];
}
/* Kabel faqat 2 xil: tashqi (ko'cha) va ichki — narxi backend/src/set-cable-prices.js da qat'iy belgilangan */
const KB_CABLES = ['KAB-KABEL-KSVPP-4-2-0-52-CHERNYY-YUTP', 'KAB-KABEL-KSVPV-4-2-0-52-SERYY-YUTP'];
const kbCables = () => KB_CABLES.map(s => kbAll().find(p => p.sku === s)).filter(p => p && kbInStock(p));
const kbPowers = () => kbAll().filter(p => /^ACC-(IBP-12V|BBP-)/.test(p.sku) && kbInStock(p)).sort((a, b) => a.price - b.price);
const kbHdds = () => kbAll().filter(p => p.cat === 'Xotira' && /\bHDD\b/.test(p.name || '') && kbInStock(p)).sort((a, b) => a.price - b.price);
const kbUsesSd = k => k.tech === 'wifi' && !(k.rec && k.rec !== 'none');

/* Yuqori bosqich o'zgarganda pastdagilar mos kelmay qolsa — tozalanadi (hech narsa aralashib ketmasin) */
function kbFix(k) {
  k.cams = { ...(k.cams || {}) };
  if (k.brand && k.tech && !kbBrandCams(k.brand, k.tech).length) k.tech = null;
  Object.keys(k.cams).forEach(s => {
    const p = kbProd(s);
    if (!p || kbBrand(p) !== k.brand || kbTech(p) !== k.tech || !(k.cams[s] > 0)) delete k.cams[s];
  });
  if (k.recWant && !k.rec && kbRecs(k).some(p => p.sku === k.recWant)) k.rec = k.recWant;
  if (k.rec && k.rec !== 'none' && !kbRecs(k).some(p => p.sku === k.rec)) k.rec = null;
  if (k.sw && k.sw !== 'none' && (!kbNeedSwitch(k) || !kbSwitches(k).some(p => p.sku === k.sw))) k.sw = null;
  if (k.tech === 'wifi') { k.cable = null; k.cableM = ''; k.rj = null; k.power = null; }
  if (k.tech === 'analog') k.rj = null;
  if (k.tech === 'ip') k.power = null;
  if (k.store && k.store !== 'none') {
    const sdOk = sdOptions().some(o => o.sku === k.store);
    if (kbUsesSd(k) ? !sdOk : sdOk) k.store = null;
  }
  return k;
}
function kbStepOk(k, key) {
  if (key === 'brand') return !!k.brand;
  if (key === 'tech') return !!k.tech;
  if (key === 'cams') return kbCamCount(k) > 0;
  if (key === 'rec') return k.tech === 'wifi' || !!k.rec;
  if (key === 'net') return k.tech !== 'ip' || !kbNeedSwitch(k) || !!k.sw;
  if (key === 'store') return !!k.store;
  return true;
}
function kbLines(k) {
  const L = [];
  kbCamList(k).forEach(x => L.push({ role: 'Kamera', p: x.p, q: x.q }));
  if (k.rec && k.rec !== 'none') { const p = kbProd(k.rec); if (p) L.push({ role: 'Registrator', p, q: 1 }); }
  if (k.sw && k.sw !== 'none' && kbNeedSwitch(k)) { const p = kbProd(k.sw); if (p) L.push({ role: 'PoE switch', p, q: 1 }); }
  if (k.cable && +k.cableM > 0) { const p = kbProd(k.cable); if (p) L.push({ role: 'Kabel', p, q: +k.cableM, unit: 'm' }); }
  if (k.rj) { const p = kbProd(k.rj); if (p) L.push({ role: 'Konnektor', p, q: 1 }); }
  if (k.power) { const p = kbProd(k.power); if (p) L.push({ role: 'Quvvat bloki', p, q: 1 }); }
  if (k.store && k.store !== 'none') { const p = kbProd(k.store); if (p) L.push({ role: 'Xotira', p, q: Math.max(1, +k.storeQ || 1) }); }
  return L.map(l => ({ ...l, sum: l.p.price * l.q }));
}
function kbTotals(k) {
  const pricing = (DATA.config && DATA.config.pricing) || {};
  const lines = kbLines(k), goods = lines.reduce((n, l) => n + l.sum, 0), cams = kbCamCount(k);
  const free = pricing.freeShipFrom >= 0 && pricing.freeShipFrom != null ? +pricing.freeShipFrom : 1000000;
  const fee = pricing.shipFee >= 0 && pricing.shipFee != null ? +pricing.shipFee : 30000;
  const install = k.install && cams ? cams * (pricing.installPerCamera || 250000) : 0;
  const ship = lines.length ? (goods > free ? 0 : fee) : 0;
  return { lines, goods, install, ship, total: goods + install + ship, cams };
}

/* Tayyor komplekt: brend + tur + kamera soni — eng arzon mos mahsulotlardan, bosqichlarga yuklanadi */
function kbBuild(brand, tech, nOut, nIn, only) {
  const pool = kbBrandCams(brand, tech).filter(p => kbInStock(p) && (!only || only(p)));
  const pick = place => {
    const ps = pool.filter(p => kbPlace(p) === place).sort((a, b) => a.price - b.price);
    return ps.find(p => kbMp(p) >= 4) || ps[0] || null;
  };
  const k = { view: 'build', step: 'sum', brand, tech, place: 'out', cams: {}, rec: null, sw: null, cable: null, cableM: '', rj: null, power: null, store: null, storeQ: 1, install: false };
  const o = nOut ? pick('out') : null, i = nIn ? pick('in') : null;
  if ((nOut && !o) || (nIn && !i)) return null;
  if (o) k.cams[o.sku] = nOut;
  if (i) k.cams[i.sku] = (k.cams[i.sku] || 0) + nIn;
  const n = nOut + nIn;
  if (tech !== 'wifi') {
    const r = kbRecs(k)[0];
    if (!r) return null;
    k.rec = r.sku;
    if (kbNeedSwitch(k)) { const sw = kbSwitches(k)[0]; if (!sw) return null; k.sw = sw.sku; }
    /* tayyor komplekt arzon ko'rinsin: hammasida 500 GB disk (bo'lmasa — eng arzoni); kattaroq diskni mijoz xulosada tanlaydi */
    const hd = kbHdds();
    const gb = p => { const m = String(p.badge || '').match(/(\d+)\s*(TB|GB)/); return m ? +m[1] * (m[2] === 'TB' ? 1000 : 1) : 0; };
    const hdd = hd.find(p => gb(p) === 500) || hd[0];
    k.store = hdd ? hdd.sku : 'none';
    if (tech === 'ip') k.rj = rjBest(n);
    if (tech === 'analog') { const pw = kbPowers().filter(p => /IBP-12V/.test(p.sku)); k.power = ((n <= 4 ? pw[0] : pw[1] || pw[0]) || {}).sku || null; }
  } else {
    k.rec = 'none';
    const sd = sdOptions().find(x => /^32\b/.test(x.size)) || sdOptions()[0];
    k.store = sd ? sd.sku : 'none';
    k.storeQ = n;
  }
  return kbFix(k);
}
/* Tayyor komplekt turkumlari: Ommabop / Aksiya — admin belgilagan kameralardan (HIT, ommabop, CHEGIRMA);
   obyekt turlari — kamera soni bo'yicha; ichki turkum — brend yoki tizim turi. Bo'sh turkum ko'rsatilmaydi. */
const KB_GROUPS = [
  { id: 'pop', n: 'Ommabop to‘plamlar', s: 'Eng ko‘p tanlanadigan kameralardan', ic: 'star', sub: 'brand', only: p => !!p.is_popular || p.promo === 'HIT' },
  { id: 'sale', n: 'Aksiya to‘plamlar', s: 'Chegirmadagi kameralar bilan', ic: 'cash', sub: 'brand', only: p => p.promo === 'CHEGIRMA' },
  { id: 'home', n: 'Uy va kvartira uchun', s: '4 kamera · hovli, kirish va xonalar', ic: 'home', sub: 'tech', sizes: [[2, 2]] },
  { id: 'shop', n: 'Do‘kon va ofis uchun', s: '6 kamera · kirish, zal va kassa', ic: 'store', sub: 'tech', sizes: [[2, 4]] },
  { id: 'big', n: 'Ombor va katta hudud', s: '8–16 kamera · perimetr va hudud', ic: 'factory', sub: 'tech', techs: ['ip', 'analog'], sizes: [[6, 2], [12, 4]] },
  { id: 'box', n: 'Tayyor qutidagi to‘plamlar', s: 'Ishlab chiqaruvchining to‘liq to‘plamlari', ic: 'box', sub: 'brand', sets: true }
];
/* Tahallus (kod): turkum harfi + raqam — mijoz call-markazga aytadi, operator aynan shu komplektni topadi.
   P — ommabop, A — aksiya, U — uy, D — do'kon/ofis, O — ombor, Q — tayyor qutidagi to'plam */
const KB_ALIAS = { pop: 'P', sale: 'A', home: 'U', shop: 'D', big: 'O', box: 'Q' };
const KB_SUBN = { ip: 'IP kameralar (simli)', analog: 'Analog kameralar', wifi: 'Wi-Fi / 4G (simsiz)' };
function kbKit(b, t, o, i, only) {
  const k = kbBuild(b, t, o, i, only);
  if (!k) return null;
  const what = o && i ? o + ' ko‘cha + ' + i + ' xona kamera' : o ? o + ' ta ko‘cha kamerasi' : i + ' ta xona kamerasi';
  return { brand: b, tech: t, title: b + ' · ' + what, sub: KB_TECH[t].n.split(' (')[0] + ' · ' + (o + i) + ' kamera', k, goods: kbTotals(k).goods, cover: kbCamList(k)[0].p };
}
let _kbReady = null, _kbReadyKey = null;
function kbReady() {
  if (_kbReadyKey === DATA.products && _kbReady) return _kbReady;
  _kbReady = KB_GROUPS.map(g => {
    let items = [], n = 0;
    const L = KB_ALIAS[g.id] || 'K';
    /* raqam qat'iy tartibdagi o'rin bo'yicha: biror komplekt omborda tugasa ham boshqalarining kodi o'zgarmaydi */
    const tag = r => { if (r) { r.alias = L + '-' + String(n).padStart(2, '0'); r.group = g.n; items.push(r); } };
    if (g.sets) {
      const used = new Set();
      kbAll().filter(p => p.cat === 'Komplekt' && kbInStock(p)).sort((x, y) => (x.sku > y.sku ? 1 : -1)).forEach(p => {
        let c = 0;
        for (const ch of String(p.sku)) c = (c * 31 + ch.charCodeAt(0)) % 900;
        while (used.has(c)) c = (c + 1) % 900;
        used.add(c);
        items.push({ brand: kbBrand(p) || 'Boshqa', tech: 'set', set: p, goods: p.price, cover: p, alias: L + '-' + (100 + c), group: g.n });
      });
    } else if (g.only) {
      KB_BRANDS.forEach(b => Object.keys(KB_TECH).forEach(t => {
        n++;
        tag(kbKit(b, t, 2, 2, g.only) || kbKit(b, t, 4, 0, g.only) || kbKit(b, t, 0, 4, g.only));
      }));
    } else {
      (g.techs || Object.keys(KB_TECH)).forEach(t => KB_BRANDS.forEach(b => g.sizes.forEach(([o, i]) => { n++; tag(kbKit(b, t, o, i)); })));
    }
    const key = r => g.sub === 'tech' ? r.tech : r.brand;
    const order = g.sub === 'tech' ? Object.keys(KB_TECH) : [...KB_BRANDS, 'Boshqa'];
    const subs = order.map(id => ({ id, n: g.sub === 'tech' ? KB_SUBN[id] : id, items: items.filter(r => key(r) === id).sort((a, b) => a.goods - b.goods) })).filter(x => x.items.length);
    return { ...g, items, subs };
  }).filter(g => g.items.length);
  _kbReadyKey = DATA.products;
  return _kbReady;
}

/* Tahallusni solishtirish uchun: "u 7", "U-07", "у-07" → "U-7" */
function kbAliasNorm(v) {
  const cyr = { 'А': 'A', 'Д': 'D', 'О': 'O', 'П': 'P', 'У': 'U', 'Қ': 'Q', 'К': 'K' };
  const s = String(v || '').toUpperCase().replace(/[АДОПУҚК]/g, c => cyr[c]).replace(/[^A-Z0-9]/g, '');
  const m = s.match(/^([A-Z])0*(\d+)$/);
  return m ? m[1] + '-' + m[2] : '';
}
const kbAllKits = () => kbReady().reduce((a, g) => a.concat(g.items), []);
function kbFindAlias(code) {
  const c = kbAliasNorm(code);
  return c ? kbAllKits().find(r => kbAliasNorm(r.alias) === c) || null : null;
}
const kbKitName = r => (r.set ? r.set.name : r.title);
/* Savatga tushadigan tarkib: [{ sku, qty }] */
const kbKitItems = r => (r.set ? [{ sku: r.set.sku, qty: 1 }] : kbLines(r.k).map(l => ({ sku: l.p.sku, qty: l.q })));
/* Tayyor komplekt o'zgartirilmaganini bilish uchun imzo */
const kbSig = k => kbLines(k).map(l => l.p.sku + ':' + l.q).join(',');
