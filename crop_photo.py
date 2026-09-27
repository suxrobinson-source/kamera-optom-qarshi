import os
import sys

# We will read the image dimensions and crop the middle 3x4 portrait photo
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

img_path = r"C:\Users\suxro\.gemini\antigravity\brain\bd1d0a22-e371-4711-8112-093f1394ecff\.user_uploaded\media_1789457559700.png"
output_dir = r"d:\QARSHI_OPTOM_KAMERA"

if HAS_PIL:
    img = Image.open(img_path)
    w, h = img.size
    print(f"Image size: {w}x{h}")
    
    # The image has 3 photos side by side in the upper half of the photo card.
    # Let's inspect coordinates relative to width and height.
    # In media_1789457559700.png:
    # Width is w, Height is h.
    # The photo card is roughly in the top half/two-thirds.
    # Photo 1 (left), Photo 2 (middle), Photo 3 (right).
    # Let's crop the middle photo cleanly:
    # We can save a few variations or exact bounding box.
else:
    print("PIL not installed, will use PowerShell System.Drawing")
