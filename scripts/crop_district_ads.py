"""Crops approved district ad art (assets/ads/source/NN_name.png) into runtime textures.

  assets/ads/kaburo/NN_name.jpg   billboards 1024x512 (2:1), posters 512x620 (the photo part of a 512x768
                                  poster; the brand band below it is composited in-engine)

Crop boxes are hand-picked per image to drop the generator's garbled lettering; a few images also get a
patch painted over lettering that sits inside the subject (e.g. the energy-drink can).

  python scripts/crop_district_ads.py
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets', 'ads', 'source')
OUT = os.path.join(ROOT, 'assets', 'ads', 'kaburo')

BILLBOARD = (1024, 512)
POSTER = (512, 620)

# name: (format, crop box (l, t, r, b) in source pixels or None for the whole image)
CROPS = {
    '10_club_adonis_hosts': ('billboard', None),
    '12_hotel_rouge_julie': ('billboard', None),
    '13_hotel_rouge': ('billboard', None),
    '14_hotel_venus': ('billboard', None),  # 840x768: the atlas puts it beside a text panel
    '17_parlor_ginga': ('billboard', None),
    '19_yakou_drink_billboard': ('billboard', None),
    '21_club_moonlight': ('billboard', None),
    '09_annaijo_girls': ('poster', (0, 0, 832, 1007)),
    '11_hikari_loan': ('poster', (65, 0, 767, 850)),  # stops above the garbled headline
    '15_karaoke_dream': ('poster', (11, 0, 821, 980)),  # stops above the garbled title
    '16_kirishima_poster': ('poster', (0, 110, 832, 1117)),
    '18_tsukuyomi_fortune': ('poster', (0, 100, 832, 1107)),
    '20_yonaki_ramen': ('poster', (0, 150, 832, 1157)),
    '22_hotel_venus_poster': ('poster', (0, 0, 832, 1007)),
    # Round 2 (headline posters keep their top band: the user likes the loud headline look).
    '23_gabunomi_izakaya': ('poster', (0, 209, 832, 1216)),
    '24_cash_one_poster': ('poster', (0, 100, 832, 1107)),
    '25_julie_album': ('poster', (0, 60, 832, 1067)),
    '26_julie_album': ('poster', (0, 60, 832, 1067)),
    '27_election_tadokoro': ('poster', (0, 0, 832, 1007)),
    '28_election_tadokoro': ('poster', (0, 0, 832, 1007)),
    '29_wanted_notice': ('poster', (0, 0, 832, 1007)),
    '30_wanted_notice': ('poster', (0, 0, 832, 1007)),
    '31_gabunomi_izakaya': ('poster', (0, 0, 832, 1007)),
    '32_yorumart_poster': ('poster', (0, 0, 832, 1007)),
    '33_yorumart_poster': ('poster', (0, 0, 832, 1007)),
    '34_live_singer_poster': ('poster', (0, 60, 832, 1067)),
    '35_live_singer_poster': ('poster', (0, 60, 832, 1067)),
    '36_gabunomi_izakaya': ('poster', (0, 0, 832, 1007)),
    '37_live_nightdrive': ('billboard', None),
    '38_yorumart_food': ('billboard', None),
    '39_hotel_aqua': ('billboard', None),
    '40_hotel_aqua': ('billboard', None),
    '41_gekko_whisky': ('billboard', None),
    '42_gekko_whisky': ('billboard', None),
    '43_gzone_arcade': ('billboard', None),
    '44_midnight_sisters': ('billboard', None),
    '45_tokyo_noir_film': ('billboard', None),
    '46_tokyo_noir_film': ('billboard', None),
    '47_ryujin_kogyo': ('billboard', None),
    '48_ryujin_kogyo': ('billboard', None),
    # Round 3.
    '53_maid_cafe_pure': ('billboard', None),
    '54_cash_one': ('billboard', None),
    '55_hotel_orient': ('billboard', None),
    '56_hotel_orient': ('billboard', None),
    '57_hotel_sakura': ('billboard', None),
    '58_hotel_sakura': ('billboard', None),
    '59_club_prince': ('billboard', None),
    '60_club_prince': ('billboard', None),
    '62_tokyo_noir_film_jp': ('billboard', None),
    '63_gzone_arcade_dirty': ('billboard', None),
    '66_maid_cafe_pure_poster': ('poster', (0, 30, 832, 1037)),
    '67_maid_cafe_pure_poster': ('poster', (0, 30, 832, 1037)),
    '68_hotel_mirage_poster': ('poster', (0, 20, 832, 1027)),
    '69_hotel_mirage_poster': ('poster', (0, 20, 832, 1027)),
    '70_momogen_esthe': ('poster', (0, 80, 832, 1087)),
    '71_momogen_esthe': ('poster', (0, 80, 832, 1087)),
    '72_snack_yasoukyoku': ('poster', (0, 110, 832, 1117)),
    '73_netcafe_yobune': ('poster', (0, 100, 832, 1107)),
    '74_capsule_hotel': ('poster', (0, 100, 832, 1107)),
    '75_mahjong_tonpu': ('poster', (0, 100, 832, 1107)),
    '76_cash_one_poster': ('poster', (0, 60, 832, 1067)),
    '78_maruyoshi_pawn': ('poster', (0, 100, 832, 1107)),
    '79_netcafe_yobune': ('poster', (0, 100, 832, 1107)),
}


def patch_can(im: Image.Image) -> None:
    """Covers the garbled 'ohwx' on the energy-drink can with the can's red and the real brand."""
    box = (318, 248, 508, 376)
    # Fill with the can's own starburst red from just below the label, blurred.
    region = im.crop((box[0], 382, box[2], 470)).resize((box[2] - box[0], box[3] - box[1]))
    im.paste(region.filter(ImageFilter.GaussianBlur(8)), box[:2])
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/YuGothB.ttc', 58)
    except OSError:
        font = ImageFont.load_default()
    d.text(((box[0] + box[2]) / 2, box[1] + 50), '夜光', font=font, fill=(255, 245, 230), anchor='mm')
    try:
        small = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 20)
    except OSError:
        small = ImageFont.load_default()
    d.text(((box[0] + box[2]) / 2, box[1] + 100), 'YAKOU ENERGY', font=small, fill=(255, 235, 200), anchor='mm')


os.makedirs(OUT, exist_ok=True)
for name, (fmt, box) in CROPS.items():
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGB')
    if name == '19_yakou_drink_billboard':
        patch_can(im)
    if box:
        im = im.crop(box)
    if fmt == 'billboard' and abs(im.width / im.height - 2) > 0.05:
        # Not 2:1 (the cropped Hotel Venus): keep its own aspect at billboard height.
        im = im.resize((round(BILLBOARD[1] * im.width / im.height), BILLBOARD[1]), Image.LANCZOS)
    else:
        im = im.resize(BILLBOARD if fmt == 'billboard' else POSTER, Image.LANCZOS)
    im.save(os.path.join(OUT, name + '.jpg'), quality=87)
    print(name, fmt, im.size)
