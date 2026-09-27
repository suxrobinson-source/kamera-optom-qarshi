import openpyxl
import os
import sys
import io
import re
import json
import sqlite3

# Set utf-8 output encoding for Windows terminal
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BACKEND_DIR, 'data', 'kamera.db')
ASSETS_DIR = os.path.join(BACKEND_DIR, 'assets', 'products')
os.makedirs(ASSETS_DIR, exist_ok=True)

EZVIZ_FILE = r'D:\downloads\Telegram Desktop\Ezviz price 31.07.2026.xlsx'
HILOOK_FILE = r'D:\downloads\Telegram Desktop\Hikvision price 18.08.2026.xlsx'

USD_RATE = 12600

# ═══════════════════════════════════════════════════════════════
# 1. EZVIZ HELPERS
# ═══════════════════════════════════════════════════════════════
def generate_ezviz_sku(row_num, model_raw, desc_raw):
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

def clean_ezviz_name(model_raw, desc_raw, row_num):
    m = model_raw.strip()
    m = re.sub(r'\s+', ' ', m)
    
    if row_num == 38: return 'Ezviz CS-H8c (3MP) PoE'
    if row_num == 66: return 'Ezviz CS-SD7 Smart Monitor 7"'
    if row_num == 81: return 'Ezviz CS-T30-10B Smart Rozetka 10A'
    if row_num == 82: return 'Ezviz CS-T31-16E Smart Rozetka 16A'
    if row_num == 70: return 'Ezviz CS-L2-11FCP Aqlli Qulf (Black)'
    if row_num == 71: return 'Ezviz CS-DL06 Pro Double Protection Qulf'
    if row_num == 72: return 'Ezviz CS-DL06 Aqlli Qulf'
    if row_num == 73: return 'Ezviz CS-DL20FVS Yuz/Tomir tanuvchi Qulf'
    if row_num == 74: return 'Ezviz CS-DL50FVS 3D Yuz tanuvchi Qulf'
    
    m = re.sub(r'\s+Умная розетка', '', m)
    m = re.sub(r'\s+Умный экран', '', m)
    if not m.lower().startswith('ezviz'):
        m = 'Ezviz ' + m
    return m

def categorize_ezviz(m, desc):
    m_lower = m.lower()
    d_lower = desc.lower()
    if any(k in m_lower for k in ['dp2', 'hp2', 'hp4', 'ep4', 'hp5', 'hp7']) or 'глазок' in d_lower or 'домофон' in d_lower or 'дверной звонок' in d_lower:
        return 'Domofon'
    if any(k in m_lower for k in ['r5c', 'x5s']) or 'видеорегистратор' in d_lower or 'nvr' in d_lower:
        return 'Yozuvchi'
    if any(k in m_lower for k in ['dl03', 'dl04', 'dl05', 'l2-11fcp', 'dl06', 'dl20', 'dl50', 'solar panel', 'power partne', 'pb18', 't36', 't30', 't31', 'cpu-r200', 'sd7']) or 'замок' in d_lower:
        return 'Domofon'
    if any(k in m_lower for k in ['c8c', 'h8c', 'h80x', 'h8x', 'h80f', 'h90', 'h9c', 'eb8', 'hb8c', 'hb90']):
        return 'Aylanuvchi'
    if any(k in m_lower for k in ['h6c', 'c6n', 'c7 dual', 'c6c', 'e4p', 'c60p', 'h1c', 's10', 'cb1', 'cb2']):
        return 'Ichki'
    return 'Tashqi'

def extract_ezviz_badge(m, desc):
    text = (m + ' ' + desc).lower()
    if '12mp' in text or '4+4+4mp' in text: return '12MP 3K'
    if '10mp' in text or '8mp+2mp' in text or '5mp+5mp' in text: return '10MP 5K'
    if '8mp' in text or '4k' in text: return '8MP 4K'
    if '6mp' in text: return '6MP 3K'
    if '5mp' in text or '3k' in text: return '5MP 3K'
    if '4mp' in text or '2k+' in text: return '4MP 2K+'
    if '3mp' in text or '2k' in text: return '3MP 2K'
    if '1080' in text or '2mp' in text: return '1080P'
    if '4g' in text: return '4G LTE'
    if 'wi-fi' in text: return 'Wi-Fi'
    return 'Ezviz'

