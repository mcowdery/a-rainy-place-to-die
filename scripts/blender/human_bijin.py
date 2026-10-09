"""Builds the hand-made women of the MakeHuman test page (run with plain Python, not Blender):

  python scripts/blender/human_bijin.py [name or part of a name ...] [--jobs 3] [--heads]

Five women made to be as good-looking as MakeHuman allows, to judge whether its figures will do as side
characters (humans.md). Where the generated crowd (human_figures.py) takes a body, a hair asset and clothes as
they come, each of these has a face shaped by targets and the sculpt, eyebrows and makeup painted into the skin,
a darker, larger iris, upper lashes only, and clothes recoloured to go together. FACE is what they share; WOMEN
gives each her own face, hair, makeup and clothes on top. For each a definition is written to
debug-shots/humans/defs/<name>.json and built by build_character.py into assets/humans/<name>.glb, with a
preview sheet in assets/humans/previews/.

--heads builds nothing: it renders each head from the front, three-quarters and the side into
debug-shots/bijin/<name>_head.jpg, for working on a face. BLENDER in the environment names another blender.exe.
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BLENDER = os.environ.get('BLENDER', r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe')
DEFS = os.path.join(REPO, 'debug-shots', 'humans', 'defs')
HEADS = os.path.join(REPO, 'debug-shots', 'bijin')
OUT = 'assets/humans'

# The face they share: a soft oval, a small nose, eyes a little larger and closer than the Asian macro's, a small
# mouth set back with its corners up. A woman's own targets go over these (0 takes one out).
FACE = {
    'head-oval': 0.6, 'head-invertedtriangular': 0.15, 'head-fat-decr': 0.3, 'head-scale-horiz-decr': 0.35,
    'forehead-scale-vert-decr': 0.3,
    'chin-width-decr': 0.5, 'chin-triangle': 0.3, 'chin-height-decr': 0.3, 'chin-bones-decr': 0.4,
    'lr-cheek-bones-decr': 0.2, 'lr-cheek-volume-incr': 0.1,
    'nose-scale-horiz-decr': 0.5, 'nose-scale-vert-decr': 0.45, 'nose-point-width-decr': 0.4, 'nose-nostrils-width-decr': 0.5,
    'nose-volume-decr': 0.25, 'nose-point-up': 0.2, 'nose-width3-decr': 0.3,
    'lr-eye-scale-incr': 1.0, 'lr-eye-corner2-up': 0.2, 'lr-eye-trans-in': 0.2, 'lr-eye-height2-decr': 0.55, 'lr-eye-bag-decr': 0.5,
    'mouth-scale-horiz-decr': 0.25, 'mouth-scale-vert-decr': 0.45, 'mouth-scale-depth-decr': 0.6, 'mouth-trans-backward': 0.35,
    'mouth-upperlip-volume-decr': 0.35, 'mouth-lowerlip-volume-decr': 0.15, 'mouth-upperlip-height-decr': 0.3,
    'mouth-cupidsbow-incr': 0.4, 'mouth-angles-up': 0.35,
    'measure-neck-circ-decr': 0.4,
    'lr-ear-wing-decr': 0.6, 'lr-ear-scale-decr': 0.2,
}
SCULPT = {'lower_face': 0.08, 'jaw_narrow': 0.08, 'eyes': [1.12, 1.0, 1.0], 'lips': [0.9, 0.85, 0.85]}
BROW = {'height': 0.0145, 'arch': 0.0022, 'drop': 0.0025, 'peak': 0.6, 'thick': 0.0048, 'tail': 0.3, 'strands': 0.15, 'inner': 0.017, 'outer': 0.028, 'soft': 0.002}
# Makeup, each 0..1 (how strongly it's laid on) but the colours.
MAKEUP = {'lips': 0.7, 'lip_gain': [0.98, 0.7, 0.72], 'blush': 0.35, 'shadow': 0.35, 'shadow_gain': [0.74, 0.67, 0.64], 'liner': 0.6, 'brow': 0.86, 'brow_color': '#1d1512'}
IRIS = [[0.708, 0.293], [0.293, 0.713]]
# The face's morph targets, each a mix of MakeHuman's expression units (build_character.py, capture_expressions):
# the eyes, a smile, the jaw, the five vowels a mouth makes talking, the brows. Character (models/characters.ts)
# blinks, smiles and talks with them.
EXPRESSIONS = {
    'blink': {'eye-left-closure': 1, 'eye-right-closure': 1},
    'squint': {'eye-left-slit': 1, 'eye-right-slit': 1},
    'wide': {'eye-left-opened-up': 1, 'eye-right-opened-up': 1},
    'smile': {'mouth-corner-puller': 0.7, 'mouth-elevation': 0.3, 'eye-left-slit': 0.35, 'eye-right-slit': 0.35},
    'open': {'mouth-open': 0.6},
    'a': {'mouth-open': 0.38, 'mouth-parling': 0.3},
    'i': {'mouth-retraction': 0.6, 'mouth-parling': 0.6},
    'u': {'mouth-pursing': 0.55, 'mouth-protusion': 0.3, 'mouth-open': 0.1},
    'e': {'mouth-open': 0.2, 'mouth-retraction': 0.4, 'mouth-parling': 0.4},
    'o': {'mouth-open': 0.28, 'mouth-pursing': 0.5},
    'brow_up': {'eyebrows-left-up': 1, 'eyebrows-right-up': 1},
    'brow_sad': {'eyebrows-left-inner-up': 1, 'eyebrows-right-inner-up': 1},
    'brow_down': {'eyebrows-left-down': 1, 'eyebrows-right-down': 1},
}

CLOTH = {'roughness': 0.85, 'metallic': 0}

# What's cut from a hair asset worn only for its fringe: everything behind the front of the head, out past the
# temples, or below the eyes, the cut rising towards the sides (a bob's sides cut off level hang there like flaps).
FRINGE = "y > L['eye_l'][1] + 0.045 or abs(x) > 0.066 or z < L['eye_l'][2] + 0.002 + max(0.0, abs(x) - 0.042) * 2.2"

BLACK = [{'op': 'colorize', 'color': '#141416', 'contrast': 0.5}]
HEELS = {'asset': 'toigo_stiletto_booties', 'roughness': 0.45, 'max_tris': 3000, 'ops': BLACK}
BELT = "(v > 0.42) * (u < 0.66) * lin(z, np.max(z[(v > 0.42) & (u < 0.66)]) - 0.045, np.max(z[(v > 0.42) & (u < 0.66)]) - 0.04) * lin(z, np.max(z[(v > 0.42) & (u < 0.66)]) - 0.006, np.max(z[(v > 0.42) & (u < 0.66)]) - 0.01)"

WOMEN = [
    {
        'name': 'bijin_office', 'about': 'An office lady, 26: a curled-under bob, a pinstriped skirt suit, black heels.',
        'body': {'years': 26, 'height_cm': 160, 'weight': 0.4, 'cupsize': 0.5},
        'hair': 'toigo_curled_under_bob', 'hair_color': '#17120f',
        'clothes': [{'asset': 'toigo_female_suit'}, HEELS],
    },
    {
        'name': 'bijin_club', 'about': 'A club hostess, 28: long straight hair parted in the middle, a wine-red halter dress, black heels; the heaviest makeup.',
        'body': {'years': 28, 'height_cm': 164, 'weight': 0.38, 'cupsize': 0.6},
        'targets': {'lr-eye-height2-decr': 0.6, 'lr-eye-corner2-up': 0.4, 'mouth-upperlip-volume-decr': 0.15, 'mouth-lowerlip-volume-decr': 0},
        'brow': {'arch': 0.004, 'thick': 0.0042, 'height': 0.014},
        'makeup': {'lips': 0.9, 'lip_gain': [0.72, 0.24, 0.28], 'shadow': 0.65, 'liner': 0.85, 'blush': 0.3},
        'hair': 'long01', 'hair_color': '#120f0e', 'hair_part': {'inflate': 0.006},
        'clothes': [{'asset': 'toigo_halter_dress_midi', 'ops': [{'op': 'grade', 'gain': [0.62, 0.5, 0.55], 'gamma': 1.1}]}, HEELS],
    },
    {
        'name': 'bijin_casual', 'about': 'A girl of 21 out in town: a blunt bob with a fringe, a cream sweater, a navy skirt, white socks and black strap shoes; hardly any makeup.',
        'body': {'years': 21, 'height_cm': 157, 'weight': 0.42, 'cupsize': 0.48, 'decimate': 0.48},
        'targets': {'lr-eye-height2-decr': 0.35, 'lr-cheek-volume-incr': 0.25, 'head-round': 0.2, 'chin-height-decr': 0.45},
        'makeup': {'lips': 0.5, 'shadow': 0.2, 'liner': 0.45, 'blush': 0.5},
        'hair': 'toigo_blunt_bob_with_bangs', 'hair_color': '#1b140f', 'hair_part': {'max_tris': 4000},
        'clothes': [
            {'asset': 'toigo_fisherman_sweater', 'inflate': 0.006, 'ops': [{'op': 'colorize', 'color': '#e4dccb', 'contrast': 0.45}]},
            # (Let out, so her legs don't come through it as she moves; its waistband, under the sweater, cut away.)
            {'asset': 'toigo_skirt_with_lace_ruffle', 'inflate': 0.012, 'delete_where': 'z > top_of(0.0, 1.0) - 0.03', 'ops': [{'op': 'colorize', 'color': '#1f2738', 'contrast': 0.7}]},
            {'asset': 'toigo_lace_frill_socks'},
            {'asset': 'toigo_mj_cloth_shoes', 'roughness': 0.5, 'inflate': 0.005, 'max_tris': 3000, 'ops': [{'op': 'colorize', 'color': '#141416'}]},
        ],
    },
    {
        'name': 'bijin_elegant', 'about': 'A woman of 33, composed: her hair up in a bun with a short fringe, a black shift dress, black stockings and heels.',
        'body': {'years': 33, 'height_cm': 166, 'weight': 0.38, 'cupsize': 0.52, 'decimate': 0.55},
        'targets': {'head-oval': 0.75, 'lr-cheek-bones-decr': 0.5, 'lr-cheek-volume-incr': 0, 'nose-scale-vert-decr': 0.3, 'lr-eye-corner2-up': 0.35, 'forehead-scale-vert-decr': 0.6, 'head-scale-horiz-decr': 0.55},
        'brow': {'arch': 0.0035, 'thick': 0.0044},
        'makeup': {'lips': 0.8, 'lip_gain': [0.82, 0.42, 0.47], 'shadow': 0.5},
        'hair': 'rehmanpolanski_hair_bun_brown', 'hair_color': '#14100e', 'hair_part': {'max_tris': 4000}, 'fringe': 'toigo_blunt_bob_with_bangs',
        'clothes': [
            {'asset': 'toigo_shift_dress', 'max_tris': 4200, 'ops': [{'op': 'colorize', 'color': '#17171b', 'contrast': 0.6}]},
            {'asset': 'marco_105_stocking01', 'roughness': 0.8, 'max_tris': 2200, 'ops': [{'op': 'opaque'}, {'op': 'colorize', 'color': '#18181b', 'contrast': 0.4}]},
            HEELS,
        ],
    },
    {
        'name': 'bijin_ponytail', 'about': 'A woman of 23 off duty: a ponytail and a full fringe, a white tee tucked into jeans, trainers.',
        'body': {'years': 23, 'height_cm': 162, 'weight': 0.4, 'cupsize': 0.5, 'muscle': 0.45},
        'targets': {'lr-eye-height2-decr': 0.45, 'chin-height-decr': 0.4, 'mouth-angles-up': 0.5, 'forehead-scale-vert-decr': 0.6, 'head-scale-horiz-decr': 0.55, 'lr-cheek-bones-decr': 0.5},
        'makeup': {'lips': 0.55, 'shadow': 0.3, 'liner': 0.5},
        'hair': 'ponytail01', 'hair_color': '#15110f', 'fringe': 'toigo_curled_under_bob_with_bangs',
        'clothes': [
            # (Julie's tee and jeans: the tee, which comes with MakeHuman's logo on it, recoloured white and tucked in, a
            # belt painted on the waistband.)
            {'asset': 'female_casualsuit01', 'decimate': 0.8,
             'ops': [{'op': 'opaque'},
                     {'op': 'colorize', 'color': '#e8e6e2', 'contrast': 0.03, 'rect': [0, 0, 1, 0.42]},
                     {'op': 'colorize', 'color': '#e8e6e2', 'contrast': 0.03, 'poly': [[0.725, 0.66], [0.78, 0.57], [1, 0.57], [1, 0.9], [0.725, 0.9]]},
                     {'op': 'colorize', 'color': '#6b3f22', 'contrast': 0.4, 'uvmask': 'belt'}],
             'masks': {'belt': {'expr': BELT, 'blur': 1}},
             'delete_where': 'v < 0.42 and z < top_of(0.42, 1.0, 0.0, 0.66) - 0.012'},
            {'asset': 'shoes05', 'roughness': 0.6, 'delete_where': 'z > 0.085'},
        ],
    },
]


def definition(w):
    name = w['name']
    mk = {**MAKEUP, **w.get('makeup', {})}
    targets = {k: v for k, v in {**FACE, **w.get('targets', {})}.items() if v}
    sc = {**SCULPT, **w.get('sculpt', {})}
    eye = "np.minimum(np.linalg.norm(np.stack([x, y, z], 1) - L['eye_l'], axis=1), np.linalg.norm(np.stack([x, y, z], 1) - L['eye_r'], axis=1))"
    masks = {
        'brows': {'brow': {**BROW, **w.get('brow', {})}},
        # (The lips group is wider than the lips look painted: drawn in by a blur and a threshold.)
        'lips': {'expr': "group('lips')", 'size': 2048, 'blur': 8, 'levels': [0.62, 0.9]},
        'blush': {'expr': "(near(onface(P(L['eye_l'], 0.008, 0, -0.03)), 0.024) + near(onface(P(L['eye_r'], -0.008, 0, -0.03)), 0.024)) * (ny < 0)", 'size': 2048, 'blur': 8},
        'shadow': {'expr': "(near3(L['eye_l'], 0.017, 0.03, 0.010) + near3(L['eye_r'], 0.017, 0.03, 0.010)) * lin(z, L['eye_l'][2] - 0.002, L['eye_l'][2] + 0.004) * (ny < 0.2)", 'size': 2048, 'blur': 4},
        'liner': {'expr': "lin(dist(boundary() & (%s < 0.025) & (z > L['eye_l'][2] + 0.002)), 0.003, 0.0008)" % eye, 'size': 2048, 'blur': 1},
        # The scalp: the skin under the hair, but only above the brows or behind the ears, and not below the jaw (long
        # hair lies on the cheeks and the shoulders too, and they'd be smudged with it).
        'scalp': {'expr': "under_hair() * np.maximum(lin(z, L['brow'][2] + 0.004, L['brow'][2] + 0.018), lin(y, L['eye_l'][1] + 0.075, L['eye_l'][1] + 0.095)) * lin(z, L['chin'][2] - 0.05, L['chin'][2] - 0.03)", 'size': 2048, 'blur': 4},
    }
    color = w['hair_color']
    skin_ops = [
        {'op': 'grade', 'saturation': 0.8, 'gamma': 1.06, 'gain': [1.0, 0.97, 0.93]},
        {'op': 'smooth', 'radius': 3, 'amount': 0.6},
        {'op': 'colorize', 'color': color, 'contrast': 0.5, 'uvmask': 'scalp', 'amount': 0.92},
        {'op': 'grade', 'gain': [1.0, 0.86, 0.86], 'uvmask': 'blush', 'amount': mk['blush']},
        {'op': 'grade', 'gain': mk['shadow_gain'], 'uvmask': 'shadow', 'amount': mk['shadow']},
        {'op': 'grade', 'gain': mk['lip_gain'], 'saturation': 1.1, 'uvmask': 'lips', 'amount': mk['lips']},
        {'op': 'fill', 'color': '#1a1210', 'uvmask': 'liner', 'amount': mk['liner']},
        {'op': 'fill', 'color': mk['brow_color'], 'uvmask': 'brows', 'amount': mk['brow']},
        # (The inside of the mouth has a bright red patch of the texture to itself: darkened, for when she opens it.)
        {'op': 'grade', 'gain': [0.34, 0.2, 0.2], 'rect': [0.73, 0.83, 0.95, 1.0]},
    ]
    # The iris recoloured a warm dark brown (MakeHuman's brown is a deep red, which darkened goes black: beads, in the
    # game's light), its own rays and the pupil kept, then drawn a little larger.
    iris = [{'op': 'colorize', 'color': '#4a2d1b', 'contrast': 0.8, 'circle': c + [0.122]} for c in IRIS]
    iris += [{'op': 'bulge', 'center': c, 'radius': 0.24, 'scale': 1.2} for c in IRIS]
    body = {'gender': 0, 'muscle': 0.38, 'proportions': 0.75, 'firmness': 0.65, 'race': {'asian': 1}, 'decimate': 0.6, **w['body'], 'targets': targets,
            'sculpt': {'lower_face': sc['lower_face'], 'jaw_narrow': sc['jaw_narrow'],
                       'local': [{'at': 'eyes', 'radius': 0.027, 'scale': sc['eyes']}, {'at': 'lips', 'radius': 0.035, 'scale': sc['lips']}]}}
    hair = {'roughness': 0.55, 'specular': 0.3, 'double_sided': True, 'normal_map': False, 'max_tris': 7000, 'ops': [{'op': 'colorize', 'color': color, 'contrast': 0.9}]}
    clothes = [{**CLOTH, 'max_tris': 7000, **c} for c in w['clothes']]
    if w.get('fringe'):
        # A fringe over hair that's drawn back, which leaves the hairline and the whole forehead bare: another hair
        # asset's, worn as well, with all of it but what hangs in front of the forehead cut away.
        clothes.append({**hair, 'asset': w['fringe'], 'kind': 'hair', 'max_tris': 1800, 'delete_where': FRINGE, **w.get('fringe_part', {})})
    return {
        'name': name,
        'about': w['about'] + ' Generated by scripts/blender/human_bijin.py.',
        'out': '%s/%s.glb' % (OUT, name),
        'preview': '%s/previews/%s.png' % (OUT, name),
        'body': body,
        'max_tex': 1024,
        'skin': {'asset': 'young_asian_female', 'max_tex': 2048, 'roughness': 0.5, 'masks': masks, 'ops': skin_ops},
        'eyes': {'asset': 'high-poly', 'color': 'brown', 'roughness': 0.35, 'specular': 0.3, 'ops': iris},
        # (No brow asset: they're painted, see brow_mask. The lower lashes are spikes once cut at half alpha.)
        'eyelashes': {'asset': 'eyelashes02', 'double_sided': True, 'delete_where': "z < L['eye_l'][2] - 0.002"},
        'hair': {**hair, 'asset': w['hair'], **w.get('hair_part', {})},
        # (Only the front teeth, which is all an open mouth shows: the whole set is 7,000 triangles.)
        'teeth': {'asset': 'teeth_base', 'delete_where': 'abs(x) > 0.021', 'max_tris': 2200, 'roughness': 0.35, 'ops': [{'op': 'grade', 'gain': [0.9, 0.88, 0.84]}]},
        'expressions': EXPRESSIONS,
        'mouth_bag': False,
        'clothes': clothes,
        'garments': w.get('garments', []),
    }


def build(job):
    w, heads = job
    name = w['name']
    path = os.path.join(DEFS, name + '.json')
    d = definition(w)
    args = []
    faces = os.path.join(HEADS, name + '_expressions.png')
    if heads:
        # The head alone, close: front, three-quarters, side (100 mm, so it isn't a nose in a fisheye).
        d['preview'] = os.path.join(HEADS, name + '_small.png')
        z = d['body']['height_cm'] / 100 - 0.105
        shots = [os.path.join(HEADS, '%s_%s.png' % (name, k)) for k in 'fqs']
        for cam, shot in zip(('0,-0.85', '0.45,-0.72', '0.85,0'), shots):
            args += ['--view', '%s,%.3f,0,0,%.3f,100' % (cam, z, z), shot]
        args = ['--preview-only', '--head-only', '--expr-sheet', faces] + args
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, indent=2)
    out = subprocess.run([BLENDER, '-b', '--python', os.path.join('scripts', 'blender', 'build_character.py'), '--', path] + args, capture_output=True, text=True, cwd=REPO)
    text = out.stdout + out.stderr
    report = next((json.loads(line[len('CHARACTER_REPORT '):]) for line in text.splitlines() if line.startswith('CHARACTER_REPORT ')), None)
    if report is None or 'Traceback' in text or out.returncode != 0:
        tail = [line for line in text.splitlines() if line.strip()][-8:]
        return name, None, '\n   '.join(tail)
    if heads:
        from PIL import Image
        ims = [Image.open(s).convert('RGB').crop((100, 100, 800, 800)) for s in shots]
        sheet = Image.new('RGB', (2100, 700))
        for i, im in enumerate(ims):
            sheet.paste(im, (i * 700, 0))
        sheet.save(os.path.join(HEADS, name + '_head.jpg'), quality=92)
        for s in shots + [d['preview']]:
            os.remove(s)
        return name, name + '_head.jpg', None
    done = [line for line in text.splitlines() if line.startswith('CHARACTER_GLB')]
    return name, '%s  %d triangles  %s' % (done[0][len('CHARACTER_GLB '):], report['triangles'], json.dumps(report['meshes'])), None


def main():
    argv = sys.argv[1:]
    jobs = int(argv[argv.index('--jobs') + 1]) if '--jobs' in argv else 3
    heads = '--heads' in argv
    only = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--jobs')]
    todo = [w for w in WOMEN if not only or any(o in w['name'] for o in only)]
    for folder in (DEFS, HEADS, os.path.join(REPO, OUT, 'previews')):
        os.makedirs(folder, exist_ok=True)
    failed = []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for name, done, err in pool.map(build, [(w, heads) for w in todo]):
            if err:
                failed.append(name)
                print('FAILED', name, '\n   ' + err, flush=True)
            else:
                print(done, flush=True)
    if failed:
        print('FAILED:', ' '.join(failed))


if __name__ == '__main__':
    main()
