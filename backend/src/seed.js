import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, setSetting } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEzvizProducts() {
  const ezFile = path.join(__dirname, '..', 'data', 'ezviz-products.json');
  if (fs.existsSync(ezFile)) {
    try {
      return JSON.parse(fs.readFileSync(ezFile, 'utf8'));
    } catch (e) {
      console.warn("Ezviz JSON yuklashda ogohlantirish:", e.message);
    }
  }
  return [];
}

// Prototipdagi ma'lumotlar (Kuzatuv Kamera Savdo.dc.html) asosida seed

const products = [
  { sku: 'IPC-2410', spin: 1, name: 'IPC-2410 Bullet 4MP', cat: 'Tashqi', price: 690000, badge: '4MP', spec: 'IR 30m · PoE · IP67', desc: 'IPC-2410 Bullet 4MP — tashqi hududlar uchun silindrsimon 4MP IP kamera. 1/3" 4MP CMOS sensor, 2.8 mm ob\'yektiv (103° ko\'rish burchagi), IP67 metall korpus va 30 metrgacha IR tungi ko\'rishga ega. PoE 48V standartida quvvatlanadi. H.265+ kodek bilan disk xotirasini tejaydi. Rasmiy 1 yil kafolat beriladi.', tags: ['4MP', 'IR 30m', 'PoE'], poe: 1, mp: 1, night: 1, qty: 46, promo: 'HIT', specs: [{ k: 'Sensor', v: '1/3" 4MP CMOS' }, { k: 'Kecha ko\'rish', v: 'IR 30 m' }, { k: 'Ob\'yektiv', v: '2.8 mm / 103°' }, { k: 'Quvvat', v: 'PoE 48V' }, { k: 'Himoya', v: 'IP67 · metall korpus' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'PTZ-5X', spin: 1, name: 'PTZ-5X Dome 5MP', cat: 'Aylanuvchi', price: 1890000, badge: 'PTZ', spec: '5x zoom · IR 40m', desc: 'PTZ-5X Dome 5MP — 360° gorizontal va 90° vertikal aylanuvchi professional 5MP PTZ kamera. 5x optik zum, 40 metrgacha kuchli infraqizil tungi yoritish, IP66 ob-havo himoyasi va PoE+ quvvatga ega. Katta hovli, omborxona va korxonalar uchun mos. Rasmiy 1 yil kafolat beriladi.', tags: ['5MP', '5x zoom', 'Aylanadi'], poe: 1, mp: 1, night: 1, qty: 8, promo: 'YANGI', specs: [{ k: 'Sensor', v: '1/2.8" 5MP' }, { k: 'Zoom', v: '5x optik' }, { k: 'Burilish', v: '355° / 90°' }, { k: 'Kecha ko\'rish', v: 'IR 40 m' }, { k: 'Quvvat', v: 'PoE+ / 12V' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'NVR-8CH', name: 'NVR-8CH 4K registrator', cat: 'Yozuvchi', price: 1450000, badge: '4K', spec: '8 kanal · 2TB HDD', desc: 'NVR-8CH 4K registrator — 8 tagacha 4K IP videokamerani qabul qiluvchi tarmoq videoregistratori. H.265+ siqish orqali disk hajmini tejaydi. 2TB qattiq disk (10TB gacha qo\'llaydi), HDMI 4K video chiqishi va telefon orqali masofaviy kuzatuv imkoniyati bor. Rasmiy 1 yil kafolat beriladi.', tags: ['8 kanal', '2TB', 'H.265'], poe: 1, qty: 21, specs: [{ k: 'Kanallar', v: '8 · PoE' }, { k: 'Yozuv', v: '4K H.265+' }, { k: 'Disk', v: '2 TB (10 TB gacha)' }, { k: 'Arxiv', v: '~30 kun / 8 kamera' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'WIFI-MINI', spin: 1, name: 'WiFi Mini 3MP ichki', cat: 'Ichki', price: 390000, badge: 'Wi-Fi', spec: 'Ovoz · microSD', desc: 'WiFi Mini 3MP — xonadon va ofislar uchun ixcham ichki Wi-Fi kamera. 3MP (2K) aniqlik, 10 metrgacha tungi yoritish, ikki tomonlama ovozli aloqa (mikrofon va karnay) hamda 256GB gacha microSD karta uyasiga ega. Rasmiy 1 yil kafolat beriladi.', tags: ['3MP', 'Wi-Fi', 'Ovozli'], night: 1, qty: 63, specs: [{ k: 'Sensor', v: '3MP' }, { k: 'Ulanish', v: 'Wi-Fi 2.4G' }, { k: 'Xotira', v: 'microSD 256GB' }, { k: 'Aloqa', v: 'Ikki tomonlama ovoz' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'DOMO-IP2', spin: 1, name: 'IP Domofon 2MP', cat: 'Domofon', price: 1240000, badge: 'IP', spec: '7" ekran · qulf', desc: 'IP Domofon 2MP — 2MP tashqi chaqiruv paneli va 7 dyuymli ichki sensorli ekrandan iborat video domofon to\'plami. Eshik oldini jonli ko\'rish, mehmon bilan ikki tomonlama gaplashish va darvoza qulfini masofadan ochish imkoniyatiga ega. Rasmiy 1 yil kafolat beriladi.', tags: ['2MP', 'Domofon', 'Qulf'], poe: 1, night: 1, qty: 12, specs: [{ k: 'Panel', v: '2MP · 7" monitor' }, { k: 'Funksiya', v: 'Qulfni ochish' }, { k: 'Yozuv', v: 'Tashrif tarixi' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'SD-16', name: 'microSD 16GB Endurance', cat: 'Xotira', price: 65000, badge: '16GB', spec: '~1 kun uzluksiz yozuv', desc: 'microSD 16GB Endurance — videokuzatuv kameralarida 24/7 uzluksiz video yozish uchun maxsus yuqori chidamlilikdagi xotira kartasi. 1 yil rasmiy kafolat.', tags: ['16GB', 'U1', '24/7'], qty: 50, specs: [{ k: 'Hajm', v: '16 GB' }, { k: 'Klass', v: 'Class 10 · U1' }, { k: 'Resurs', v: '24/7 uzluksiz yozuv' }, { k: 'Arxiv', v: '~1 kun' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'SD-32', name: 'microSD 32GB Endurance', cat: 'Xotira', price: 95000, badge: '32GB', spec: '~2 kun uzluksiz yozuv', desc: 'microSD 32GB Endurance — 24/7 uzluksiz video yozish uchun Class 10 U1 yuqori resursli xotira kartasi. 1 yil rasmiy kafolat.', tags: ['32GB', 'U1', '24/7'], qty: 70, specs: [{ k: 'Hajm', v: '32 GB' }, { k: 'Klass', v: 'Class 10 · U1' }, { k: 'Resurs', v: '24/7 uzluksiz yozuv' }, { k: 'Arxiv', v: '~2 kun' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'SD-64', name: 'microSD 64GB Endurance', cat: 'Xotira', price: 150000, badge: '64GB', spec: '~4 kun uzluksiz yozuv', desc: 'microSD 64GB Endurance — U3 V30 tezlikdagi 24/7 uzluksiz video yozish xotira kartasi. 1 yil rasmiy kafolat.', tags: ['64GB', 'U3', '24/7'], qty: 88, specs: [{ k: 'Hajm', v: '64 GB' }, { k: 'Klass', v: 'U3 · V30' }, { k: 'Resurs', v: '24/7 uzluksiz yozuv' }, { k: 'Arxiv', v: '~4 kun' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'SD-128', name: 'microSD 128GB Endurance', cat: 'Xotira', price: 240000, badge: '128GB', spec: '~8 kun uzluksiz yozuv', desc: 'microSD 128GB Endurance — Full HD va 4K kameralar uchun U3 V30 yuqori chidamlilikdagi xotira kartasi. 1 yil rasmiy kafolat.', tags: ['128GB', 'U3', '24/7'], qty: 45, specs: [{ k: 'Hajm', v: '128 GB' }, { k: 'Klass', v: 'U3 · V30' }, { k: 'Resurs', v: '24/7 uzluksiz yozuv' }, { k: 'Arxiv', v: '~8 kun' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'SD-256', name: 'microSD 256GB Endurance', cat: 'Xotira', price: 420000, badge: '256GB', spec: '~16 kun uzluksiz yozuv', desc: 'microSD 256GB Endurance — uzoq muddatli uzluksiz arxiv uchun 256GB yuqori resursli xotira kartasi. 1 yil rasmiy kafolat.', tags: ['256GB', 'U3', '24/7'], qty: 34, specs: [{ k: 'Hajm', v: '256 GB' }, { k: 'Klass', v: 'U3 · V30' }, { k: 'Resurs', v: '24/7 uzluksiz yozuv' }, { k: 'Arxiv', v: '~16 kun' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'HDD-2T', name: 'HDD 2TB Surveillance', cat: 'Xotira', price: 620000, badge: '2TB', spec: 'NVR uchun · 30 kun', desc: 'HDD 2TB Surveillance — videokuzatuv registratorlari uchun 24/7 ishlovchi maxsus SATA qattiq disk. 1 yil rasmiy kafolat.', tags: ['2TB', 'SATA', '24/7'], qty: 19, specs: [{ k: 'Hajm', v: '2 TB' }, { k: 'Turi', v: 'Surveillance SATA' }, { k: 'Arxiv', v: '~30 kun / 8 kamera' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'NVR-16CH', name: 'NVR-16CH 4K registrator', cat: 'Yozuvchi', price: 2380000, badge: '16CH', spec: '16 kanal · 4TB', desc: 'NVR-16CH 4K registrator — 16 tagacha IP videokamera ulash imkonini beruvchi professional 4K tarmoq registratori. H.265+ kodek, 2 ta SATA HDD porti (16TB gacha), 4K HDMI chiqishi. Rasmiy 1 yil kafolat beriladi.', tags: ['16 kanal', '4TB', 'H.265'], poe: 1, qty: 6, specs: [{ k: 'Kanallar', v: '16 · PoE' }, { k: 'Yozuv', v: '4K H.265+' }, { k: 'Disk', v: '4 TB' }, { k: 'Arxiv', v: '~30 kun / 16 kamera' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'DVR-4CH', name: 'DVR-4CH analog registrator', cat: 'Yozuvchi', price: 790000, badge: 'DVR', spec: '4 kanal · 1TB', desc: 'DVR-4CH analog registrator — 4 ta analog (TVI/AHD/CVI/CVBS) kamerani birlashtiruvchi gibrid videoregistrator. 1080p yozuv, 1TB HDD, smartfondan kuzatuv. Rasmiy 1 yil kafolat beriladi.', tags: ['4 kanal', 'AHD', '1TB'], qty: 27, specs: [{ k: 'Kanallar', v: '4 · AHD/TVI' }, { k: 'Yozuv', v: '1080p' }, { k: 'Disk', v: '1 TB' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
  { sku: 'KIT-UY4', spin: 1, name: 'Komplekt "Uy 4"', cat: 'Komplekt', price: 4350000, badge: 'KIT', spec: '4 kamera + NVR', desc: 'Komplekt "Uy 4" — hovli va xonadonlar uchun to\'liq 4 kamerali kuzatuv tizimi. 4 ta 4MP tashqi IP67 kamera, 8 kanalli 4K NVR, 2TB HDD, 80m kabel va o\'rnatish xizmatini o\'z ichiga oladi. Barcha jihozlarga 1 yil rasmiy kafolat beriladi.', tags: ['4 kamera', 'NVR', 'O\'rnatish'], poe: 1, mp: 1, night: 1, qty: 5, promo: 'CHEGIRMA', specs: [{ k: 'Kameralar', v: '4 × IPC-2410 4MP' }, { k: 'Registrator', v: 'NVR-8CH + 2TB' }, { k: 'Kabel', v: '80 m UTP' }, { k: 'Xizmat', v: 'O\'rnatish va sozlash' }, { k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' }] },
];

const categories = [
  ['Tashqi', '▭'], ['Ichki', '◍'], ['Aylanuvchi', '◉'], ['Yozuvchi', '▤'],
  ['Xotira', '◰'], ['Domofon', '⌸'], ['Komplekt', '▦'], ['Tarmoq', '⌁'], ['Aksessuar', '⚙'],
];

const banners = [
  { tag: 'AKSIYA · -10%', title: 'Komplekt "Uy 4" — 3 915 000 so\'m', sub: '4 × 4MP kamera · NVR 2TB · kabel · o\'rnatish', cta: 'Komplektni ko\'rish', action: 'product:KIT-UY4', image: '/assets/banners/banner-kit.svg' },
  { tag: "MUDDATLI TO'LOV", title: '0% ustama bilan 3 oyga', sub: 'Boshlang\'ich to\'lovsiz · 15 daqiqada javob', cta: 'Hisoblab ko\'rish', action: 'tab:kit', image: '/assets/banners/banner-credit.svg' },
  { tag: 'BEPUL XIZMAT', title: 'Mutaxassis obyektni hisoblab beradi', sub: 'Nechta kamera, qancha kabel va xotira kerak — 24 soat ichida', cta: 'Mutaxassis chaqirish', action: 'tab:expert', image: '/assets/banners/banner-expert.svg' },
];

const stories = [
  { id: 's1', label: 'Anor Market', mark: 'AM', title: '"Anor Market" · Qarshi', meta: '8 kamera · 12-avgust', dur: '0:42', views: 1284, live: 1, file: 'anor-market.mp4', tags: ['8 × IPC-2410', 'NVR-8CH 4TB', 'Kassa ovozli'], text: 'Kassa, savdo zali va ombor to\'liq yopildi. Arxiv 30 kun, telefondan kuzatiladi.' },
  { id: 's2', label: 'Xususiy uy', mark: 'XU', title: '2 qavatli uy · Shahrisabz', meta: '4 kamera · 9-avgust', dur: '0:36', views: 912, live: 1, file: 'uy-shahrisabz.mp4', tags: ['4 × 4MP', 'Domofon', 'IR 30m'], text: 'Darvoza, hovli va kirish qismi. Domofon bilan birga ulandi.' },
  { id: 's3', label: 'Buxoro Textile', mark: 'BT', title: '"Buxoro Textile" sexi', meta: '16 kamera · 5-avgust', dur: '1:10', views: 2106, live: 1, file: 'textile-sex.mp4', tags: ['16 kanal', 'PTZ-5X', '4TB arxiv'], text: 'Ishlab chiqarish sexi va omborga 16 kamera. PTZ bilan butun sex nazorat qilinadi.' },
  { id: 's4', label: 'Avtomoyka', mark: 'AV', title: 'Avtomoyka · G\'uzor', meta: '6 kamera · 1-avgust', dur: '0:28', views: 648, live: 1, file: 'avtomoyka.mp4', tags: ['6 × IP67', 'PoE'], text: 'Yuvish boksi va tashqi maydon. Namlikka chidamli korpus tanlandi.' },
  { id: 's5', label: 'Dorixona', mark: 'DX', title: 'Dorixona tarmog\'i', meta: '3 filial · 28-iyul', dur: '0:51', views: 1037, live: 0, file: 'dorixona.mp4', tags: ['Bulut arxiv', 'Bitta ilova'], text: 'Uch filial bitta ilovaga ulandi — egasi hammasini bir ekrandan ko\'radi.' },
];

const qashqadaryo = [
  ['Qarshi shahri', 'O\'z ombordan · usta bugun chiqadi', 'Bugun'],
  ['Qarshi tumani', 'Kuryer bilan', 'Bugun'],
  ['Shahrisabz', 'Usta safar bilan', '1 kun'],
  ['Kitob', 'Usta safar bilan', '1 kun'],
  ['Chiroqchi', 'Kuryer bilan', '1 kun'],
  ['G\'uzor', 'Kuryer bilan', '1 kun'],
  ['Koson', 'Kuryer bilan', '1 kun'],
  ['Kasbi', 'Kuryer bilan', '1 kun'],
  ['Kamashi', 'Kuryer bilan', '1 kun'],
  ['Dehqonobod', 'Kuryer bilan', '1-2 kun'],
  ['Mirishkor', 'Kuryer bilan', '1-2 kun'],
  ['Muborak', 'Kuryer bilan', '1-2 kun'],
  ['Nishon', 'Kuryer bilan', '1-2 kun'],
  ['Yakkabog\'', 'Kuryer bilan', '1-2 kun'],
  ['Ko\'kdala', 'Kuryer bilan', '1-2 kun'],
];

const otherRegions = [
  'Toshkent shahri', 'Toshkent viloyati', 'Samarqand', 'Buxoro', 'Navoiy', 'Jizzax',
  'Sirdaryo', 'Surxondaryo', 'Farg\'ona', 'Andijon', 'Namangan', 'Xorazm', 'Qoraqalpog\'iston',
];

export async function runSeed({ force = false } = {}) {
  const already = (await db.get('SELECT COUNT(*) AS n FROM products')).n > 0;
  if (already && !force) return { seeded: false };

  await db.tx(async () => {
    await db.exec('DELETE FROM order_events; DELETE FROM orders; DELETE FROM callbacks; DELETE FROM products; DELETE FROM categories; DELETE FROM banners; DELETE FROM stories; DELETE FROM regions;');

    const insP = `INSERT INTO products (sku,name,cat,price,badge,spec,"desc",tags,specs,poe,mp,night,spin,qty,promo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    for (const p of products) {
      await db.run(insP, p.sku, p.name, p.cat, p.price, p.badge, p.spec, p.desc || '', JSON.stringify(p.tags), JSON.stringify(p.specs),
        p.poe ?? 0, p.mp ?? 0, p.night ?? 0, p.spin ?? 0, p.qty, p.promo ?? null);
    }
    for (const p of loadEzvizProducts()) {
      await db.run(insP, p.sku, p.name, p.cat, p.price, p.badge || '', p.spec || '', p.desc || '', JSON.stringify(p.tags || []), JSON.stringify(p.specs || []),
        p.poe ? 1 : 0, p.mp ? 1 : 0, p.night ? 1 : 0, p.spin ? 1 : 0, p.qty ?? 0, p.promo || null);
    }

    await insertCategories();
    for (const [i, b] of banners.entries()) {
      await db.run('INSERT INTO banners (tag,title,sub,cta,action,image,sort) VALUES (?,?,?,?,?,?,?)', b.tag, b.title, b.sub, b.cta, b.action, b.image || '', i);
    }
    for (const [i, st] of stories.entries()) {
      await db.run('INSERT INTO stories (id,label,mark,title,meta,dur,views,live,file,tags,text,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        st.id, st.label, st.mark, st.title, st.meta, st.dur, st.views, st.live, st.file, JSON.stringify(st.tags), st.text, i);
    }
    await insertRegions();

    // Biznes sozlamalari — prototipdagi kalkulyator narxlari
    await setSetting('pricing', DEFAULT_PRICING);
    await setSetting('credit', DEFAULT_CREDIT);
    await setSetting('modules', DEFAULT_MODULES);
    await setSetting('statusFlow', DEFAULT_FLOW);
    await setSetting('orderSeq', 4822);
  });
  return { seeded: true };
}

const DEFAULT_PRICING = {
  cablePerMeter: 9000,
  installPerCamera: 250000,
  cloudPerCameraMonth: 35000,
  usdRate: 12600,
  hddOptions: [
    { size: '16 GB', days: '~1 kun', price: 65000, sku: 'SD-16' },
    { size: '32 GB', days: '~2 kun', price: 95000, sku: 'SD-32' },
    { size: '64 GB', days: '~4 kun', price: 150000, sku: 'SD-64' },
    { size: '128 GB', days: '~8 kun', price: 240000, sku: 'SD-128' },
    { size: '256 GB', days: '~16 kun', price: 420000, sku: 'SD-256' },
  ],
};
const DEFAULT_CREDIT = {
  rates: { 3: 0, 6: 8, 12: 14, 24: 26 },
  down: { 3: 0, 6: 10, 12: 20, 24: 30 },
  providers: ['Uzum Nasiya', 'Alif Nasiya', 'Hamkor Nasiya'],
};
const DEFAULT_MODULES = { banners: true, stories: true, gps: true, memory: true, cable: true, install: true, cloud: true, credit: true, expert: true };
const DEFAULT_FLOW = ['Yangi', 'Tasdiqlandi', "O'rnatishda", 'Yopildi'];

async function insertCategories() {
  for (const [i, [name, mark]] of categories.entries()) {
    await db.run('INSERT INTO categories (name, mark, sort) VALUES (?,?,?) ON CONFLICT DO NOTHING', name, mark, i);
  }
}
async function insertRegions() {
  for (const [i, [name, note, eta]] of qashqadaryo.entries()) {
    await db.run('INSERT INTO regions (name,note,eta,price,zone,sort) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING', name, note, eta, 0, 'Qashqadaryo viloyati', i);
  }
  for (const [i, name] of otherRegions.entries()) {
    await db.run('INSERT INTO regions (name,note,eta,price,zone,sort) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING', name, 'Pochta / kuryer orqali', '2-3 kun', 30000, 'Boshqa viloyatlar', 100 + i);
  }
}

export async function ensureSchema() {
  // Jadvallar va ustunlar db.js da yaratiladi; bu yerda — asosiy ma'lumotnomalar va sozlamalar
  if ((await db.get('SELECT COUNT(*) AS n FROM categories')).n === 0) await insertCategories();
  if ((await db.get('SELECT COUNT(*) AS n FROM regions')).n === 0) await insertRegions();

  const row = await db.get('SELECT value FROM settings WHERE key = ?', 'pricing');
  if (!row) {
    await setSetting('pricing', DEFAULT_PRICING);
  } else {
    try {
      const pricing = JSON.parse(row.value);
      if (Array.isArray(pricing.hddOptions)) {
        let changed = false;
        pricing.hddOptions = pricing.hddOptions.map(opt => {
          if (!opt.sku) {
            changed = true;
            const sMap = { '16 GB': 'SD-16', '32 GB': 'SD-32', '64 GB': 'SD-64', '128 GB': 'SD-128', '256 GB': 'SD-256' };
            return { ...opt, sku: sMap[opt.size] || ('SD-' + opt.size.replace(/[^0-9]/g, '')) };
          }
          return opt;
        });
        if (changed) await setSetting('pricing', pricing);
      }
    } catch (e) { }
  }

  const has = async (key) => !!(await db.get('SELECT 1 AS x FROM settings WHERE key = ?', key));
  if (!(await has('credit'))) await setSetting('credit', DEFAULT_CREDIT);
  if (!(await has('modules'))) await setSetting('modules', DEFAULT_MODULES);
  if (!(await has('statusFlow'))) await setSetting('statusFlow', DEFAULT_FLOW);
  if (!(await has('orderSeq'))) await setSetting('orderSeq', 1001);
}

export async function ensureAdmin() {
  const exists = (await db.get('SELECT COUNT(*) AS n FROM admins')).n > 0;
  if (exists) return null;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  await db.run('INSERT INTO admins (username, pass_hash, salt, name, role) VALUES (?,?,?,?,?)', 'admin', hash, salt, 'Dilshod', 'menejer');
  return { username: 'admin', password };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  if (process.argv.includes('--force')) {
    const r = await runSeed({ force: true });
    console.log(r.seeded ? "Seed bajarildi (demo ma'lumotlar yuklandi)." : "Seed o'tkazib yuborildi.");
  } else {
    await ensureSchema();
    console.log("Sxema va asosiy konfiguratsiya tekshirildi (demo ma'lumotlar yuklanmadi).");
  }
  const admin = await ensureAdmin();
  if (admin) console.log(`Admin yaratildi — login: ${admin.username}, parol: ${admin.password}`);
  await db.close();
}
