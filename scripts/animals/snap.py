"""blender -b -P scripts/animals/snap.py -- <glb> <out prefix> : renders a model from the side (looking along X), the front (along Y) and above, flat grey, in Blender's Z-up space."""
import sys, math, bpy
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
scn = bpy.context.scene
scn.render.engine = "BLENDER_WORKBENCH"
scn.render.resolution_x = scn.render.resolution_y = 500
scn.display.shading.light = "STUDIO"
scn.display.shading.color_type = "OBJECT"
scn.world = bpy.data.worlds.new("w"); scn.world.color = (0.2, 0.2, 0.24)
vs = [ob.matrix_world @ v.co for ob in bpy.data.objects if ob.type == "MESH" for v in ob.data.vertices]
mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
c = (mn + mx) / 2
size = max(mx - mn) * 1.15
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scn.collection.objects.link(cam); scn.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = size
for name, off, rot in [("side", (1, 0, 0), (90, 0, 90)), ("front", (0, -1, 0), (90, 0, 0)), ("top", (0, 0, 1), (0, 0, 0))]:
    cam.location = c + Vector(off) * size * 2
    cam.rotation_euler = [math.radians(r) for r in rot]
    scn.render.filepath = f"{a[1]}-{name}.png"
    bpy.ops.render.render(write_still=True)