def extract_ezviz_spec_summary(m, desc, cat):
    d = desc.lower()
    parts = []
    if '4g' in d or '4g' in m.lower(): parts.append('4G LTE')
    elif 'wi-fi 6' in d: parts.append('Wi-Fi 6')
    elif 'wi-fi' in d: parts.append('Wi-Fi')
    if 'солнечн' in d or 'solar' in m.lower(): parts.append('Quyosh paneli')
    elif 'аккумулятор' in d or 'батаре' in d: parts.append('Akkumulyator')
    if 'двойн' in d or 'dual' in m.lower(): parts.append('Dual Linza')
    if 'цветн' in d or 'color' in d or 'прожектор' in d: parts.append('Rangli tungi')
    elif 'ночн' in d or 'ик' in d: parts.append('IR 30m')
    if 'двусторонн' in d or 'разговор' in d or 'динамик' in d: parts.append('Ovozli aloqa')
    if '360' in d or cat == 'Aylanuvchi': parts.append('360° ko\'rish')
    if 'ip67' in d: parts.append('IP67')
    elif 'ip65' in d or 'влаго' in d: parts.append('IP65')
    if not parts: parts = ['Wi-Fi', 'Full HD', 'microSD slot']
    return ' · '.join(parts[:4])

def extract_ezviz_tags(m, desc, cat, sku):
    t = ['Ezviz', cat]
    d = desc.lower()
    badge = extract_ezviz_badge(m, desc)
    if badge not in t: t.append(badge)
    if '4g' in d or '4g' in sku.lower(): t.append('4G LTE')
    if 'wi-fi' in d: t.append('Wi-Fi')
    if 'poe' in d or 'poe' in sku.lower(): t.append('PoE')
    if 'аккумулятор' in d or 'солнечн' in d: t.append('Simsiz')
    if 'двусторонн' in d or 'разговор' in d: t.append('Ovozli')
    if 'цветн' in d or 'color' in d: t.append('Color')
    return list(dict.fromkeys(t))[:5]

def build_ezviz_specs(m, desc, dealer, retail):
    d = desc.lower()
    sp = []
    badge = extract_ezviz_badge(m, desc)
    sp.append({'k': 'Ruxsat', 'v': badge})
    if 'цветн' in d or 'color' in d: sp.append({'k': 'Tungi ko\'rish', 'v': 'Smart Rangli (Color Night Vision)'})
    elif 'ночн' in d or 'ик' in d: sp.append({'k': 'Tungi ko\'rish', 'v': 'IR tungi ko\'rish (30 m gacha)'})
    if 'wi-fi 6' in d: sp.append({'k': 'Tarmoq', 'v': 'Wi-Fi 6 (2.4 / 5 GHz)'})
    elif '4g' in d: sp.append({'k': 'Tarmoq', 'v': '4G LTE SIM-karta'})
    elif 'wi-fi' in d: sp.append({'k': 'Tarmoq', 'v': 'Wi-Fi 2.4 GHz'})
    elif 'poe' in d: sp.append({'k': 'Tarmoq', 'v': 'PoE / RJ45 kabel'})
    if 'солнечн' in d: sp.append({'k': 'Quvvat', 'v': 'Akkumulyator + Quyosh paneli'})
    elif 'аккумулятор' in d: sp.append({'k': 'Quvvat', 'v': 'Zaryadlanuvchi akkumulyator'})
    elif 'poe' in d: sp.append({'k': 'Quvvat', 'v': 'PoE 48V / 12V DC'})
    else: sp.append({'k': 'Quvvat', 'v': '12V DC / 5V Type-C adapter'})
    if '512' in d: sp.append({'k': 'Xotira', 'v': 'microSD 512GB gacha va CloudPlay'})
    elif '256' in d: sp.append({'k': 'Xotira', 'v': 'microSD 256GB gacha va CloudPlay'})
    else: sp.append({'k': 'Xotira', 'v': 'microSD karta va bulutli arxiv'})
    if 'двусторонн' in d or 'разговор' in d: sp.append({'k': 'Aloqa', 'v': 'Ikki tomonlama ovozli aloqa (mikrofon + karnay)'})
    if dealer: sp.append({'k': 'Diler (optom) narxi', 'v': f"${dealer}"})
    if retail: sp.append({'k': 'Tavsiya etilgan chakana narx', 'v': f"${retail}"})
    sp.append({'k': 'Kafolat', 'v': '24 oy rasmiy kafolat'})
    return sp

