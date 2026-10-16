"""A textured figure rendered from Pixal3D's multi-view rig: views that agree with each other by construction.

  blender -b --python scripts/blender/render_mv_rig.py -- <figure.glb> <out dir> [--azimuths 0,90,180,270] [--fov 20] [--size 1024]

Pixal3D's multi-view model was trained on renders: an object fitted to the unit cube (its largest side 1), the camera 0.55 / tan(fov/2) away
(3.1192 at 20 degrees, so the frame is 1.1 across at the object), looking at the middle, the canonical front view at (0, -d, 0) in a Z-up world.
Views from an image editor are not that (they disagree about the stance and the content); these are. For the round-trip test: send these to
the worker (`mesh_endpoint.mjs front.png --engine pixal3d --cutout yes --fov 0.349 --view 90:view90.png ...`) and see whether it makes the
figure again, which says whether our pipeline is right apart from the pictures. Azimuth 90 is the camera at +x (the right of the front picture),
180 behind, 270 at -x. Writes front.png and view<azimuth>.png as RGBA (the render's own alpha).
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

args = [a for a in sys.argv[sys.argv.index('--') + 1 :] if not a.startswith('--')]
glb, out = (os.path.abspath(a) for a in args[:2])
opt = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d  # noqa: E731
AZ = [float(a) for a in opt('--azimuths', '0,90,180,270').split(',')]
FOV = math.radians(float(opt('--fov', 20)))
SIZE = int(opt('--size', 1024))
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(meshes) == 1, 'the figure alone'
ob = meshes[0]
ob.parent = None
bpy.context.view_layer.objects.active = ob
bpy.ops.object.select_all(action='DESELECT')
ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
co = np.array([v.co[:] for v in ob.data.vertices])
lo, hi = co.min(axis=0), co.max(axis=0)
k = 1.0 / float((hi - lo).max())
centre = (lo + hi) / 2
for v in ob.data.vertices:
    v.co = Vector(((np.array(v.co[:]) - centre) * k).tolist())
ob.data.update()

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
textured = any(n.type == 'TEX_IMAGE' for m in ob.data.materials if m and m.node_tree for n in m.node_tree.nodes)
sc.display.shading.color_type = 'TEXTURE' if textured else 'SINGLE'  # (a shape with no colour of its own is drawn in a skin tone)
sc.display.shading.single_color = (0.83, 0.62, 0.50)
sc.display.shading.light = 'STUDIO'
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = SIZE
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
cam_data = bpy.data.cameras.new('rig')
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.angle_x = FOV
cam = bpy.data.objects.new('rig', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
d = 0.55 / math.tan(FOV / 2)
for a in AZ:
    r = math.radians(a)
    cam.location = Vector((d * math.sin(r), -d * math.cos(r), 0.0))
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    name = 'front.png' if a == 0 else f'view{int(a)}.png'
    sc.render.filepath = os.path.join(out, name)
    bpy.ops.render.render(write_still=True)
print(f'RIG {len(AZ)} views at {math.degrees(FOV):.0f} degrees, camera {d:.4f} away, figure scaled by {k:.4f}')
