"""Builds a rigged base character with MPFB (MakeHuman for Blender) and exports it as glTF binary.
(The game's characters are built with build_character.py, which uses this file as a library.)

Runs headless in Blender with the MPFB extension enabled and the MakeHuman system assets pack (CC0)
installed in MPFB's user data dir (skins, eyes, eyebrows, eyelashes, proxies, hair, a few clothes):

  blender -b --python scripts/blender/mpfb_base.py -- --gender 1 --years 35 --height-cm 172 \
      --out assets/characters/test_male.glb --preview test_male.png

The character is described as an MPFB human preset (the same dict MPFB saves from its UI), so
--preset writes it out and the result can be opened and tweaked in MPFB's GUI, and --from-preset
builds from such a file (MPFB's "Load from presets" lists files named human.<name>.json in its config
dir, LocationService.get_user_config(): extensions/.user/<repo>/mpfb/config). Building goes through HumanService.deserialize_from_dict, MPFB's own path for
loading a preset: macro targets, the rig and its weights, body parts, proxy, clothes, skin.

What comes out, for the game:
  - the "game_engine" rig (UE-mannequin bone names: pelvis, spine_01..03, thigh_l ...), with weights
    fitted by MPFB to the body, eyes, eyebrows, eyelashes and anything worn;
  - the body: MakeHuman's base mesh (~26.7k triangles nude; clothes mask off the skin they cover),
    or for lower detail a proxy (~3.1k, ~12.5k subdivided once: softer, it loses volume and the
    face's detail), or the base mesh decimated;
  - Principled BSDF materials (MPFB's "game engine" material model) that the glTF exporter
    understands: opaque where the texture is, alpha clip on cards (brows, lashes, hair), since
    three.js can't sort the cards inside one blended mesh;
  - weights limited to 4 bones a vertex and normalised (what glTF skinning takes);
  - every modifier except the armature applied (helper and delete-group masks, subdivision), no
    shape keys, +Y up, metres.

Args after "--" (all optional):
  --gender 0..1          0 female, 1 male (MakeHuman macro)
  --age 0..1             MakeHuman age slider (0.1875 = 11 years, 0.5 = 25, 1 = 90), or
  --years N              the same as an age in years
  --height 0..1          the height macro, or
  --height-cm N          solve the height macro for a standing height (soles to crown, no hair)
  --muscle, --weight, --proportions, --cupsize, --firmness   0..1 macros (0.5 = average)
  --asian, --caucasian, --african   ethnicity weights, normalised (default: --asian 1)
  --target name=value    extra MakeHuman target (e.g. l-eye-epicanthus-in=0.3), repeatable
  --skin NAME            skins/<NAME>/<NAME>.mhmat (default: young_/middleage_asian_<gender>)
  --eyes high-poly|low-poly   --eye-color brown   --eyebrows eyebrow001   --eyelashes eyelashes01|none
  --hair NAME|none       --clothes NAME [NAME ...]   (asset folder names in MPFB's data)
  --proxy none|auto|NAME none (default) keeps the base mesh body (~26.7k triangles before clothes
                         mask what they cover); auto is male1591 / female1605 by gender (~3.1k)
  --subdiv N             subdivision levels baked into a proxy body (default 1: ~12.5k)
  --decimate R           collapse the body to this ratio of its triangles (after the masks)
  --rig game_engine      any rig in MPFB's data/rigs/standard
  --alpha clip|blend     how alpha cards export
  --max-tex N            downscale textures larger than N px (default 2048: leave as shipped)
  --out PATH.glb         --preview PATH.png   --preset PATH.json (write the preset)
  --from-preset PATH.json  build from a saved preset; the body and asset args above are then
                         ignored, the export ones (--decimate, --subdiv, --alpha, --max-tex) still apply
"""
import argparse
import importlib
import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np


def mpfb_module(name):
    # Extensions are imported as bl_ext.<repository>.mpfb; the repository depends on how it was
    # installed (blender_org from the online platform, user_default from a zip), so find it.
    for addon in bpy.context.preferences.addons.keys():
        if addon == 'mpfb' or addon.endswith('.mpfb'):
            return importlib.import_module(addon + '.' + name)
    raise RuntimeError('MPFB is not enabled: install and enable it in Blender first')