# ═══════════════════════════════════════════════════════════════
# 2. HILOOK HELPERS
# ═══════════════════════════════════════════════════════════════
def generate_hilook_sku(model_raw):
    m = str(model_raw).strip()
    m = re.sub(r'[\r\n]+', ' ', m)
    m = re.sub(r'\(.*?\)', '', m)  # remove parentheses
    m = re.sub(r'\s+ColorVu.*', '', m, flags=re.IGNORECASE)
    m = re.sub(r'\s+AcuSense.*', '', m, flags=re.IGNORECASE)
    m = re.sub(r'[\/]', '-', m)
    m = re.sub(r'[\s_]+', '-', m)
    m = re.sub(r'-+', '-', m).strip('-').upper()
    return m

def clean_hilook_name(model_raw, section, desc):
    m = str(model_raw).strip()
    m = re.sub(r'[\r\n]+', ' ', m)
    m = re.sub(r'\s+', ' ', m)
    
    brand_prefix = 'HiLook ' if not m.lower().startswith('hilook') and not m.lower().startswith('hl-') else ''
    
    # Check extra info from section
    extra = ''
    if 'colorvu' in section.lower() and 'colorvu' not in m.lower():
        extra = ' ColorVu'
    elif 'acusense' in section.lower() and 'acusense' not in m.lower():
        extra = ' AcuSense'
    elif 'wifi' in section.lower() and 'wifi' not in m.lower():
        extra = ' Wi-Fi Kit'
    elif 'домофон' in section.lower() and 'domofon' not in m.lower():
        extra = ' Domofon'
    elif 'коммутатор' in section.lower() and 'switch' not in m.lower() and 'poe' not in m.lower():
        extra = ' PoE Switch'
        
    return f"{brand_prefix}{m}{extra}".strip()

def categorize_hilook(model_raw, section, desc):
    m = str(model_raw).lower()
    s = str(section).lower()
    d = str(desc).lower()
    
    # Recorders (NVR, DVR, eDVR)
    if any(k in s for k in ['nvr', 'dvr', 'edvr', 'серия']) and any(k in m for k in ['nvr', 'dvr', 'e04g']):
        return 'Yozuvchi'
    if 'nvr' in m or 'dvr' in m or 'видеорегистратор' in d:
        return 'Yozuvchi'
        
    # PTZ / Aylanuvchi
    if 'ptz' in s or 'ptz' in m or 'panovu' in s or 'panovu' in m:
        return 'Aylanuvchi'
        
    # Domofon
    if 'домофон' in s or 'vdp' in m or 'kis' in m or 'vi-' in m or 'домофон' in d:
        return 'Domofon'
        
    # Komplekt & Switches
    if 'wifi nvs kit' in s or 'kit' in m or 'комплект' in d:
        return 'Komplekt'
    if 'коммутатор' in s or m.startswith('ns-') or 'коммутатор' in d:
        return 'Komplekt'
        
    # Indoor (Dome D1, Turret T1/T2, Cube C2)
    if any(k in s for k in ['купол', 'револьверная', 'куб', 'd1', 't2', 'c2']) or m.startswith('ipc-d') or m.startswith('thc-t') or m.startswith('ipc-c') or m.startswith('ipc-t'):
        return 'Ichki'
        
    # Outdoor (Bullets B1, B2, B4, IP67, etc.)
    return 'Tashqi'

def extract_hilook_badge(model_raw, section, desc):
    text = f"{model_raw} {section} {desc}".lower()
    if 'colorvu' in text: return 'ColorVu'
    if '8mp' in text or '4k' in text: return '8MP 4K'
    if '6mp' in text: return '6MP'
    if '5mp' in text: return '5MP'
    if '4mp' in text or '2k' in text: return '4MP'
    if '1080' in text or '2mp' in text: return '2MP 1080P'
    if 'ptz' in text: return 'PTZ'
    if 'nvr' in text: return 'NVR 4K'
    if 'dvr' in text: return 'DVR'
    if 'poe' in text: return 'PoE'
    if 'домофон' in text: return 'IP Domofon'
    return 'HiLook'

