"""A trial: the head of a head-and-chest mesh set on the body of a full-length one, both generated from the same
picture (the head piece from a crop of it, where the face has the pixels a whole figure's doesn't). Placed by where
each lies in the picture, then nudged to fit. Above the neckline everything is the head piece's; below it the body's,
with the head piece's hair laid over (its hair hangs past the cut) and the body's own hair drawn in a little under it.
  blender -b --python stitch_head.py -- <body x0,x1,y0,y1> <head x0,x1,y0,y1> <body.glb> <head.glb> <neckline y> <hair's end y> <out.glb> [face 0.45] [emit t.json]
  (`face 0.45`: the head piece's face alone, as a mask, the body's own hair and back of the head kept.)
  (The boxes and the two heights are in the picture's pixels, y down: where each object lies in it.)
"""
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector, kdtree

body_box, bust_box, body_file, bust_file, neck_px, hair_px, out, *more = sys.argv[sys.argv.index('--') + 1 :]
# `face 0.45` after the output: only the front of the head piece is used, a mask (below).
FACE = float(more[1]) if len(more) >= 2 and more[0] == 'face' else None
EMIT = more[more.index('emit') + 1] if 'emit' in more else None  # `emit t.json`: where the head piece lies on the body, for project_picture.py --face-transform
neck_px, hair_px = float(neck_px), float(hair_px)
bx0, bx1, by0, by1 = (float(v) for v in body_box.split(','))
ux0, ux1, uy0, uy1 = (float(v) for v in bust_box.split(','))

bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    bpy.context.view_layer.objects.active = meshes[0]
    for o in meshes:
        o.select_set(True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def points(ob):
    co = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3).astype(np.float64)


def dark(ob):
    """Which faces are hair, by their paint: dark, or dullish beside dark (a strand's highlight)."""
    mesh = ob.data
    node = next(n for n in mesh.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].links[0].from_node
    while node.type != 'TEX_IMAGE':
        node = next(i.links[0].from_node for i in node.inputs if i.links)
    w, h = node.image.size
    px = np.array(node.image.pixels[:], np.float32).reshape(h, w, 4)[:, :, :3]
    uv = np.empty(len(mesh.loops) * 2, np.float32)
    mesh.uv_layers.active.data.foreach_get('uv', uv)
    corners = np.empty(len(mesh.loops), np.int32)
    mesh.loops.foreach_get('vertex_index', corners)
    assert len(mesh.loops) == 3 * len(mesh.polygons)
    mid = uv.reshape(-1, 3, 2).mean(axis=1)
    colour = px[np.clip((mid[:, 1] % 1 * h).astype(int), 0, h - 1), np.clip((mid[:, 0] % 1 * w).astype(int), 0, w - 1)]
    value, low = colour.max(axis=1), colour.min(axis=1)
    black = value < 0.3
    by_black = np.zeros(len(mesh.vertices), bool)
    by_black[corners.reshape(-1, 3)[black].ravel()] = True
    dull = (value < 0.55) & (value - low < 0.18 * np.maximum(value, 1e-3) + 0.06)
    return black | (dull & by_black[corners.reshape(-1, 3)].any(axis=1)), corners.reshape(-1, 3)


body, bust = load(body_file), load(bust_file)
B, U = points(body), points(bust)
print('BODY', B.min(axis=0).round(3), B.max(axis=0).round(3))
print('HEAD', U.min(axis=0).round(3), U.max(axis=0).round(3))

# Units a pixel, each mesh. (The head piece two ways: by its width and by its height. They should agree.)
s_body = (B[:, 2].max() - B[:, 2].min()) / (by1 - by0)
s_bust = (U[:, 2].max() - U[:, 2].min()) / (uy1 - uy0)
print(f'SCALE body {s_body:.5f}, head piece by height {s_bust:.5f}, by width {(U[:, 0].max() - U[:, 0].min()) / (ux1 - ux0):.5f}')
k = s_body / s_bust
z_of = lambda y: B[:, 2].max() - (y - by0) * s_body  # noqa: E731
z_cut, z_hair = z_of(neck_px), z_of(hair_px)
move = Vector((
    (B[:, 0].max() + B[:, 0].min()) / 2 + ((ux0 + ux1) / 2 - (bx0 + bx1) / 2) * s_body - (U[:, 0].max() + U[:, 0].min()) / 2 * k,
    0.0,
    z_of(uy0) - U[:, 2].max() * k,
))
# Depth: the heads' middles, of what lies above the cut.
U2 = U * k + np.array(move)
move.y = np.median(B[B[:, 2] > z_cut][:, 1]) - np.median(U2[U2[:, 2] > z_cut][:, 1])
total_move = Vector(move)  # where the head piece's points go: p * k + total_move (the fit's nudges are added below)
bust.scale = (k, k, k)
bust.location = move
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
bust.select_set(True)
bpy.context.view_layer.objects.active = bust
bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)

