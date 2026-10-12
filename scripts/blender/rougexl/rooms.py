"""Hotel Rouge: the guest rooms. One builder for every theme, working in the room's own frame (common.RM): the shell under
its own dropped ceiling, the bed against the far wall, the lounge facing the TV on the west wall, a dining set, the vanity
(and, in the deep rooms, a massage chair, a bar and a desk), the bath, then the theme's own pieces. Every main piece is a
rect of the plan's layout, so the game's collision is the same rects.

Sizes are the game's, not a catalogue's: Mack is 1.92 m and broad, and furniture at real sizes looked like a doll's house
beside him (the user, 2026-10-11). Seats are 0.5 high and deep, tables 0.8, the bed 2.6 wide."""
import math

import bakelib as B
import common as C
from common import (  # noqa: F401
    BATH_LOOK, BLACK, CARPET, CEIL, CEILING, DAMASK, DARK, F, G_GREEN, GLOW_K, GOLD, GREY, LEAF, M, PLAN, RC, RM, STEEL, WHITE, WOOD,
    WOOD_D, WOOD_L, bath, box, cyl, door_frame, glow, sphere,
)

H = 0.65  # half a door


def look(**kw):
    return kw


THEMES = {
    'dungeon': look(wall=0x4a4541, floor=0x2c2a28, floor_grain='tiles', floor_scale=1 / 0.7, wall_grain='tilesw', wall_scale=1 / 0.55, bed=0x7a0c14, head=0x141416, sofa=0x18181c, light=(1.0, 0.3, 0.18), cove=0.45, table='black'),
    'castle': look(wall=0xf4d0dc, floor=0xe8c8d0, floor_grain='plaster', bed=0xfaf0f4, head=0xd8b060, sofa=0xb02848, light=(1.0, 0.45, 0.65), cove=1.0, table='light'),
    'marine': look(wall=0x2a6a8a, floor=0xc8b890, floor_grain='wood', bed=0xe8f0f4, head=0x1a3a5a, sofa=0x3a7a9a, light=(0.2, 0.7, 1.0), cove=1.0, table='light'),
    'space': look(wall=0x14163a, floor=0x1a1c30, floor_grain='plaster', bed=0x2a3a7a, head=0x0a0c20, sofa=0x3a3a6a, light=(0.3, 0.5, 1.0), cove=1.0, table='black'),
    'resort': look(wall=0xe8d8a8, floor=0xb89868, floor_grain='wood', bed=0xf4f0e0, head=0x8a6a3a, sofa=0x5a8a4a, light=(1.0, 0.8, 0.4), cove=0.8, table='light'),
    'mirror': look(wall=0x30303a, floor=0x26262e, floor_grain='plaster', bed=0xd8d8e0, head=0x303038, sofa=0x484850, light=(0.8, 0.8, 1.0), cove=1.0, table='black'),
    'onsen': look(wall=0xc8a878, floor=0xc8b87a, floor_grain='wood', bed=0xf4f0e6, head=0x6a4a2a, sofa=0x8a6a4a, light=(1.0, 0.65, 0.35), cove=1.0, table='light'),
    'karaoke': look(wall=0x3a1a4a, floor=0x2a1030, floor_grain='plaster', bed=0xe8203a, head=0xe8203a, sofa=0x6a2a8a, light=(1.0, 0.2, 1.0), cove=1.0, table='black'),
    'suite': look(wall=0x6a1020, floor=0x2a1018, floor_grain='wood', bed=0xf4e8e0, head=0xc8a050, sofa=0x8a1a2a, light=(1.0, 0.5, 0.4), cove=0.8, table='dark'),
    'retro': look(wall=0x2a8a8a, floor=0xd8a0b0, floor_grain='plaster', bed=0xf0d0e0, head=0xf0a0c0, sofa=0xe8c050, light=(1.0, 0.4, 0.8), cove=1.0, table='white'),
    'sakura': look(wall=0xf4d8e0, floor=0xd8b890, floor_grain='wood', bed=0xfaf0f0, head=0xc88a6a, sofa=0xe8a0b0, light=(1.0, 0.7, 0.8), cove=0.9, table='light'),
}

TABLES = {'black': BLACK, 'light': WOOD_L, 'dark': WOOD_D, 'white': M('laminate', 0xf0ece4, 0.4)}


LIGHTS = {}  # a room's fixtures that give light, by room: (u, t, z, colour, watts, radius, name)


def lit(R, a, b, z, col, w, name='lamp', r=0.08):
    """A light at a fixture, just clear of it (a light inside a shade lights nothing): the bake's light is these."""
    LIGHTS.setdefault(R.room['no'], []).append((R.U(a), R.T(b), R.y + z, col, w, r, name))


def warm(L, k=0.5):
    """A lamp's colour in a room: warm white, leaning to the theme's light."""
    return tuple(k * c + (1 - k) * w for c, w in zip(L['light'], (1.0, 0.78, 0.52)))


def downlight(R, a, b, col, w, name='downlight'):
    R.cyl(a, b, RC - 0.012, RC, 0.09, glow('downlight', (1.0, 0.85, 0.65), 6.0), 12, name='downlight')
    lit(R, a, b, RC - 0.14, col, w, name)


def chandelier(R, a, b, L, metal=None):
    """A small chandelier: a rod, a ring on spokes, eight candle bulbs."""
    metal = metal or GOLD
    R.cyl(a, b, RC - 0.55, RC, 0.018, metal, 8, name='chandelier_rod')
    R.cyl(a, b, RC - 0.6, RC - 0.55, 0.5, metal, 24, name='chandelier_ring')
    R.cyl(a, b, RC - 0.64, RC - 0.6, 0.08, metal, 12, r2=0.2, name='chandelier_boss')
    for k in range(8):
        ang = k * math.pi / 4
        ca, cb = a + 0.44 * math.cos(ang), b + 0.44 * math.sin(ang)
        R.cyl(ca, cb, RC - 0.55, RC - 0.42, 0.022, WHITE, 8, name='candle')
        R.cyl(ca, cb, RC - 0.42, RC - 0.34, 0.028, glow('chand_flame', (1.0, 0.8, 0.55), 9.0), 8, r2=0.006, name='candle_flame')
    lit(R, a, b, RC - 0.85, warm(L, 0.35), 26, 'chandelier')


def guest(room):
    """Build a guest room; its glows are dim (the user: "dimly lit")."""
    R = RM(room)
    th = room['theme']
    L = THEMES[th]
    GLOW_K[0] = 0.4
    LIGHTS[room['no']] = []
    try:
        shell(R, th, L)
        furniture(R, th, L)
        if R.piece('bath'):
            bath(R, th)
            b = R.piece('bath')
            downlight(R, (b[0] + b[1]) / 2, b[3] - 0.75, warm(L, 0.7), 12, 'shower')
        downlight(R, R.du, R.D - 0.9, (1.0, 0.82, 0.6), 9, 'doorway')
        EXTRAS[th](R, L)
    finally:
        GLOW_K[0] = 1.0
    return R


def mats(R, th, L):
    return dict(
        wall=M('wall_' + th, L['wall'], 0.8, grain=L.get('wall_grain', 'plaster'), scale=L.get('wall_scale', 8), strength=0.18),
        floor=M('floor_' + th, L['floor'], 0.55 if L['floor_grain'] == 'wood' else 0.75, grain=L['floor_grain'], scale=L.get('floor_scale', 20), strength=0.3),
        head=M('head_' + th, L['head'], 0.5, grain='wood' if th in ('onsen', 'resort', 'sakura') else None, scale=14, strength=0.3),
        bed=M('bed_' + th, L['bed'], 0.85, grain='plaster', scale=60, strength=0.25),
        sofa=M('sofa_' + th, L['sofa'], 0.9 if th != 'dungeon' else 0.45, grain='plaster', scale=90, strength=0.3),
        light=glow('light_' + th, L['light'], 5.0 * L['cove']),
        cove=glow('cove_' + th, L['light'], 1.0 * L['cove']),
        table=TABLES[L['table']],
    )


