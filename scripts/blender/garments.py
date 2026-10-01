"""Garments modelled in bpy, for what no free MakeHuman asset covers well: a maid's apron and a
frilled headband (katyusha). Built in the character's rest pose (A-pose, facing -Y, Z up) on top of
the finished clothes, by casting rays at them, so they follow whatever body and dress they're
given; then weighted to the rig from what they lie on.

In a character definition ("garments": [...]):
  {"type": "apron", "over": ["<asset>", ...], "color": "#f4f2ee", ...}
      a skirt panel from the waist to just above the skirt's hem, a bib, a waistband, shoulder
      straps over to the back and a bow there, frills along the panel's and the bib's edges.
      "over" names the clothes it lies on (the dress first); sizes in metres can be overridden:
      skirt_top_w, skirt_bottom_w (half-widths), skirt_above_hem, bib_top_w, bib_bottom_w,
      bib_above_bust, frill, strap_x, strap_w, roughness
  {"type": "headband", "on": "<hair asset>", "color": "#f4f2ee", "band_color": "#141416", ...}
      a thin band over the head from ear to ear, a little in front of the crown, with a gathered
      lace frill standing up along it; tilt (degrees forward), frill, roughness
  {"type": "hair_cards", "on": "<hair asset>", "fringe": {...}, "locks": {...}, ...}
      alpha-card hair over a base hair asset: a wispy fringe and long side locks, with a strand
      texture made here (see build_hair_cards)
Everything is single-sided with double-sided materials; only the hair cards have a texture.
"""
import math

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

FRONT = Vector((0, -1, 0))  # characters face -Y in Blender


def hex_rgb(c):
    c = c.lstrip('#')
    srgb = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # Material colours are linear.
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in srgb] + [1.0]


class Surface:
    """A ray-castable union of meshes in world space (evaluated, so as they show)."""

    def __init__(self, objs):
        dg = bpy.context.evaluated_depsgraph_get()
        verts, polys = [], []
        for o in objs:
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            m = o.matrix_world
            base = len(verts)
            verts += [m @ v.co for v in me.vertices]
            polys += [[base + i for i in p.vertices] for p in me.polygons]
            ev.to_mesh_clear()
        self.verts = np.array([tuple(v) for v in verts])
        self.bvh = BVHTree.FromPolygons(verts, polys)

    def cast(self, origin, direction, dist=3.0):
        loc, nrm, _, _ = self.bvh.ray_cast(Vector(origin), Vector(direction).normalized(), dist)
        return (loc, nrm) if loc is not None else (None, None)

    def front_y(self, x, z):
        loc, _ = self.cast((x, -2.0, z), (0, 1, 0))
        return loc.y if loc is not None else None


class MeshOut:
    def __init__(self):
        self.verts, self.faces, self.mats = [], [], []

    def add_grid(self, rows, mat, flip=False):
        # rows: list of lists of points (all the same length); quads between neighbours.
        base = len(self.verts)
        n = len(rows[0])
        for r in rows:
            self.verts += [tuple(p) for p in r]
        for j in range(len(rows) - 1):
            for i in range(n - 1):
                a, b = base + j * n + i, base + j * n + i + 1
                c, d = b + n, a + n
                self.faces.append((a, d, c, b) if flip else (a, b, c, d))
                self.mats.append(mat)

    def build(self, name, materials):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        for m in materials:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', self.mats)
        me.polygons.foreach_set('use_smooth', [True] * len(self.faces))
        me.update()
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        # A planar UV so the exporter writes TEXCOORD_0 and the mesh can take a texture later.
        uv = me.uv_layers.new(name='UVMap')
        co = np.array(self.verts)
        loops = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get('vertex_index', loops)
        lo, hi = co.min(axis=0), co.max(axis=0)
        u = (co[loops, 0] - lo[0]) / max(hi[0] - lo[0], 1e-6)
        v = (co[loops, 2] - lo[2]) / max(hi[2] - lo[2], 1e-6)
        uv.data.foreach_set('uv', np.stack([u, v], axis=1).ravel())
        return obj


