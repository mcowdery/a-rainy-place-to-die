"""blender -b -P scripts/animals/probe.py -- <glb> : size, orientation, material and part layout of a static animal model."""
import sys, bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index("--") + 1])
for ob in bpy.data.objects:
    if ob.type != "MESH": continue
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    print("MESH", ob.name, "verts", len(vs), "polys", len(ob.data.polygons), "min", [round(x, 3) for x in mn], "max", [round(x, 3) for x in mx])
    print("  mats", [(m.name, [round(c, 2) for c in m.diffuse_color[:3]]) for m in ob.data.materials])
    # vertex count per material
    from collections import Counter
    c = Counter(p.material_index for p in ob.data.polygons)
    print("  polys per mat", dict(c))
