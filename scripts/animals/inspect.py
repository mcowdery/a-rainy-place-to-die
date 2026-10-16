"""Prints a glb's armature bones (head positions), actions and materials: blender -b -P scripts/animals/inspect.py -- <file.glb>"""
import sys, bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index("--") + 1])
for ob in bpy.data.objects:
    print("OBJ", ob.type, ob.name, [round(x, 2) for x in ob.location], [round(x, 2) for x in ob.rotation_euler], [round(x, 3) for x in ob.scale])
    if ob.type == "ARMATURE":
        for b in ob.data.bones:
            print("  bone", b.name, "parent", b.parent.name if b.parent else None, [round(x, 2) for x in b.head_local], [round(x, 2) for x in b.tail_local])
    if ob.type == "MESH":
        print("  mats", [(m.name, [round(c, 2) for c in m.diffuse_color[:3]]) for m in ob.data.materials], "verts", len(ob.data.vertices))
for a in bpy.data.actions:
    print("ACTION", a.name, [round(x) for x in a.frame_range])
