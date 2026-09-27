import openpyxl
import os
import sys
import io
import re
import json
import sqlite3

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

EXCEL_PATH = r'D:\downloads\Telegram Desktop\Ezviz price 31.07.2026.xlsx'
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BACKEND_DIR, 'data', 'kamera.db')
ASSETS_DIR = os.path.join(BACKEND_DIR, 'assets', 'products')

os.makedirs(ASSETS_DIR, exist_ok=True)

print(f"Loading Excel: {EXCEL_PATH}")
wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
sheet = wb['Ezviz']

# 1. Collect all images with their coordinates
all_imgs = []
for i, img in enumerate(sheet._images):
    f_r = img.anchor._from.row + 1
    f_c = img.anchor._from.col
    data = img._data()
    all_imgs.append({
        'idx': i,
        'row': f_r,
        'col': f_c,
        'data': data,
        'size': len(data),
        'format': img.format.lower() if img.format else 'png'
    })

print(f"Found {len(all_imgs)} embedded images in sheet.")

# 2. Helper functions
def generate_sku(row_num, model_raw, desc_raw):
    m = model_raw.strip()
    d = desc_raw.strip().lower()
    
    if row_num == 38 and 'poe' in d:
        return 'CS-H8C-3MP-POE'
    if row_num == 66:
        return 'CS-SD7-SCREEN'
    if row_num == 81:
        return 'CS-T30-10B-EU'
    if row_num == 82:
        return 'CS-T31-16E-EU'
    if row_num == 69:
        return 'CS-DL05-M'
    if row_num == 70:
        return 'CS-L2-11FCP-BLACK'
    if row_num == 71:
        return 'CS-DL06-PRO-DOUBLE'
    if row_num == 72:
        return 'CS-DL06-WBCP'
    if row_num == 73:
        return 'CS-DL20FVS'
    if row_num == 74:
        return 'CS-DL50FVS'
    if row_num == 52:
        return 'CS-HB8C-SP-4G'
    if row_num == 53:
        return 'CS-HB8C-SP-4MP'
    if row_num == 54:
        return 'CS-HB8C-SP-6MP'
    if row_num == 55:
        return 'CS-HB90-SP'
    if row_num == 56:
        return 'CS-HB90X-SP-4G'
    if row_num == 43:
        return 'CS-H80X-10MP'
    if row_num == 45:
        return 'CS-H80F-12MP'
    if row_num == 46:
        return 'CS-H90-DUAL-8MP'
    if row_num == 47:
        return 'CS-H9C-6MP'
    if row_num == 48:
        return 'CS-H9C-10MP'
    if row_num == 49:
        return 'CS-H9C-4G-10MP'
        
    cleaned = re.sub(r'[\(\)]', ' ', m)
    cleaned = re.sub(r'[\/]', '-', cleaned)
    cleaned = re.sub(r'[\s_]+', '-', cleaned)
    cleaned = re.sub(r'-+', '-', cleaned).strip('-').upper()
    
    if not cleaned.startswith('CS-') and not cleaned.startswith('EZVIZ-'):
        cleaned = 'CS-' + cleaned
        
    return cleaned

def clean_display_name(model_raw, desc_raw, row_num):
    m = model_raw.strip()
    m = re.sub(r'\s+', ' ', m)
    
    if row_num == 38:
        return 'Ezviz CS-H8c (3MP) PoE'
    if row_num == 66:
        return 'Ezviz CS-SD7 Smart Monitor 7"'
    if row_num == 81:
        return 'Ezviz CS-T30-10B Smart Rozetka 10A'
    if row_num == 82:
        return 'Ezviz CS-T31-16E Smart Rozetka 16A'
    if row_num == 70:
        return 'Ezviz CS-L2-11FCP Aqlli Qulf (Black)'
    if row_num == 71:
        return 'Ezviz CS-DL06 Pro Double Protection Aqlli Qulf'
    if row_num == 72:
        return 'Ezviz CS-DL06 Aqlli Qulf'
    if row_num == 73:
        return 'Ezviz CS-DL20FVS Yuz/Tomir tanuvchi Qulf'
    if row_num == 74:
        return 'Ezviz CS-DL50FVS 3D Yuz tanuvchi Qulf'
        
    m = re.sub(r'\s+Умная розетка', '', m)
    m = re.sub(r'\s+Умный экран', '', m)
    
    if not m.lower().startswith('ezviz'):
        m = 'Ezviz ' + m
    return m

