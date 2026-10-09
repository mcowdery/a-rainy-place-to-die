"""A shape from the Pixal3D worker given its own picture as colour, laid on through the camera the worker returned.

  "<blender.exe>" -b --python scripts/blender/project_picture.py -- <mesh.glb> <camera.json> <cutout.png> <out.glb>
        [--tris 30000] [--voxel 0.004] [--tex 2048] [--arms-out 0.17] [--cut-x 0.15] [--cut-arms 0.125] [--carve 4] [--normal 0] [--close 1] [--smooth 1] [--surface wrapped.glb] [--view <yaw>:<picture> ...]

`mesh.glb`, `camera.json` and `cutout.png` are what scripts/props/mesh_endpoint.mjs --engine pixal3d writes (the mesh
is best put through scripts/blender/orient_faces.py first). Pixal3D builds the mesh in the picture's own camera frame
(+y up, +x the picture's right, the pictured side towards +z, the camera at z = distance looking down -z), so a point
(x, y, z) falls at the pixel (cx + f x / (d - z), cy - f y / (d - z)) of the cut-out, and nothing has to be found by
matching outlines (scripts/blender/prop_from_mesh.py does that, and put the face a little low).

What it makes, the way the rest of this repository makes a figure (one mesh, one material, a JPEG colour map and a PNG
normal map): a clean stand-in for the shape (voxel remeshed, so a single watertight skin however tangled the generated
surface is, then reduced and unwrapped), the shape's own surface baked onto it as a normal map, and the picture's colour
for every texel that faces the camera and isn't hidden behind something nearer. Texels the picture doesn't reach (the
sides turning away, the back) take the colour of the nearest texel it does, by distance in space, blended in over the
turn: plain but the same object's. The solid is first cut to the front picture's own outline (`--carve 4`, a margin in pixels,
`--carve -1` off): the extra arms of a T-pose a shape can carry, and stray hair, fall outside it. `--cut-arms 0.125` finds the straight-out arms by itself and takes them off, roots
included (the better way). `--cut-x 0.15` deletes the geometry further than that from the middle before anything
else (the extra arms of a T-pose a shape can carry beside the hanging ones). `--arms-out 0.17` leaves the pictures out of everything further than that from the
middle (in the mesh's own units, about 0.88 for the whole figure): for a shape whose arms stick out where the pictures
have them hanging.

More pictures of the same figure in the same pose improve what the front one can't reach: `--view 180:back.png`, `--view 90:side.png`
(the angle the camera is round the figure, from the front towards its left, which is +x of the picture: 0 front, 90, 180
the back, 270 or -90 the other side). A picture without transparency is cut out by the colour of its backdrop. Its
camera is the front's turned that way round the figure, with the figure's size and place in the picture matched to the
mesh's outline from there (these pictures weren't framed by the worker, so its exact camera doesn't hold for them), and
each texel takes its colour from the pictures that see it, the more squarely the more.
"""
import json
import math
import os
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1 :]
mesh_file, camera_file, picture_file, out = (os.path.abspath(a) for a in args[:4])
opt, extra_views = {}, []
for i in range(4, len(args) - 1, 2):
    if args[i] == '--view':
        extra_views.append(args[i + 1])
    else:
        opt[args[i][2:]] = args[i + 1]
TRIS = int(opt.get('tris', 30000))
VOXEL = float(opt.get('voxel', 0.004))
TEX = int(opt.get('tex', 2048))
ARMS_OUT = float(opt['arms-out']) if 'arms-out' in opt else None
CUT_X = float(opt['cut-x']) if 'cut-x' in opt else None
CUT_ARMS = float(opt['cut-arms']) if 'cut-arms' in opt else None
CARVE = int(opt.get('carve', 4))
FACE_PIC = os.path.abspath(opt['face']) if 'face' in opt else None  # `--face head_cutout.png --face-camera head_camera.json --face-transform head_on_body.json`: a close-up of the head, its own camera
FACE_CAM = json.load(open(os.path.abspath(opt['face-camera']), encoding='utf8')) if 'face-camera' in opt else None
FACE_XF = json.load(open(os.path.abspath(opt['face-transform']), encoding='utf8')) if 'face-transform' in opt else None
FACE_BOOST = float(opt.get('face-boost', 3.0))
SURFACE = os.path.abspath(opt['surface']) if 'surface' in opt else None  # `--surface wrapped.glb`: paint this mesh, make no stand-in
CLOSE = opt.get('close', '0') != '0'  # `--close 1`: close the shape's open columns and silhouette holes (a head's crown and brows); on a body they invent skin in the hair shell
NORMAL = opt.get('normal', '1') != '0' and SURFACE is None  # `--normal 0`: no normal map (a head's: the bake's noise shows at eyes, brows and hairlines)

