"""A GenIA mesh given the FITTED colour: the picture laid on through the camera GenIA fitted, and GenIA's Gaussians
drawn from all round for what the picture doesn't show. Runs in the `genia` environment on a GPU (gsplat, open3d).

  python scripts/genia/bake_colour.py <final dir> [--scene-dir <demo/data/image/name>] [--obj 1] [--views 64]
        [--size 1024] [--photo-weight 6] [--no-photo] [--photo <relit picture>] [--mirror] [--out <file.glb>] [--debug <dir>]

Why: GenIA's fitting trains the Gaussian decoder only, so `final/meshes/NNN.glb` (the mesh decoder's own guess at
colour, never fitted) is blotched on a face while the Gaussians are recognisably the man (generated-art.md). Taking
each vertex's colour from the Gaussians nearest it (recolor_mesh.py) came out washed and speckled: a splat's colour
is only right once the splats in front of it are blended. So here the Gaussians are DRAWN (gsplat, `--views` cameras
on rings round the object, `--size` pixels) and each drawing is laid on the mesh from its own camera; and the picture
itself, twice the detail of anything fitted to it at 518 pixels, is laid on from the camera GenIA found.

Frames (read in GenIA's core/utils/render_final_results.py): the mesh and `gaussians/NNN.ply` (run with
`output.save_compressed_ply=false`) are in the object's own frame, z up. `final/poses.json` places an object point p
in the camera's PyTorch3D frame as `p * scale @ R + translation` (R the matrix of the w, x, y, z quaternion, used on
row vectors); negating x and y gives the OpenCV camera frame (x right, y down, z ahead), in which the camera's `K`
(for a 518-pixel picture) projects. `c2w` is the identity for one picture.

A vertex takes each view's colour weighted by how squarely the view sees it (the cosine to its normal, to the 4th
power), only where nothing is in front of it (rays cast at the mesh), and the picture's with `--photo-weight` more.
The picture is laid on last, where it agrees with the Gaussians' colour.
Vertices no view sees take the colour of the seen surface nearest them. Writes <final>/meshes/NNN_baked.glb: the same triangles, z up.
"""
import argparse
import json
import math
import os

import numpy as np
import open3d as o3d
import torch
import trimesh
from gsplat import rasterization
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('final')
ap.add_argument('--scene-dir')
ap.add_argument('--obj', type=int, default=1)
ap.add_argument('--views', type=int, default=64)
ap.add_argument('--size', type=int, default=1024)
ap.add_argument('--photo-weight', type=float, default=6.0)
ap.add_argument('--no-photo', action='store_true')
ap.add_argument('--photo')  # another picture to lay on in place of the scene's own: the SAME framing, relit (flat light)
ap.add_argument('--power', type=float, default=4.0)
ap.add_argument('--mirror', action='store_true')
ap.add_argument('--mv', action='store_true', help='a multi-view scene (rgbs/, segmentations/; poses.json with a transform and a camera per view): lay every view on through its fitted camera')
ap.add_argument('--photo-crop', help='with --mv and --photo: a,tx,ty such that a pixel q of the photo lies at a*q+(tx,ty) in view 0\'s picture (at the size of rgbs/00000.png)')
ap.add_argument('--mv-weight', type=float, default=2.5)
ap.add_argument('--orbit')  # a DiffPortrait360 orbit folder (frames/, cameras.json), laid on through the cameras fitted by align_orbit.py
ap.add_argument('--orbit-align')  # that fit (default: <final>/orbit_align.json)
ap.add_argument('--orbit-weight', type=float, default=2.5)
ap.add_argument('--orbit-tol', type=float, default=0.05)
ap.add_argument('--vote', action='store_true', help="drop a source where its hair-or-skin reading disagrees with the others (tried 2026-10-13 on the multi-view head: it spreads the dark forehead patch, so off by default)")
ap.add_argument('--orbit-skip', default='', help='frame numbers to leave out, comma separated')
ap.add_argument('--mirror-x', type=float)
ap.add_argument('--mirror-skin', type=float, default=0.3)
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
                kind, name = line.split()[1:3]
                if kind not in ('float', 'float32'):
                    raise SystemExit(f'{path}: {name} is {kind} (a compressed PLY: run GenIA with output.save_compressed_ply=false)')
                names.append(name)
            elif line == 'end_header':
                break
        data = np.frombuffer(f.read(n * 4 * len(names)), dtype='<f4').reshape(n, len(names))
    return {name: data[:, i].copy() for i, name in enumerate(names)}