def shell(R, th, L):
    m = mats(R, th, L)
    W, D = R.W, R.D
    da = R.du
    top = RC + 0.05
    # Walls inside the room (the partitions and the perimeter are the structure behind them): west, east, bed wall.
    R.box(0, 0.05, 0, D, 0, top, m['wall'], 0, 'room_w')
    R.box(W - 0.05, W, 0, D, 0, top, m['wall'], 0, 'room_e')
    R.box(0, W, 0, 0.05, 0, top, m['wall'], 0, 'room_far')
    # The door wall: the room's face with a doorway, the corridor's face (damask) outside it, the frame, the lamp over it.
    for a0, a1 in ((0, da - H), (da + H, W)):
        R.box(a0, a1, D - 0.05, D, 0, top, m['wall'], 0, 'room_door_wall')
        # (the corridor's face runs on over the 0.1 m between neighbouring rooms, so no black seam shows)
        R.box(a0 - (0.05 if a0 == 0 else 0), a1 + (0.05 if a1 == W else 0), D, D + 0.1, 0, CEIL, DAMASK, 0, 'corr_wall')
    R.box(da - H, da + H, D - 0.05, D, 2.2, top, m['wall'], 0, 'room_door_lintel')
    R.box(da - H, da + H, D, D + 0.1, 2.2, CEIL, DAMASK, 0, 'corr_lintel')
    door_frame(R.y, R.U(da), R.T(D + 0.0), 'green')
    # Floor finish, the dropped ceiling, skirting, the cove glow round the ceiling.
    R.box(0.05, W - 0.05, 0.05, D - 0.05, 0.02, 0.035, m['floor'], 0, 'room_floor')
    R.box(0, W, 0, D, RC, top, m['wall'], 0, 'room_ceiling')
    skirt = M('skirt_' + th, L['head'] if th != 'space' else 0x3a3a6a, 0.5)
    R.box(0.05, W - 0.05, 0.05, 0.08, 0.035, 0.14, skirt, 0, 'skirt')
    R.box(0.05, 0.08, 0.08, D - 0.05, 0.035, 0.14, skirt, 0, 'skirt')
    R.box(W - 0.08, W - 0.05, 0.08, D - 0.05, 0.035, 0.14, skirt, 0, 'skirt')
    for a0, a1, b0, b1 in ((0.1, W - 0.1, 0.1, 0.16), (0.1, 0.16, 0.16, D - 0.2), (W - 0.16, W - 0.1, 0.16, D - 0.2)):
        R.box(a0, a1, b0, b1, RC - 0.04, RC, m['cove'], 0, 'cove')