def categorize(m, desc):
    m_lower = m.lower()
    d_lower = desc.lower()
    
    # Doorbells / Intercoms
    if any(k in m_lower for k in ['dp2', 'hp2', 'hp4', 'ep4', 'hp5', 'hp7']) or 'глазок' in d_lower or 'домофон' in d_lower or 'дверной звонок' in d_lower:
        return 'Domofon'
    
    # NVRs
    if any(k in m_lower for k in ['r5c', 'x5s']) or 'видеорегистратор' in d_lower or 'nvr' in d_lower:
        return 'Yozuvchi'
    
    # Smart locks & smart home -> Domofon / Xavfsizlik
    if any(k in m_lower for k in ['dl03', 'dl04', 'dl05', 'l2-11fcp', 'dl06', 'dl20', 'dl50']) or 'замок' in d_lower:
        return 'Domofon'
        
    if any(k in m_lower for k in ['solar panel', 'power partne', 'pb18', 't36', 't30', 't31', 'cpu-r200', 'sd7']):
        return 'Domofon'
    
    # PTZ / Aylanuvchi
    if any(k in m_lower for k in ['c8c', 'h8c', 'h80x', 'h8x', 'h80f', 'h90', 'h9c', 'eb8', 'hb8c', 'hb90']):
        return 'Aylanuvchi'
    
    # Indoor PT cameras (H6C, C6N, C7, C60P, C6c, E4p, H1c, S10, CB1, CB2)
    if any(k in m_lower for k in ['h6c', 'c6n', 'c7 dual', 'c6c', 'e4p', 'c60p', 'h1c', 's10', 'cb1', 'cb2']):
        return 'Ichki'
        
    # Outdoor bullet & battery
    if any(k in m_lower for k in ['h4', 'h3', 'h3c', 'eb3', 'eb5', 'lc3', 'el3']):
        return 'Tashqi'
        
    return 'Tashqi'

def extract_badge(m, desc):
    text = (m + ' ' + desc).lower()
    if '12mp' in text or '4+4+4mp' in text:
        return '12MP 3K'
    if '10mp' in text or '8mp+2mp' in text or '5mp+5mp' in text:
        return '10MP 5K'
    if '8mp' in text or '4k' in text:
        return '8MP 4K'
    if '6mp' in text:
        return '6MP 3K'
    if '5mp' in text or '3k' in text:
        return '5MP 3K'
    if '4mp' in text or '2k+' in text:
        return '4MP 2K+'
    if '3mp' in text or '2k' in text:
        return '3MP 2K'
    if '1080' in text or '2mp' in text:
        return '1080P'
    if '4g' in text:
        return '4G LTE'
    if 'wi-fi' in text:
        return 'Wi-Fi'
    return 'Ezviz'

def extract_spec_summary(m, desc, cat):
    d = desc.lower()
    parts = []
    
    if '4g' in d or '4g' in m.lower():
        parts.append('4G LTE')
    elif 'wi-fi 6' in d:
        parts.append('Wi-Fi 6')
    elif 'wi-fi' in d:
        parts.append('Wi-Fi')
        
    if 'солнечн' in d or 'solar' in m.lower():
        parts.append('Quyosh paneli')
    elif 'аккумулятор' in d or 'батаре' in d:
        parts.append('Akkumulyator')
        
    if 'двойн' in d or 'dual' in m.lower():
        parts.append('2 linza')
    elif 'тройн' in d:
        parts.append('3 linza')
        
    if 'панорам' in d or '360' in d or cat == 'Aylanuvchi':
        parts.append('360° burilish')
        
    if 'цветное ночное' in d or 'color' in m.lower():
        parts.append('Rangli tungi')
    elif 'ночное' in d or 'ик' in d:
        parts.append('Tungi ko\'rish')
        
    if 'двусторонн' in d or 'разговор' in d or 'связь' in d or 'вызов' in d:
        parts.append('Ovoz')
        
    if '512' in d:
        parts.append('microSD 512GB')
    elif '256' in d:
        parts.append('microSD 256GB')
        
    if 'ip67' in d:
        parts.append('IP67')
    elif 'ip65' in d or 'влагозащищ' in d or 'всепогод' in d:
        parts.append('IP65')
        
    if not parts:
        parts = ['Kuzatuv kamerasi', 'Ezviz CloudPlay']
        
    return ' · '.join(parts[:4])

def extract_tags(m, desc, cat, sku):
    tags = ['Ezviz']
    d = (m + ' ' + desc).lower()
    
    if cat:
        tags.append(cat)
    if '4g' in d:
        tags.append('4G')
    if 'wi-fi' in d:
        tags.append('Wi-Fi')
    if 'poe' in d or 'poe' in sku.lower():
        tags.append('PoE')
    if 'аккумулятор' in d or 'батаре' in d:
        tags.append('Akkumulyator')
    if 'солнечн' in d or 'solar' in d:
        tags.append('Solar')
    if '4k' in d or '8mp' in d:
        tags.append('4K')
        tags.append('8MP')
    elif '5mp' in d:
        tags.append('5MP')
    elif '4mp' in d:
        tags.append('4MP')
    elif '3mp' in d:
        tags.append('3MP')
    elif '1080' in d:
        tags.append('1080P')
        
    if '360' in d or 'панорам' in d:
        tags.append('Aylanadi')
    if 'двусторонн' in d or 'разговор' in d or 'оvoz' in d:
        tags.append('Ovozli')
    if 'цветное' in d:
        tags.append('Rangli tungi')
        
    return list(dict.fromkeys(tags))

