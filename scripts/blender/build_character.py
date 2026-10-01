"""Builds a game character from a definition in scripts/blender/characters/<name>.json.

  blender -b --python scripts/blender/build_character.py -- scripts/blender/characters/salaryman.json
  blender -b --python scripts/blender/build_character.py -- scripts/blender/characters/maid.json --preview-only

Options after the definition: --preview-only (no GLB), --head-only (only the head close-ups),
--compare-only (only the side-by-side with a reference photo, if the definition has "compare"),
--no-compare, and
--view x,y,z,tx,ty,tz out.png (one more render from a camera at x,y,z looking at tx,ty,tz, in
Blender's frame: Z up, the character facing -Y), for checking a detail.

Uses mpfb_base.py (next to this file) for the MPFB side: the human preset, the height search, the rig.
On top of that a definition says, per part, how it should look in the game: texture size and edits
(recolouring), roughness and metalness, decimation; and it can add garments modelled here
(garments.py) where no free asset exists. The result is one GLB (game_engine rig, +Y up, metres,
facing +Z, feet at y=0, A-pose rest) and a preview sheet: front, three-quarter, side and back
rendered with EEVEE (so gloss shows as it will), and the head close up from the front and
three-quarters.

The definition (all keys but body optional):
  name                   node names in the GLB (<name>, <name>.body, <name>.<asset>)
  out, preview           paths from the repo root
  body:
    gender, years | age, height_cm | height, muscle, weight, proportions, cupsize, firmness
                         MakeHuman macros (0..1, 0.5 average); years and height_cm are solved for
    race                 {"asian": 1, ...}, normalised
    targets              {"nose-scale-horiz-decr": 0.3, ...}: MakeHuman targets by file name; a
                         name starting "lr-" sets the l- and r- targets alike
    proxy                a proxy mesh to use for the body instead of the base mesh (default none)
    sculpt               {"lower_face", "jaw_narrow", ...}: head warps beyond the targets (see sculpt)
    decimate             ratio for the visible body after clothes have masked the skin under them
    protect              vertex group kept at full detail when decimating (default "head")
  max_tex                largest texture side unless a part says otherwise (default 1024)
  skin, eyes, eyebrows, eyelashes, hair:  {"asset": name, ...part settings}
  clothes                [{"asset": name, ...part settings}]
  garments               [{"type": "apron" | "headband" | "hair_cards", ...}]: see garments.py
  compare                a head-and-shoulders render framed like a reference photo, side by side
                         with it, for likeness work: see render_compare
Part settings:
  roughness, metallic    set on the material (and any texture feeding them unlinked)
  double_sided           for cards (hair, lashes, frills)
  decimate               collapse to this ratio of the part's triangles
  max_tex                texture size for this part
  ops                    texture edits in order, see edit_pixels
  normal_map             false drops the part's normal map
  sheen                  {"weight", "roughness", "tint"}: satin, exported as KHR_materials_sheen
  specular               the specular level (0.5 default)
  masks                  {name: {"expr": ...}}: masks from the geometry, for ops' "uvmask"
                         (see mask_weights); the skin also has "under_hair"
  delete_uv, delete_where  faces to drop (see delete_faces)
  inflate                metres to push the part out along its normals
  kind                   (clothes) the asset kind to look it up as (default "clothes")
  hem_cm                 (clothes) cut the garment off level at this height and show the skin below
  color                  (eyes) the iris colour: blue, brown, brownlight, deepblue, green, grey ...
"""
import json
import math
import os
import sys
import tempfile

import bpy
import bmesh
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mpfb_base as mb  # noqa: E402
import garments  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def repo_path(p):
    return p if os.path.isabs(p) else os.path.join(REPO, p)


# --- the MPFB preset ---------------------------------------------------------------------------

def expand_targets(targets):
    out = []
    for name, value in (targets or {}).items():
        names = ['l-' + name[3:], 'r-' + name[3:]] if name.startswith('lr-') else [name]
        out += [{'target': n, 'value': float(value)} for n in names]
    return out


def human_info(d):
    body = d['body']
    phenotype = mb.TargetService.get_default_macro_info_dict()
    for macro in ('gender', 'age', 'height', 'muscle', 'weight', 'proportions', 'cupsize', 'firmness'):
        if macro in body:
            phenotype[macro] = float(body[macro])
    if 'years' in body:
        phenotype['age'] = mb.years_to_age(body['years'])
    race = {k: float(body.get('race', {}).get(k, 0)) for k in ('asian', 'caucasian', 'african')}
    total = sum(race.values()) or 1.0
    phenotype['race'] = {k: v / total for k, v in race.items()} if sum(race.values()) else {'asian': 1.0, 'caucasian': 0.0, 'african': 0.0}

    def part(key, kind, ext='.mhclo'):
        p = d.get(key)
        return mb.asset(kind, p['asset'], ext) if p and p.get('asset') else ''

    info = mb.HumanService._create_default_human_info_dict()
    info.update({
        'name': d['name'],
        'phenotype': phenotype,
        'rig': d.get('rig', 'game_engine'),
        'eyes': part('eyes', 'eyes'),
        'eyebrows': part('eyebrows', 'eyebrows'),
        'eyelashes': part('eyelashes', 'eyelashes'),
        'hair': part('hair', 'hair'),
        'proxy': mb.asset('proxymeshes', body['proxy'], '.proxy') if body.get('proxy') else '',
        'clothes': [mb.asset(c.get('kind', 'clothes'), c['asset'], '.mhclo') for c in d.get('clothes', [])],
        'skin_mhmat': part('skin', 'skins', '.mhmat'),
        'skin_material_type': 'GAMEENGINE',
        'eyes_material_type': 'GAMEENGINE',
        'targets': expand_targets(body.get('targets')),
    })
    color = (d.get('eyes') or {}).get('color')
    if info['eyes'] and color and color != 'brown':
        info['alternative_materials'] = {mb.mhclo_uuid('eyes', info['eyes']): 'materials/' + color + '.mhmat'}
    return info


