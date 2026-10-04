"""Builds the MakeHuman mob figures listed in scripts/blender/mob_figures.json (run with plain Python, not Blender):

  python scripts/blender/mob_figures.py [name or part of a name ...] [--tris 3200] [--previews]

For each figure: mpfb_base.py builds the body with its hair and clothes (a GLB in debug-shots/mobmodel/tmp, small
textures: only their alpha is used), then mob_from_model.py converts it to assets/mob/<name>.json. About 15 s a
figure. A figure that fails is reported and skipped; one that comes out with far more triangles than asked is listed
to look at (a garment in shards). scripts/blender/mob_figures_generate.py writes the generated crowd into the list.
BLENDER in the environment names another blender.exe.
"""
import json
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BLENDER = os.environ.get('BLENDER', r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe')
TMP = os.path.join(REPO, 'debug-shots', 'mobmodel', 'tmp')
SHOTS = os.path.join(REPO, 'debug-shots', 'mobmodel')


def run(args, want):
    """Runs Blender on a script; returns the output's lines that start with any of `want`."""
    out = subprocess.run([BLENDER, '-b', '--python'] + args, capture_output=True, text=True, cwd=REPO)
    text = out.stdout + out.stderr
    if 'Traceback' in text or 'No ' in text and ' asset ' in text or out.returncode != 0:
        tail = [line for line in text.splitlines() if line.strip()][-12:]
        raise RuntimeError('\n'.join(tail))
    return [line for line in text.splitlines() if line.startswith(want)]


def main():
    argv = sys.argv[1:]
    tris = argv[argv.index('--tris') + 1] if '--tris' in argv else '3200'
    previews = '--previews' in argv
    only = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--tris')]
    with open(os.path.join(REPO, 'scripts', 'blender', 'mob_figures.json'), encoding='utf-8') as f:
        figures = json.load(f)['figures']
    os.makedirs(TMP, exist_ok=True)
    failed, odd = [], []
    for fig in figures:
        name = fig['name']
        if only and not any(o in name for o in only):
            continue
        glb = os.path.join(TMP, name + '.glb')
        args = [os.path.join('scripts', 'blender', 'mpfb_base.py'), '--']
        for k, v in fig['body'].items():
            args += ['--' + k, str(v)]
        for k, v in fig.get('targets', {}).items():
            args += ['--target', '%s=%s' % (k, v)]
        args += ['--hair', fig.get('hair', 'none'), '--max-tex', '256', '--out', glb]
        if fig.get('clothes'):
            args += ['--clothes'] + fig['clothes']
        height = fig['body'].get('height-cm', 165) / 100
        conv = [os.path.join('scripts', 'blender', 'mob_from_model.py'), '--', glb, os.path.join('assets', 'mob', name + '.json'), '--tris', tris, '--height', str(height), '--body', fig['mob']]
        if previews:
            conv += ['--preview', os.path.join(SHOTS, name + '.png')]
        try:
            run(args, ('MPFB_REPORT',))
            for line in run(conv, ('WROTE',)):
                print(line, flush=True)
                # (A garment that comes through the cut in shards leaves far more triangles than asked.)
                got = int(line.split()[2])
                if got > int(tris) * 1.12:
                    odd.append('%s (%d triangles: %s)' % (name, got, ' '.join(fig.get('clothes', []))))
        except RuntimeError as e:
            failed.append(name)
            print('FAILED', name, ' '.join(fig.get('clothes', [])), fig.get('hair'), '\n   ' + str(e).splitlines()[-1], flush=True)
    if failed:
        print('FAILED:', ' '.join(failed))
    if odd:
        print('LOOK AT:', '; '.join(odd))


if __name__ == '__main__':
    main()
