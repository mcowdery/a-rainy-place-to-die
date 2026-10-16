"""Turns the approved pictures of what Mack carries (assets/ads/source/NN_name.png, batch carry_props_01) into the
cut-outs the game draws on (story/phone.md): the pager, the ring binder, the leaf, the card and the rest.

  assets/phone/carry/<name>.webp   the object cut out of its grey ground (alpha), cropped to it with a 6 px margin
  assets/phone/carry/layout.json   each cut-out's size, and where the game draws on it, as percentages of the cut-out:
                                   `areas` are [left, top, width, height] (a display, a page, a label, a button)

The card is the picture as approved (the user, 2026-10-12: "original card is fine"). `--worn` also writes
card_worn.webp, a version squared off and aged that was offered and not taken up: the generator won't draw a Japanese
card's square corners or any wear (three more tries, batch carry_props_03, came back round-cornered and clean), so
`worn_card` makes one from two approved pictures: the card (99) cropped inside its rounded corners to a meishi's
91:55, with the old leaf's foxing (98), grubby edges, a little yellowing and one bent corner.

A snapshot kept in the binder (PRINTS: Megumi's) isn't cut out: the part of the picture that is the print is cropped.

An area named `paint` isn't for the game: it is lettering the generator put on the object (always garbled), covered
here with the plain surface just to its left, tiled across it.

The cut is rembg's (U-2-Net, the version pinned for its licence: .claude/rules/generated-art.md), so it runs from the
TripoSR environment, on the CPU, a few seconds a picture:

  ../TripoSR/.venv/Scripts/python.exe scripts/crop_carry.py [--check]

--check also writes debug-shots/carry-props/check_<name>.jpg: the cut-out over red with a 10% grid and its areas
outlined, which is how the areas below were read off (by eye; a picture replaced means reading them again).
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from rembg import new_session, remove

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets', 'ads', 'source')
OUT = os.path.join(ROOT, 'assets', 'phone', 'carry')
CHECK = os.path.join(ROOT, 'debug-shots', 'carry-props')

# source: (name, areas). Areas are percentages of the cut-out, [left, top, width, height].
CARRY = {
    # The window's lit part, where the digits go in it, the two rubber buttons, the red lamp, a clear patch for a maker's mark.
    '105_pager': ('pager', {
        'lcd': [20, 39.5, 64, 18.5],
        'digits': [21.5, 42.5, 61, 13.5],
        'buttons': [[37, 68.5, 16.5, 12], [58.5, 68.5, 15.5, 12]],
        'lamp': [77.1, 71.5, 4.5, 7.2],
        'maker': [9, 14, 34, 7],
    }),
    # The page clear of its ring holes, the five index tabs, the cover below the slots, and the five pockets on the cover: each from its
    # opening edge down (a card tucked in one shows above its edge and is hidden below it).
    '104_notebook_open': ('notebook_open', {
        'page': [50.8, 10.5, 28, 77],
        'tabs': [[81, 13.4, 2.6, 11.6], [81, 26, 2.6, 12.6], [81, 40, 2.6, 12.3], [81, 54.5, 2.6, 12.3], [81, 68.8, 2.6, 12.9]],
        'slots': [[2.4, 16.5, 21.6, 8], [2.4, 24.5, 21.6, 8], [2.4, 32.5, 21.6, 8.3], [2.4, 40.8, 21.6, 19.7], [2.4, 60.5, 21.6, 30]],
        'cover': [5, 64, 18, 28],
    }),
    '103_notebook_closed': ('notebook_closed', {}),
    '98_page_blank': ('page', {}),
    '99_card_blank': ('card', {}),
    '100_folded_sheet': ('sheet', {}),
    '101_microcassette': ('cassette', {}),
    '102_envelope': ('envelope', {}),
    # Its blank label; and the row of garbled lettering the generator moulded along its top edge, painted over.
    '106_videotape_partway': ('videotape', {'label': [31.5, 32, 37, 40], 'paint': [[22, 3.8, 55, 6]]}),
}

# Snapshots kept in the binder, not cut out: source: (name, the part of the picture that is the print [left, top, width, height] in %).
PRINTS = {
    '107_megumi_kamakura': ('megumi', [12, 3, 76, 70]),
}


def worn_card(card: Image.Image, leaf: Image.Image) -> Image.Image:
    """The approved card squared off and aged: see the header."""
    h = round(card.height * 0.86)
    w = round(h * 91 / 55)
    x0, y0 = (card.width - w) // 2, (card.height - h) // 2
    base = np.asarray(card.convert('RGB').crop((x0, y0, x0 + w, y0 + h)), dtype=np.float32) / 255
    # The leaf's foxing, as a tint: a part of it above its crease and clear of the ring holes, blurred until its ruled lines are gone
    # (only the blotches are wanted), evened to 1 and pushed; then a scatter of foxing specks of our own.
    lw, lh = leaf.size
    patch = leaf.convert('RGB').crop((round(lw * 0.2), round(lh * 0.1), round(lw * 0.92), round(lh * 0.44))).resize((w, h), Image.LANCZOS)
    stain = np.asarray(patch.filter(ImageFilter.GaussianBlur(h / 16)), dtype=np.float32) / 255
    stain = np.clip(1 + (stain / stain.mean(axis=(0, 1)) - 1) * 5, 0.7, 1.1)
    rng = np.random.default_rng(99)
    specks = Image.new('L', (w, h), 0)
    dots = ImageDraw.Draw(specks)
    for _ in range(46):
        cx, cy, r = rng.random() * w, rng.random() * h, 0.6 + rng.random() * 1.8
        dots.ellipse([cx - r, cy - r, cx + r, cy + r], fill=int(60 + rng.random() * 120))
    stain = stain * (1 - np.asarray(specks.filter(ImageFilter.GaussianBlur(0.7)), dtype=np.float32)[..., None] / 255 * np.array([0.22, 0.3, 0.42], dtype=np.float32))
    blotch = np.asarray(Image.fromarray((rng.random((7, 11)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    edge = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    grime = 1 - 0.3 * np.exp(-edge / (4 + 16 * blotch))
    out = base * stain * grime[..., None] * np.array([1.0, 0.965, 0.87], dtype=np.float32)
    # One corner bent over: the triangle a shade darker, a pale line along the fold.
    fold = (w - 1 - xx) + yy - 0.2 * h
    out = np.where((fold < 0)[..., None], out * 0.86, out)
    out = np.where((np.abs(fold) < 1.2)[..., None], np.minimum(1, out * 1.16), out)
    fine = (rng.random((h, w, 1)).astype(np.float32) - 0.5) * 0.035
    return Image.fromarray((np.clip(out + fine, 0, 1) * 255).astype(np.uint8)).convert('RGBA')


check = '--check' in sys.argv
os.makedirs(OUT, exist_ok=True)
session = new_session('u2net')
layout = {}
cuts = {}
for source, (name, areas) in CARRY.items():
    image = Image.open(os.path.join(SRC, source + '.png')).convert('RGB')
    cut = remove(image, session=session)
    box = cut.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox()
    cut = cut.crop((max(0, box[0] - 6), max(0, box[1] - 6), min(cut.width, box[2] + 6), min(cut.height, box[3] + 6)))
    for x, y, w, h in areas.get('paint', []):
        x0, y0, x1, y1 = (round(v) for v in (x * cut.width / 100, y * cut.height / 100, (x + w) * cut.width / 100, (y + h) * cut.height / 100))
        step = min(x1 - x0, round(cut.width * 0.12))
        patch = cut.crop((x0 - step, y0, x0, y1))
        for k, at in enumerate(range(x0, x1, step)):
            tile = patch if k % 2 else patch.transpose(Image.FLIP_LEFT_RIGHT)
            cut.paste(tile.crop((0, 0, min(step, x1 - at), y1 - y0)), (at, y0))
    cuts[name] = cut
    cut.save(os.path.join(OUT, name + '.webp'), quality=84, method=6)
    layout[name] = {'source': source, 'width': cut.width, 'height': cut.height, 'areas': {k: v for k, v in areas.items() if k != 'paint'}}
    print(f'{source} -> assets/phone/carry/{name}.webp  {cut.width}x{cut.height}')
    if check:
        os.makedirs(CHECK, exist_ok=True)
        scale = max(1, round(1100 / cut.width))
        big = cut.resize((cut.width * scale, cut.height * scale), Image.LANCZOS)
        sheet = Image.new('RGBA', big.size, (70, 20, 20, 255))
        sheet.alpha_composite(big)
        draw = ImageDraw.Draw(sheet)
        w, h = sheet.size
        for k in range(1, 20):
            shade = (0, 255, 255, 110 if k % 2 == 0 else 45)
            draw.line([k * w / 20, 0, k * w / 20, h], fill=shade)
            draw.line([0, k * h / 20, w, k * h / 20], fill=shade)
        for a in areas.values():
            for one in (a if isinstance(a[0], list) else [a]):
                draw.rectangle([one[0] * w / 100, one[1] * h / 100, (one[0] + one[2]) * w / 100, (one[1] + one[3]) * h / 100], outline=(255, 60, 60, 255), width=2)
        sheet.convert('RGB').save(os.path.join(CHECK, f'check_{name}.jpg'), quality=90)
if '--worn' in sys.argv:
    card = worn_card(cuts['card'], cuts['page'])
    card.save(os.path.join(OUT, 'card_worn.webp'), quality=86, method=6)
    print(f'99_card_blank + 98_page_blank -> assets/phone/carry/card_worn.webp  {card.width}x{card.height}')
for source, (name, box) in PRINTS.items():
    image = Image.open(os.path.join(SRC, source + '.png')).convert('RGB')
    w, h = image.size
    snap = image.crop((round(w * box[0] / 100), round(h * box[1] / 100), round(w * (box[0] + box[2]) / 100), round(h * (box[1] + box[3]) / 100)))
    snap = snap.resize((420, round(420 * snap.height / snap.width)), Image.LANCZOS)
    snap.save(os.path.join(OUT, name + '.webp'), quality=84, method=6)
    layout[name] = {'source': source, 'width': snap.width, 'height': snap.height, 'areas': {}}
    print(f'{source} -> assets/phone/carry/{name}.webp  {snap.width}x{snap.height}')
with open(os.path.join(OUT, 'layout.json'), 'w', encoding='utf-8') as f:
    json.dump(layout, f, indent=2)
    f.write('\n')
print('assets/phone/carry/layout.json')