# --- texture edits -----------------------------------------------------------------------------

def hex_rgb(c):
    if isinstance(c, str):
        c = c.lstrip('#')
        return np.array([int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)
    return np.array(c[:3], dtype=np.float32)


def hex_rgb_linear(c):
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in hex_rgb(c)]


def soft_range(x, lo, hi, soft=0.03):
    # 1 inside [lo, hi], easing to 0 over `soft` outside, so edits don't leave hard outlines.
    a = np.clip((x - (lo - soft)) / soft, 0, 1) if lo > 0 else 1.0
    b = np.clip(((hi + soft) - x) / soft, 0, 1) if hi < 1 else 1.0
    return a * b


def edit_pixels(px, ops):
    """Edits an (h, w, 4) array of sRGB-encoded pixels. Each op can be limited by
    rect [x0, y0, x1, y1] (fractions of the image, top-left origin, as in an image editor),
    poly [[x, y], ...] (the same coordinates), circle [cx, cy, r] (the same),
    lum [lo, hi] (luminance), sat [lo, hi] (saturation) and uvmask (a mask made from the
    geometry: "under_hair", the skin the hair covers), and faded with amount (0..1):
      {"op": "grade", "saturation": s, "gain": "#rrggbb" | [r, g, b], "gamma": g, "lift": l}
      {"op": "colorize", "color": "#rrggbb", "contrast": c}  the colour, with the luminance's
          variation round its median (so weave, folds and strands stay)
      {"op": "fill", "color": "#rrggbb"}       {"op": "invert"}
      {"op": "opaque"}                         alpha to 1 (unlimited by masks)
      {"op": "smooth", "radius": px}           a box blur
      {"op": "alpha", "gain": g}               alpha times g (unlimited by masks)
      {"op": "bulge", "center": [cx, cy], "radius": r, "scale": k}  magnify round a point
    """
    h, w = px.shape[:2]
    rgb = px[..., :3]
    for op in ops:
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        mask = np.full((h, w), float(op.get('amount', 1.0)), dtype=np.float32)
        if 'rect' in op:
            x0, y0, x1, y1 = op['rect']
            r = np.zeros((h, w), dtype=np.float32)
            r[int((1 - y1) * h):int((1 - y0) * h), int(x0 * w):int(x1 * w)] = 1
            mask *= r
        if 'poly' in op:
            # Inside a polygon of [x, y] points (fractions, top-left origin): even-odd rule.
            yy, xx = np.mgrid[0:h, 0:w]
            fx, fy = (xx + 0.5) / w, 1 - (yy + 0.5) / h
            inside = np.zeros((h, w), dtype=bool)
            pts = op['poly']
            for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
                cross = ((y0 > fy) != (y1 > fy)) & (fx < (x1 - x0) * (fy - y0) / ((y1 - y0) or 1e-9) + x0)
                inside ^= cross
            mask *= inside
        if 'circle' in op:
            # Inside a circle [cx, cy, r] (fractions, top-left origin), with a soft edge of 10%.
            cx, cy, cr = op['circle']
            yy, xx = np.mgrid[0:h, 0:w]
            rr = np.hypot((xx + 0.5) / w - cx, (1 - (yy + 0.5) / h) - cy)
            mask *= np.clip((cr - rr) / (0.1 * cr), 0, 1)
        if 'lum' in op:
            mask *= soft_range(lum, *op['lum'])
        if 'uvmask' in op:
            m = UV_MASKS.get(op['uvmask'])
            if m is not None:
                if m.shape != (h, w):
                    # Nearest resample to this image's size.
                    m = m[(np.arange(h) * m.shape[0] // h)[:, None], (np.arange(w) * m.shape[1] // w)[None, :]]
                mask *= m
        if 'sat' in op:
            mx, mn = rgb.max(axis=2), rgb.min(axis=2)
            mask *= soft_range((mx - mn) / np.maximum(mx, 1e-4), *op['sat'])
        kind = op['op']
        if kind == 'opaque':
            # Drops the alpha (holes in lace, say): the part exports opaque.
            px[..., 3] = 1.0
            continue
        if kind == 'alpha':
            # Scales the alpha (then clipped): >1 fills thin, half-transparent parts of hair cards
            # that alpha clipping would otherwise cut away.
            px[..., 3] = np.clip(px[..., 3] * float(op.get('gain', 1.0)), 0, 1)
            continue
        if kind == 'bulge':
            # Magnifies round a point (an iris, say): {"center": [cx, cy], "radius": r, "scale": k};
            # inside r the image is scaled up by k at the centre, easing back to none at r.
            cx, cy = op['center']
            R, k = float(op['radius']), float(op.get('scale', 1.3))
            yy, xx = np.mgrid[0:h, 0:w]
            fx, fy = (xx + 0.5) / w - cx, (1 - (yy + 0.5) / h) - cy
            rr = np.hypot(fx, fy)
            a = np.clip(rr / R, 0, 1)
            sc = 1 / k + (1 - 1 / k) * a * a * (3 - 2 * a)
            sx = np.clip(((cx + fx * sc) * w).astype(int), 0, w - 1)
            sy = np.clip(((1 - (cy + fy * sc)) * h).astype(int), 0, h - 1)
            px[..., :3] = rgb
            px[...] = px[sy, sx]
            rgb = px[..., :3].copy()
            continue
        if kind == 'smooth':
            # A box blur (radius in pixels), blended by the mask: evens out blotchy skin.
            new = rgb.copy()
            r = int(op.get('radius', 2))
            for axis in (0, 1):
                c = np.cumsum(np.pad(new, [(r + 1, r) if a == axis else (0, 0) for a in range(3)], mode='edge'), axis=axis)
                hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
                lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
                new = (hi - lo) / (2 * r + 1)
        elif kind == 'invert':
            new = 1 - rgb
        elif kind == 'fill':
            new = np.broadcast_to(hex_rgb(op['color']), rgb.shape)
        elif kind == 'colorize':
            # The reference is the masked pixels' median, leaving out the empty (black) parts of
            # the texture between UV islands, which would make everything else read as bright.
            sel = lum[(mask > 0.5) & (lum > 0.02)]
            ref = float(np.median(sel)) if sel.size else 0.5
            rel = (lum / max(ref, 1e-3)) ** float(op.get('contrast', 1.0))
            new = hex_rgb(op['color']) * rel[..., None]
        elif kind == 'grade':
            new = lum[..., None] + (rgb - lum[..., None]) * float(op.get('saturation', 1.0))
            new = new * hex_rgb(op.get('gain', [1, 1, 1]))
            new = np.clip(new, 0, 1) ** float(op.get('gamma', 1.0))
            lift = float(op.get('lift', 0.0))
            new = lift + new * (1 - lift)
        else:
            raise SystemExit('Unknown texture op ' + kind)
        rgb = rgb * (1 - mask[..., None]) + np.clip(new, 0, 1) * mask[..., None]
    px[..., :3] = rgb
    return px


_done_images = {}
UV_MASKS = {}


def uv_mask(obj, weights, size, blur=4):
    """Rasterises per-vertex weights (0..1) into the object's UV space: each triangle's pixels
    get the weights interpolated across it, so a mask fades over a triangle at its edge; then a
    box blur of `blur` px. Returns (size, size), rows bottom-up as Blender's pixels."""
    me = obj.data
    me.calc_loop_triangles()
    uvs = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get('uv', uvs)
    uvs = uvs.reshape(-1, 2)
    mask = np.zeros((size, size), dtype=np.float32)
    for tri in me.loop_triangles:
        vals = weights[list(tri.vertices)]
        if vals.max() <= 0:
            continue
        p = uvs[list(tri.loops)] * size
        x0, y0 = np.floor(p.min(axis=0)).astype(int)
        x1, y1 = np.ceil(p.max(axis=0)).astype(int)
        xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1 + 1, size)), np.arange(max(y0, 0), min(y1 + 1, size)))
        if xs.size == 0:
            continue
        px, py = xs + 0.5, ys + 0.5
        (ax, ay), (bx, by), (cx, cy) = p
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
        l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
        l3 = 1 - l1 - l2
        inside = (l1 >= -0.01) & (l2 >= -0.01) & (l3 >= -0.01)
        val = l1 * vals[0] + l2 * vals[1] + l3 * vals[2]
        cur = mask[ys, xs]
        mask[ys, xs] = np.where(inside, np.maximum(cur, val), cur)
    r = int(blur)
    if r > 0:
        for axis in (0, 1):
            c = np.cumsum(np.pad(mask, [(r + 1, r) if a == axis else (0, 0) for a in range(2)], mode='edge'), axis=axis)
            mask = (np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
                    - np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
    return np.clip(mask, 0, 1)


def world_verts(obj):
    me = obj.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    no = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', no)
    mw = np.array(obj.matrix_world)
    co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    no = no.reshape(-1, 3) @ mw[:3, :3].T
    no /= np.maximum(np.linalg.norm(no, axis=1, keepdims=True), 1e-9)
    return co, no


def under_hair_weights(body, hair):
    # A vertex is under the hair when a ray out along its normal meets the hair within 1.5 cm
    # (hair lying on the scalp; a fringe hanging in front of the forehead is further out and
    # doesn't count), fading out to 2.5 cm. The skin there is the scalp, and shows through the
    # gaps between hair cards, so it's painted the hair's colour.
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    hb = BVHTree.FromObject(hair, dg)
    co, no = world_verts(body)
    hit = np.zeros(len(co), dtype=np.float32)
    for i in range(len(co)):
        o = Vector(co[i])
        loc = hb.ray_cast(o, Vector(no[i]), 0.025)[0]
        if loc is not None:
            hit[i] = min(1.0, max(0.0, (0.025 - (loc - o).length) / 0.01))
    return hit


def group_weights(obj, name):
    g = obj.vertex_groups.get(name)
    w = np.zeros(len(obj.data.vertices), dtype=np.float32)
    if g is None:
        return w
    gi = g.index
    for v in obj.data.vertices:
        for e in v.groups:
            if e.group == gi:
                w[v.index] = e.weight
    return w


def landmarks(body, eyes, rig):
    """Points on the face in the world frame (Z up, facing -Y), for placing makeup and cameras:
    eye_l / eye_r (eyeball centres; l and r are the character's), lips (their centre), nose_tip,
    chin, brow (between the brows), head_top, and left (+1/-1: the sign of x on her left)."""
    from mathutils.bvhtree import BVHTree
    hand_l = rig.matrix_world @ rig.data.bones['hand_l'].head_local
    L = {'left': np.array([1.0 if hand_l.x > 0 else -1.0, 0.0, 0.0])}
    co, no = world_verts(body)
    if eyes is not None:
        ec, _ = world_verts(eyes)
        side = ec[:, 0] * L['left'][0] > 0
        L['eye_l'], L['eye_r'] = ec[side].mean(axis=0), ec[~side].mean(axis=0)
        eye_z = (L['eye_l'][2] + L['eye_r'][2]) / 2
    else:
        eye_z = co[:, 2].max() - 0.12
    w = group_weights(body, 'lips')
    if w.max() > 0.5:
        L['lips'] = co[w > 0.5].mean(axis=0)
    mid = np.abs(co[:, 0]) < 0.004
    if 'lips' in L:
        face = mid & (co[:, 2] < eye_z) & (co[:, 2] > L['lips'][2])
        if face.any():
            L['nose_tip'] = co[face][np.argmin(co[face][:, 1])]
        front = mid & (co[:, 2] < L['lips'][2]) & (co[:, 2] > L['lips'][2] - 0.09) & (no[:, 1] < -0.3)
        if front.any():
            L['chin'] = co[front][np.argmin(co[front][:, 2])]
    L['head_top'] = co[np.argmax(co[:, 2])]
    brow = mid & (np.abs(co[:, 2] - (eye_z + 0.02)) < 0.006)
    L['brow'] = co[brow][np.argmin(co[brow][:, 1])] if brow.any() else np.array([0, 0, eye_z + 0.02])
    L['bvh'] = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    return L


def mask_weights(obj, spec, L):
    """Per-vertex weights from a mask definition {"expr": "<numpy expression>"}, evaluated with
    x, y, z (world, metres; Z up, facing -Y), nx, ny, nz (normals), u, v (UVs, top-left origin),
    L (landmarks, see landmarks())
    and helpers:
      near(p, r)               a soft round spot (Gaussian of radius r) round point p
      near3(p, rx, ry, rz)     an elliptical one
      lin(v, a, b)             0 at a, 1 at b, clamped (a > b reverses)
      group(name)              the object's vertex group weights
      onface(p)                p moved onto the skin straight in from the front
      P(base, dx, dy, dz)      base plus an offset, dx towards her left (mirror with -dx)
      boundary()               the vertices on open edges (eye openings, hems)
      dist(sel)                each vertex's distance to the nearest of the selected ones"""
    co, no = world_verts(obj)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    # Each vertex's UV (from one of its corners), top-left origin as for texture ops.
    me = obj.data
    loops = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', loops)
    luv = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get('uv', luv)
    uvv = np.zeros((len(co), 2), dtype=np.float32)
    uvv[loops] = luv.reshape(-1, 2)
    u, v = uvv[:, 0], 1 - uvv[:, 1]

    def near(p, r):
        return np.exp(-np.sum((co - np.asarray(p)) ** 2, axis=1) / (r * r))

    def near3(p, rx, ry, rz):
        dd = (co - np.asarray(p)) / np.array([rx, ry, rz])
        return np.exp(-np.sum(dd * dd, axis=1))

    def lin(v, a, b):
        return np.clip((v - a) / (b - a), 0, 1)

    def onface(p):
        hit = L['bvh'].ray_cast(Vector((p[0], p[1] - 0.3, p[2])), Vector((0, 1, 0)), 0.6)[0]
        return np.array(hit) if hit is not None else np.asarray(p)

    def P(base, dx=0.0, dy=0.0, dz=0.0):
        return np.asarray(base) + np.array([dx * L['left'][0], dy, dz])

    def boundary():
        # Vertices on open edges (the eye openings, the mouth's, a garment's hems).
        import bmesh as _bm
        bm = _bm.new()
        bm.from_mesh(obj.data)
        out = np.zeros(len(co), dtype=bool)
        for v in bm.verts:
            out[v.index] = any(e.is_boundary for e in v.link_edges)
        bm.free()
        return out

    def dist(sel):
        # Each vertex's distance to the nearest selected one.
        from mathutils.kdtree import KDTree
        pts = co[np.asarray(sel, dtype=bool)]
        if len(pts) == 0:
            return np.full(len(co), 1e9)
        kd = KDTree(len(pts))
        for i, q in enumerate(pts):
            kd.insert(q, i)
        kd.balance()
        return np.array([kd.find(q)[2] for q in co])

    env = dict(np=np, x=x, y=y, z=z, nx=no[:, 0], ny=no[:, 1], nz=no[:, 2], L=L, near=near, near3=near3,
               lin=lin, group=lambda n: group_weights(obj, n), onface=onface, P=P, abs=np.abs,
               boundary=boundary, dist=dist, u=u, v=v)
    w = eval(spec['expr'], {'__builtins__': {}}, env)
    return np.clip(np.broadcast_to(np.asarray(w, dtype=np.float32), (len(co),)), 0, 1).astype(np.float32)


def delete_faces(obj, part, L):
    # "delete_uv": [[x0, y0, x1, y1], ...] (fractions, top-left origin, as for texture ops) drops
    # the faces whose UV centre lies in one; "delete_where": an expression on a face's centre
    # (x, y, z, its UV u, v, L, and top_of(v0, v1, u0, u1): the highest vertex
    # with its UV in that range)
    # drops it where true.
    me = obj.data
    mw = obj.matrix_world
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    gone = []
    # top_of(v0, v1): the highest point of the part's vertices whose UV v (top-left origin) is
    # in [v0, v1] (where a garment's region ends, say).
    vco = [(mw @ lp.vert.co).z for f in bm.faces for lp in f.loops]
    vuv = [(lp[uvl].uv.x, 1 - lp[uvl].uv.y) for f in bm.faces for lp in f.loops]

    def top_of(v0, v1, u0=0.0, u1=1.0):
        return max(z for z, (uq, vq) in zip(vco, vuv) if v0 <= vq <= v1 and u0 <= uq <= u1)
    for f in bm.faces:
        u = sum(lp[uvl].uv.x for lp in f.loops) / len(f.loops)
        v = 1 - sum(lp[uvl].uv.y for lp in f.loops) / len(f.loops)
        if any(x0 <= u <= x1 and y0 <= v <= y1 for x0, y0, x1, y1 in part.get('delete_uv', [])):
            gone.append(f)
            continue
        if 'delete_where' in part:
            c = mw @ f.calc_center_median()
            env = dict(np=np, x=c.x, y=c.y, z=c.z, u=u, v=v, L=L, abs=abs, min=min, max=max, top_of=top_of)
            if eval(part['delete_where'], {'__builtins__': {}}, env):
                gone.append(f)
    print('build_character: %s: dropped %d of %d faces' % (obj.name, len(gone), len(bm.faces)))
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(me)
    bm.free()
    me.update()


def process_image(img, max_px, ops, tmpdir):
    # Resize, edit, then save as a file the glTF exporter copies as it is: JPEG when the image has
    # no alpha (most of them; far smaller), PNG when it has.
    if img.name in _done_images:
        return
    w, h = img.size
    if max(w, h) > max_px:
        k = max_px / max(w, h)
        img.scale(max(1, round(w * k)), max(1, round(h * k)))
        w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    if ops and img.colorspace_settings.name not in ('Non-Color', 'Linear Rec.709', 'Raw'):
        px = edit_pixels(px, ops)
        img.pixels.foreach_set(px.ravel())
    alpha = img.channels == 4 and float(px[..., 3].min()) < 0.99
    stem = ''.join(ch if ch.isalnum() else '_' for ch in os.path.splitext(img.name)[0])
    path = os.path.join(tmpdir, stem + ('.png' if alpha else '.jpg'))
    img.file_format = 'PNG' if alpha else 'JPEG'
    img.save(filepath=path, quality=90)
    img.filepath_raw = path
    img.reload()
    _done_images[img.name] = (w, h, 'png' if alpha else 'jpg')


def material_images(mat):
    return [n.image for n in mat.node_tree.nodes if getattr(n, 'image', None) is not None]


def set_material(obj, part, max_tex, tmpdir):
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.node_tree:
            continue
        for img in material_images(mat):
            process_image(img, part.get('max_tex', max_tex), part.get('ops'), tmpdir)
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None:
            continue
        for key, socket in (('roughness', 'Roughness'), ('metallic', 'Metallic')):
            if key in part:
                for link in list(bsdf.inputs[socket].links):
                    mat.node_tree.links.remove(link)
                bsdf.inputs[socket].default_value = float(part[key])
        if 'sheen' in part:
            # Satin and velvet: exported as KHR_materials_sheen.
            sh = part['sheen']
            bsdf.inputs['Sheen Weight'].default_value = float(sh.get('weight', 1.0))
            bsdf.inputs['Sheen Roughness'].default_value = float(sh.get('roughness', 0.3))
            bsdf.inputs['Sheen Tint'].default_value = list(hex_rgb_linear(sh.get('tint', '#ffffff'))) + [1.0]
        if 'specular' in part:
            # The Principled BSDF's specular level (0.5 is the default F0 of 4%).
            bsdf.inputs['Specular IOR Level'].default_value = float(part['specular'])
        if 'double_sided' in part:
            mat.use_backface_culling = not part['double_sided']
        if part.get('normal_map') is False:
            for link in list(bsdf.inputs['Normal'].links):
                mat.node_tree.links.remove(link)


# --- geometry ----------------------------------------------------------------------------------

def rest_coords(obj):
    # Vertex positions with the shape keys mixed in and no modifiers, so indices match the mesh.
    saved = [(m, m.show_viewport) for m in obj.modifiers]
    for m, _ in saved:
        m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    for m, v in saved:
        m.show_viewport = v
    co = co.reshape(-1, 3)
    mw = np.array(obj.matrix_world)
    return co @ mw[:3, :3].T + mw[:3, 3]


def uncover_below(basemesh, asset, hem_z):
    # A garment hides the skin it covers through a delete group on the base mesh. Cutting the
    # garment shorter must show the legs again, so take the skin below the new hem out of it
    # (with 1 cm under the hem, so no gap opens when the cloth moves).
    vg = basemesh.vertex_groups.get('Delete.' + asset)
    if vg is None:
        return
    co = rest_coords(basemesh)
    idx = [int(i) for i in np.nonzero(co[:, 2] < hem_z - 0.01)[0]]
    if idx:
        vg.remove(idx)


def cut_hem(obj, hem_z):
    mw = obj.matrix_world
    inv = mw.inverted()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    co = inv @ Vector((0, 0, hem_z))
    no = (inv.to_3x3().transposed() @ Vector((0, 0, 1))).normalized()
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, clear_inner=True)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def sculpt(basemesh, eyes, spec):
    """Smooth warps of the head that MakeHuman's targets can't reach, as one more shape key on the
    base mesh; MPFB then refits the rig and everything worn to it. All are functions of height
    alone, so the mesh can't tear:
      lower_face   shorten eye-to-chin by this fraction (the chin comes up, the neck below
                   lengthens to meet it): a stylised, short lower face
      jaw_narrow   narrow the head by this fraction at jaw height, easing to nothing at the eyes
                   and down the neck: a V-line
      neck_len     how far below the chin the warps fade out (metres, default 0.07)
      local        [{"at": "lips" | "nose" | "eyes", "radius": r, "scale": [sx, sy, sz]}]: scale
                   round a feature, fading out smoothly to nothing at r"""
    co = rest_coords(basemesh)
    ec, _ = world_verts(eyes)
    eye_z = float(ec[:, 2].mean())
    lips = group_weights(basemesh, 'lips') > 0.5
    lips_y, lips_z = float(co[lips, 1].mean()), float(co[lips, 2].mean())
    mid = np.abs(co[:, 0]) < 0.004
    chin_pts = mid & (co[:, 2] < lips_z) & (co[:, 2] > lips_z - 0.09) & (co[:, 1] < lips_y + 0.03)
    chin_z = float(co[chin_pts, 2].min())
    neck_low = chin_z - float(spec.get('neck_len', 0.07))
    z = co[:, 2]

    # Vertical: displacement up, rising from 0 at the eyes to the full amount at the chin (eased
    # in over the top quarter so there's no crease under the eyes), then back to 0 down the neck.
    span = eye_z - chin_z
    t = np.clip((eye_z - z) / span, 0, 1)
    p = np.where(t < 0.25, 2 * t * t, t - 0.125) / 0.875
    s = np.clip((chin_z - z) / (chin_z - neck_low), 0, 1)
    q = 1 - 3 * s * s + 2 * s ** 3
    prof = np.where(z >= chin_z, p, q) * (z > neck_low) * (z < eye_z)
    dz = float(spec.get('lower_face', 0.0)) * span * prof

    # Horizontal: narrower towards the jaw.
    def smooth(a):
        a = np.clip(a, 0, 1)
        return a * a * (3 - 2 * a)
    r = np.where(z >= lips_z, smooth((eye_z - 0.01 - z) / (eye_z - 0.01 - lips_z)), 1.0)
    r = np.where(z < chin_z, 1 - smooth((chin_z - z) / (chin_z - neck_low)), r) * (z > neck_low) * (z < eye_z)
    sx = 1 - float(spec.get('jaw_narrow', 0.0)) * r

    new = co.copy()
    # Local scalings round a feature (the mouth, say), fading out smoothly by "radius":
    # {"at": "lips" | "nose" | "eyes", "radius": r, "scale": [sx, sy, sz]}.
    nose = co[mid & (z < eye_z) & (z > lips_z)]
    centres = {'lips': np.array([0.0, lips_y, lips_z]),
               'nose': nose[np.argmin(nose[:, 1])] if len(nose) else np.array([0.0, lips_y, (eye_z + lips_z) / 2])}
    for loc in spec.get('local', []):
        pts = [centres[loc['at']]] if loc['at'] != 'eyes' else [
            ec[ec[:, 0] > 0].mean(axis=0), ec[ec[:, 0] < 0].mean(axis=0)]
        for c in pts:
            d = np.linalg.norm(co - c, axis=1) / float(loc['radius'])
            w = np.clip(1 - d, 0, 1)
            w = w * w * (3 - 2 * w)
            sc = np.array(loc['scale'], dtype=float)
            new += (co - c) * (sc - 1) * w[:, None]
    new[:, 0] *= sx
    new[:, 2] += dz
    # As a shape key relative to the basis: basis + (new - mixed).
    me = basemesh.data
    basis = np.empty(len(me.vertices) * 3)
    me.shape_keys.reference_key.data.foreach_get('co', basis)
    inv = np.array(basemesh.matrix_world.inverted())
    delta = (new - co) @ inv[:3, :3].T
    key = basemesh.shape_key_add(name='sculpt', from_mix=False)
    key.data.foreach_set('co', (basis.reshape(-1, 3) + delta).ravel())
    key.value = 1.0
    me.update()
    mb.HumanService.refit(basemesh)
    print('mpfb_base: sculpt eye %.3f lips %.3f chin %.3f, chin up %.1f mm' % (eye_z, lips_z, chin_z, dz.max() * 1000))


