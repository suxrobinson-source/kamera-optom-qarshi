import requests
import re
import io
from PIL import Image

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36'}
r = requests.get('https://www.bing.com/images/async?q=ezviz+c6n+camera+isolated+white+background+packshot&first=1&count=15&adlt=off', headers=headers)
urls = re.findall(r'murl&quot;:&quot;(https?://[^&]+)&quot;', r.text)
if not urls:
    urls = re.findall(r'"murl":"(https?://[^"]+)"', r.text)

print('Found URLs:', len(urls))
saved = False
for u in urls:
    try:
        res = requests.get(u, headers=headers, timeout=6)
        if res.status_code == 200 and len(res.content) > 8000:
            im = Image.open(io.BytesIO(res.content)).convert('RGB')
            w, h = im.size
            if w >= 350 and h >= 350 and 0.8 <= (w/h) <= 1.25:
                ratio = min(700 / w, 700 / h)
                nw, nh = int(w * ratio), int(h * ratio)
                resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
                canvas = Image.new('RGB', (800, 800), (255, 255, 255))
                canvas.paste(resized, ((800 - nw)//2, (800 - nh)//2))
                for f in ['backend/assets/products/cs-c6n-g1-3mp-1.jpg', 'backend/assets/products/cs-c6n-g1-5mp-1.jpg', 'backend/assets/products/cs-c6n-g1-8mp-1.jpg']:
                    canvas.save(f, 'JPEG', quality=95)
                print('Saved clean C6N image from:', u)
                saved = True
                break
    except Exception as e:
        continue

if not saved:
    print('Could not find C6N packshot')

