"""Converts Quaternius' Animal Pack Vol.2 FBX files (CC0, .cache/animals/oga-vol2) to .glb with their animations, for viewing.

  blender -b -P scripts/animals/fbx_to_glb.py -- <in.fbx> <out.glb>
"""
import sys, bpy

a = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=a[0])
for ob in bpy.data.objects:
    print(ob.type, ob.name)
print("actions", [x.name for x in bpy.data.actions])
bpy.ops.export_scene.gltf(filepath=a[1], export_format="GLB", export_animations=True, export_skins=True)