def extract_hilook_spec_summary(model_raw, section, desc, cat):
    d = desc.lower()
    m = model_raw.lower()
    parts = []
    
    if 'colorvu' in d or 'colorvu' in section.lower(): parts.append('ColorVu 24/7 rangli')
    elif 'smart hybrid' in d: parts.append('Smart Hybrid Light')
    elif 'ик' in d or 'ir' in d: parts.append('IR tungi ko\'rish')
    
    if 'poe' in d or 'poe' in m: parts.append('PoE')
    if 'ip67' in d: parts.append('IP67 metall')
    elif 'ip66' in d: parts.append('IP66')
    
    if 'микрофон' in d or 'аудио' in d: parts.append('Ovozli / Mikrofon')
    if 'двусторонн' in d: parts.append('2-tomonlama ovoz')
    if '512' in d: parts.append('SD 512GB slot')
    elif '256' in d: parts.append('SD 256GB slot')
    
    if 'h.265' in d: parts.append('H.265+')
    if '180' in d: parts.append('180° ko\'rish')
    if 'acusense' in d or 'motion detection 2.0' in d: parts.append('AcuSense AI')
    
    if not parts:
        if cat == 'Yozuvchi': parts = ['4K H.265+', 'HDMI / VGA', 'HDD qo\'llab-quvvatlaydi']
        elif cat == 'Domofon': parts = ['Rangli panel', 'Eshik qulfi boshqaruvi', 'Hands-free']
        elif cat == 'Komplekt': parts = ['PoE 100M', 'Uplink gigabit', 'Plug & Play']
        else: parts = ['Full HD', 'Tungi ko\'rish', 'Kafolat 24 oy']
        
    return ' · '.join(parts[:4])

def extract_hilook_tags(model_raw, section, desc, cat, sku):
    t = ['HiLook', cat]
    badge = extract_hilook_badge(model_raw, section, desc)
    if badge not in t: t.append(badge)
    d = desc.lower()
    if 'colorvu' in d or 'colorvu' in section.lower(): t.append('ColorVu')
    if 'poe' in d or 'poe' in sku.lower(): t.append('PoE')
    if 'микрофон' in d or 'аудио' in d: t.append('Ovozli')
    if 'ip67' in d: t.append('IP67')
    if 'acusense' in d: t.append('AI Smart')
    if 'h.265' in d: t.append('H.265+')
    return list(dict.fromkeys(t))[:5]

