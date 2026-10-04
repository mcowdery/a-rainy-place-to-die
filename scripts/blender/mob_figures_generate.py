"""Writes the generated part of scripts/blender/mob_figures.json: a varied Japanese crowd for the mob, each figure a
MakeHuman body of its own age and build with a hairstyle and an outfit from the CC0 assets installed in MPFB's data
folder (run with plain Python; then `python scripts/blender/mob_figures.py` builds them):

  python scripts/blender/mob_figures_generate.py [--women 34] [--men 28] [--students 8] [--children 6] [--seed 7]

The hand-written figures in the list (names not starting mw_, mm_, ms_, mk_) are kept as they are. Everything is
drawn from a seeded generator, so the same arguments give the same crowd; no two figures share hair and clothes.
Families by the name's prefix: mw women, mm men, ms students, mk children.
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, 'mob_figures.json')

W_HAIR = ['long01', 'o4saken_long01', 'ponytail01', 'bob01', 'bob02', 'braid01', 'toigo_blunt_bob', 'toigo_blunt_bob_with_bangs', 'toigo_curled_under_bob',
          'toigo_curled_under_bob_with_bangs', 'toigo_inverted_bob', 'toigo_inverted_bob_with_bangs', 'cortu_straight_bangs', 'littleright_bobcut_hair',
          'rehmanpolanski_hair_bun_brown', 'elvs_reverse_french_braid_bun', 'elvs_french_braid_variation', 'elvs_double_mh_braid', 'culturalibre_hair_01',
          'culturalibre_hair_02', 'culturalibre_hair_05', 'culturalibre_hair_06']
W_HAIR_OLD = ['rehmanpolanski_hair_bun_brown', 'bob02', 'toigo_curled_under_bob', 'elvs_reverse_french_braid_bun', 'short03']
M_HAIR = ['short01', 'short02', 'short03', 'short04', 'cortu_short_messy_hair', 'short02', 'short04']
W_ONE = ['female_casualsuit01', 'female_casualsuit02', 'female_elegantsuit01', 'female_sportsuit01', 'toigo_female_suit', 'toigo_female_suit_2',
         'toigo_female_double-breasted_suit', 'toigo_shift_dress', 'elvs_simple_fashion_dress_1', 'elvs_simple_fashion_dress_2', 'elvs_simple_60s_dress',
         'toigo_keyhole_neck_dress', 'toigo_halter_dress_knee_length', 'toigo_camisole_dress_with_full_skirt', 'toigo_dress_with_tiered_skirt',
         'elvs_halter_dress_knee_length', 'toigo_bodice_dress_with_lace_ruffle_skirt']
W_TOP = ['joepal_crude_t-shirt_female', 'toigo_basic_tucked_t-shirt', 'toigo_fisherman_sweater', 'toigo_camisole_top', 'toigo_keyhole_tank_top',
         'wolgade_female_top_01']
# (cortu_cargo_pants comes through the triangle cut in shards: left out.)
W_PANTS = ['toigo_wool_pants', 'toigo_wool_pants', 'cortu_jeans_shorts']
W_SKIRT = ['frankyaye_mini_skirt_01', 'frankyaye_mini_skirt_02', 'toigo_tiered_skirt', 'toigo_long_full_skirt',
           'toigo_skirt_with_lace_ruffle']
W_LEGS = ['kwnet_at_pantyhose01', 'marco_105_stocking01', 'joepal_crude_high_socks', 'toigo_lace_frill_socks']
W_SHOES = ['toigo_ballet_flats', 'toigo_flats', 'toigo_ballet_flats_with_bows', 'toigo_ankle_boots_female', 'toigo_stiletto_booties', 'shoes02',
           'toigo_mj_cloth_shoes']
M_ONE = ['male_casualsuit01', 'male_casualsuit02', 'male_casualsuit03', 'male_casualsuit04', 'male_casualsuit05', 'male_casualsuit06', 'male_elegantsuit01',
         'male_worksuit01', 'toigo_male_suit_3', 'toigo_male_suit_tie_and_jacket', 'toigo_male_double-breasted_suit']
M_TOP = ['elvs_crude_t-shirt_male', 'namuhekam_male_polo_shirt', 'toigo_fisherman_sweater']
M_PANTS = ['toigo_wool_pants', 'toigo_wool_pants', 'cortu_jeans_shorts']
M_SHOES = ['shoes01', 'shoes03', 'shoes04', 'shoes05', 'shoes06', 'toigo_ankle_boots_male']
M_HATS = ['elvs_male_flat_cap1', 'elvs_slouchy_beanie1', 'mindfront_knitted_hat_01', 'fedora01']
KIMONO = 'mindfront_kimono'


def arg(name, default):
    a = sys.argv[1:]
    return int(a[a.index('--' + name) + 1]) if '--' + name in a else default


def main():
    rnd = random.Random(arg('seed', 7))
    r2 = lambda v: round(v, 2)
    tri = lambda lo, mid, hi: rnd.triangular(lo, hi, mid)
    used = set()
    figures = []

    def add(prefix, mob, body, hair, clothes, targets=None):
        key = (hair, tuple(clothes))
        if key in used:
            return False
        used.add(key)
        n = sum(1 for f in figures if f['name'].startswith(prefix)) + 1
        fig = {'name': '%s_%03d' % (prefix, n), 'mob': mob, 'body': body, 'hair': hair, 'clothes': clothes}
        if targets:
            fig['targets'] = targets
        figures.append(fig)
        return True

    def woman_clothes(old):
        k = rnd.random()
        if k < 0.05:
            return [KIMONO, 'toigo_flats']
        if k < 0.5:
            one = rnd.choice(W_ONE)
            shoes = 'shoes02' if 'sport' in one else rnd.choice(W_SHOES[:5] if 'suit' in one else W_SHOES)
            legs = [rnd.choice(W_LEGS[:2])] if ('dress' in one or 'suit' in one) and rnd.random() < 0.3 else []
            return [one] + legs + [shoes]
        top = rnd.choice(W_TOP)
        if rnd.random() < (0.7 if old else 0.45):
            return [top, rnd.choice(W_PANTS[:2] if old else W_PANTS), rnd.choice(W_SHOES)]
        skirt = rnd.choice(W_SKIRT[3:] if old else W_SKIRT)
        legs = [rnd.choice(W_LEGS)] if rnd.random() < 0.45 else []
        return [top, skirt] + legs + [rnd.choice(W_SHOES)]

    def man_clothes(old):
        k = rnd.random()
        if k < 0.04:
            return [KIMONO, 'shoes04']
        if k < 0.62:
            out = [rnd.choice(M_ONE), rnd.choice(M_SHOES)]
        else:
            out = [rnd.choice(M_TOP), rnd.choice(M_PANTS[:2] if old else M_PANTS), rnd.choice(M_SHOES)]
        if rnd.random() < 0.14:
            out.append(rnd.choice(M_HATS))
        return out

    hairs = W_HAIR[:]
    rnd.shuffle(hairs)
    i = 0
    while sum(1 for f in figures if f['name'].startswith('mw_')) < arg('women', 34):
        years = int(tri(19, 30, 78))
        old = years >= 62
        body = {'gender': 0, 'years': years, 'height-cm': int(tri(147, 157, 168)) - (4 if old else 0), 'weight': r2(tri(0.3, 0.45, 0.78)), 'muscle': r2(tri(0.32, 0.45, 0.62)),
                'cupsize': r2(tri(0.35, 0.5, 0.78)), 'proportions': r2(tri(0.4, 0.6, 0.85))}
        hair = rnd.choice(W_HAIR_OLD) if old else hairs[i % len(hairs)]
        i += 1
        add('mw', 'elder' if years >= 70 else 'woman', body, hair, woman_clothes(old))
    while sum(1 for f in figures if f['name'].startswith('mm_')) < arg('men', 28):
        years = int(tri(19, 34, 80))
        old = years >= 62
        body = {'gender': 1, 'years': years, 'height-cm': int(tri(160, 171, 182)) - (4 if old else 0), 'weight': r2(tri(0.3, 0.48, 0.85)), 'muscle': r2(tri(0.32, 0.5, 0.78)),
                'proportions': r2(tri(0.4, 0.55, 0.8))}
        hair = 'none' if old and rnd.random() < 0.35 else rnd.choice(M_HAIR)
        add('mm', 'elder' if years >= 70 else 'man', body, hair, man_clothes(old))
    # Students: a white shirt or a sweater over a short skirt and knee socks; a shirt and trousers.
    while sum(1 for f in figures if f['name'].startswith('ms_')) < arg('students', 8):
        girl = sum(1 for f in figures if f['name'].startswith('ms_')) % 2 == 0
        years = rnd.randint(15, 18)
        if girl:
            body = {'gender': 0, 'years': years, 'height-cm': rnd.randint(150, 163), 'weight': r2(tri(0.3, 0.4, 0.55)), 'cupsize': r2(tri(0.35, 0.45, 0.6))}
            clothes = [rnd.choice(['toigo_basic_tucked_t-shirt', 'toigo_fisherman_sweater', 'wolgade_female_top_01']), rnd.choice(['frankyaye_mini_skirt_02', 'frankyaye_mini_skirt_01']),
                       rnd.choice(['joepal_crude_high_socks', 'toigo_lace_frill_socks']), rnd.choice(['toigo_flats', 'toigo_mj_cloth_shoes', 'toigo_ballet_flats'])]
            add('ms', 'woman', body, rnd.choice(['ponytail01', 'toigo_blunt_bob_with_bangs', 'long01', 'braid01', 'cortu_straight_bangs', 'elvs_double_mh_braid', 'bob01']), clothes)
        else:
            body = {'gender': 1, 'years': years, 'height-cm': rnd.randint(162, 178), 'weight': r2(tri(0.3, 0.4, 0.55)), 'muscle': r2(tri(0.35, 0.45, 0.6))}
            clothes = [rnd.choice(['namuhekam_male_polo_shirt', 'toigo_fisherman_sweater', 'elvs_crude_t-shirt_male']), 'toigo_wool_pants', rnd.choice(['shoes01', 'shoes03', 'shoes06'])]
            add('ms', 'man', body, rnd.choice(M_HAIR), clothes)
    while sum(1 for f in figures if f['name'].startswith('mk_')) < arg('children', 6):
        girl = sum(1 for f in figures if f['name'].startswith('mk_')) % 2 == 0
        years = rnd.randint(7, 11)
        body = {'gender': 0 if girl else 1, 'years': years, 'height-cm': 100 + years * 4 + rnd.randint(-3, 4)}
        if girl:
            clothes = rnd.choice([['joepal_crude_t-shirt_female', 'frankyaye_mini_skirt_02', 'toigo_flats'], ['toigo_shift_dress', 'toigo_mj_cloth_shoes'], ['joepal_crude_t-shirt_female', 'cortu_jeans_shorts', 'shoes02']])
            add('mk', 'child', body, rnd.choice(['bob01', 'ponytail01', 'elvs_double_mh_braid', 'toigo_blunt_bob_with_bangs']), clothes)
        else:
            clothes = [rnd.choice(['elvs_crude_t-shirt_male', 'namuhekam_male_polo_shirt']), rnd.choice(['cortu_jeans_shorts', 'toigo_wool_pants']), rnd.choice(['shoes01', 'shoes03'])]
            add('mk', 'child', body, rnd.choice(['short01', 'short02', 'short04']), clothes)

    with open(PATH, encoding='utf-8') as f:
        doc = json.load(f)
    keep = [f for f in doc['figures'] if f['name'].split('_')[0] not in ('mw', 'mm', 'ms', 'mk')]
    doc['figures'] = keep + figures
    lines = ['{', '  "about": ' + json.dumps(doc['about']) + ',', '  "figures": [']
    for i, fig in enumerate(doc['figures']):
        lines.append('    ' + json.dumps(fig) + (',' if i + 1 < len(doc['figures']) else ''))
    lines += ['  ]', '}', '']
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print('kept', len(keep), 'hand-written; generated', len(figures))


if __name__ == '__main__':
    main()
