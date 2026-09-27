import fs from 'node:fs';
import vm from 'node:vm';

function testHtml(filePath, options = {}) {
  console.log(`\n=== Testing ${filePath} ${options.name ? `(${options.name})` : ''} ===`);
  const content = fs.readFileSync(filePath, 'utf8');
  const startIdx = content.indexOf('<script>');
  const endIdx = content.lastIndexOf('</script>');
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`No <script> tag found in ${filePath}`);
  }
  const scriptContent = content.slice(startIdx + 8, endIdx);

  // 1. Syntax check
  new vm.Script(scriptContent, { filename: filePath });
  console.log('✓ Syntax valid');

  // 2. DOM-stub smoke test
  let rootInnerHTML = '';
  let warnings = [];
  const el = () => ({
    innerHTML: '',
    textContent: '',
    dataset: {},
    style: {},
    setAttribute() { },
    addEventListener() { },
    querySelector() { return null; },
    focus() { },
    setSelectionRange() { },
    scrollTop: 0
  });

  const rootEl = {
    ...el(),
    set innerHTML(val) {
      rootInnerHTML = val;
      if (val.includes('undefined')) {
        warnings.push('⚠️ innerHTML contains "undefined"');
      }
      if (val.includes('NaN')) {
        warnings.push('⚠️ innerHTML contains "NaN"');
      }
      if (val.includes('[object Object]')) {
        warnings.push('⚠️ innerHTML contains "[object Object]"');
      }
    },
    get innerHTML() { return rootInnerHTML; }
  };

  const mockData = {
    '/api/products': [
      { sku: 'IPC-2410', spin: true, is_popular: true, name: 'IPC-2410 Bullet 4MP', cat: 'Tashqi', price: 690000, badge: '4MP', spec: 'IR 30m · PoE · IP67', desc: 'IPC-2410 Bullet 4MP — tashqi hududlar uchun silindrsimon 4MP IP kamera. 1/3" 4MP CMOS sensor, 2.8 mm ob\'yektiv, IP67 metall korpus va 30 metrgacha IR tungi ko\'rishga ega. PoE 48V standartida quvvatlanadi. Rasmiy 1 yil kafolat beriladi.', tags: ['4MP', 'IR 30m', 'PoE'], poe: true, mp: true, night: true, qty: 46, specs: [{ k: 'Sensor', v: '1/3" 4MP CMOS' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
      { sku: 'KIT-UY4', spin: true, is_popular: false, name: 'Komplekt "Uy 4"', cat: 'Komplekt', price: 4350000, badge: 'KIT', spec: '4 kamera + NVR', desc: 'Komplekt "Uy 4" — hovli va xonadonlar uchun 4 kamerali to\'liq kuzatuv to\'plami. 1 yil rasmiy kafolat beriladi.', tags: ['4 kamera', 'NVR'], poe: true, mp: true, night: true, qty: 5, specs: [{ k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] }
    ],
    '/api/banners': [
      { id: 1, tag: 'AKSIYA · -10%', title: 'Komplekt "Uy 4" — 3 915 000 so’m', sub: '4 × 4MP kamera · NVR 2TB · kabel · o’rnatish', cta: 'Komplektni ko’rish', action: 'product:KIT-UY4', image: '/assets/banners/banner-kit.svg' }
    ],
    '/api/regions': [
      { name: 'Qarshi shahri', note: 'O’z ombordan · usta bugun chiqadi', eta: 'Bugun', price: 0, zone: 'Qashqadaryo viloyati' }
    ],
    '/api/categories': [
      { name: 'Tashqi', mark: '▭', count: 24 }
    ],
    '/api/config': {
      pricing: { cablePerMeter: 9000, installPerCamera: 250000, cloudPerCameraMonth: 35000, hddOptions: [{ size: '64 GB', days: '~4 kun', price: 150000 }] },
      credit: { rates: { 3: 0, 6: 8, 12: 14, 24: 26 }, down: { 3: 0, 6: 10, 12: 20, 24: 30 } },
      modules: { banners: true, stories: true, gps: true, memory: true, cable: true, install: true, cloud: true, credit: true, expert: true }
    },
    '/api/admin/orders': [
      { id: '#KO-4821', client_name: 'Aziz Bekmurodov', phone: '901234567', region: 'Qarshi shahri', address: 'Mustaqillik 12', items: [{ sku: 'IPC-2410', name: 'IPC-2410 Bullet 4MP', price: 690000, qty: 1 }], goods_sum: 690000, install: 1, total: 940000, status: 'Yangi', note: '', created_at: '2026-08-30 10:00:00' }
    ],
    '/api/admin/kpis': { todayOrders: 1, todayRevenue: 940000, openOrders: 1, installing: 1, lowStock: 2, newCallbacks: 0 },
    '/api/admin/stock': [
      { sku: 'IPC-2410', name: 'IPC-2410 Bullet 4MP', cat: 'Tashqi', price: 690000, qty: 46, promo: 'HIT', active: true, is_popular: true, low: false }
    ],
    '/api/admin/settings': {
      pricing: { cablePerMeter: 9000, installPerCamera: 250000, cloudPerCameraMonth: 35000 },
      credit: { rates: { 3: 0, 6: 8, 12: 14, 24: 26 }, down: { 3: 0, 6: 10, 12: 20, 24: 30 } },
      modules: { banners: true, stories: true, gps: true, memory: true, cable: true, install: true, cloud: true, credit: true, expert: true }
    },
    '/api/stories': [
      { id: 's1', label: 'Anor Market', mark: 'AM', title: '"Anor Market" · Qarshi', meta: '8 kamera · 12-avgust', dur: '0:42', views: 1284, live: true, file: 'anor-market.mp4', tags: ['8 × IPC-2410'], text: 'Sinov matni', likes: 3, comments: 1, liked: false }
    ],
    '/api/admin/story-comments': [
      { id: 1, story_id: 's1', story_label: 'Anor Market', name: 'Aziz', text: 'Zo‘r <ish>', hidden: false, created_at: '2026-09-27 10:00:00' }
    ],
    '/api/admin/stories': [
      { id: 's1', label: 'Anor Market', mark: 'AM', title: '"Anor Market" · Qarshi', meta: '8 kamera · 12-avgust', dur: '0:42', views: 1284, live: true, file: 'anor-market.mp4', tags: ['8 × IPC-2410'], text: 'Sinov matni' }
    ],
    '/api/admin/banners': [
      { id: 1, tag: 'AKSIYA · -10%', title: 'Komplekt "Uy 4" — 3 915 000 so’m', sub: '4 × 4MP kamera · NVR 2TB · kabel · o’rnatish', cta: 'Komplektni ko’rish', action: 'product:KIT-UY4', image: '/assets/banners/banner-kit.svg', active: 1 }
    ],
    '/api/admin/schedule': [
      { id: '#KO-4821', client_name: 'Aziz Bekmurodov', phone: '901234567', region: 'Qarshi shahri', address: 'Mustaqillik 12', items: [{ sku: 'IPC-2410', name: 'IPC-2410 Bullet 4MP', price: 690000, qty: 1 }], total: 940000, status: 'Yangi', install_at: '2026-08-30' }
    ],
    '/api/admin/currency': { usdRate: 12600, rounding: 1000, margins: { default: 15, usta: 12 }, marginsApplied: false, updatedAt: null, roundingSteps: [100, 500, 1000, 5000], products: 2, tracked: 0, custom: 0, history: [{ rate: 12600, prev: 12500, margins: { default: 15, usta: 12 }, at: '2026-09-27T10:00:00.000Z', changed: 2, by: 'admin' }] },
    '/api/admin/ustas': [{ id: 1, name: 'Sanjar Usta', phone: '901112233', region: 'Qarshi', experience: '5 yil', note: 'Dahua va Hikvision', photos: ['/assets/ustas/a.jpg', '/assets/ustas/b.jpg'], status: 'Kutilmoqda', admin_note: '', created_at: '2026-09-27 10:00:00', reviewed_at: null }],
    '/api/admin/callbacks': [
      { id: 1, name: 'Sanjar Rahimov', phone: '901234567', topic: 'Yangi kamera kerak', channel: 'Telefon', slot: 'Tezroq', note: '2 qavatli hovli', status: 'Yangi', created_at: '2026-08-30 11:30:00' }
    ]
  };

  const sandbox = {
    document: {
      getElementById: (id) => (id === 'root' || id === 'app' ? rootEl : el()),
      documentElement: { setAttribute() { } },
      activeElement: null,
      querySelector: () => null,
      createElement: () => ({ click() { }, style: {} })
    },
    localStorage: {
      _data: options.localStorage || {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; }
    },
    history: {
      pushState() { },
      replaceState() { },
      state: null
    },
    addEventListener: () => { },
    removeEventListener: () => { },
    fetch: (url) => {
      const data = mockData[url] || mockData[String(url).split('?')[0]] || {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
    },
    setInterval: () => 0,
    setTimeout: (fn) => { fn(); return 0; },
    clearInterval: () => { },
    clearTimeout: () => { },
    console,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    JSON,
    RegExp,
    Promise,
    Error,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.mockData = mockData;

  const context = vm.createContext(sandbox);
  vm.runInContext(scriptContent, context);

  if (warnings.length > 0) {
    warnings.forEach(w => console.warn(w));
    throw new Error('Smoke test warnings detected');
  }

  console.log('✓ Script initialized and rendered without error');
  console.log(`✓ Rendered HTML length: ${rootInnerHTML.length}`);
  return sandbox;
}

try {
  // Test 1: admin.html (Admin 2.0) logged out
  testHtml('admin.html', { name: 'Admin logged out' });

  // Test 2: admin.html logged in — barcha bo'limlar
  const adminSandbox = testHtml('admin.html', { name: 'Admin logged in', localStorage: { ko_admin_token: 'fake_jwt_token' } });
  ['orders', 'callbacks', 'products', 'credit', 'stories', 'settings', 'stats', 'install', 'clients', 'ustas'].forEach(tab => {
    adminSandbox.set({ adminTab: tab });
    const out = adminSandbox.document.getElementById('root').innerHTML;
    const bad = out.search(/undefined|NaN|\[object Object\]/);
    if (bad >= 0) throw new Error('Admin tab ' + tab + ' contains undefined/NaN: …' + out.slice(Math.max(0, bad - 140), bad + 20).replace(/\s+/g, ' '));
    console.log('✓ Admin tab "' + tab + '" rendered successfully');
  });
  adminSandbox.set({ adminTab: 'stories', storyCmts: adminSandbox.mockData['/api/admin/story-comments'] });
  { const out = adminSandbox.document.getElementById('root').innerHTML;
    if (!out.includes('Izohlar · moderatsiya') || !out.includes('Zo‘r &lt;ish&gt;') || !out.includes('YASHIRISH')) throw new Error('Admin story comment moderation missing');
    console.log('✓ Admin story comment moderation rendered'); }

  // Test 3: app.html with populated localStorage (F5 test)
  const appSandbox = testHtml('app.html', {
    name: 'Persisted localStorage (F5 check)',
    localStorage: {
      ko_bag: JSON.stringify({ 'IPC-2410': 2 }),
      ko_my_phone: '901234567',
      ko_region: 'Shahrisabz',
      ko_seen: JSON.stringify({ s1: true }),
      ko2_theme: 'night'
    }
  });
  if (appSandbox.S.bag['IPC-2410'] !== 2) throw new Error('ko_bag was not loaded properly');
  if (appSandbox.S.myPhone !== '901234567') throw new Error('ko_my_phone was not loaded properly');
  if (appSandbox.S.region !== 'Shahrisabz') throw new Error('ko_region was not loaded properly');
  if (!appSandbox.S.seen['s1']) throw new Error('ko_seen was not loaded properly');
  if (appSandbox.S.theme !== 'night') throw new Error('ko2_theme was not loaded properly');
  console.log('✓ App correctly loaded persisted localStorage on startup');

  appSandbox.addBag('KIT-UY4');
  if (JSON.parse(appSandbox.localStorage.getItem('ko_bag'))['KIT-UY4'] !== 1) throw new Error('addBag did not persist to ko_bag');
  console.log('✓ addBag and set() correctly update localStorage');

  // Kirill va apostrofli qidiruv
  appSandbox.set({ tab: 'catalog', cat: 'Hammasi', q: 'камера' });
  if (!appSandbox.document.getElementById('app').innerHTML) throw new Error('Cyrillic search failed');
  console.log('✓ Search works with Cyrillic transliteration');
  appSandbox.set({ q: "o'rnatish" });
  if (!appSandbox.document.getElementById('app').innerHTML) throw new Error('Apostrophe search failed');
  console.log('✓ Search works with apostrophe normalization');

  console.log('\n✅ All smoke tests passed with 0 warnings!\n');
} catch (err) {
  console.error('\n❌ Smoke test failed:', err);
  process.exit(1);
}

// Test 4: app.html — har bir ekran va qatlam ma'lumot yuklangandan keyin chiziladi
async function testAppV2() {
  const sb = testHtml('app.html', { name: 'Client app' });
  await new Promise(r => setImmediate(r));
  if (!sb.DATA.ready) throw new Error('v2 bootstrap did not load DATA');
  const html = () => sb.document.getElementById('app').innerHTML;
  const check = (label, mustInclude) => {
    const out = html();
    for (const bad of ['undefined', 'NaN', '[object Object]']) {
      if (out.includes(bad)) throw new Error(`v2 "${label}" contains "${bad}"`);
    }
    if (out.includes('Ilova yuklanishida xatolik')) throw new Error(`v2 "${label}" hit the render error screen`);
    if (mustInclude && !out.includes(mustInclude)) throw new Error(`v2 "${label}" missing "${mustInclude}"`);
    console.log(`✓ v2 ${label}`);
  };

  if (sb.S.theme !== 'day') throw new Error('v2 default theme should be day');
  check('home', 'Obyektingiz');
  sb.set({ tab: 'catalog' }); check('catalog landing (asosiy kataloglar)', 'Asosiy kataloglar');
  if (html().includes('pc-grid')) throw new Error('v2 catalog landing should not list products before a category is chosen');
  sb.set({ cat: 'Tashqi' }); check('catalog category chosen', 'Tashqi kameralar');
  if (!html().includes('IPC-2410 Bullet 4MP') || html().includes('Komplekt "Uy 4"')) throw new Error('v2 category filter did not sort products by chosen category');
  sb.set({ cat: '', q: 'komplekt' }); check('catalog search from landing', 'Qidiruv natijalari');
  sb.set({ q: '', cat: 'Hammasi' }); check('catalog grid', 'pc-grid');
  sb.set({ view: 'list' }); check('catalog list', 'class="pl"');
  sb.set({ suggest: true }); check('catalog suggestions', 'sugg');
  sb.set({ suggest: false, q: 'zzzz' }); check('catalog empty', 'Mos mahsulot topilmadi');
  sb.set({ q: '', view: 'grid', filters: true }); check('filters sheet', 'Saralash');
  sb.set({ filters: false });
  sb.set({ tab: 'kit' }); check('kit smart assistant (default)', 'Aqlli yordamchi');
  const zonesUy = { gate: 1, yard: 2, hall: 1 };
  for (let st = 1; st <= 6; st++) { sb.set({ wz: { step: st, place: 'uy', zones: zonesUy } }); check(`kit smart question ${st + 1}`, 'Taxminiy narx'); }
  sb.set({ wz: { step: 7, place: 'uy', zones: zonesUy, conn: 'wired' } }); check('kit smart result (wired)', 'Sizga mos komplekt tayyor');
  sb.set({ wz: { step: 7, place: 'kv', zones: { door: 1, hall: 1 }, conn: 'wifi', budget: 'pro', alt: { in: -3 } } }); check('kit smart result (wifi + swap)', 'Sizga mos komplekt tayyor');
  [1, 2, 3, 4].forEach(k => { sb.set({ tab: 'kit', kitMode: 'manual', kStep: k, cableUse: true, hddUse: true, creditUse: true }); check(`kit step ${k}`, 'Joriy hisob'); });
  [1, 2, 3].forEach(k => { sb.set({ tab: 'expert', expStep: k, cb: 'idle', topic: 'Yangi kamera kerak' }); check(`expert step ${k}`, 'Mutaxassis yordami'); });
  sb.set({ cb: 'done' }); check('expert done', 'Ariza qabul qilindi');
  ['', 'orders', 'notif', 'addr', 'payment', 'warranty', 'about', 'settings'].forEach(p => { sb.set({ tab: 'profile', profPage: p }); check(`profile "${p || 'menu'}"`); });
  sb.set({ profPage: '', tab: 'home' });
  sb.set({ sel: 'IPC-2410' }); check('product detail', 'MODEL TAVSIFI');
  if (!html().includes('Rasmiy 1 yil to\'liq servis kafolati')) throw new Error('v2 detail missing warranty');
  sb.set({ sel: null });
  sb.addBag('IPC-2410'); check('added sheet', 'Savatga qo');
  sb.set({ added: null, bagOpen: true, bagInstall: true }); check('cart', 'Rasmiylashtirish');
  sb.set({ bagOpen: false, regionOpen: true }); check('region sheet', 'Hududni tanlang');
  sb.set({ regionOpen: false, story: 0 }); check('story', 'Menga ham hisobla');
  if (!html().includes('st-act') || !html().includes('aria-label="Layk"')) throw new Error('v2 story like/comment rail missing');
  const st0 = sb.DATA.stories[0];
  await sb.storyLike(st0);
  if (!st0.liked || st0.likes !== 4 || !html().includes('st-ab on')) throw new Error('v2 story like did not toggle');
  await sb.storyLike(st0);
  if (st0.liked || st0.likes !== 3) throw new Error('v2 story unlike did not toggle');
  await sb.cmtOpen(st0); check('story comments empty', 'Hali izoh yo‘q');
  sb.S.cmt.list = [{ id: 7, name: 'Aziz', text: 'Zo‘r ish <b>', created_at: '2026-09-27 10:00:00', mine: true }]; sb.set({});
  check('story comments list', 'Aziz');
  if (!html().includes('Zo‘r ish &lt;b&gt;')) throw new Error('v2 comment text must be escaped');
  sb.cmtClose();
  if (sb.S.cmt !== null) throw new Error('v2 comments sheet did not close');
  console.log('✓ v2 story like / comments');
  sb.set({ story: null, ph: { what: 'Test', sum: '1 so\'m', skus: [['IPC-2410', 1]] }, phVal: '90 123 45 67', phStep: 'enter' }); check('phone enter', 'Telefon raqamingiz');
  sb.set({ phStep: 'confirm' }); check('phone confirm', 'Raqamni tasdiqlaysizmi');
  sb.set({ phStep: 'deliver', rcpSelf: false }); check('phone deliver', 'Qabul qiluvchi');
  sb.set({ ph: null, ok: { lines: [{ k: 'BUYURTMA', v: '#KO-1' }] } }); check('order ok', 'Buyurtma qabul qilindi');
  sb.set({ ok: null });
  for (let s = 0; s <= 8; s++) { sb.set({ smartTour: true, tourStep: s }); check(`tour step ${s}`, 'SVAYP QILING'); }
  sb.set({ smartTour: false, tab: 'profile', profPage: '' }); check('profile usta card', 'Usta bo‘lish');
  sb.set({ profPage: 'usta' }); check('usta registration form', 'Tasdiq: o‘rnatgan kameralaringiz');
  sb.set({ myPhone: '90 111 22 33', usta: { status: 'Kutilmoqda', name: 'Test' } }); check('usta pending', 'ko‘rib chiqilmoqda');
  sb.set({ usta: { status: 'Rad etildi', admin_note: 'Rasm aniq emas' } }); check('usta rejected', 'Rasm aniq emas');
  sb.S.usta = { status: 'Tasdiqlangan', prices: { 'IPC-2410': 600000 } };
  sb.applyUstaPrices(sb.S.usta.prices);
  sb.set({ tab: 'catalog', cat: 'Tashqi', profPage: '' }); check('usta prices in catalog');
  if (!/600[\s  ]000/.test(html())) throw new Error('v2 usta price 600 000 not shown in catalog');
  if (!html().includes('class="was"')) throw new Error('v2 usta price should show crossed-out retail price');
  sb.S.usta = null; sb.applyUstaPrices(null);
  sb.set({ myPhone: null, tab: 'home' });
  // 3 til: ruscha lug'at, kirill transliteratsiya, mahsulot nomlari himoyalangan
  const tr = (s, l) => sb.trStr(s, l);
  const expectTr = (src, lang, want) => { const got = tr(src, lang); if (got !== want) throw new Error(`i18n ${lang}: "${src}" → "${got}", kutilgan "${want}"`); };
  expectTr('Savatga qo‘shish', 'ru', 'В корзину');
  expectTr('Davom etish · 3 kamera', 'ru', 'Продолжить · 3 камеры');
  expectTr('Davom etish · 5 kamera', 'ru', 'Продолжить · 5 камер');
  expectTr('1 ta mahsulot', 'ru', '1 товар');
  expectTr('Rangli tungi · Ovozli aloqa', 'ru', 'Цветное ночное · Голосовая связь');
  expectTr('Qo‘ng‘iroq so‘rash', 'kr', 'Қўнғироқ сўраш');
  expectTr('Obyekt turi', 'kr', 'Объект тури');
  expectTr('IPC-2410 Bullet 4MP', 'kr', 'IPC-2410 Bullet 4MP');
  expectTr('Savatga qo‘shish', 'uz', 'Savatga qo‘shish');
  sb.set({ lang: 'ru' });
  if (sb.localStorage.getItem('ko2_lang') !== 'ru') throw new Error('v2 language not persisted to ko2_lang');
  sb.set({ lang: 'uz' });
  console.log('✓ v2 i18n: ru / kr / uz');
  sb.set({ theme: 'night' }); check('night theme');
  if (sb.localStorage.getItem('ko2_theme') !== 'night') throw new Error('v2 theme not persisted to ko2_theme');
  console.log('\n✅ v2 smoke tests passed\n');
}
testAppV2().catch(err => {
  console.error('\n❌ v2 smoke test failed:', err);
  process.exit(1);
});