# --- the mesh and the Gaussians, in the object's own frame ---------------------------------------
mesh = trimesh.load(os.path.join(a.final, 'meshes', f'{a.obj:03d}.glb'), force='mesh', process=False)
V = np.asarray(mesh.vertices, dtype=np.float64)
F = np.asarray(mesh.faces)
N = np.asarray(trimesh.Trimesh(vertices=V, faces=F, process=False).vertex_normals, dtype=np.float64)
old = np.asarray(mesh.visual.vertex_colors)[:, :3] / 255.0
g = read_ply(os.path.join(a.final, 'gaussians', f'{a.obj:03d}.ply'))
means = torch.tensor(np.stack([g['x'], g['y'], g['z']], 1), device=dev)
quats = torch.nn.functional.normalize(torch.tensor(np.stack([g[f'rot_{i}'] for i in range(4)], 1), device=dev), dim=1)
scales = torch.tensor(np.stack([g[f'scale_{i}'] for i in range(3)], 1), device=dev)
opac = torch.tensor(g['opacity'], device=dev)
# (3DGS's own PLY keeps log scales and logit opacities; a file that keeps them activated has no negative scales.)
if float(scales.min()) < 0:
    scales = scales.exp()
if float(opac.min()) < 0 or float(opac.max()) > 1:
    opac = opac.sigmoid()
cols = torch.clamp(0.5 + 0.28209479177387814 * torch.tensor(np.stack([g['f_dc_0'], g['f_dc_1'], g['f_dc_2']], 1), device=dev), 0, 1)
print(f'mesh {len(V)} vertices; gaussians {len(means)}, scale median {float(scales.median()):.4f}, opacity mean {float(opac.mean()):.2f}')

scene = o3d.t.geometry.RaycastingScene()
scene.add_triangles(o3d.core.Tensor(V.astype(np.float32)), o3d.core.Tensor(F.astype(np.uint32)))
centre = (V.min(0) + V.max(0)) / 2
radius = float(np.linalg.norm(V.max(0) - V.min(0)) / 2)


def visible(cam_at, tol=0.006):
    """Which vertices the camera at `cam_at` sees: nothing of the mesh between it and them."""
    d = V - cam_at
    dist = np.linalg.norm(d, axis=1)
    rays = np.concatenate([np.broadcast_to(cam_at, V.shape), d / dist[:, None]], 1).astype(np.float32)
    hit = scene.cast_rays(o3d.core.Tensor(rays))['t_hit'].numpy()
    return hit > dist - tol * radius * 2, d / dist[:, None]


def sample(img, uv):
    """Bilinear samples of img (h, w, c) at pixel positions uv (n, 2); (colours, inside)."""
    h, w = img.shape[:2]
    x, y = uv[:, 0] - 0.5, uv[:, 1] - 0.5
    inside = (x >= 0) & (x <= w - 1) & (y >= 0) & (y <= h - 1)
    x0 = np.clip(np.floor(x), 0, w - 2).astype(int)
    y0 = np.clip(np.floor(y), 0, h - 2).astype(int)
    fx, fy = np.clip(x - x0, 0, 1)[:, None], np.clip(y - y0, 0, 1)[:, None]
    out = img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy
    return out, inside


acc = np.zeros((len(V), 3))
wsum = np.zeros(len(V))
DARK = 0.28  # luminance under which a pixel is hair (or a dark garment), not skin
NSEEN = None  # per vertex: how many sources see it squarely, and how many of those see it dark
NDARK = None
LUMW = np.array([0.299, 0.587, 0.114])


