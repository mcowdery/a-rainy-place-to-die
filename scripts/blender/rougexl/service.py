"""Hotel Rouge: the rooms behind the scenes (the front office, the laundry, housekeeping, the manager's office). Each is a
shell and the plan's `things`: [name, a0, a1, b0, b1, height] in the room's frame, the same rects the game collides with."""
import math

import common as C
from common import (  # noqa: F401
    BLACK, CEIL, DAMASK, F, G_WARM, G_WHITE, GOLD, GREY, M, RM, STEEL, WHITE, WOOD, WOOD_D, WOOD_L, box, cyl, door_frame, glow,
)

H = 0.65

LOOKS = {
    'staff': dict(wall=0xc8b8a0, floor=0x4a3a34, floor_grain='plaster', accent=0x8a6a4a),
    'laundry': dict(wall=0xb8bcb8, floor=0x6a6e6c, floor_grain='plaster', accent=0x5a6a8a),
    'housekeeping': dict(wall=0xd8d0c0, floor=0x8a847a, floor_grain='plaster', accent=0xb89a6a),
    'office': dict(wall=0x5a4a3a, floor=0x2a2018, floor_grain='wood', accent=0x2a6a4a),
}


def service(room):
    R = RM(room)
    th = room['theme']
    L = LOOKS[th]
    W, D = R.W, R.D
    da = R.du
    wall = M('swall_' + th, L['wall'], 0.85, grain='plaster', scale=8, strength=0.2)
    floor = M('sfloor_' + th, L['floor'], 0.6, grain=L['floor_grain'], scale=20, strength=0.3)
    R.box(0, 0.05, 0, D, 0, CEIL, wall, 0, 'sroom_w')
    if th == 'staff':
        # The little window onto the lobby: a real opening in the east wall (the plan's staffWindow, t -> b from the street wall).
        from common import PLAN as _P
        w0, w1 = _P['ground']['staffWindow']
        b0, b1 = w0 - R.t0, w1 - R.t0
        R.box(W - 0.05, W, 0, b0, 0, CEIL, wall, 0, 'sroom_e')
        R.box(W - 0.05, W, b1, D, 0, CEIL, wall, 0, 'sroom_e')
        R.box(W - 0.05, W, b0, b1, 0, 0.95, wall, 0, 'sroom_e')
        R.box(W - 0.05, W, b0, b1, 1.35, CEIL, wall, 0, 'sroom_e')
    else:
        R.box(W - 0.05, W, 0, D, 0, CEIL, wall, 0, 'sroom_e')
    R.box(0, W, 0, 0.05, 0, CEIL, wall, 0, 'sroom_far')
    for a0, a1 in ((0, da - H), (da + H, W)):
        R.box(a0, a1, D - 0.05, D, 0, CEIL, wall, 0, 'sroom_door_wall')
        R.box(a0 - (0.05 if a0 == 0 else 0), a1 + (0.05 if a1 == W else 0), D, D + 0.1, 0, CEIL, DAMASK, 0, 'corr_wall')
    R.box(da - H, da + H, D - 0.05, D, 2.2, CEIL, wall, 0, 'sroom_lintel')
    R.box(da - H, da + H, D, D + 0.1, 2.2, CEIL, DAMASK, 0, 'corr_lintel')
    door_frame(R.y, R.U(da), R.T(D), None)
    R.box(0.05, W - 0.05, 0.05, D - 0.05, 0.02, 0.035, floor, 0, 'sroom_floor')
    R.box(0, W, 0, D, CEIL - 0.05, CEIL, wall, 0, 'sroom_ceiling')
    R.box(0.05, W - 0.05, 0.05, 0.08, 0.035, 0.12, M('sskirt', 0x4a4a4a, 0.6), 0.003, 'skirt')
    # Tube lights.
    for k in range(max(1, int(D // 3.5))):
        R.box(W / 2 - 0.6, W / 2 + 0.6, 1.0 + k * 3.4, 1.12 + k * 3.4, CEIL - 0.07, CEIL - 0.05, G_WHITE, 0, 'tube')
    for t in room.get('things', []):
        BUILD[t[0]](R, th, L, *t[1:])
    return R


# ---- things ---------------------------------------------------------------------------------------------------------------


def desk(R, th, L, a0, a1, b0, b1, h):
    top = M('desk_top_' + th, 0x3a2a20 if th != 'office' else 0x4a2a18, 0.45, grain='wood', scale=16, strength=0.3)
    R.box(a0, a1, b0, b1, h - 0.05, h, top, 0.008, 'desk_top')
    for a in (a0 + 0.04, a1 - 0.1):
        R.box(a, a + 0.06, b0 + 0.04, b1 - 0.04, 0, h - 0.05, top, 0.004, 'desk_leg')
    R.box(a0 + 0.1, a0 + 0.6, b0 + 0.05, b1 - 0.05, 0, h - 0.05, top, 0.004, 'drawers')
    mid = (a0 + a1) / 2
    R.box(mid - 0.3, mid + 0.3, b1 - 0.35, b1 - 0.1, h, h + 0.4, BLACK, 0.02, 'monitor')
    R.box(mid - 0.27, mid + 0.27, b1 - 0.37, b1 - 0.35, h + 0.04, h + 0.36, glow('monitor', (0.4, 0.9, 0.6), 2.0), 0, 'monitor_screen')
    R.cyl(a1 - 0.35, b0 + 0.25, h, h + 0.25, 0.07, M('banker', 0x2a6a4a, 0.3), 12, r2=0.05, name='desk_lamp')
    R.box(a0 + 0.15, a0 + 0.5, b0 + 0.1, b0 + 0.4, h, h + 0.01, M('papers', 0xe8d8c0, 0.8), 0, 'papers')
    C.chair(R, (a0 + a1) / 2, b1 + 0.45, 'b-', M('chair', 0x3a3a3a, 0.7), frame=STEEL)


def lockers(R, th, L, a0, a1, b0, b1, h):
    n = max(1, int((a1 - a0) / 0.38))
    w = (a1 - a0) / n
    R.box(a0, a1, b0, b1, 0, h, M('locker', 0x6a7a8a, 0.4, 0.5), 0.004, 'lockers')
    for k in range(n):
        R.box(a0 + k * w + 0.02, a0 + (k + 1) * w - 0.02, b1, b1 + 0.015, 0.1, h - 0.1, M('locker_door', 0x7a8a9a, 0.4, 0.5), 0.004, 'locker_door')
        R.box(a0 + k * w + w * 0.7, a0 + k * w + w * 0.78, b1 + 0.015, b1 + 0.04, 0.9, 1.05, STEEL, 0.002, 'handle')


def couch(R, th, L, a0, a1, b0, b1, h):
    fab = M('couch', 0x7a4a3a if th != 'office' else 0x1a2a20, 0.9, grain='plaster', scale=90, strength=0.3)
    C.sofa(R, a0, a1, b0, b1, 'a0', fab, seat=h)


def fridge(R, th, L, a0, a1, b0, b1, h):
    R.box(a0, a1, b0, b1, 0, h, WHITE, 0.02, 'fridge')
    R.box(a0 - 0.02, a0, b0 + 0.1, b0 + 0.14, 0.4, 0.8, STEEL, 0.002, 'handle')


def washer(R, th, L, a0, a1, b0, b1, h):
    R.box(a0, a1, b0, b1, 0, h, M('washer', 0xe8ecec, 0.3), 0.02, 'washer')
    R.cyl((a0 + a1) / 2, b1, 0.35, 0.8, 0.27, M('washer_door', 0x3a4a5a, 0.1), 24, name='washer_door', axis='Y')
    R.cyl((a0 + a1) / 2, b1 + 0.01, 0.4, 0.75, 0.22, glow('washer_glass', (0.3, 0.5, 0.8), 1.0), 24, name='washer_glass', axis='Y')
    R.box(a0 + 0.1, a1 - 0.1, b1, b1 + 0.02, h - 0.2, h - 0.08, BLACK, 0.003, 'washer_panel')


def dryer(R, th, L, a0, a1, b0, b1, h):
    R.box(a0, a1, b0, b1, 0, h, M('dryer', 0xdcdcd8, 0.3), 0.02, 'dryer')
    R.cyl((a0 + a1) / 2, b1, 0.5, 1.1, 0.3, M('dryer_door', 0x2a3a4a, 0.1), 24, name='dryer_door', axis='Y')
    R.cyl((a0 + a1) / 2, b1 + 0.01, 0.55, 1.05, 0.25, glow('dryer_glass', (0.8, 0.7, 0.5), 0.8), 24, name='dryer_glass', axis='Y')


def table(R, th, L, a0, a1, b0, b1, h):
    top = M('table_' + th, 0xc8b898 if th != 'office' else 0x4a2a18, 0.5, grain='wood', scale=16, strength=0.3)
    R.box(a0, a1, b0, b1, h - 0.05, h, top, 0.006, 'table_top')
    for a, b in ((a0 + 0.05, b0 + 0.05), (a1 - 0.1, b0 + 0.05), (a0 + 0.05, b1 - 0.1), (a1 - 0.1, b1 - 0.1)):
        R.box(a, a + 0.05, b, b + 0.05, 0, h - 0.05, top, 0.003, 'table_leg')
    for k in range(3):
        R.box(a0 + 0.2 + k * 0.5, a0 + 0.6 + k * 0.5, b0 + 0.15, b0 + 0.55, h, h + 0.12 + 0.03 * k, M('folded%d' % k, (0xf4f0f0, 0xc8e0f0, 0xf0d0d8)[k % 3], 0.9), 0.01, 'folded')


def shelf(R, th, L, a0, a1, b0, b1, h):
    frame = M('shelf_frame', 0x7a7e82, 0.4, 0.6)
    R.box(a0, a1, b0, b1, 0, h, frame, 0.004, 'shelf_back')
    wide = (a1 - a0) > (b1 - b0)
    for k in range(5):
        z = 0.1 + k * (h - 0.2) / 5
        if wide:
            R.box(a0, a1, b0 - 0.2 if False else b0, b1, z, z + 0.03, frame, 0.002, 'shelf_board')
        else:
            R.box(a0 - 0.0, a1 + 0.3, b0, b1, z, z + 0.03, frame, 0.002, 'shelf_board')
        n = int((b1 - b0) / 0.45) if not wide else int((a1 - a0) / 0.45)
        for j in range(n):
            col = (0xf4f0f0, 0xc8e0f0, 0xf0d0d8, 0xe8e0c0)[(j + k) % 4]
            if wide:
                R.box(a0 + 0.05 + j * 0.45, a0 + 0.4 + j * 0.45, b0, b1 + 0.0, z + 0.03, z + 0.3, M('linen%d' % ((j + k) % 4), col, 0.9, grain='plaster', scale=70, strength=0.25), 0.02, 'linen')
            else:
                R.box(a1, a1 + 0.3, b0 + 0.05 + j * 0.45, b0 + 0.4 + j * 0.45, z + 0.03, z + 0.3, M('linen%d' % ((j + k) % 4), col, 0.9, grain='plaster', scale=70, strength=0.25), 0.02, 'linen')


def cart(R, th, L, a0, a1, b0, b1, h):
    R.box(a0, a1, b0, b1, 0.0, 0.08, STEEL, 0.003, 'cart_base')
    R.box(a0, a1, b0, b1, h - 0.1, h, WHITE, 0.006, 'cart_top')
    for a, b in ((a0 + 0.03, b0 + 0.03), (a1 - 0.06, b0 + 0.03), (a0 + 0.03, b1 - 0.06), (a1 - 0.06, b1 - 0.06)):
        R.box(a, a + 0.03, b, b + 0.03, 0, h, STEEL, 0.002, 'cart_leg')
    for z in (0.35, 0.7):
        R.box(a0 + 0.05, a1 - 0.05, b0 + 0.05, b1 - 0.05, z, z + 0.12, M('cart_linen', 0xf4d8e0, 0.9, grain='plaster', scale=70, strength=0.3), 0.01, 'linen')
    R.box(a1 - 0.35, a1 - 0.2, b0 + 0.15, b0 + 0.3, h, h + 0.2, M('cart_bottle', 0x4a90c0, 0.3), 0.01, 'bottle')
    R.cyl(a0 + 0.3, b1 + 0.0, h - 0.0, h + 0.5, 0.01, STEEL, 6, name='cart_handle')


def sink(R, th, L, a0, a1, b0, b1, h):
    R.box(a0, a1, b0, b1, 0, h, M('sink_cab', 0x8a8a8a, 0.5, 0.4), 0.01, 'sink_cabinet')
    R.box(a0 + 0.1, a1 - 0.1, b0 + 0.05, b1 - 0.05, h, h + 0.02, STEEL, 0.004, 'sink_top')
    R.cyl((a0 + a1) / 2, b1 - 0.1, h, h + 0.35, 0.015, STEEL, 8, name='tap')


def cabinet(R, th, L, a0, a1, b0, b1, h):
    R.box(a0, a1, b0, b1, 0, h, M('cab', 0x4a5a52, 0.4, 0.5), 0.006, 'cabinet')
    wide = (a1 - a0) > (b1 - b0)
    n = max(2, int(h / 0.32))
    for k in range(n):
        z = 0.05 + k * ((h - 0.1) / n)
        if wide:
            R.box(a0 + 0.04, a1 - 0.04, b1, b1 + 0.015, z, z + (h - 0.1) / n - 0.03, M('cab_door', 0x5a6a62, 0.4, 0.5), 0.003, 'cab_drawer')
        else:
            R.box(a1, a1 + 0.015, b0 + 0.04, b1 - 0.04, z, z + (h - 0.1) / n - 0.03, M('cab_door', 0x5a6a62, 0.4, 0.5), 0.003, 'cab_drawer')


def safe(R, th, L, a0, a1, b0, b1, h):
    R.box(a0, a1, b0, b1, 0, h, M('safe', 0x1a2a20, 0.35, 0.6), 0.012, 'safe')
    R.cyl(a1, (b0 + b1) / 2, 0.4, 0.46, 0.07, GOLD, 20, name='safe_dial', axis='X')


def monitors(R, th, L, a0, a1, b0, b1, h):
    # A wall of CCTV screens: a row of two, each a small glowing picture.
    R.box(a0, a1, b0, b1, 0.9, 0.9 + h, BLACK, 0.01, 'monitor_wall')
    n = max(1, int((a1 - a0) / 0.6))
    w = (a1 - a0) / n
    for r in range(2):
        for k in range(n):
            R.box(a0 + k * w + 0.04, a0 + (k + 1) * w - 0.04, b1, b1 + 0.02, 1.05 + r * 0.5, 1.4 + r * 0.5, glow('cctv', (0.35, 0.8, 0.55), 1.8), 0, 'cctv')


BUILD = {
    'desk': desk, 'lockers': lockers, 'couch': couch, 'fridge': fridge, 'washer': washer, 'dryer': dryer, 'table': table, 'shelf': shelf,
    'cart': cart, 'sink': sink, 'cabinet': cabinet, 'safe': safe, 'monitors': monitors,
}


def service_lights(R, point):
    W, D = R.W, R.D
    for k in range(max(1, int(D // 3.5))):
        point(R.U(W / 2), R.T(1.1 + k * 3.4), R.y + CEIL - 0.3, (0.9, 1.0, 0.9), 70, 0.2, 'tube')