def furniture(R, th, L):
    m = mats(R, th, L)
    W, D = R.W, R.D
    E = W - 0.05  # the east wall's face
    bed = R.piece('bed')
    # The bed against the far wall: a tall headboard with its dial panel, the bed, nightstands and lamps.
    ba = (bed[0] + bed[1]) / 2
    R.box(ba - 1.33, ba + 1.33, 0.05, 0.3, 0, 1.5, m['head'], 0.02, 'headboard')
    R.box(ba - 0.5, ba + 0.5, 0.3, 0.32, 0.95, 1.12, glow('dials', (0.9, 0.7, 0.5), 2.0), 0, 'dials')
    if th in ('onsen', 'sakura'):
        R.box(ba - 1.45, ba + 1.45, 0.3, 3.1, 0, 0.3, WOOD_L, 0.01, 'platform')
        R.box(ba - 1.3, ba + 1.3, 0.42, 3.0, 0.3, 0.48, m['bed'], 0.05, 'futon')
        R.box(ba - 1.32, ba + 1.32, 1.2, 3.02, 0.46, 0.56, M('duvet_' + th, L['sofa'], 0.9, grain='plaster', scale=70, strength=0.3), 0.04, 'duvet')
        for du in (-0.62, 0.62):
            R.box(ba + du - 0.42, ba + du + 0.42, 0.5, 1.0, 0.48, 0.62, WHITE, 0.05, 'pillow')
    elif th in ('space', 'mirror'):
        R.cyl(ba, 1.75, 0, 0.5, 1.45, m['head'], 40, name='round_bed')
        R.cyl(ba, 1.75, 0.5, 0.7, 1.36, m['bed'], 40, name='round_mattress')
        R.cyl(ba, 1.75, 0.02, 0.08, 1.48, glow('ring', (0.2, 0.5, 1.0) if th == 'space' else (0.8, 0.8, 1.0), 6.0), 40, name='bed_ring')
        for du in (-0.5, 0.5):
            R.box(ba + du - 0.4, ba + du + 0.4, 0.75, 1.2, 0.7, 0.84, WHITE, 0.05, 'pillow')
    else:
        R.box(ba - 1.33, ba + 1.33, 0.3, 3.08, 0, 0.38, M('bed_base_' + th, 0x3a2a2a if th != 'dungeon' else 0x101012, 0.6), 0.01, 'bed_base')
        R.box(ba - 1.3, ba + 1.3, 0.32, 3.05, 0.38, 0.68, m['bed'], 0.06, 'mattress')
        R.box(ba - 1.32, ba + 1.32, 2.2, 3.07, 0.66, 0.72, M('throw_' + th, L['sofa'], 0.9, grain='plaster', scale=70, strength=0.3), 0.03, 'throw')
        for du in (-0.65, 0.65):
            R.box(ba + du - 0.45, ba + du + 0.45, 0.42, 0.95, 0.68, 0.86, WHITE if th != 'dungeon' else M('black_pillow', 0x1a1a1e, 0.6), 0.06, 'pillow')
            R.box(ba + du - 0.3, ba + du + 0.3, 0.9, 1.25, 0.68, 0.8, M('cushion_' + th, L['sofa'], 0.9), 0.05, 'cushion')
    for a in (bed[0], bed[1] - 0.62):
        R.box(a, a + 0.62, 0.08, 0.68, 0, 0.66, m['head'], 0.01, 'nightstand')
        R.box(a + 0.04, a + 0.58, 0.68, 0.69, 0.36, 0.6, m['table'], 0, 'nightstand_drawer')
        R.cyl(a + 0.31, 0.38, 0.66, 0.82, 0.05, GOLD if th != 'dungeon' else STEEL, 10, name='lamp_base')
        R.cyl(a + 0.31, 0.38, 0.82, 1.12, 0.17, m['light'], 16, r2=0.11, name='lamp')
        lit(R, a + 0.31, 0.62, 1.0, warm(L), 13, 'bedside')
    # The lounge (not every room has one): a sofa facing the TV on the west wall, a low table between them, a console
    # under the TV, a standing lamp at the sofa's end.
    s = R.piece('sofa')
    if s:
        C.sofa(R, s[0], s[1], s[2], s[3], 'a1', m['sofa'])
        la, lb = s[1] - 0.25, s[3] + 0.3
        R.cyl(la, lb, 0, 0.04, 0.2, STEEL, 16, name='floor_lamp_foot')
        R.cyl(la, lb, 0.04, 1.5, 0.018, STEEL, 8, name='floor_lamp_pole')
        R.cyl(la, lb, 1.5, 1.82, 0.24, m['light'], 16, r2=0.17, name='floor_lamp_shade')
        lit(R, la, lb, 1.95, warm(L), 16, 'floor_lamp_up')
        lit(R, la - 0.3, lb, 1.35, warm(L), 9, 'floor_lamp_down')
    t = R.piece('table')
    if t:
        C.low_table(R, t[0], t[1], t[2], t[3], m['table'])
    tv = R.piece('tv')
    if tv:
        R.box(tv[0], tv[1], tv[2], tv[3], 0, 0.5, m['head'], 0.01, 'tv_console')
        R.box(0.1, 0.16, tv[2] + 0.1, tv[3] - 0.1, 0.95, 2.2, BLACK, 0.01, 'tv')
        R.box(0.05, 0.1, (tv[2] + tv[3]) / 2 - 0.2, (tv[2] + tv[3]) / 2 + 0.2, 1.4, 1.8, BLACK, 0, 'tv_mount')
        if th != 'karaoke':
            R.box(0.16, 0.165, tv[2] + 0.16, tv[3] - 0.16, 1.01, 2.14, glow('tv', (0.3, 0.4, 0.7), 1.6), 0, 'tv_glow')
        lit(R, 0.45, (tv[2] + tv[3]) / 2, 1.55, (0.45, 0.55, 1.0) if th != 'karaoke' else (1.0, 0.35, 0.8), 7, 'tv')
    # A dining table for two, the chairs at its ends facing each other (the suite has its writing desk there instead).
    d = R.piece('dining')
    if th != 'suite':
        ca, cb = (d[0] + d[1]) / 2, (d[2] + d[3]) / 2
        C.round_table(R, ca, cb, 0.65, m['table'], base=STEEL if L['table'] in ('black', 'white') else WOOD_D)
        C.chair(R, ca, d[2] + 0.27, 'b+', m['sofa'], frame=m['table'] if L['table'] != 'white' else STEEL)
        C.chair(R, ca, d[3] - 0.27, 'b-', m['sofa'], frame=m['table'] if L['table'] != 'white' else STEEL)
        R.cyl(ca, cb, 0.8, 0.92, 0.06, m['light'], 10, r2=0.04, name='table_candle')
        lit(R, ca, cb, 1.05, warm(L), 5, 'table_candle')
    # The vanity against the east wall: a top on two drawer pedestals, a framed mirror with bulbs down its sides, a stool.
    v = R.piece('vanity')
    R.box(v[0], E, v[2], v[3], 0.78, 0.84, m['head'], 0.008, 'vanity_top')
    for b0, b1 in ((v[2] + 0.03, v[2] + 0.6), (v[3] - 0.6, v[3] - 0.03)):
        R.box(v[0] + 0.05, E, b0, b1, 0, 0.78, m['head'], 0.006, 'vanity_pedestal')
        for k in range(3):
            R.box(v[0] + 0.035, v[0] + 0.05, b0 + 0.04, b1 - 0.04, 0.06 + k * 0.24, 0.27 + k * 0.24, m['table'], 0, 'vanity_drawer')
    R.box(E - 0.02, E, v[2] + 0.1, v[3] - 0.1, 0.95, 2.35, GOLD if th != 'dungeon' else STEEL, 0.006, 'vanity_frame')
    R.box(E - 0.03, E - 0.02, v[2] + 0.18, v[3] - 0.18, 1.03, 2.27, glow('vanity_mirror', (0.7, 0.68, 0.7), 0.5), 0, 'vanity_mirror')
    for b in (v[2] + 0.12, v[3] - 0.18):
        for k in range(5):
            R.box(E - 0.07, E - 0.03, b, b + 0.06, 1.1 + k * 0.27, 1.16 + k * 0.27, m['light'], 0, 'vanity_bulb')
    C.stool(R, v[0] - 0.42, (v[2] + v[3]) / 2, m['sofa'], h=0.5, r=0.25)
    lit(R, E - 0.3, (v[2] + v[3]) / 2, 1.7, warm(L, 0.3), 9, 'vanity')
    # The deeper rooms: a massage chair by the west wall, a bar along the east wall, a desk by the west wall near the door.
    ms = R.piece('massage')
    if ms:
        bx, ML, _ = C.oriented(R, ms[0], ms[1], ms[2], ms[3], 'a0')
        lea = M('massage_leather', 0x1c1a1a, 0.5)
        bx(0.05, ML - 0.05, 0.1, 1.0, 0, 0.35, lea, 0.04, 'massage_base')
        bx(0.2, ML - 0.2, 0.3, 1.05, 0.35, 0.55, lea, 0.06, 'massage_seat')
        bx(0.2, ML - 0.2, 0.0, 0.35, 0.4, 1.3, lea, 0.08, 'massage_back')
        bx(0.25, ML - 0.25, 0.02, 0.3, 1.25, 1.5, lea, 0.08, 'massage_head')
        for l0 in (0.02, ML - 0.22):
            bx(l0, l0 + 0.2, 0.2, 1.0, 0.3, 0.8, lea, 0.07, 'massage_arm')
        bx(0.22, ML - 0.22, 1.05, 1.4, 0.15, 0.45, lea, 0.06, 'massage_legrest')
        bx(ML - 0.2, ML - 0.14, 0.5, 0.8, 0.8, 0.84, glow('massage_panel', (0.3, 0.9, 1.0), 2.0), 0, 'massage_panel')
    bar = R.piece('bar')
    if bar:
        top = M('bar_top_' + th, 0xe8d8c8, 0.4)
        c0, c1 = bar[0] + 0.75, bar[0] + 1.45
        R.box(c0, c1, bar[2], bar[3], 0, 1.1, WOOD, 0.01, 'bar_counter')
        R.box(c0 - 0.14, c1 + 0.05, bar[2] - 0.0, bar[3] + 0.0, 1.1, 1.16, top, 0.008, 'bar_top')
        R.box(c0 - 0.05, c0, bar[2] + 0.1, bar[3] - 0.1, 0.2, 0.24, GOLD, 0, 'bar_footrail')
        for k in range(3):
            C.stool(R, bar[0] + 0.3, bar[2] + 0.6 + k * 0.9, m['sofa'], h=0.8, r=0.21, base=GOLD)
        R.box(E - 0.42, E, bar[2] + 0.2, bar[3] - 0.2, 0, 0.95, WOOD, 0.01, 'backbar')
        R.box(E - 0.44, E, bar[2] + 0.18, bar[3] - 0.18, 0.95, 1.0, top, 0.006, 'backbar_top')
        R.box(E - 0.02, E, bar[2] + 0.2, bar[3] - 0.2, 1.0, 2.35, glow('backbar_glow', L['light'], 1.4), 0, 'backbar_glow')
        for z in (1.46, 1.92):
            R.box(E - 0.26, E - 0.02, bar[2] + 0.2, bar[3] - 0.2, z, z + 0.03, STEEL, 0, 'bar_shelf')
        cols = (0x4a9a4a, 0xe8a838, 0x8a3a5a, 0x3a5a8a, 0xd8d0c0)
        n = int((bar[3] - bar[2] - 0.6) / 0.3)
        for row, z0 in enumerate((1.0, 1.49, 1.95)):
            for k in range(n):
                hb = 0.24 + 0.03 * ((k + row) % 3)
                bm = M('bottle_%d' % ((k + row) % 5), cols[(k + row) % 5], 0.2)
                R.cyl(E - 0.15, bar[2] + 0.38 + k * 0.3, z0, z0 + hb, 0.045, bm, 8, name='bottle')
                R.cyl(E - 0.15, bar[2] + 0.38 + k * 0.3, z0 + hb, z0 + hb + 0.09, 0.016, bm, 6, name='bottle_neck')
        for k in range(3):
            R.cyl(c0 + 0.3, bar[2] + 0.55 + k * 0.9, 1.16, 1.3, 0.04, M('glass', 0xc8d8e0, 0.1), 8, r2=0.03, name='glass')
        # Two pendant lamps over the counter.
        for pb in (bar[2] + 0.8, bar[3] - 0.8):
            R.cyl((c0 + c1) / 2, pb, 2.15, RC, 0.008, BLACK, 6, name='pendant_cord')
            R.cyl((c0 + c1) / 2, pb, 1.95, 2.15, 0.16, m['light'], 14, r2=0.05, name='pendant')
            lit(R, (c0 + c1) / 2, pb, 1.85, warm(L), 8, 'pendant')
        lit(R, E - 0.6, (bar[2] + bar[3]) / 2, 1.7, L['light'], 8, 'backbar')
    desk = R.piece('desk')
    if desk:
        dm = m['table']
        R.box(desk[0], desk[0] + 0.8, desk[2], desk[3], 0.76, 0.81, dm, 0.008, 'desk_top')
        for b0, b1 in ((desk[2] + 0.05, desk[2] + 0.6), (desk[3] - 0.6, desk[3] - 0.05)):
            R.box(desk[0] + 0.05, desk[0] + 0.75, b0, b1, 0, 0.76, dm, 0.006, 'desk_pedestal')
        R.cyl(desk[0] + 0.3, desk[2] + 0.35, 0.81, 0.95, 0.05, GOLD, 10, name='desk_lamp_base')
        R.cyl(desk[0] + 0.3, desk[2] + 0.35, 0.95, 1.2, 0.14, m['light'], 14, r2=0.09, name='desk_lamp')
        lit(R, desk[0] + 0.52, desk[2] + 0.35, 1.05, warm(L), 9, 'desk_lamp')
        C.chair(R, desk[0] + 1.2, (desk[2] + desk[3]) / 2, 'a-', m['sofa'], frame=dm if L['table'] != 'white' else STEEL)


