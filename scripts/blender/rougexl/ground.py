"""Hotel Rouge: the ground floor's fixed parts (the rooms, the front office, 101 and the laundry, are guest.py / service.py):
the perimeter walls (to the roof, for every storey), the lobby, the garage, the back hall, the stair well."""
import math

import common as C
from common import (  # noqa: F401
    BLACK, CARPET, CEIL, CEILING, CONCRETE, DAMASK, DARK, F, FRONT_DOOR, G_GREEN, G_MIRROR, G_PINK, G_WARM, G_WHITE, GOLD, GOLD_T, GREY, GROUND, IN,
    LEAF, M, PLAN, ROOF, SIDE_DOOR, STAIR, STEEL, WALLPAPER, WHITE, WOOD, WOOD_D, WOOD_L, box, cyl, glow, sphere,
)

H = 0.65
U0, U1, T0, T1 = IN['u0'], IN['u1'], IN['t0'], IN['t1']
SH = [STAIR['u0'], U1, STAIR['lane2'][0], STAIR['lane1'][1]]  # the stair shaft
LOBBY = GROUND['lobby']
GARAGE = GROUND['garage']
PANEL = GROUND['panelWall']
CX = (FRONT_DOOR[0] + FRONT_DOOR[1]) / 2  # the front doors' centre
CAR = GROUND['car']
POTS = M('pot', 0x8a6a4a, 0.6)
VELVET = M('velvet', 0x8a3a5a, 0.95, grain='plaster', scale=120, strength=0.3)
CONC_W = M('concrete_wall', 0x5a5a5c, 0.9, grain='plaster', scale=30, strength=0.35)
RUG = M('rug', 0x7a2c48, 0.95, grain='plaster', scale=90, strength=0.4)