# Nudged to fit: each point of the piece's head to the nearest of the body's, the nearer pairs only.
tree = kdtree.KDTree(len(B))
for i, p in enumerate(B):
    tree.insert(p, i)
tree.balance()
chin = z_cut + 0.03 * (B[:, 2].max() - B[:, 2].min())
for step in range(12):
    U = points(bust)
    head = U[U[:, 2] > chin][::7]
    pairs = np.array([tree.find(p)[0][:] for p in head]) - head
    far = np.linalg.norm(pairs, axis=1)
    shift = pairs[far < np.percentile(far, 60)].mean(axis=0)
    bust.location = Vector(bust.location) + Vector(shift)
    total_move += Vector(shift)
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    if step in (0, 11):
        print(f'FIT step {step}: moved {np.round(shift, 4)}, pairs apart {np.median(far):.4f} (median)')

if EMIT:
    import json
    json.dump({'scale': k, 'translate': list(total_move)}, open(EMIT, 'w'))
    print('EMIT', EMIT, k, list(total_move))
tall = B[:, 2].max() - B[:, 2].min()
overlap = 0.004 * tall


if FACE is not None:
    # The face alone, as a mask. A close-up shows the head from in front only, so the head piece's sides are a guess
    # and its back has no picture at all, where the body's own hair, laid with pictures from behind and from the
    # sides, is whole. So of the head piece only the front is kept (above the neckline and in front of a plane FACE of
    # the way from the tip of the nose to the back of the head), and of the body only that part is taken away: the
    # join runs over the crown and down through the hair in front of the ears, dark on dark.
    U = points(bust)
    top = U[U[:, 2] > z_cut]
    y_cut = top[:, 1].min() + FACE * (top[:, 1].max() - top[:, 1].min())
    x_lo, x_hi = top[:, 0].min() - overlap, top[:, 0].max() + overlap
    _, tris = dark(bust)
    mids = U[tris].mean(axis=1)
    keep = (mids[:, 2] > z_cut - overlap) & (mids[:, 1] < y_cut + overlap)
    bm = bmesh.new()
    bm.from_mesh(bust.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.where(~keep)[0]], context='FACES')
    bm.to_mesh(bust.data)
    bm.free()
    B = points(body)
    _, tris = dark(body)
    mids = B[tris].mean(axis=1)
    gone = (mids[:, 2] > z_cut + overlap) & (mids[:, 1] < y_cut - overlap) & (mids[:, 0] > x_lo) & (mids[:, 0] < x_hi)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.where(gone)[0]], context='FACES')
    bm.to_mesh(body.data)
    bm.free()
    print(f'FACE MASK: {int(keep.sum())} faces of the head piece kept (the front {FACE:.2f} of the head), {int(gone.sum())} of the body taken away')
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bust.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG')
    print('WROTE', out, len(body.data.polygons), 'faces')
    sys.exit(0)

# The head piece: all of it above the neckline, and only its hair below.
hair, tris = dark(bust)
U = points(bust)
mids = U[tris].mean(axis=1)
drop = (mids[:, 2] < z_cut - overlap) & ~hair
over = mids[(mids[:, 2] < z_cut + overlap) & hair]
bm = bmesh.new()
bm.from_mesh(bust.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.where(drop)[0]], context='FACES')
bm.to_mesh(bust.data)
bm.free()

# The body: nothing above the neckline; below it, its own hair drawn in a little wherever the head piece's lies
# over it (and only there: elsewhere it is all the hair there is).
laid = kdtree.KDTree(len(over))
for i, p in enumerate(over):
    laid.insert(p, i)
laid.balance()
hair, tris = dark(body)
B = points(body)
mids = B[tris].mean(axis=1)
maybe = np.where(hair & (mids[:, 2] < z_cut + overlap) & (mids[:, 2] > z_hair - 0.02 * tall))[0]
covered = np.array([i for i in maybe if laid.find(mids[i])[2] < 0.012 * tall], dtype=int)
under = np.unique(tris[covered])
normals = np.empty(len(B) * 3, np.float32)
body.data.vertices.foreach_get('normal', normals)
B[under] -= normals.reshape(-1, 3)[under] * 0.006 * tall
body.data.vertices.foreach_set('co', B.astype(np.float32).ravel())
body.data.update()
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z_cut + overlap), plane_no=(0, 0, 1), clear_outer=True)
bm.to_mesh(body.data)
bm.free()
print(f'HEAD PIECE: {len(over)} faces of hair below the neckline kept, {int(drop.sum())} of anything else dropped; the hair of the body drawn in under it at {len(under)} points of {len(np.unique(tris[maybe]))}')

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bust.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG')
print('WROTE', out, len(body.data.polygons), 'faces')
