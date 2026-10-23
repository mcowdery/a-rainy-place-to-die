"""The enemies as textured MakeHuman figures, made from recipes so no two in a group look alike (run with plain Python):

  python scripts/blender/enemy_figures.py --generate        rolls the figures from RECIPES into enemy_figures.json
  python scripts/blender/enemy_figures.py [names] [--jobs 3] builds them (assets/humans/<name>.glb)

On the pod:
  node scripts/pod.mjs run --out assets/humans -- env BLENDER=/workspace/blender/blender python3 scripts/blender/enemy_figures.py

The plan (the user, 2026-10-16): enemies are MakeHuman figures, mainly yakuza, varied in body, face, hair and clothes;
models first, reviewed on the MakeHuman test page (humans.html, a line-up a faction) before anything goes further.
So far the first two kinds, 1992's (story/premise.md: an unspoken 1992):

- **rk: Ryujin Kogyo's men** (story/factions.md: the yakuza front on Kaburo's Host Street). The bōtaihō has just pushed
  the families behind front companies: men in suits. Executives in double-breasted suits, slicked back or permed,
  round gold-rimmed tinted glasses; soldiers in dark suits and dark shirts, tinted glasses; a flash one in a white
  dinner jacket with a gold chain; heavy bodyguards in black with dark glasses.
- **cp: chinpira**, the street-level hangers-on: aloha shirts (a hibiscus print, build_character.py's `print`), black
  bontan (MakeHuman's harem trousers, darkened: the yankii's wide trousers), open striped shirts, white tees and jeans,
  bleached or permed hair, chains, a black mask.

A recipe gives each role its age, build, face range, hair, clothes and their colours; `--generate` rolls each figure
from its role with its own seed (deterministic), and writes the list, which is what gets built and what the page
lists. The punch perm and the slicked-back cut are garments.py's `haircut` (the perm with `curl`); the chain is its
`chain`. Colours are the noir palette's (people-mob-and-cast: muted, no bright colours). Every asset is CC0 (each
one's own file; the two AGPL3 glasses and the CC-BY flat cap are left out): assets/humans/CREDITS.md.
"""
import json
import os
import random
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BLENDER = os.environ.get('BLENDER', r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe')
LIST = os.path.join(REPO, 'scripts', 'blender', 'enemy_figures.json')
DEFS = os.path.join(REPO, 'debug-shots', 'humans', 'defs')
OUT = 'assets/humans'
MAX_TRIS = {'clothes': 7000, 'hair': 6000}

DARK_HAIR = ['#141210', '#18130f', '#1c1610']
# Greying with age: salt and pepper from the mid-forties, grey from the mid-fifties, white-grey past sixty.
GREYING = '#3a3836'
SALT = '#58554f'
GREY = '#86837d'
BLEACHED = ['#6e5232', '#7a5c38', '#5e4630']

# The haircuts made here (garments.py): a punch perm (tight curls, a squared hairline) and a cut slicked back.
HAIRLINE = [[0, 24], [30, 24], [50, 22], [62, 20], [70, 12], [78, 0], [84, -8], [90, 4], [96, 10], [104, 8], [110, -10], [116, -30], [124, -42], [140, -50], [160, -54], [180, -54]]
# (The perm's first build was a smooth black bowl: 3 cm thick at the front, too rough to catch a highlight. Now thin at
# the front with a blunt edge, lumpy, glossier, the curls' relief strong.)
# A perm's front: higher and squared off, the corners cut back at the temples (in the first build it sat low across the
# forehead like a bowl cut).
PERM_LINE = [[0, 33], [25, 33], [40, 31], [52, 22], [62, 18], [70, 12], [78, 0], [84, -8], [90, 4], [96, 10], [104, 8], [110, -10], [116, -30], [124, -42], [140, -50], [160, -54], [180, -54]]
PERM = {'type': 'haircut', 'reach': 0.16, 'roughness': 0.42, 'specular': 0.5, 'normal': 1.6, 'sheen': 0.95, 'hairline': PERM_LINE, 'tile': [3.4, 3.4], 'curl': {'count': 80, 'radius': [15, 22], 'lumps': 0.004},
        'volume': {'sides': 0.011, 'back': 0.014, 'nape': 0.005, 'crown': 0.02, 'front': 0.016, 'edge': 0.0015, 'edge_deg': 4}}
SLICK = {'type': 'haircut', 'reach': 0.15, 'roughness': 0.45, 'specular': 0.5, 'hairline': HAIRLINE, 'cards': {'count': 300, 'length': [0.035, 0.07], 'lift': 0.0018, 'width': 0.016}}

# (The user, of the shells in the game: "these haircuts are the main problem ... the head is oblonged ... the hairline
# looks bad", "very shiny"; of MakeHuman's short01: "I really like how this hair turned out". So nobody wears PERM or
# SLICK for now: they stay here for a better perm later. MakeHuman's short03 is out too: a glossy swoop of fringe over
# one eye.)
# Clothes' recolours: a suit's cloth (the dark of its texture) and its shirt (the light), each kept to its own range.
def suit(asset, cloth, shirt=None, contrast=0.85):
    ops = [{'op': 'colorize', 'color': cloth, 'contrast': contrast, 'lum': [0, 0.45], 'orig': True}]
    if shirt:
        ops.append({'op': 'colorize', 'color': shirt, 'contrast': 0.6, 'lum': [0.45, 1], 'orig': True})
    return {'asset': asset, 'ops': ops}


def plain(asset, color=None, contrast=0.7, roughness=0.85):
    return {'asset': asset, 'roughness': roughness, 'ops': [{'op': 'colorize', 'color': color, 'contrast': contrast}] if color else []}


ALOHA = [
    {'base': '#1e2633', 'flowers': ['#8a4a32', '#b0956a'], 'leaf': '#2e3a2c'},
    {'base': '#141414', 'flowers': ['#b8b0a0', '#7a3a34'], 'leaf': '#3a4038'},
    {'base': '#5e4a24', 'flowers': ['#2a2018', '#a88a5a'], 'leaf': '#3a3018'},
    {'base': '#2c3a3a', 'flowers': ['#9a8a6a', '#6a3030'], 'leaf': '#1e2a26'},
]
# Tinted glasses: the round gold-rimmed ones as they come (a brown tint), or the square ones made dark all over.
# (Both kept clear of the face: fitted to MakeHuman's own, the heavier brows and cheeks came through them.)
ROUND_GOLD = {'asset': 'toigo_round_glasses_leopard', 'roughness': 0.3, 'clear': 0.003}
# (The lenses are 20% alpha, which the game's cut-out drops: made opaque, they're dark lenses.)
DARK_GLASSES = {'asset': 'spamrakuen_sagerfrogs_glasses_01', 'roughness': 0.2, 'clear': 0.003, 'ops': [{'op': 'opaque'}, {'op': 'colorize', 'color': '#121212', 'contrast': 0.4}]}
BLACK_MASK = plain('joepal_medical_mouth_protection', '#1a1a1c', 0.5)
LOAFERS = plain('shoes04', '#111012', 0.8, 0.35)
SNEAKERS = plain('shoes06', '#c8c4bc', 0.6, 0.6)
CHAIN = {'type': 'chain', 'color': '#a8843c', 'drop': 0.07}

# (Everyone fought is an adult: the youngest chinpira are 20.)
RECIPES = {
    'rk': [
        {'role': 'executive', 'n': 3, 'years': [48, 66], 'height': [166, 178], 'muscle': [0.45, 0.6], 'weight': [0.5, 0.75],
         'hair': ['short04', 'short01'], 'glasses': [ROUND_GOLD, ROUND_GOLD, None],
         'clothes': [[suit('toigo_male_double-breasted_suit', c)] for c in ['#26262a', '#1a1a1c', '#3a3428', '#4a4846']], 'shoes': [LOAFERS]},
        {'role': 'soldier', 'n': 2, 'years': [28, 44], 'height': [168, 180], 'muscle': [0.55, 0.75], 'weight': [0.4, 0.6],
         'hair': ['short01', 'short04', 'shaved'], 'glasses': [DARK_GLASSES, None],
         'clothes': [[suit(a, c, s)] for a in ['male_elegantsuit01', 'toigo_male_suit_3'] for c, s in [('#161618', '#2a2224'), ('#22242a', '#3a2a2a'), ('#1a1a1c', None)]], 'shoes': [LOAFERS]},
        {'role': 'flash', 'n': 1, 'years': [34, 48], 'height': [170, 178], 'muscle': [0.5, 0.65], 'weight': [0.45, 0.6],
         'hair': ['short04'], 'glasses': [ROUND_GOLD], 'chain': True,
         'clothes': [[{'asset': 'toigo_suit_with_dinner_jacket', 'ops': [{'op': 'grade', 'gain': [0.92, 0.88, 0.8], 'saturation': 0.8}]}]], 'shoes': [LOAFERS]},
        {'role': 'guard', 'n': 2, 'years': [30, 46], 'height': [178, 186], 'muscle': [0.8, 0.95], 'weight': [0.7, 0.85],
         'hair': ['short04', 'shaved', 'short01'], 'glasses': [DARK_GLASSES],
         'clothes': [[suit('male_elegantsuit01', '#121214', '#1c1c1e')]], 'shoes': [LOAFERS]},
    ],
    'cp': [
        {'role': 'aloha', 'n': 3, 'years': [21, 30], 'height': [164, 178], 'muscle': [0.4, 0.6], 'weight': [0.3, 0.55],
         'hair': ['short04', 'bleached', 'shaved'], 'glasses': [DARK_GLASSES, None, None], 'chain': True,
         'clothes': [[{'asset': 'namuhekam_male_polo_shirt', 'roughness': 0.8, 'ops': [dict(op='print', tile=0.24, seed=i + 3, **a)]}, plain(p, c)] for i, a in enumerate(ALOHA) for p, c in [('toigo_harem_pants', '#141416'), ('toigo_wool_pants', '#2a2a2c')]],
         'shoes': [LOAFERS, SNEAKERS]},
        {'role': 'striped', 'n': 2, 'years': [22, 31], 'height': [166, 176], 'muscle': [0.4, 0.55], 'weight': [0.35, 0.5],
         'hair': ['bleached', 'short01', 'short04'], 'glasses': [DARK_GLASSES, None], 'chain': True,
         'clothes': [[plain('male_casualsuit03')], [plain('male_casualsuit05')]], 'shoes': [LOAFERS, SNEAKERS]},
        {'role': 'tee', 'n': 3, 'years': [20, 28], 'height': [164, 176], 'muscle': [0.35, 0.55], 'weight': [0.3, 0.5],
         'hair': ['bleached', 'short01', 'shaved', 'short04'], 'glasses': [None, None, DARK_GLASSES], 'mask': 0.35,
         'clothes': [[{'asset': 'male_casualsuit06', 'ops': [{'op': 'colorize', 'color': '#e6e4de', 'contrast': 0.3, 'rect': [0, 0, 1, 0.42]}]}], [plain('elvs_crude_t-shirt_male', '#d8d4cc', 0.6), plain('toigo_harem_pants', '#141416')], [plain('elvs_crude_t-shirt_male', '#1a1a1c', 0.6), plain('toigo_harem_pants', '#2a2620')]],
         'shoes': [SNEAKERS, LOAFERS]},
    ],
}

# Faces. The first build gave every man the same soft young face: MakeHuman's own, with a few small pulls either way
# (the user: "They look the same and young. They don't give off the vibe of the type of people they are supposed to
# portray"). Now each man has a face type of his role's, pushed hard, then varied: a hard square face (Mack's first
# model's, enemy_trench.json), a broad brute with a broken nose and a low brow, a gaunt sharp one, a jowly old boss, a
# young tough's. All of them Japanese (race asian); the age macro adds its own.
# (The second pass's values, pushed far, made puffy faces with slit eyes: fat and narrowed eyes read as babies, not
# men. Now the bone is what changes: jaw, cheekbones, brow ridge, nose, hooded lids; the eyes keep their size.)
FACES = {
    'hard': {'head-square': 0.3, 'chin-prominent-incr': 0.35, 'chin-width-incr': 0.35, 'chin-bones-incr': 0.4, 'lr-cheek-bones-incr': 0.4, 'lr-cheek-volume-decr': 0.45,
             'eyebrows-trans-down': 0.45, 'eyebrows-angle-down': 0.4, 'lr-eye-eyefold-down': 0.3, 'lr-eye-height2-decr': 0.15, 'lr-eye-bag-incr': 0.3,
             'eyebrows-trans-forward': 0.25, 'nose-hump-incr': 0.25, 'nose-scale-vert-incr': 0.15, 'mouth-angles-down': 0.3, 'mouth-upperlip-volume-decr': 0.25},
    # (forehead-nubian, meant for a heavy brow, slopes the forehead back: at the brute's 0.8 it made a cone of the skull, tall
    # and long behind, which shaved or under short hair read as an oblong head (the user, twice), and even at 0.35-0.45
    # the others' heads were "still oblong a little". It's in no type now: the brow comes forward with the eyebrows' own
    # target instead.)
    'brute': {'head-square': 0.45, 'head-scale-horiz-incr': 0.15, 'chin-width-incr': 0.6, 'chin-bones-incr': 0.6, 'nose-scale-horiz-incr': 0.4, 'nose-flaring-incr': 0.4,
              'nose-compression-compress': 0.35, 'nose-volume-incr': 0.25, 'eyebrows-trans-down': 0.55, 'eyebrows-trans-forward': 0.4, 'lr-eye-eyefold-down': 0.35,
              'lr-eye-height2-decr': 0.15, 'mouth-angles-down': 0.35, 'mouth-lowerlip-volume-incr': 0.2, 'lr-cheek-bones-incr': 0.3, 'measure-neck-circ-incr': 0.5, 'neck-scale-horiz-incr': 0.4},
    'gaunt': {'head-scale-horiz-decr': 0.2, 'head-invertedtriangular': 0.25, 'lr-cheek-volume-decr': 0.8, 'lr-cheek-bones-incr': 0.55, 'chin-width-decr': 0.2, 'chin-prominent-incr': 0.3,
              'lr-eye-corner2-up': 0.2, 'eyebrows-angle-down': 0.5, 'eyebrows-trans-down': 0.3, 'lr-eye-eyefold-down': 0.25, 'mouth-upperlip-volume-decr': 0.35,
              'mouth-lowerlip-volume-decr': 0.3, 'nose-scale-vert-incr': 0.25, 'nose-hump-incr': 0.4, 'nose-point-width-decr': 0.2, 'forehead-temple-decr': 0.3},
    'oldboss': {'head-age-incr': 0.7, 'head-fat-incr': 0.25, 'lr-cheek-trans-down': 0.4, 'neck-double-incr': 0.5, 'lr-eye-bag-incr': 0.7, 'lr-eye-bag-height-incr': 0.35,
                'lr-eye-eyefold-down': 0.45, 'eyebrows-trans-down': 0.4, 'nose-scale-horiz-incr': 0.35, 'nose-point-down': 0.25, 'nose-volume-incr': 0.2,
                'mouth-angles-down': 0.45, 'eyebrows-trans-forward': 0.2, 'chin-width-incr': 0.3, 'lr-cheek-bones-incr': 0.2},
    # (The user, of one: "this guy still looks baby faced". Harder bones now, and older: `face` gives it head-age 0.3 at least.)
    'punk': {'head-square': 0.3, 'chin-prognathism-incr': 0.2, 'chin-prominent-incr': 0.35, 'chin-bones-incr': 0.3, 'eyebrows-angle-down': 0.55, 'eyebrows-trans-down': 0.45, 'lr-eye-corner2-up': 0.25,
             'lr-eye-eyefold-down': 0.3, 'lr-cheek-volume-decr': 0.55, 'lr-cheek-bones-incr': 0.45, 'mouth-angles-down': 0.25, 'nose-scale-horiz-incr': 0.15, 'nose-hump-incr': 0.2, 'eyebrows-trans-forward': 0.2},
}
FACES_OF = {'executive': ['oldboss', 'hard', 'oldboss'], 'soldier': ['hard', 'gaunt', 'brute'], 'flash': ['hard', 'gaunt'], 'guard': ['brute', 'brute', 'hard'],
            'aloha': ['punk', 'gaunt', 'hard'], 'striped': ['gaunt', 'punk', 'brute'], 'tee': ['punk', 'gaunt', 'brute']}
# The extra pulls on top, either way, so two of one type aren't twins.
FACE = ['nose-scale-horiz', 'nose-scale-vert', 'chin-width', 'chin-prominent', 'mouth-scale-horiz', 'lr-eye-scale', 'head-scale-horiz', 'lr-cheek-bones', 'forehead-scale-vert', 'nose-hump', 'chin-height', 'mouth-scale-vert']
# The skin: no smoothing (lived-in, not airbrushed); the creases shaded from the face's own shape (`cavity`), more with
# age; a tone (weathered, sallow, ruddy, dark); stubble on many, a moustache on a few older men, bags under the eyes,
# now and then a scar; heavy brows painted low and straight (MakeHuman's brow cards were a thin pen line).
# What their faces hold (a morph target each, built from MakeHuman's expression units, held by the page: humans/main.ts).
# A face at rest reads as calm whatever its bones; these men aren't. A scowl: brows down, a slight squint, the mouth's
# corners pulled down and the lips pressed. A sneer (some of the chinpira): one-sided, the nose lifted. And a blink.
EXPRESSIONS = {
    'scowl': {'eyebrows-left-down': 1.0, 'eyebrows-right-down': 1.0, 'eye-left-slit': 0.35, 'eye-right-slit': 0.35, 'mouth-depression': 0.45, 'mouth-compression': 0.35, 'nose-compression': 0.2},
    # (The sneer's first mix lifted the upper lip, which parted the lips: slack-jawed, not a sneer. The mouth stays shut.)
    'sneer': {'eyebrows-left-down': 0.85, 'eyebrows-right-down': 0.4, 'eyebrows-right-extern-up': 0.25, 'eye-left-slit': 0.4, 'eye-right-slit': 0.15, 'nose-left-elevation': 0.55, 'mouth-compression': 0.3, 'mouth-depression': 0.2},
}
TONES = [[0.96, 0.89, 0.81], [0.9, 0.84, 0.78], [0.95, 0.92, 0.87], [0.97, 0.89, 0.85], [0.86, 0.8, 0.74]]
BROW = {'height': 0.0115, 'arch': 0.0012, 'drop': 0.0035, 'peak': 0.45, 'thick': 0.0095, 'tail': 0.5, 'strands': 0.3, 'inner': 0.013, 'outer': 0.03, 'soft': 0.0016}
STUBBLE = "np.maximum(near3(P(L['lips'],0,0.0,-0.045),0.08,0.12,0.06), np.maximum(near3(P(L['lips'],0.07,0.0,-0.025),0.04,0.12,0.05), near3(P(L['lips'],-0.07,0.0,-0.025),0.04,0.12,0.05))) * (1-near3(L['lips'],0.032,0.06,0.011))"
MOUSTACHE = "near3(P(L['lips'],0,0.0,0.014),0.022,0.06,0.006) * (1-near3(L['lips'],0.03,0.06,0.009))"
BAGS = "np.maximum(near3(P(L['eye_l'],0,0.0,-0.016),0.014,0.03,0.007), near3(P(L['eye_r'],0,0.0,-0.016),0.014,0.03,0.007))"
SCARS = ["near3(P(L['eye_l'],0.012,0.0,-0.035),0.0028,0.03,0.022)", "near3(P(L['eye_r'],-0.012,0.0,-0.035),0.0028,0.03,0.022)",
         "near3(P(L['eye_l'],0.004,0.0,0.012),0.0025,0.03,0.014)", "near3(P(L['eye_r'],-0.004,0.0,0.012),0.0025,0.03,0.014)"]


def face(recipe, years, rnd, kind):
    """The face's targets and the skin's marks for one man of a role, of face type `kind`."""
    targets = {t: round(min(1.0, v * rnd.uniform(0.8, 1.2)), 2) for t, v in FACES[kind].items()}
    for t in rnd.sample(FACE, 4):
        name = t + ('-incr' if rnd.random() < 0.5 else '-decr') if not t.startswith('head-scale') else t + ('-incr' if rnd.random() < 0.5 else '-decr')
        if name not in targets and name.replace('-incr', '-decr').replace('-decr', '-incr') not in targets:
            targets[name] = round(rnd.uniform(0.1, 0.25), 2)
    # (A taller forehead is never one of the pulls: it lengthened the head. Dropped after the draw, so the draws, and
    # every other pull, come out as they did.)
    targets.pop('forehead-scale-vert-incr', None)
    # The years show in the face too.
    targets['head-age-incr'] = round(max(targets.get('head-age-incr', 0), min(0.8, max(0.0, (years - 26) / 40)), 0.3 if kind == 'punk' else 0), 2)
    older = years >= 35
    marks = {
        'kind': kind,
        'expression': 'sneer' if recipe['role'] in ('aloha', 'striped', 'tee', 'flash') and rnd.random() < 0.5 else 'scowl',
        'tone': rnd.choice(TONES),
        'crease': round(min(0.85, 0.45 + (years - 20) / 90), 2),
        'stubble': round(rnd.uniform(0.45, 0.8), 2) if rnd.random() < (0.3 if recipe['role'] == 'executive' else 0.6) else 0,
        'moustache': False,
        'bags': round(min(0.6, 0.15 + (years - 20) / 80 + (0.15 if kind in ('oldboss', 'brute') else 0)), 2),
        'scar': rnd.choice(SCARS) if rnd.random() < (0.35 if recipe['role'] in ('soldier', 'guard') else 0.18) else None,
        'brow': {**BROW, 'thick': round(rnd.uniform(0.0085, 0.011), 4), 'drop': round(rnd.uniform(0.002, 0.0045), 4), 'arch': round(rnd.uniform(0.0004, 0.002), 4), 'seed': rnd.randint(1, 99)},
    }
    return targets, marks


def roll(prefix, recipe, k, rnd, hair, kind):
    """One figure of a role, from its own random stream, with the hair and face type its turn gives it."""
    years = rnd.randint(*recipe['years'])
    color = GREY if years >= 60 else SALT if years >= 54 else GREYING if years >= 46 else rnd.choice(BLEACHED if hair == 'bleached' else DARK_HAIR)
    targets, marks = face(recipe, years, rnd, kind)
    fig = {
        'name': f'{prefix}_{k:02d}',
        'mob': 'man',
        'role': recipe['role'],
        'body': {'gender': 1, 'years': years, 'height_cm': rnd.randint(*recipe['height']), 'muscle': round(rnd.uniform(*recipe['muscle']), 2), 'weight': round(rnd.uniform(*recipe['weight']), 2), 'race': {'asian': 1}, 'targets': targets, 'decimate': 0.6},
        'hair_color': color,
        'face': marks,
        'clothes': [dict(c) for c in rnd.choice(recipe['clothes'])] + [dict(rnd.choice(recipe['shoes']))],
        'garments': [],
    }
    if hair in ('perm', 'slick'):
        g = dict(PERM if hair == 'perm' else SLICK, color=color, seed=rnd.randint(1, 999))
        fig['garments'].append(g)
    elif hair == 'shaved':
        fig['shaved'] = True
    else:
        fig['hair'] = 'cortu_short_messy_hair' if hair == 'bleached' else hair
    glasses = rnd.choice(recipe['glasses'])
    if glasses:
        fig['clothes'].append(dict(glasses))
    if rnd.random() < recipe.get('mask', 0):
        fig['clothes'].append(dict(BLACK_MASK))
    if recipe.get('chain') and rnd.random() < 0.7:
        fig['garments'].append(dict(CHAIN))
    return fig


# Corrections to single figures, laid over what was rolled (each one found by looking).
OVERRIDES = {
    # (His oblong head was the brute's forehead-nubian, now out of the type; debug-shots/headlab.py showed it.) The low cut.
    'cp_06': {'hair': 'short01'},
}


def generate():
    figures = []
    for prefix, recipes in RECIPES.items():
        k = 1
        for recipe in recipes:
            # A role's men take turns at its hair and its face types (rolled, two bodyguards came out alike: both shaved).
            turn = random.Random(f"{prefix}-{recipe['role']}")
            hairs = turn.sample(recipe['hair'], len(recipe['hair']))
            kinds = turn.sample(FACES_OF[recipe['role']], len(FACES_OF[recipe['role']]))
            for i in range(recipe['n']):
                fig = roll(prefix, recipe, k, random.Random(f'{prefix}-{k}'), hairs[i % len(hairs)], kinds[i % len(kinds)])
                over = OVERRIDES.get(fig['name'], {})
                fig['body']['targets'].update(over.get('targets', {}))
                if 'hair' in over:
                    fig.pop('shaved', None)
                    fig['hair'] = over['hair']
                figures.append(fig)
                k += 1
    with open(LIST, 'w', encoding='utf-8') as f:
        json.dump({'about': 'Rolled by scripts/blender/enemy_figures.py --generate from its RECIPES; built by the same script into assets/humans/.', 'figures': figures}, f, indent=1)
    print('wrote %d figures to %s' % (len(figures), os.path.relpath(LIST, REPO)))


def definition(fig):
    """The build_character.py definition for a figure of the list: the skin weathered and marked as its face says."""
    years = fig['body']['years']
    m = fig['face']
    color = fig['hair_color']
    # (The brows stay darker than grey hair: brows grey last.)
    brow_color = color if years < 54 else '#2e2b28'
    # (Old skin comes out orange under the game's lights: less colour in it.)
    skin_ops = [{'op': 'grade', 'saturation': 0.7 if years >= 50 else 0.85, 'gain': m['tone']}]
    masks = {'brows': {'brow': m['brow']}, 'bags': {'expr': BAGS, 'blur': 2}}
    if fig.get('hair'):
        # The scalp darkened under the hair, but only the scalp: above the brows or behind the ears, not below the jaw
        # (short04's sideburns lie on the cheek, and the whole side of the face came out black; human_bijin.py's mask, begun
        # well above the brow: lower, it showed through short04's receding notches at the temples as a dark smudge, grey
        # on the grey-haired. The notches now show the forehead's own skin, as a receding hairline does).
        masks['scalp'] = {'expr': "under_hair() * np.maximum(lin(z, L['brow'][2] + 0.045, L['brow'][2] + 0.06), lin(y, L['eye_l'][1] + 0.075, L['eye_l'][1] + 0.095)) * lin(z, L['chin'][2] - 0.05, L['chin'][2] - 0.03)", 'blur': 2}
        skin_ops.append({'op': 'colorize', 'color': color, 'contrast': 0.5, 'uvmask': 'scalp', 'amount': 0.9})
    elif fig.get('shaved'):
        # Shaved close: the stubble a shadow over the scalp.
        skin_ops.append({'op': 'colorize', 'color': '#3a3430', 'contrast': 0.5, 'uvmask': 'under_hair', 'amount': 0.35})
    skin_ops.append({'op': 'grade', 'gain': [0.55, 0.5, 0.48], 'uvmask': 'cavity', 'amount': m['crease']})
    skin_ops.append({'op': 'grade', 'gain': [0.7, 0.62, 0.62], 'uvmask': 'bags', 'amount': m['bags']})
    if m['stubble']:
        masks['stubble'] = {'expr': STUBBLE, 'blur': 2, 'levels': [0.15, 0.7]}
        skin_ops.append({'op': 'grade', 'gain': [0.38, 0.37, 0.38], 'uvmask': 'stubble', 'amount': m['stubble']})
    if m['moustache']:
        masks['moustache'] = {'expr': MOUSTACHE, 'blur': 1, 'levels': [0.2, 0.6]}
        skin_ops.append({'op': 'fill', 'color': brow_color, 'uvmask': 'moustache', 'amount': 0.85})
    if m['scar']:
        masks['scar'] = {'expr': m['scar'], 'blur': 1, 'levels': [0.3, 0.8]}
        skin_ops.append({'op': 'grade', 'gain': [1.14, 0.98, 0.95], 'saturation': 0.7, 'uvmask': 'scar', 'amount': 0.8})
    skin_ops.append({'op': 'fill', 'color': brow_color, 'uvmask': 'brows', 'amount': 0.88})
    d = {
        'name': fig['name'],
        'about': 'An enemy (%s, a %s face), rolled by scripts/blender/enemy_figures.py.' % (fig['role'], m['kind']),
        'out': OUT + '/' + fig['name'] + '.glb',
        'body': fig['body'],
        'max_tex': 512,
        'skin': {'asset': ('old_' if years >= 62 else 'middleage_' if years >= 40 else 'young_') + 'asian_male', 'max_tex': 1024, 'roughness': 0.6, 'ops': skin_ops, 'masks': masks},
        'eyes': {'asset': 'high-poly', 'color': 'brown', 'max_tex': 256, 'roughness': 0.35, 'ops': [{'op': 'grade', 'sat': [0.15, 1], 'saturation': 0.55, 'gain': [0.55, 0.5, 0.48]}]},
        # (No brow asset: they're painted, see the masks.)
        'eyelashes': {'asset': 'eyelashes01', 'max_tex': 256, 'double_sided': True},
        'clothes': [dict({'roughness': 0.85, 'metallic': 0, 'max_tris': MAX_TRIS['clothes']}, **c) for c in fig['clothes']],
        'garments': fig['garments'],
        'expressions': {'blink': {'eye-left-closure': 1, 'eye-right-closure': 1}, m['expression']: EXPRESSIONS[m['expression']]},
    }
    if fig.get('hair'):
        d['hair'] = {'asset': fig['hair'], 'roughness': 0.6, 'double_sided': True, 'normal_map': False, 'max_tris': MAX_TRIS['hair'], 'ops': [{'op': 'colorize', 'color': color, 'contrast': 0.8}]}
        if fig['hair'] == 'short04':
            # Its long sideburns reached down beside the eyes, a hard black strip (the user: "some black on his face"):
            # the hair below the top of the ear and in front of it is cut away.
            d['hair']['delete_where'] = "z < L['brow'][2] + 0.012 and y < L['eye_l'][1] + 0.075"
    return d


def build(fig):
    name = fig['name']
    path = os.path.join(DEFS, name + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(definition(fig), f, indent=2)
    out = subprocess.run([BLENDER, '-b', '--python', os.path.join('scripts', 'blender', 'build_character.py'), '--', path], capture_output=True, text=True, cwd=REPO)
    text = out.stdout + out.stderr
    done = [line for line in text.splitlines() if line.startswith('CHARACTER_GLB')]
    if not done or 'Traceback' in text or out.returncode != 0:
        tail = [line for line in text.splitlines() if line.strip()][-8:]
        return name, None, '\n   '.join(tail)
    report = next((json.loads(line[len('CHARACTER_REPORT '):]) for line in text.splitlines() if line.startswith('CHARACTER_REPORT ')), {})
    return name, '%s  %d triangles, %.1f cm (%s)' % (done[0][len('CHARACTER_GLB '):], report.get('triangles', 0), report.get('height_cm', 0), fig['role']), None


def main():
    argv = sys.argv[1:]
    if '--generate' in argv:
        generate()
        return
    jobs = int(argv[argv.index('--jobs') + 1]) if '--jobs' in argv else 3
    only = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--jobs')]
    with open(LIST, encoding='utf-8') as f:
        figures = json.load(f)['figures']
    todo = [f for f in figures if not only or any(o in f['name'] for o in only)]
    os.makedirs(DEFS, exist_ok=True)
    os.makedirs(os.path.join(REPO, OUT), exist_ok=True)
    print('building %d figures, %d at a time' % (len(todo), jobs), flush=True)
    failed = []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for name, done, err in pool.map(build, todo):
            if err:
                failed.append(name)
                print('FAILED', name, '\n   ' + err, flush=True)
            else:
                print(done, flush=True)
    if failed:
        print('FAILED:', ' '.join(failed))
        sys.exit(1)


if __name__ == '__main__':
    main()
