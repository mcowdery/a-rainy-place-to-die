"""
The muzzle flash's flipbooks, from CGHEVEN's "Muzzle Flash 01" (realistic; free, CC0: https://cgheven.com/licensing),
a simulated flash seen from the side and from the front as 5x5 flipbooks at 4K with alpha
(https://cgheven.com/assets/muzzle-flash-01-side-flipbook-5x5, ...-front-flipbook-5x5).

This lays each over black (the game adds it to the picture, so black is nothing), keeps its first twenty frames (the
last five are empty), and writes them 5x4 at 320 px a frame as assets/vfx/muzzle_side.webp and muzzle_front.webp,
with CREDITS.md beside them. models/muzzleFlash.ts plays them.

  python scripts/vfx/flash_atlas.py <Realistic_muzzle_01_Side_4K_5x5.png> <Realistic_muzzle_01_Front_4K_5x5.png>
"""
import os
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
CELL = 320
COLS, ROWS = 5, 4


def atlas(src, dst):
    im = Image.open(src).convert('RGBA')
    cell = im.size[0] // 5
    out = Image.new('RGB', (COLS * CELL, ROWS * CELL), (0, 0, 0))
    for r in range(ROWS):
        for c in range(COLS):
            f = im.crop((c * cell, r * cell, (c + 1) * cell, (r + 1) * cell)).resize((CELL, CELL), Image.LANCZOS)
            out.paste(f, (c * CELL, r * CELL), f)
    out.save(dst, 'WEBP', quality=90, method=6)
    print(dst, out.size, os.path.getsize(dst) // 1024, 'KB')


root = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'vfx'))
os.makedirs(root, exist_ok=True)
atlas(sys.argv[1], os.path.join(root, 'muzzle_side.webp'))
atlas(sys.argv[2], os.path.join(root, 'muzzle_front.webp'))
open(os.path.join(root, 'CREDITS.md'), 'w', encoding='utf-8', newline='\n').write(
    '# Effects\n\n`muzzle_side.webp`, `muzzle_front.webp`: the muzzle flash, from **CGHEVEN**\'s "Muzzle Flash 01" (realistic) by Ammar Khan,\n'
    'a free asset under CC0 (https://cgheven.com/licensing: free to use in any project, personal or commercial, no attribution\n'
    'needed; not to be resold as a standalone asset). Sources: https://cgheven.com/assets/muzzle-flash-01-side-flipbook-5x5 and\n'
    'https://cgheven.com/assets/muzzle-flash-01-front-flipbook-5x5 (4K 5x5 flipbooks), cut down by `scripts/vfx/flash_atlas.py`.\n')
