"""Hotel Rouge (the big plan): what every part shares: the plan file, the palette and the bath.

The plan (content/world3d/rouge_plan.json) is the one place the numbers live; the game reads the same file. A room's own
frame is (a, b): a along u from the room's west wall, b from the wall opposite its door toward the door; `RM` maps it.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import bakelib as B  # noqa: E402
from bakelib import box, cyl, mat, sphere  # noqa: E402

PLAN = json.load(open(os.path.join(HERE, '..', '..', '..', 'content', 'world3d', 'rouge_plan.json'), encoding='utf-8'))
IN = PLAN['in']
CEIL = PLAN['ceil']
RC = PLAN['roomCeil']  # the guest rooms' own dropped ceiling
ROOF = 14.9  # just under the keep's roof (the exterior's, at 15: the two must not share a plane)
STAIR = PLAN['stair']
CORR = PLAN['corridor']
FRONT_DOOR = PLAN['frontDoor']
SIDE_DOOR = PLAN['sideDoor']
GROUND = PLAN.get('ground', {})


def hx(h, k=1.0):
    """A sRGB hex colour as a linear (r, g, b), scaled by k."""
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(k * (v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


_m = {}


def M(name, hexv, rough=0.6, metal=0.0, **kw):
    """A cached material by name and colour."""
    key = (name, hexv, rough, metal, tuple(sorted(kw.items(), key=lambda kv: kv[0])))
    if key not in _m:
        _m[key] = mat('%s_%x_%d' % (name, hexv, len(_m)), hx(hexv), rough, metal, **kw)
    return _m[key]


GLOW_K = [1.0]  # the themed rooms are dim: their glows are scaled while they are built
_g = {}


def glow(name, rgb, strength=6.0):
    key = (name, tuple(rgb), strength, GLOW_K[0])
    if key not in _g:
        _g[key] = mat('%s_%d' % (name, len(_g)), (0, 0, 0), 0.5, emit=(*rgb, strength * GLOW_K[0]))
    return _g[key]


# ---- the palette ---------------------------------------------------------------------------------------------------
CARPET = M('carpet', 0x4a1424, 0.95, grain='plaster', scale=110, strength=0.5)
WALLPAPER = M('wallpaper', 0x6a3048, 0.8, grain='stripes', scale=38, strength=1.1)
DAMASK = M('damask', 0x5a2440, 0.8, grain='stripes', scale=30, strength=1.1)
DARK = M('dark', 0x1a0a12, 0.5)
CEILING = M('ceiling', 0x3a1c2a, 0.9, grain='plaster', scale=8, strength=0.2)
GOLD = M('gold', 0xc8a050, 0.3, 0.55)
GOLD_T = M('gold_trim', 0xc8a050, 0.5, 0.1)  # skirting and dado rails: a plain gold paint, not a mirror
WOOD = M('wood', 0x3a1a28, 0.45, grain='wood', scale=16, strength=0.4)
WOOD_L = M('wood_light', 0xc8a878, 0.5, grain='wood', scale=16, strength=0.35)
WOOD_D = M('wood_dark', 0x2a1a12, 0.5, grain='wood', scale=16, strength=0.4)
STEEL = M('steel', 0x8a8e92, 0.35, 0.8)
GREY = M('grey', 0x5a5a5c, 0.6)
CONCRETE = M('concrete', 0x6a6a6c, 0.9, grain='plaster', scale=30, strength=0.35)
BLACK = mat('black', (0.02, 0.02, 0.025), 0.4)
WHITE = M('white', 0xe8e0dc, 0.7)
PAPER = M('paper', 0xe8d8c8, 0.8)
LEAF = M('leaf', 0x2e5a34, 0.7, grain='plaster', scale=70, strength=0.4)
CLOSED_DOOR = M('door_closed', 0x3a1020, 0.45)
G_PINK = glow('g_pink', (1.0, 0.25, 0.55), 7.0)
G_WARM = glow('g_warm', (1.0, 0.7, 0.45), 6.0)
G_RED = glow('g_red', (1.0, 0.1, 0.1), 9.0)
G_GREEN = glow('g_green', (0.15, 1.0, 0.35), 9.0)
G_WHITE = glow('g_white', (1.0, 1.0, 0.95), 9.0)
G_MIRROR = glow('g_mirror', (0.55, 0.52, 0.56), 0.35)


def F(u0, u1, t0, t1, z0, z1, m, y, bevel=0.0, name='box'):
    """A box at a storey: z above that storey's floor."""
    return box(u0, u1, t0, t1, y + z0, y + z1, m, bevel, name)


