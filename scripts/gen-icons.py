"""Draws the RehabPath app icons into public/icons (Phase 7.3). Run: python3 scripts/gen-icons.py
A white "R" with a heartbeat line on the brand teal. The maskable icon keeps everything inside the central 60% so Android can crop it to any shape."""
from PIL import Image, ImageDraw, ImageFont
import glob

TEAL = (10, 107, 107)
WHITE = (255, 255, 255)
fonts = [f for f in glob.glob('/usr/share/fonts/**/*Bold.ttf', recursive=True) if 'DejaVuSans-Bold' in f or 'LiberationSans-Bold' in f]
FONT = fonts[0] if fonts else None

def draw(size: int, safe: float, rounded: bool) -> Image.Image:
    S = size * 4  # draw large, then shrink for smooth edges
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded: d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=TEAL)
    else: d.rectangle((0, 0, S, S), fill=TEAL)
    box = S * safe                      # side of the square that must hold the artwork
    x0 = (S - box) / 2
    f = ImageFont.truetype(FONT, int(box * 1.02)) if FONT else ImageFont.load_default()
    l, t, r, b = d.textbbox((0, 0), 'R', font=f)
    d.text((S / 2 - (l + r) / 2, x0 + box * 0.04 - t), 'R', font=f, fill=WHITE)
    # heartbeat line under the letter
    y = x0 + box * 0.90
    w = max(int(box * 0.05), 2)
    pts = [(0.10, 0), (0.34, 0), (0.42, -0.07), (0.50, 0.07), (0.58, -0.035), (0.64, 0), (0.90, 0)]
    d.line([(x0 + box * px, y + box * py) for px, py in pts], fill=WHITE, width=w, joint='curve')
    return img.resize((size, size), Image.LANCZOS)

draw(192, 0.62, True).save('public/icons/icon-192.png')
draw(512, 0.62, True).save('public/icons/icon-512.png')
draw(512, 0.56, False).save('public/icons/icon-maskable-512.png')      # full-bleed, safe zone only
draw(180, 0.62, False).save('public/icons/apple-touch-icon.png')       # iOS rounds the corners itself
print('ok', FONT)
