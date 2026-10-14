"""Where a DiffPortrait360 orbit's cameras stand relative to a GenIA head: the similarity (scale, shift, turn about the
vertical) that puts GenIA's Gaussians where the orbit's frames show the head. Runs in the `genia` environment on a GPU.

  python scripts/genia/align_orbit.py <final dir> <orbit dir> [--out align.json] [--frames 0,4,8,...] [--debug <dir>]

<orbit dir> is what scripts/genia/dp360 leaves: `frames/000.png`..., `cameras.json` (the EG3D/PanoHead camera of each
frame: cam2world, OpenCV axes, the head at the origin facing +z, y up, normalised focal 4.2647 for a 512 picture).
GenIA's object frame is z up with the front along -y, so the rotation that stands the head up in the orbit's world
is fixed (x -> x, z -> y, -y -> z); what is searched is a scale, a shift and a turn about the vertical.

How: each candidate renders GenIA's Gaussians (gsplat) through the orbit's own cameras and is scored against the
frames: the outline (1 - IoU with the frame's cut-out, BiRefNet) and the colour inside both. A coarse random search,
then Nelder-Mead. The score is printed per frame so a bad alignment is visible: the front frame is the picture the
head was reconstructed from, so it must match well; the profile and the back test the scale and the turn.
"""
import argparse
import json
import math
import os

import numpy as np
import torch
from gsplat import rasterization
from PIL import Image
from scipy.optimize import minimize
from scipy.spatial.transform import Rotation as Rot

ap = argparse.ArgumentParser()
ap.add_argument('final')
ap.add_argument('orbit')
ap.add_argument('--obj', type=int, default=1)
ap.add_argument('--frames', default='0,3,6,8,10,13,16,19,22,24,26,29')
ap.add_argument('--out')
ap.add_argument('--debug')
a = ap.parse_args()
dev = 'cuda'


def read_ply(path):
    with open(path, 'rb') as f:
        names, n = [], 0
        while True:
            line = f.readline().decode('ascii').strip()
            if line.startswith('element vertex'):
                n = int(line.split()[-1])
            elif line.startswith('property'):
                names.append(line.split()[2])
            elif line == 'end_header':
                break
        data = np.frombuffer(f.read(n * 4 * len(names)), dtype='<f4').reshape(n, len(names))
    return {k: data[:, i].copy() for i, k in enumerate(names)}


g = read_ply(os.path.join(a.final, 'gaussians', f'{a.obj:03d}.ply'))
means0 = np.stack([g['x'], g['y'], g['z']], 1).astype(np.float64)
quats0 = np.stack([g[f'rot_{i}'] for i in range(4)], 1).astype(np.float64)
quats0 /= np.linalg.norm(quats0, axis=1, keepdims=True)
scales0 = np.stack([g[f'scale_{i}'] for i in range(3)], 1).astype(np.float64)
opac0 = g['opacity'].astype(np.float64)
if scales0.min() < 0:
    scales0 = np.exp(scales0)
if opac0.min() < 0 or opac0.max() > 1:
    opac0 = 1 / (1 + np.exp(-opac0))
cols0 = np.clip(0.5 + 0.28209479177387814 * np.stack([g['f_dc_0'], g['f_dc_1'], g['f_dc_2']], 1), 0, 1)

cams = json.load(open(os.path.join(a.orbit, 'cameras.json')))
SIZE = int(cams['image_size'][0])
FX = float(cams['intrinsics_normalised'][0][0]) * SIZE
K = torch.tensor([[FX, 0, SIZE / 2], [0, FX, SIZE / 2], [0, 0, 1.0]], dtype=torch.float32, device=dev)[None]
idx = [int(i) for i in a.frames.split(',')]


def cutout(path):
    """The head's cut-out of an orbit frame: BiRefNet, on the GPU."""
    global BIREF
    if 'BIREF' not in globals():
        from torchvision import transforms
        from transformers import AutoModelForImageSegmentation
        BIREF = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True).to(dev).eval().half()
    from torchvision import transforms
    tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
    im = Image.open(path).convert('RGB')
    with torch.no_grad():
        p = BIREF(tf(im).unsqueeze(0).to(dev).half())[-1].sigmoid().float().cpu()[0, 0]
    m = np.asarray(Image.fromarray((p.numpy() * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)) > 127
    return np.asarray(im, dtype=np.float32) / 255.0, m


frames = {}
for i in idx:
    img, m = cutout(os.path.join(a.orbit, 'frames', f'{i:03d}.png'))
    frames[i] = (torch.tensor(img, device=dev), torch.tensor(m, device=dev))
cam2world = {i: np.array(cams['frames'][i]['cam2world'], dtype=np.float64) for i in idx}
w2c = {i: torch.tensor(np.linalg.inv(cam2world[i]), dtype=torch.float32, device=dev)[None] for i in idx}

# GenIA's object frame (z up, front -y) stood up in the orbit's world (y up, front +z).
STAND = np.array([[1.0, 0, 0], [0, 0, 1.0], [0, -1.0, 0]])
# A fifth of the Gaussians for the search (every one that shows is still drawn; a splat's scale is raised to cover the gaps).
# (Without the large splats too: a few cover the picture, and the tile lists they make fill the card.)
small = scales0.max(1) < np.percentile(scales0.max(1), 97)
sel = np.arange(len(means0))[small][::5]
means_t = torch.tensor(means0[sel], dtype=torch.float32, device=dev)
quats_t = torch.tensor(quats0[sel], dtype=torch.float32, device=dev)
scales_t = torch.tensor(scales0[sel] * 5 ** (1 / 3), dtype=torch.float32, device=dev)
opac_t = torch.tensor(opac0[sel], dtype=torch.float32, device=dev)
cols_t = torch.tensor(cols0[sel], dtype=torch.float32, device=dev)


def qmul(a, b):
    """Hamilton product of quaternions (w, x, y, z), a single `a` against many `b`."""
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b.unbind(-1)
    return torch.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                        w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], -1)