# ---- the themes' own pieces -----------------------------------------------------------------------------------------------


def torch(R, a, b, z, face):
    """A wall torch: an iron bracket and a flame, on the wall the point (a, b) is on; `face` is the way it stands off the wall."""
    da, db = {'a+': (1, 0), 'a-': (-1, 0), 'b+': (0, 1), 'b-': (0, -1)}[face]
    iron = M('iron', 0x1a1a1c, 0.5, 0.7)
    ca, cb = a + da * 0.12, b + db * 0.12
    R.box(min(a, ca) - 0.02, max(a, ca) + 0.02, min(b, cb) - 0.02, max(b, cb) + 0.02, z - 0.02, z + 0.02, iron, 0, 'torch_arm')
    R.cyl(ca, cb, z, z + 0.25, 0.035, iron, 8, r2=0.06, name='torch_cup')
    R.cyl(ca, cb, z + 0.25, z + 0.52, 0.065, glow('torch', (1.0, 0.45, 0.12), 14.0), 8, r2=0.01, name='torch_flame')
    lit(R, a + da * 0.4, b + db * 0.4, z + 0.45, (1.0, 0.45, 0.14), 10, 'torch')


def x_dungeon(R, L):
    """101, the dungeon: stone, iron and red light. An iron four-poster with rings and chains; a St Andrew's cross
    standing at the foot of the bed, facing it; a barred cell in the corner with the room's shower in it (no bath, no
    lounge: the user, 2026-10-12: "too luxurious for a bondage area"); a padded horse, stocks, a rack of implements,
    chains from the ceiling, wall torches. Its big pieces are the room's `things` in the plan (the collision)."""
    W, D = R.W, R.D
    E = W - 0.05
    iron = M('iron', 0x1a1a1c, 0.5, 0.7)
    leather = M('dungeon_leather', 0x141416, 0.45)
    red = M('dungeon_red', 0x7a0c14, 0.6)
    dwood = M('dungeon_wood', 0x2a1c14, 0.7, grain='wood', scale=14, strength=0.5)
    all_things = R.room.get('things', [])
    things = {t[0]: t[1:] for t in all_things}
    # The bed's iron frame: four posts joined by rails overhead, a ring on each post with a length of chain.
    bed = R.piece('bed')
    ba = (bed[0] + bed[1]) / 2
    for a, b in ((ba - 1.28, 0.36), (ba + 1.28, 0.36), (ba - 1.28, 3.02), (ba + 1.28, 3.02)):
        R.cyl(a, b, 0, 2.5, 0.04, iron, 10, name='bed_post')
        R.cyl(a, b, 2.5, 2.6, 0.06, iron, 10, r2=0.01, name='bed_finial')
        R.cyl(a, b + (0.07 if b < 1 else -0.07), 1.25, 1.31, 0.06, STEEL, 12, name='bed_ring', axis='Y')
        R.cyl(a, b + (0.09 if b < 1 else -0.09), 0.8, 1.25, 0.012, STEEL, 6, name='bed_chain')
    for a0, a1, b0, b1 in ((ba - 1.28, ba + 1.28, 0.34, 0.38), (ba - 1.28, ba + 1.28, 3.0, 3.04), (ba - 1.3, ba - 1.26, 0.36, 3.02), (ba + 1.26, ba + 1.3, 0.36, 3.02)):
        R.box(a0, a1, b0, b1, 2.44, 2.48, iron, 0, 'bed_rail')
    # The cross, standing free at the foot of the bed and facing it: a base, a frame behind, two crossed beams (turned
    # in the plane across the room), a cuff at each end on the bed's side.
    cr = things.get('cross')
    if cr:
        a0, a1, b0, b1, h = cr
        am, bm = (a0 + a1) / 2, (b0 + b1) / 2
        R.box(a0, a1, b0, b1, 0.035, 0.1, dwood, 0.006, 'cross_base')
        for a in (am - 0.78, am + 0.72):
            R.box(a, a + 0.06, bm + 0.1, bm + 0.16, 0.1, h - 0.1, iron, 0, 'cross_post')
        for z in (0.7, h - 0.16):
            R.box(am - 0.78, am + 0.78, bm + 0.1, bm + 0.16, z, z + 0.06, iron, 0, 'cross_tie')
        for rx in (0.6, -0.6):
            B.rot_box(R.U(am), R.T(bm), R.y + 1.4, 0.22, 0.1, 2.7, rx, red, 0.006, 'cross_beam', axis='Y')
        for sa in (-1, 1):
            for z in (0.42, 2.38):
                R.cyl(am + sa * 0.68, bm - 0.07, z - 0.05, z + 0.05, 0.075, STEEL, 12, name='cross_cuff', axis='Y')
    # The cell in the corner: bars on its two open sides (the plan's `bars`, each a run with a rail top and bottom), a
    # barred roof, its door standing open into the room; inside, the shower: dark tile, a drain, a rain head, a mixer,
    # shackles on the wall, a steel bucket.
    bars = [t[1:] for t in all_things if t[0] == 'bars']
    if bars:
        h = bars[0][4]
        ca = min(t[0] for t in bars) + 0.05
        cb = max(t[3] for t in bars) - 0.05
        tile = M('cell_tile', 0x2e2c2a, 0.3, grain='tiles', scale=1 / 0.3, strength=0.15)
        tilew = M('cell_tilew', 0x2e2c2a, 0.3, grain='tilesw', scale=1 / 0.3, strength=0.15)
        R.box(ca, E, 0.05, cb, 0.035, 0.05, tile, 0, 'cell_floor')
        R.box(ca, E, 0.05, 0.065, 0.05, h, tilew, 0, 'cell_wall')
        R.box(E - 0.015, E, 0.05, cb, 0.05, h, tilew, 0, 'cell_wall')

        def run(a0, a1, b0, b1, z0, z1, name):
            """Bars along the long side of a thin rect, with a rail top and bottom."""
            along_a = (a1 - a0) > (b1 - b0)
            am, bm = (a0 + a1) / 2, (b0 + b1) / 2
            for z in (z0, z1 - 0.05):
                R.box(a0 if along_a else am - 0.025, a1 if along_a else am + 0.025, bm - 0.025 if along_a else b0, bm + 0.025 if along_a else b1, z, z + 0.05, iron, 0, name + '_rail')
            length = (a1 - a0) if along_a else (b1 - b0)
            n = max(1, int(round(length / 0.14)))
            for k in range(n + 1):
                q = k / n
                R.cyl(a0 + q * length if along_a else am, bm if along_a else b0 + q * length, z0 + 0.05, z1 - 0.05, 0.016, iron, 6, name=name + '_bar')

        for (a0, a1, b0, b1, hh) in bars:
            run(a0, a1, max(b0, 0.05), b1, 0.05, hh, 'cell')
        k = 0.05
        while k < cb:
            R.box(ca, E, k, k + 0.03, h - 0.03, h, iron, 0, 'cell_roof_bar')
            k += 0.35
        # The door, open: hung on the west post of the gap, standing out into the room.
        gaps = sorted(t for t in bars if (t[1] - t[0]) > (t[3] - t[2]))
        if len(gaps) == 2:
            g0, g1 = gaps[0][1], gaps[1][0]
            run(g0 - 0.025, g0 + 0.025, cb, cb + (g1 - g0) - 0.05, 0.08, h - 0.2, 'cell_door')
            R.box(g0 - 0.03, g0 + 0.05, cb + (g1 - g0) - 0.2, cb + (g1 - g0) - 0.08, 1.0, 1.14, STEEL, 0, 'cell_lock')
        sa, sb = (ca + E) / 2, cb / 2
        R.box(sa - 0.2, sa + 0.2, sb - 0.1, sb + 0.1, 0.05, 0.06, BLACK, 0, 'drain')
        R.cyl(sa, sb, 2.3, h, 0.02, STEEL, 8, name='rain_pipe')
        R.cyl(sa, sb, 2.27, 2.3, 0.22, STEEL, 20, name='rain_head')
        R.cyl(E - 0.06, sb - 0.3, 1.1, 1.3, 0.05, STEEL, 14, name='mixer', axis='X')
        R.cyl(E - 0.05, sb + 0.2, 1.0, 2.1, 0.014, STEEL, 8, name='shower_bar')
        for da in (-0.5, 0.5):
            R.cyl(sa + da, 0.09, 1.95 - 0.04, 1.95 + 0.04, 0.06, STEEL, 12, name='shackle_ring', axis='Y')
            R.cyl(sa + da, 0.11, 1.5, 1.95, 0.012, STEEL, 6, name='shackle_chain')
            R.cyl(sa + da, 0.12, 1.42, 1.5, 0.055, leather, 10, name='shackle_cuff')
        R.cyl(ca + 0.45, cb - 0.5, 0.05, 0.38, 0.16, STEEL, 14, r2=0.19, name='bucket')
        R.cyl(sa, sb + 0.6, RC - 0.012, RC, 0.09, glow('cell_light', (1.0, 0.25, 0.15), 6.0), 12, name='downlight')
        lit(R, sa, sb + 0.6, RC - 0.14, (1.0, 0.3, 0.2), 12, 'cell')
    # The horse: a padded beam on four legs, knee rests either side, rings.
    hs = things.get('horse')
    if hs:
        a0, a1, b0, b1, h = hs
        am = (a0 + a1) / 2
        R.box(am - 0.28, am + 0.28, b0 + 0.05, b1 - 0.05, h - 0.2, h, leather, 0.05, 'horse_pad')
        R.box(am - 0.22, am + 0.22, b0 + 0.12, b1 - 0.12, h - 0.28, h - 0.2, dwood, 0, 'horse_beam')
        for b in (b0 + 0.2, b1 - 0.28):
            for a in (a0 + 0.06, a1 - 0.14):
                R.box(a, a + 0.08, b, b + 0.08, 0, h - 0.28, dwood, 0, 'horse_leg')
            R.box(a0 + 0.06, a1 - 0.06, b + 0.02, b + 0.06, 0.25, 0.31, dwood, 0, 'horse_brace')
        for a in (a0, a1 - 0.2):
            R.box(a, a + 0.2, b0 + 0.35, b1 - 0.35, 0.36, 0.44, leather, 0.03, 'horse_knee_rest')
        for b in (b0 + 0.1, b1 - 0.1):
            R.cyl(am, b, h - 0.3, h - 0.24, 0.05, STEEL, 10, name='horse_ring', axis='Y')
    # The stocks: two posts, a split board with three holes, feet.
    stx = things.get('stocks')
    if stx:
        a0, a1, b0, b1, h = stx
        bm = (b0 + b1) / 2
        for a in (a0 + 0.02, a1 - 0.16):
            R.box(a, a + 0.14, bm - 0.07, bm + 0.07, 0, h, dwood, 0.006, 'stocks_post')
            R.box(a - 0.02, a + 0.16, b0, b1, 0, 0.1, dwood, 0.006, 'stocks_foot')
        R.box(a0 + 0.16, a1 - 0.16, bm - 0.045, bm + 0.045, 1.02, 1.265, dwood, 0.004, 'stocks_board')
        R.box(a0 + 0.16, a1 - 0.16, bm - 0.045, bm + 0.045, 1.275, 1.52, dwood, 0.004, 'stocks_board')
        mid = (a0 + a1) / 2
        for da, r in ((0.0, 0.11), (-0.42, 0.055), (0.42, 0.055)):
            R.cyl(mid + da, bm, 1.27 - 0.05, 1.27 + 0.05, r, BLACK, 16, name='stocks_hole', axis='Y')
        R.box(a1 - 0.2, a1 - 0.14, bm - 0.06, bm + 0.06, 1.2, 1.34, iron, 0, 'stocks_hasp')
    # Chains hanging from the ceiling over the middle of the room, a spreader bar between them.
    for da in (-0.45, 0.45):
        R.cyl(W * 0.46 + da, 7.3, 2.2, RC, 0.014, STEEL, 6, name='chain')
        R.cyl(W * 0.46 + da, 7.3, 2.06, 2.2, 0.06, leather, 10, name='chain_cuff')
        R.box(W * 0.46 + da - 0.06, W * 0.46 + da + 0.06, 7.24, 7.36, RC - 0.04, RC, iron, 0, 'chain_plate')
    R.box(W * 0.46 - 0.5, W * 0.46 + 0.5, 7.28, 7.32, 2.2, 2.24, iron, 0, 'spreader_bar')
    # The rack on the door wall, east of the door: a board with paddles, crops, coiled rope, cuffs, a feather.
    da = R.du
    r0 = da + H + 0.5
    R.box(r0, r0 + 2.2, D - 0.09, D - 0.05, 1.0, 2.15, dwood, 0.006, 'rack_board')
    for k in range(4):
        R.box(r0 + 0.15 + k * 0.22, r0 + 0.29 + k * 0.22, D - 0.12, D - 0.09, 1.25, 1.75, leather if k % 2 else red, 0.01, 'paddle')
        R.box(r0 + 0.2 + k * 0.22, r0 + 0.24 + k * 0.22, D - 0.12, D - 0.09, 1.75, 2.05, leather, 0, 'paddle_handle')
    for k in range(3):
        R.box(r0 + 1.1 + k * 0.1, r0 + 1.125 + k * 0.1, D - 0.115, D - 0.09, 1.15, 2.05, leather, 0, 'crop')
    R.cyl(r0 + 1.65, D - 0.11, 1.75 - 0.02, 1.75 + 0.02, 0.16, M('rope', 0xb89868, 0.9), 16, name='rope_coil', axis='Y')
    R.cyl(r0 + 1.65, D - 0.115, 1.75 - 0.025, 1.75 + 0.025, 0.09, dwood, 12, name='rope_core', axis='Y')
    for k in range(2):
        R.cyl(r0 + 1.95, D - 0.11, 1.3 + k * 0.3 - 0.02, 1.3 + k * 0.3 + 0.02, 0.07, STEEL, 12, name='rack_cuff', axis='Y')
    R.box(r0 + 1.5, r0 + 1.56, D - 0.115, D - 0.09, 1.1, 1.5, M('feather', 0xe85a8a, 0.9), 0, 'feather')
    # Torches round the walls: the room's light.
    for a, b, face in ((0.05, 3.9, 'a+'), (0.05, 7.2, 'a+'), (E, 4.4, 'a-'), (E, 8.3, 'a-'), (5.5, 0.05, 'b+'), (da - 1.6, D - 0.05, 'b-'), (da + 0.95, D - 0.05, 'b-')):
        torch(R, a, b, 1.75, face)


