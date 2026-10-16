"""A GenIA mesh given the colours of GenIA's own fitted Gaussians.

  python scripts/genia/recolor_mesh.py <final dir> [--obj 1] [--k 12] [--sigma 0.006] [--out <file.glb>]

Why: GenIA fits the picture with SAM 3D Objects' GAUSSIAN decoder only (its LoRA and token fine-tuning render splats:
core/main.py, `slat_decoder_gs`). `final/meshes/NNN.glb` is decoded from the same tokens by the MESH decoder, which no
step fitted, and its vertex colours are that decoder's own guess: good enough on a ceramic turtle, wrong on a face
(eyes and mouth smeared or out of place). The fitted colours are in `final/gaussians/NNN.ply` (run with
`output.save_compressed_ply=false`, so the PLY is plain), in the same object-local frame as the mesh. This takes each
mesh vertex's colour from the Gaussians round it: the k nearest, weighted by their opacity and a Gaussian of the
distance (sigma, in the object's units: about a unit tall, a cell of its 64-grid is 0.016).

Writes <final dir>/meshes/NNN_recolor.glb (or --out): the same triangles, still z up as GenIA writes them.
"""
import argparse
import os

import numpy as np
import trimesh
from scipy.spatial import cKDTree

ap = argparse.ArgumentParser()
ap.add_argument('final')
ap.add_argument('--obj', type=int, default=1)
ap.add_argument('--k', type=int, default=12)
ap.add_argument('--sigma', type=float, default=0.006)
ap.add_argument('--out')
a = ap.parse_args()


def read_ply(path):
    """A binary little-endian PLY of float properties (what GenIA writes for Gaussians) as {name: array}."""
    with open(path, 'rb') as f:
        names, n = [], 0
        while True:
            line = f.readline().decode('ascii').strip()
            if line.startswith('element vertex'):
                n = int(line.split()[-1])
            elif line.startswith('property'):
                kind, name = line.split()[1:3]
                if kind not in ('float', 'float32'):
                    raise SystemExit(f'{path}: property {name} is {kind}, not float (a compressed PLY? run with output.save_compressed_ply=false)')
                names.append(name)
            elif line == 'end_header':
                break
        data = np.frombuffer(f.read(n * 4 * len(names)), dtype='<f4').reshape(n, len(names))
    return {name: data[:, i] for i, name in enumerate(names)}


g = read_ply(os.path.join(a.final, 'gaussians', f'{a.obj:03d}.ply'))
pos = np.stack([g['x'], g['y'], g['z']], axis=1)
rgb = np.clip(0.5 + 0.28209479177387814 * np.stack([g['f_dc_0'], g['f_dc_1'], g['f_dc_2']], axis=1), 0, 1)
alpha = 1 / (1 + np.exp(-g['opacity']))
mesh = trimesh.load(os.path.join(a.final, 'meshes', f'{a.obj:03d}.glb'), force='mesh', process=False)
v = np.asarray(mesh.vertices)
print('gaussians', len(pos), 'bounds', pos.min(0).round(3), pos.max(0).round(3))
print('mesh     ', len(v), 'bounds', v.min(0).round(3), v.max(0).round(3))

d, i = cKDTree(pos).query(v, k=a.k, workers=-1)
w = alpha[i] * np.exp(-0.5 * (d / a.sigma) ** 2) + 1e-9
col = (rgb[i] * w[..., None]).sum(1) / w.sum(1, keepdims=True)
# A vertex with no Gaussian near it (inside a closed part, a hole in the splats) keeps the mesh decoder's colour.
far = d[:, 0] > 4 * a.sigma
old = np.asarray(mesh.visual.vertex_colors)[:, :3] / 255.0
col[far] = old[far]
print('vertices recoloured', int((~far).sum()), 'kept', int(far.sum()))
out = a.out or os.path.join(a.final, 'meshes', f'{a.obj:03d}_recolor.glb')
trimesh.Trimesh(vertices=v, faces=mesh.faces, vertex_colors=(np.clip(col, 0, 1) * 255).astype(np.uint8), process=False).export(out)
print('wrote', out)
