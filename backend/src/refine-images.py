import sqlite3
import os
import io
import sys
import re
import time
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

def search_bing(query, limit=10):
    url = f"https://www.bing.com/images/async?q={requests.utils.quote(query)}&first=1&count={limit}&adlt=off"
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        if r.status_code != 200:
            return []
        matches = re.findall(r'murl&quot;:&quot;(https?://[^&]+)&quot;', r.text)
        if not matches:
            matches = re.findall(r'"murl":"(https?://[^"]+)"', r.text)
        return matches[:limit]
    except Exception:
        return []

def evaluate_image(img):
    try:
        arr = np.array(img.convert('RGB'))
        h, w, _ = arr.shape
        if h < 200 or w < 200:
            return -100
        ar = w / float(h)
        if ar < 0.65 or ar > 1.6:
            return -50
        bx = max(2, int(w * 0.05))
        by = max(2, int(h * 0.05))
        top = arr[:by, :, :]
        bot = arr[-by:, :, :]
        left = arr[:, :bx, :]
        right = arr[:, -bx, :]
        border_pixels = np.concatenate([
            top.reshape(-1, 3), bot.reshape(-1, 3), left.reshape(-1, 3), right.reshape(-1, 3)
        ])
        border_white = np.mean(np.all(border_pixels >= 246, axis=1))
        if border_white < 0.85:
            return -30 + border_white * 20
        total_white = np.mean(np.all(arr >= 246, axis=2))
        if total_white < 0.50:
            return -10
        if total_white > 0.96:
            return 20
        score = 80.0 + (border_white * 20.0) - (abs(total_white - 0.80) * 50.0)
        if 0.9 <= ar <= 1.1:
            score += 15.0
        return score
    except Exception:
        return -100

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

def refine_product(sku, name):
    safe_slug = sku.lower().replace('/', '-').replace(' ', '-').replace('(', '').replace(')', '')
    f1 = os.path.join(ASSETS_DIR, f"{safe_slug}-1.jpg")
    cur_score = -100
    if os.path.exists(f1):
        try:
            cur_im = Image.open(f1)
            cur_score = evaluate_image(cur_im)
        except Exception:
            pass
    if cur_score >= 82:
        return f"{sku}: already clean (score {cur_score:.1f})"
        
    clean_name = re.sub(r'\(.*?\)', '', name).strip()
    brand = 'Ezviz' if 'ezviz' in clean_name.lower() or sku.startswith('CS-') else 'HiLook'
    model = sku.replace('CS-', '').split(' ')[0]
    
    queries = [
        f'"{sku}" {brand} camera white background',
        f'"{model}" {brand} official product png',
        f'"{clean_name}" white background isolated'
    ]
    
    candidate_urls = []
    for q in queries:
        urls = search_bing(q, limit=6)
        for u in urls:
            if u not in candidate_urls:
                candidate_urls.append(u)
        if len(candidate_urls) >= 12:
            break
            
    best_img = None
    best_score = cur_score
    for u in candidate_urls:
        try:
            res = requests.get(u, headers=HEADERS, timeout=6)
            if res.status_code == 200 and len(res.content) > 5000:
                raw_im = Image.open(io.BytesIO(res.content))
                sc = evaluate_image(raw_im)
                if sc > best_score:
                    best_score = sc
                    best_img = raw_im
                    if sc >= 90:
                        break
        except Exception:
            continue
            
    if best_img is not None and best_score > cur_score:
        canvas = process_to_canvas(best_img)
        canvas.save(f1, 'JPEG', quality=93, optimize=True)
        return f"{sku}: UPGRADED from {cur_score:.1f} to {best_score:.1f}"
    return f"{sku}: kept current (score {cur_score:.1f})"

if __name__ == '__main__':
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT sku, name FROM products ORDER BY rowid ASC")
    products = c.fetchall()
    conn.close()
    print(f"Checking and refining {len(products)} products...")
    upgraded = 0
    for idx, (sku, name) in enumerate(products, 1):
        res = refine_product(sku, name)
        if 'UPGRADED' in res:
            upgraded += 1
            print(f"[{idx}/{len(products)}] {res}")
        elif idx % 25 == 0:
            print(f"[{idx}/{len(products)}] Progressing...")
    print(f"\nDone! Upgraded {upgraded} products with pristine studio packshots.")