def build_specs(m, desc, dealer, retail):
    sp = []
    d = desc.lower()
    
    # 1. Ruxsat / Sensor
    if '4k' in d or '8mp' in d:
        sp.append({'k': 'Ruxsat', 'v': '8MP 4K Ultra HD'})
    elif '6mp' in d:
        sp.append({'k': 'Ruxsat', 'v': '6MP 3K+'})
    elif '5mp' in d:
        sp.append({'k': 'Ruxsat', 'v': '5MP 3K'})
    elif '4mp' in d or '2k+' in d:
        sp.append({'k': 'Ruxsat', 'v': '4MP 2K+ (2560 × 1440)'})
    elif '3mp' in d or '2k' in d:
        sp.append({'k': 'Ruxsat', 'v': '3MP 2K (2304 × 1296)'})
    elif '1080' in d:
        sp.append({'k': 'Ruxsat', 'v': '2MP 1080P Full HD'})
    else:
        sp.append({'k': 'Ruxsat', 'v': 'HD / Smart video'})
        
    # 2. Tungi ko'rish
    if 'цветное ночное' in d or 'colorfull' in d or 'color' in m.lower():
        sp.append({'k': 'Tungi ko\'rish', 'v': 'Smart Color Night Vision (rangli)'})
    elif 'ночное' in d or 'ик' in d:
        sp.append({'k': 'Tungi ko\'rish', 'v': 'IR tungi ko\'rish (30 m gacha)'})
        
    # 3. Ulanish
    if '4g' in d and 'wi-fi' in d:
        sp.append({'k': 'Tarmoq', 'v': '4G LTE SIM-karta + Wi-Fi 6'})
    elif '4g' in d:
        sp.append({'k': 'Tarmoq', 'v': '4G LTE SIM-karta'})
    elif 'wi-fi 6' in d:
        sp.append({'k': 'Tarmoq', 'v': 'Ikki diapazonli Wi-Fi 6 (2.4 / 5 GHz)'})
    elif 'wi-fi' in d:
        sp.append({'k': 'Tarmoq', 'v': 'Wi-Fi 2.4 GHz'})
    elif 'poe' in d:
        sp.append({'k': 'Tarmoq', 'v': 'PoE / RJ45 kabel'})
        
    # 4. Quvvat
    if 'солнечн' in d or 'solar' in m.lower():
        sp.append({'k': 'Quvvat', 'v': 'Akkumulyator + Quyosh paneli (Type-C)'})
    elif 'аккумулятор' in d or 'батаре' in d:
        sp.append({'k': 'Quvvat', 'v': 'Zaryadlanuvchi litiy akkumulyator'})
    elif 'poe' in d:
        sp.append({'k': 'Quvvat', 'v': 'PoE 48V / 12V DC'})
    else:
        sp.append({'k': 'Quvvat', 'v': '12V DC / 5V Type-C adapter'})
        
    # 5. Xotira
    if '512' in d:
        sp.append({'k': 'Xotira', 'v': 'microSD 512GB gacha va Ezviz CloudPlay'})
    elif '256' in d:
        sp.append({'k': 'Xotira', 'v': 'microSD 256GB gacha va CloudPlay'})
    elif '32 гб' in d:
        sp.append({'k': 'Xotira', 'v': 'Ichki 32GB eMMC + CloudPlay'})
    elif '8 тб' in d:
        sp.append({'k': 'Xotira', 'v': 'SATA HDD 8TB gacha'})
    else:
        sp.append({'k': 'Xotira', 'v': 'microSD karta va bulutli arxiv'})
        
    # 6. Ovoz va aloqa
    if 'двусторонн' in d or 'разговор' in d or 'связь' in d or 'вызов' in d:
        sp.append({'k': 'Aloqa', 'v': 'Ikki tomonlama ovozli aloqa (mikrofon + karnay)'})
        
    # 7. Asl narxlar
    if dealer:
        sp.append({'k': 'Diler (optom) narxi', 'v': f"${dealer}"})
    if retail:
        sp.append({'k': 'Tavsiya etilgan chakana narx', 'v': f"${retail}"})
        
    # 8. Kafolat
    sp.append({'k': 'Kafolat', 'v': '24 oy rasmiy kafolat'})
    
    return sp

# 3. Process products from Excel
USD_RATE = 12600

con = sqlite3.connect(DB_PATH)
cur = con.cursor()