camera = json.load(open(camera_file, encoding='utf8'))
D = float(camera['distance'])
F = float(camera['intrinsics'][0][0])
CX, CY = float(camera['intrinsics'][0][2]), float(camera['intrinsics'][1][2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=mesh_file)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
high = bpy.context.view_layer.objects.active
high.name = 'high'
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for m in list(high.data.materials):
    high.data.materials.pop()
if CUT_X is not None:
    # Pixal3D can give a figure whose arms hang at its sides the arms of a T-pose as well, four in all (found on the
    # first nude figure: the picture's own arms are there, and a pair straight out from the shoulders on top of
    # them). Whatever lies further than this from the middle is cut off: the hanging arms, the hands and the legs are
    # all inside it.
    bm = bmesh.new()
    bm.from_mesh(high.data)
    far = [f for f in bm.faces if abs(f.calc_center_median().x) > CUT_X]
    bmesh.ops.delete(bm, geom=far, context='FACES')
    bm.to_mesh(high.data)
    bm.free()
    print(f'CUT {len(far)} faces further than {CUT_X} from the middle removed')
if CUT_ARMS is not None:
    # The same, found by itself: the height band the straight-out arms lie in is where the shape is wider than any
    # figure with its arms down (0.2 from the middle), and in that band everything beyond CUT_ARMS goes (the roots of
    # those arms sit against the hanging arms' shoulders and would stick out of them), and beyond 0.2 anywhere.
    bm = bmesh.new()
    bm.from_mesh(high.data)
    centres = [f.calc_center_median() for f in bm.faces]
    wide = np.array([c.z for c in centres if abs(c.x) > 0.2])
    if len(wide) > 50:
        band = (np.percentile(wide, 1) - 0.012, np.percentile(wide, 99) + 0.012)
        far = [f for f, c in zip(bm.faces, centres) if abs(c.x) > 0.2 or (abs(c.x) > CUT_ARMS and band[0] < c.z < band[1])]
        bmesh.ops.delete(bm, geom=far, context='FACES')
        print(f'CUT ARMS the straight-out arms lie at heights {band[0]:.3f} to {band[1]:.3f}: {len(far)} faces removed')
    else:
        print('CUT ARMS nothing wider than 0.2 from the middle: no straight-out arms found')
    bm.to_mesh(high.data)
    bm.free()
# (Blender's z is up and its y runs away from the camera: the glTF point (x, y, z) is Blender's (x, -z, y).)
co = np.empty(len(high.data.vertices) * 3, np.float32)
high.data.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
height = float(co[:, 2].max() - co[:, 2].min())
print(f'MESH {len(high.data.polygons)} faces, {height:.3f} tall; camera at {D:.3f}, f {F:.0f}, fov {camera["fov_degrees"]:.1f}')

if SURFACE is None:
    # 1. The stand-in: one watertight skin, then reduced and unwrapped. The generated surface is thousands of open
    # pieces with some of their triangles turned the wrong way, which Blender's own voxel remesh can't make a solid of (at
    # 3 mm it gave a thousand fragments). So the figure is filled in on a grid instead: along each line of sight from the
    # camera, what lies between the 1st and 2nd surface it crosses, the 3rd and 4th, and so on, is inside (which way a
    # triangle faces doesn't enter), together with every cell a triangle lies in (so a thin sheet, a lock of hair, still
    # counts); the skin of that solid is then smoothed and reduced.
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    bpy.context.view_layer.objects.active = high
    lo, hi = co.min(axis=0) - 2 * VOXEL, co.max(axis=0) + 2 * VOXEL
    shape = np.ceil((hi - lo) / VOXEL).astype(int)
    occ = np.zeros(shape, bool)
    tree_high = BVHTree.FromObject(high, bpy.context.evaluated_depsgraph_get())
    mid_y = lo[1] + (np.arange(shape[1]) + 0.5) * VOXEL
    odd = []
    for ix in range(shape[0]):
        for iz in range(shape[2]):
            o = Vector((lo[0] + (ix + 0.5) * VOXEL, lo[1] - 0.01, lo[2] + (iz + 0.5) * VOXEL))
            ys = []
            while len(ys) < 60:
                loc, _, _, _ = tree_high.ray_cast(o, Vector((0, 1, 0)))
                if loc is None:
                    break
                ys.append(loc.y)
                o = Vector((loc.x, loc.y + 1e-5, loc.z))
            for k in range(0, len(ys) - 1, 2):
                occ[ix, (mid_y > ys[k]) & (mid_y < ys[k + 1]), iz] = True
            if len(ys) % 2:
                odd.append((ix, iz, ys[-1]))  # a line of sight that went in and never came out: the surface is open there
    # Where the shape is open (a crown or a brow the generator left unwritten) a line of sight crosses one surface more than
    # it leaves, and its last crossing has no pair: that column would be empty, a hole straight through. It is closed from
    # that crossing to as far as the columns round it reach.
    reach = np.where(occ.any(axis=1), shape[1] - 1 - np.argmax(occ[:, ::-1, :], axis=1), -1)
    closed = 0
    for ix, iz, y in odd:
        win = reach[max(0, ix - 4) : ix + 5, max(0, iz - 4) : iz + 5]
        top = win.max()
        start = int(np.searchsorted(mid_y, y))
        if top > start:
            occ[ix, start : top + 1, iz] = True
            closed += 1
    print(f'OPEN {len(odd)} lines of sight ended inside the surface, {closed} closed')
    # And any column still empty inside the figure's silhouette seen from the front (a hole all the way through, wherever it
    # came from) is filled with the depth the columns round it have, worked in from the hole's rim.
    sil = occ.any(axis=1)
    outside = ~sil
    edge = np.zeros_like(sil)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    reach_out = outside & edge
    while True:
        grow = reach_out | (outside & (np.roll(reach_out, 1, 0) | np.roll(reach_out, -1, 0) | np.roll(reach_out, 1, 1) | np.roll(reach_out, -1, 1)))
        if (grow == reach_out).all():
            break
        reach_out = grow
    holes = outside & ~reach_out
    if holes.any():
        y_lo = np.where(sil, np.argmax(occ, axis=1), 0).astype(float)
        y_hi = np.where(sil, shape[1] - 1 - np.argmax(occ[:, ::-1, :], axis=1), 0).astype(float)
        known = sil.copy()
        todo = holes.copy()
        while todo.any():
            n = np.zeros(sil.shape)
            a = np.zeros(sil.shape)
            b = np.zeros(sil.shape)
            for axis, step in ((0, 1), (0, -1), (1, 1), (1, -1)):
                k = np.roll(known, step, axis)
                n += k
                a += np.where(k, np.roll(y_lo, step, axis), 0)
                b += np.where(k, np.roll(y_hi, step, axis), 0)
            now = todo & (n > 0)
            if not now.any():
                break
            y_lo[now], y_hi[now] = a[now] / n[now], b[now] / n[now]
            known |= now
            todo &= ~now
        for ix, iz in zip(*np.nonzero(holes & known)):
            occ[ix, int(y_lo[ix, iz]) : int(y_hi[ix, iz]) + 1, iz] = True
        print(f'HOLES {int(holes.sum())} columns inside the silhouette had nothing in them: filled')
    tris_co = np.empty(len(high.data.loops) * 0 + len(high.data.vertices) * 3, np.float32)
    high.data.vertices.foreach_get('co', tris_co)
    vpts = tris_co.reshape(-1, 3)
    fv = np.array([[v for v in p.vertices[:3]] for p in high.data.polygons])
    touch = np.concatenate([vpts, vpts[fv].mean(axis=1)])
    cell = np.clip(((touch - lo) / VOXEL).astype(int), 0, shape - 1)
    occ[cell[:, 0], cell[:, 1], cell[:, 2]] = True
    if CARVE >= 0:
        # Cut the solid to the picture's own outline, seen through the camera it was made for (the visual hull of one
        # view): whatever the shape has that the picture doesn't (a pair of arms held straight out beside the ones that
        # hang in the picture, stray locks of hair) lies outside that outline and goes, roots and all, with no rule about
        # where an arm is. A margin of CARVE pixels keeps the figure's own edge.
        face_pic = bpy.data.images.load(picture_file)
        fw, fh = face_pic.size
        alpha = np.array(face_pic.pixels[:], np.float32).reshape(fh, fw, 4)[::-1, :, 3] > 0.5
        for _ in range(CARVE):
            alpha = alpha | np.roll(alpha, 1, 0) | np.roll(alpha, -1, 0) | np.roll(alpha, 1, 1) | np.roll(alpha, -1, 1)
        gxs = lo[0] + (np.arange(shape[0]) + 0.5) * VOXEL
        gys = lo[2] + (np.arange(shape[2]) + 0.5) * VOXEL
        gzs = -(lo[1] + (np.arange(shape[1]) + 0.5) * VOXEL)
        X, Z = np.meshgrid(gxs, gys, indexing='ij')  # glTF x, glTF y (up) for each column
        kept = 0
        before_carve = int(occ.sum())
        for iy in range(shape[1]):
            depth_c = D - gzs[iy]
            uu = np.clip(np.round(CX + F * X / depth_c).astype(int), 0, fw - 1)
            vv = np.clip(np.round(CY - F * Z / depth_c).astype(int), 0, fh - 1)
            occ[:, iy, :] &= alpha[vv, uu]
        print(f'CARVE {before_carve - int(occ.sum())} of {before_carve} cells lie outside the picture outline')
    print(f'GRID {tuple(shape)} cells, {int(occ.sum())} inside')


    def skin(occ):
        """The boundary faces of a grid of cells, as quads at the cells' corners, wound outward."""
        nx, ny, nz = occ.shape
        pad = np.pad(occ, 1)
        corner = lambda i, j, k: (i * (ny + 1) + j) * (nz + 1) + k  # noqa: E731
        quads = []
        for axis in range(3):
            for sign in (1, -1):
                nb = np.roll(pad, -sign, axis=axis)[1:-1, 1:-1, 1:-1]
                i, j, k = np.nonzero(occ & ~nb)
                at = (i + (sign > 0) * (axis == 0), j + (sign > 0) * (axis == 1), k + (sign > 0) * (axis == 2))
                if axis == 0:
                    c = [(at[0], j, k), (at[0], j + 1, k), (at[0], j + 1, k + 1), (at[0], j, k + 1)]
                elif axis == 1:
                    c = [(i, at[1], k), (i, at[1], k + 1), (i + 1, at[1], k + 1), (i + 1, at[1], k)]
                else:
                    c = [(i, j, at[2]), (i + 1, j, at[2]), (i + 1, j + 1, at[2]), (i, j + 1, at[2])]
                ids = [corner(*q) for q in c]
                if sign < 0:
                    ids = ids[::-1]
                quads.append(np.stack(ids, axis=1))
        return np.concatenate(quads)


    quads = skin(occ)
    used, inverse = np.unique(quads, return_inverse=True)
    nyz = (shape[1] + 1) * (shape[2] + 1)
    vx, rem = np.divmod(used, nyz)
    vy, vz = np.divmod(rem, shape[2] + 1)
    verts = lo + np.stack([vx, vy, vz], axis=1) * VOXEL
    stand = bpy.data.meshes.new('figure')
    stand.from_pydata(verts.tolist(), [], inverse.reshape(-1, 4).tolist())
    stand.update()
    low = bpy.data.objects.new('figure', stand)
    bpy.context.scene.collection.objects.link(low)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    smooth = low.modifiers.new('smooth', 'SMOOTH')
    smooth.factor = 0.5
    smooth.iterations = 10
    bpy.ops.object.modifier_apply(modifier='smooth')
    print(f'STAND-IN {len(low.data.polygons)} faces (a solid, smoothed)')
    # The skin of a grid of cells has edges shared by four faces where two cells meet at an edge, and the reduction below
    # won't collapse those: one more voxel remesh, now of a clean solid, makes it a manifold skin.
    clean = low.modifiers.new('clean', 'REMESH')
    clean.mode = 'VOXEL'
    clean.voxel_size = VOXEL * 1.3
    bpy.ops.object.modifier_apply(modifier='clean')
    print(f'STAND-IN {len(low.data.polygons)} faces (made manifold)')
    if opt.get('smooth', '0') != '0':
        # The lumps, the ring at a neck, the eyes' scraps: smoothed here, on the solid at full resolution (scripts/blender/smooth_regions.py).
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import smooth_regions

        pts = np.empty(len(low.data.vertices) * 3, np.float64)
        low.data.vertices.foreach_get('co', pts)
        ed = np.empty(len(low.data.edges) * 2, np.int64)
        low.data.edges.foreach_get('vertices', ed)
        # (the stand-in is in Blender's reading of the .glb, z up and the front at -y, which is the frame the regions are in)
        moved = smooth_regions.smooth_points(pts.reshape(-1, 3), ed.reshape(-1, 2))
        low.data.vertices.foreach_set('co', moved.astype(np.float32).ravel())
        low.data.update()
    # (Blender's decimate doesn't always reach the ratio it is given on one pass of a very large surface: again, from what
    # is left, until it is near.)
    for _ in range(5):
        now = sum(len(p.vertices) - 2 for p in low.data.polygons)
        if now <= TRIS * 1.15:
            break
        reduce = low.modifiers.new('reduce', 'DECIMATE')
        reduce.use_collapse_triangulate = True
        reduce.ratio = min(1.0, TRIS / max(1, now))
        bpy.ops.object.modifier_apply(modifier='reduce')
    # (Small holes the reduction left in the skin, a brow's: closed now, before the unwrap, so the paint and the normal map
    # cover the patch like the rest.)
    bm = bmesh.new()
    bm.from_mesh(low.data)
    n_before = len(bm.faces)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=24)
    print(f'HOLES {len(bm.faces) - n_before} faces closed small holes in the stand-in')
    bm.to_mesh(low.data)
    bm.free()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    low.data.validate()
    for p in low.data.polygons:
        p.use_smooth = True
    print(f'STAND-IN reduced to {len(low.data.polygons)} faces')
