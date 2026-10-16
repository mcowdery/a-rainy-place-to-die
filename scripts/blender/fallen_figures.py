"""Builds the fallen things of the dead hours that start from a MakeHuman body (run with plain Python, not Blender):

  python scripts/blender/fallen_figures.py [name or part of a name ...] [--jobs 3]

The dead hours (story/mythos.md: 02:00 to 06:00, when the city stays in) have their monsters; these are the ones a
MakeHuman body can carry, for review on the MakeHuman test page (humans.html, its "dead hours" stage) before
anything of them goes into the city:

- **Shades**: too tall and too thin, the limbs, the neck and the fingers drawn out, the head small; drawn in the
  game as a shadow with no face (humans/fallen.ts gives them their material), so what's built is the shape alone.
  Three: bare, the hat man (a long coat and a hat), a woman with long hair over her face.
- **A giant**: what the bones at the Kasumi-chō site point at; built as tall as MakeHuman goes, a heavy brow and
  jaw, big hands, ashen, and scaled up again in the game (fallen.ts) to some 3.5 m.

The possessed aren't built here: they're the crowd's own figures (assets/humans/), made over in the game.

Each definition goes to debug-shots/humans/defs/<name>.json and is built by build_character.py, as the crowd is
(human_figures.py); the GLB is assets/humans/<name>.glb. No previews, so no GPU. On the pod:
  node scripts/pod.mjs run --out assets/humans -- env BLENDER=/workspace/blender/blender python3 scripts/blender/fallen_figures.py
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BLENDER = os.environ.get('BLENDER', r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe')
DEFS = os.path.join(REPO, 'debug-shots', 'humans', 'defs')
OUT = 'assets/humans'
MAX_TRIS = 7000

# The shades' shape: everything long and thin, the head small. MakeHuman targets by file name ("lr-" both sides).
STRETCH = {
    'measure-upperarm-length-incr': 1,
    'measure-lowerarm-length-incr': 1,
    'measure-upperleg-height-incr': 0.7,
    'measure-lowerleg-height-incr': 0.7,
    'measure-neck-height-incr': 1,
    'neck-scale-vert-incr': 0.6,
    'measure-neck-circ-decr': 0.9,
    'head-scale-vert-decr': 0.15,
    'head-scale-horiz-decr': 0.35,
    'head-scale-depth-decr': 0.2,
    'lr-hand-scale-incr': 0.7,
    'lr-hand-fingers-length-incr': 1,
    'lr-hand-fingers-diameter-decr': 0.8,
    'measure-shoulder-dist-decr': 0.3,
    'measure-waist-circ-decr': 1,
    'torso-scale-horiz-decr': 0.4,
    'torso-scale-depth-decr': 0.3,
    'measure-upperarm-circ-decr': 1,
    'measure-thigh-circ-decr': 1,
    'measure-calf-circ-decr': 1,
    'lr-upperarm-fat-decr': 1,
    'lr-lowerarm-fat-decr': 1,
    'lr-upperleg-fat-decr': 1,
    'lr-lowerleg-fat-decr': 1,
}
# (The material is replaced in the game: the skin only needs to be there.)
PLAIN_SKIN = {'max_tex': 256, 'roughness': 0.8}


def cloth(asset, color, roughness=0.85):
    return {'asset': asset, 'roughness': roughness, 'metallic': 0, 'max_tris': MAX_TRIS, 'ops': [{'op': 'colorize', 'color': color, 'contrast': 0.6}]}


FIGURES = [
    {
        'name': 'shade_bare',
        'about': 'A shade: a man drawn out to 2.2 m, thin as a rail, nothing on.',
        'body': {'gender': 1, 'years': 35, 'height_cm': 222, 'muscle': 0.15, 'weight': 0, 'proportions': 0.2, 'race': {'asian': 1}, 'targets': STRETCH, 'decimate': 0.6},
        'max_tex': 256,
        'skin': {'asset': 'middleage_asian_male', **PLAIN_SKIN},
    },
    {
        'name': 'shade_hatman',
        'about': 'A shade: the hat man, 2.1 m, a long coat to the shins and a hat.',
        'body': {'gender': 1, 'years': 45, 'height_cm': 212, 'muscle': 0.2, 'weight': 0, 'proportions': 0.3, 'race': {'asian': 1}, 'targets': STRETCH, 'decimate': 0.6},
        'max_tex': 256,
        'skin': {'asset': 'middleage_asian_male', **PLAIN_SKIN},
        'clothes': [cloth('male_elegantsuit01', '#1a1a1c'), cloth('shoes04', '#101012', 0.4), cloth('fedora01', '#141416', 0.7)],
        # The long coat, as the detective's trench (dom_detective.json) but black.
        'garments': [{'type': 'jacket', 'over': ['male_elegantsuit01'], 'color': '#141416', 'roughness': 0.9, 'specular': 0.1, 'grain': 0.2, 'grain_tile': 0.02, 'smooth': 24, 'hem': -0.03, 'open_top': 0.06, 'open_bottom': 0.0, 'collar': 0.075, 'zip': 0.002, 'zip_color': '#202022', 'min_off': 0.02, 'gap': 0.012, 'decimate': 0.6, 'thickness': 0.008, 'skirt_hem': -0.8, 'skirt_flare': 0.5, 'belt': True, 'skirt_out': 0.025, 'open_len': 0.27, 'belt_gap': 0.0, 'skirt_gap': 0.1, 'skirt_fold': 0.012, 'belt_color': '#18181a', 'smooth_shade': True}],
    },
    {
        'name': 'shade_woman',
        'about': 'A shade: a woman drawn out to 2 m, long black hair hanging over her face, a plain dress, barefoot.',
        'body': {'gender': 0, 'years': 28, 'height_cm': 202, 'muscle': 0.15, 'weight': 0, 'proportions': 0.3, 'cupsize': 0.2, 'race': {'asian': 1}, 'targets': STRETCH, 'decimate': 0.6},
        'max_tex': 256,
        'skin': {'asset': 'young_asian_female', **PLAIN_SKIN},
        'hair': {'asset': 'long01', 'roughness': 0.6, 'double_sided': True, 'normal_map': False, 'max_tris': 6000, 'ops': [{'op': 'colorize', 'color': '#0c0b0a', 'contrast': 0.8}]},
        'clothes': [cloth('toigo_shift_dress', '#2a2a2c')],
    },
    {
        'name': 'giant_bare',
        'about': 'A giant: as tall as MakeHuman goes (scaled up again in the game), heavy-browed and big-jawed, huge hands, ashen; bare to the waist in old work trousers.',
        'body': {
            'gender': 1, 'years': 50, 'height_cm': 225, 'muscle': 0.9, 'weight': 0.75, 'proportions': 0.15, 'race': {'asian': 1}, 'decimate': 0.6,
            'targets': {
                'head-age-incr': 0.6, 'head-square': 0.7, 'head-scale-vert-incr': 0.15,
                'forehead-nubian-incr': 1, 'forehead-temple-incr': 0.6, 'eyebrows-trans-down': 0.8, 'eyebrows-angle-down': 0.6,
                'chin-bones-incr': 1, 'chin-width-incr': 1, 'chin-prominent-incr': 0.7, 'nose-scale-horiz-incr': 0.5,
                'lr-eye-scale-decr': 0.5, 'lr-cheek-bones-incr': 0.6,
                'measure-neck-circ-incr': 1, 'measure-shoulder-dist-incr': 1, 'torso-vshape-incr': 0.3,
                'lr-hand-scale-incr': 1, 'lr-hand-fingers-diameter-incr': 0.8,
                'measure-upperarm-length-incr': 0.4, 'measure-lowerarm-length-incr': 0.4,
            },
        },
        'max_tex': 512,
        'skin': {'asset': 'old_asian_male', 'max_tex': 1024, 'roughness': 0.7, 'ops': [{'op': 'grade', 'saturation': 0.3, 'gamma': 1.05}, {'op': 'smooth', 'radius': 2, 'amount': 0.3}]},
        'eyes': {'asset': 'high-poly', 'color': 'grey', 'max_tex': 256, 'roughness': 0.35},
        'clothes': [cloth('toigo_wool_pants', '#3a342c', 0.95)],
    },
]


def build(fig):
    name = fig['name']
    d = dict(fig, out=OUT + '/' + name + '.glb')
    path = os.path.join(DEFS, name + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, indent=2)
    out = subprocess.run([BLENDER, '-b', '--python', os.path.join('scripts', 'blender', 'build_character.py'), '--', path], capture_output=True, text=True, cwd=REPO)
    text = out.stdout + out.stderr
    done = [line for line in text.splitlines() if line.startswith('CHARACTER_GLB')]
    if not done or 'Traceback' in text or out.returncode != 0:
        tail = [line for line in text.splitlines() if line.strip()][-8:]
        return name, None, '\n   '.join(tail)
    report = next((json.loads(line[len('CHARACTER_REPORT '):]) for line in text.splitlines() if line.startswith('CHARACTER_REPORT ')), {})
    return name, '%s  %d triangles, %.1f cm' % (done[0][len('CHARACTER_GLB '):], report.get('triangles', 0), report.get('height_cm', 0)), None


def main():
    argv = sys.argv[1:]
    jobs = int(argv[argv.index('--jobs') + 1]) if '--jobs' in argv else 3
    only = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--jobs')]
    todo = [f for f in FIGURES if not only or any(o in f['name'] for o in only)]
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