HumanService = mpfb_module('services.humanservice').HumanService
TargetService = mpfb_module('services.targetservice').TargetService
AssetService = mpfb_module('services.assetservice').AssetService
LocationService = mpfb_module('services.locationservice').LocationService
HumanObjectProperties = mpfb_module('entities.objectproperties').HumanObjectProperties
ObjectService = mpfb_module('services.objectservice').ObjectService


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser(prog='mpfb_base.py')
    p.add_argument('--gender', type=float, default=1.0)
    p.add_argument('--age', type=float, default=0.5)
    p.add_argument('--years', type=float)
    p.add_argument('--height', type=float, default=0.5)
    p.add_argument('--height-cm', type=float)
    for macro in ('muscle', 'weight', 'proportions', 'cupsize', 'firmness'):
        p.add_argument('--' + macro, type=float, default=0.5)
    p.add_argument('--asian', type=float)
    p.add_argument('--caucasian', type=float)
    p.add_argument('--african', type=float)
    p.add_argument('--target', action='append', default=[])
    p.add_argument('--skin')
    p.add_argument('--eyes', default='high-poly')
    p.add_argument('--eye-color', default='brown')
    p.add_argument('--eyebrows', default='eyebrow001')
    p.add_argument('--eyelashes', default='eyelashes01')
    p.add_argument('--hair', default='none')
    p.add_argument('--clothes', nargs='*', default=[])
    p.add_argument('--proxy', default='none')
    p.add_argument('--subdiv', type=int, default=1)
    p.add_argument('--decimate', type=float)
    p.add_argument('--rig', default='game_engine')
    p.add_argument('--alpha', choices=('clip', 'blend'), default='clip')
    p.add_argument('--max-tex', type=int, default=2048)
    p.add_argument('--out')
    p.add_argument('--preview')
    p.add_argument('--preset')
    p.add_argument('--from-preset')
    return p.parse_args(argv)


def years_to_age(years):
    # MakeHuman's age slider is piecewise linear: 0 = 1 year, 0.1875 = 11, 0.5 = 25, 1 = 90.
    if years < 11:
        return (years - 1) / 10 * 0.1875
    if years < 25:
        return 0.1875 + (years - 11) / 14 * 0.3125
    return min(1.0, 0.5 + (years - 25) / 65 * 0.5)


def asset(kind, name, ext):
    # Presets name assets as "<folder>/<file>"; AssetService searches MPFB's data and user data.
    if not name or name == 'none':
        return ''
    path = name + '/' + name + ext
    if AssetService.find_asset_absolute_path(path, kind) is None:
        raise SystemExit('No ' + kind + ' asset ' + path + ' in ' + LocationService.get_user_data())
    return path


def mhclo_uuid(kind, path):
    with open(AssetService.find_asset_absolute_path(path, kind), encoding='utf-8') as f:
        for line in f:
            if line.startswith('uuid '):
                return line.split()[1]
    return None