else:
    # A surface of its own (wrap_body.py's: the template body wrapped onto the shape, with its UVs and rig order): no stand-in is
    # made, no normal map baked; only the colour is painted, onto the surface as it is.
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=SURFACE)
    low = max((o for o in bpy.data.objects if o not in before and o.type == 'MESH'), key=lambda o: len(o.data.vertices))  # (the body: the largest)
    for o in list(bpy.data.objects):
        if o not in before and o is not low:
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    low.name = 'figure'
    bm = bmesh.new()
    bm.from_mesh(low.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(low.data)
    bm.free()
    for p in low.data.polygons:
        p.use_smooth = True
    print(f'SURFACE {len(low.data.polygons)} faces from {SURFACE}')

# 2. The surface, as a normal map.
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.render.bake.margin = 8
mat = bpy.data.materials.new('figure')
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
low.data.materials.clear()
low.data.materials.append(mat)
N, L = nt.nodes.new, nt.links.new
out_node = N('ShaderNodeOutputMaterial')
bsdf = N('ShaderNodeBsdfPrincipled')
L(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
normal_img = bpy.data.images.new('normal', TEX, TEX, alpha=False)
normal_img.colorspace_settings.name = 'Non-Color'
normal_node = N('ShaderNodeTexImage')
normal_node.image = normal_img
for n in nt.nodes:
    n.select = False
normal_node.select = True
nt.nodes.active = normal_node
if SURFACE is None:
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.02 * height
    scene.render.bake.max_ray_distance = 0.06 * height
    bpy.ops.object.bake(type='NORMAL')
    print('NORMAL MAP baked')

# 3. The colour: each texel's place in space, and where the picture has it.
mesh = low.data
uv_layer = mesh.uv_layers.active.data
n_loop = len(mesh.loops)
uv = np.empty(n_loop * 2, np.float32)
uv_layer.foreach_get('uv', uv)
uv = uv.reshape(-1, 3, 2)
vi = np.empty(n_loop, np.int32)
mesh.loops.foreach_get('vertex_index', vi)
vi = vi.reshape(-1, 3)
pts = np.empty(len(mesh.vertices) * 3, np.float32)
mesh.vertices.foreach_get('co', pts)
pts = pts.reshape(-1, 3)
tri = pts[vi]  # (faces, 3 corners, xyz) in Blender's frame
fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)

position = np.zeros((TEX, TEX, 3), np.float32)
normal = np.zeros((TEX, TEX, 3), np.float32)
covered = np.zeros((TEX, TEX), bool)
for k in range(len(tri)):
    c = uv[k] * TEX
    x0, x1 = int(max(0, math.floor(c[:, 0].min()))), int(min(TEX - 1, math.ceil(c[:, 0].max())))
    y0, y1 = int(max(0, math.floor(c[:, 1].min()))), int(min(TEX - 1, math.ceil(c[:, 1].max())))
    if x1 < x0 or y1 < y0:
        continue
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    d = (c[1, 1] - c[2, 1]) * (c[0, 0] - c[2, 0]) + (c[2, 0] - c[1, 0]) * (c[0, 1] - c[2, 1])
    if abs(d) < 1e-12:
        continue
    a = ((c[1, 1] - c[2, 1]) * (gx - c[2, 0]) + (c[2, 0] - c[1, 0]) * (gy - c[2, 1])) / d
    b = ((c[2, 1] - c[0, 1]) * (gx - c[2, 0]) + (c[0, 0] - c[2, 0]) * (gy - c[2, 1])) / d
    g = 1 - a - b
    inside = (a >= -0.04) & (b >= -0.04) & (g >= -0.04)
    if not inside.any():
        continue
    ys, xs = np.nonzero(inside)
    position[ys + y0, xs + x0] = a[ys, xs, None] * tri[k, 0] + b[ys, xs, None] * tri[k, 1] + g[ys, xs, None] * tri[k, 2]
    normal[ys + y0, xs + x0] = fn[k]
    covered[ys + y0, xs + x0] = True
print(f'TEXELS {int(covered.sum())} of {TEX * TEX} lie on the surface')

def load_view(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], np.float32).reshape(h, w, 4)[::-1].copy()  # top row first
    if px[:, :, 3].min() > 0.99:
        # No transparency: cut out by the backdrop's colour (its median round the edge), opened a little.
        rim = np.concatenate([px[:6].reshape(-1, 4), px[-6:].reshape(-1, 4), px[:, :6].reshape(-1, 4), px[:, -6:].reshape(-1, 4)])
        gap = np.abs(px[:, :, :3] - np.median(rim[:, :3], axis=0)).max(axis=2) > 0.07
        for _ in range(2):
            gap = gap & np.roll(gap, 1, 0) & np.roll(gap, -1, 0) & np.roll(gap, 1, 1) & np.roll(gap, -1, 1)
        for _ in range(2):
            gap = gap | np.roll(gap, 1, 0) | np.roll(gap, -1, 0) | np.roll(gap, 1, 1) | np.roll(gap, -1, 1)
        px[:, :, 3] = gap.astype(np.float32)
    return px


