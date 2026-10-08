"""A generated mesh of an object, made ready to look at as a prop: reduced to a game's triangle count, its surface
detail kept as a normal map, and coloured from the picture it was made from.

The mesh comes from scripts/props/mesh_endpoint.mjs (Hi3DGen: a detailed shape, a few hundred thousand
triangles, no colour, built in the picture's own view: y up, the side the picture shows towards +z). The picture
is the cut-out that script saves beside it (cutout.png: the object on transparency, as the model saw it).

  "<blender.exe>" -b --python scripts/blender/prop_from_mesh.py -- <mesh.glb> <cutout.png> <out.glb>
      [--tris 12000]      triangles to reduce to
      [--tex 1024]        the two textures' size
      [--height 1.0]      how tall the prop is made (metres; whoever places it scales it)
      [--roughness 0.35]  how shiny (0.35 is glazed pottery)
      [--back <cutout>]   a picture of the same object from straight behind (cut out the same way), to paint what
                          faces away with, in place of the front picture's edge colours

What it does: stands the mesh on the ground, centred, `height` tall; makes a reduced copy and unwraps it; bakes
the full mesh's surface onto the copy as a normal map; and paints the copy. The paint is the picture laid on
from the view it was taken from (found by matching the mesh's outline to the object's in the picture: the
generator stands things upright whatever angle they were photographed from), which is right wherever the
surface faces that view. What faces away the picture never showed: there it gets the colour the picture has at its edge at
that height (the hat's straw up where the hat is, the dark glaze down the body), shaded by how enclosed the
surface is, so the back is plain but belongs to the same object. It writes <out.glb> (y up, facing +z, standing
on y 0): one mesh, one material, a colour texture (JPEG) and a normal map (PNG).

A prop made this way is a candidate: it goes in a showroom for the user's approval before it goes anywhere
else, and the picture has to be the project's own (.claude/rules/generated-art.md, licences.md).
"""
import math
import os
import sys
import tempfile

import bpy
import numpy as np


def arg(argv, name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default


def new_image(name, size, colour):
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return img


def rim_strip(pixels):
    """The picture's colour at the object's edge, row by row: a strip one row a picture row (top first), RGBA floats."""
    h, w, _ = pixels.shape
    rows = np.zeros((h, 3), np.float32)
    known = np.zeros(h, bool)
    for y in range(h):
        xs = np.where(pixels[y, :, 3] > 0.98)[0]
        if len(xs) < 12:
            continue
        # A little in from the edge itself (which is blended with the background), a twentieth of the row each side.
        n = max(4, len(xs) // 20)
        side = np.concatenate([xs[3 : 3 + n], xs[-3 - n : -3]])
        rows[y] = pixels[y, side, :3].mean(axis=0)
        known[y] = True
    ys = np.where(known)[0]
    for c in range(3):
        rows[:, c] = np.interp(np.arange(h), ys, rows[ys, c])
    # Smoothed up and down, so a row's speck isn't a stripe round the back.
    k = max(3, h // 40)
    pad = np.concatenate([np.repeat(rows[:1], k, 0), rows, np.repeat(rows[-1:], k, 0)])
    rows = np.stack([pad[i : i + 2 * k + 1].mean(axis=0) for i in range(h)])
    return rows, (ys.min(), ys.max())


def turn(yaw, pitch, roll):
    """The rotation that takes the mesh's own frame (x to the picture's right, z up, the front towards -y) to a
    view's: turned about the vertical, then tipped (the top towards the viewer for a view from above), then leant."""
    a, b, c = (math.radians(v) for v in (yaw, pitch, roll))
    rz = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, math.cos(b), -math.sin(b)], [0, math.sin(b), math.cos(b)]])
    ry = np.array([[math.cos(c), 0, math.sin(c)], [0, 1, 0], [-math.sin(c), 0, math.cos(c)]])
    return ry @ rx @ rz