def decimate(obj, ratio, protect=None):
    # Collapse decimation keeps UVs and interpolates bone weights. `protect` names a vertex group
    # (a bone's, e.g. "head") left at full detail: the face is where triangles count.
    if not ratio or ratio >= 1:
        return
    mod = obj.modifiers.new('Decimate', 'DECIMATE')
    mod.ratio = ratio
    mod.use_symmetry = True
    mod.symmetry_axis = 'X'
    if protect and protect in obj.vertex_groups:
        mod.vertex_group = protect
        mod.invert_vertex_group = True
        mod.vertex_group_factor = 1.0
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)


# --- preview -----------------------------------------------------------------------------------

def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render_view(scene, tmp, name, w, h):
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(tmp, name + '.png')
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(scene.render.filepath)
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def add_light(name, kind, loc, target, energy, size=1.0):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    if kind == 'AREA':
        data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    look_at(obj, target)
    return obj


def render_preview(path, meshes, rig, head_only=False):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 48
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Khronos PBR Neutral'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.resolution_percentage = 100
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.32, 0.34, 0.37, 1)
    bg.inputs['Strength'].default_value = 0.5

    pts = mb.world_points(meshes)
    z0, z1 = float(pts[:, 2].min()), float(pts[:, 2].max())
    mid = (z0 + z1) / 2
    # Studio lighting: a soft key from the front left and above, a fill from the right, a rim.
    add_light('Key', 'AREA', (-1.6, -2.6, z1 + 0.9), (0, 0, mid + 0.2), 150, 1.6)
    add_light('Fill', 'AREA', (2.2, -2.0, mid + 0.3), (0, 0, mid), 50, 2.0)
    add_light('Rim', 'AREA', (0.6, 2.6, z1 + 0.6), (0, 0, mid + 0.3), 120, 1.2)

    cam_data = bpy.data.cameras.new('PreviewCam')
    cam = bpy.data.objects.new('PreviewCam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    tmp = tempfile.mkdtemp()
    panels = []

    W, H = 480, 900
    if not head_only:
        cam_data.type = 'ORTHO'
        # Characters face -Y; angles turn the camera round to the character's left.
        angles = [math.radians(a) for a in (0, 35, 90, 180)]
        spans = [((pts[:, 0] * math.cos(a) + pts[:, 1] * math.sin(a)).min(),
                  (pts[:, 0] * math.cos(a) + pts[:, 1] * math.sin(a)).max()) for a in angles]
        width = max(hi - lo for lo, hi in spans)
        cam_data.ortho_scale = max(z1 - z0, width * H / W) * 1.05
        for i, (a, (lo, hi)) in enumerate(zip(angles, spans)):
            c = (lo + hi) / 2
            cam.location = (10 * math.sin(a) + c * math.cos(a), -10 * math.cos(a) + c * math.sin(a), mid)
            cam.rotation_euler = (math.pi / 2, 0, a)
            panels.append(render_view(scene, tmp, 'body%d' % i, W, H))

    # Head close-ups: an 85 mm portrait from the front and three-quarters, at eye height.
    head = rig.data.bones['head']
    hz = (rig.matrix_world @ head.head_local).z
    target = Vector((0, -0.03, hz - 0.005))
    cam_data.type = 'PERSP'
    cam_data.lens = 85
    heads = []
    for i, deg in enumerate((0, 30)):
        a = math.radians(deg)
        cam.location = target + Vector((0.72 * math.sin(a), -0.72 * math.cos(a), 0.02))
        look_at(cam, target)
        heads.append(render_view(scene, tmp, 'head%d' % i, H // 2, H // 2))
    panels.append(np.concatenate(heads[::-1], axis=0))  # pixel rows run bottom-up
    sheet = np.concatenate(panels, axis=1)
    out = bpy.data.images.new('preview', width=sheet.shape[1], height=sheet.shape[0], alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.filepath_raw = path
    out.file_format = 'PNG'
    out.save()


def load_pixels(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def resize(px, w, h):
    # Box-filtered resize, good enough for a reference crop.
    img = bpy.data.images.new('tmp_resize', width=px.shape[1], height=px.shape[0], alpha=True)
    img.pixels.foreach_set(px.ravel())
    img.scale(w, h)
    out = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(out)
    bpy.data.images.remove(img)
    return out.reshape(h, w, 4)


def render_compare(spec, meshes, rig, L):
    """A head-and-shoulders render framed like a reference photo, side by side with it:
      ref        the reference image (path from the repo root)
      crop       [x0, y0, x1, y1] of the reference in pixels (top-left origin)
      out        where the side-by-side goes
      turn       degrees the camera goes round towards her left (the face turns to her right)
      pitch      degrees the camera looks down (0: level)
      eye_at     where her eyes come in the frame, as a fraction from the top
      top_at     where the top of her hair comes, as a fraction from the top
      lens       focal length (mm, 36 mm sensor)
      sky        [top, bottom] background colours (hex), a vertical gradient
      key, rim   light strengths"""
    scene = bpy.context.scene
    for o in [o for o in scene.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(o, do_unlink=True)
    ref = load_pixels(repo_path(spec['ref']))
    rh = ref.shape[0]
    x0, y0, x1, y1 = spec['crop']
    crop = ref[rh - y1:rh - y0, x0:x1]
    W = 640
    H = round(W * (y1 - y0) / (x1 - x0))
    crop = resize(crop, W, H)

    eye = (L['eye_l'] + L['eye_r']) / 2
    pts = mb.world_points(meshes)
    near_head = (np.abs(pts[:, 0]) < 0.15) & (pts[:, 2] > eye[2])
    top = float(pts[near_head, 2].max())
    fe, ft = spec.get('eye_at', 0.40), spec.get('top_at', 0.03)
    frame_h = (top - eye[2]) / (fe - ft)
    lens = spec.get('lens', 85)
    dist = frame_h * lens / 36 * max(1.0, H / W)
    centre_z = eye[2] + (fe - 0.5) * frame_h
    a = math.radians(spec.get('turn', 15)) * L['left'][0]
    pitch = math.radians(spec.get('pitch', 0))
    pivot = Vector((0, eye[1] + 0.08, centre_z))
    cam_data = bpy.data.cameras.new('CompareCam')
    cam_data.lens = lens
    cam_data.sensor_width = cam_data.sensor_height = 36
    cam_data.sensor_fit = 'VERTICAL' if H >= W else 'HORIZONTAL'
    cam = bpy.data.objects.new('CompareCam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    d = Vector((math.sin(a) * math.cos(pitch), -math.cos(a) * math.cos(pitch), math.sin(pitch)))
    cam.location = pivot + d * dist
    look_at(cam, pivot)

    # Soft frontal key from a little above the camera, a wide fill, a warm pink rim from behind.
    key_pos = pivot + Vector((math.sin(a) * 2.2, -2.2 * math.cos(a), 0.9))
    add_light('Key', 'AREA', key_pos, pivot, spec.get('key', 140), 2.5)
    add_light('Fill', 'AREA', pivot + Vector((-1.8 * L['left'][0], -1.6, -0.2)), pivot, spec.get('fill', 40), 3.0)
    rim = add_light('Rim', 'AREA', pivot + Vector((0.8 * L['left'][0], 1.6, 0.5)), pivot, spec.get('rim', 120), 1.5)
    rim.data.color = (1.0, 0.72, 0.75)

    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 64
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Khronos PBR Neutral'
    img = render_view(scene, tempfile.mkdtemp(), 'compare', W, H)
    scene.render.film_transparent = False

    top_c, bot_c = [np.array(hex_rgb(c)) for c in spec.get('sky', ['#e3a6c0', '#6f4f78'])]
    t = np.linspace(0, 1, H)[:, None, None]  # rows bottom-up: 0 is the bottom
    sky = bot_c * (1 - t) + top_c * t
    al = img[..., 3:4]
    comp = img[..., :3] * al + sky * (1 - al)
    comp = np.concatenate([comp, np.ones((H, W, 1), dtype=np.float32)], axis=2)
    gap = np.ones((H, 8, 4), dtype=np.float32)
    sheet = np.concatenate([crop, gap, comp.astype(np.float32)], axis=1)
    out = bpy.data.images.new('compare', width=sheet.shape[1], height=H, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    path = repo_path(spec['out'])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.filepath_raw = path
    out.file_format = 'PNG'
    out.save()


# --- the build ---------------------------------------------------------------------------------

def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not argv:
        raise SystemExit('usage: blender -b --python build_character.py -- <character.json> [--preview-only] [--head-only]')
    with open(argv[0], encoding='utf-8') as f:
        d = json.load(f)
    preview_only = '--preview-only' in argv or '--compare-only' in argv
    compare_only = '--compare-only' in argv
    name = d['name']
    max_tex = int(d.get('max_tex', 1024))
    tmpdir = tempfile.mkdtemp(prefix='char_')

    mb.clear_scene()
    info = human_info(d)
    if 'height_cm' in d['body']:
        mb.solve_height_macro(info, float(d['body']['height_cm']))
    basemesh, rig = mb.build(info)
    if d['body'].get('sculpt'):
        sculpt(basemesh, bpy.data.objects[name + '.' + d['eyes']['asset']], d['body']['sculpt'])
    height = mb.standing_height(basemesh)

    # MPFB names everything after the character: <name>.body, <name>.<asset folder>.
    parts = []  # (object, settings)
    for key in ('eyes', 'eyebrows', 'eyelashes', 'hair'):
        if d.get(key) and d[key].get('asset'):
            parts.append((bpy.data.objects[name + '.' + d[key]['asset']], d[key]))
    for c in d.get('clothes', []):
        parts.append((bpy.data.objects[name + '.' + c['asset']], c))
        if 'hem_cm' in c:
            uncover_below(basemesh, c['asset'], c['hem_cm'] / 100)

    body = basemesh
    if info['proxy']:
        body = mb.ObjectService.find_object_of_type_amongst_nearest_relatives(basemesh, 'Proxymeshes')
        bpy.data.objects.remove(basemesh, do_unlink=True)
    meshes = [body] + [o for o, _ in parts]
    for obj in meshes:
        mb.apply_modifiers(obj)
    eyes = next((o for o, p in parts if p is d.get('eyes')), None)
    L = landmarks(body, eyes, rig)
    for obj, part in parts:
        if 'hem_cm' in part:
            cut_hem(obj, part['hem_cm'] / 100)
        if 'delete_uv' in part or 'delete_where' in part:
            delete_faces(obj, part, L)
        if 'inflate' in part:
            # Pushes the part out along its normals (more volume for a hair asset).
            me = obj.data
            for v in me.vertices:
                v.co += v.normal * float(part['inflate'])
            me.update()
        decimate(obj, part.get('decimate'))
    decimate(body, d['body'].get('decimate'), d['body'].get('protect', 'head'))

    for g in d.get('garments', []):
        meshes += garments.build(g, name, rig, body, meshes, L, tmpdir)

    for obj in meshes:
        mb.limit_weights(obj)
    # Masks for texture edits, made from the geometry: the skin under the hair, and any a part
    # defines ("masks": {name: {"expr": ..., "size": px, "blur": px}}, see mask_weights).
    hair_part = next((o for o, p in parts if p is d.get('hair')), None)
    if hair_part is not None:
        UV_MASKS['under_hair'] = uv_mask(body, under_hair_weights(body, hair_part), 1024)
    for obj, part in [(body, d.get('skin', {}))] + parts:
        for mname, spec in part.get('masks', {}).items():
            UV_MASKS[mname] = uv_mask(obj, mask_weights(obj, spec, L), int(spec.get('size', 1024)), spec.get('blur', 3))
    set_material(body, d.get('skin', {}), max_tex, tmpdir)
    for obj, part in parts:
        set_material(obj, part, max_tex, tmpdir)
    mb.material_alpha(meshes, 'clip')

    report = {
        'name': name,
        'height_cm': round(height * 100, 1),
        'phenotype': info['phenotype'],
        'meshes': {o.name: mb.triangles(o) for o in meshes},
        'triangles': sum(mb.triangles(o) for o in meshes),
        'textures': {k: '%dx%d %s' % v for k, v in _done_images.items()},
    }
    print('CHARACTER_REPORT ' + json.dumps(report))
    if d.get('out') and not preview_only:
        mb.export_glb(repo_path(d['out']), rig, meshes)
        print('CHARACTER_GLB %s %.2f MB' % (d['out'], os.path.getsize(repo_path(d['out'])) / 1e6))
    if d.get('compare') and '--no-compare' not in argv:
        render_compare(d['compare'], meshes, rig, L)
    if d.get('preview') and not compare_only:
        render_preview(repo_path(d['preview']), meshes, rig, head_only='--head-only' in argv)
    if '--view' in argv:
        # A close look from anywhere, for checking a detail: --view x,y,z,tx,ty,tz out.png
        v = [float(x) for x in argv[argv.index('--view') + 1].split(',')]
        cam = bpy.context.scene.camera
        if cam is None:
            cam = bpy.data.objects.new('ViewCam', bpy.data.cameras.new('ViewCam'))
            bpy.context.scene.collection.objects.link(cam)
            bpy.context.scene.camera = cam
        cam.data.type = 'PERSP'
        cam.data.lens = 50
        cam.location = v[:3]
        look_at(cam, v[3:6])
        img = render_view(bpy.context.scene, tempfile.mkdtemp(), 'view', 900, 900)
        out = bpy.data.images.new('view', width=900, height=900, alpha=False)
        out.pixels.foreach_set(img.ravel())
        out.filepath_raw = argv[argv.index('--view') + 2]
        out.file_format = 'PNG'
        out.save()


if __name__ == '__main__':
    main()
