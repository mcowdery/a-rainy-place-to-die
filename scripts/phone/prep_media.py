"""Phone media for the prototype conversations, from approved Studio art (assets/ads/source/) and the VN stills.

    python scripts/phone/prep_media.py

Writes content/phone/media/: mama_avatar.jpg (her face, from 85_mama_frontal), bar_tonight.jpg (the bar, a phone
photo), room303.jpg (the door, a portrait crop as if taken on a phone, from the s90 still lettered 303).
The video clip (rouge_cam.webm) is recorded in-game by scripts/phone/record_clip.mjs.
"""
import os

from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'assets', 'ads', 'source')
OUT = os.path.join(ROOT, 'content', 'phone', 'media')


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    mama = Image.open(os.path.join(SRC, '85_mama_frontal.png')).convert('RGB')
    mama.crop((478, 40, 1058, 620)).resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, 'mama_avatar.jpg'), quality=88)
    bar = Image.open(os.path.join(SRC, '84_bar_interior.png')).convert('RGB')
    # A phone snap: a little tighter, a little warmer and brighter.
    bar = bar.crop((60, 20, 1476, 816)).resize((1080, 607), Image.LANCZOS)
    bar = ImageEnhance.Brightness(bar).enhance(1.12)
    bar.save(os.path.join(OUT, 'bar_tonight.jpg'), quality=85)
    door = Image.open(os.path.join(ROOT, 'content', 'vn', 's90', 'assets', 's90.fr20.jpg')).convert('RGB')
    door.crop((452, 40, 1084, 864)).resize((720, 939), Image.LANCZOS).save(os.path.join(OUT, 'room303.jpg'), quality=85)
    print('wrote', ', '.join(sorted(os.listdir(OUT))))


if __name__ == '__main__':
    main()