def human_info_from_args(a):
    phenotype = TargetService.get_default_macro_info_dict()
    phenotype['gender'] = a.gender
    phenotype['age'] = years_to_age(a.years) if a.years is not None else a.age
    phenotype['height'] = a.height
    for macro in ('muscle', 'weight', 'proportions', 'cupsize', 'firmness'):
        phenotype[macro] = getattr(a, macro)
    race = {'asian': a.asian, 'caucasian': a.caucasian, 'african': a.african}
    if all(v is None for v in race.values()):
        race['asian'] = 1.0
    race = {k: max(0.0, v or 0.0) for k, v in race.items()}
    total = sum(race.values()) or 1.0
    phenotype['race'] = {k: v / total for k, v in race.items()}

    male = a.gender >= 0.5
    sex = 'male' if male else 'female'
    skin = a.skin or (('middleage_' if phenotype['age'] > 0.62 else 'young_') + 'asian_' + sex)
    proxy = a.proxy
    if proxy == 'auto':
        proxy = 'male1591' if male else 'female1605'

    info = HumanService._create_default_human_info_dict()
    info.update({
        'phenotype': phenotype,
        'rig': a.rig,
        'eyes': asset('eyes', a.eyes, '.mhclo'),
        'eyebrows': asset('eyebrows', a.eyebrows, '.mhclo'),
        'eyelashes': asset('eyelashes', a.eyelashes, '.mhclo'),
        'hair': asset('hair', a.hair, '.mhclo'),
        'proxy': asset('proxymeshes', proxy, '.proxy'),
        'clothes': [asset('clothes', c, '.mhclo') for c in a.clothes],
        'skin_mhmat': asset('skins', skin, '.mhmat'),
        'skin_material_type': 'GAMEENGINE',
        'eyes_material_type': 'GAMEENGINE',
        'targets': [],
    })
    for t in a.target:
        name, value = t.split('=')
        info['targets'].append({'target': name.strip(), 'value': float(value)})
    # Eye colour is an alternative material on the eye mesh, keyed by the mesh's uuid.
    if info['eyes'] and a.eye_color != 'brown':
        info['alternative_materials'] = {mhclo_uuid('eyes', info['eyes']): 'materials/' + a.eye_color + '.mhmat'}
    return info


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def body_height(obj):
    # Soles to crown of the visible body, in metres: the evaluated mesh, so shape keys are mixed in
    # and the base mesh's helper geometry (the hair and clothes fitting cages, which stick out) is
    # masked off.
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    mesh = ev.to_mesh()
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    co = co.reshape(-1, 3) @ np.array(obj.matrix_world.to_3x3()).T
    return float(co[:, 2].max() - co[:, 2].min())


def standing_height(basemesh):
    # The base mesh's own height, with the masks that a proxy or clothes add switched off for the
    # measurement (they hide the body or parts of it), but the helper mask kept.
    hidden = [m for m in basemesh.modifiers if m.type == 'MASK' and m.name != 'Hide helpers' and m.show_viewport]
    for m in hidden:
        m.show_viewport = False
    height = body_height(basemesh)
    for m in hidden:
        m.show_viewport = True
    return height


