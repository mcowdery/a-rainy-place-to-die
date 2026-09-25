"""Crops the generated taxi-ad photos into the textures the taxi ads use.

Source: the Krea Studio VN generator's outputs/taxi-ads/NN_name.png (1024x1024). For each ad this writes
  assets/ads/NN_name_roof.jpg  square head-and-shoulders crop (the photo end of the roof lightbox)
  assets/ads/NN_name_door.jpg  3:4 tall crop (the photo half of the rear-door wrap)
The text (brand, tagline, phone number) is not baked in: the engine composites it next to the photo
(real/adAtlas.ts), so copy can change without regenerating art. Crop boxes are hand-picked per image and
avoid the generator's garbled lettering where there is any.

  python scripts/crop_ads.py [source_dir]
"""
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'krea-2-turbo', 'krea2-studio', 'outputs', 'taxi-ads')
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'ads')

# name: (roof square box, door 3:4 box) as (left, top, right, bottom) in 1024x1024 source pixels.
CROPS = {
    '01_yakou_drink': ((150, 20, 690, 560), (120, 10, 630, 690)),
    '02_kirishima_investigations': ((245, 50, 775, 580), (200, 40, 800, 840)),
    '03_missing_person': ((212, 90, 812, 690), (237, 60, 787, 793)),
    '04_sunrise_records': ((335, 20, 935, 620), (345, 0, 930, 780)),
    '05_mirai_life': ((207, 60, 807, 660), (232, 40, 782, 773)),
    '06_hotel_paradise': ((249, 20, 849, 620), (224, 0, 824, 800)),
    '07_bar_kanpai': ((225, 150, 690, 615), (200, 150, 690, 803)),
    '08_kabura_credit_union': ((212, 60, 812, 660), (237, 40, 787, 773)),
}
ROOF = (256, 256)
DOOR = (360, 480)

os.makedirs(OUT, exist_ok=True)
for name, (roof, door) in CROPS.items():
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGB')
    im.crop(roof).resize(ROOF, Image.LANCZOS).save(os.path.join(OUT, name + '_roof.jpg'), quality=88)
    im.crop(door).resize(DOOR, Image.LANCZOS).save(os.path.join(OUT, name + '_door.jpg'), quality=88)
    print(name)