views = [{'yaw': 0.0, 'pix': load_view(picture_file), 'exact': True}]
for item in extra_views:
    yaw, path = item.split(':', 1)
    views.append({'yaw': float(yaw), 'pix': load_view(os.path.abspath(path)), 'exact': False})
if FACE_PIC:
    views.append({'yaw': 0.0, 'pix': load_view(FACE_PIC), 'exact': False, 'own': True})

ys, xs = np.nonzero(covered)
P = position[ys, xs]  # Blender frame
Nrm = normal[ys, xs]
glTF = np.stack([P[:, 0], P[:, 2], -P[:, 1]], axis=1)
stand_pts = np.empty(len(low.data.vertices) * 3, np.float32)
low.data.vertices.foreach_get('co', stand_pts)
stand_pts = stand_pts.reshape(-1, 3)
stand_g = np.stack([stand_pts[:, 0], stand_pts[:, 2], -stand_pts[:, 1]], axis=1)
tree = BVHTree.FromObject(low, bpy.context.evaluated_depsgraph_get())


def turned(g, yaw):
    """Points of the glTF frame as the camera round at `yaw` sees them (its own x right, z towards it)."""
    c, sn = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    return g[:, 0] * c - g[:, 2] * sn, g[:, 1], g[:, 0] * sn + g[:, 2] * c