def vote_pass(sources):
    """sources: (img, alpha, w2c, K) each. Sets NSEEN / NDARK."""
    global NSEEN, NDARK
    NSEEN = np.zeros(len(V)); NDARK = np.zeros(len(V))
    for img, alpha, w2c, K in sources:
        cam_at = -np.linalg.solve(w2c[:3, :3], w2c[:3, 3])
        p = V @ w2c[:3, :3].T + w2c[:3, 3]
        uv = np.stack([K[0, 0] * p[:, 0] / p[:, 2] + K[0, 2], K[1, 1] * p[:, 1] / p[:, 2] + K[1, 2]], 1)
        vis, ray = visible(cam_at)
        facing = np.clip(-(N * ray).sum(1), 0, 1)
        c, inside = sample(img, uv)
        al, _ = sample(alpha[..., None], uv)
        seen = vis & inside & (p[:, 2] > 0) & (al[:, 0] > 0.6) & (facing > 0.35)
        NSEEN += seen
        NDARK += seen & (c @ LUMW < DARK)
    print(f'hair-or-skin vote: {int((NSEEN >= 2).sum())} vertices seen by two or more sources, {int(((NDARK > 0.5 * NSEEN) & (NSEEN >= 2)).sum())} of them voted hair')


def vote_weight(c):
    """1 where a sample's darkness agrees with the vote at its vertex (or there is no vote), else nearly 0."""
    if NSEEN is None or not a.vote:
        return np.ones(len(c))
    dark = c @ LUMW < DARK
    hairy = NDARK > 0.5 * NSEEN
    return np.where(NSEEN >= 2, np.where(dark == hairy, 1.0, 0.03), 1.0)


def lay(img, alpha, w2c, K, weight, name, tol=0.006):
    """One view laid on: img (h, w, 3) seen through w2c (object frame -> OpenCV camera) and K."""
    cam_at = -np.linalg.solve(w2c[:3, :3], w2c[:3, 3])  # (the picture's w2c carries the object's scale: not a pure turn)
    p = V @ w2c[:3, :3].T + w2c[:3, 3]
    uv = np.stack([K[0, 0] * p[:, 0] / p[:, 2] + K[0, 2], K[1, 1] * p[:, 1] / p[:, 2] + K[1, 2]], 1)
    vis, ray = visible(cam_at, tol)
    facing = np.clip(-(N * ray).sum(1), 0, 1)
    c, inside = sample(img, uv)
    al, _ = sample(alpha[..., None], uv)
    w = weight * vis * inside * (p[:, 2] > 0) * (al[:, 0] > 0.6) * facing ** a.power * vote_weight(c)
    acc[:] += c * w[:, None]
    wsum[:] += w
    if a.debug:
        os.makedirs(a.debug, exist_ok=True)
        Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(os.path.join(a.debug, name + '.png'))
    return int((w > 0).sum())


# --- GenIA's cameras ------------------------------------------------------------------------------------------------
from PIL import ImageFilter


def quat_matrix(q):
    w, x, y, z = np.asarray(q, dtype=np.float64) / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                     [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                     [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])


def sim3_to_camera(tr):
    """The 4x4 that takes an object-frame point into the OpenCV camera frame GenIA's `transform` describes:
    p_cam = flip @ (M.T @ (s p) + t), flip negating x and y (PyTorch3D to OpenCV)."""
    M = quat_matrix(tr['rotation'])
    s_ = np.asarray(tr['scale'], dtype=np.float64)
    flip = np.diag([-1.0, -1.0, 1.0])
    A = np.eye(4)
    A[:3, :3] = flip @ M.T @ np.diag(s_)
    A[:3, 3] = flip @ np.asarray(tr['translation'], dtype=np.float64)
    return A