def transform(p):
    """(scale, tx, ty, tz, yaw degrees) -> the rotated, scaled, shifted means, quats and scales (on the GPU)."""
    s, tx, ty, tz, yaw = [float(v) for v in p]
    R = Rot.from_euler('y', yaw, degrees=True).as_matrix() @ STAND
    x, y, z, w = Rot.from_matrix(R).as_quat()
    Rt = torch.tensor(R, dtype=torch.float32, device=dev)
    m = (means_t @ Rt.T) * s + torch.tensor([tx, ty, tz], dtype=torch.float32, device=dev)
    q = torch.nn.functional.normalize(qmul((w, x, y, z), quats_t), dim=-1)
    return m, q, scales_t * s


def render(p, i):
    m, q, sc = transform(p)
    try:
        with torch.no_grad():
            rgb, al, _ = rasterization(m, q, sc, opac_t, cols_t, w2c[i], K, SIZE, SIZE, render_mode='RGB', rasterize_mode='antialiased', near_plane=0.5)
    except torch.OutOfMemoryError:
        # (A candidate that puts the head almost on the camera blows every splat up over the picture: no fit.)
        torch.cuda.empty_cache()
        z = torch.zeros(SIZE, SIZE, device=dev)
        return torch.zeros(SIZE, SIZE, 3, device=dev), z
    al = al[0, ..., 0]
    return rgb[0] / al.clamp(min=0.05)[..., None], al


def loss(p, detail=False):
    tot, per = 0.0, {}
    for i in idx:
        rgb, al = render(p, i)
        img, m = frames[i]
        r = al > 0.5
        inter = (r & m).sum().float()
        iou = inter / (r | m).sum().clamp(min=1).float()
        col = (rgb[r & m] - img[r & m]).abs().mean() if inter > 100 else torch.tensor(0.5, device=dev)
        per[i] = (float(iou), float(col))
        tot += (1 - float(iou)) + 0.4 * float(col)
    return (tot / len(idx), per) if detail else tot / len(idx)


# The head's size in the orbit: frame 0's cut-out against the mesh's own bounding box gives a start.
img0, m0 = frames[idx[0]]
ys, xs = np.where(m0.cpu().numpy())
head_h = (ys.max() - ys.min()) * 2.7 / FX  # world height of the cut-out at the head's distance
mesh_h = means0[:, 2].max() - means0[:, 2].min()
s0 = head_h / mesh_h
cy = (ys.max() + ys.min()) / 2 - SIZE / 2
print(f'frame {idx[0]}: the head is {head_h:.3f} of the orbit\'s units tall; the mesh {mesh_h:.3f}: start at scale {s0:.3f}')
mid = (means0.min(0) + means0.max(0)) / 2
rng = np.random.default_rng(1)
best = None
for n in range(160):
    s = s0 * math.exp(rng.uniform(-0.45, 0.45))
    yaw = [0, 180, 0, 90, -90][n % 5] + rng.uniform(-25, 25)
    ty = rng.uniform(-0.25, 0.25) * head_h
    tz = rng.uniform(-0.1, 0.1)
    tx = rng.uniform(-0.1, 0.1)
    # keep the mesh's centre near the origin
    c = (STAND @ (mid)) * s
    p = np.array([s, tx - c[0], ty - c[1], tz - c[2], yaw])
    L = loss(p)
    if best is None or L < best[0]:
        best = (L, p)
print('coarse best', round(best[0], 4), best[1].round(3))
res = minimize(loss, best[1], method='Nelder-Mead', options={'xatol': 1e-4, 'fatol': 1e-5, 'maxiter': 220, 'initial_simplex': np.vstack([best[1]] + [best[1] + np.eye(5)[k] * d for k, d in enumerate([0.03 * s0, 0.01, 0.01, 0.01, 3.0])])})
L, per = loss(res.x, detail=True)
print('refined', round(L, 4), res.x.round(4).tolist())
for i in idx:
    print(f'  frame {i:2d}: outline IoU {per[i][0]:.3f}, colour error {per[i][1]:.3f}')
out = {'scale': res.x[0], 'translation': res.x[1:4].tolist(), 'yaw_degrees': res.x[4], 'stand': STAND.tolist(),
       'loss': L, 'per_frame': {str(i): per[i] for i in idx},
       'meaning': "orbit-world point = scale * (Ry(yaw) @ STAND @ mesh point) + translation; the orbit's cam2world is in cameras.json"}
json.dump(out, open(a.out or os.path.join(a.final, 'orbit_align.json'), 'w'), indent=1)
if a.debug:
    os.makedirs(a.debug, exist_ok=True)
    tiles = []
    for i in idx:
        rgb, al = render(res.x, i)
        img, m = frames[i]
        over = (img * 0.5 + rgb * al[..., None] * 0.5).clamp(0, 1)
        tiles.append(np.concatenate([(img.cpu().numpy() * 255).astype(np.uint8), (over.cpu().numpy() * 255).astype(np.uint8)], 0))
    Image.fromarray(np.concatenate(tiles, 1)).save(os.path.join(a.debug, 'align_check.png'))
print('wrote', a.out or os.path.join(a.final, 'orbit_align.json'))