def look(g, yaw):
    xr, yr, zr = turned(g, yaw)
    return CX + F * xr / (D - zr), CY - F * yr / (D - zr)


def sampler(pix):
    ph, pw = pix.shape[:2]

    def sample(u, v):
        u = np.clip(u - 0.5, 0, pw - 1.001)
        v = np.clip(v - 0.5, 0, ph - 1.001)
        x0, y0 = np.floor(u).astype(int), np.floor(v).astype(int)
        fx, fy = (u - x0)[:, None], (v - y0)[:, None]
        return (pix[y0, x0] * (1 - fx) * (1 - fy) + pix[y0, x0 + 1] * fx * (1 - fy) + pix[y0 + 1, x0] * (1 - fx) * fy + pix[y0 + 1, x0 + 1] * fx * fy)

    return sample


total = np.zeros(len(P), np.float32)  # sum of squared weights
skin_only = np.zeros(len(P), bool)  # texels a side picture saw as hair, below the shoulders: skin under it, for the fill
# (On a surface of its own the hair will be hair, a separate piece: below the neck everything is skin, whatever hangs over it in a picture.)
below_shoulder = P[:, 2] < P[:, 2].min() + (0.86 if SURFACE else 0.76) * (P[:, 2].max() - P[:, 2].min())
front_rgb, front_w = None, None
best = np.zeros(len(P), np.float32)  # the largest weight
mixed = np.zeros((len(P), 3), np.float32)
core_of_best = np.zeros(len(P), bool)
facing_of_best = np.zeros(len(P), np.float32)
for view in views:
    pix = view['pix']
    ph, pw = pix.shape[:2]
    sample = sampler(pix)
    yaw = view['yaw']
    own = view.get('own')
    if own:
        # A close-up with a camera of its own: the body's texel positions go into the head piece's frame (it was set on the body by
        # scale and shift: p * k + t), and through that camera.
        k_f, t_f = FACE_XF['scale'], np.array(FACE_XF['translate'])
        Dh, Fh = float(FACE_CAM['distance']), float(FACE_CAM['intrinsics'][0][0])
        CXh, CYh = float(FACE_CAM['intrinsics'][0][2]), float(FACE_CAM['intrinsics'][1][2])
        ph_ = (P - t_f) / k_f
        gh = np.stack([ph_[:, 0], ph_[:, 2], -ph_[:, 1]], axis=1)
        u, v = CXh + Fh * gh[:, 0] / (Dh - gh[:, 2]), CYh - Fh * gh[:, 1] / (Dh - gh[:, 2])
    else:
        u, v = look(glTF, yaw)
    if not view['exact'] and not own:
        # Matched to the mesh's outline from this side: the same height, the middles over each other.
        mu, mv = look(stand_g, yaw)
        rows, cols = np.nonzero(pix[:, :, 3] > 0.5)
        scale = (rows.max() - rows.min()) / (mv.max() - mv.min())
        u = (cols.min() + cols.max()) / 2 + (u - (mu.min() + mu.max()) / 2) * scale
        v = rows.min() + (v - mv.min()) * scale
        print(f'VIEW {yaw:.0f}: picture {pw}x{ph}, figure {rows.max() - rows.min()} px tall, scaled {scale:.2f}')
    cam = np.array([D * math.sin(math.radians(yaw)), -D * math.cos(math.radians(yaw)), 0.0])  # Blender frame
    if own:
        cam = np.array([0.0, -Dh, 0.0]) * k_f + t_f  # the close-up's camera, in the body's frame
    to_cam = cam - P
    dist = np.linalg.norm(to_cam, axis=1)
    to_cam /= dist[:, None]
    facing = (Nrm * to_cam).sum(axis=1)
    rgba = sample(u, v)
    inside_picture = (u > 1) & (u < pw - 1) & (v > 1) & (v < ph - 1) & (rgba[:, 3] > 0.5)
    want = np.nonzero(inside_picture & (facing > 0.1))[0]
    # Hidden behind something nearer? A ray from the camera to the texel's place, against the stand-in itself.
    visible = np.zeros(len(P), bool)
    camv = Vector(cam)
    for i in want:
        hit = tree.ray_cast(camv, Vector(-to_cam[i]), float(dist[i]))
        visible[i] = hit[0] is None or hit[3] is None or hit[3] > dist[i] - 0.008 * height
    print(f'VISIBLE from {yaw:.0f}: {int(visible.sum())} of {len(P)} texels ({int(inside_picture.sum())} in the picture, {len(want)} facing it)')
    # (Grazing texels aren't used: where a surface turns away from a picture, its colour is the picture's edge, and the
    # cut-out's dark halo of a few pixels is painted on as a thin dark line down a flank, a leg, an arm.)
    smooth = np.clip((facing - 0.15) / 0.7, 0, 1)
    smooth = smooth * smooth * (3 - 2 * smooth)
    weight = np.where(visible, smooth, 0.0).astype(np.float32)
    # (At its edge a picture is half background: a texel only counts as well seen with the object all round it.)
    core = np.ones(len(P), bool)
    for du, dv in ((9, 0), (-9, 0), (0, 9), (0, -9), (7, 7), (-7, -7), (7, -7), (-7, 7)):
        core &= sample(u + du, v + dv)[:, 3] > 0.99
    weight = weight * core  # (and no texel within nine pixels of a picture's edge counts as seen)
    if own:
        # Only the head, and counted above the front picture's: it has several times the pixels there.
        head_zone = P[:, 2] > P[:, 2].min() + 0.85 * (P[:, 2].max() - P[:, 2].min())
        weight = np.where(head_zone, weight, 0.0).astype(np.float32)
        # (And only where the surface truly faces it: further round the cheek the picture is stretched, and smears the face on the side of the head.)
        weight = weight * np.clip((facing - 0.45) / 0.35, 0, 1)
        # (And only the half of the head nearest its camera: a patch on the far side of the head took the face too.)
        weight = weight * (gh[:, 2] > np.percentile(gh[head_zone, 2], 45))
        print(f'FACE VIEW: {int((weight > 0.5).sum())} texels of the head take the close-up')
    lum = rgba[:, 0] * 0.3 + rgba[:, 1] * 0.59 + rgba[:, 2] * 0.11
    if own:
        # The close-up's hair hangs a little off the body's: its cheek lands on the body's hair in front of the face. Where the front
        # picture, which the body's shape was made from, says dark hair and the close-up says skin (or the reverse), the front wins.
        lum_front = front_rgb @ np.array([0.3, 0.59, 0.11])
        agree = (front_w < 0.1) | (np.abs(lum - lum_front) < 0.28)
        weight = np.where(agree, weight, 0.0).astype(np.float32)
    if SURFACE:
        hairy = (lum < 0.25) & below_shoulder & (weight > 0)
        skin_only |= hairy
        weight = np.where(hairy, 0.0, weight).astype(np.float32)
    if view['exact']:
        front_rgb, front_w = rgba[:, :3].copy(), weight.copy()
    else:
        if abs(math.sin(math.radians(yaw))) > 0.5:
            # A side picture's hair hangs over the back and flank in the picture, where the shape has the back's and the
            # flank's own skin (the picture and the shape differ by a few centimetres): below the shoulders, what a side
            # picture sees as hair is not used, and the texel is filled with skin (the black block on the figure's side).
            hairy = (lum < 0.25) & below_shoulder & (weight > 0)
            skin_only |= hairy
            weight = np.where(hairy, 0.0, weight).astype(np.float32)
        # Tone: this picture's lighting and skin tone differ from the front's, so the figure was a patchwork of blocks. Its
        # colours are scaled, per channel, to match the front's where both see skin.
        # (Not over the texels both see, which are few at a side: over each one's skin as a whole.)
        mine = (weight > 0.5) & (lum > 0.35)
        theirs = (front_w > 0.5) & (front_rgb @ np.array([0.3, 0.59, 0.11]) > 0.35)
        both = mine
        if mine.sum() > 500 and theirs.sum() > 500:
            gain = np.clip(np.median(front_rgb[theirs], axis=0) / np.maximum(np.median(rgba[mine, :3], axis=0), 1e-3), 0.8, 1.3)
            rgba = rgba.copy()
            rgba[:, :3] = np.clip(rgba[:, :3] * gain, 0, 1)
            print(f'TONE view {yaw:.0f}: scaled by {np.round(gain, 3)} to match the front over {int(both.sum())} texels')
    share = FACE_BOOST ** 2 if own else 1.0  # (the close-up counts for more where it has the pixels)
    mixed += (share * weight ** 2)[:, None] * rgba[:, :3]
    total += share * weight ** 2
    better = weight > best
    core_of_best = np.where(better, core, core_of_best)
    facing_of_best = np.where(better, facing, facing_of_best)
    best = np.maximum(best, weight)

