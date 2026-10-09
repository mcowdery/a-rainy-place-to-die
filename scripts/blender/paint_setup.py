"""A figure's body made ready to paint by hand in Blender's Texture Paint.

  "<blender.exe>" -b --python scripts/blender/paint_setup.py -- <body.glb> <out folder> [stencil.png ...]

Each stencil picture after the folder is loaded in the file as a brush texture (stencil mapping), the first one on the Draw brush: in
Texture Paint, move it with the right mouse button, scale it with Shift+right, turn it with Ctrl+right, line it up on the model in the view,
then paint it on.

Writes into the folder: `paint_me.blend` (the body, its colour texture the one the paint goes on), `colour.png` (the
texture, the file the paint is saved to) and `colour_original.png` (an untouched copy, to go back to). The mesh is not to
be changed while painting (only the texture): `scripts/blender/apply_texture.py` puts the painted `colour.png` back on
the body's .glb by the same UVs.
"""
import os
import shutil
import sys

import bpy

rest = sys.argv[sys.argv.index('--') + 1 :]
glb, out = (os.path.abspath(a) for a in rest[:2])
stencils = [os.path.abspath(a) for a in rest[2:]]
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(meshes) == 1, f'{len(meshes)} meshes: this takes the body alone'
body = meshes[0]
body.name = 'body'
mat = body.data.materials[0]
nodes = mat.node_tree.nodes
colour = next(n for n in nodes if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB')
image = colour.image
image.filepath_raw = os.path.join(out, 'colour.png')
image.file_format = 'PNG'
image.save()
shutil.copy(image.filepath_raw, os.path.join(out, 'colour_original.png'))
image.name = 'colour.png'
# The texture that the paint goes on: the material's active image node.
for n in nodes:
    n.select = False
colour.select = True
nodes.active = colour
# Seen as it is, whatever the lights: the colour also drives the emission, so the paint reads true in any viewport shading.
bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
links = mat.node_tree.links
links.new(colour.outputs['Color'], bsdf.inputs['Emission Color'])
bsdf.inputs['Emission Strength'].default_value = 1.0
bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
for link in list(bsdf.inputs['Base Color'].links):
    links.remove(link)
bpy.context.view_layer.objects.active = body
body.select_set(True)
# The stencils: each picture as an image texture, the first one on the paint brush with stencil mapping.
brush = bpy.context.tool_settings.image_paint.brush
for n_, path in enumerate(stencils):
    img = bpy.data.images.load(path)
    img.name = os.path.basename(path)
    tex = bpy.data.textures.new('stencil_' + os.path.splitext(os.path.basename(path))[0], 'IMAGE')
    tex.image = img
    tex.use_fake_user = True
    if n_ == 0 and brush is not None:
        try:
            brush.texture = tex
            brush.texture_slot.map_mode = 'STENCIL'
            print('STENCIL on the brush:', brush.name, img.name)
        except Exception as e:  # noqa: BLE001
            print('stencil not set on the brush:', e)
# (A window with the Texture Paint workspace up front, when this runs with a window to set it on.)
try:
    window = bpy.context.window_manager.windows[0]
    window.workspace = bpy.data.workspaces['Texture Paint']
except Exception as e:  # noqa: BLE001
    print('workspace not set:', e)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'paint_me.blend'))
print('PAINT FILE', os.path.join(out, 'paint_me.blend'), image.size[0], 'px texture')
