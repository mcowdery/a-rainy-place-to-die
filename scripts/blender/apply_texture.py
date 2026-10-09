"""A hand-painted colour texture put back on the body it was painted for (paint_setup.py's other half).

  "<blender.exe>" -b --python scripts/blender/apply_texture.py -- <body.glb> <painted.png> <out.glb> [--no-normal]

The mesh and its UVs are the .glb's own, untouched: only the colour image is swapped for the painted one.
"""
import os
import sys

import bpy

glb, painted, out = (os.path.abspath(a) for a in sys.argv[sys.argv.index('--') + 1 :][:3])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
body = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
nodes = body.data.materials[0].node_tree.nodes
colour = next(n for n in nodes if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB')
new = bpy.data.images.load(painted)
new.colorspace_settings.name = 'sRGB'
new.alpha_mode = 'NONE'
assert tuple(new.size) == tuple(colour.image.size), (tuple(new.size), tuple(colour.image.size))
colour.image = new
new.pack()
if '--no-normal' in sys.argv:
    # The baked normal map is garbage where the generated surface had gaps (brows, eyes, nose, mouth: a light patch, dark smudges): drop it.
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    for link in list(bsdf.inputs['Normal'].links):
        body.data.materials[0].node_tree.links.remove(link)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG')
print('WROTE', out)