# Ensure 'images' column exists
try:
    cur.execute("ALTER TABLE products ADD COLUMN images TEXT")
except Exception:
    pass

imported_count = 0
image_saved_count = 0

for r in range(3, 83):
    num = sheet.cell(row=r, column=1).value
    model_raw = sheet.cell(row=r, column=3).value
    desc_raw = sheet.cell(row=r, column=4).value or ''
    dealer_raw = sheet.cell(row=r, column=6).value
    retail_raw = sheet.cell(row=r, column=7).value
    
    if not model_raw or dealer_raw is None or 'видеоистория' in str(model_raw):
        continue
        
    m_str = str(model_raw).strip()
    d_str = str(desc_raw).strip()
    
    sku = generate_sku(r, m_str, d_str)
    name = clean_display_name(m_str, d_str, r)
    cat = categorize(m_str, d_str)
    
    dealer_usd = float(dealer_raw)
    price_uzs = int(round(dealer_usd * USD_RATE, -3))
    
    badge = extract_badge(m_str, d_str)
    spec_summary = extract_spec_summary(m_str, d_str, cat)
    tags = extract_tags(m_str, d_str, cat, sku)
    specs = build_specs(m_str, d_str, dealer_raw, retail_raw)
    
    d_lower = d_str.lower()
    is_poe = 1 if ('poe' in d_lower or 'poe' in sku.lower()) else 0
    is_mp = 1 if any(k in badge for k in ['4MP', '5MP', '6MP', '8MP', '10MP', '12MP', '4K', '3K', '2K+']) else 0
    is_night = 1 if ('замок' not in d_lower and 'розетка' not in d_lower and 'реле' not in d_lower and 'панель' not in d_lower and 'power' not in d_lower and 'cpu' not in d_lower) else 0
    is_spin = 1 if (cat == 'Aylanuvchi' or '360' in d_lower or 'панорам' in d_lower or 'поворот' in d_lower) else 0
    
    promo = None
    if sku in ['CS-H1C-1080P', 'CS-H6C-PRO-1080P', 'CS-C6N-G1-3MP', 'CS-H8C-1080P', 'CS-H3C-1080P']:
        promo = 'HIT'
    elif '4G' in sku or 'DUAL' in sku or 'HB90' in sku or 'PRO' in sku:
        promo = 'YANGI'
        
    qty = 25
    
    # 4. Find image
    exact_imgs = [im for im in all_imgs if im['row'] == r and im['col'] in [0, 1, 2]]
    nearby_imgs = [im for im in all_imgs if abs(im['row'] - r) <= 1 and im['col'] in [0, 1, 2]]
    
    chosen_img = exact_imgs[0] if exact_imgs else (nearby_imgs[0] if nearby_imgs else None)
    
    image_paths = []
    if chosen_img:
        ext = chosen_img['format']
        safe_slug = sku.lower().replace('/', '-').replace(' ', '-')
        img_filename = f"ezviz-{safe_slug}.{ext}"
        img_disk_path = os.path.join(ASSETS_DIR, img_filename)
        
        with open(img_disk_path, 'wb') as f:
            f.write(chosen_img['data'])
            
        rel_url = f"/assets/products/{img_filename}"
        image_paths.append(rel_url)
        image_saved_count += 1
    
    # 5. Insert or replace
    cur.execute("""
        INSERT INTO products (sku, name, cat, price, badge, spec, tags, specs, poe, mp, night, spin, qty, promo, active, images)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(sku) DO UPDATE SET
            name = excluded.name,
            cat = excluded.cat,
            price = excluded.price,
            badge = excluded.badge,
            spec = excluded.spec,
            tags = excluded.tags,
            specs = excluded.specs,
            poe = excluded.poe,
            mp = excluded.mp,
            night = excluded.night,
            spin = excluded.spin,
            promo = excluded.promo,
            images = excluded.images
    """, (
        sku, name, cat, price_uzs, badge, spec_summary,
        json.dumps(tags, ensure_ascii=False),
        json.dumps(specs, ensure_ascii=False),
        is_poe, is_mp, is_night, is_spin, qty, promo,
        json.dumps(image_paths, ensure_ascii=False)
    ))
    
    imported_count += 1
    print(f"[{imported_count:2d}] {sku:30s} | {cat:11s} | {price_uzs:>9,d} so'm | img:{len(image_paths)}")

con.commit()
con.close()

print(f"\n==========================================")
print(f"MUVAFFAQIYATLI YAKUNLANDI!")
print(f"Jami import qilingan modellar: {imported_count}")
print(f"Saqlangan fotosuratlar soni:   {image_saved_count}")
print(f"Baza:                          {DB_PATH}")
print(f"Rasmlar papkasi:               {ASSETS_DIR}")
print(f"==========================================")
