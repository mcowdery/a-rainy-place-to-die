"""Rigs a static animal model (a Poly Pizza .glb in assets/animals/candidates/) and gives it clips, for the showrooms.

  blender -b -P scripts/animals/rig.py -- <rig name> <absolute out dir> [preview] [export <out.glb>]

A rig is a Python file in scripts/animals/rigs/<name>.py that defines
  SRC     the model's .glb (relative to the repository root)
  BONES   [(name, parent or None, head (x, y, z), tail (x, y, z), radius)]  in the model's own space as Blender imports it
          (Z up, the animal facing -Y, feet near the bottom); radius is how far the bone's influence reaches (model units)
          a ("move", (dx, dy, dz)) in place of an axis slides the bone and all that hangs from it (the pelvis lowers the body to sit)
  CLIPS   {clip name: (frames, fps, pose)} where pose(t) -> {bone name: (axis 'x'|'y'|'z', degrees)} or a list of those,
          t in 0-1 round the loop; a bone's angle turns it and what hangs from it about that world axis through its head
  PREVIEW the clip names to show in a contact sheet, and the number of frames each

How the weights are made: every vertex takes a weight from each bone that falls off with its distance from the bone's
segment (exp(-(d/radius)^2)), the three strongest kept and normalised, so a leg moves what's near the leg and the body
what's near the spine. It's rough, and made for low-poly bodies; the sheet shows where it tears.

Every rotation is about a world axis (a swing about X is a leg's walk, about Y a wing's flap), so rotations down a chain
just add, and a bone's local axis for it is the world axis taken into the bone's rest frame.
"""
import sys, os, math, importlib.util
import bpy
from mathutils import Vector, Quaternion, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
NAME, OUT = args[0], args[1]
PREVIEW = "preview" in args
EXPORT = args[args.index("export") + 1] if "export" in args else None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
spec_path = os.path.join(os.path.dirname(__file__), "rigs", NAME + ".py")
sp = importlib.util.spec_from_file_location("rigspec", spec_path)
spec = importlib.util.module_from_spec(sp)
sp.loader.exec_module(spec)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, spec.SRC))
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
# One mesh in the world's space, no parents.
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o)
if len(meshes) > 1:
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
mesh = bpy.context.view_layer.objects.active or meshes[0]
mesh = [o for o in bpy.data.objects if o.type == "MESH"][0]

# A spec with a KIND is fitted to the mesh (scripts/animals/autorig.py) rather than listing its own bones.
if hasattr(spec, "KIND"):
    sys.path.insert(0, os.path.dirname(__file__))
    import autorig
    got = autorig.generate(spec.KIND, [mesh.matrix_world @ v.co for v in mesh.data.vertices], spec.FORWARD, getattr(spec, "OPTS", {}))
    for k, v in got.items():
        setattr(spec, k, v)

# A bone may end with a sixth number: how sharply its pull falls off (2 the default, 4 for a thin leg beside the body).
BONES6 = [tuple(b) + (2,) if len(b) == 5 else tuple(b) for b in spec.BONES]

