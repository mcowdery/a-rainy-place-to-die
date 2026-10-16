"""blender -b -P scripts/animals/bones_dump.py -- <rig name> : prints the fitted bones (head -> tail, radius) and the mesh's size, in Blender's space."""
import sys, os, bpy
sys.path.insert(0, os.path.dirname(__file__))
import importlib.util, autorig
from mathutils import Matrix
name = sys.argv[sys.argv.index("--") + 1]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sp = importlib.util.spec_from_file_location("s", os.path.join(os.path.dirname(__file__), "rigs", name + ".py"))
spec = importlib.util.module_from_spec(sp); sp.loader.exec_module(spec)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, spec.SRC))
vs = [o.matrix_world @ v.co for o in bpy.data.objects if o.type == "MESH" for v in o.data.vertices]
f = autorig.Frame(vs, spec.FORWARD)
print("U", round(f.U0, 2), round(f.U1, 2), "Z", round(f.Z0, 2), round(f.Z1, 2), "W", round(f.W, 2), "lc", round(f.lc, 2))
g = autorig.generate(spec.KIND, vs, spec.FORWARD, getattr(spec, "OPTS", {}))
for b in g["BONES"]:
    print(b[0], [round(x, 1) for x in b[2]], "->", [round(x, 1) for x in b[3]], "r", round(b[4], 1))
pw = autorig.paws(f)
for k, v in pw.items():
    print("PAW", k, [round(x, 3) for x in v])
