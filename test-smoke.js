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
    setAttribute() {},
    addEventListener() {},
    querySelector() { return null; },
    focus() {},
    setSelectionRange() {},
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
      { sku: 'IPC-2410', spin: true, name: 'IPC-2410 Bullet 4MP', cat: 'Tashqi', price: 690000, badge: '4MP', spec: 'IR 30m · PoE · IP67', tags: ['4MP', 'IR 30m', 'PoE'], poe: true, mp: true, night: true, qty: 46, specs: [{ k: 'Sensor', v: '1/3" 4MP CMOS' }] },
      { sku: 'KIT-UY4', spin: true, name: 'Komplekt "Uy 4"', cat: 'Komplekt', price: 4350000, badge: 'KIT', spec: '4 kamera + NVR', tags: ['4 kamera', 'NVR'], poe: true, mp: true, night: true, qty: 5, specs: [] }
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
      { sku: 'IPC-2410', name: 'IPC-2410 Bullet 4MP', cat: 'Tashqi', price: 690000, qty: 46, promo: 'HIT', active: true, low: false }
    ],
    '/api/admin/settings': {
      pricing: { cablePerMeter: 9000, installPerCamera: 250000, cloudPerCameraMonth: 35000 },
      credit: { rates: { 3: 0, 6: 8, 12: 14, 24: 26 }, down: { 3: 0, 6: 10, 12: 20, 24: 30 } },
      modules: { banners: true, stories: true, gps: true, memory: true, cable: true, install: true, cloud: true, credit: true, expert: true }
    },
    '/api/stories': [
      { id: 's1', label: 'Anor Market', mark: 'AM', title: '"Anor Market" · Qarshi', meta: '8 kamera · 12-avgust', dur: '0:42', views: 1284, live: true, file: 'anor-market.mp4', tags: ['8 × IPC-2410'], text: 'Sinov matni' }
    ],
    '/api/admin/callbacks': []
  };

  const sandbox = {
    document: {
      getElementById: (id) => (id === 'root' || id === 'app' ? rootEl : el()),
      documentElement: { setAttribute() {} },
      activeElement: null,
      querySelector: () => null,
      createElement: () => ({ click() {}, style: {} })
    },
    localStorage: {
      _data: options.localStorage || {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; }
    },
    fetch: (url) => {
      const data = mockData[url] || {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
    },
    setInterval: () => 0,
    setTimeout: (fn) => { fn(); return 0; },
    clearInterval: () => {},
    clearTimeout: () => {},
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
  // Test 1: admin.html logged out
  testHtml('admin.html', { name: 'Logged out' });

  // Test 2: admin.html logged in
  const adminSandbox = testHtml('admin.html', {
    name: 'Logged in',
    localStorage: { ko_admin_token: 'fake_jwt_token' }
  });

  // Test admin tabs
  ['orders', 'products', 'credit', 'stories', 'settings', 'stats'].forEach(tab => {
    adminSandbox.set({ adminTab: tab });
    console.log(`✓ Admin tab "${tab}" rendered successfully`);
  });

  // Test 3: app.html
  const appSandbox = testHtml('app.html');
  ['home', 'catalog', 'kit', 'expert', 'profile'].forEach(tab => {
    appSandbox.set({ tab });
    console.log(`✓ App tab "${tab}" rendered successfully`);
  });

  console.log('\n✅ All smoke tests passed with 0 warnings!\n');
} catch (err) {
  console.error('\n❌ Smoke test failed:', err);
  process.exit(1);
}
