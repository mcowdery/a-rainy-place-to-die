"""Renders a reference model's upper body (chest, shoulders, neck, arms) from front, 3/4 and side, for a close look
at its sculpted detail next to our own screenshots (measure_upper.py gives numbers; this gives something to look at).
Studio lighting, no materials (clay grey), so its own colours and textures don't distract from its shape.

    "<blender.exe>" -b --python scripts/refs/render_upper.py -- <name> [out.png] [--pose] [--full]

Reference models are looked at and measured, never used in the game (refs/README.md)."""
import bpy, math, os, sys
from mathutils import Vector

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'refs', 'models')
args = sys.argv[sys.argv.index('--') + 1:]
name = args[0]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'debug-shots', 'refs', (args[1] if len(args) > 1 and not args[1].startswith('--') else name + '.png'))
full = '--full' in args
os.makedirs(os.path.dirname(out), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, name, 'model.glb'))
arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
if arms and '--pose' in args:
    arm = max(arms, key=lambda o: len(o.data.bones))
    bpy.context.scene.frame_set(bpy.context.scene.frame_start)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
# Clay grey for every mesh: its own colours would draw the eye more than its shape.
clay = bpy.data.materials.new('clay')
clay.diffuse_color = (0.6, 0.57, 0.53, 1)
clay.roughness = 0.7
for o in meshes:
    o.data.materials.clear()
    o.data.materials.append(clay)

lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
for o in meshes:
    eo = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    for v in eo.to_mesh().vertices:
        w = eo.matrix_world @ v.co
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
    eo.to_mesh_clear()
up = 2 if (hi.z - lo.z) > (hi.y - lo.y) else 1
H = (hi - lo)[up]
mid = (lo + hi) / 2
other = 3 - up - 0
# A point partway up the figure (its own units): the chin's height to frame from chest to chin, or the floor for the
# whole figure.
target = Vector((mid.x, mid.y, mid.z))
target[up] = lo[up] + (H if full else 0.70 * H)
R = (H if full else 0.34 * H)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'SINGLE'
scene.display.shading.single_color = (0.62, 0.59, 0.55)
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = 'BOTH'
scene.display.shading.curvature_ridge_factor = 1.5
scene.display.shading.curvature_valley_factor = 1.5
scene.render.resolution_x, scene.render.resolution_y = 900, 1200
scene.render.film_transparent = False
world = bpy.data.worlds.new('w')
scene.world = world

def add_light(loc, energy=800):
    return None

cam_data = bpy.data.cameras.new('c')
cam_data.lens = 85
cam = bpy.data.objects.new('c', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

views = [('front', 0), ('3q', 50), ('side', 90), ('back', 180)] if not full else [('front', 0), ('side', 90)]
for vname, yaw in views:
    t = math.radians(yaw)
    dirv = Vector((math.sin(t), -math.cos(t), 0)) if up == 2 else Vector((math.sin(t), 0, -math.cos(t)))
    pos = target + dirv * (R * 2.6)
    pos[up] = target[up] + 0.05 * H
    cam.location = pos
    up_v = Vector((0, 0, 1)) if up == 2 else Vector((0, 1, 0))
    fwd = (target - pos).normalized()
    right = fwd.cross(up_v).normalized()
    true_up = right.cross(fwd).normalized()
    m = cam.matrix_world
    m.identity()
    m.col[0][:3], m.col[1][:3], m.col[2][:3], m.col[3][:3] = list(right), list(true_up), list(-fwd), list(pos)
    for l in [a for a in scene.objects if a.type == 'LIGHT']:
        bpy.data.objects.remove(l, do_unlink=True)
    key = pos + right * R * 1.5 + true_up * R
    key[up] = target[up] + 0.4 * H
    fill = target - dirv * R * 2 + right * R * 2
    fill[up] = target[up]
    add_light(key, 35 * H * H)
    add_light(fill, 10 * H * H)
    scene.render.filepath = out.replace('.png', f'_{vname}.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', scene.render.filepath)