def build_hilook_specs(model_raw, section, desc, price_usd):
    d = desc.lower()
    sp = []
    
    badge = extract_hilook_badge(model_raw, section, desc)
    sp.append({'k': 'Model turi', 'v': badge})
    
    # Megapixel / Resolution
    if '6 мп' in d or '6мп' in d: sp.append({'k': 'Ruxsat', 'v': '6MP Ultra HD (3200 × 1800)'})
    elif '5 мп' in d or '5мп' in d: sp.append({'k': 'Ruxsat', 'v': '5MP 3K (2560 × 1944)'})
    elif '4 мп' in d or '4мп' in d: sp.append({'k': 'Ruxsat', 'v': '4MP 2K (2560 × 1440)'})
    elif '2 мп' in d or '1080' in d: sp.append({'k': 'Ruxsat', 'v': '2MP 1080P Full HD'})
    elif '32-канал' in d: sp.append({'k': 'Kanallar soni', 'v': '32 ta IP kamera'})
    elif '16-канал' in d: sp.append({'k': 'Kanallar soni', 'v': '16 ta IP kamera'})
    elif '8-канал' in d: sp.append({'k': 'Kanallar soni', 'v': '8 ta IP kamera'})
    elif '4-канал' in d: sp.append({'k': 'Kanallar soni', 'v': '4 ta IP kamera'})
    
    # Night vision
    if 'colorvu' in d or 'colorvu' in section.lower():
        sp.append({'k': 'Tungi ko\'rish', 'v': 'ColorVu 24/7 to\'liq rangli ko\'rish'})
    elif 'smart hybrid' in d:
        sp.append({'k': 'Tungi ko\'rish', 'v': 'Smart Hybrid Light (IR + Oq yorug\'lik)'})
    elif 'ик' in d or 'ir' in d:
        sp.append({'k': 'Tungi ko\'rish', 'v': 'Smart IR infraqizil yoritish (30-50m)'})
        
    # Codec
    if 'h.265+' in d: sp.append({'k': 'Video siqish', 'v': 'H.265+ / H.265 / H.264+'})
    
    # Audio
    if 'двусторонн' in d: sp.append({'k': 'Ovozli aloqa', 'v': 'Ikki tomonlama ovozli aloqa (mikrofon + dinamik)'})
    elif 'микрофон' in d or 'аудио' in d: sp.append({'k': 'Ovoz', 'v': 'O\'rnatilgan yuqori sezgir mikrofon'})
    
    # Protection
    if 'ip67' in d: sp.append({'k': 'Himoya klassi', 'v': 'IP67 ob-havoga chidamli metall korpus'})
    elif 'ip66' in d: sp.append({'k': 'Himoya klassi', 'v': 'IP66 namlik va changdan himoya'})
    
    # Memory
    if '512' in d: sp.append({'k': 'Xotira', 'v': 'MicroSD 512GB slot'})
    elif '256' in d: sp.append({'k': 'Xotira', 'v': 'MicroSD 256GB slot'})
    elif 'sata' in d or 'hdd' in d: sp.append({'k': 'Qattiq disk', 'v': '1 × SATA HDD 8TB / 10TB gacha'})
    
    # Power
    if 'poe' in d or 'poe' in model_raw.lower(): sp.append({'k': 'Quvvat', 'v': 'PoE (802.3af) / 12V DC'})
    else: sp.append({'k': 'Quvvat', 'v': '12V DC adapter'})
    
    if price_usd: sp.append({'k': 'Diler (optom) narxi', 'v': f"${price_usd}"})
    sp.append({'k': 'Kafolat', 'v': '24 oy rasmiy kafolat'})
    return sp