def perimeter():
    """The keep's walls inside, full height: the front doors' gap, the side doorway's gap, both with their frames."""
    top = ROOF
    box(U0 - 0.1, U0, T0 - 0.1, SIDE_DOOR[0], 0, top, WALLPAPER, 0, 'wall_w')
    box(U0 - 0.1, U0, SIDE_DOOR[1], T1 + 0.1, 0, top, WALLPAPER, 0, 'wall_w')
    box(U0 - 0.1, U0, SIDE_DOOR[0], SIDE_DOOR[1], 2.27, top, WALLPAPER, 0, 'wall_w_lintel')
    box(U1, U1 + 0.1, T0 - 0.1, T1 + 0.1, 0, top, WALLPAPER, 0, 'wall_e')
    box(U0 - 0.1, U1 + 0.1, T1, T1 + 0.1, 0, top, WALLPAPER, 0, 'wall_n')
    box(U0 - 0.1, FRONT_DOOR[0], T0 - 0.1, T0, 0, top, WALLPAPER, 0, 'wall_s')
    box(FRONT_DOOR[1], U1 + 0.1, T0 - 0.1, T0, 0, top, WALLPAPER, 0, 'wall_s')
    box(FRONT_DOOR[0], FRONT_DOOR[1], T0 - 0.1, T0, 3.05, top, WALLPAPER, 0, 'wall_s_lintel')
    # The doorways are real openings in the keep's outer wall (0.3 m out from here, loveHotel.ts): their jambs, heads and
    # thresholds line the wall's thickness right out to its face (0.01 short of it, so nothing shares its plane).
    OUT = 0.29
    box(FRONT_DOOR[0] - 0.1, FRONT_DOOR[0], T0 - OUT, T0 + 0.1, 0, 2.95, DARK, 0, 'jamb')
    box(FRONT_DOOR[1], FRONT_DOOR[1] + 0.1, T0 - OUT, T0 + 0.1, 0, 2.95, DARK, 0, 'jamb')
    box(FRONT_DOOR[0] - 0.1, FRONT_DOOR[1] + 0.1, T0 - OUT, T0 + 0.1, 2.95, 3.05, DARK, 0, 'door_head')
    box(FRONT_DOOR[0], FRONT_DOOR[1], T0 - OUT, T0, -0.05, 0.02, M('threshold', 0x6a5a4a, 0.5), 0, 'threshold')
    sw = M('side_wood', 0x5a4a3a, 0.5, grain='wood', scale=14, strength=0.4)
    s0, s1 = SIDE_DOOR
    box(U0 - OUT, U0 + 0.06, s0 - 0.07, s0, 0, 2.2, sw, 0, 'architrave')
    box(U0 - OUT, U0 + 0.06, s1, s1 + 0.07, 0, 2.2, sw, 0, 'architrave')
    box(U0 - OUT, U0 + 0.06, s0 - 0.07, s1 + 0.07, 2.2, 2.27, sw, 0, 'architrave')
    box(U0 - OUT, U0, s0, s1, -0.05, 0.02, sw, 0, 'side_threshold')
    box(U0 + 0.05, U0 + 0.08, (s0 + s1) / 2 - 0.25, (s0 + s1) / 2 + 0.25, 2.35, 2.55, G_GREEN, 0, 'exit_lamp')
    # Skirting, a dado rail and a cornice (gold) round the ground floor's outer walls, broken at the doorways.
    d = 0.03
    for z0, z1, dep in ((0.0, 0.14, d), (0.95, 1.0, d), (CEIL - 0.12, CEIL, 0.06)):
        box(U0, U1, T1 - dep, T1, z0, z1, GOLD_T, 0.003, 'rail_n')
        box(U1 - dep, U1, T0, T1, z0, z1, GOLD_T, 0.003, 'rail_e')
        if z1 <= 1.0:
            box(U0, U0 + dep, T0, s0 - 0.07, z0, z1, GOLD_T, 0.003, 'rail_w')
            box(U0, U0 + dep, s1 + 0.07, T1, z0, z1, GOLD_T, 0.003, 'rail_w')
        else:
            box(U0, U0 + dep, T0, T1, z0, z1, GOLD_T, 0.003, 'rail_w')
        box(U0, FRONT_DOOR[0] - 0.1, T0, T0 + dep, z0, z1, GOLD_T, 0.003, 'rail_s')
        box(FRONT_DOOR[1] + 0.1, U1, T0, T0 + dep, z0, z1, GOLD_T, 0.003, 'rail_s')
    # Dark wood panelling to the dado rail along the outer walls (not in the front court's lobby, which has its own).
    p = 0.014
    box(U0, U0 + p, T0, s0 - 0.07, 0.14, 0.95, WOOD, 0.003, 'wains_w')
    box(U0, U0 + p, s1 + 0.07, T1, 0.14, 0.95, WOOD, 0.003, 'wains_w')
    box(U1 - p, U1, T0, T1, 0.14, 0.95, WOOD, 0.003, 'wains_e')
    box(U0, U1, T1 - p, T1, 0.14, 0.95, WOOD, 0.003, 'wains_n')
    box(U0, FRONT_DOOR[0] - 0.1, T0, T0 + p, 0.14, 0.95, WOOD, 0.003, 'wains_s')
    box(FRONT_DOOR[1] + 0.1, U1, T0, T0 + p, 0.14, 0.95, WOOD, 0.003, 'wains_s')


def floors_ceilings():
    """The carpet and the ceiling slab of the ground floor (the stair shaft is open above and has treads for a floor)."""
    s = SH
    for a, b, c, e in ((U0, U1, T0, s[2]), (U0, s[0], s[2], T1), (s[0], U1, s[3], T1)):
        box(a, b, c, e, -0.05, 0.02, CARPET, 0, 'carpet')
        box(a, b, c, e, CEIL, 5.0, CEILING, 0, 'ceiling')
    g = GARAGE
    box(g[0], g[1], g[2], g[3], 0.02, 0.03, CONCRETE, 0, 'garage_floor')
    # A rose rug under the chandelier, with a gold border.
    lu = (LOBBY[0] + LOBBY[1]) / 2
    lt = 8.0
    cyl(lu, lt, 0.02, 0.032, 2.6, RUG, 40, name='rug')
    cyl(lu, lt, 0.032, 0.034, 2.6, GOLD, 40, r2=2.52, name='rug_ring')
    cyl(lu, lt, 0.034, 0.036, 2.5, RUG, 40, name='rug_inner')


