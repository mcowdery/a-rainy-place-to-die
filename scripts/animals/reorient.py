"""blender -b -P scripts/animals/reorient.py -- <id> <axis x|y|z> <degrees> : turns a candidate about a Blender axis, bakes it into the mesh and re-saves candidates/<id>.glb (for a model exported on its side)."""
import sys, os, math, bpy
from mathutils import Matrix
a = sys.argv[sys.argv.index("--") + 1:]
pid, axis, deg = a[0], a[1].upper(), float(a[2])
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
f = os.path.join(ROOT, "assets", "animals", "candidates", pid + ".glb")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f)
R = Matrix.Rotation(math.radians(deg), 4, axis)
for o in bpy.data.objects:
    if o.type == "MESH":
        mw = o.matrix_world.copy(); o.parent = None
        o.data.transform(R @ mw); o.matrix_world = Matrix.Identity(4)
        zs = [v.co.z for v in o.data.vertices]
        o.data.transform(Matrix.Translation((0, 0, -min(zs))))
for o in list(bpy.data.objects):
    if o.type != "MESH": bpy.data.objects.remove(o)
bpy.ops.export_scene.gltf(filepath=f, export_format="GLB")
print("reoriented", pid)