def x_castle(R, L):
    W, D = R.W, R.D
    ba = (R.piece('bed')[0] + R.piece('bed')[1]) / 2
    post = M('post', L['head'], 0.5)
    for a, b in ((ba - 1.33, 0.3), (ba + 1.23, 0.3), (ba - 1.33, 2.98), (ba + 1.23, 2.98)):
        R.box(a, a + 0.1, b, b + 0.1, 0, 2.7, post, 0.01, 'post')
    canopy = M('canopy', 0xf8e0ea, 0.9, grain='plaster', scale=60, strength=0.2)
    R.box(ba - 1.4, ba + 1.4, 0.05, 3.12, 2.7, 2.8, canopy, 0.02, 'canopy')
    R.box(ba - 1.4, ba + 1.4, 3.1, 3.15, 2.1, 2.7, canopy, 0.01, 'drape')
    chandelier(R, W / 2, 5.0, L)
    # A tall mirror on the door wall, west of the door.
    R.box(1.2, 2.6, D - 0.07, D - 0.05, 0.3, 2.5, GOLD, 0.01, 'mirror_frame')
    R.box(1.3, 2.5, D - 0.08, D - 0.07, 0.4, 2.4, glow('mirror', (0.55, 0.52, 0.55), 0.7), 0, 'mirror')