def lobby():
    lu = (LOBBY[0] + LOBBY[1]) / 2
    ct = 8.0
    # The chandelier: a gold chain, a crown of glass drops, glowing.
    g = glow('g_chand', (1.0, 0.8, 0.85), 0.9)
    cyl(lu, ct, CEIL - 0.35, CEIL, 0.02, GOLD, 8, name='chain')
    cyl(lu, ct, CEIL - 0.5, CEIL - 0.35, 0.5, g, 20, r2=0.1, name='chand_top')
    cyl(lu, ct, CEIL - 0.8, CEIL - 0.5, 0.85, g, 20, r2=0.5, name='chand_mid')
    cyl(lu, ct, CEIL - 1.1, CEIL - 0.8, 0.6, g, 20, r2=0.85, name='chand_low')
    cyl(lu, ct, CEIL - 1.2, CEIL - 1.1, 0.1, GOLD, 12, r2=0.02, name='chand_tip')
    for k in range(10):
        a = k * math.pi / 5
        cyl(lu + 0.7 * math.cos(a), ct + 0.7 * math.sin(a), CEIL - 1.05, CEIL - 0.8, 0.025, g, 8, r2=0.01, name='drop')
    # Pink neon either side of the doors, a gold band over them.
    for a, b in ((LOBBY[0] + 0.4, LOBBY[0] + 1.0), (LOBBY[1] - 1.0, LOBBY[1] - 0.4)):
        box(a, b, T0 + 0.05, T0 + 0.12, CEIL - 0.3, CEIL - 0.25, G_PINK, 0, 'neon')
    box(FRONT_DOOR[0], FRONT_DOOR[1], T0 + 0.1, T0 + 0.13, 2.95, 3.02, GOLD, 0, 'door_band')
    # The bench by the doors, a velvet seat with a back; a plant in a clay pot near the garage side.
    b = GROUND['bench']
    C.sofa(C.World, b[0], b[1], b[2], b[3], 'b0', VELVET, feet=GOLD)
    pu, pt = GROUND['plant']
    cyl(pu, pt, 0.0, 0.5, 0.28, POTS, 14, r2=0.3, name='pot')
    for k in range(7):
        a = k * 0.9
        cyl(pu + 0.2 * math.cos(a), pt + 0.2 * math.sin(a), 0.5, 1.6 + 0.2 * (k % 3), 0.12, LEAF, 6, r2=0.02, name='frond')
    # The lobby's east wall (the garage's west wall): a mirror and a console with a vase; a print clear of the garage door.
    e = LOBBY[1]
    box(e - 0.06, e - 0.04, 5.5, 6.8, 0.4, 2.3, G_MIRROR, 0, 'mirror')
    box(e - 0.04, e - 0.005, 5.45, 6.85, 0.35, 2.35, GOLD, 0.01, 'mirror_frame')
    box(e - 0.45, e - 0.06, 5.6, 6.7, 0.0, 0.78, WOOD, 0.01, 'console')
    box(e - 0.47, e - 0.04, 5.58, 6.72, 0.78, 0.82, GOLD, 0.006, 'console_top')
    cyl(e - 0.25, 6.15, 0.82, 1.05, 0.05, GOLD, 12, r2=0.03, name='vase')
    for k in range(5):
        cyl(e - 0.25 + 0.04 * math.cos(k), 6.15 + 0.04 * math.sin(k), 1.05, 1.35 + 0.05 * k, 0.012, LEAF, 6, name='stem')
        sphere(e - 0.25 + 0.06 * math.cos(k * 1.3), 6.15 + 0.06 * math.sin(k * 1.3), 1.38 + 0.05 * k, 0.045, G_PINK if k % 2 else VELVET, name='bloom')
    box(e - 0.06, e - 0.04, 9.1, 10.1, 1.2, 2.0, M('print_e', 0x3a2a4a, 0.7), 0, 'print_e')
    box(e - 0.04, e - 0.005, 9.05, 10.15, 1.15, 2.05, GOLD, 0.008, 'frame_e')
    # The panel wall (dark; the room-select board is the game's canvas on a gold frame; a green button).
    p = PANEL
    box(p[0], p[1], p[2], p[3], 0.0, CEIL, DARK, 0, 'panel_wall')
    box(CX - 2.25, CX + 2.25, p[2] - 0.05, p[2], 0.55, 2.95, GOLD, 0.004, 'panel_frame')
    box(CX + 1.8, CX + 2.0, p[2] - 0.08, p[2] - 0.05, 0.55, 0.65, G_GREEN, 0, 'button')
    box(CX - 2.05, CX + 2.05, p[2] - 0.052, p[2] - 0.05, 0.8, 2.75, glow('g_panel', (0.9, 0.8, 0.95), 0.9), 0, 'panel_glow')
    # The staff room's wall seen from the lobby: a framed print either side of the little window, wall lamps.
    sw0, sw1 = GROUND['staffWall']
    for tt in (5.2, 8.6):
        box(sw1, sw1 + 0.03, tt - 0.4, tt + 0.4, 1.35, 2.05, GOLD, 0.006, 'frame')
        box(sw1 + 0.03, sw1 + 0.035, tt - 0.34, tt + 0.34, 1.41, 1.99, M('print%d' % int(tt), 0x2a1a3a if tt < 7 else 0x4a2a2a, 0.7), 0, 'print')
    for tt in (4.8, 9.6):
        box(sw1, sw1 + 0.1, tt - 0.07, tt + 0.07, 2.0, 2.4, G_WARM, 0.01, 'wall_lamp')
    # The little window: a real opening in the staff room's wall, a ledge, a brass bell.
    w0, w1 = GROUND['staffWindow']
    box(sw1, sw1 + 0.3, w0 - 0.1, w1 + 0.1, 0.9, 0.95, WOOD, 0.006, 'ledge')
    for tt in (w0 - 0.05, w1 + 0.05):
        box(sw1, sw1 + 0.04, tt - 0.05, tt + 0.05, 0.9, 1.4, GOLD, 0.003, 'window_frame')
    box(sw1, sw1 + 0.04, w0 - 0.1, w1 + 0.1, 1.35, 1.4, GOLD, 0.003, 'window_frame')
    cyl(sw1 + 0.15, w0 + 0.4, 0.95, 0.98, 0.05, GOLD, 16, r2=0.04, name='bell')
    cyl(sw1 + 0.15, w0 + 0.4, 0.98, 1.02, 0.025, GOLD, 12, r2=0.01, name='bell_top')


