"""What each reference model in refs/models/ is (scripts/refs/sketchfab.mjs downloads them): its meshes and their
sizes, whether it has a skeleton and which bones, how tall it stands and how its arms are held at rest.

    "<blender.exe>" -b --python scripts/refs/survey.py [-- name ...]

Reference models are looked at and measured, never used in the game (refs/README.md)."""
import bpy, glob, os, re, sys
from mathutils import Vector

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'refs', 'models')
only = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
KEY = re.compile(r'(clav|shoulder|collar|upperarm|upper_arm|arm|elbow|twist|roll|hand|wrist|thumb|index|middle|ring|pinky|little|finger|neck|head|spine|chest|breast|bust)', re.I)

for path in sorted(glob.glob(os.path.join(ROOT, '*', 'model.glb'))):
    name = os.path.basename(os.path.dirname(path))
    if only and name not in only:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception as e:  # noqa: BLE001
        print(f'== {name}: could not be opened: {e}')
        continue
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    size = hi - lo
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    print(f'== {name}: {len(meshes)} meshes, {tris} triangles, {len(arms)} skeletons; stands {size.z:.2f} tall, {size.x:.2f} wide, {size.y:.2f} deep')
    for o in sorted(meshes, key=lambda o: -len(o.data.vertices))[:10]:
        skinned = any(m.type == 'ARMATURE' for m in o.modifiers)
        mats = ', '.join(s.material.name for s in o.material_slots if s.material)[:60]
        print(f'   mesh {o.name[:34]:34} {len(o.data.vertices):7} points {len(o.data.polygons):7} faces  groups {len(o.vertex_groups):3}  {"skinned" if skinned else "not skinned"}  [{mats}]')
    for a in arms:
        bones = a.data.bones
        hits = [b.name for b in bones if KEY.search(b.name)]
        print(f'   skeleton {a.name}: {len(bones)} bones; of the upper body and hands {len(hits)}:')
        for i in range(0, len(hits), 8):
            print('      ' + ', '.join(hits[i:i + 8]))
        if not hits:
            print('      (none named so; first bones: ' + ', '.join(b.name for b in list(bones)[:16]) + ')')
