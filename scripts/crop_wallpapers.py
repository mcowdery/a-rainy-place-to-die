"""Turns approved phone wallpaper art (assets/ads/source/NN_name.png) into the phone's wallpapers.

  assets/phone/wallpapers/<name>.jpg   736x1536, the home screen's own shape (the picture is drawn to cover it)

The file's name is the wallpaper's id (src/phone/wallpapers.ts lists whatever is in the folder, in name order).

  python scripts/crop_wallpapers.py
"""
import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets', 'ads', 'source')
OUT = os.path.join(ROOT, 'assets', 'phone', 'wallpapers')

SIZE = (736, 1536)

# source: the wallpaper's id
WALLPAPERS = {
    '91_julie_ferry': 'julie_ferry_1',
    '92_julie_ferry': 'julie_ferry_2',
    '86_kimoto_kissaten': 'kimoto_kissaten',
    '87_kimoto_umbrella': 'kimoto_umbrella',
    '88_kimoto_ferry': 'kimoto_ferry',
    '89_koharu_kissaten': 'koharu_kissaten',
    '90_koharu_umbrella': 'koharu_umbrella',
}

os.makedirs(OUT, exist_ok=True)
for source, name in WALLPAPERS.items():
    image = Image.open(os.path.join(SRC, source + '.png')).convert('RGB')
    if image.size != SIZE:
        image = image.resize(SIZE, Image.LANCZOS)
    image.save(os.path.join(OUT, name + '.jpg'), quality=88, optimize=True)
    print(f'{source} -> assets/phone/wallpapers/{name}.jpg')
