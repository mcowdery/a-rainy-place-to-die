"""blender -b -P scripts/animals/snap_many.py -- <out dir> <id> [<id> ...] : for each candidate, a side, front and top render in Blender's Z-up space, named <id>-side|front|top.png (camera on +X, on -Y, above), to read which way each faces."""
import sys, math, bpy, os
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]
out, ids = a[0], a[1:]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
for pid in ids:
    print('ID', pid, flush=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fp = os.path.join(ROOT, "assets", "animals", "candidates", pid + ".glb"); print("FP", fp, os.path.exists(fp), flush=True)
    bpy.ops.import_scene.gltf(filepath=fp)
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_WORKBENCH"
    scn.render.resolution_x = scn.render.resolution_y = 300
    scn.display.shading.light = "STUDIO"
    scn.display.shading.color_type = "SINGLE"
    scn.display.shading.single_color = (0.8, 0.76, 0.68)
    scn.world = bpy.data.worlds.new("w"); scn.world.color = (0.2, 0.2, 0.24)
    vs = [ob.matrix_world @ v.co for ob in bpy.data.objects if ob.type == "MESH" for v in ob.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = (mn + mx) / 2
    size = max(mx - mn) * 1.15
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scn.collection.objects.link(cam); scn.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = size; cam.data.clip_end = size * 10; cam.data.clip_start = size * 0.01
    for name, off, rot in [("side", (1, 0, 0), (90, 0, 90)), ("front", (0, -1, 0), (90, 0, 0)), ("top", (0, 0, 1), (0, 0, 0))]:
        cam.location = c + Vector(off) * size * 2
        cam.rotation_euler = [math.radians(r) for r in rot]
        scn.render.filepath = os.path.join(out, f"{pid}-{name}.png")
        bpy.ops.render.render(write_still=True)
    print("SIZE", pid, [round(x, 2) for x in (mx - mn)])