def x_marine(R, L):
    W, D = R.W, R.D
    ba = (R.piece('bed')[0] + R.piece('bed')[1]) / 2
    # A sailboat bed: a mast with a sail behind the headboard, portholes on the door wall, an aquarium in the west wall.
    R.cyl(ba, 0.18, 0, 3.0, 0.06, WOOD_L, 10, name='mast')
    R.box(ba - 1.2, ba + 1.2, 0.16, 0.2, 1.6, 2.9, WHITE, 0.01, 'sail')
    for a in (1.0, 2.6):
        R.cyl(a, D - 0.08, 1.7 - 0.03, 1.7 + 0.03, 0.36, STEEL, 24, name='porthole', axis='Y')
        R.cyl(a, D - 0.11, 1.7 - 0.01, 1.7 + 0.01, 0.29, glow('porthole', (0.2, 0.7, 1.0), 3.0), 24, name='porthole_glass', axis='Y')
    R.box(0.05, 0.1, 0.5, 3.8, 0.5, 2.3, GOLD, 0.01, 'tank_frame')
    R.box(0.1, 0.13, 0.6, 3.7, 0.6, 2.2, glow('aquarium', (0.1, 0.55, 1.0), 2.0), 0, 'aquarium')
    lit(R, 0.45, 2.15, 1.4, (0.15, 0.55, 1.0), 14, 'aquarium')
    for k, (fb, fz) in enumerate(((1.1, 1.5), (2.2, 1.1), (3.0, 1.8))):
        R.box(0.13, 0.16, fb, fb + 0.34, fz, fz + 0.12, BLACK, 0.005, 'fish')
    R.cyl(0.6, D - 0.7, 0, 0.9, 0.36, WOOD_L, 14, name='barrel')
    for z in (0.2, 0.7):
        R.cyl(0.6, D - 0.7, z, z + 0.05, 0.37, STEEL, 14, name='barrel_hoop')
    R.box(1.2, 1.9, D - 0.95, D - 0.25, 0, 0.6, WOOD_L, 0.01, 'crate')


def x_space(R, L):
    ba = (R.piece('bed')[0] + R.piece('bed')[1]) / 2
    orb = glow('orb', (1.0, 0.6, 0.3), 7.0)
    R.cyl(0.9, 3.7, 0, 1.6, 0.03, STEEL, 8, name='orb_stand')
    R.cyl(0.9, 3.7, 0, 0.04, 0.25, STEEL, 16, name='orb_foot')
    R.cyl(0.9, 3.7, 1.6, 1.85, 0.18, orb, 16, r2=0.32, name='orb')
    R.cyl(0.9, 3.7, 1.85, 2.1, 0.32, orb, 16, r2=0.18, name='orb')
    R.cyl(0.9, 3.7, 1.83, 1.87, 0.5, glow('orb_ring', (0.9, 0.8, 0.6), 4.0), 24, name='orb_ring')
    lit(R, 1.45, 3.7, 1.85, (1.0, 0.6, 0.3), 14, 'orb')
    lit(R, ba, 0.45, 2.0, (0.5, 0.7, 1.0), 10, 'star_panels')
    for k in range(4):
        R.cyl(ba - 1.5 + k * 1.0, 0.07, 2.0 - 0.02, 2.0 + 0.02, 0.16, glow('star_panel', (0.5, 0.7, 1.0), 3.0), 14, name='wall_light', axis='Y')


def x_resort(R, L):
    W, D = R.W, R.D
    trunk = M('palm', 0x7a5a3a, 0.8, grain='wood', scale=20, strength=0.3)
    for a, b in ((0.45, 3.7), (W - 0.45, 5.1), (0.5, D - 0.6)):
        R.cyl(a, b, 0, 0.45, 0.3, M('palm_pot', 0x8a6a4a, 0.6), 12, r2=0.34, name='palm_pot')
        R.cyl(a, b, 0.4, 2.4, 0.1, trunk, 10, r2=0.06, name='palm_trunk')
        for k in range(7):
            ang = k * 0.9
            R.cyl(a + 0.4 * math.cos(ang), b + 0.4 * math.sin(ang), 2.3, 2.85, 0.24, LEAF, 5, r2=0.01, name='frond')
    bamboo = M('bamboo', 0xc8a860, 0.6, grain='wood', scale=20, strength=0.3)
    for k in range(int((W - 0.4) / 0.4)):
        R.box(0.2 + k * 0.4, 0.2 + k * 0.4 + 0.14, 0.2, D - 0.3, RC - 0.16, RC - 0.1, bamboo, 0, 'slat')
    # The bar's thatched roof, on four bamboo posts.
    bar = R.piece('bar')
    if bar:
        c0, c1 = bar[0] + 0.6, W - 0.1
        for a in (c0, c1 - 0.08):
            for b in (bar[2] - 0.0, bar[3] - 0.08):
                R.box(a, a + 0.08, b, b + 0.08, 0, 2.5, bamboo, 0, 'thatch_post')
        R.box(c0 - 0.25, c1, bar[2] - 0.25, bar[3] + 0.25, 2.5, 2.68, M('thatch', 0x9a7a3a, 0.9, grain='plaster', scale=60, strength=0.4), 0.03, 'thatch')