def fit_view(points, mask, around):
    """The view a picture was taken from: the one from which the mesh's outline is most like the object's in the
    picture. The generator stands an object upright whatever angle its picture was taken from, so a picture from
    above or to one side doesn't lie on the mesh as a level, square-on one would. Searched over turn (about
    `around`: 0 the front, 180 the back), tip and lean, coarse then fine. Returns the rotation and (turn, tip,
    lean, how well the outlines agree: 1 is exactly)."""
    ys, xs = np.where(mask)
    crop = mask[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    H = 144
    W = max(8, round(H * crop.shape[1] / crop.shape[0]))
    small = crop[(np.arange(H) * crop.shape[0] / H).astype(int)][:, (np.arange(W) * crop.shape[1] / W).astype(int)]
    # The object's outline in the middle of a canvas twice as wide, so a mesh that comes out wider still counts.
    target = np.zeros((H, 2 * W), bool)
    target[:, W // 2 : W // 2 + W] = small
    pts = points[:: max(1, len(points) // 30000)]

    def score(yaw, pitch, roll):
        q = pts @ turn(yaw, pitch, roll).T
        x, z = q[:, 0], q[:, 2]
        # Both to the same scale, by height, and centred: as the picture is laid on (not stretched to fit, which
        # would let a turn of the mesh make up for an arm held at another angle).
        k = (H - 1) / (z.max() - z.min())
        col = np.clip(((x - (x.max() + x.min()) / 2) * k + W).astype(int), 0, 2 * W - 1)
        seen = np.zeros((H, 2 * W), bool)
        seen[((z.max() - z) * k).astype(int), col] = True
        agree = (seen & target).sum() / max(1, (seen | target).sum())
        # A picture is taken level and square on unless the outlines clearly say otherwise.
        return agree - 0.002 * (abs(yaw - around) + abs(pitch) + abs(roll))

    best = (-9.0, around, 0.0, 0.0)
    for step, spans in ((6, (30, 42, 12)), (2, (4, 4, 4)), (1, (1, 1, 1))):
        _, y0, p0, r0 = best
        for yaw in np.arange(y0 - spans[0], y0 + spans[0] + 0.1, step):
            for pitch in np.arange(p0 - spans[1], p0 + spans[1] + 0.1, step):
                for roll in np.arange(r0 - spans[2], r0 + spans[2] + 0.1, step):
                    sc = score(yaw, pitch, roll)
                    if sc > best[0]:
                        best = (sc, float(yaw), float(pitch), float(roll))
    sc, yaw, pitch, roll = best
    return turn(yaw, pitch, roll), (yaw - around, pitch, roll, sc)


def main():
    argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
    if len(argv) < 3:
        sys.exit('prop_from_mesh.py -- <mesh.glb> <cutout.png> <out.glb> [--tris n] [--tex px] [--height m] [--roughness r]')
    src, picture, out = (os.path.abspath(a) for a in argv[:3])
    tris = arg(argv, '--tris', 12000)
    tex = arg(argv, '--tex', 1024)
    height = arg(argv, '--height', 1.0)
    roughness = arg(argv, '--roughness', 0.35)
    back_picture = os.path.abspath(arg(argv, '--back', '')) if '--back' in argv else ''

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
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
    # A mesh that comes with a texture of its own (a generator's that paints) has its points doubled along every
    # seam of its unwrap, so it is so many loose patches: reduced like that it tears along them. Joined up first.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-6)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Standing on the ground, centred, `height` tall. (In Blender: z up, the front towards -y.)
    co = np.array([v.co[:] for v in high.data.vertices])
    lo, hi = co.min(axis=0), co.max(axis=0)
    scale = height / (hi[2] - lo[2])
    shift = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
    for v in high.data.vertices:
        v.co = [(v.co[i] - shift[i]) * scale for i in range(3)]
    high.data.update()
    for p in high.data.polygons:
        p.use_smooth = True

    # The reduced copy, unwrapped.
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    bpy.ops.object.duplicate()
    low = bpy.context.view_layer.objects.active
    low.name = 'prop'
    low.data.name = 'prop'
    mod = low.modifiers.new('reduce', 'DECIMATE')
    mod.ratio = min(1.0, tris / max(1, sum(len(p.vertices) - 2 for p in low.data.polygons)))
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    # (A reduction can leave a face that folds back on its own edge: put right here, or the exporter says so.)
    low.data.validate()
    for p in low.data.polygons:
        p.use_smooth = True

    # The picture, and its edge colours.
    pic = bpy.data.images.load(picture)
    pw, ph = pic.size
    px = np.array(pic.pixels[:], np.float32).reshape(ph, pw, 4)[::-1]  # top row first
    strip, (top, bottom) = rim_strip(px)
    rim = bpy.data.images.new('rim', 4, ph, alpha=False)
    rim.pixels[:] = np.concatenate([np.repeat(strip[::-1, None, :], 4, axis=1), np.ones((ph, 4, 1), np.float32)], axis=2).ravel()

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    bake = scene.render.bake
    bake.margin = 8

    mat = bpy.data.materials.new('prop')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    low.data.materials.clear()
    low.data.materials.append(mat)
    N = nt.nodes.new
    L = nt.links.new

    def target(img):
        node = N('ShaderNodeTexImage')
        node.image = img
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node
        return node

    # 1. The full mesh's surface, as a normal map on the copy.
    normal_img = new_image('normal', tex, False)
    out_node = N('ShaderNodeOutputMaterial')
    bsdf = N('ShaderNodeBsdfPrincipled')
    L(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
    normal_node = target(normal_img)
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bake.use_selected_to_active = True
    bake.cage_extrusion = 0.02 * height
    bake.max_ray_distance = 0.06 * height
    bpy.ops.object.bake(type='NORMAL')

    # 2. The paint: each picture from where it was taken, onto what faces that way; the front picture's edge
    # colour on whatever neither shows.
    coord = N('ShaderNodeTexCoord')
    geo = N('ShaderNodeNewGeometry')
    points = np.array([v.co[:] for v in high.data.vertices])

    def remap(value, a, b, c, d, smooth=False):
        node = N('ShaderNodeMapRange')
        node.clamp = True
        if smooth:
            node.interpolation_type = 'SMOOTHSTEP'
        L(value, node.inputs['Value'])
        for name, v in (('From Min', a), ('From Max', b), ('To Min', c), ('To Max', d)):
            node.inputs[name].default_value = v
        return node.outputs['Result']

    def along(vector, row):
        """How far `vector` (a socket) lies along a fixed direction."""
        node = N('ShaderNodeVectorMath')
        node.operation = 'DOT_PRODUCT'
        L(vector, node.inputs[0])
        node.inputs[1].default_value = tuple(float(x) for x in row)
        return node.outputs['Value']

    def projected(image, pixels, around):
        """A picture laid on the mesh from the view it was taken from: its colour, how much of it to use (by how
        squarely the surface faces that view, and only where the picture has the object), and its up-and-down
        coordinate."""
        h, w, _ = pixels.shape
        there = np.where(pixels[:, :, 3] > 0.5)
        x0, x1, y0, y1 = there[1].min(), there[1].max(), there[0].min(), there[0].max()
        R, how = fit_view(points, pixels[:, :, 3] > 0.5, around)
        print(f'VIEW {os.path.basename(image.filepath)}: turned {how[0]:.0f}, tipped {how[1]:.0f}, leaning {how[2]:.0f} degrees; outlines agree {how[3]:.2f}')
        q = points @ R.T
        # Up and down, the mesh's height onto the object's in the picture; across, the same scale about the
        # middle of each (not the mesh's width stretched onto the picture's: the generator doesn't hold an arm at
        # quite the angle it was shown, and stretching would drag the whole body across to make the hands meet).
        middle = (q[:, 0].max() + q[:, 0].min()) / 2
        half = (x1 + 1 - x0) / 2 * (q[:, 2].max() - q[:, 2].min()) / (y1 + 1 - y0)
        u = remap(along(coord.outputs['Object'], R[0]), middle - half, middle + half, x0 / w, (x1 + 1) / w)
        v = remap(along(coord.outputs['Object'], R[2]), q[:, 2].min(), q[:, 2].max(), 1 - (y1 + 1) / h, 1 - y0 / h)
        uv = N('ShaderNodeCombineXYZ')
        L(u, uv.inputs['X'])
        L(v, uv.inputs['Y'])
        tex = N('ShaderNodeTexImage')
        tex.image = image
        tex.extension = 'EXTEND'
        L(uv.outputs['Vector'], tex.inputs['Vector'])
        # (The view looks along +y of its own frame: a surface faces it when its normal runs the other way.)
        # (Used almost to the outline: what the edge colour would fill in instead is whatever the picture has at its
        # edge at that height, which beside a face is hair, and left a black patch on the turn of the cheek.)
        facing = remap(along(geo.outputs['Normal'], -R[1]), 0.02, 0.2, 0.0, 1.0, smooth=True)
        use = N('ShaderNodeMath')
        use.operation = 'MULTIPLY'
        L(facing, use.inputs[0])
        L(tex.outputs['Alpha'], use.inputs[1])
        return tex.outputs['Color'], use.outputs['Value'], v

    front_colour, front_use, v = projected(pic, px, 0.0)
    strip_uv = N('ShaderNodeCombineXYZ')
    strip_uv.inputs['X'].default_value = 0.5
    L(v, strip_uv.inputs['Y'])
    edge = N('ShaderNodeTexImage')
    edge.image = rim
    edge.extension = 'EXTEND'
    L(strip_uv.outputs['Vector'], edge.inputs['Vector'])
    # The edge colour is flat: shaded by how enclosed the surface is, it reads as the same object's back.
    ao = N('ShaderNodeAmbientOcclusion')
    ao.samples = 16
    ao.inputs['Distance'].default_value = 0.25 * height
    fill = N('ShaderNodeMix')
    fill.data_type = 'RGBA'
    fill.blend_type = 'MULTIPLY'
    fill.inputs[0].default_value = 1.0
    L(edge.outputs['Color'], fill.inputs[6])
    L(remap(ao.outputs['AO'], 0.0, 1.0, 0.55, 1.0), fill.inputs[7])
    under = fill.outputs[2]
    if back_picture:
        # A picture from behind, laid on from its own view (found the same way, starting from straight behind).
        # It has to be the same object in much the same pose as the front's, or their edges won't meet.
        bpic = bpy.data.images.load(back_picture)
        bw, bh = bpic.size
        bpx = np.array(bpic.pixels[:], np.float32).reshape(bh, bw, 4)[::-1]
        rear_colour, rear_use, _ = projected(bpic, bpx, 180.0)
        both = N('ShaderNodeMix')
        both.data_type = 'RGBA'
        L(rear_use, both.inputs[0])
        L(under, both.inputs[6])
        L(rear_colour, both.inputs[7])
        under = both.outputs[2]
    paint = N('ShaderNodeMix')
    paint.data_type = 'RGBA'
    L(front_use, paint.inputs[0])
    L(under, paint.inputs[6])
    L(front_colour, paint.inputs[7])
    glow = N('ShaderNodeEmission')
    L(paint.outputs[2], glow.inputs['Color'])
    L(glow.outputs['Emission'], out_node.inputs['Surface'])
    colour_img = new_image('colour', tex, True)
    colour_node = target(colour_img)
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bake.use_selected_to_active = False
    bpy.ops.object.bake(type='EMIT')

    # 3. The prop's own material: the two bakes, and nothing else.
    folder = tempfile.mkdtemp(prefix='prop_')
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 90
    colour_img.filepath_raw = os.path.join(folder, 'colour.jpg')
    colour_img.file_format = 'JPEG'
    colour_img.save()
    normal_img.filepath_raw = os.path.join(folder, 'normal.png')
    normal_img.file_format = 'PNG'
    normal_img.save()
    for n in list(nt.nodes):
        if n not in (out_node, bsdf, colour_node, normal_node):
            nt.nodes.remove(n)
    bump = N('ShaderNodeNormalMap')
    L(colour_node.outputs['Color'], bsdf.inputs['Base Color'])
    L(normal_node.outputs['Color'], bump.inputs['Color'])
    L(bump.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    L(bsdf.outputs['BSDF'], out_node.inputs['Surface'])

    bpy.data.objects.remove(high)
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_image_format='AUTO')
    count = sum(len(p.vertices) - 2 for p in low.data.polygons)
    print(f'PROP {out}: {count} triangles, {len(low.data.vertices)} vertices, textures {tex}, {os.path.getsize(out) / 1e6:.1f} MB')


main()
