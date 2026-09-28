"""Stills for the prototype VN story s90 from approved Studio art (assets/ads/source/, see its .json provenance).

Writes content/vn/s90/assets/<frame key>.jpg, as a Studio export names them:
  s90.fr01  Mama-san, face to face (her talk, fr01-fr07 share it) <- 85_mama_frontal.png
  s90.fr10  the bar inside             <- 84_bar_interior.png
  s90.fr20  Room 303's door (the knock) <- 83_room303_door.png, its plate repainted to read 303
  s90.fr21  the same door (the voice)
  s90.fr22  the matchbook               <- 82_matchbook.png

    python scripts/vn/prep_s90.py
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'assets', 'ads', 'source')
OUT = os.path.join(ROOT, 'content', 'vn', 's90', 'assets')


def font(size: int) -> ImageFont.FreeTypeFont:
    for name in ('georgiab.ttf', 'georgia.ttf', 'timesbd.ttf', 'DejaVuSerif-Bold.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def door_303(im: Image.Image) -> Image.Image:
    """The generator lettered the plate 350: paint the field over and letter it 303 in the plate's brass."""
    im = im.convert('RGB')
    field = (745, 276, 794, 296)
    plate = im.crop(field)
    # The field's colour (its darker half) and the brass (its brightest pixels).
    px = sorted((plate.getpixel((x, y)) for y in range(plate.height) for x in range(plate.width)), key=sum)
    dark = tuple(sum(c[i] for c in px[: len(px) // 2]) // (len(px) // 2) for i in range(3))
    brass = tuple(sum(c[i] for c in px[-12:]) // 12 for i in range(3))
    layer = Image.new('RGB', (field[2] - field[0], field[3] - field[1]), dark)
    d = ImageDraw.Draw(layer)
    f = font(17)
    w = d.textlength('303', font=f)
    d.text(((layer.width - w) / 2, -1), '303', font=f, fill=brass)
    layer = layer.filter(ImageFilter.GaussianBlur(0.6))
    im.paste(layer, field[:2])
    return im


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    save = lambda im, key: im.convert('RGB').save(os.path.join(OUT, f'{key}.jpg'), quality=88)
    save(Image.open(os.path.join(SRC, '85_mama_frontal.png')), 's90.fr01')
    save(Image.open(os.path.join(SRC, '84_bar_interior.png')), 's90.fr10')
    door = door_303(Image.open(os.path.join(SRC, '83_room303_door.png')))
    save(door, 's90.fr20')
    save(door, 's90.fr21')
    save(Image.open(os.path.join(SRC, '82_matchbook.png')), 's90.fr22')
    print('wrote', ', '.join(sorted(os.listdir(OUT))))


if __name__ == '__main__':
    main()