def x_mirror(R, L):
    W, D = R.W, R.D
    mg = glow('mirror_panel', (0.7, 0.72, 0.8), 0.9)
    # Mirror panels on the west wall (the TV hangs in front of them) and behind the bed; a mirrored ceiling; a mirror ball.
    pos = 0.5
    while pos < D - 0.8:
        seg = min(1.3, D - 0.6 - pos)
        R.box(0.05, 0.08, pos + 0.03, pos + seg - 0.03, 0.3, 2.5, mg, 0, 'mirror_panel')
        R.box(0.05, 0.09, pos, pos + 0.03, 0.3, 2.5, STEEL, 0, 'mirror_edge')
        pos += 1.3
    pos = 0.4
    while pos < W - 4.4:
        seg = min(1.3, W - 4.1 - pos)
        R.box(pos + 0.03, pos + seg - 0.03, 0.05, 0.08, 0.3, 2.5, mg, 0, 'mirror_panel')
        R.box(pos, pos + 0.03, 0.05, 0.09, 0.3, 2.5, STEEL, 0, 'mirror_edge')
        pos += 1.3
    R.box(1.0, W - 1.0, 1.0, D - 2.0, RC - 0.03, RC - 0.01, glow('mirror_ceiling', (0.6, 0.62, 0.8), 0.8), 0, 'mirror_ceiling')
    R.sphere(W / 2, D / 2, RC - 0.55, 0.22, M('mirrorball', 0xd8d8e0, 0.15, 1.0), name='mirror_ball')
    R.cyl(W / 2, D / 2, RC - 0.35, RC, 0.01, STEEL, 6, name='ball_string')
    downlight(R, W / 2 + 0.6, D / 2, (0.85, 0.85, 1.0), 12, 'ball_spot')


def tatami(R):
    b = 0.3
    while b < R.D - 0.4:
        R.box(0.05, R.W - 0.05, b, b + 0.03, 0.035, 0.04, M('tatami_edge', 0x5a4020, 0.8), 0, 'tatami_edge')
        b += 0.9


def shoji_behind_bed(R):
    bed = R.piece('bed')
    R.box(bed[0] + 0.2, bed[1] - 0.2, 0.05, 0.07, 1.5, 2.7, M('shoji', 0xf4ecd8, 0.8), 0, 'shoji')
    a = bed[0] + 0.2
    while a < bed[1] - 0.15:
        R.box(a, a + 0.04, 0.05, 0.09, 1.5, 2.7, WOOD_D, 0, 'shoji_bar')
        a += 0.7
    for z in (1.5, 2.1, 2.66):
        R.box(bed[0] + 0.2, bed[1] - 0.2, 0.05, 0.09, z, z + 0.04, WOOD_D, 0, 'shoji_rail')


def x_onsen(R, L):
    W, D = R.W, R.D
    # A paper lantern on the floor in the corner by the door, tatami lines, a shoji screen behind the bed.
    R.box(0.3, 0.75, D - 0.85, D - 0.4, 0, 1.0, M('lantern', 0xf4ecd8, 0.8), 0.01, 'lantern')
    R.box(0.36, 0.69, D - 0.79, D - 0.46, 0.08, 0.92, glow('lantern', (1.0, 0.7, 0.4), 7.0), 0, 'lantern_glow')
    lit(R, 1.05, D - 0.62, 0.55, (1.0, 0.7, 0.4), 16, 'lantern')
    tatami(R)
    shoji_behind_bed(R)


def x_karaoke(R, L):
    W, D = R.W, R.D
    tv = R.piece('tv')
    R.sphere(W / 2, D * 0.55, RC - 0.6, 0.3, M('mirrorball', 0xd8d8e0, 0.15, 1.0), name='mirror_ball')
    R.cyl(W / 2, D * 0.55, RC - 0.32, RC, 0.012, STEEL, 6, name='ball_string')
    lit(R, W / 2 + 0.5, D * 0.55, RC - 0.2, (1.0, 0.3, 1.0), 14, 'disco_a')
    lit(R, W / 2 - 0.5, D * 0.55 + 0.4, RC - 0.2, (0.3, 0.8, 1.0), 9, 'disco_b')
    for i in range(14):
        a = i * 2.39996
        R.cyl(W / 2 + math.cos(a) * (1.4 + (i % 3) * 0.8), D * 0.55 + math.sin(a) * 1.8, RC - 0.04, RC, 0.05, glow('disco', (1.0, 0.3, 1.0) if i % 2 else (0.3, 0.8, 1.0), 8.0), 8, name='disco')
    # A mic on a stand by the low table, speaker towers either side of the TV.
    R.cyl(1.6, tv[2] - 0.5, 0, 0.03, 0.18, BLACK, 12, name='mic_foot')
    R.cyl(1.6, tv[2] - 0.5, 0, 1.5, 0.02, BLACK, 8, name='mic_stand')
    R.sphere(1.6, tv[2] - 0.5, 1.53, 0.06, STEEL, name='mic')
    for b in (tv[2] - 0.75, tv[3] + 0.15):
        R.box(0.1, 0.65, b, b + 0.6, 0, 1.7, BLACK, 0.01, 'speaker')
        for z in (0.5, 1.15):
            R.cyl(0.66, b + 0.3, z - 0.01, z + 0.01, 0.2, STEEL, 16, name='woofer', axis='X')