# ---- a room's own frame -----------------------------------------------------------------------------------------------


def expr(v, W):
    """A layout number: a plain number, or a string like 'W-3.6' (W the room's width)."""
    if isinstance(v, str):
        return W + float(v[1:]) if len(v) > 1 else W
    return v


class RM:
    """A room's frame: (a, b), a along u from its west wall, b from the wall opposite its door toward the door."""

    def __init__(s, room):
        s.room = room
        s.y = room['floor']
        s.u0, s.u1, s.t0, s.t1 = room['rect']
        s.W = s.u1 - s.u0
        s.D = s.t1 - s.t0
        s.wall = room['door']['wall']
        s.fwd = s.wall == 't1'  # the door is on the north side: b grows toward +t from the street wall
        s.du = room['door']['u'] - s.u0  # the door's centre, in a

    def U(s, a):
        return s.u0 + a

    def T(s, b):
        return s.t0 + b if s.fwd else s.t1 - b

    def rect(s, a0, a1, b0, b1):
        t0, t1 = s.T(b0), s.T(b1)
        return (s.U(a0), s.U(a1), min(t0, t1), max(t0, t1))

    def box(s, a0, a1, b0, b1, z0, z1, m, bevel=0.004, name='box'):
        u0, u1, t0, t1 = s.rect(a0, a1, b0, b1)
        return box(u0, u1, t0, t1, s.y + z0, s.y + z1, m, bevel, name)

    def cyl(s, a, b, z0, z1, r, m, verts=24, r2=None, name='cyl', axis='Z'):
        return cyl(s.U(a), s.T(b), s.y + z0, s.y + z1, r, m, verts, r2=r2, name=name, axis=axis)

    def sphere(s, a, b, z, r, m, sx=1.0, sy=1.0, sz=1.0, name='sphere'):
        return sphere(s.U(a), s.T(b), s.y + z, r, m, sx, sy, sz, name)

    def piece(s, name):
        """A layout piece's rect [a0, a1, b0, b1] (the room's own layout), or None."""
        lay = PLAN['layouts'].get(s.room.get('layout', ''), {})
        if name not in lay:
            return None
        v = lay[name]
        return [expr(x, s.W) for x in v]


def rooms(floor, kind=None):
    return [r for r in PLAN['rooms'] if r['floor'] == floor and (kind is None or r['kind'] == kind)]


# ---- a door's frame (the leaf is the game's) ----------------------------------------------------------------------------


def door_frame(y, u, t_mid, lamp=None):
    """A gold frame round a doorway in a wall along u (width 1.3), the lamp over it: 'green' (open), 'red' (in use), or None."""
    H = 0.65
    F(u - H - 0.06, u - H, t_mid - 0.1, t_mid + 0.1, 0, 2.26, GOLD, y, 0.003, 'frame')
    F(u + H, u + H + 0.06, t_mid - 0.1, t_mid + 0.1, 0, 2.26, GOLD, y, 0.003, 'frame')
    F(u - H - 0.06, u + H + 0.06, t_mid - 0.1, t_mid + 0.1, 2.2, 2.26, GOLD, y, 0.003, 'frame')
    if lamp:
        F(u - 0.08, u + 0.08, t_mid - 0.03, t_mid + 0.03, 2.4, 2.5, G_GREEN if lamp == 'green' else G_RED, y, 0, 'lamp')


# ---- furniture, sized for the game (Mack is 1.92 m and broad: catalogue sizes look like a doll's house beside him) ----


class World:
    """The building's own frame with a room's drawing calls, for furniture outside the rooms (the lobby, the hall)."""
    y = 0

    @staticmethod
    def box(a0, a1, b0, b1, z0, z1, m, bevel=0.004, name='box'):
        return box(a0, a1, b0, b1, z0, z1, m, bevel, name)

    @staticmethod
    def cyl(a, b, z0, z1, r, m, verts=24, r2=None, name='cyl', axis='Z'):
        return cyl(a, b, z0, z1, r, m, verts, r2=r2, name=name, axis=axis)


