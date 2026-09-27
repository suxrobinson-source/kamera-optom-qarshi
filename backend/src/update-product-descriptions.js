import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

function extractResolution(product) {
  const text = `${product.name || ''} ${product.badge || ''} ${product.spec || ''}`.toUpperCase();
  if (text.includes('8MP') || text.includes('4K')) return { label: '8MP (4K UHD)', px: '3840×2160' };
  if (text.includes('6MP')) return { label: '6MP', px: '3200×1800' };
  if (text.includes('5MP') || text.includes('3K')) return { label: '5MP (3K)', px: '2880×1620' };
  if (text.includes('4MP') || text.includes('2K+')) return { label: '4MP (2K+ QHD)', px: '2560×1440' };
  if (text.includes('3MP') || text.includes('2K')) return { label: '3MP (2K)', px: '2304×1296' };
  if (text.includes('1080P') || text.includes('2MP')) return { label: '2MP (1080p Full HD)', px: '1920×1080' };
  return { label: 'Full HD', px: '1920×1080' };
}

function generateModelDescription(p) {
  const sku = (p.sku || '').toUpperCase();
  const name = p.name || sku;
  const cat = p.cat || '';
  const spec = (p.spec || '').toLowerCase();
  const res = extractResolution(p);

  // 1. EZVIZ CAMERAS & DEVICES
  if (sku.startsWith('CS-H1C')) {
    return `${name} — xonadon, do'kon va ofis ichki qismini kuzatishga mo'ljallangan ixcham Wi-Fi kamera. ${res.label} aniqlikda video yozadi. 108° keng ko'rish burchagi, 10 metrgacha infraqizil tungi tasvir hamda ikki tomonlama ovozli so'zlashuv (mikrofon va karnay) bilan jihozlangan. Magnitli asosi metall yuzalarga tez va oson o'rnatish imkonini beradi. 512 GB gacha microSD karta va Ezviz CloudPlay bulut xotirasini qo'llab-quvvatlaydi. Rasmiy 1 yil kafolat bilan taqdim etiladi.`;
  }

  if (sku.startsWith('CS-H6C') || sku.startsWith('CS-C6C')) {
    const isPro = sku.includes('PRO');
    return `${name} — xona bo'ylab 360° gorizontal va 55° vertikal aylanuvchi ichki PTZ videokamera. ${res.label} matritsasi tiniq tasvir beradi. Harakatni avtomatik kuzatish (Auto-Tracking) va shovqin/yig'i aniqlash datchigiga ega.${isPro ? " Korpusida smartfonga bitta bosishda qo'ng'iroq qilish tugmasi mavjud." : ''} Maxfiylik zarur bo'lganda linzani jismoniy yopish (Privacy Shutter) rejimiga ega. 10 metrgacha tungi ko'rish, ikki tomonlama audio va 512 GB gacha microSD xotira uyasi bor. Rasmiy 1 yil kafolat beriladi.`;
  }

  if (sku.startsWith('CS-C6N')) {
    return `${name} — xonadon va bolalar xonasini 360° aylanib nazorat qiluvchi aqlli ichki Wi-Fi kamera. ${res.label} ruxsatdagi tasvir, Smart IR tungi yoritgich (10 metrgacha ob'yektga qarab yorug'likni avtomatik sozlaydi), ikki tomonlama so'zlashuv mikrofoni va karnay bilan jihozlangan. Harakat sezilganda obyekt ketidan avtomatik buriladi. Wi-Fi va LAN kabel orqali ulanadi, 512 GB gacha microSD karta qo'llab-quvvatlaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  if (sku.startsWith('CS-H7C')) {
    return `${name} — bitta korpusda ikkita mustaqil linzaga ega innovatsion ichki kamera. Yuqori linza statsionar keng burchakni doimiy ko'rsatib turadi, pastki linza esa 360° aylanib harakatlanuvchi obyektni kattalashtirib kuzatadi. ${res.label} aniqlik, rangli tungi ko'rish, inson qiyofasini aniqlash va ikki tomonlama ovozli aloqa mavjud. Ikkita xonani bitta kamera orqali to'liq nazorat qilish imkonini beradi. 512 GB gacha microSD xotirani qo'llab-quvvatlaydi. Rasmiy 1 yil kafolatga ega.`;
  }

  if (sku.startsWith('CS-H3C') || sku.startsWith('CS-H3') || sku.startsWith('CS-H4')) {
    const isColor = spec.includes('rangli') || sku.includes('COLOR');
    return `${name} — tashqi hovli, darvoza va ko'cha perimetri uchun silindrsimon kuzatuv kamerasi. IP67 himoyalangan korpusi yomg'ir, qor va changga to'liq chidamli. ${res.label} aniqlikdagi tasvir, ${isColor ? 'to\'liq rangli Color Night Vision' : '30 metrgacha infraqizil'} tungi ko'rish va sun'iy intellekt asosidagi odam harakatini aniqlash tizimi bilan ta'minlangan. O'rnatilgan mikrofon orqali atrofdagi ovozlarni yozib boradi. 512 GB gacha microSD karta va Wi-Fi/Ethernet orqali ishlaydi. Rasmiy 1 yil kafolat bilan beriladi.`;
  }

  if (sku.startsWith('CS-H8C') || sku.startsWith('CS-C8C')) {
    const is4G = sku.includes('4G');
    return `${name} — hovli va ochiq hududlarni to'liq qamrab oluvchi aylanuvchi tashqi kamera. Gorizontal 350° va vertikal 80° burchakda aylanib, ko'r zonalarni yo'qotadi. IP65 ob-havo himoyasiga ega mustahkam korpus. Inson va transport vositalarini aniqlaydi va obyekt orqasidan avtomatik buriladi. 30 metrgacha rangli tungi yoritish, faol himoya sirena/fonari hamda ikki tomonlama ovozli aloqaga ega.${is4G ? ' 4G LTE SIM-karta orqali simsiz internetga ulanadi.' : ' Wi-Fi va LAN kabel orqali ulanadi.'} 512 GB gacha microSD xotirani qo'llab-quvvatlaydi. Rasmiy 1 yil kafolatga ega.`;
  }

  if (sku.startsWith('CS-H80X') || sku.startsWith('CS-H8X') || sku.startsWith('CS-H80F')) {
    return `${name} — tashqi hududlar uchun mo'ljallangan ikkita linzali (8MP 4K asosiy linza + 2MP yordamchi linza) professional kuzatuv kamerasi. Dual-linzali optik tizim orqali keng burchakli umumiy panorama va detallarni bir vaqtda qayd etadi. 360° burilish imkoniyati, transport va inson harakatini AI orqali ajratish, 30 metrgacha to'liq rangli tungi ko'rish mavjud. Korpus IP65 himoyalangan. 512 GB gacha microSD karta va Wi-Fi/LAN ulanishga ega. Rasmiy 1 yil kafolat bilan beriladi.`;
  }

  if (sku.startsWith('CS-H9C') || sku.startsWith('CS-H90')) {
    return `${name} — ikkita linzali tashqi gibrid kamera (tepasida statsionar keng burchakli linza, pastida esa 360° aylanuvchi PTZ linza). Ikkala linza uyg'un holda ishlaydi: yuqori linza harakatni payqasa, pastki PTZ kamera obyekt tomonga burilib uni yaqindan kuzatadi. 30 metrgacha rangli tungi tasvir, AI odam/mashina filtri, faol yorug'lik va ovozli ogohlantirish mavjud. 512 GB gacha microSD qo'llab-quvvatlaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  if (sku.startsWith('CS-CB') || sku.startsWith('CS-EB') || sku.startsWith('CS-HB')) {
    const isSolar = spec.includes('quyosh') || spec.includes('solar');
    const is4G = sku.includes('4G');
    return `${name} — elektr tarmog'isiz ishlovchi mustaqil akkumulyatorli simsiz kamera. Qayta zaryadlanuvchi sig'imli litiy batareya${isSolar ? ' va quyosh paneli' : ''} orqali sim tortmasdan o'rnatiladi. PIR infraqizil datchigi odam harakatini aniqlab avtomatik uyg'onadi. ${res.label} aniqlikdagi tasvir, tungi yoritish, ikki tomonlama audio va ob-havo himoyasiga ega.${is4G ? ' 4G LTE SIM-karta orqali ulanadi.' : ' Wi-Fi orqali ulanadi.'} 512 GB gacha microSD qo'llab-quvvatlaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  if (sku.startsWith('CS-HP7')) {
    return `${name} — hovli va xonadonlar uchun 2-in-1 aqlli video domofon tizimi. 2K (3MP) aniqlikdagi tashqi chaqiruv paneli va uy ichidagi 7 dyuymli sensorli rangli ekranni o'z ichiga oladi. Mehmon qo'ng'iroq qilganda telefon ilovasiga video qo'ng'iroq yuboradi, smartfon orqali masofadan darvoza yoki eshik elektr qulfini ochish imkonini beradi. RFID kartalar va 512 GB gacha microSD arxivlashni qo'llab-quvvatlaydi. Rasmiy 1 yil kafolatga ega.`;
  }

  if (sku.startsWith('CS-DP2C') || sku.startsWith('CS-DP2')) {
    return `${name} — simsiz eshik video ko'zlagichi va aqlli qo'ng'iroq tizimi. Eshik tashqarisidagi 1080p keng burchakli kamera hamda ichki tomonga o'rnatiladigan 4.3 dyuymli rangli displeydan iborat. PIR harakat datchigi eshik oldida harakat sezilganda fotosurat olib telefonga xabar yuboradi. Qayta zaryadlanuvchi 4600 mAh litiy batareya bir necha oy xizmat qiladi. 256 GB gacha microSD karta qo'llab-quvvatlaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  if (sku.startsWith('CS-DL50FVS') || sku.startsWith('CS-DL20FVS')) {
    return `${name} — 3D strukturalangan yorug'lik texnologiyasiga ega biometrik aqlli eshik qulfi. Foydalanuvchi yuzini 0.5 soniyada taniydi va qorong'ida ham xatosiz ishlaydi. Shuningdek barmoq izi, raqamli parol, RFID karta, mexanik kalit va EZVIZ ilovasi orqali ochiladi. Eshik oldini ko'rsatuvchi o'rnatilgan kamera va ichki rangli ekran mavjud. Zaryadlanuvchi 5000 mAh litiy batareyadan quvvatlanadi. Rasmiy 1 yil kafolat bilan beriladi.`;
  }

  if (sku.startsWith('CS-DL')) {
    return `${name} — xonadon va ofislar uchun ishonchli biometrik aqlli qulf. Yarimo'tkazgichli barmoq izi skaneri, sensorli raqamli panel, RFID kartalar va favqulodda mexanik kalit orqali ochiladi. EZVIZ ilovasi orqali kim qachon eshikni ochganini kuzatish va vaqtinchalik mehmon parollarini berish mumkin. Rasmiy 1 yil kafolat bilan beriladi.`;
  }

  if (sku.startsWith('CS-T36') || sku.startsWith('CS-T30') || sku.startsWith('CS-T31')) {
    return `${name} — elektr tarmoqlarini smartfondan boshqarish uchun aqlli Wi-Fi rele/rozetka moduli. Yoritish, darvoza motorlari va maishiy texnikani ilovadan yoqish/o'chirish, vaqt jadvallari tuzish hamda elektr quvvati sarfini o'lchash imkonini beradi. Boshqa aqlli qurilmalar bilan o'zaro avtomatlashtirilgan ssenariylarda ishlaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  // 2. HIKVISION & HIWATCH IP CAMERAS
  if (sku.startsWith('IPC-B')) {
    const hasAudio = spec.includes('ovoz') || sku.includes('HA') || sku.includes('HAD');
    return `${name} — tashqi hududlar uchun silindrsimon (bullet) tarmoqli IP kamera. ${res.label} aniqlikdagi CMOS matritsasi, 2.8 mm keng burchakli ob'yektiv va 30 metrgacha EXIR tungi yoritgich bilan jihozlangan. Korpus IP67 standartida chang va kuchli yog'ingarchilikdan himoyalangan. H.265+ siqish kodeki orqali tarmoq trafigi va disk hajmini tejaydi. PoE (802.3af) va 12V DC quvvatlanishni qo'llab-quvvatlaydi.${hasAudio ? " O'rnatilgan mikrofon orqali audio yozib boradi." : ''} NVR registratorlar bilan barqaror ishlaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  if (sku.startsWith('IPC-T')) {
    const hasAudio = spec.includes('ovoz') || sku.includes('HA') || sku.includes('HAD');
    return `${name} — gumbazsimon (turret) tarmoqli IP kamera. Shiftga yoki devorga o'rnatish uchun qulay uch o'qli yo'naltirish mexanizmiga ega. ${res.label} ruxsatdagi matritsa, 2.8 mm keng burchakli ob'yektiv va 30 metrgacha EXIR tungi yoritish bilan ta'minlangan. IP67 himoyasi tufayli ichki va tashqi o'rnatishga to'liq mos keladi. PoE orqali bitta tarmoq kabelida signal va elektr quvvati uzatiladi.${hasAudio ? " O'rnatilgan mikrofon mavjud." : ''} Rasmiy 1 yil kafolat bilan taqdim etiladi.`;
  }

  if (sku.startsWith('IPC-D')) {
    return `${name} — vandalga qarshi (IK10) himoyalangan gumbazsimon (dome) IP kamera. Jamoat joylari, kirish yo'laklari va tashqi devorlar uchun mustahkam korpus. ${res.label} aniqlikdagi tasvir, 30 metrgacha EXIR infraqizil tungi yoritish, IP67 namlik himoyasi va PoE ulanishga ega. H.265+ video oqimini siqish texnologiyasi bilan ishlaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  if (sku.startsWith('IPC-C')) {
    return `${name} — ichki xonalar, kassa va ofislar uchun ixcham kubik IP kamera. ${res.label} aniqlikdagi tasvir, o'rnatilgan mikrofon va karnay (ikki tomonlama audio), PIR harakat datchigi va 10 metrgacha tungi yoritgichga ega. Wi-Fi yoki PoE kabel orqali ulanadi. 256 GB gacha microSD qo'llab-quvvatlaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  if (sku.startsWith('IPC-2410')) {
    return `${name} — tashqi hududlar uchun ishonchli silindrsimon 4MP IP kamera. 1/3" 4MP CMOS sensor, 2.8 mm ob'yektiv (103° ko'rish burchagi), IP67 metall korpus va 30 metrgacha IR tungi ko'rishga ega. PoE 48V standartida quvvatlanadi. H.265+ kodek bilan disk xotirasini tejaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  // 3. TURBO HD / ANALOG CAMERAS
  if (sku.startsWith('THC-B') || sku.startsWith('THC-T')) {
    const isDome = sku.startsWith('THC-T');
    return `${name} — analog koaksial kabel orqali ishlovchi Turbo HD ${isDome ? 'gumbazsimon' : 'silindrsimon'} kamera. 4-in-1 gibrid rejim (TVI/AHD/CVI/CVBS) tufayli barcha turdagi DVR registratorlarga mos tushadi. ${res.label} aniqlik, 20–30 metrgacha tungi EXIR yoritish va IP66/IP67 ob-havo himoyasiga ega. Mavjud eski analog kabel liniyasini yangilamasdan yuqori sifatli tasvir olish imkonini beradi. Rasmiy 1 yil kafolat beriladi.`;
  }

  // 4. PTZ CAMERAS
  if (sku.startsWith('PTZ-') || cat === 'Aylanuvchi') {
    return `${name} — professional aylanuvchi PTZ kamera. 360° uzluksiz gorizontal burilish, 90° vertikal og'ish hamda optik zum (zoom) imkoniyati bilan uzoq masofadagi obyektlarni yaqinlashtirib ko'rsatadi. Avtomatik patrul, oldindan sozlangan nuqtalar (presets) va kuchli tungi IR yoritgichga ega. Katta maydonlar, omborxonalar va ishlab chiqarish binolarini nazorat qilish uchun ideal yechim. Rasmiy 1 yil kafolat beriladi.`;
  }

  // 5. RECORDERS (NVR & DVR)
  if (sku.startsWith('NVR-') || sku.startsWith('HL-NVR') || (cat === 'Yozuvchi' && name.toUpperCase().includes('NVR'))) {
    const channels = sku.match(/\d{2,3}/) ? sku.match(/\d{2,3}/)[0] : '8';
    const chNum = channels.length === 3 ? channels.slice(1) : channels;
    return `${name} — ${chNum} tagacha IP videokamerani ulash va uzluksiz yozib olish uchun mo'ljallangan tarmoq registratori (NVR). 8MP (4K) gacha bo'lgan kameralarni qabul qiladi. H.265+ siqish kodeki orqali qattiq disk hajmini tejaydi. SATA porti orqali qattiq disk (HDD) ulanadi. HDMI (4K) va VGA video chiqishlari mavjud. Hik-Connect mobil ilovasi orqali smartfondan dunyoning istalgan nuqtasidan jonli ko'rish va arxivni tekshirish mumkin. Rasmiy 1 yil kafolat beriladi.`;
  }

  if (sku.startsWith('DVR-') || (cat === 'Yozuvchi' && name.toUpperCase().includes('DVR'))) {
    const ch = sku.includes('04') ? '4' : (sku.includes('08') ? '8' : (sku.includes('16') ? '16' : '4'));
    return `${name} — ${ch} kanalli gibrid raqamli videoregistrator (DVR). Analog (TVI/AHD/CVI/CVBS) va qo'shimcha IP kameralarni bitta tizimga birlashtiradi. H.265 Pro+ siqish texnologiyasi, SATA qattiq disk uyasi va mobil ilova orqali masofadan boshqaruvni qo'llab-quvvatlaydi. Rasmiy 1 yil kafolat beriladi.`;
  }

  // 6. NETWORK SWITCHES
  if (sku.startsWith('NS-')) {
    return `${name} — IP videokuzatuv tizimlari uchun mo'ljallangan PoE tarmoq kommutatori (switch). PoE portlari IEEE 802.3af/at standartlarini qo'llab-quvvatlaydi va kameralarga 250 metrgacha masofada ham signal, ham elektr quvvatini uzatadi (Extend PoE rejimi). Chaqmoq va kuchlanish sakrashlaridan himoyalangan. Rasmiy 1 yil kafolat bilan taqdim etiladi.`;
  }

  // 7. STORAGE (SD CARDS & HDD)
  if (sku.startsWith('SD-')) {
    return `${name} — videokuzatuv kameralari uchun maxsus Surveillance toifasidagi yuqori chidamlilikka ega (High Endurance) microSD xotira kartasi. 24/7 uzluksiz video yozish va qayta-qayta yozib o'chirish sikllariga moslashtirilgan. Class 10, U3 va V30 tezlik standartlari Full HD va 4K video oqimini to'xtovsiz yozishni kafolatlaydi. 1 yil rasmiy kafolat beriladi.`;
  }

  if (sku.startsWith('HDD-')) {
    return `${name} — videokuzatuv registratorlari (NVR/DVR) uchun maxsus ishlab chiqilgan 24/7 Surveillance seriyasidagi SATA qattiq disk. 64 tagacha videokamera oqimini bir vaqtning o'zida yozishga moslashgan, qizib ketishga chidamli va tebranishlarni kompensatsiya qiluvchi mexanizmga ega. Rasmiy 1 yil kafolat beriladi.`;
  }

  // 8. COMPLETE KITS
  if (sku.startsWith('KIT-') || cat === 'Komplekt') {
    return `${name} — hovli va xususiy xonadonlar uchun to'liq tayyor xavfsizlik to'plami. Tashqi IP67 himoyalangan kameralar, NVR tarmoq registratori, maxsus kuzatuv qattiq diski (HDD), kabel va montaj aksessuarlarini o'z ichiga oladi. O'rnatish va telefoningizga to'liq ulab berish xizmati bilan ta'minlanadi. Barcha jihozlarga 1 yil rasmiy kafolat beriladi.`;
  }

  // 9. GENERIC FALLBACK
  return `${name} — yuqori sifatli va ishonchli videokuzatuv uskunasi. Obyekt xavfsizligini 24/7 ta'minlash uchun texnik standartlarga to'liq javob beradi. Rasmiy 1 yil kafolat bilan taqdim etiladi.`;
}