def solve_height_macro(info, height_cm):
    # Standing height depends on gender, age, proportions and ethnicity as well as the height macro,
    # so search the macro on a throwaway base mesh (only macro targets: quick) until it matches.
    phenotype = info['phenotype']
    basemesh = HumanService.create_human(macro_detail_dict=json.loads(json.dumps(phenotype)))
    if info['targets']:
        TargetService.bulk_load_targets(basemesh, info['targets'])

    def height_at(value):
        HumanObjectProperties.set_value('height', value, entity_reference=basemesh)
        TargetService.reapply_macro_details(basemesh)
        bpy.context.view_layer.update()
        return body_height(basemesh) * 100

    lo, hi = 0.0, 1.0
    h_lo, h_hi = height_at(lo), height_at(hi)
    if not h_lo <= height_cm <= h_hi:
        print('mpfb_base: %.1f cm is outside %.1f-%.1f cm for this body; clamping' % (height_cm, h_lo, h_hi))
    value = lo
    for _ in range(12):
        # Regula falsi: height is close to linear in the macro, so this converges in a few steps.
        value = min(1.0, max(0.0, lo + (height_cm - h_lo) / max(h_hi - h_lo, 1e-6) * (hi - lo)))
        h = height_at(value)
        if abs(h - height_cm) < 0.05:
            break
        if h < height_cm:
            lo, h_lo = value, h
        else:
            hi, h_hi = value, h
    mesh = basemesh.data
    bpy.data.objects.remove(basemesh, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    phenotype['height'] = value
    print('mpfb_base: height macro %.4f -> %.1f cm' % (value, h))


def build(info):
    settings = HumanService.get_default_deserialization_settings()
    settings.update({
        'subdiv_levels': 0,  # baked explicitly below, on the proxy only
        'override_skin_model': 'GAMEENGINE',
        'override_clothes_model': 'GAMEENGINE',
        'override_eyes_model': 'GAMEENGINE',
        'material_instances': 'NEVER',
    })
    # deserialize_from_dict adds keys to the dict it gets, so give it a copy.
    basemesh = HumanService.deserialize_from_dict(json.loads(json.dumps(info)), settings)
    rig = basemesh.parent
    if rig is None or rig.type != 'ARMATURE':
        raise SystemExit('MPFB built no rig')
    return basemesh, rig


def apply_modifiers(obj):
    # Shape keys block modifier_apply, and the game needs none: bake them into the mesh first.
    if obj.data.shape_keys:
        TargetService.bake_targets(obj)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for mod in list(obj.modifiers):
        if mod.type == 'ARMATURE':
            continue
        if mod.type == 'SUBSURF':
            mod.levels = mod.render_levels
        if mod.show_viewport:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        else:
            obj.modifiers.remove(mod)


def limit_weights(obj):
    # glTF (and three.js) skin with 4 joints a vertex. The exporter would drop the rest itself; doing
    # it here keeps what gets dropped visible and renormalises the 4 that stay.
    if not obj.vertex_groups:
        return
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.vertex_group_clean(group_select_mode='BONE_DEFORM', limit=0.001)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='BONE_DEFORM', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM', lock_active=False)


def finish_meshes(basemesh, rig, proxy_used, subdiv, decimate):
    meshes = [o for o in rig.children_recursive if o.type == 'MESH']
    body = basemesh
    if proxy_used:
        body = ObjectService.find_object_of_type_amongst_nearest_relatives(basemesh, 'Proxymeshes')
        # With a proxy the base mesh is entirely masked off; its job (fitting the rig, the proxy and
        # the clothes) is done, so leave it out of the file.
        meshes.remove(basemesh)
        bpy.data.objects.remove(basemesh, do_unlink=True)
        if subdiv > 0:
            mod = body.modifiers.new('Subdivision', 'SUBSURF')
            mod.levels = subdiv
            mod.render_levels = subdiv
            # Subdivision before the armature, so the skin deforms the smoothed mesh.
            bpy.context.view_layer.objects.active = body
            bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    for obj in meshes:
        apply_modifiers(obj)
    if decimate and decimate < 1:
        # Collapse decimation interpolates UVs and bone weights, so the body stays skinnable. After the
        # masks are applied, so only what shows is counted.
        mod = body.modifiers.new('Decimate', 'DECIMATE')
        mod.ratio = decimate
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for obj in meshes:
        limit_weights(obj)
    return meshes


def image_has_alpha(img, cache={}):
    if img.name not in cache:
        px = np.empty(img.size[0] * img.size[1] * img.channels, dtype=np.float32)
        img.pixels.foreach_get(px)
        cache[img.name] = img.channels == 4 and float(px[3::4].min()) < 0.99
    return cache[img.name]


def material_alpha(meshes, mode):
    # MPFB's game engine material links the diffuse texture's alpha into the BSDF for everything,
    # which glTF would export as BLEND even for the skin. Where the texture is opaque the link goes
    # (OPAQUE); on the rest (brows, lashes, the eyes' cornea, hair, lace) a Round node in between
    # makes the exporter write alphaMode MASK at 0.5, unless --alpha blend.
    for obj in meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.node_tree:
                continue
            tree = mat.node_tree
            for node in tree.nodes:
                if node.type != 'BSDF_PRINCIPLED' or not node.inputs['Alpha'].is_linked:
                    continue
                link = node.inputs['Alpha'].links[0]
                img = getattr(link.from_node, 'image', None)
                if img is not None and not image_has_alpha(img):
                    tree.links.remove(link)
                    node.inputs['Alpha'].default_value = 1.0
                    continue
                if mode != 'clip' or link.from_node.type == 'MATH':
                    continue
                rnd = tree.nodes.new('ShaderNodeMath')
                rnd.operation = 'ROUND'
                tree.links.new(link.from_socket, rnd.inputs[0])
                tree.links.new(rnd.outputs[0], node.inputs['Alpha'])


def limit_textures(meshes, max_px):
    seen = set()
    for obj in meshes:
        for slot in obj.material_slots:
            if not slot.material or not slot.material.node_tree:
                continue
            for node in slot.material.node_tree.nodes:
                img = getattr(node, 'image', None)
                if img is None or img.name in seen:
                    continue
                seen.add(img.name)
                w, h = img.size
                if max(w, h) > max_px:
                    k = max_px / max(w, h)
                    img.scale(max(1, round(w * k)), max(1, round(h * k)))


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def export_glb(path, rig, meshes):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(path),
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,  # already applied (except the armature) in finish_meshes
        export_skins=True,
        export_morph=False,
        export_animations=False,
        export_materials='EXPORT',
        export_image_format='AUTO',
    )