def oriented(R, a0, a1, b0, b1, back):
    """A piece's own frame inside its rect: l along its length, d from its back (the rect's side named: 'a0', 'a1',
    'b0' or 'b1') to its front. Returns (bx, L, Dp); bx(l0, l1, d0, d1, z0, z1, material, bevel, name) draws a box."""
    if back in ('a0', 'a1'):
        L, Dp = b1 - b0, a1 - a0

        def bx(l0, l1, d0, d1, z0, z1, m, bevel=0.01, name='part'):
            A = (a0 + d0, a0 + d1) if back == 'a0' else (a1 - d1, a1 - d0)
            return R.box(A[0], A[1], b0 + l0, b0 + l1, z0, z1, m, bevel, name)
    else:
        L, Dp = a1 - a0, b1 - b0

        def bx(l0, l1, d0, d1, z0, z1, m, bevel=0.01, name='part'):
            Bv = (b0 + d0, b0 + d1) if back == 'b0' else (b1 - d1, b1 - d0)
            return R.box(a0 + l0, a0 + l1, Bv[0], Bv[1], z0, z1, m, bevel, name)
    return bx, L, Dp


def sofa(R, a0, a1, b0, b1, back, fab, feet=None, seat=0.5, top=1.0):
    """A sofa filling its rect, its back along the side named: feet, a base, arms, a seat cushion a place, back cushions."""
    bx, L, Dp = oriented(R, a0, a1, b0, b1, back)
    feet = feet or BLACK
    arm, bk = 0.24, 0.26
    for l in (0.08, L - 0.16):
        for d in (0.08, Dp - 0.16):
            bx(l, l + 0.08, d, d + 0.08, 0, 0.12, feet, 0, 'sofa_foot')
    bx(0, L, 0, Dp - 0.04, 0.12, seat - 0.18, fab, 0.02, 'sofa_base')
    bx(0, L, 0, bk, seat - 0.2, top, fab, 0.05, 'sofa_back')
    for l0 in (0, L - arm):
        bx(l0, l0 + arm, 0, Dp, seat - 0.2, seat + 0.24, fab, 0.05, 'sofa_arm')
    n = max(1, round((L - 2 * arm) / 0.75))
    w = (L - 2 * arm) / n
    for k in range(n):
        l0 = arm + k * w
        bx(l0 + 0.01, l0 + w - 0.01, bk - 0.02, Dp, seat - 0.18, seat + 0.04, fab, 0.045, 'sofa_seat')
        bx(l0 + 0.03, l0 + w - 0.03, bk - 0.04, bk + 0.16, seat + 0.02, top - 0.06, fab, 0.06, 'sofa_cushion')


def chair(R, ca, cb, face, fab, frame=None, w=0.52, seat=0.5, top=1.06):
    """A dining chair centred at (ca, cb), the sitter facing 'a+', 'a-', 'b+' or 'b-': four legs, the back two running up
    into the back, a padded seat and back."""
    frame = frame or WOOD_D
    h = w / 2
    bx, L, Dp = oriented(R, ca - h, ca + h, cb - h, cb + h, {'a+': 'a0', 'a-': 'a1', 'b+': 'b0', 'b-': 'b1'}[face])
    for l in (0.02, L - 0.07):
        bx(l, l + 0.05, 0.0, 0.05, 0, top, frame, 0, 'chair_post')
        bx(l, l + 0.05, Dp - 0.07, Dp - 0.02, 0, seat - 0.05, frame, 0, 'chair_leg')
    bx(0.01, L - 0.01, 0.0, Dp, seat - 0.06, seat, frame, 0, 'chair_frame')
    bx(0.03, L - 0.03, 0.04, Dp - 0.01, seat, seat + 0.06, fab, 0.02, 'chair_seat')
    bx(0.07, L - 0.07, 0.0, 0.05, seat + 0.2, top - 0.02, fab, 0.015, 'chair_back')