def outline_iou(A, K, mask):
    """How well the mesh through (A, K) lies on a cut-out: the vertices' pixels, dilated, against the mask."""
    p = V @ A[:3, :3].T + A[:3, 3]
    uv = np.stack([K[0, 0] * p[:, 0] / p[:, 2] + K[0, 2], K[1, 1] * p[:, 1] / p[:, 2] + K[1, 2]], 1)
    hw = np.zeros(mask.shape, dtype=bool)
    ok = (p[:, 2] > 0) & (uv[:, 0] >= 0) & (uv[:, 0] < mask.shape[1]) & (uv[:, 1] >= 0) & (uv[:, 1] < mask.shape[0])
    hw[uv[ok, 1].astype(int), uv[ok, 0].astype(int)] = True
    hw = np.asarray(Image.fromarray(hw).filter(ImageFilter.MaxFilter(5))) > 0
    return float((hw & mask).sum() / max(1, (hw | mask).sum()))


MV = None
if a.mv:
    poses = json.load(open(os.path.join(a.final, 'poses.json')))
    trs = {t['view']: t for t in next(o for o in poses['objects'] if o['obj_idx'] == a.obj)['transforms']}
    cams = {c['view']: c for c in poses['cameras']}
    views = sorted(trs)
    scene_dir = a.scene_dir
    imgs, masks = {}, {}
    for v in views:
        im = Image.open(os.path.join(scene_dir, 'rgbs', f'{v:05d}.png')).convert('RGB')
        imgs[v] = np.asarray(im, dtype=np.float64) / 255.0
        masks[v] = np.asarray(Image.open(os.path.join(scene_dir, 'segmentations', f'{v:05d}.png'))) > 0
    size = imgs[views[0]].shape[1]
    # Which chain places the mesh on the views: the per-view transform alone (as a single picture's does), or that
    # and the view's own c2w on top (the shared-world chain). Decided by the outline, printed so it can be seen.
    def chain(v, use_c2w):
        A = sim3_to_camera(trs[v])
        return (np.linalg.inv(np.array(cams[v]['c2w'], dtype=np.float64)) @ A) if use_c2w else A
    def Kof(v):
        K = np.array(cams[v]['K'], dtype=np.float64)
        K[:2] *= size / 518.0
        return K
    scores = {}
    for use_c2w in (False, True):
        scores[use_c2w] = [outline_iou(chain(v, use_c2w), Kof(v), masks[v]) for v in views]
        print(f"mv chain {'sim3 + c2w' if use_c2w else 'sim3 alone'}: outline IoU per view", np.round(scores[use_c2w], 3).tolist())
    USE_C2W = np.mean(scores[True]) > np.mean(scores[False])
    print('using', 'sim3 + c2w' if USE_C2W else 'sim3 alone')
    MV = dict(views=views, imgs=imgs, masks=masks, size=size, chain=lambda v: chain(v, USE_C2W), K=Kof)