seen = np.where(total[:, None] > 1e-9, mixed / np.maximum(total[:, None], 1e-9), 0.0)
weight = best
if ARMS_OUT is not None:
    # Arms held out further from the body than the pictures show them (Pixal3D puts them straight out whatever the
    # picture says): what the pictures have there is the torso's side, the hair, a shadow. Past this distance from the
    # middle the pictures aren't used and the colour is the nearest well-seen skin's.
    out_arm = np.abs(glTF[:, 0]) > ARMS_OUT
    weight = np.where(out_arm, 0.0, weight).astype(np.float32)
    print(f'ARMS {int(out_arm.sum())} texels beyond {ARMS_OUT} of the middle take the nearest skin')

# What no picture reaches: the colour of the nearest texels that one does, by distance in space.
# (Only from texels well inside the figure and facing their picture, and the median of the nearest sixteen, not the
# nearest one: a texel behind the head sits beside the cheek's edge as often as beside hair, and one neighbour would
# put skin in the hair, or the picture's grey edge on it.)
solid = np.nonzero((weight > 0.85) & (facing_of_best > 0.5) & core_of_best)[0]
keep = solid[:: max(1, len(solid) // 150000)]
kd = kdtree.KDTree(len(keep))
for j, i in enumerate(keep):
    kd.insert(Vector(P[i]), j)
kd.balance()
paint = seen.copy()
luma = seen[:, 0] * 0.3 + seen[:, 1] * 0.59 + seen[:, 2] * 0.11
light_donors = keep[luma[keep] > 0.3]
kd_skin = kdtree.KDTree(max(1, len(light_donors)))
for j, i in enumerate(light_donors):
    kd_skin.insert(Vector(P[i]), j)
kd_skin.balance()
for i in np.nonzero(weight < 0.95)[0]:
    if skin_only[i] and len(light_donors):
        hits = kd_skin.find_n(Vector(P[i]), 40)
        w = np.array([1.0 / (0.004 + h[2]) for h in hits])
        paint[i] = (seen[light_donors[[h[1] for h in hits]]] * w[:, None]).sum(axis=0) / w.sum()
        continue
    near = keep[[hit[1] for hit in kd.find_n(Vector(P[i]), 16)]]
    dark = near[luma[near] < 0.22]
    # (Hair meets skin: a texel no picture sees, with hair among its neighbours, is hair. Skin is never that dark, so the
    # median of all of them put skin into the ends of the hair, which a cut-out hair's fine edge leaves unseen.)
    paint[i] = np.median(seen[dark if len(dark) * 2 >= len(near) else near], axis=0)
final = np.where(weight[:, None] > 0, weight[:, None] * seen + (1 - weight[:, None]) * paint, paint)

# Flecks: a light texel in the middle of dark ones is a gap in the hair (the shape's hair hangs further than the picture's,
# or a cut-out hair's fine edge left a texel unseen), not skin: it takes what is round it. A real skin edge has skin on one side,
# so it keeps its colour.
fl = final[:, 0] * 0.3 + final[:, 1] * 0.59 + final[:, 2] * 0.11
sub = np.arange(0, len(P), max(1, len(P) // 400000))
kd2 = kdtree.KDTree(len(sub))
for j, i in enumerate(sub):
    kd2.insert(Vector(P[i]), j)
kd2.balance()
fixed = 0
for i in np.nonzero(fl > 0.3)[0][:: 1]:
    near = sub[[hit[1] for hit in kd2.find_n(Vector(P[i]), 14)]]
    dk = near[fl[near] < 0.2]
    if len(dk) >= 0.7 * len(near):
        final[i] = np.median(final[dk], axis=0)
        fixed += 1
print(f'FLECKS {fixed} light texels among dark ones taken for hair')
colour = np.zeros((TEX, TEX, 3), np.float32)
colour[ys, xs] = final
mask = covered.copy()
for _ in range(8):  # the seams' margins, so a map filtered at a distance doesn't show the empty texels
    grown = mask.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(np.roll(mask, dy, 0), dx, 1)
        cs = np.roll(np.roll(colour, dy, 0), dx, 1)
        take = sh & ~grown
        colour[take] = cs[take]
        grown |= sh
    mask = grown
colour_img = bpy.data.images.new('colour', TEX, TEX, alpha=False)
colour_img.colorspace_settings.name = 'sRGB'
colour_img.pixels.foreach_set(np.concatenate([np.clip(colour, 0, 1), np.ones((TEX, TEX, 1), np.float32)], axis=2).ravel())

# 4. The material: the two maps, and nothing else.
folder = tempfile.mkdtemp(prefix='figure_')
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 90
colour_img.filepath_raw = os.path.join(folder, 'colour.jpg')
colour_img.file_format = 'JPEG'
colour_img.save()
normal_img.filepath_raw = os.path.join(folder, 'normal.png')
normal_img.file_format = 'PNG'
normal_img.save()
colour_node = N('ShaderNodeTexImage')
colour_node.image = colour_img
bump = N('ShaderNodeNormalMap')
L(colour_node.outputs['Color'], bsdf.inputs['Base Color'])
if NORMAL:
    L(normal_node.outputs['Color'], bump.inputs['Color'])
    L(bump.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Roughness'].default_value = 0.6
bsdf.inputs['Metallic'].default_value = 0.0

bpy.data.objects.remove(high)
bpy.ops.object.select_all(action='DESELECT')
low.select_set(True)
bpy.context.view_layer.objects.active = low
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_image_format='AUTO')
print(f'FIGURE {out}: {len(low.data.polygons)} triangles, textures {TEX}, {os.path.getsize(out) / 1e6:.1f} MB')