def staff_wall():
    """The wall between the front office and the lobby, with the little window cut through it."""
    sw0, sw1 = GROUND['staffWall']
    w0, w1 = GROUND['staffWindow']
    box(sw0, sw1, T0, w0, 0.0, CEIL, WALLPAPER, 0, 'staff_wall')
    box(sw0, sw1, w1, 12.4, 0.0, CEIL, WALLPAPER, 0, 'staff_wall')
    box(sw0, sw1, w0, w1, 0.0, 0.95, WALLPAPER, 0, 'staff_wall')
    box(sw0, sw1, w0, w1, 1.35, CEIL, WALLPAPER, 0, 'staff_wall')


def garage():
    g = GARAGE
    # The wall between the garage and the lobby, its doorway (a lintel over it); the back wall; the front wall lined
    # with concrete; the strip curtain over the car gate; a light; the bay lines.
    e0, e1 = LOBBY[1], g[0]
    d0, d1 = GROUND['garageDoor']
    box(e0, e1, T0, d0, 0.0, CEIL, WALLPAPER, 0, 'garage_wall')
    box(e0, e1, d1, 12.4, 0.0, CEIL, WALLPAPER, 0, 'garage_wall')
    box(e0, e1, d0, d1, 2.3, CEIL, WALLPAPER, 0, 'garage_lintel')
    box(e0, e1, d0 - 0.06, d0, 0.0, 2.3, GOLD, 0.003, 'garage_jamb')
    box(e0, e1, d1, d1 + 0.06, 0.0, 2.3, GOLD, 0.003, 'garage_jamb')
    box(g[0], g[1], 12.3, 12.5, 0.0, CEIL, M('garage_back', 0x8a8a8c, 0.9, grain='plaster', scale=30, strength=0.3), 0, 'garage_back')
    box(g[0], g[1], T0, T0 + 0.02, 0.0, CEIL, CONC_W, 0, 'garage_front')
    gate0, gate1 = GROUND['garageGate']
    s = gate0 + 0.1
    while s < gate1 - 0.1:
        box(s, s + 0.14, T0 + 0.02, T0 + 0.05, 0.35, 2.7, M('strip', 0xe06090, 0.6), 0, 'strip')
        s += 0.2
    box(gate0, gate1, T0, T0 + 0.02, 2.7, 2.8, GREY, 0.002, 'strip_rail')
    cu = (gate0 + gate1) / 2
    box(cu - 0.6, cu + 0.6, CAR[1] - 0.15, CAR[1] + 0.15, CEIL - 0.03, CEIL, G_WHITE, 0, 'garage_light')
    box(g[0], g[1], g[2] + 1.0, g[2] + 1.05, 0.03, 0.035, M('line', 0xe8d8a0, 0.8), 0, 'bay_line')
    box(g[0], g[1], 12.3 - 1.0, 12.3 - 0.95, 0.03, 0.035, M('line', 0xe8d8a0, 0.8), 0, 'bay_line')