def world_points(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for obj in objs:
        ev = obj.evaluated_get(dg)
        mesh = ev.to_mesh()
        co = np.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get('co', co)
        ev.to_mesh_clear()
        m = np.array(obj.matrix_world)
        pts.append(co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3])
    return np.concatenate(pts)


def render_preview(path, meshes):
    # Workbench with studio light and textures: quick, neutral, enough to judge shape and proportions.
    # Orthographic front, three-quarter and side views side by side, all at one scale (so they
    # compare), each framed on the whole body including the arms of the A-pose.
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = False
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.color = (0.55, 0.56, 0.58)
    scene.view_settings.view_transform = 'Standard'
    w, h = 560, 1000
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'

    cam_data = bpy.data.cameras.new('PreviewCam')
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('PreviewCam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    pts = world_points(meshes)
    z0, z1 = pts[:, 2].min(), pts[:, 2].max()
    # MakeHuman characters face -Y. Angles turn the camera round to the character's left.
    angles = [math.radians(d) for d in (0, 35, 90)]
    spans = []
    for a in angles:
        across = pts[:, 0] * math.cos(a) + pts[:, 1] * math.sin(a)
        spans.append((across.min(), across.max()))
    width = max(hi - lo for lo, hi in spans)
    # ortho_scale is the larger image side in world units (here the height).
    cam_data.ortho_scale = max(z1 - z0, width * h / w) * 1.06

    views = []
    tmp = tempfile.mkdtemp()
    for i, (a, (lo, hi)) in enumerate(zip(angles, spans)):
        mid = (lo + hi) / 2
        cam.location = (10 * math.sin(a) + mid * math.cos(a), -10 * math.cos(a) + mid * math.sin(a), (z0 + z1) / 2)
        cam.rotation_euler = (math.pi / 2, 0, a)
        scene.render.filepath = os.path.join(tmp, 'view%d.png' % i)
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(scene.render.filepath)
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        views.append(px.reshape(h, w, 4))
        bpy.data.images.remove(img)
    sheet = np.concatenate(views, axis=1)
    out = bpy.data.images.new('preview', width=w * len(views), height=h, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    out.filepath_raw = os.path.abspath(path)
    out.file_format = 'PNG'
    out.save()


def main():
    a = parse_args()
    clear_scene()
    if a.from_preset:
        with open(a.from_preset, encoding='utf-8') as f:
            info = json.load(f)
    else:
        info = human_info_from_args(a)
        if a.height_cm:
            solve_height_macro(info, a.height_cm)
    if a.preset:
        with open(a.preset, 'w', encoding='utf-8') as f:
            json.dump(info, f, indent=4)

    basemesh, rig = build(info)
    height = standing_height(basemesh)
    meshes = finish_meshes(basemesh, rig, bool(info.get('proxy')), a.subdiv, a.decimate)
    material_alpha(meshes, a.alpha)
    limit_textures(meshes, a.max_tex)

    report = {
        'height_cm': round(height * 100, 1),
        'overall_cm': round(float(np.ptp(world_points(meshes)[:, 2])) * 100, 1),
        'phenotype': info['phenotype'],
        'meshes': {o.name: triangles(o) for o in meshes},
        'triangles': sum(triangles(o) for o in meshes),
        'bones': [b.name for b in rig.data.bones],
    }
    print('MPFB_REPORT ' + json.dumps(report))
    if a.out:
        export_glb(a.out, rig, meshes)
    if a.preview:
        render_preview(a.preview, meshes)


if __name__ == '__main__':
    main()
