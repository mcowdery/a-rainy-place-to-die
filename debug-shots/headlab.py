"""A head lab for the enemies (scripts/blender/enemy_figures.py): one figure's head, bald, with variations of its
targets, rendered by build_character.py's head close-ups (front, three-quarters, side) for comparing skull shapes.
Run with plain Python (on the pod: BLENDER=/workspace/blender/blender python3 debug-shots/headlab.py cp_06):

  python debug-shots/headlab.py <figure> [--jobs 4]
  python debug-shots/headlab.py --as-built <figure> [<figure> ...]   each as built, hair and all, no variants

Writes debug-shots/humans/lab/<figure>_<variant>.png (and the definitions beside them).
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'blender'))
import enemy_figures as ef  # noqa: E402

LAB = os.path.join(REPO, 'debug-shots', 'humans', 'lab')

# Each variant: targets to drop (by name) and targets to set, over the figure's own.
VARIANTS = {
    'a_as_built': ({}, []),
    'b_no_nubian': ({}, ['forehead-nubian-incr']),
    'c_upright_forehead': ({'forehead-nubian-decr': 0.4}, ['forehead-nubian-incr']),
    'd_no_nubian_short_back': ({'head-back-scale-depth-decr': 0.5}, ['forehead-nubian-incr']),
    'e_no_nubian_no_neck': ({}, ['forehead-nubian-incr', 'measure-neck-circ-incr', 'neck-scale-horiz-incr']),
    'f_nubian_half_round': ({'forehead-nubian-incr': 0.45, 'head-round': 0.8, 'head-scale-vert-decr': 0.5}, []),
}


def job(args):
    name, d = args
    path = os.path.join(LAB, name + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, indent=1)
    # The whole skull from the side and the front (the head close-ups crop its top), at a long lens.
    z = 1.58 * d['body'].get('height_cm', 172) / 172
    views = ['--view', '0.95,0,%.3f,0,0,%.3f,90' % (z, z), os.path.join(LAB, name + '_side.png'), '--view', '0,-0.95,%.3f,0,0,%.3f,90' % (z, z), os.path.join(LAB, name + '_front.png')]
    out = subprocess.run([ef.BLENDER, '-b', '--python', os.path.join('scripts', 'blender', 'build_character.py'), '--', path, '--preview-only', '--head-only'] + views, capture_output=True, text=True, cwd=REPO)
    ok = os.path.exists(os.path.join(LAB, name + '_side.png'))
    return name, ok, '' if ok else '\n'.join((out.stdout + out.stderr).splitlines()[-8:])


def main():
    argv = sys.argv[1:]
    jobs = int(argv[argv.index('--jobs') + 1]) if '--jobs' in argv else 4
    names = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--jobs')]
    figures = {f['name']: f for f in json.load(open(ef.LIST, encoding='utf-8'))['figures']}
    os.makedirs(LAB, exist_ok=True)
    todo = []
    if '--as-built' in argv:
        for who in names:
            d = ef.definition(figures[who])
            d['name'] = who + '_built'
            d['preview'] = 'debug-shots/humans/lab/' + who + '_built.png'
            d['out'] = 'debug-shots/humans/lab/' + who + '_built.glb'
            d['clothes'] = [c for c in d['clothes'] if 'glasses' not in c['asset'] and 'mouth' not in c['asset']]
            todo.append((who + '_built', d))
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            for name, ok, err in pool.map(job, todo):
                print(name, 'ok' if ok else 'FAILED ' + err, flush=True)
        return
    who = names[0]
    fig = figures[who]
    for v, (put, drop) in VARIANTS.items():
        f = json.loads(json.dumps(fig))
        f.pop('hair', None)
        f['shaved'] = True
        f['garments'] = []
        t = f['body']['targets']
        for k in drop:
            t.pop(k, None)
        t.update(put)
        d = ef.definition(f)
        name = f'{who}_{v}'
        d['name'] = name
        d['preview'] = 'debug-shots/humans/lab/' + name + '.png'
        d['out'] = 'debug-shots/humans/lab/' + name + '.glb'
        d['clothes'] = [c for c in d['clothes'] if 'glasses' not in c['asset'] and 'mouth' not in c['asset']]
        todo.append((name, d))
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for name, ok, err in pool.map(job, todo):
            print(name, 'ok' if ok else 'FAILED\n' + err, flush=True)


if __name__ == '__main__':
    main()