def amenity_item(j, u, t0, t1):
    """What one basket of the free amenity bar holds (the labels are the game's canvases)."""
    z = 1.08
    tc = (t0 + t1) / 2

    def am(name, hexv, rough=0.55, **kw):
        return M('am_' + name, hexv, rough, **kw)

    if j == 0:  # toothbrushes
        for k, c in enumerate((0xe85a8a, 0x4a9ae8, 0x58c878, 0xe8c040, 0xa878e8)):
            uu = u + 0.05 + k * 0.08
            box(uu, uu + 0.028, tc - 0.14, tc + 0.06, z, z + 0.022, am('brush%d' % k, c), 0.004, 'brush')
            box(uu + 0.003, uu + 0.025, tc + 0.06, tc + 0.15, z, z + 0.026, am('brushhead', 0xf4f4f0), 0.004, 'brush_head')
    elif j == 1:  # razors
        for k, c in enumerate((0xe8e8f0, 0x6ac8e8, 0xf0a0c0, 0xe8e8f0, 0x6ac8e8)):
            uu = u + 0.05 + k * 0.08
            box(uu, uu + 0.026, tc - 0.14, tc + 0.08, z, z + 0.02, am('razor%d' % k, c), 0.004, 'razor')
            box(uu - 0.006, uu + 0.032, tc + 0.08, tc + 0.12, z, z + 0.035, am('razorhead', 0x3a3a42, 0.3, metal=0.6), 0.004, 'razor_head')
    elif j == 2:  # shower caps
        for cx, cols_ in ((u + 0.13, (0xf4f0f8, 0xf0c8e0, 0xc8e0f4, 0xf4f0f8)), (u + 0.32, (0xc8f0d8, 0xf4f0f8, 0xf8e8c0, 0xf0c8e0))):
            for k, c in enumerate(cols_):
                cyl(cx, tc, z + k * 0.012, z + k * 0.012 + 0.011, 0.085, am('cap%d' % k, c, 0.7), 24, name='cap')
    elif j == 3:  # hair ties
        for k in range(10):
            cx = u + 0.07 + (k % 5) * 0.08
            ct = tc - 0.07 + (k // 5) * 0.14
            cyl(cx, ct, z, z + 0.014, 0.028, am('tie%d' % (k % 5), (0xe85a8a, 0x4a9ae8, 0xf4f0f0, 0x58c878, 0xe8c040)[k % 5], 0.8), 14, name='tie')
    elif j == 4:  # cotton swabs in a jar
        cyl(u + 0.225, tc, z, z + 0.17, 0.075, am('jar', 0xb8d0d8, 0.15), 20, name='jar')
        for k in range(14):
            a = k * 0.9
            cyl(u + 0.225 + 0.04 * math.cos(a), tc + 0.04 * math.sin(a), z + 0.17, z + 0.2 + 0.01 * (k % 3), 0.005, am('swab', 0xf4f4f0, 0.8), 6, name='swab')
        cyl(u + 0.225, tc, z + 0.17, z + 0.18, 0.08, am('lid', 0xe85a8a), 20, name='lid')
    elif j == 5:  # sheet masks
        for cu, cols_ in ((u + 0.12, (0xf0c8e0, 0xc8e0f4, 0xf4f0c8)), (u + 0.3, (0xc8f0d8, 0xf0c8e0, 0xd8c8f0))):
            for k, c in enumerate(cols_):
                box(cu - 0.07, cu + 0.07, tc - 0.1 + k * 0.012, tc + 0.1 + k * 0.012, z + k * 0.014, z + k * 0.014 + 0.012, am('mask%d' % k, c, 0.6), 0.003, 'mask')
    else:  # lotions
        for k, c in enumerate((0xf4f0f4, 0xf0c8e0, 0xc8e0f4)):
            cu = u + 0.08 + k * 0.145
            cyl(cu, tc, z, z + 0.15, 0.034, am('lotion%d' % k, c, 0.3), 14, name='lotion')
            cyl(cu, tc, z + 0.15, z + 0.185, 0.02, am('cap2', 0x58384a, 0.4), 10, name='cap')


def hall():
    # The back hall's side walls are the backs of 101 (west) and the laundry (east): finished in damask with the hall's
    # skirting and dado (bare, they showed the rooms' own wall colours).
    for r in PLAN['rooms']:
        if r['floor'] != 0 or r['no'] not in ('101', 'laundry'):
            continue
        u0, u1, t0, t1 = r['rect']
        ua, ub, face = (u1, u1 + 0.1, u1 + 0.1) if r['no'] == '101' else (u0 - 0.1, u0, u0 - 0.13)
        box(ua, ub, t0 - 0.1, T1, 0, CEIL, DAMASK, 0, 'hall_side_wall')
        for z0, z1 in ((0.0, 0.14), (0.95, 1.0)):
            box(min(face, face + 0.03), max(face, face + 0.03), t0, T1, z0, z1, GOLD_T, 0, 'rail')
    a0, a1, b0, b1 = GROUND['amenity']
    # The amenity bar behind the panel wall: dark wood, a pale top, baskets of toiletries.
    box(a0, a1, b0, b1, 0.0, 0.9, WOOD, 0.008, 'bar')
    box(a0 - 0.02, a1 + 0.02, b0, b1 + 0.04, 0.9, 0.94, M('bar_top', 0xe8d8c8, 0.4), 0.004, 'bar_top')
    u = a0 + 0.2
    j = 0
    while u < a1 - 0.4:
        box(u, u + 0.45, b0 + 0.08, b1 - 0.08, 0.94, 1.08, WOOD_L, 0.01, 'basket')
        amenity_item(j, u, b0 + 0.08, b1 - 0.08)
        u += 0.6
        j += 1
    # The costume rack along the west wall: two rails, loaded with outfits.
    c0, c1, ct0, ct1 = GROUND['costumes']
    box(c0, c1, ct0, ct0 + 0.04, 0.0, 1.8, STEEL, 0.003, 'rack_frame')
    box(c0, c1, ct1 - 0.04, ct1, 0.0, 1.8, STEEL, 0.003, 'rack_frame')
    box(c0 + 0.3, c0 + 0.34, ct0, ct1, 1.76, 1.8, STEEL, 0.003, 'rack_rail')
    outfits = (0xf4f4f8, 0x1a1a2a, 0xe83a5a, 0x3a5ae8, 0xf4a0c0)
    t = ct0 + 0.08
    k = 0
    while t < ct1 - 0.08:
        box(c0 + 0.05, c0 + 0.6, t, t + 0.06, 0.7, 1.72, M('outfit%d' % (k % 5), outfits[k % 5], 0.85, grain='plaster', scale=60, strength=0.3), 0.01, 'outfit')
        t += 0.12
        k += 1
    # The vending machine against the front office's back wall, facing the hall (+t).
    v = GROUND['vending']
    box(v[0], v[1], v[2], v[3], 0.0, 1.85, M('vending', 0xe83a6a, 0.35), 0.012, 'vending')
    box(v[0] + 0.08, v[1] - 0.08, v[3], v[3] + 0.02, 0.8, 1.7, glow('g_vend', (0.95, 0.9, 1.0), 5.0), 0, 'vending_front')
    for r in range(4):
        box(v[0] + 0.1, v[1] - 0.1, v[3], v[3] + 0.03, 0.88 + r * 0.2, 0.9 + r * 0.2, M('vend_shelf', 0xd8d4dc, 0.4), 0, 'vend_shelf')
    box(v[0] + 0.12, v[0] + 0.5, v[3], v[3] + 0.03, 0.15, 0.6, BLACK, 0.01, 'vend_slot')
    # Sconces along the walls, downlights in the ceiling, benches and a payphone in the middle of the hall.
    for tt in (16.5, 19.5, 22.5, 25.5):
        box(U0, U0 + 0.12, tt, tt + 0.2, 2.3, 2.6, G_WARM, 0.004, 'sconce')
        box(U1 - 0.12, U1, tt, tt + 0.2, 2.3, 2.6, G_WARM, 0.004, 'sconce')
    for (uu, tt) in ((8.0, 14.5), (14.0, 15.5), (18.0, 22.0), (10.0, 24.0), (16.0, 26.0), (22.0, 14.0)):
        cyl(uu, tt, CEIL - 0.02, CEIL, 0.1, G_WARM, 14, name='downlight')
    for hb in GROUND['hallBenches']:
        C.bench(C.World, hb[0], hb[1], hb[2], hb[3], VELVET)
    ph = GROUND['payphone']
    box(ph[0], ph[1], ph[2], ph[3], 0.0, 1.7, M('payphone', 0x2a8a5a, 0.3, 0.3), 0.02, 'payphone')
    box(ph[0] + 0.1, ph[1] - 0.1, ph[2] - 0.02, ph[2], 1.05, 1.5, glow('phone_dial', (0.9, 0.9, 0.7), 1.0), 0, 'payphone_front')


def stairs():
    """Both storeys' flights, thin treads (a flight must not fill the head-room of the one below it), the landings, the walls."""
    st = STAIR
    u0, u1 = st['u0'], st['u1']
    run = u1 - u0
    rise = st['rise']
    l1, l2 = st['lane1'], st['lane2']
    for base in (0, 5):
        for i in range(12):
            a = u0 + i * run / 12
            b = u0 + (i + 1) * run / 12
            y1 = base + (i + 1) / 12 * rise
            y2 = base + rise + (12 - i) / 12 * rise
            box(a, b, l1[0], l1[1], y1 - 0.28, y1, CARPET, 0.004, 'tread1')
            box(a, b, l2[0], l2[1], y2 - 0.28, y2, CARPET, 0.004, 'tread2')
            box(a, a + 0.04, l1[0], l1[1], y1 - 0.01, y1 + 0.005, GOLD, 0.002, 'nosing1')
            box(b - 0.04, b, l2[0], l2[1], y2 - 0.01, y2 + 0.005, GOLD, 0.002, 'nosing2')
        box(u1, U1, l2[0], l1[1], base + rise - 0.28, base + rise, CARPET, 0.004, 'landing')
    box(u0, u1, l2[1], l1[0], 0, 14.1, DAMASK, 0, 'divider')
    box(u0, U1, l2[0] - 0.1, l2[0] + 0.012, 0, 14.1, DAMASK, 0, 'well_wall')
    box(u0, U1, l1[1] - 0.012, l1[1] + 0.06, 0, 14.1, DAMASK, 0, 'well_wall_n')
    for base in (0, 5):
        box(u0 - 0.03, u0 + 0.012, l2[0], l1[1], base + CEIL - 0.02, base + 5.0, GOLD_T, 0, 'floor_edge')
    box(SH[0], SH[1], SH[2], SH[3], 10 + CEIL, ROOF, CEILING, 0, 'well_ceiling')
    for y in (1.8, 6.8, 11.8):
        box(U1 - 0.12, U1 - 0.05, 16.8, 17.0, y + 0.6, y + 0.9, G_WARM, 0.004, 'stair_sconce')
    box(U1 - 0.03, U1, l2[0], l1[1], 0.0, 14.1, M('stair_wall', 0x5a2440, 0.8, grain='plaster', scale=40, strength=0.25), 0, 'stair_east')


def build_ground_fixed():
    perimeter()
    floors_ceilings()
    staff_wall()
    lobby()
    garage()
    hall()
    stairs()


def ground_lights(point):
    lu = (LOBBY[0] + LOBBY[1]) / 2
    point(lu, 8.0, CEIL - 0.8, (1.0, 0.8, 0.85), 330, 0.3, 'chandelier')
    point(LOBBY[0] + 0.7, 4.7, CEIL - 0.4, (1.0, 0.25, 0.55), 60, 0.1, 'neon_l')
    point(LOBBY[1] - 0.7, 4.7, CEIL - 0.4, (1.0, 0.25, 0.55), 60, 0.1, 'neon_r')
    point(CX, 12.1, 1.8, (0.95, 0.85, 0.95), 100, 0.4, 'panel')
    point((GARAGE[0] + GARAGE[1]) / 2, 7.2, CEIL - 0.3, (1.0, 1.0, 0.95), 170, 0.2, 'garage')
    for k, (uu, tt) in enumerate(((8.0, 14.5), (14.0, 15.5), (18.0, 22.0), (10.0, 24.0), (16.0, 26.0), (22.0, 14.0))):
        point(uu, tt, CEIL - 0.3, (1.0, 0.7, 0.45), 60, 0.15, 'down%d' % k)
    v = GROUND['vending']
    point((v[0] + v[1]) / 2, v[3] + 0.6, 1.3, (0.95, 0.9, 1.0), 25, 0.1, 'vending')
    point(U0 + 0.3, sum(SIDE_DOOR) / 2, 2.3, (0.2, 1.0, 0.4), 6, 0.05, 'exit')
    for y in (2.4, 7.4, 12.4):
        point(U1 - 0.4, 16.9, y, (1.0, 0.7, 0.45), 110, 0.1, 'sconce')
    for base in (0, 5):
        point(26.8, 17.0, base + 3.7, (1.0, 0.75, 0.5), 160, 0.2, 'well_a')
        point(26.8, 15.6, base + 4.9, (1.0, 0.75, 0.5), 160, 0.2, 'well_b')
        point(23.2, 16.4, base + 2.2, (1.0, 0.75, 0.5), 90, 0.2, 'well_c')
    for tt in (16.5, 19.5, 22.5, 25.5):
        point(U0 + 0.4, tt + 0.1, 2.4, (1.0, 0.7, 0.45), 30, 0.1, 'sconce_w')
        point(U1 - 0.4, tt + 0.1, 2.4, (1.0, 0.7, 0.45), 30, 0.1, 'sconce_e')
