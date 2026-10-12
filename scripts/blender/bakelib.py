"""Shared helpers for the baked rooms built in Blender (office_kopo201.py, rouge_interior.py): procedural materials,
bevelled primitives in a room's frame (X = u, Y = t, Z up), and the Cycles bake of the whole room into one texture,
exported as one mesh whose only material is that picture (the game shows it unlit, real/homes.ts placeModel).

Use: `import bakelib as B` from a script run as `blender -b --python scripts/blender/<room>.py -- <out.glb> [--tex N]
[--samples N] [--preview <dir>] [--jpeg]`; build with B.box / B.cyl / ..., add lights, then B.bake_and_export(name)
and B.preview(room, shots).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default):
    return type(default)(ARGV[ARGV.index(name) + 1]) if name in ARGV else default


OUT = ARGV[0]
TEX = arg('--tex', 2048)
SAMPLES = arg('--samples', 48)
PREVIEW = arg('--preview', '')
JPEG = '--jpeg' in ARGV

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
OBJS = []


MATS = {}


def mat(name, rgb, rough=0.6, metal=0.0, grain=None, scale=30.0, strength=0.12, emit=None):
    key = name
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    base = (*rgb, 1.0)
    if grain in ('tiles', 'tilesw'):
        # Square tiles with a thin dark grout: tiles lie on floors (object x, y), tilesw stands on walls (x + y along, z up).
        tc = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
        comb = nt.nodes.new('ShaderNodeCombineXYZ')
        if grain == 'tiles':
            nt.links.new(sep.outputs['X'], comb.inputs['X'])
            nt.links.new(sep.outputs['Y'], comb.inputs['Y'])
        else:
            add = nt.nodes.new('ShaderNodeMath')
            add.operation = 'ADD'
            nt.links.new(sep.outputs['X'], add.inputs[0])
            nt.links.new(sep.outputs['Y'], add.inputs[1])
            nt.links.new(add.outputs['Value'], comb.inputs['X'])
            nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
        br = nt.nodes.new('ShaderNodeTexBrick')
        br.offset = 0.0
        br.squash = 1.0
        br.inputs['Scale'].default_value = scale
        br.inputs['Mortar Size'].default_value = 0.03
        br.inputs['Mortar Smooth'].default_value = 0.1
        br.inputs['Brick Width'].default_value = 1.0
        br.inputs['Row Height'].default_value = 1.0
        br.inputs['Color1'].default_value = base
        br.inputs['Color2'].default_value = (base[0] * (1 - strength), base[1] * (1 - strength), base[2] * (1 - strength), 1.0)
        br.inputs['Mortar'].default_value = (base[0] * 0.25, base[1] * 0.25, base[2] * 0.25, 1.0)
        nt.links.new(comb.outputs['Vector'], br.inputs['Vector'])
        nt.links.new(br.outputs['Color'], bsdf.inputs['Base Color'])
    elif grain == 'stripes':
        # Vertical stripes (the walls' local Z is up): sin of x + y in object coordinates, soft-edged, lightly mottled.
        tc = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
        add = nt.nodes.new('ShaderNodeMath')
        add.operation = 'ADD'
        nt.links.new(sep.outputs['X'], add.inputs[0])
        nt.links.new(sep.outputs['Y'], add.inputs[1])
        mul = nt.nodes.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = scale
        nt.links.new(add.outputs['Value'], mul.inputs[0])
        sn = nt.nodes.new('ShaderNodeMath')
        sn.operation = 'SINE'
        nt.links.new(mul.outputs['Value'], sn.inputs[0])
        ramp = nt.nodes.new('ShaderNodeMapRange')
        ramp.inputs['From Min'].default_value = -0.35
        ramp.inputs['From Max'].default_value = 0.35
        nt.links.new(sn.outputs['Value'], ramp.inputs['Value'])
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 5.0
        n.inputs['Detail'].default_value = 5
        nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
        mot = nt.nodes.new('ShaderNodeMath')
        mot.operation = 'MULTIPLY'
        mot.inputs[1].default_value = 0.35
        nt.links.new(n.outputs['Fac'], mot.inputs[0])
        both = nt.nodes.new('ShaderNodeMath')
        both.operation = 'ADD'
        nt.links.new(ramp.outputs['Result'], both.inputs[0])
        nt.links.new(mot.outputs['Value'], both.inputs[1])
        scl = nt.nodes.new('ShaderNodeMath')
        scl.operation = 'MULTIPLY'
        scl.inputs[1].default_value = strength
        nt.links.new(both.outputs['Value'], scl.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.inputs['A'].default_value = base
        mix.inputs['B'].default_value = (base[0] * 0.5, base[1] * 0.5, base[2] * 0.5, 1.0)
        nt.links.new(scl.outputs['Value'], mix.inputs['Factor'])
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    elif grain:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = 6
        if grain == 'wood':  # stretched along the planks
            mp.inputs['Scale'].default_value = (1.0, 0.08, 1.0)
        elif grain == 'brushed':
            mp.inputs['Scale'].default_value = (1.0, 0.05, 1.0)
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.inputs['Factor'].default_value = strength
        mix.inputs['A'].default_value = base
        mix.inputs['B'].default_value = (base[0] * 0.45, base[1] * 0.45, base[2] * 0.45, 1.0)
        nt.links.new(n.outputs['Fac'], mix.inputs['Factor'])
        mix.inputs['Factor'].default_value = strength
        # The noise factor scaled by `strength`: a colour ramp keeps the grain subtle.
        mul = nt.nodes.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = strength * 4
        nt.links.new(n.outputs['Fac'], mul.inputs[0])
        nt.links.new(mul.outputs['Value'], mix.inputs['Factor'])
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = base
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit[:3], 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit[3]
    MATS[key] = m
    return m


# ---- primitives: bevelled boxes, cylinders, all in the room's frame ----------------------------------------------


def finish(o, material, bevel):
    if bevel > 0:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect='EDGES')
        bm.to_mesh(o.data)
        bm.free()
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    OBJS.append(o)
    return o


def box(u0, u1, t0, t1, z0, z1, material, bevel=0.004, name='box'):
    u0, u1 = sorted((u0, u1))
    t0, t1 = sorted((t0, t1))
    z0, z1 = sorted((z0, z1))
    bpy.ops.mesh.primitive_cube_add(size=1, location=((u0 + u1) / 2, (t0 + t1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.name = name
    o.scale = (max(u1 - u0, 1e-4), max(t1 - t0, 1e-4), max(z1 - z0, 1e-4))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, material, min(bevel, (min(u1 - u0, t1 - t0, z1 - z0) / 2.5)))


def cyl(u, t, z0, z1, r, material, verts=24, r2=None, name='cyl', bevel=0.0, axis='Z'):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=abs(z1 - z0), location=(u, t, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.name = name
    if axis == 'X':
        o.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Y':
        o.rotation_euler = (math.pi / 2, 0, 0)
    if axis != 'Z':
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return finish(o, material, bevel)


def sphere(u, t, z, r, material, sx=1.0, sy=1.0, sz=1.0, name='sphere'):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=r, location=(u, t, z))
    o = bpy.context.active_object
    o.name = name
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(material)
    OBJS.append(o)
    return o


def rot_box(cu, ct, cz, su, st, sz, rx, material, bevel=0.002, name='slat', axis='X'):
    """A box turned by rx about the u axis through its centre (axis 'Y': about the t axis)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cu, ct, cz))
    o = bpy.context.active_object
    o.name = name
    o.scale = (su, st, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.rotation_euler = (rx, 0, 0) if axis == 'X' else (0, rx, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return finish(o, material, bevel)


def bake_and_export(name='room'):
    for o in OBJS:
        if o.name.startswith(('slat', 'fan_blade')):
            bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
            print('DBG', o.name, len(o.data.polygons), [round(min(v[i] for v in bb), 3) for i in range(3)], [round(max(v[i] for v in bb), 3) for i in range(3)], o.name in bpy.data.objects)
            break
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in OBJS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = OBJS[0]
    bpy.ops.object.join()
    room = bpy.context.active_object
    room.name = 'office_kopo201'
    # Unwrap: smart UV islands, packed.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.002)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new('office_baked', TEX, TEX, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    for m in room.data.materials:
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        n.image = img
        m.node_tree.nodes.active = n
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    try:
        scene.cycles.device = 'GPU'
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type != 'CPU' for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = True
                    break
            except Exception:
                continue
        else:
            scene.cycles.device = 'CPU'
    except Exception:
        scene.cycles.device = 'CPU'
    scene.cycles.bake_type = 'COMBINED'
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = True
    scene.render.bake.margin = 6
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.exposure = arg('--exposure', 0.0)
    scene.cycles.max_bounces = 6
    bpy.ops.object.bake(type='COMBINED')
    out_png = os.path.splitext(OUT)[0] + '_baked.png'
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()
    # One material that is the baked picture, for the export.
    final = bpy.data.materials.new('office_baked')
    final.use_nodes = True
    nt = final.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    room.data.materials.clear()
    room.data.materials.append(final)
    bpy.ops.object.select_all(action='DESELECT')
    room.select_set(True)
    # Y up for glTF: Blender X = u stays x, Blender Y = t becomes -z, Blender Z = up becomes y.
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_image_format='JPEG' if JPEG else 'AUTO', export_jpeg_quality=88)
    print('wrote', OUT, 'triangles', sum(len(p.vertices) - 2 for p in room.data.polygons))
    return room


def preview(room, shots):
    """Stills from inside for the review: shots maps a name to ((camera x, y, z), (look-at x, y, z)); the baked picture is shown unlit."""
    if not PREVIEW:
        return
    os.makedirs(PREVIEW, exist_ok=True)
    # Show the baked picture unlit.
    scene.render.engine = 'BLENDER_EEVEE'
    final = room.data.materials[0]
    nt = final.node_tree
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(nt.nodes['Image Texture'].outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], nt.nodes['Material Output'].inputs['Surface'])
    for o in list(bpy.data.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o)
    for name, (loc, look) in shots.items():
        bpy.ops.object.camera_add(location=loc)
        cam = bpy.context.active_object
        cam.data.lens = 18
        cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.camera = cam
        scene.render.resolution_x, scene.render.resolution_y = 1280, 720
        scene.render.filepath = os.path.join(PREVIEW, name + '.png')
        bpy.ops.render.render(write_still=True)