def round_table(R, ca, cb, r, top, h=0.8, base=None):
    base = base or STEEL
    R.cyl(ca, cb, 0, 0.04, r * 0.55, base, 20, name='table_foot')
    R.cyl(ca, cb, 0.04, h - 0.05, 0.05, base, 12, name='table_post')
    R.cyl(ca, cb, h - 0.05, h, r, top, 32, name='table_top')


def stool(R, ca, cb, fab, h=0.5, r=0.23, base=None):
    base = base or STEEL
    R.cyl(ca, cb, 0, 0.03, r * 0.9, base, 16, name='stool_foot')
    R.cyl(ca, cb, 0.03, h - 0.1, 0.035, base, 8, name='stool_post')
    R.cyl(ca, cb, h - 0.1, h, r, fab, 20, name='stool_seat')


def low_table(R, a0, a1, b0, b1, m, h=0.46):
    R.box(a0, a1, b0, b1, h - 0.05, h, m, 0.006, 'low_table_top')
    R.box(a0 + 0.08, a1 - 0.08, b0 + 0.08, b1 - 0.08, 0.14, 0.17, m, 0, 'low_table_shelf')
    for a in (a0 + 0.04, a1 - 0.1):
        for b in (b0 + 0.04, b1 - 0.1):
            R.box(a, a + 0.06, b, b + 0.06, 0, h - 0.05, m, 0, 'low_table_leg')


def bench(R, a0, a1, b0, b1, fab, frame=None, h=0.5):
    """A backless upholstered bench: legs, a frame, a cushion."""
    frame = frame or WOOD
    for a in (a0 + 0.05, a1 - 0.12):
        for b in (b0 + 0.05, b1 - 0.12):
            R.box(a, a + 0.07, b, b + 0.07, 0, h - 0.18, frame, 0, 'bench_leg')
    R.box(a0, a1, b0, b1, h - 0.18, h - 0.1, frame, 0.006, 'bench_frame')
    R.box(a0 + 0.02, a1 - 0.02, b0 + 0.02, b1 - 0.02, h - 0.1, h, fab, 0.04, 'bench_seat')


# ---- the baths ----------------------------------------------------------------------------------------------------------
# The numbers shared with the game are the plan's: the tubs' sizes and water level (`tub`), each tub's centre (its layout's `tub`).
TUB = PLAN['tub']
WATER_Y = TUB['water']
TUB_R_OUT = TUB['rOut']
TUB_R_IN = TUB['rIn']
TUB_RIM = TUB['rim']


def ring_cyl(u, t, z0, z1, r_out, r_in, material, verts=40, name='tub', floor=0.1):
    """A tub's wall: a cylinder with its inside cut out down to `floor` above its bottom (open at the top)."""
    import bpy
    outer = cyl(u, t, z0, z1, r_out, material, verts, name=name)
    inner = cyl(u, t, z0 + floor, z1 + 0.5, r_in, material, verts, name=name + '_cut')
    B.OBJS.remove(inner)
    mod = outer.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = inner
    bpy.context.view_layer.objects.active = outer
    for o in bpy.context.selected_objects:
        o.select_set(False)
    outer.select_set(True)
    bpy.ops.object.modifier_apply(modifier='cut')
    bpy.data.objects.remove(inner, do_unlink=True)
    return outer


def ring_box(cu, ct, w_out, d_out, w_in, d_in, z0, z1, material, name='tub'):
    import bpy
    outer = box(cu - w_out / 2, cu + w_out / 2, ct - d_out / 2, ct + d_out / 2, z0, z1, material, 0.02, name)
    inner = box(cu - w_in / 2, cu + w_in / 2, ct - d_in / 2, ct + d_in / 2, z0 + 0.1, z1 + 0.5, material, 0.0, name + '_cut')
    B.OBJS.remove(inner)
    mod = outer.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = inner
    bpy.context.view_layer.objects.active = outer
    for o in bpy.context.selected_objects:
        o.select_set(False)
    outer.select_set(True)
    bpy.ops.object.modifier_apply(modifier='cut')
    bpy.data.objects.remove(inner, do_unlink=True)
    return outer


