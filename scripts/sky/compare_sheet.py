"""A contact sheet comparing the sky colour settings through a day (debug-shots/dayshots.mjs shots, tagged
-cmp-painted, -cmp-mixed and -cmp-computed): one row per time, painted / mixed / tinted / computed left to right.

    python scripts/sky/compare_sheet.py   ->   debug-shots/sky/compare.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'debug-shots', 'sky')
TIMES = ['0600', '0800', '1200', '1720', '1810', '1840']
LOOKS = ['painted', 'mixed', 'tinted', 'computed']
W, H, PAD, TOP = 560, 315, 6, 44

try:
    font = ImageFont.truetype('arial.ttf', 22)
    small = ImageFont.truetype('arial.ttf', 18)
except OSError:
    font = small = ImageFont.load_default()

sheet = Image.new('RGB', (len(LOOKS) * (W + PAD) + PAD + 70, len(TIMES) * (H + PAD) + PAD + TOP), (18, 18, 20))
d = ImageDraw.Draw(sheet)
for c, look in enumerate(LOOKS):
    d.text((70 + PAD + c * (W + PAD) + W // 2, TOP // 2), look, fill=(235, 235, 235), font=font, anchor='mm')
for r, t in enumerate(TIMES):
    y = TOP + PAD + r * (H + PAD)
    d.text((35, y + H // 2), f'{t[:2]}:{t[2:]}', fill=(200, 200, 200), font=small, anchor='mm')
    for c, look in enumerate(LOOKS):
        p = os.path.join(DIR, f'day-cmp-{look}-{t}.png')
        if os.path.exists(p):
            sheet.paste(Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS), (70 + PAD + c * (W + PAD), y))
out = os.path.join(DIR, 'compare.png')
sheet.save(out)
print(out, sheet.size)
