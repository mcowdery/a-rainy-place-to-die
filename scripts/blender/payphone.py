"""A public telephone (公衆電話), modelled for interaction: every part you touch is its own object, with its origin at
the point it moves about, so the game can lift the handset, press a key, push the return flap or swing a door.

  "<blender.exe>" -b --python scripts/blender/payphone.py -- <out.glb> [--mount hood|booth|stand] [--color red|pink]
      [--low] [--preview <dir>]

    --mount hood   the green card-and-coin phone on a post under a hood (default)
    --mount booth  a telephone booth (green frame, glass, a hinged door, a lit roof sign) with the phone on its back wall
    --mount stand  the older coin phone on a stand, for a shop front in a lane: red (a tobacconist's, a grocer's) or,
                   with --color pink, the pink one a bar or a snack keeps by its door. A rotary dial, the handset
                   lying across its top.
    --low          the same phone for the middle distance: no bevels, numerals, screws or cord, round parts in eight
                   sides, the keys one plate, and everything joined into one object (`payphone_low`). A few hundred
                   triangles against five thousand.

Writes <out.glb>: y up, facing +z, standing on y 0, metres, plain PBR materials (no textures: the display, the lit
strip and the sign are emissive). Nodes (the names the game finds them by):

  payphone_body   the post, housing, hood (or the booth's frame, roof and shelf), the sign plate, card and coin slots
  handset         origin at its middle; rests in the cradle at the identity pose (lift it off by moving it)
  hook_switch     the little plunger in the cradle: pops up when the handset is off (origin at its foot)
  cord            the coiled cord in the rest pose (static: a game that moves the handset draws its own between the two
                  anchors below)
  key_0..key_9, key_star, key_hash   twelve keys; origin at the middle of the key's face, press by moving -z (into the phone)
  dial            (stand only, in place of the keys and display) the finger wheel; origin at its centre, turns about z
  display         the amber LCD (emissive), its own material so the game can change its glow or put text on it
  coin_return     the flap under the housing; origin on its hinge (the top edge), swings about x
  door            (booth only) the glass door; origin on its hinge (the left edge), swings about y
  glass           (booth only) the fixed panes, alpha blended
  use_point       empty, a metre in front: where the player stands to use it
  cord_anchor_body, cord_anchor_handset   empties where the cord leaves the housing and enters the handset (the latter
                  is parented to the handset)

A candidate: it goes in the showroom (models-buildings.html) for the user's approval before it's placed in the city.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default):
    return type(default)(ARGV[ARGV.index(name) + 1]) if name in ARGV else default


OUT = ARGV[0]
MOUNT = arg('--mount', 'hood')
PREVIEW = arg('--preview', '')
BOOTH = MOUNT == 'booth'
STAND = MOUNT == 'stand'
PINK = arg('--color', 'red') == 'pink'
LOW = '--low' in ARGV

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Blender: x right, y depth, z up; the front faces -y (which the glTF export turns into +z).
MATS = {}


def mat(name, rgb, rough=0.5, metal=0.0, emit=None, alpha=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit[:3], 1.0)
        b.inputs['Emission Strength'].default_value = emit[3]
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            m.blend_method = 'BLEND'
    MATS[name] = m
    return m


def hexc(h):
    """sRGB hex to the linear colour Blender takes."""
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


GREEN = mat('green', hexc(0x2e7a52), 0.42)
GREEN_DK = mat('green_dark', hexc(0x1f5a3c), 0.5)
HOOD = mat('hood', hexc(0x7a8088), 0.45, 0.35)
STEEL = mat('steel', hexc(0x8a8e94), 0.35, 0.8)
POST = mat('post', hexc(0x5a5e62), 0.5, 0.5)
BLACK = mat('black', hexc(0x111214), 0.6)
HANDSET = mat('handset', hexc(0x26292a), 0.4)
CORD = mat('cord', hexc(0x1a1b1c), 0.55)
KEY = mat('key', hexc(0xdcdad2), 0.45)
NUMERAL = mat('numeral', hexc(0x16171a), 0.5)
AMBER = mat('display', hexc(0xffa028), 0.3, emit=(1.0, 0.55, 0.1, 3.0))
STRIP = mat('light_strip', hexc(0xdff5e4), 0.3, emit=(0.8, 1.0, 0.85, 2.5))
CEIL = mat('ceiling_light', hexc(0xe8f4ea), 0.5, emit=(0.85, 1.0, 0.88, 1.3))
SIGN = mat('sign_plate', hexc(0x1e8a52), 0.4, emit=(0.1, 0.55, 0.3, 1.6))
YELLOW = mat('book', hexc(0xc8a020), 0.7)
GLASS = mat('glass', hexc(0xa8c2c4), 0.18, 0.0, alpha=0.26)
# The booth: bare aluminium gone dark with weather (the booths of the time were aluminium and glass, the green was
# the telephone inside; and the user, 2026-10-12: a bright green booth "might not look good in a noir setting"), its
# skirt panels a shade darker, and a small sign lit no brighter than a shop's.
FRAME = mat('booth_frame', hexc(0x4b5057), 0.42, 0.55)
PANEL = mat('booth_panel', hexc(0x34383d), 0.5, 0.35)
BOOTH_SIGN = mat('booth_sign', hexc(0x9fb8a8), 0.4, emit=(0.32, 0.5, 0.4, 1.0))
# The stand phone's shell (a deep red, or the bar's pink), its number plate and the finger wheel over it.
SHELL = mat('shell', hexc(0xd9839c if PINK else 0xb01f26), 0.32)
PLATE = mat('number_plate', hexc(0xe6e2d6), 0.5)
WHEEL = mat('finger_wheel', hexc(0xc8ccd0), 0.25, 0.7)

PARTS = {}  # group name -> [objects]
OY = 0.0  # depth shift of everything in the phone set (the booth puts it on the back wall)


def reg(group, o):
    PARTS.setdefault(group, []).append(o)
    return o


def bevel(o, w):
    if LOW:
        return
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=w, segments=2, affect='EDGES')
    bm.to_mesh(o.data)
    bm.free()


def box(group, x0, x1, y0, y1, z0, z1, material, b=0.003):
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0 + OY, y1 + OY))
    z0, z1 = sorted((z0, z1))
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.scale = (max(x1 - x0, 1e-4), max(y1 - y0, 1e-4), max(z1 - z0, 1e-4))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if b > 0:
        bevel(o, min(b, min(x1 - x0, y1 - y0, z1 - z0) / 2.6))
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return reg(group, o)


def cyl(group, x, y, z0, z1, r, material, verts=20, r2=None, axis='Z', smooth=True):
    if LOW:
        verts = min(verts, 8)
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=abs(z1 - z0), location=(x, y + OY, (z0 + z1) / 2))
    o = bpy.context.active_object
    if axis == 'X':
        o.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Y':
        o.rotation_euler = (math.pi / 2, 0, 0)
    if axis != 'Z':
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return reg(group, o)


def disc(group, x, y, z, r, thick, material, verts=28):
    """A disc facing -y (its axis along y), centred on (x, y, z)."""
    o = cyl(group, x, y, 0, thick, r, material, verts, axis='Y')
    o.location = (x, y + OY, z)
    return o


def text(group, ch, x, y, z, size, material):
    """A numeral lying on a face looking -y, centred on (x, z)."""
    if LOW:
        return None
    bpy.ops.object.text_add(location=(0, 0, 0))
    t = bpy.context.active_object
    t.data.body = ch
    t.data.size = size
    t.data.extrude = 0.0006
    t.data.align_x = 'CENTER'
    t.data.align_y = 'CENTER'
    t.rotation_euler = (math.pi / 2, 0, 0)
    t.location = (x, y + OY, z)
    bpy.ops.object.convert(target='MESH')
    t.data.materials.append(material)
    return reg(group, t)


def join(group, pivot=None, name=None):
    objs = PARTS[group]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name or group
    o.data.name = o.name
    if pivot is not None:
        scene.cursor.location = Vector(pivot)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    PARTS[group] = [o]
    return o


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.05
    scene.collection.objects.link(e)
    e.location = loc
    if parent is not None:
        e.parent = parent
        e.matrix_parent_inverse = parent.matrix_world.inverted()
    return e


# ---- the set: housing, display, keypad, slots, handset and cradle ------------------------------------------------

HX = 0.19  # the housing's half width
FRONT = -0.10  # the housing's front face
HZ0, HZ1 = 1.0, 1.44  # the housing's height

if BOOTH:
    OY = 0.36  # the set against the back wall, 0.14 m off it
    HZ0, HZ1 = 0.98, 1.42

if STAND:
    # ---- the stand phone: a post and a shelf, the red shell, the dial on its face, the handset across its top ----
    B0, B1 = 0.97, 1.17  # the shell's foot and top
    FRONT = -0.13
    cyl('body', 0, 0.0, 0.0, 0.03, 0.11, POST, 20)
    cyl('body', 0, 0.0, 0.0, 0.94, 0.045, POST, 16)
    box('body', -0.19, 0.19, -0.17, 0.15, 0.94, 0.97, HOOD, 0.006)
    box('body', -0.15, 0.15, FRONT, 0.12, B0, B1, SHELL, 0.022)
    # The saddle on top the handset lies in, its two prongs, and the coin slot beside it.
    box('body', -0.13, 0.13, -0.05, 0.09, B1, B1 + 0.028, SHELL, 0.01)
    for sx in (-1, 1):
        box('body', sx * 0.075 - 0.012, sx * 0.075 + 0.012, -0.035, 0.075, B1 + 0.028, B1 + 0.052, SHELL, 0.004)
    box('body', 0.085, 0.10, -0.115, -0.07, B1 - 0.002, B1 + 0.003, BLACK, 0.0005)
    # The number plate on the face, its numerals round it (1 at the upper right, on round to 0 at the lower right).
    DZ = B0 + 0.102
    disc('body', 0, FRONT - 0.002, DZ, 0.086, 0.004, PLATE)
    HOLES = []
    for i, ch in enumerate('1234567890'):
        ang = math.radians(60 - i * 30)
        hx, hz = math.cos(ang) * 0.062, math.sin(ang) * 0.062
        HOLES.append((hx, hz))
        text('body', ch, hx, FRONT - 0.0045, DZ + hz, 0.016, NUMERAL)
    # The finger wheel over it (its own object: it turns about its centre): a ring with ten holes, and the hub.
    disc('dial', 0, FRONT - 0.008, DZ, 0.080, 0.004, WHEEL)
    for hx, hz in (() if LOW else HOLES):
        disc('dial', hx, FRONT - 0.0095, DZ + hz, 0.0105, 0.002, PLATE, 12)
    disc('dial', 0, FRONT - 0.011, DZ, 0.030, 0.006, SHELL, 20)
    join('dial', pivot=(0, FRONT - 0.008, DZ))
    # The finger stop, a steel hook at the lower right of the plate.
    box('body', 0.060, 0.085, FRONT - 0.016, FRONT - 0.004, DZ - 0.062, DZ - 0.052, STEEL, 0.002)
    # The handset across the top: a bar along x, a cup hanging down at each end.
    HZC = B1 + 0.078
    box('handset', -0.085, 0.085, 0.002, 0.036, HZC - 0.013, HZC + 0.013, HANDSET, 0.008)
    for sx in (-1, 1):
        box('handset', sx * 0.105 - 0.03, sx * 0.105 + 0.03, -0.012, 0.050, HZC - 0.048, HZC + 0.010, HANDSET, 0.012)
        cyl('handset', sx * 0.105, 0.019, HZC - 0.051, HZC - 0.048, 0.021, BLACK, 16)
    join('handset', pivot=(0, 0.019, HZC))
    box('hook_switch', -0.010, 0.010, 0.010, 0.030, B1 + 0.028, B1 + 0.044, BLACK, 0.001)
    join('hook_switch', pivot=(0, 0.020, B1 + 0.028))
    # The coin return at the foot of the face, hinged on its top edge.
    box('coin_return', 0.055, 0.125, FRONT - 0.008, FRONT, B0 + 0.012, B0 + 0.045, STEEL, 0.003)
    join('coin_return', pivot=(0.09, FRONT, B0 + 0.045))
    # The cord, from the shell's left side up to the handset's left cup.
    CORD_A = (-0.15, 0.03, B0 + 0.05)
    CORD_B = (-0.105, 0.019, HZC - 0.05)
    if not LOW:
        scene.cursor.location = (0, 0, 0)
        bpy.ops.curve.primitive_bezier_curve_add(location=(0, 0, 0))
        cv = bpy.context.active_object
        cv.data.splines[0].bezier_points[0].co = Vector(CORD_A)
        cv.data.splines[0].bezier_points[1].co = Vector(CORD_B)
        for bp, h in zip(cv.data.splines[0].bezier_points, ((-0.07, -0.02, -0.03), (-0.05, 0.0, -0.06))):
            bp.handle_left_type = bp.handle_right_type = 'FREE'
            bp.handle_left = bp.co + Vector(h) * -1
            bp.handle_right = bp.co + Vector(h)
        cv.data.bevel_depth = 0.004
        cv.data.bevel_resolution = 3
        cv.data.resolution_u = 14
        bpy.ops.object.convert(target='MESH')
        cv.data.materials.append(CORD)
        reg('cord', cv)
        join('cord', pivot=CORD_A)
else:
    # Housing (green), with a dark recess round the keypad and a bezel round the display.
    box('body', -HX, HX, FRONT, 0.12, HZ0, HZ1, GREEN, 0.012)
    box('body', -0.13, 0.065, FRONT - 0.002, FRONT + 0.004, 1.05, 1.27, BLACK, 0.001)  # keypad plate
    box('body', -0.13, 0.065, FRONT - 0.002, FRONT + 0.004, 1.31, 1.395, BLACK, 0.001)  # display bezel
    # Card and coin slots on the face: a card mouth under the keypad, a coin slit above it.
    box('body', -0.12, -0.02, FRONT - 0.004, FRONT + 0.004, 1.015, 1.037, BLACK, 0.001)
    box('body', 0.00, 0.012, FRONT - 0.004, FRONT + 0.004, 1.275, 1.300, BLACK, 0.0005)
    box('body', -0.12, -0.02, FRONT - 0.006, FRONT - 0.001, 1.04, 1.045, STEEL, 0.0005)
    # A rim round the housing's front edge and four screws.
    for sx in (() if LOW else (-1, 1)):
        for z in (HZ0 + 0.03, HZ1 - 0.03):
            s = cyl('body', sx * (HX - 0.022), FRONT, 0, 0.004, 0.0075, STEEL, 8, axis='Y', smooth=False)
            s.location = (sx * (HX - 0.022), FRONT + OY - 0.002, z)

    if not BOOTH:
        # Post and flange, the hood (back plate, top, two sides), the lit strip under it and the sign plate on its lip.
        cyl('body', 0, 0.0, 0.0, 0.03, 0.10, POST, 20)
        cyl('body', 0, 0.0, 0.0, HZ0 + 0.02, 0.05, POST, 16)
        box('body', -0.31, 0.31, 0.12, 0.155, 0.90, 1.80, HOOD, 0.006)
        box('body', -0.33, 0.33, -0.30, 0.165, 1.74, 1.80, HOOD, 0.008)
        box('body', -0.33, -0.30, -0.30, 0.155, 0.90, 1.78, HOOD, 0.006)
        box('body', 0.30, 0.33, -0.30, 0.155, 0.90, 1.78, HOOD, 0.006)
        box('body', -0.27, 0.27, -0.27, 0.10, 1.735, 1.742, STRIP, 0.0005)
        box('body', -0.33, 0.33, -0.318, -0.30, 1.80, 1.93, GREEN_DK, 0.006)
        box('body', -0.29, 0.29, -0.322, -0.318, 1.82, 1.91, SIGN, 0.0005)
    else:
        # The booth's own frame, floor, back panel, roof, sign and shelf are built below, round the set.
        pass

    # The display: its own object (emissive amber) so the game can change its glow.
    box('display', -0.115, 0.05, FRONT - 0.003, FRONT + 0.001, 1.325, 1.38, AMBER, 0.001)

    # The keys: twelve objects, each with its numeral, origin at the middle of the key's face.
    LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']
    NAMES = ['key_1', 'key_2', 'key_3', 'key_4', 'key_5', 'key_6', 'key_7', 'key_8', 'key_9', 'key_star', 'key_0', 'key_hash']
    for i, (lab, nm) in enumerate(zip(LABELS, NAMES)):
        col, row = i % 3, i // 3
        kx = -0.095 + col * 0.05
        kz = 1.235 - row * 0.05 + 0.0
        box(nm, kx - 0.019, kx + 0.019, FRONT - 0.012, FRONT, kz - 0.016, kz + 0.016, KEY, 0.003)
        text(nm, lab, kx, FRONT - 0.0126, kz, 0.018, NUMERAL)
        join(nm, pivot=(kx, FRONT - 0.012 + OY, kz))

    # The cradle: two steel hooks on the housing's right and the hook switch between them.
    CX = 0.128  # the handset's centre line
    box('body', CX - 0.03, CX + 0.03, FRONT - 0.014, FRONT, HZ1 - 0.07, HZ1 - 0.03, STEEL, 0.003)
    box('body', CX - 0.03, CX + 0.03, FRONT - 0.014, FRONT, HZ0 + 0.03, HZ0 + 0.07, STEEL, 0.003)
    box('hook_switch', CX - 0.008, CX + 0.008, FRONT - 0.003, FRONT, 1.20, 1.23, BLACK, 0.001)
    join('hook_switch', pivot=(CX, FRONT + OY, 1.20))

    # The handset: a bar with an ear cup at the top and a mouth cup at the bottom, lying in the cradle.
    HL = 0.30  # its length
    HZC = (HZ0 + HZ1) / 2 + 0.0
    box('handset', CX - 0.017, CX + 0.017, FRONT - 0.050, FRONT - 0.020, HZC - 0.09, HZC + 0.09, HANDSET, 0.008)
    for z in (HZC + 0.115, HZC - 0.115):
        box('handset', CX - 0.027, CX + 0.027, FRONT - 0.062, FRONT - 0.008, z - 0.036, z + 0.036, HANDSET, 0.010)
        cyl('handset', CX, FRONT - 0.064, 0, 0.003, 0.021, BLACK, 16, axis='Y').location = (CX, FRONT + OY - 0.063, z)
    join('handset', pivot=(CX, FRONT + OY - 0.035, HZC))

    # The coin return flap under the housing, hinged on its top edge.
    box('coin_return', -0.07, 0.07, FRONT - 0.020, FRONT, HZ0 - 0.05, HZ0 - 0.005, STEEL, 0.004)
    join('coin_return', pivot=(0, FRONT + OY, HZ0 - 0.005))

    # The coiled cord, from under the housing to the handset's bottom, hanging in a loop.
    scene.cursor.location = (0, 0, 0)  # (join() left it on a pivot)
    # (Built in the low version too, then left out of it at the end: the anchors below come from it.)
    bpy.ops.curve.primitive_bezier_curve_add(location=(0, 0, 0))
    cv = bpy.context.active_object
    cv.data.splines[0].bezier_points[0].co = Vector((CX, FRONT + OY - 0.01, HZ0 + 0.02))
    cv.data.splines[0].bezier_points[1].co = Vector((CX, FRONT + OY - 0.07, HZC - 0.14))
    for bp, h in zip(cv.data.splines[0].bezier_points, ((0, -0.03, -0.06), (0, 0.04, 0.06))):
        bp.handle_left_type = bp.handle_right_type = 'FREE'
        bp.handle_left = bp.co + Vector(h) * -1
        bp.handle_right = bp.co + Vector(h)
    cv.data.bevel_depth = 0.004
    cv.data.bevel_resolution = 3
    cv.data.resolution_u = 14
    bpy.ops.object.convert(target='MESH')
    cv.data.materials.append(CORD)
    reg('cord', cv)
    join('cord', pivot=(CX, FRONT + OY - 0.01, HZ0 + 0.02))
    CORD_A = (CX, FRONT + OY - 0.01, HZ0 + 0.02)
    CORD_B = (CX, FRONT + OY - 0.07, HZC - 0.14)

# ---- the booth ---------------------------------------------------------------------------------------------------

if BOOTH:
    BHW = 0.45  # half width
    # The set stands on the back wall (OY shifted it there): the booth's back is at y = 0.50, its front at y = -0.50.
    # Everything below is written in final coordinates, so each y is taken off by OY, which box() adds again.
    BK, FR = 0.50, -0.50
    SKIRT = 0.92  # solid below, glass above
    box('body', -BHW - 0.05, BHW + 0.05, FR - 0.05 - OY, BK + 0.05 - OY, 0.0, 0.07, POST, 0.01)  # the slab
    for x in (-BHW, BHW):
        for y in (FR, BK):
            box('body', x - 0.03, x + 0.03, y - 0.03 - OY, y + 0.03 - OY, 0.07, 2.30, FRAME, 0.006)
    box('body', -BHW - 0.04, BHW + 0.04, FR - 0.04 - OY, BK + 0.04 - OY, 2.30, 2.40, FRAME, 0.01)  # the roof
    box('body', -BHW, BHW, FR - OY, BK - OY, 2.40, 2.43, PANEL, 0.005)
    # Solid skirts on the back and both sides, a rail across the glass above them, and the front's header.
    box('body', -BHW, BHW, BK - 0.03 - OY, BK - OY, 0.07, SKIRT, PANEL, 0.003)
    box('body', -BHW, -BHW + 0.03, FR - OY, BK - OY, 0.07, SKIRT, FRAME, 0.003)
    box('body', BHW - 0.03, BHW, FR - OY, BK - OY, 0.07, SKIRT, FRAME, 0.003)
    box('body', -BHW, BHW, BK - 0.03 - OY, BK - OY, 2.20, 2.30, PANEL, 0.003)
    box('body', -BHW, -BHW + 0.03, FR - OY, BK - OY, 2.20, 2.30, FRAME, 0.003)
    box('body', BHW - 0.03, BHW, FR - OY, BK - OY, 2.20, 2.30, FRAME, 0.003)
    box('body', -BHW, BHW, FR - OY, FR + 0.03 - OY, 2.20, 2.30, FRAME, 0.004)
    # The roof sign: a lit green box with its plate.
    box('body', -0.28, 0.28, FR - 0.02 - OY, FR + 0.10 - OY, 2.43, 2.66, PANEL, 0.008)
    box('body', -0.25, 0.25, FR - 0.024 - OY, FR - 0.02 - OY, 2.46, 2.62, BOOTH_SIGN, 0.0005)
    # The shelf under the set and a phone book on it; the ceiling light, a lit panel the size of a tile.
    box('body', -0.40, 0.40, BK - 0.34 - OY, BK - 0.02 - OY, 0.93, 0.97, FRAME, 0.004)
    box('body', -0.30, -0.08, BK - 0.30 - OY, BK - 0.08 - OY, 0.97, 1.03, YELLOW, 0.004)
    box('body', -0.30, 0.30, -0.30 - OY, 0.30 - OY, 2.285, 2.30, CEIL, 0.0005)
    # Fixed glass above the skirts: the back and both sides (the front is the door).
    box('glass', -BHW + 0.03, BHW - 0.03, BK - 0.02 - OY, BK - 0.015 - OY, SKIRT, 2.20, GLASS, 0)
    box('glass', -BHW + 0.005, -BHW + 0.012, FR + 0.03 - OY, BK - 0.03 - OY, SKIRT, 2.20, GLASS, 0)
    box('glass', BHW - 0.012, BHW - 0.005, FR + 0.03 - OY, BK - 0.03 - OY, SKIRT, 2.20, GLASS, 0)
    # The door: the whole front, a glass leaf over a solid skirt in a green frame, hinged on the left edge.
    DX0, DX1 = -BHW + 0.03, BHW - 0.03
    box('door', DX0, DX1, FR - 0.03 - OY, FR - OY, 0.07, SKIRT, FRAME, 0.003)
    box('door', DX0, DX1, FR - 0.03 - OY, FR - OY, SKIRT, SKIRT + 0.04, FRAME, 0.003)
    box('door', DX0, DX1, FR - 0.03 - OY, FR - OY, 2.18, 2.20, FRAME, 0.003)
    box('door', DX0, DX0 + 0.04, FR - 0.03 - OY, FR - OY, SKIRT, 2.20, FRAME, 0.003)
    box('door', DX1 - 0.04, DX1, FR - 0.03 - OY, FR - OY, SKIRT, 2.20, FRAME, 0.003)
    box('door', DX0 + 0.04, DX1 - 0.04, FR - 0.02 - OY, FR - 0.012 - OY, SKIRT + 0.04, 2.18, GLASS, 0)
    box('door', DX1 - 0.12, DX1 - 0.10, FR - 0.06 - OY, FR - 0.03 - OY, 1.00, 1.25, STEEL, 0.003)  # the handle
    join('door', pivot=(DX0, FR, 0.0))
    join('glass')


# ---- finish: body, empties, export -------------------------------------------------------------------------------

join('body', pivot=(0, 0, 0))
if 'display' in PARTS:
    join('display', pivot=(0, FRONT + OY, 1.35))
handset = PARTS['handset'][0]
if LOW:
    # The middle distance's: one object, nothing that moves, no cord.
    for o in PARTS.pop('cord', []):
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS['body'][0]
    bpy.ops.object.join()
    one = bpy.context.active_object
    one.name = one.data.name = 'payphone_low'
    scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    handset = None
else:
    empty('use_point', (0, -1.0, 0))
    empty('cord_anchor_body', CORD_A)
    empty('cord_anchor_handset', CORD_B, parent=handset)

# The cord is a spline curve converted to a mesh above: it's already a mesh in the right place.
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        o.select_set(True)

if PREVIEW and LOW:
    PREVIEW = ''
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1100, 800
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.4, 0.5, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -0.002))
    floor = bpy.context.active_object
    floor.data.materials.append(mat('floor', hexc(0x77736c), 0.9))
    for loc, energy in (((-2.0, -3.0, 3.0), 700), ((3.0, -2.0, 2.0), 250)):
        bpy.ops.object.light_add(type='AREA', location=loc)
        L = bpy.context.active_object
        L.data.energy = energy
        L.data.size = 2.5
        L.rotation_euler = (Vector((0, 0, 1.2)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

    def shot(name, loc, look, lens=45):
        bpy.ops.object.camera_add(location=loc)
        c = bpy.context.active_object
        c.data.lens = lens
        c.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.camera = c
        scene.render.filepath = os.path.join(PREVIEW, name + '.png')
        bpy.ops.render.render(write_still=True)

    zc = 1.3 if not BOOTH else 1.2
    shot('front', (0.0, -3.3, zc), (0, 0, zc), 40)
    shot('three_quarter', (-1.8, -2.4, zc + 0.5), (0, 0.2, zc), 40)
    shot('close', (-0.35, -0.95, 1.3), (0.02, OY - 0.1, 1.2) if not STAND else (0.0, -0.05, 1.12), 55)
    # The handset lifted off its hooks and a key pressed (or the dial turned), to show the parts move on their own.
    rest = handset.location.copy()
    handset.location = rest + (Vector((-0.12, -0.30, 0.06)) if not STAND else Vector((-0.06, -0.22, 0.16)))
    handset.rotation_euler = Euler((math.radians(-25), 0, math.radians(20)))
    moved = bpy.data.objects.get('key_5')
    if moved:
        moved.location.y += 0.008
    dial = bpy.data.objects.get('dial')
    if dial:
        dial.rotation_euler = Euler((0, math.radians(110), 0))
    bpy.data.objects['coin_return'].rotation_euler = Euler((math.radians(-35), 0, 0))
    shot('lifted', (-0.55, -1.15, 1.45), (0.05, OY - 0.15, 1.2) if not STAND else (0.0, -0.05, 1.15), 50)
    handset.location = rest
    handset.rotation_euler = (0, 0, 0)
    if moved:
        moved.location.y -= 0.008
    if dial:
        dial.rotation_euler = (0, 0, 0)
    bpy.data.objects['coin_return'].rotation_euler = (0, 0, 0)
    for o in (floor,):
        bpy.data.objects.remove(o)

# Export only the phone: no floor, lights or cameras.
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type == 'MESH' or o.type == 'EMPTY':
        o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, use_selection=True, export_apply=True, export_cameras=False, export_lights=False)
tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('payphone (%s%s%s): %d objects, ~%d polygons -> %s' % (MOUNT, ' pink' if STAND and PINK else '', ' low' if LOW else '', sum(1 for o in bpy.data.objects if o.type == 'MESH'), tris, OUT))