function updateWarrantyInSpecs(specs) {
  const arr = Array.isArray(specs) ? [...specs] : [];
  let found = false;
  for (const s of arr) {
    if (s.k && s.k.toLowerCase().includes('kafolat')) {
      s.v = '1 yil (12 oy) rasmiy kafolat';
      found = true;
    }
  }
  if (!found) {
    arr.push({ k: 'Kafolat', v: '1 yil (12 oy) rasmiy kafolat' });
  }
  return arr;
}

async function main() {
  console.log('=== Updating product descriptions and warranty to 1 year ===');

  // 1. Update all-imported-products.json
  const allPath = path.join(DATA_DIR, 'all-imported-products.json');
  if (fs.existsSync(allPath)) {
    const items = JSON.parse(fs.readFileSync(allPath, 'utf8'));
    for (const item of items) {
      item.desc = generateModelDescription(item);
      item.specs = updateWarrantyInSpecs(item.specs);
    }
    fs.writeFileSync(allPath, JSON.stringify(items, null, 2), 'utf8');
    console.log(`✓ Updated ${items.length} products in all-imported-products.json`);
  }

  // 2. Update ezviz-products.json
  const ezPath = path.join(DATA_DIR, 'ezviz-products.json');
  if (fs.existsSync(ezPath)) {
    const items = JSON.parse(fs.readFileSync(ezPath, 'utf8'));
    for (const item of items) {
      item.desc = generateModelDescription(item);
      item.specs = updateWarrantyInSpecs(item.specs);
    }
    fs.writeFileSync(ezPath, JSON.stringify(items, null, 2), 'utf8');
    console.log(`✓ Updated ${items.length} products in ezviz-products.json`);
  }

  // 3. Update SQLite database kamera.db
  const rows = await db.all('SELECT sku, name, cat, badge, spec, specs FROM products');
  let updatedDbCount = 0;
  for (const row of rows) {
    let parsedSpecs = [];
    try { parsedSpecs = JSON.parse(row.specs); } catch (e) { }
    const newSpecs = updateWarrantyInSpecs(parsedSpecs);
    const newDesc = generateModelDescription({ ...row, specs: newSpecs });
    await db.run('UPDATE products SET "desc" = ?, specs = ? WHERE sku = ?', newDesc, JSON.stringify(newSpecs), row.sku);
    updatedDbCount++;
  }
  console.log(`✓ Updated ${updatedDbCount} products in the database (${db.dialect})`);

  // Sample check
  const sample = await db.all('SELECT sku, name, "desc", specs FROM products LIMIT 3');
  console.log('\nSample updated records:');
  sample.forEach(s => {
    console.log(`[${s.sku}] ${s.name}\nDesc: ${s.desc}\nSpecs Kafolat: ${JSON.parse(s.specs).find(x => x.k === 'Kafolat')?.v}\n`);
  });

  console.log('✅ Successfully updated all product descriptions and 1-year warranty!');
}

main().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});