def material(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = hex_rgb(color)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    mat.use_backface_culling = False
    return mat


def front_hull(xs, ys):
    """The fabric's line across a row: the front-most (lowest y) convex envelope of the surface
    points, so cloth bridges hollows (between the breasts, between the legs) instead of
    following them in."""
    pts = sorted(zip(xs, ys))
    hull = []
    for p in pts:
        # Lower hull in (x, y): keeps the envelope on the -Y side.
        while len(hull) >= 2:
            (x1, y1), (x2, y2) = hull[-2], hull[-1]
            if (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1) <= 0:
                hull.pop()
            else:
                break
        hull.append(p)
    hx, hy = zip(*hull)
    return np.interp(xs, hx, hy)


def panel(surface, z_top, z_bottom, w_top, w_bottom, nx, nz, offset):
    """A front panel from z_top down to z_bottom, half-width eased between w_top and w_bottom,
    laid over the surface. Returns rows (top to bottom) of points."""
    rows = []
    for j in range(nz):
        t = j / (nz - 1)
        z = z_top + (z_bottom - z_top) * t
        w = w_top + (w_bottom - w_top) * t
        xs = np.linspace(-w, w, nx)
        ys = []
        for x in xs:
            y = surface.front_y(x, z)
            ys.append(y if y is not None else (ys[-1] if ys else 0.0))
        ys = front_hull(xs, ys) - offset
        rows.append([Vector((x, y, z)) for x, y in zip(xs, ys)])
    # Down each column too: the cloth hangs straight over a hollow below a bulge.
    for i in range(nx):
        zs = [r[i].z for r in rows]
        ys = [r[i].y for r in rows]
        env = front_hull(list(-np.array(zs)), ys)
        for r, y in zip(rows, env):
            r[i].y = min(r[i].y, y)
    return rows


def resample(points, step):
    pts = [Vector(p) for p in points]
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(seg)
    n = max(2, int(total / step) + 1)
    out, i, acc = [], 0, 0.0
    for k in range(n):
        s = total * k / (n - 1)
        while i < len(seg) - 1 and acc + seg[i] < s:
            acc += seg[i]
            i += 1
        f = (s - acc) / seg[i] if seg[i] > 0 else 0
        out.append(pts[i].lerp(pts[i + 1], min(max(f, 0), 1)))
    return out


def frill(mesh, edge, out_dirs, normals, width, mat, wave=0.02, amp=None, rows=3, flip=False):
    """A gathered frill along an edge: a strip leaving the edge along out_dirs, pleated back and
    forth along the normals (more towards its free edge, as gathered cloth fans out)."""
    amp = amp if amp is not None else width * 0.18
    s = 0.0
    grid = [[] for _ in range(rows)]
    for k, p in enumerate(edge):
        if k:
            s += (edge[k] - edge[k - 1]).length
        ph = math.sin(2 * math.pi * s / wave)
        for r in range(rows):
            t = r / (rows - 1)
            grid[r].append(p + out_dirs[k] * (width * t) + normals[k] * (amp * ph * (0.25 + 0.75 * t) + 0.002))
    mesh.add_grid(grid, mat, flip)


def edge_dirs(edge):
    out = []
    for k in range(len(edge)):
        a = edge[max(k - 1, 0)]
        b = edge[min(k + 1, len(edge) - 1)]
        out.append((b - a).normalized())
    return out


def convex_path(points2d):
    """Outer convex hull of 2-D points (monotone chain), counter-clockwise."""
    pts = sorted(set(points2d))

    def half(seq):
        h = []
        for p in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(p)
        return h
    lower, upper = half(pts), half(reversed(pts))
    return lower[:-1] + upper[:-1]


def object_by_asset(name, asset):
    return bpy.data.objects[name + '.' + asset]


def landmarks(dress, body):
    """Waist height (the dress's narrowest front-to-side girth between hips and chest) and bust
    (its most forward point), from the dress's vertices."""
    co = Surface([dress]).verts
    torso = co[np.abs(co[:, 0]) < 0.2]
    z_lo, z_hi = np.percentile(torso[:, 2], 20), np.percentile(torso[:, 2], 90)
    best = None
    for z in np.linspace(z_lo, z_hi, 60):
        sl = torso[np.abs(torso[:, 2] - z) < 0.008]
        if len(sl) < 6:
            continue
        w = sl[:, 0].max() - sl[:, 0].min() + (sl[:, 1].max() - sl[:, 1].min())
        if best is None or w < best[0]:
            best = (w, z)
    waist = best[1]
    upper = torso[(torso[:, 2] > waist + 0.05) & (np.abs(torso[:, 0]) < 0.12)]
    bust = upper[np.argmin(upper[:, 1])]
    return waist, float(bust[2])


def transfer_weights(obj, sources, rig):
    # Weights from what the garment lies on: a temporary joined copy of the sources, data
    # transfer by nearest face (interpolated), then skinned to the rig.
    copies = []
    for s in sources:
        c = s.copy()
        c.data = s.data.copy()
        c.modifiers.clear()
        bpy.context.scene.collection.objects.link(c)
        copies.append(c)
    bpy.ops.object.select_all(action='DESELECT')
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    if len(copies) > 1:
        bpy.ops.object.join()
    src = bpy.context.view_layer.objects.active
    mod = obj.modifiers.new('Weights', 'DATA_TRANSFER')
    mod.object = src
    mod.use_vert_data = True
    mod.data_types_verts = {'VGROUP_WEIGHTS'}
    mod.vert_mapping = 'POLYINTERP_NEAREST'
    mod.layers_vgroup_select_src = 'ALL'
    mod.layers_vgroup_select_dst = 'NAME'
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.datalayout_transfer(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bones = {b.name for b in rig.data.bones}
    for vg in list(obj.vertex_groups):
        if vg.name not in bones:
            obj.vertex_groups.remove(vg)
    me = src.data
    bpy.data.objects.remove(src, do_unlink=True)
    bpy.data.meshes.remove(me)
    skin_to(obj, rig)


def skin_to(obj, rig):
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig


def build_apron(g, name, rig, body):
    over = [object_by_asset(name, a) for a in g['over']]
    dress = over[0]
    surf = Surface(over)
    waist, bust = landmarks(dress, body)
    hem = min(float(o_co[:, 2].min()) for o_co in [Surface([o]).verts for o in over])
    white = material(name + '.apron', g.get('color', '#f4f2ee'), g.get('roughness', 0.9))
    mesh = MeshOut()
    off = 0.007
    fr = g.get('frill', 0.035)

    # The skirt panel, waist to a little above the dress's hem, flaring with the skirt.
    sk_bottom = hem + g.get('skirt_above_hem', 0.05)
    rows = panel(surf, waist, sk_bottom, g.get('skirt_top_w', 0.12), g.get('skirt_bottom_w', 0.16), 15, 18, off)
    mesh.add_grid(rows, 0)
    # Frills: down from the bottom edge (continuing the panel's slope), out along both sides.
    bottom = resample(rows[-1], 0.005)
    down = (rows[-1][len(rows[-1]) // 2] - rows[-2][len(rows[-1]) // 2]).normalized()
    frill(mesh, bottom, [down] * len(bottom), [FRONT] * len(bottom), fr, 0)
    for side, idx in ((-1, 0), (1, -1)):
        # From a little below the waist, so the frill doesn't stick out past the waistband.
        edge = resample([r[idx] for r in rows[2:]], 0.005)
        out = [Vector((side, 0, 0))] * len(edge)
        nrm = [FRONT] * len(edge)
        frill(mesh, edge, out, nrm, fr * 0.8, 0, flip=side > 0)

    # The bib, from the waist up over the bust, its top edge frilled.
    bib_top = bust + g.get('bib_above_bust', 0.07)
    bib = panel(surf, bib_top, waist + 0.005, g.get('bib_top_w', 0.075), g.get('bib_bottom_w', 0.09), 11, 12, off)
    mesh.add_grid(bib, 0)
    top = resample(bib[0], 0.005)
    up = (bib[0][5] - bib[1][5]).normalized()
    frill(mesh, top, [up] * len(top), [FRONT] * len(top), fr * 0.7, 0, flip=True)
    for side, idx in ((-1, 0), (1, -1)):
        edge = resample([r[idx] for r in bib], 0.005)
        frill(mesh, edge, [Vector((side, 0, 0))] * len(edge), [FRONT] * len(edge), fr * 0.6, 0, flip=side > 0)

    # The waistband, all the way round.
    ring_c = Vector((0, float(np.mean(surf.verts[np.abs(surf.verts[:, 2] - waist) < 0.01][:, 1])), waist))
    band = []
    for h in (0.018, -0.018):
        ring = []
        for k in range(73):
            a = 2 * math.pi * k / 72
            d = Vector((math.sin(a), -math.cos(a), 0))
            loc, _ = surf.cast(ring_c + d * 0.6 + Vector((0, 0, h)), -d)
            p = loc if loc is not None else ring_c + d * 0.15
            ring.append(p + d * (off + 0.002))
        band.append(ring)
    mesh.add_grid(band, 0)
    back = band[0][36].lerp(band[1][36], 0.5)

    # Straps from the bib's top corners over the shoulders down to the waistband at the back:
    # a convex path round the torso's slice at that x, so it bridges the collarbone's hollow.
    sx, sw = g.get('strap_x', 0.07), g.get('strap_w', 0.013)
    for side in (-1, 1):
        x = side * sx
        # Rays in the planes of both edges and the middle: the hull of all of them keeps the
        # whole width of the strap outside the cloth (shoulder blades bulge sideways).
        pts = []
        for xx in (x - sw, x, x + sw):
            cc = Vector((xx, ring_c.y, bust))
            for k in range(-30, 271, 2):
                a = math.radians(k)
                d = Vector((0, -math.cos(a), math.sin(a)))
                loc, _ = surf.cast(cc + d * 0.6, -d)
                if loc is not None:
                    pts.append((-loc.y, loc.z))
        hull = convex_path(pts)
        # Walk the hull round the slice's centre from the bib's top on the front, up over the
        # shoulder and down the back to the waistband.
        uc = -ring_c.y

        def ang(p):
            return math.atan2(p[1] - bust, p[0] - uc) % (2 * math.pi)
        keep = [p for p in hull if ang(p) < math.radians(300)
                and not (p[0] > uc and p[1] < bib_top) and not (p[0] <= uc and p[1] < waist + 0.03)]
        keep.sort(key=ang)
        path = [Vector((x, -u, v)) for u, v in keep]
        path = resample([bib[0][0 if side < 0 else -1]] + path + [Vector((x, back.y, waist + 0.01))], 0.01)
        # The path's own outward normal (in its plane, away from the slice's centre), then each
        # point pushed out until the strap's whole width clears the cloth under it.
        so = off + 0.003
        nrm = []
        for k, p in enumerate(path):
            t = path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]
            n = Vector((0, -t.z, t.y)).normalized()
            if n.dot(Vector((0, p.y - ring_c.y, p.z - (bust - 0.1)))) < 0:
                n = -n
            nrm.append(n)
        for k, (p, n) in enumerate(zip(path, nrm)):
            push = 0.0
            for dx in (-sw, 0, sw):
                q = p + Vector((dx, 0, 0))
                loc, _ = surf.cast(q + n * 0.3, -n)
                if loc is not None:
                    push = max(push, (loc - q).dot(n))
            path[k] = p + n * (push + so)
        strip = [[p + Vector((-sw, 0, 0)) for p in path], [p + Vector((sw, 0, 0)) for p in path]]
        mesh.add_grid(strip, 0, flip=side > 0)
        # A frill along the strap's outer edge over the shoulder ("wings").
        over_sh = [p + Vector((side * sw, 0, 0)) for p in path if p.z > bib_top - 0.02 and p.y < ring_c.y]
        if len(over_sh) > 3:
            edge = resample(over_sh, 0.004)
            out = [Vector((side, 0, -0.35)).normalized()] * len(edge)
            nn = [Vector((0, 0, 1))] * len(edge)
            frill(mesh, edge, out, nn, fr * 0.6, 0, wave=0.014, amp=0.003, flip=side > 0)

    # The bow at the back: two loops and two tails. A loop is the ribbon run out sideways and
    # folded back on itself (so its face shows from behind), fanning wider at the fold.
    bw = 0.03
    for side in (-1, 1):
        lo, hi = [], []
        for k in range(25):
            a = 2 * math.pi * k / 24
            reach = 0.5 - 0.5 * math.cos(a)  # 0 at the knot, 1 at the fold
            p = back + Vector((side * 0.075 * reach, 0.016 + 0.009 * math.sin(a), 0))
            half = bw * (0.35 + 0.6 * reach)
            lo.append(p - Vector((0, 0, half)))
            hi.append(p + Vector((0, 0, half)))
        mesh.add_grid([lo, hi], 0, flip=side > 0)
        tail = [back + Vector((side * (0.01 + 0.05 * t), 0.012 + 0.01 * t, -0.24 * t)) for t in np.linspace(0, 1, 12)]
        mesh.add_grid([[p + Vector((-bw * 0.6, 0, 0)) for p in tail], [p + Vector((bw * 0.6, 0, 0)) for p in tail]], 0, flip=side > 0)
    knot = []
    for h in (-0.018, 0.018):
        knot.append([back + Vector((0.015 * math.sin(2 * math.pi * k / 12), 0.012 - 0.012 * math.cos(2 * math.pi * k / 12), h)) for k in range(13)])
    mesh.add_grid(knot, 0)

    obj = mesh.build(name + '.apron', [white])
    transfer_weights(obj, over, rig)
    return obj


def build_headband(g, name, rig, body):
    hair = object_by_asset(name, g['on'])
    surf = Surface([hair, body])
    co = Surface([body]).verts
    head = co[np.abs(co[:, 0]) < 0.12]
    top = float(head[:, 2].max())
    crown = head[head[:, 2] > top - 0.02]
    c = Vector((0, float(crown[:, 1].mean()) - 0.005, top - 0.105))
    tilt = math.radians(g.get('tilt', 6))
    up = Vector((0, -math.sin(tilt), math.cos(tilt)))
    side = Vector((1, 0, 0))
    n = side.cross(up).normalized()  # the band's width direction, roughly front-to-back
    path, angs = [], []
    for k in range(-44, 45):
        a = math.radians(k * 2)
        d = (up * math.cos(a) + side * math.sin(a)).normalized()
        loc, _ = surf.cast(c + d * 0.4, -d)
        if loc is None:
            continue
        path.append(loc + d * 0.004)
        angs.append(abs(k * 2))
    w = 0.006
    band_mat = material(name + '.headband', g.get('band_color', '#141416'), g.get('roughness', 0.85))
    lace = material(name + '.headband_lace', g.get('color', '#f4f2ee'), g.get('roughness', 0.9))
    mesh = MeshOut()
    mesh.add_grid([[p - n * w for p in path], [p + n * w for p in path]], 0)
    # The lace frill stands up from the band's front edge, gathered.
    # Only over the top of the head; the band's ends go on behind the ears bare.
    edge = resample([p - n * w * 0.5 for p, a in zip(path, angs) if a <= 66], 0.003)
    outs_r = []
    for p in edge:
        d = (p - c).normalized()
        outs_r.append(d)
    frill(mesh, edge, outs_r, [n] * len(edge), g.get('frill', 0.018), 1, wave=0.011, amp=0.0035)
    obj = mesh.build(name + '.headband', [band_mat, lace])
    # All on the head bone: it never bends.
    vg = obj.vertex_groups.new(name='head')
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    skin_to(obj, rig)
    return obj


# --- hair cards ----------------------------------------------------------------------------------

def catmull(points, sub):
    """A Catmull-Rom curve through points (ends repeated), `sub` samples a span."""
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(sub):
            t = s / sub
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(points[-1])
    return out


def strand_texture(name, tmpdir, color, w=128, h=512, seed=1, density=1.0, underlayer=True):
    """A strip of hair strands for alpha cards: v runs from the root (bottom row, v=0) to the tip.
    The strands gather into tufts that narrow to a point where they end, as hair does when it
    clumps, with gaps between the tufts that widen towards the tip, so the ends are wispy and
    see-through. Strands are a few texels wide (finer ones vanish once the texture is minified
    and clipped) and vary in tone."""
    rng = np.random.default_rng(seed)
    v = np.linspace(0, 1, h)[:, None]
    u = np.arange(w)[None, :]
    alpha = np.zeros((h, w), dtype=np.float32)
    tone = np.zeros((h, w), dtype=np.float32)
    for c in range(max(1, int(w / 10 * density))):
        cx = rng.uniform(0, w)
        cw = rng.uniform(6, 14)
        end = rng.uniform(0.6, 1.0)
        bend = rng.normal(0, 4)
        for s in range(int(rng.integers(4, 8))):
            off = rng.uniform(-0.5, 0.5) * cw
            # Each strand runs from its place in the tuft's root towards the tuft's point.
            conv = np.clip(v / end, 0, 1) ** 1.5
            x = cx + off * (1 - 0.85 * conv) + bend * v * v + 0.5 * np.sin(v * rng.uniform(4, 10) + rng.uniform(0, 6.3))
            width = rng.uniform(1.6, 2.4) * (1 - 0.4 * conv)
            s_end = end * rng.uniform(0.85, 1.0)
            taper = np.clip((s_end - v) / 0.08, 0, 1)
            cov = np.clip(width / 2 + 0.5 - np.abs(u - x), 0, 1) * taper
            alpha = np.maximum(alpha, cov)
            tone = np.maximum(tone, cov * rng.uniform(0, 1))
    # A dense underlayer at the root end, so cards don't show the scalp where they start.
    if underlayer:
        alpha = np.maximum(alpha, np.clip((0.25 - v) / 0.15, 0, 1) * 0.9)
    col = np.array(color[:3], dtype=np.float32)
    rgb = np.clip(col[None, None, :] * (0.8 + 0.6 * tone[..., None]) + 0.03 * tone[..., None], 0, 1)
    px = np.concatenate([rgb, alpha[..., None]], axis=2)
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    img.pixels.foreach_set(px.astype(np.float32).ravel())
    import os
    path = os.path.join(tmpdir, name + '.png')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.source = 'FILE'
    img.reload()
    return img


def join_textures(name, tmpdir, imgs):
    # Side by side, one image (one material for all the cards).
    arrs = []
    for im in imgs:
        a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        arrs.append(a.reshape(im.size[1], im.size[0], 4))
    h = max(a.shape[0] for a in arrs)
    px = np.concatenate(arrs, axis=1) if all(a.shape[0] == h for a in arrs) else None
    assert px is not None, 'strand textures must be the same height'
    img = bpy.data.images.new(name, width=px.shape[1], height=px.shape[0], alpha=True)
    img.pixels.foreach_set(px.ravel())
    import os
    img.filepath_raw = os.path.join(tmpdir, name + '.png')
    img.file_format = 'PNG'
    img.save()
    img.source = 'FILE'
    img.reload()
    for im in imgs:
        bpy.data.images.remove(im)
    return img


def card_material(name, img, roughness, specular):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = specular
    bsdf.inputs['Metallic'].default_value = 0.0
    mat.use_backface_culling = False
    return mat


class CardMesh:
    def __init__(self):
        self.verts, self.faces, self.uvs = [], [], []

    def ribbon(self, path, sides, width, u0, u1, flip=False):
        # A strip along `path` (root first), `sides` the unit vectors across it at each point;
        # width can taper (a list), u0..u1 the slice of the strand texture it shows.
        n = len(path)
        base = len(self.verts)
        for k, (p, s) in enumerate(zip(path, sides)):
            wk = width[k] if isinstance(width, (list, tuple)) else width
            self.verts += [tuple(p - s * wk / 2), tuple(p + s * wk / 2)]
        for k in range(n - 1):
            a, b, c, d = base + 2 * k, base + 2 * k + 1, base + 2 * k + 3, base + 2 * k + 2
            self.faces.append((a, d, c, b) if flip else (a, b, c, d))
            v0, v1 = k / (n - 1), (k + 1) / (n - 1)
            uv = {a: (u0, v0), b: (u1, v0), c: (u1, v1), d: (u0, v1)}
            self.uvs.append([uv[i] for i in self.faces[-1]])

    def build(self, name, mat):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.materials.append(mat)
        me.polygons.foreach_set('use_smooth', [True] * len(self.faces))
        uv = me.uv_layers.new(name='UVMap')
        flat = [c for face in self.uvs for corner in face for c in corner]
        uv.data.foreach_set('uv', flat)
        me.update()
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def build_hair_cards(g, name, rig, body, meshes, L, tmpdir):
    """Alpha-card hair over a base hair asset: a wispy fringe and long side locks.
      "on": the base hair asset (its surface is what the roots lie on)
      "color", "roughness", "specular"
      "fringe": {"density" (of strands), "texels" (the strand texture's width: fewer, wider tufts), "count", "spread" (degrees each side of the front), "part" (degrees the strands
                 fan away from the centre parting), "root" (elevation of the roots, degrees above
                 the eyes seen from the head's centre), "tip" (metres above the eyes where they
                 end), "width", "offset", "layers"}
      "locks":  {"count" (a side), "from" (degrees round from the front where the first starts),
                 "root" (their roots' elevation), "length" (metres below the eyes where they end),
                 "spread" (how far out they hang, metres), "width", "out" (metres in front of
                 the body)}"""
    rng = np.random.default_rng(int(g.get('seed', 7)))
    base_hair = bpy.data.objects[name + '.' + g['on']]
    head = Surface([body, base_hair])
    skin = Surface([body] + [o for o in meshes if o is not base_hair and 'hair' not in o.name.lower()])
    eye = (Vector(L['eye_l']) + Vector(L['eye_r'])) / 2
    left = float(L['left'][0])
    c = Vector((0, eye.y + 0.075, eye.z + 0.01))
    hexc = g.get('color', '#0e0c0c').lstrip('#')
    col = [int(hexc[i:i + 2], 16) / 255 for i in (0, 2, 4)]  # texture pixels are sRGB-encoded
    # Two strand textures side by side in one image: sparse (the fringe, see-through) on the
    # left half, dense (the locks, a mass of hair with wisps at the edges) on the right.
    # The fringe's texture is narrower, so its tufts are wider on the card: a fringe is seen
    # close up, across the face, where single strands would break up into aliasing.
    sparse = strand_texture(name + '_s1', tmpdir, col, w=int(g.get('fringe', {}).get('texels', 64)), seed=int(g.get('seed', 7)),
                            density=g.get('fringe', {}).get('density', 0.65), underlayer=False)
    dense = strand_texture(name + '_s2', tmpdir, col, seed=int(g.get('seed', 7)) + 1, density=g.get('locks', {}).get('density', 1.4))
    img = join_textures(name + '_strands', tmpdir, [sparse, dense])
    mat = card_material(name + '.hair_cards', img, g.get('roughness', 0.45), g.get('specular', 0.5))
    cm = CardMesh()

    def dirn(phi, theta):
        return Vector((math.sin(phi) * math.cos(theta) * left, -math.cos(phi) * math.cos(theta), math.sin(theta)))

    def on_head(phi, theta, off):
        d = dirn(phi, theta)
        loc, _ = head.cast(c + d * 0.5, -d)
        if loc is None:
            return None
        return loc + (loc - c).normalized() * off

    # The fringe: strips from roots up on the crown, over the hairline and down the forehead to
    # the brows, fanning a little away from a centre parting.
    fr = g.get('fringe')
    if fr:
        spread = math.radians(fr.get('spread', 50))
        part = math.radians(fr.get('part', 10))
        root = math.radians(fr.get('root', 60))
        n = int(fr.get('count', 16))
        tip_z = eye.z + fr.get('tip', 0.012)
        for layer in range(int(fr.get('layers', 2))):
            for i in range(n):
                phi0 = -spread + 2 * spread * (i + 0.5 * layer + rng.uniform(-0.2, 0.2)) / n
                side = 1 if phi0 >= 0 else -1
                # Longer and swept further out towards the temples, where fringe meets side locks.
                outer = abs(phi0) / spread
                tz = tip_z - 0.014 * outer ** 2 + rng.uniform(-0.007, 0.005)
                path = []
                for k in range(24):
                    t = k / 23
                    phi = phi0 + side * part * t * (0.6 + 0.4 * outer)
                    theta = root + (math.radians(-12) - root) * t
                    # Roots start under the base hair's surface and come out at the hairline.
                    off = fr.get('offset', 0.005) + 0.002 * layer
                    off = -0.004 + (off + 0.004) * min(1.0, t / 0.35)
                    p = on_head(phi, theta, off)
                    if p is None:
                        continue
                    path.append(p)
                    if p.z < tz:
                        break
                if len(path) < 4:
                    continue
                path = resample(path, 0.006)
                sides = []
                for k, p in enumerate(path):
                    tang = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
                    sides.append(tang.cross((p - c).normalized()).normalized())
                w = fr.get('width', 0.024) * rng.uniform(0.85, 1.15)
                widths = [w * (1 - 0.4 * j / len(path)) for j in range(len(path))]
                # The fringe's texture is the left part of the image (its texels of texels + 128).
                fw = fr.get('texels', 64) / (fr.get('texels', 64) + 128)
                u0 = rng.uniform(0, fw / 2)
                cm.ribbon(path, sides, widths, u0, u0 + fw / 2)

    # Side locks: from the temple down beside the cheek and jaw, a little out from the face, then
    # hanging straight down in front of the shoulders. Each lock is a smooth curve through points
    # found by casting at the face and body, so it follows the face it's given.
    lk = g.get('locks')
    if lk:
        n = int(lk.get('count', 4))
        end_z = eye.z - lk.get('length', 0.38)
        chin = Vector(L['chin']) if 'chin' in L else Vector((0, eye.y, eye.z - 0.09))

        def side_hit(sx, y, z, off):
            # The face's edge at height z, seen from the side at depth y, pushed out by off.
            hit, _ = skin.cast((sx * 0.4, y, z), (-sx, 0, 0))
            return Vector((hit.x + sx * off, y, z)) if hit is not None else None

        def front_y(x, z, off):
            hit, _ = skin.cast((x, -1.0, z), (0, 1, 0))
            return hit.y - off if hit is not None else None

        for sgn in (-1, 1):
            sx = sgn * left  # world x sign of this side
            for i in range(n):
                k = i / max(n - 1, 1)  # 0: the front lock, 1: the back one
                dy = lk.get('depth', 0.02) + 0.03 * k + rng.uniform(-0.004, 0.004)
                ctrl = []
                p0 = on_head(sgn * math.radians(lk.get('from', 62) + 22 * k), math.radians(lk.get('root', 28)), 0.004)
                if p0 is not None:
                    ctrl.append(p0)
                for z, off in ((eye.z - 0.025, 0.006 + 0.01 * k), (eye.z - 0.06, 0.008 + 0.012 * k),
                               (chin.z + 0.005, 0.012 + 0.014 * k)):
                    q = side_hit(sx, eye.y + dy, z, off)
                    if q is not None:
                        ctrl.append(q)
                if len(ctrl) < 3:
                    continue
                last = ctrl[-1]
                z = last.z
                x = last.x
                xs_end = sx * (lk.get('spread', 0.10) + 0.02 * k)
                while z > end_z:
                    z -= 0.03
                    f = min(1.0, (last.z - z) / 0.12)
                    xx = x + (xs_end - x) * f
                    y = front_y(xx, z, lk.get('out', 0.012) + 0.01 * k)
                    y = min(last.y, y) if y is not None else last.y
                    ctrl.append(Vector((xx, y + 0.012 * k, z)))
                path = resample(catmull(ctrl, 6), 0.008)
                sides = []
                for j, p in enumerate(path):
                    tang = (path[min(j + 1, len(path) - 1)] - path[max(j - 1, 0)]).normalized()
                    facing = Vector((0.35 * sx, -1, 0)).normalized()
                    sides.append(tang.cross(facing).normalized())
                wl = lk.get('width', 0.03) * rng.uniform(0.85, 1.15)
                widths = [wl * (0.6 + 0.4 * min(1, j / 6)) * (1 - 0.3 * j / len(path)) for j in range(len(path))]
                fw = g.get('fringe', {}).get('texels', 64) / (g.get('fringe', {}).get('texels', 64) + 128)
                u0 = rng.uniform(fw, 1 - 0.3 * (1 - fw))
                cm.ribbon(path, sides, widths, u0, u0 + 0.3 * (1 - fw))

    obj = cm.build(name + '.hair_cards', mat)
    transfer_weights(obj, [body], rig)
    return obj


def build(g, name, rig, body, meshes, L=None, tmpdir=None):
    if g['type'] == 'apron':
        return [build_apron(g, name, rig, body)]
    if g['type'] == 'headband':
        return [build_headband(g, name, rig, body)]
    if g['type'] == 'hair_cards':
        return [build_hair_cards(g, name, rig, body, meshes, L, tmpdir)]
    raise SystemExit('Unknown garment ' + g['type'])