# ═══════════════════════════════════════════════════════════════
# 3. MAIN IMPORT EXECUTION
# ═══════════════════════════════════════════════════════════════
def main():
    print(f"🚀 Boshlandi: Baza manzili -> {DB_PATH}")
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    
    # Ensure tables and columns exist
    try:
        cur.execute("ALTER TABLE products ADD COLUMN images TEXT")
    except Exception:
        pass
        
    con.commit()
    
    existing_skus = set(r[0] for r in cur.execute("SELECT sku FROM products").fetchall())
    print(f"Bazada hozirgi mahsulotlar soni: {len(existing_skus)}")
    
    total_imported = 0
    total_images_saved = 0
    all_extracted_products = []
    
    # ─────────────────────────────────────────────────────────────
    # A. IMPORT EZVIZ
    # ─────────────────────────────────────────────────────────────
    print("\n📦 1. Ezviz narxnomasini yuklash...")
    ez_wb = openpyxl.load_workbook(EZVIZ_FILE, data_only=True)
    ez_ws = ez_wb['Ezviz']
    
    ez_imgs = []
    for i, img in enumerate(ez_ws._images):
        ez_imgs.append({
            'row': img.anchor._from.row + 1,
            'col': img.anchor._from.col,
            'data': img._data(),
            'format': img.format.lower() if img.format else 'png'
        })
    print(f"Ezviz varag'ida {len(ez_imgs)} ta rasm topildi.")
    
    ez_imported = 0
    for r in range(3, 83):
        model_raw = ez_ws.cell(row=r, column=3).value
        desc_raw = ez_ws.cell(row=r, column=4).value or ''
        dealer_raw = ez_ws.cell(row=r, column=6).value
        retail_raw = ez_ws.cell(row=r, column=7).value
        
        if not model_raw or dealer_raw is None or 'видеоистория' in str(model_raw):
            continue
            
        m_str = str(model_raw).strip()
        d_str = str(desc_raw).strip()
        
        sku = generate_ezviz_sku(r, m_str, d_str)
        # Prevent collision
        orig_sku = sku
        c_suffix = 1
        while sku in existing_skus:
            sku = f"{orig_sku}-v{c_suffix}"
            c_suffix += 1
            
        existing_skus.add(sku)
        
        name = clean_ezviz_name(m_str, d_str, r)
        cat = categorize_ezviz(m_str, d_str)
        
        dealer_usd = float(dealer_raw)
        price_uzs = int(round(dealer_usd * USD_RATE, -3))
        
        badge = extract_ezviz_badge(m_str, d_str)
        spec_summary = extract_ezviz_spec_summary(m_str, d_str, cat)
        tags = extract_ezviz_tags(m_str, d_str, cat, sku)
        specs = build_ezviz_specs(m_str, d_str, dealer_raw, retail_raw)
        
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
            
        # Image extraction
        exact_imgs = [im for im in ez_imgs if im['row'] == r]
        nearby_imgs = [im for im in ez_imgs if abs(im['row'] - r) <= 1]
        chosen_img = exact_imgs[0] if exact_imgs else (nearby_imgs[0] if nearby_imgs else None)
        
        image_paths = []
        if chosen_img:
            ext = chosen_img['format']
            safe_slug = sku.lower().replace('/', '-').replace(' ', '-')
            img_filename = f"ezviz-{safe_slug}.{ext}"
            img_disk_path = os.path.join(ASSETS_DIR, img_filename)
            with open(img_disk_path, 'wb') as f:
                f.write(chosen_img['data'])
            image_paths.append(f"/assets/products/{img_filename}")
            total_images_saved += 1
            
        cur.execute("""
            INSERT INTO products (sku, name, cat, price, badge, spec, tags, specs, poe, mp, night, spin, qty, promo, active, images)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        """, (
            sku, name, cat, price_uzs, badge, spec_summary,
            json.dumps(tags, ensure_ascii=False),
            json.dumps(specs, ensure_ascii=False),
            is_poe, is_mp, is_night, is_spin,
            24, promo,
            json.dumps(image_paths)
        ))
        
        all_extracted_products.append({
            'sku': sku, 'name': name, 'cat': cat, 'price': price_uzs,
            'badge': badge, 'spec': spec_summary, 'tags': tags, 'specs': specs,
            'poe': is_poe, 'mp': is_mp, 'night': is_night, 'spin': is_spin,
            'qty': 24, 'promo': promo, 'images': image_paths
        })
        ez_imported += 1

    con.commit()
    print(f"✅ Ezviz: {ez_imported} ta tovar bazaga yozildi.")

    # ─────────────────────────────────────────────────────────────
    # B. IMPORT HILOOK
    # ─────────────────────────────────────────────────────────────
    print("\n📦 2. HiLook narxnomasini yuklash...")
    hl_wb = openpyxl.load_workbook(HILOOK_FILE, data_only=True)
    hl_ws = hl_wb['Hilook']
    
    hl_imgs = []
    for i, img in enumerate(hl_ws._images):
        hl_imgs.append({
            'row': img.anchor._from.row + 1,
            'col': img.anchor._from.col,
            'data': img._data(),
            'format': img.format.lower() if img.format else 'png'
        })
    print(f"HiLook varag'ida {len(hl_imgs)} ta rasm topildi.")
    
    hl_imported = 0
    current_sec = 'Hilook'
    
    for r in range(1, hl_ws.max_row + 1):
        c1 = hl_ws.cell(r, 1).value
        c3 = hl_ws.cell(r, 3).value
        c4 = hl_ws.cell(r, 4).value
        c5 = hl_ws.cell(r, 5).value
        
        # Section header check
        if c1 and not c3 and not c5:
            current_sec = str(c1).strip()
            continue
            
        if not c3 or c5 is None:
            continue
            
        try:
            price_usd = float(c5)
        except ValueError:
            continue
            
        m_str = str(c3).strip()
        d_str = str(c4 or '').strip()
        
        sku = generate_hilook_sku(m_str)
        orig_sku = sku
        c_suffix = 1
        while sku in existing_skus:
            sku = f"{orig_sku}-v{c_suffix}"
            c_suffix += 1
            
        existing_skus.add(sku)
        
        name = clean_hilook_name(m_str, current_sec, d_str)
        cat = categorize_hilook(m_str, current_sec, d_str)
        price_uzs = int(round(price_usd * USD_RATE, -3))
        
        badge = extract_hilook_badge(m_str, current_sec, d_str)
        spec_summary = extract_hilook_spec_summary(m_str, current_sec, d_str, cat)
        tags = extract_hilook_tags(m_str, current_sec, d_str, cat, sku)
        specs = build_hilook_specs(m_str, current_sec, d_str, price_usd)
        
        d_lower = d_str.lower()
        m_lower = m_str.lower()
        is_poe = 1 if ('poe' in d_lower or 'poe' in m_lower or 'poe' in sku.lower()) else 0
        is_mp = 1 if any(k in badge for k in ['4MP', '5MP', '6MP', '8MP', '4K']) else 0