# --- the picture, through the camera GenIA fitted ------------------------------------------------
PHOTO = None
if not a.no_photo and MV is not None:
    if not (a.photo and a.photo_crop):
        raise SystemExit('--mv wants --photo <the full-resolution picture of view 0> and --photo-crop a,tx,ty')
    ca, ctx, cty = [float(x) for x in a.photo_crop.split(',')]
    photo = Image.open(a.photo).convert('RGB')
    img = np.asarray(photo, dtype=np.float64) / 255.0
    w2c = MV['chain'](0)
    K0 = MV['K'](0)
    # A photo pixel q lies at ca*q + (ctx, cty) in view 0's picture: the camera that projects straight to the photo.
    K = np.array([[K0[0, 0] / ca, 0, (K0[0, 2] - ctx) / ca], [0, K0[1, 1] / ca, (K0[1, 2] - cty) / ca], [0, 0, 1.0]])
    # The photo's cut-out: view 0's mask, read through the crop.
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]]
    mx, my = (ca * xx + ctx).astype(int), (ca * yy + cty).astype(int)
    inside = (mx >= 0) & (mx < MV['size']) & (my >= 0) & (my < MV['size'])
    al = np.zeros(img.shape[:2])
    al[inside] = MV['masks'][0][my[inside], mx[inside]]
    al = np.asarray(Image.fromarray((al * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(13)), dtype=np.float64) / 255.0
    print(f"the photo through view 0's camera and the crop: outline IoU {outline_iou(w2c, K, al > 0.5):.3f}")
    PHOTO = (img, al, w2c, K)
elif not a.no_photo:
    poses = json.load(open(os.path.join(a.final, 'poses.json')))
    obj = next(o for o in poses['objects'] if o['obj_idx'] == a.obj)['transforms'][0]
    w, x, y, z = np.asarray(obj['rotation'], dtype=np.float64) / np.linalg.norm(obj['rotation'])
    M = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                  [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                  [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])
    s = np.asarray(obj['scale'], dtype=np.float64)
    flip = np.diag([-1.0, -1.0, 1.0])
    # p_cam = flip @ (M.T @ (s * p) + t): a row vector times M is M.T times the column.
    w2c = np.eye(4)
    w2c[:3, :3] = flip @ M.T @ np.diag(s)
    w2c[:3, 3] = flip @ np.asarray(obj['translation'], dtype=np.float64)
    cam = poses['cameras'][0]
    K518 = np.asarray(cam['K'], dtype=np.float64)
    scene_dir = a.scene_dir or os.path.join(os.path.dirname(os.path.abspath(a.final)), '..', '..', '..', '..', '..', 'demo', 'data', 'image', os.path.basename(os.path.dirname(os.path.dirname(os.path.abspath(a.final)))))
    photo = Image.open(os.path.join(scene_dir, '0000.png')).convert('RGB')
    if a.photo:
        # (The shape wants a picture with shading; the colour wants one without: the fitted picture relit by an image
        # editor told to move nothing, laid on through the same camera. Check the two agree before trusting it.)
        photo = Image.open(a.photo).convert('RGB').resize(photo.size, Image.LANCZOS)
    mask = Image.open(os.path.join(scene_dir, '0000_mask.png'))
    # K is for the picture as GenIA fed it (its longer side 518): scaled to the picture's own size.
    k = max(photo.size) / 518.0
    K = K518.copy()
    K[:2] *= k
    img = np.asarray(photo, dtype=np.float64) / 255.0
    al = (np.asarray(mask) > 0).astype(np.float64)
    # (The cut's last few pixels are part background: keep off them.)
    al = np.asarray(Image.fromarray((al * 255).astype(np.uint8)).filter(__import__('PIL.ImageFilter', fromlist=['MinFilter']).MinFilter(7)), dtype=np.float64) / 255.0
    # How well the fitted camera puts the mesh on the picture: its vertices against the cut.
    p = V @ w2c[:3, :3].T + w2c[:3, 3]
    uv = np.stack([K[0, 0] * p[:, 0] / p[:, 2] + K[0, 2], K[1, 1] * p[:, 1] / p[:, 2] + K[1, 2]], 1)
    hw = np.zeros(al.shape, dtype=bool)
    ok = (uv[:, 0] >= 0) & (uv[:, 0] < al.shape[1]) & (uv[:, 1] >= 0) & (uv[:, 1] < al.shape[0])
    hw[uv[ok, 1].astype(int), uv[ok, 0].astype(int)] = True
    hw = np.asarray(Image.fromarray(hw).filter(__import__('PIL.ImageFilter', fromlist=['MaxFilter']).MaxFilter(5))) > 0
    m = np.asarray(mask) > 0
    print(f'the fitted camera: mesh on the cut, overlap {float((hw & m).sum() / max(1, (hw | m).sum())):.3f} (1 = the same outline); focal {K518[0, 0]:.0f} px of 518')
    if a.debug:
        os.makedirs(a.debug, exist_ok=True)
        over = (img * 0.55 + np.stack([hw * 1.0, m * 0.0, m * 0.6], -1) * 0.45)
        Image.fromarray((np.clip(over, 0, 1) * 255).astype(np.uint8)).save(os.path.join(a.debug, 'photo_overlay.png'))
    PHOTO = (img, al, w2c, K)

# --- an orbit of generated views, through the cameras fitted to them (align_orbit.py) -----------------------------
if a.orbit:
    from scipy.spatial.transform import Rotation as Rot
    fit = json.load(open(a.orbit_align or os.path.join(a.final, 'orbit_align.json')))
    ocams = json.load(open(os.path.join(a.orbit, 'cameras.json')))
    osize = int(ocams['image_size'][0])
    ofx = float(ocams['intrinsics_normalised'][0][0]) * osize
    OK = np.array([[ofx, 0, osize / 2], [0, ofx, osize / 2], [0, 0, 1.0]])
    R = Rot.from_euler('y', fit['yaw_degrees'], degrees=True).as_matrix() @ np.array(fit['stand'])
    # orbit-world point = scale * R @ p + t, so the camera's w2c composed with it is a similarity of the mesh frame
    skip = {int(x) for x in a.orbit_skip.split(',') if x.strip()}
    from PIL import ImageFilter
    for fr in ocams['frames']:
        i = fr['index']
        if i in skip:
            continue
        W2C = np.linalg.inv(np.array(fr['cam2world'], dtype=np.float64))
        A = np.eye(4)
        A[:3, :3] = W2C[:3, :3] @ (fit['scale'] * R)
        A[:3, 3] = W2C[:3, :3] @ np.array(fit['translation']) + W2C[:3, 3]
        img = np.asarray(Image.open(os.path.join(a.orbit, 'frames', f'{i:03d}.png')).convert('RGB'), dtype=np.float64) / 255.0
        mp = os.path.join(a.orbit, 'masks', f'{i:03d}.png')
        al = (np.asarray(Image.open(mp)) > 127).astype(np.float64) if os.path.exists(mp) else np.ones(img.shape[:2])
        al = np.asarray(Image.fromarray((al * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)), dtype=np.float64) / 255.0
        # (The orbit's front frames repeat the picture: they count less, so the picture's own detail leads there.)
        fw = a.orbit_weight * (0.35 if fr['azimuth_deg'] < 25 or fr['azimuth_deg'] > 335 else 1.0)
        # (A looser occlusion test for the generated views: GenIA's mesh has loose locks of hair hanging in front of the
        # cheek, and from the side they hide it from the ray test; the generated frame has no such lock, it shows the
        # cheek, and a big occluder (the nose, the other side of the head) is still metres of it deeper than the tolerance.)
        n = lay(img, al, A, OK, fw, f'orbit_{i:02d}', tol=a.orbit_tol)
    print(f"orbit: {len(ocams['frames']) - len(skip)} frames laid on")

# --- the multi-view scene's own views, through their fitted cameras ------------------------------------------------
if MV is not None:
    srcs = [(MV['imgs'][v], np.asarray(Image.fromarray((MV['masks'][v] * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(9)), dtype=np.float64) / 255.0, MV['chain'](v), MV['K'](v)) for v in MV['views']]
    vote_pass(srcs + ([PHOTO] if PHOTO is not None else []))
    for v, (img_v, al, A_v, K_v) in zip(MV['views'], srcs):
        n = lay(img_v, al, A_v, K_v, a.mv_weight, f'view_{v:02d}')
    print(f"{len(MV['views'])} views laid on through GenIA's fitted cameras")

# --- the Gaussians, drawn from all round ---------------------------------------------------------
fov = math.radians(30)
dist = radius / math.sin(fov / 2) * 1.05
Kr = np.array([[a.size / 2 / math.tan(fov / 2), 0, a.size / 2], [0, a.size / 2 / math.tan(fov / 2), a.size / 2], [0, 0, 1.0]])
rings = [(-35, 8), (-12, 14), (12, 16), (35, 14), (62, 8), (88, 1)]
total = sum(c for _, c in rings)
count = 0
for elev, per in rings:
    per = max(1, round(per * a.views / total))
    for i in range(per):
        az = 2 * math.pi * (i + 0.5 * (elev > 0)) / per
        e = math.radians(elev)
        at = centre + dist * np.array([math.cos(e) * math.sin(az), -math.cos(e) * math.cos(az), math.sin(e)])
        fwd = (centre - at) / np.linalg.norm(centre - at)
        up = np.array([0, 0, 1.0]) if abs(fwd[2]) < 0.98 else np.array([0, 1.0, 0])
        right = np.cross(fwd, up)
        right /= np.linalg.norm(right)
        down = np.cross(fwd, right)
        w2c = np.eye(4)
        w2c[:3, :3] = np.stack([right, down, fwd])
        w2c[:3, 3] = -w2c[:3, :3] @ at
        with torch.no_grad():
            out, alpha, _ = rasterization(means, quats, scales, opac, cols, torch.tensor(w2c, dtype=torch.float32, device=dev)[None],
                                          torch.tensor(Kr, dtype=torch.float32, device=dev)[None], a.size, a.size, render_mode='RGB',
                                          rasterize_mode='antialiased')
        img = out[0].clamp(0, 4).cpu().numpy().astype(np.float64)
        al = alpha[0, ..., 0].cpu().numpy().astype(np.float64)
        # (A splat drawing is colour times coverage, over black: divide the coverage out where the splats are thin.)
        img = img / np.clip(al[..., None], 0.05, 1)
        lay(np.clip(img, 0, 1), al, w2c, Kr, 1.0, f'splat_{count:02d}')
        count += 1
print(f'{count} drawings of the Gaussians laid on')

# The picture last, and only where it agrees with the Gaussians' own colour there (skin on skin, hair on hair): the
# mesh's loose locks don't lie exactly where the picture's do, and a lock painted with the brow behind it is a skin-
# coloured fleck in the hair.
if PHOTO is not None:
    img, al, w2c, K = PHOTO
    cam_at = -np.linalg.solve(w2c[:3, :3], w2c[:3, 3])
    p = V @ w2c[:3, :3].T + w2c[:3, 3]
    uv = np.stack([K[0, 0] * p[:, 0] / p[:, 2] + K[0, 2], K[1, 1] * p[:, 1] / p[:, 2] + K[1, 2]], 1)
    vis, ray = visible(cam_at)
    facing = np.clip(-(N * ray).sum(1), 0, 1)
    c, inside = sample(img, uv)
    am, _ = sample(al[..., None], uv)
    base = np.where(wsum[:, None] > 1e-6, acc / np.maximum(wsum[:, None], 1e-6), c)
    lum = lambda x: x @ np.array([0.299, 0.587, 0.114])
    # (Disagreeing means hair against skin, one dark and the other light: not a difference of brightness, which is
    # what a relit picture is FOR. And the picture leads wherever it sees the surface at all, down to a shallow
    # angle: the Gaussians were fitted to the picture as it was lit, so its highlight is in them, and a cheek left to
    # them from the side is a pale band.)
    lo, hi = np.minimum(lum(c), lum(base)), np.maximum(lum(c), lum(base))
    agree = 1 - np.clip((0.2 - lo) / 0.06, 0, 1) * np.clip((hi - 0.34) / 0.08, 0, 1)
    lead = np.clip((facing - 0.12) / 0.4, 0, 1)
    w = a.photo_weight * np.maximum(wsum, 1.0) * vis * inside * (p[:, 2] > 0) * (am[:, 0] > 0.6) * lead * agree * vote_weight(c)
    # The Gaussians brought to the picture's light before the two are mixed, or their border is a seam (a relit
    # picture is brighter and flatter than what the Gaussians were fitted to): where both colour a vertex, the ratio
    # of the picture's colour to the Gaussians'; that ratio carried to the rest of the surface from the nearest such
    # vertices, fading out with distance (a third of the object away it is 1 again).
    both = (w > 0) & (wsum > 1e-6) & (facing > 0.45)
    if both.sum() > 100:
        from scipy.spatial import cKDTree
        gain = np.clip((c[both] + 0.03) / (base[both] + 0.03), 0.5, 2.2)
        d, i = cKDTree(V[both]).query(V, k=24, workers=-1)
        wd = 1.0 / (d + 0.01) ** 2
        g = (gain[i] * wd[..., None]).sum(1) / wd.sum(1, keepdims=True)
        fade = np.exp(-(d[:, 0] / (0.33 * radius * 2)) ** 2)[:, None]
        # (Skin only: a gain measured on skin, laid on dark hair, lights it in warm blotches.)
        g = 1 + (g - 1) * fade * np.clip((lum(base) - 0.2) / 0.12, 0, 1)[:, None]
        acc *= g
        print(f"the Gaussians brought to the picture's light: gain {np.median(gain, 0).round(2)} over {int(both.sum())} vertices")
    acc += c * w[:, None]
    wsum += w
    WP = w
    print(f'the picture: {int((w > 0).sum())} vertices, {int(((agree < 0.5) & vis & inside).sum())} left to the Gaussians where the two disagree')

seen = wsum > 1e-6
col = old.copy()
col[seen] = acc[seen] / wsum[seen, None]
# The skin the picture didn't show, from the skin it did, mirrored (--mirror, for a head: a face is near enough the
# same on both sides, and GenIA's own guess at the unseen cheek is a pale band with a dark smear at the temple). The
# object's own frame has its front along -y and is centred, so the mirror is x -> -x. Skin only: where both this
# vertex and its mirror are light (hair is left as it is: a parting isn't symmetric), within 1.5% of the height.
if a.mirror and PHOTO is not None:
    from scipy.spatial import cKDTree
    share = WP / np.maximum(wsum, 1e-9)
    lumv = col @ np.array([0.299, 0.587, 0.114])
    donors = np.where(seen & (share > 0.6) & (lumv > a.mirror_skin))[0]
    takers = np.where(seen & (share < 0.5) & (lumv > a.mirror_skin * 0.8))[0]
    if len(donors) and len(takers):
        x0 = float(np.median(V[:, 0])) if a.mirror_x is None else a.mirror_x
        m = V[takers] * np.array([-1.0, 1, 1]) + np.array([2 * x0, 0, 0])
        d, i = cKDTree(V[donors]).query(m, k=6, workers=-1)
        near = d[:, 0] < 0.015 * (V[:, 2].max() - V[:, 2].min())
        w = 1.0 / (d + 1e-4) ** 2
        mc = (col[donors][i] * w[..., None]).sum(1) / w.sum(1, keepdims=True)
        t = ((1 - share[takers] / 0.5) * near)[:, None]
        col[takers] = col[takers] * (1 - t) + mc * t
        print(f'mirrored onto {int(near.sum())} skin vertices the picture did not show (about x = {x0:.3f})')
# What no view sees squarely (under a lock of hair, behind an ear, inside the nostrils) takes the colour of the seen
# surface nearest it, not the mesh decoder's: its guess is the blotched one, and shows as pale patches beside the ear.
if (~seen).any() and seen.any():
    from scipy.spatial import cKDTree
    d, i = cKDTree(V[seen]).query(V[~seen], k=8, workers=-1)
    w = 1.0 / (d + 1e-4) ** 2
    col[~seen] = (col[seen][i] * w[..., None]).sum(1) / w.sum(1, keepdims=True)
print(f"vertices coloured {int(seen.sum())} of {len(V)}; {int((~seen).sum())} that no view sees took their neighbours' colour")
out = a.out or os.path.join(a.final, 'meshes', f'{a.obj:03d}_baked.glb')
# glTF's COLOR_0 is LINEAR: the picture's and the splats' colours (and the mesh decoder's own, which GenIA writes
# as they are) are sRGB values, and written unchanged a viewer that follows the format shows them washed out and pale.
col = np.clip(col, 0, 1)
lin = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
trimesh.Trimesh(vertices=V, faces=F, vertex_colors=np.round(lin * 255).astype(np.uint8), process=False).export(out)
print('wrote', out)
