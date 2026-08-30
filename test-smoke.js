import fs from 'node:fs';
import vm from 'node:vm';

function testHtml(filePath) {
  console.log(`\n=== Testing ${filePath} ===`);
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
      // Check for undefined, NaN, [object Object]
      if (val.includes('undefined')) {
        console.warn('⚠️ Warning: innerHTML contains "undefined"');
      }
      if (val.includes('NaN')) {
        console.warn('⚠️ Warning: innerHTML contains "NaN"');
      }
      if (val.includes('[object Object]')) {
        console.warn('⚠️ Warning: innerHTML contains "[object Object]"');
      }
    },
    get innerHTML() { return rootInnerHTML; }
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
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; }
    },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
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
  console.log('✓ Script initialized without error');
  console.log(`✓ Rendered HTML length: ${rootInnerHTML.length}`);
}

try {
  testHtml('admin.html');
  testHtml('app.html');
  console.log('\n✅ All smoke tests passed!\n');
} catch (err) {
  console.error('\n❌ Smoke test failed:', err);
  process.exit(1);
}