# ---- the armature ----
arm_data = bpy.data.armatures.new("Rig")
arm = bpy.data.objects.new("Rig", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for name, parent, head, tail, radius, _p in BONES6:
    eb = arm_data.edit_bones.new(name)
    eb.head = Vector(head)
    eb.tail = Vector(tail)
    if (eb.tail - eb.head).length < 1e-3:
        eb.tail = eb.head + Vector((0, 0, 1e-2))
    if parent:
        eb.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

# ---- the weights ----
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length

bones = [(n, Vector(h), Vector(t), r, p) for n, _, h, t, r, p in BONES6]
for n, *_ in bones:
    mesh.vertex_groups.new(name=n)
for v in mesh.data.vertices:
    ws = []
    for n, h, t, r, pw in bones:
        d = seg_dist(v.co, h, t)
        ws.append((math.exp(-((d / r) ** pw)), n))
    ws.sort(reverse=True)
    top = [w for w in ws[:3] if w[0] > 1e-4] or [ws[0]]
    tot = sum(w for w, _ in top)
    for w, n in top:
        mesh.vertex_groups[n].add([v.index], w / tot, "REPLACE")
mod = mesh.modifiers.new("Armature", "ARMATURE")
mod.object = arm
mesh.parent = arm

# ---- clips ----
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
rest = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
AXES = {"x": Vector((1, 0, 0)), "y": Vector((0, 1, 0)), "z": Vector((0, 0, 1))}

def apply(pose):
    """pose: {bone: (axis, degrees)} or a list of them (several axes on one bone compose in order)."""
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
        pb.location = Vector((0, 0, 0))
    for name, turns in pose.items():
        pb = arm.pose.bones[name]
        if isinstance(turns, tuple):
            turns = [turns]
        q = Quaternion((1, 0, 0, 0))
        for axis, deg in turns:
            if axis == "move":  # ("move", (dx, dy, dz)): slides the bone (and all that hangs from it) in world units
                pb.location = rest[name].inverted() @ Vector(deg)
                continue
            local = rest[name].inverted() @ AXES[axis]
            q = q @ Quaternion(local, math.radians(deg))
        pb.rotation_quaternion = q

def lowest():
    """The height of the posed mesh's feet: its 3rd-percentile z (so a tail tip through the floor doesn't count)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    zs = sorted((ev.matrix_world @ v.co).z for v in ev.data.vertices)
    return zs[int(len(zs) * 0.03)]

def grounded(pose, ground_z):
    """A resting clip (Sit, Loaf) has its pelvis slid up or down till the lowest of the body just touches the floor."""
    pose = dict(pose)
    turns = pose.get("pelvis", [])
    turns = [turns] if isinstance(turns, tuple) else list(turns)
    base = next((t[1] for t in turns if t[0] == "move"), (0, 0, 0))
    turns = [t for t in turns if t[0] != "move"]
    dz = 0.0
    for _ in range(3):
        pose["pelvis"] = turns + [("move", (base[0], base[1], base[2] + dz))]
        apply(pose)
        bpy.context.view_layer.update()
        err = ground_z - lowest()
        if abs(err) < 1e-3 * max(1.0, abs(ground_z)):
            break
        dz += err
    return pose

arm.animation_data_create()
actions = {}
bpy.context.view_layer.update()
if not hasattr(spec, "GROUND_Z"):
    spec.GROUND_Z = lowest()
for cname, (frames, fps, pose) in spec.CLIPS.items():
    act = bpy.data.actions.new(cname)
    arm.animation_data.action = act
    bpy.context.scene.render.fps = fps
    n = frames if getattr(spec, "LOOPS", {}).get(cname, True) else frames - 1
    for f in range(frames):
        posed = pose(f / max(1, n))
        if cname in getattr(spec, "GROUNDED", ()):
            posed = grounded(posed, spec.GROUND_Z)
        apply(posed)
        for pb in arm.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=f + 1)
            pb.keyframe_insert("location", frame=f + 1)
    act.use_fake_user = True
    actions[cname] = act
arm.animation_data.action = None
apply({})

# ---- the contact sheet ----
def render_sheet(clips):
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_WORKBENCH"
    scn.render.resolution_x, scn.render.resolution_y = 360, 300
    scn.display.shading.light = "STUDIO"
    scn.display.shading.color_type = "SINGLE"
    scn.display.shading.single_color = (0.78, 0.74, 0.66)
    scn.world = bpy.data.worlds.new("w")
    scn.world.color = (0.2, 0.21, 0.25)
    vs = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = (mn + mx) / 2
    size = max(mx - mn) * getattr(spec, "VIEW", 1.35)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size
    cam.data.clip_end = size * 10
    cam.data.clip_start = size * 0.01
    fwd = getattr(spec, "FORWARD", None)
    view = getattr(spec, "VIEW_FROM", "side")
    along_y = fwd is None or fwd[1] == "y"
    # (Facing along Y, the side is seen from +X and the head-on view from -Y; facing along X, the other way round.)
    from_x = (view == "side") == along_y
    if view == "top":
        cam.location = c + Vector((0, 0, size * 2))
        cam.rotation_euler = (0, 0, 0)
    elif from_x:
        cam.location = c + Vector((size * 2, 0, 0))
        cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    else:
        cam.location = c + Vector((0, -size * 2, 0))
        cam.rotation_euler = (math.radians(90), 0, 0)
    manifest = []
    for r, (cname, count) in enumerate(clips):
        frames, fps, pose = spec.CLIPS[cname]
        for i in range(count):
            posed = pose((i / count) if getattr(spec, "LOOPS", {}).get(cname, True) else i / max(1, count - 1))
            if cname in getattr(spec, "GROUNDED", ()):
                posed = grounded(posed, spec.GROUND_Z)
            apply(posed)
            bpy.context.view_layer.update()
            f = os.path.join(OUT, f"_{NAME}-{r}-{i}.png")
            scn.render.filepath = f
            bpy.ops.render.render(write_still=True)
            manifest.append((r, i, f))
    open(os.path.join(OUT, f"_{NAME}.manifest"), "w").write(chr(10).join(f"{r} {i} {f}" for r, i, f in manifest))


os.makedirs(OUT, exist_ok=True)
if PREVIEW:
    render_sheet(spec.PREVIEW)

if EXPORT:
    apply({})
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.export_scene.gltf(filepath=EXPORT, export_format="GLB", export_animations=True, export_skins=True, export_animation_mode="ACTIONS")
    print("exported", EXPORT, list(actions))