def caustic_mat(rgb, strength):
    """The basin's floor under the water: aqua tile lit by a net of caustic lines (baked, so it doesn't move)."""
    m = mat('caustic_%d' % len(_m), hx(0x2a6a7a), 0.3)
    _m[('caustic', len(_m))] = m
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 9.0
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = 0.0
    mr.inputs['From Max'].default_value = 0.12
    mr.inputs['To Min'].default_value = 1.0
    mr.inputs['To Max'].default_value = 0.0
    mr.clamp = True
    nt.links.new(vor.outputs['Distance'], mr.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = strength
    nt.links.new(mr.outputs['Result'], mul.inputs[0])
    bsdf.inputs['Emission Color'].default_value = (*rgb, 1.0)
    nt.links.new(mul.outputs['Value'], bsdf.inputs['Emission Strength'])
    return m


BATH_LOOK = {
    'castle': dict(tile=0xf0d4da, tile_s=0.25, body=0xf4c8d4, rim=GOLD, metal=GOLD, basin=(0.4, 0.9, 1.0), caustic=0.9),
    'space': dict(tile=0x1c2448, tile_s=0.35, body=0x12183c, rim=(0.25, 0.55, 1.0), metal=STEEL, basin=(0.3, 0.5, 1.0), caustic=1.1),
    'onsen': dict(tile=0x6e6c68, tile_s=0.3, body=0xc8a070, rim=None, metal=STEEL, basin=(0.5, 0.45, 0.35), caustic=0.3),
    'karaoke': dict(tile=0x24242c, tile_s=0.3, body=0x14141c, rim=(1.0, 0.25, 0.9), metal=STEEL, basin=(1.0, 0.3, 0.9), caustic=1.0),
    'dungeon': dict(tile=0x35322f, tile_s=0.4, body=0x1a1a1c, rim=(1.0, 0.2, 0.12), metal=STEEL, basin=(1.0, 0.25, 0.18), caustic=0.7),
    'marine': dict(tile=0x2a7a9a, tile_s=0.25, body=0xe8f4f8, rim=(0.3, 0.9, 1.0), metal=STEEL, basin=(0.3, 0.8, 1.0), caustic=1.2),
    'resort': dict(tile=0xc8d8b0, tile_s=0.3, body=0xb89868, rim=None, metal=GOLD, basin=(0.5, 0.9, 0.7), caustic=0.8),
    'mirror': dict(tile=0x303038, tile_s=0.3, body=0x202028, rim=(0.8, 0.8, 1.0), metal=STEEL, basin=(0.6, 0.6, 1.0), caustic=1.0),
    'suite': dict(tile=0x3a1018, tile_s=0.3, body=0x2a0c14, rim=GOLD, metal=GOLD, basin=(1.0, 0.45, 0.4), caustic=0.9),
    'retro': dict(tile=0x58b8b0, tile_s=0.15, body=0xf0a0c0, rim=(1.0, 0.4, 0.8), metal=STEEL, basin=(1.0, 0.6, 0.9), caustic=1.0),
    'sakura': dict(tile=0xe8d8c8, tile_s=0.25, body=0xd8a878, rim=None, metal=STEEL, basin=(1.0, 0.8, 0.85), caustic=0.6),
}


def bath(R, theme):
    """A room's bath behind glass (the panes and the water are the game's): the tiled corner, a tub, a shower, towels."""
    L = BATH_LOOK[theme]
    y = R.y
    ba = R.piece('bath')
    tub = PLAN['layouts'][R.room['layout']]['tub']
    ta, tb = expr(tub['a'], R.W), tub['b']
    tile = M('btile', L['tile'], 0.25, grain='tiles', scale=1.0 / L['tile_s'], strength=0.12)
    tilew = M('btilew', L['tile'], 0.25, grain='tilesw', scale=1.0 / L['tile_s'], strength=0.12)
    metal = L['metal']
    a0, a1, b0, b1 = ba
    # The tiled floor, the two tiled walls (the room's side wall and the bed wall), a drain.
    R.box(a0, a1, b0, b1, 0.02, 0.04, tile, 0, 'bath_floor')
    R.box(a1 - 0.065, a1 - 0.05, b0 + 0.05, b1, 0.04, 2.4, tilew, 0, 'bath_wall_side')
    R.box(a0, a1 - 0.05, b0 + 0.05, b0 + 0.065, 0.04, 2.4, tilew, 0, 'bath_wall_bed')
    R.box(a0, a1 - 0.05, b0 + 0.05, b0 + 0.075, 2.38, 2.42, metal, 0, 'bath_trim')
    R.box(a1 - 0.075, a1 - 0.05, b0 + 0.05, b1, 2.38, 2.42, metal, 0, 'bath_trim')
    R.box(a0 - 0.02, a0 + 0.02, b0 + 0.05, b1 + 0.02, 2.38, 2.42, metal, 0, 'glass_rail')
    R.box(a0, a1 - 0.05, b1 - 0.02, b1 + 0.02, 2.38, 2.42, metal, 0, 'glass_rail')
    R.box(a0 - 0.025, a0 + 0.025, b1 - 0.025, b1 + 0.025, 0.04, 2.42, metal, 0, 'glass_post')
    bd = PLAN['layouts'][R.room['layout']].get('bathDoor')
    if bd:
        for b in (bd[0] - 0.04, bd[1]):
            R.box(a0 - 0.025, a0 + 0.025, b, b + 0.04, 0.04, 2.24, metal, 0, 'bath_door_post')
        R.box(a0 - 0.025, a0 + 0.025, bd[0] - 0.04, bd[1] + 0.04, 2.2, 2.24, metal, 0, 'bath_door_head')
    basin = caustic_mat(L['basin'], L['caustic'])
    ca, cb = ta, tb
    ro, ri, rim = TUB_R_OUT, TUB_R_IN, TUB_RIM
    if theme == 'onsen':
        wood = M('hinoki', 0xc8a070, 0.45, grain='wood', scale=14, strength=0.35)
        iw, idp = TUB['onsen']
        ow, odp = iw + 0.25, idp + 0.25
        u0, u1, t0, t1 = R.rect(ca - ow / 2, ca + ow / 2, cb - odp / 2, cb + odp / 2)
        ring_box((u0 + u1) / 2, (t0 + t1) / 2, u1 - u0, t1 - t0, iw, idp, R.y + 0.04, R.y + rim, wood, 'hinoki_tub')
        R.box(ca - iw / 2, ca + iw / 2, cb - idp / 2, cb + idp / 2, 0.13, 0.14, basin, 0, 'basin_floor')
        R.box(ca - iw / 2 + 0.1, ca + iw / 2 - 0.1, cb - idp / 2, cb - idp / 2 + 0.35, 0.14, 0.32, wood, 0.01, 'tub_seat')
        rock = M('rock', 0x6a6a68, 0.9, grain='plaster', scale=30, strength=0.4)
        # A rockery on the floor along the tub's far side, banked against it (they had hung in the air at the rim).
        for k, (da, rs) in enumerate(((-0.95, 0.3), (-0.4, 0.4), (0.25, 0.28), (0.8, 0.36), (-0.1, 0.2))):
            R.sphere(ca + da, cb + odp / 2 + rs * 0.75 + (0.35 if k == 4 else 0), 0.04 + rs * 0.6, rs, rock, sz=0.72, name='rock')
        R.cyl(a1 - 0.18, cb, 1.0, 1.06, 0.045, M('bamboo', 0x8a9a4a, 0.5), 10, axis='X', name='spout')
        R.cyl(a1 - 0.18, cb, 0.95, 1.18, 0.045, M('bamboo', 0x8a9a4a, 0.5), 10, name='spout_pipe')
        R.cyl(ca + 0.5, cb - odp / 2 - 0.3, 0.04, 0.26, 0.16, wood, 14, r2=0.14, name='bucket')
        R.cyl(ca - 0.5, cb - odp / 2 - 0.35, 0.04, 0.38, 0.2, wood, 14, name='stool')
    else:
        u, t = R.U(ca), R.T(cb)
        body = M('tubbody_%s' % theme, L['body'], 0.2, grain='plaster' if theme == 'castle' else None, scale=6, strength=0.12)
        ring_cyl(u, t, y + 0.04, y + rim, ro, ri, body, 44, 'tub')
        cyl(u, t, y + 0.13, y + 0.14, ri - 0.01, basin, 44, name='basin_floor')
        ring_cyl(u, t, y + 0.14, y + 0.32, ri, ri - 0.3, body, 44, 'tub_seat')
        rg = L['rim']
        if rg is None:
            pass
        elif isinstance(rg, tuple):
            ring_cyl(u, t, y + rim, y + rim + 0.02, ro + 0.01, ri - 0.01, glow('rim_glow', rg, 7.0), 44, 'rim_glow', floor=-0.05)
        else:
            ring_cyl(u, t, y + rim, y + rim + 0.03, ro + 0.02, ri - 0.02, rg, 44, 'rim_trim', floor=-0.05)
        for k in range(8):
            a = k * math.pi / 4 + 0.3
            cyl(u + (ri - 0.015) * math.cos(a), t + (ri - 0.015) * math.sin(a), y + 0.27, y + 0.3, 0.04, metal, 12, name='jet', axis='X' if abs(math.cos(a)) > 0.7 else 'Y')
        # A step up on the room's side, a gooseneck tap on the rim (on the side away from the bed wall), candles, a bottle.
        R.box(ca - ro - 0.45, ca - ro + 0.1, cb - 0.6, cb + 0.6, 0.04, 0.3, tile, 0.01, 'tub_step')
        sgn = 1 if R.fwd else -1
        mid = (ro + ri) / 2
        cyl(u, t + sgn * mid, y + rim, y + rim + 0.34, 0.02, metal, 10, name='tap_post')
        cyl(u, t + sgn * (mid - 0.09), y + rim + 0.33, y + rim + 0.35, 0.02, metal, 10, name='tap_arm', axis='Y')
        for k, a in enumerate((2.2, 2.5, 2.8)):
            cyl(u + mid * math.cos(a), t + mid * math.sin(a), y + rim + 0.02, y + rim + 0.14, 0.035, WHITE, 10, name='candle')
            cyl(u + mid * math.cos(a), t + mid * math.sin(a), y + rim + 0.14, y + rim + 0.19, 0.012, glow('flame', (1.0, 0.75, 0.3), 12.0), 6, name='flame')
        cyl(u + mid, t - sgn * 0.45, y + rim + 0.02, y + rim + 0.26, 0.04, M('bottle2', 0x8a3a5a if theme == 'castle' else 0x3a5a8a, 0.2), 10, name='bottle')
    # The shower beyond the tub (the far end from the bed wall): a drain, a rain head, a mixer, a hand shower.
    sb = min(b1 - 0.6, tb + ro + 0.8)
    R.box(ca - 0.2, ca + 0.2, sb - 0.1, sb + 0.1, 0.04, 0.05, BLACK, 0, 'drain')
    R.cyl(ca, sb, 2.4, RC, 0.02, metal, 8, name='rain_pipe')
    R.cyl(ca, sb, 2.37, 2.4, 0.24, metal, 20, name='rain_head')
    R.cyl(a1 - 0.09, sb - 0.2, 1.1, 1.3, 0.05, metal, 14, name='mixer', axis='X')
    R.cyl(a1 - 0.08, sb + 0.2, 1.0, 2.1, 0.014, metal, 8, name='shower_bar')
    R.cyl(a1 - 0.12, sb + 0.2, 1.7, 1.95, 0.03, metal, 10, name='hand_shower')
    # Towels on a rail on the bed wall, bath side.
    towel = M('towel', 0xf4f0ec if theme not in ('karaoke', 'dungeon') else (0xe8d0f0 if theme == 'karaoke' else 0x5a0c12), 0.95, grain='plaster', scale=90, strength=0.2)
    R.box(a0 + 0.25, a0 + 1.2, b0 + 0.1, b0 + 0.12, 1.25, 1.27, metal, 0, 'towel_rail')
    R.box(a0 + 0.3, a0 + 0.7, b0 + 0.075, b0 + 0.13, 0.6, 1.28, towel, 0.015, 'towel')
    R.box(a0 + 0.75, a0 + 1.15, b0 + 0.075, b0 + 0.13, 0.75, 1.28, towel, 0.015, 'towel')