4        is_night = 1 if cat in ['Tashqi', 'Ichki', 'Aylanuvchi'] else 0
        is_spin = 1 if (cat == 'Aylanuvchi' or 'ptz' in m_lower or '360' in d_lower) else 0
        
        promo = None
        if 'colorvu' in d_lower or 'colorvu' in current_sec.lower():
            promo = 'HIT'
        elif 'acusense' in d_lower or 'wifi' in current_sec.lower() or 'ptz' in m_lower:
            promo = 'YANGI'
            
        # Image extraction
        exact_imgs = [im for im in hl_imgs if im['row'] == r]
        nearby_imgs = [im for im in hl_imgs if abs(im['row'] - r) <= 1]
        chosen_img = exact_imgs[0] if exact_imgs else (nearby_imgs[0] if nearby_imgs else None)
        
        image_paths = []
        if chosen_img:
            ext = chosen_img['format']
            safe_slug = sku.lower().replace('/', '-').replace(' ', '-')
            img_filename = f"hilook-{safe_slug}.{ext}"
            img_disk_path = os.path.join(ASSETS_DIR, img_filename)
            with open(img_disk_path, 'wb') as f:
                f.write(chosen_img['data'])
            image_paths.append(f"/assets/products/{img_filename}")
            total_images_saved += 1
            
        cur.execute("""
            INSERT INTO products (sku, name, cat, price, badge, spec, tags, specs, poe, mp, night, spin, qty, promo, active, images)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        """, (
            sku, name, cat, price_uzs, badge, spec_summary,
            json.dumps(tags, ensure_ascii=False),
            json.dumps(specs, ensure_ascii=False),
            is_poe, is_mp, is_night, is_spin,
            28, promo,
            json.dumps(image_paths)
        ))
        
        all_extracted_products.append({
            'sku': sku, 'name': name, 'cat': cat, 'price': price_uzs,
            'badge': badge, 'spec': spec_summary, 'tags': tags, 'specs': specs,
            'poe': is_poe, 'mp': is_mp, 'night': is_night, 'spin': is_spin,
            'qty': 28, 'promo': promo, 'images': image_paths
        })
        hl_imported += 1

    con.commit()
    print(f"✅ HiLook: {hl_imported} ta tovar bazaga yozildi.")

    # Save complete JSON dump to backend/data/all-imported-products.json for backup/portability
    json_path = os.path.join(BACKEND_DIR, 'data', 'all-imported-products.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(all_extracted_products, f, ensure_ascii=False, indent=2)
    print(f"📁 JSON nusxa saqlandi: {json_path}")
    
    total_in_db = cur.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    con.close()
    
    print("\n🎉 IMPORT TO'LIQ VA MUVAFFAQIYATLI YAKUNLANDI!")
    print(f"   - Jami import qilingan tovarlar: {ez_imported + hl_imported} ta")
    print(f"     * Ezviz: {ez_imported} ta")
    print(f"     * HiLook: {hl_imported} ta")
    print(f"   - Diskka saqlangan mahsulot rasmlari: {total_images_saved} ta")
    print(f"   - Bazadagi jami mahsulotlar: {total_in_db} ta")

if __name__ == '__main__':
    main()