def x_suite(R, L):
    W, D = R.W, R.D
    ba = (R.piece('bed')[0] + R.piece('bed')[1]) / 2
    for a, b in ((ba - 1.33, 0.3), (ba + 1.21, 0.3), (ba - 1.33, 2.96), (ba + 1.21, 2.96)):
        R.box(a, a + 0.12, b, b + 0.12, 0, 2.75, GOLD, 0.01, 'post')
    canopy = M('suite_canopy', 0x8a1a2a, 0.9, grain='plaster', scale=60, strength=0.25)
    R.box(ba - 1.4, ba + 1.4, 0.05, 3.12, 2.75, 2.85, canopy, 0.02, 'canopy')
    R.box(ba - 1.4, ba + 1.4, 3.1, 3.15, 2.1, 2.75, canopy, 0.01, 'drape')
    chandelier(R, W / 2, 5.2, L)
    # A fireplace on the door wall, west of the door; a writing desk and its chair where the dining table would be; a
    # liquor cabinet east of the door; a rug under the lounge.
    stone = M('stone', 0x6a6460, 0.9, grain='plaster', scale=20, strength=0.4)
    R.box(0.7, 2.9, D - 0.6, D - 0.05, 0, 1.35, stone, 0.01, 'fireplace')
    R.box(1.2, 2.4, D - 0.62, D - 0.3, 0.1, 0.85, BLACK, 0, 'firebox')
    R.box(1.3, 2.3, D - 0.63, D - 0.5, 0.12, 0.55, glow('fire', (1.0, 0.5, 0.15), 6.0), 0, 'fire')
    lit(R, 1.8, D - 0.95, 0.45, (1.0, 0.45, 0.15), 18, 'fire')
    R.box(0.55, 3.05, D - 0.68, D - 0.05, 1.35, 1.44, WOOD_D, 0.01, 'mantel')
    R.box(1.2, 2.4, D - 0.07, D - 0.05, 1.65, 2.6, GOLD, 0.01, 'overmantel')
    R.box(1.3, 2.3, D - 0.08, D - 0.07, 1.75, 2.5, M('suite_art', 0x3a1420, 0.7), 0, 'overmantel_art')
    d = R.piece('dining')
    R.box(d[0], d[1], d[2] + 0.75, d[3] - 0.3, 0.76, 0.82, WOOD_D, 0.01, 'desk_top')
    for b0, b1 in ((d[2] + 0.8, d[2] + 0.88), (d[3] - 0.43, d[3] - 0.35)):
        for a in (d[0] + 0.05, d[1] - 0.13):
            R.box(a, a + 0.08, b0, b1, 0, 0.76, WOOD_D, 0, 'desk_leg')
    R.box(d[0] + 0.05, d[1] - 0.05, d[2] + 0.8, d[3] - 0.35, 0.6, 0.76, WOOD_D, 0, 'desk_apron')
    R.box(d[0] + 0.3, d[0] + 0.8, d[2] + 0.95, d[2] + 1.35, 0.82, 0.835, M('papers', 0xe8d8c0, 0.8), 0, 'papers')
    R.cyl(d[1] - 0.3, d[3] - 0.6, 0.82, 0.96, 0.05, GOLD, 10, name='desk_lamp_base')
    R.cyl(d[1] - 0.3, d[3] - 0.6, 0.96, 1.2, 0.14, glow('banker', (0.3, 0.9, 0.5), 3.0), 14, r2=0.09, name='desk_lamp')
    lit(R, d[1] - 0.55, d[3] - 0.6, 1.0, (0.8, 0.9, 0.6), 8, 'banker')
    C.chair(R, (d[0] + d[1]) / 2, d[2] + 0.3, 'b+', M('suite_chair', 0x8a1a2a, 0.9), frame=WOOD_D)
    da = R.du
    R.box(da + H + 0.4, da + H + 1.5, D - 0.5, D - 0.05, 0, 1.4, WOOD_D, 0.01, 'liquor_cabinet')
    R.cyl(da + H + 0.75, D - 0.28, 1.4, 1.64, 0.06, M('decanter', 0x6a3a14, 0.2), 12, name='decanter')
    R.cyl(da + H + 1.15, D - 0.28, 1.4, 1.52, 0.04, M('glass', 0xc8d8e0, 0.1), 8, name='tumbler')
    rug = M('suite_rug', 0x4a0c18, 0.95, grain='plaster', scale=80, strength=0.4)
    R.box(0.8, 4.2, 3.9, 7.1, 0.035, 0.045, rug, 0, 'rug')


def x_retro(R, L):
    W, D = R.W, R.D
    # 80s: neon tubes zig-zagging on the west wall by the bed, a CRT and a record player on the desk, a bubble lamp, a
    # checker rug in the open middle of the room.
    pk, cy = glow('neon_pink', (1.0, 0.25, 0.7), 9.0), glow('neon_cyan', (0.2, 0.9, 1.0), 9.0)
    for k in range(3):
        R.box(0.06, 0.1, 0.6 + k * 1.1, 0.6 + k * 1.1 + 0.8, 1.2 + (k % 2) * 0.8, 1.25 + (k % 2) * 0.8, pk if k % 2 else cy, 0, 'neon_tube')
        R.box(0.06, 0.1, 0.6 + k * 1.1 + 0.8, 0.6 + k * 1.1 + 1.1, 1.2 + (k % 2) * 0.8, 2.05 - (k % 2) * 0.8, pk if k % 2 else cy, 0, 'neon_tube')
    desk = R.piece('desk')
    if desk:
        R.box(desk[0] + 0.1, desk[0] + 0.7, desk[2] + 0.2, desk[2] + 1.0, 0.81, 1.4, M('crt', 0xd8d0c0, 0.5), 0.03, 'crt')
        R.box(desk[0] + 0.7, desk[0] + 0.72, desk[2] + 0.28, desk[2] + 0.92, 0.9, 1.33, glow('crt_screen', (0.4, 0.9, 0.7), 2.5), 0, 'crt_screen')
        R.box(desk[0] + 0.12, desk[0] + 0.7, desk[3] - 1.0, desk[3] - 0.3, 0.81, 0.92, M('record_player', 0x8a5a3a, 0.6), 0.01, 'record_player')
        R.cyl(desk[0] + 0.41, desk[3] - 0.65, 0.92, 0.94, 0.26, BLACK, 24, name='record')
    R.cyl(W - 0.6, D - 0.6, 0, 0.9, 0.05, STEEL, 10, name='bubble_stand')
    R.cyl(W - 0.6, D - 0.6, 0, 0.04, 0.22, STEEL, 14, name='bubble_foot')
    R.sphere(W - 0.6, D - 0.6, 1.2, 0.34, glow('bubble_lamp', (1.0, 0.5, 0.8), 5.0), name='bubble_lamp')
    lit(R, W - 1.1, D - 1.1, 1.25, (1.0, 0.5, 0.8), 14, 'bubble_lamp')
    lit(R, 0.45, 1.6, 1.6, (0.6, 0.6, 1.0), 12, 'neon')
    for a in range(5):
        for b in range(5):
            if (a + b) % 2 == 0:
                R.box(3.7 + a * 0.6, 4.3 + a * 0.6, 8.3 + b * 0.6, 8.9 + b * 0.6, 0.035, 0.045, M('checker', 0x20a8a0, 0.9), 0, 'checker')


def x_sakura(R, L):
    W, D = R.W, R.D
    # A cherry tree in the corner by the door: a trunk, boughs, and a cloud of blossom; paper lanterns; a shoji screen
    # behind the bed; tatami lines.
    R.cyl(W - 0.7, D - 0.6, 0, 2.1, 0.13, M('bark', 0x4a3020, 0.9, grain='wood', scale=14, strength=0.4), 10, r2=0.08, name='trunk')
    blossom = M('blossom', 0xf4a8c0, 0.9, grain='plaster', scale=90, strength=0.3)
    for k in range(26):
        ang = k * 2.39996
        rad = 0.3 + (k % 5) * 0.18
        R.sphere(W - 0.7 - abs(math.cos(ang)) * rad, D - 0.6 - abs(math.sin(ang)) * rad, 2.1 + (k % 4) * 0.22, 0.22 + (k % 3) * 0.04, blossom, name='blossom')
    for a, b in ((4.6, 5.4), (4.8, 9.0), (2.6, 8.0)):
        R.cyl(a, b, RC - 0.85, RC - 0.3, 0.2, glow('lantern', (1.0, 0.75, 0.6), 3.0), 14, name='lantern')
        R.cyl(a, b, RC - 0.3, RC, 0.01, STEEL, 6, name='lantern_cord')
        lit(R, a, b, RC - 1.0, (1.0, 0.75, 0.6), 9, 'lantern')
    tatami(R)
    shoji_behind_bed(R)


EXTRAS = {
    'dungeon': x_dungeon, 'castle': x_castle, 'marine': x_marine, 'space': x_space, 'resort': x_resort, 'mirror': x_mirror,
    'onsen': x_onsen, 'karaoke': x_karaoke, 'suite': x_suite, 'retro': x_retro, 'sakura': x_sakura,
}


def room_lights(R, th, point):
    """The room's lights: one at each fixture built (`lit`), nothing else. The rooms are dim and the light is the
    lamps' (the user, 2026-10-12: "dimly lit with light coming from lamps, lights, etc"): there had been a bright strip
    round the ceiling and a hidden light in the middle of each room. Pale rooms need less to read the same."""
    k = 0.6 if th in ('castle', 'sakura', 'resort', 'onsen') else 1.25 if th in ('mirror', 'space', 'suite') else 1.0
    for (u, t, z, col, w, r, name) in LIGHTS.get(R.room['no'], []):
        point(u, t, z, col, w * k, r, name)
