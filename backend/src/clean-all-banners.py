import sqlite3
import os
import io
import sys
import re
import requests
from PIL import Image
import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BACKEND_DIR, 'data', 'kamera.db')
ASSETS_DIR = os.path.join(BACKEND_DIR, 'assets', 'products')

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
}

def search_bing(query, limit=12):
    url = f"https://www.bing.com/images/async?q={requests.utils.quote(query)}&first=1&count={limit}&adlt=off"
    try:
        r = requests.get(url, headers=HEADERS, timeout=8)
        if r.status_code != 200:
            return []
        matches = re.findall(r'murl&quot;:&quot;(https?://[^&]+)&quot;', r.text)
        if not matches:
            matches = re.findall(r'"murl":"(https?://[^"]+)"', r.text)
        return matches[:limit]
    except Exception:
        return []

def is_banner_or_cluttered(img):
    """
    Detects whether an image is a promotional banner, infographic, or has seller stickers:
    1. Check bottom 15%: does it contain banners/badges?
    2. Check top 12%: does it contain headline text/logos across both sides?
    3. Check right 20%: does it contain vertical bullet-point spec lists?
    4. Check corners: all 4 corners should be pure white.
    """
    try:
        arr = np.array(img.convert('RGB'))
        h, w, _ = arr.shape
        
        # Check 4 corners (each 40x40px)
        c_w = min(40, w // 10)
        c_h = min(40, h // 10)
        tl = arr[:c_h, :c_w, :]
        tr = arr[:c_h, -c_w:, :]
        bl = arr[-c_h:, :c_w, :]
        br = arr[-c_h:, -c_w:, :]
        
        corners = [tl, tr, bl, br]
        for c in corners:
            # If corner is not white (> 95% white pixels)
            is_white = np.mean(np.all(c >= 245, axis=2))
            if is_white < 0.90:
                return True, f"Non-white corner ({is_white:.1%})"
                
        # Check bottom 12% (often has store banner, warranty stamp, logos)
        bot_h = int(h * 0.12)
        bot_section = arr[-bot_h:, :, :]
        bot_white = np.mean(np.all(bot_section >= 245, axis=2))
        if bot_white < 0.85:
            return True, f"Bottom banner detected ({bot_white:.1%} white)"
            
        # Check right 15% and left 15% - a camera is centered; if right side has < 75% white, it's a spec list
        right_w = int(w * 0.15)
        right_section = arr[:, -right_w:, :]
        right_white = np.mean(np.all(right_section >= 245, axis=2))
        if right_white < 0.80:
            return True, f"Right-hand banner/spec list ({right_white:.1%} white)"
            
        total_white = np.mean(np.all(arr >= 245, axis=2))
        if total_white < 0.60:
            return True, f"Too cluttered overall ({total_white:.1%} white)"
            
        return False, "Clean packshot"
    except Exception as e:
        return True, f"Error: {e}"

def process_to_canvas(img, target_size=(800, 800)):
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        alpha = img.convert('RGBA')
        bg = Image.new('RGB', alpha.size, (255, 255, 255))
        bg.paste(alpha, mask=alpha.split()[3])
        img = bg
    else:
        img = img.convert('RGB')
        
    orig_w, orig_h = img.size
    target_w, target_h = target_size
    pad = int(target_w * 0.06)
    max_w = target_w - (pad * 2)
    max_h = target_h - (pad * 2)
    
    ratio = min(max_w / orig_w, max_h / orig_h)
    new_w = max(1, int(orig_w * ratio))
    new_h = max(1, int(orig_h * ratio))
    
    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new('RGB', target_size, (255, 255, 255))
    offset_x = (target_w - new_w) // 2
    offset_y = (target_h - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y))
    return canvas

def clean_product_image(sku, name):
    safe_slug = sku.lower().replace('/', '-').replace(' ', '-').replace('(', '').replace(')', '')
    f1 = os.path.join(ASSETS_DIR, f"{safe_slug}-1.jpg")
    
    if os.path.exists(f1):
        try:
            im = Image.open(f1)
            cluttered, reason = is_banner_or_cluttered(im)
            if not cluttered:
                return f"{sku}: Clean"
        except Exception:
            cluttered = True
    else:
        cluttered = True

    # Check if variant 2 or 3 is clean
    for alt_idx in [2, 3]:
        alt_f = os.path.join(ASSETS_DIR, f"{safe_slug}-{alt_idx}.jpg")
        if os.path.exists(alt_f):
            try:
                alt_im = Image.open(alt_f)
                alt_cluttered, _ = is_banner_or_cluttered(alt_im)
                if not alt_cluttered:
                    # Copy clean alt to f1
                    canvas = process_to_canvas(alt_im)
                    canvas.save(f1, 'JPEG', quality=93, optimize=True)
                    return f"{sku}: Replaced with clean variant {alt_idx}"
            except Exception:
                pass
                
    # Search for official isolated clean shot
    clean_name = re.sub(r'\(.*?\)', '', name).strip()
    brand = 'Ezviz' if 'ezviz' in clean_name.lower() or sku.startswith('CS-') else 'HiLook'
    model = sku.replace('CS-', '').split(' ')[0]
    
    queries = [
        f'"{model}" {brand} camera white background packshot',
        f'"{sku}" {brand} isolated white background',
        f'"{clean_name}" white background amazon'
    ]
    
    for q in queries:
        urls = search_bing(q, limit=6)
        for u in urls:
            try:
                res = requests.get(u, headers=HEADERS, timeout=6)
                if res.status_code == 200 and len(res.content) > 6000:
                    cand = Image.open(io.BytesIO(res.content))
                    c_cluttered, _ = is_banner_or_cluttered(cand)
                    if not c_cluttered:
                        canvas = process_to_canvas(cand)
                        canvas.save(f1, 'JPEG', quality=93, optimize=True)
                        return f"{sku}: Downloaded clean packshot"
            except Exception:
                continue
                
    return f"{sku}: Kept (could not find cleaner shot)"

if __name__ == '__main__':
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT sku, name FROM products ORDER BY rowid ASC")
    products = c.fetchall()
    conn.close()
    
    print(f"Scanning {len(products)} products for banner or cluttered images...")
    replaced = 0
    for idx, (sku, name) in enumerate(products, 1):
        res = clean_product_image(sku, name)
        if "Replaced" in res or "Downloaded" in res:
            replaced += 1
            print(f"[{idx}/{len(products)}] {res}")
            
    print(f"\nFinished! Cleaned and upgraded {replaced} product images.")

