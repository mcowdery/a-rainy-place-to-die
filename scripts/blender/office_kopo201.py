"""The detective's office (霧島探偵事務所, コーポ川端 room 201), built in Blender and baked, as a candidate for the
showroom: nothing in the city uses it until the user approves it.

  "<blender.exe>" -b --python scripts/blender/office_kopo201.py -- <out.glb> [--tex 2048] [--samples 48] [--preview <dir>]

Axes: the room's local frame (real/homesCast.ts KOPO_201), metres, with Blender X = u (along the street face),
Y = t (inward from the corridor), Z up, the floor at 0. The room is u 0.25-4.25, t 1.95-11.85, 2.4 high; the door and
the front window are in the t = 1.95 wall, the big window in the t = 11.85 wall. The game puts the model in the
flat's frame (real/homes.ts, Flat.model), so its numbers must stay the plan's: collision is the plan's `walls` and
`solids`, not the mesh's.

What is here: the finishes (floor, wainscot and plaster, skirting, cornice, ceiling), the door with its frosted panel,
the windows with their frames and the back window's venetian blinds, and the furniture of a one-man detective's
office: the coat stand and umbrella stand, the tea corner, the water closet door, the filing cabinets, the client
sofa and table, two client chairs, the desk with its lamp, typewriter, phone, ashtray and files, the swivel chair,
the safe, the credenza with the bottle and glasses, the radio, the ceiling fan and the tube light. The case board and
the lettering on the glass are canvases the game draws (they carry the story's hotspot and the text).

Everything is baked into one texture (Cycles, the room's own lights: the tube, the desk lamp, the neon through the
blinds) and written as one mesh with that texture as its colour: the game shows it unlit.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakelib as B  # noqa: E402
from bakelib import *  # noqa: E402,F401,F403

U0, U1, T0, T1, H = 0.25, 4.25, 1.95, 11.85, 2.4
WALL = 0.12

FLOOR = mat('floor', (0.30, 0.17, 0.09), 0.45, grain='wood', scale=12, strength=0.5)
PLASTER = mat('plaster', (0.62, 0.55, 0.40), 0.9, grain='plaster', scale=6, strength=0.25)
PANEL = mat('panel', (0.14, 0.24, 0.20), 0.55)  # the wainscot: bottle green gloss
WOOD = mat('wood', (0.33, 0.19, 0.09), 0.5, grain='wood', scale=18, strength=0.45)
WOOD_D = mat('wood_dark', (0.18, 0.10, 0.05), 0.5, grain='wood', scale=18, strength=0.4)
TRIM = mat('trim', (0.80, 0.74, 0.60), 0.6)
STEEL = mat('steel', (0.30, 0.34, 0.33), 0.45, 0.6, grain='brushed', scale=40, strength=0.2)
STEEL_G = mat('steel_green', (0.20, 0.28, 0.24), 0.5, 0.5, grain='brushed', scale=40, strength=0.2)
BLACK = mat('black', (0.025, 0.025, 0.028), 0.4, 0.2)
LEATHER = mat('leather', (0.22, 0.09, 0.05), 0.4, grain='plaster', scale=60, strength=0.3)
FABRIC = mat('fabric', (0.34, 0.30, 0.20), 0.95, grain='plaster', scale=90, strength=0.35)
RUG = mat('rug', (0.30, 0.07, 0.07), 0.95, grain='plaster', scale=70, strength=0.45)
PAPER = mat('paper', (0.78, 0.72, 0.55), 0.9)
PAPER_W = mat('paper_white', (0.80, 0.80, 0.76), 0.9)
BRASS = mat('brass', (0.62, 0.45, 0.16), 0.3, 1.0)
GLASS_D = mat('glass_dark', (0.12, 0.17, 0.14), 0.05)
WHISKY = mat('whisky', (0.45, 0.20, 0.03), 0.1, emit=(0.5, 0.22, 0.04, 0.5))
FROST = mat('frost', (0.62, 0.66, 0.58), 0.4, emit=(0.5, 0.55, 0.45, 0.35))
BLIND = mat('blind', (0.70, 0.66, 0.54), 0.5, 0.3)
CHROME = mat('chrome', (0.70, 0.70, 0.68), 0.2, 1.0)
ENAMEL = mat('enamel', (0.60, 0.62, 0.58), 0.3)
LAMPSHADE = mat('lampshade', (0.10, 0.28, 0.16), 0.3, emit=(0.15, 0.5, 0.25, 1.2))
BULB = mat('bulb', (1, 0.9, 0.7), 0.5, emit=(1.0, 0.85, 0.55, 6.0))
TUBE = mat('tube', (0.9, 0.95, 0.9), 0.5, emit=(0.85, 0.95, 0.80, 8.0))
STAIN = mat('stain', (0.40, 0.33, 0.20), 0.95, grain='plaster', scale=3, strength=0.5)

# ---- the shell's finishes -----------------------------------------------------------------------------------------
# Inside faces only, 5 mm inside the game's own walls, so the two never fight.
IN = 0.005
WIN_T1 = (0.6, 3.9, 0.8, 2.05)  # u0, u1, z0, z1
WIN_T0 = (2.8, 3.6, 1.0, 1.7)
DOOR = (1.5, 2.4, 2.0)
WAIN = 0.95  # the wainscot's height


def wall_t(t, inward, openings, mats_lower, mats_upper):
    """A wall on a t = const plane (inward = +1 if the room is at larger t), with openings, wainscot below WAIN."""
    d = IN * inward
    tt = t + d
    th = 0.02
    # Vertical strips between the openings, each in a lower and an upper band.
    cuts = sorted(openings, key=lambda o: o[0])
    xs = [(U0 - WALL, U1 + WALL)]
    segs = []
    a = U0
    for o in cuts:
        segs.append((a, o[0], 0.0, H))
        segs.append((o[0], o[1], 0.0, o[2]))
        segs.append((o[0], o[1], o[3], H))
        a = o[1]
    segs.append((a, U1, 0.0, H))
    for (a0, a1, z0, z1) in segs:
        if a1 - a0 < 1e-3 or z1 - z0 < 1e-3:
            continue
        lo = (z0, min(z1, WAIN))
        hi = (max(z0, WAIN), z1)
        if lo[1] > lo[0]:
            box(a0, a1, tt, tt + th * inward, lo[0], lo[1], mats_lower, 0, 'wainscot')
        if hi[1] > hi[0]:
            box(a0, a1, tt, tt + th * inward, hi[0], hi[1], mats_upper, 0, 'wall')


def wall_u(u, inward, mats_lower, mats_upper):
    tt0, tt1 = T0, T1
    d = IN * inward
    box(u + d, u + d + 0.02 * inward, tt0, tt1, 0, WAIN, mats_lower, 0, 'wainscot')
    box(u + d, u + d + 0.02 * inward, tt0, tt1, WAIN, H, mats_upper, 0, 'wall')


def build_shell():
    box(U0, U1, T0, T1, -0.02, 0.0, FLOOR, 0, 'floor')
    # Plank seams every 0.12 m along t.
    for i in range(int((T1 - T0) / 0.12)):
        box(U0, U1, T0 + i * 0.12 - 0.002, T0 + i * 0.12 + 0.002, 0.0, 0.0015, BLACK, 0, 'seam')
    box(U0, U1, T0, T1, H, H + 0.02, PLASTER, 0, 'ceiling')
    wall_t(T0, +1, [(WIN_T0[0], WIN_T0[1], WIN_T0[2], WIN_T0[3]), (DOOR[0], DOOR[1], DOOR[2], H)], PANEL, PLASTER)
    wall_t(T1, -1, [WIN_T1], PANEL, PLASTER)
    wall_u(U0, +1, PANEL, PLASTER)
    wall_u(U1, -1, PANEL, PLASTER)
    # Dado rail, skirting, picture rail and cornice all round (the t walls broken by the door and the windows).
    for z0, z1, dep, m in ((WAIN, WAIN + 0.045, 0.025, TRIM), (0.0, 0.11, 0.018, TRIM), (H - 0.20, H - 0.17, 0.018, TRIM), (H - 0.075, H, 0.06, TRIM)):
        box(U0, U0 + dep, T0, T1, z0, z1, m, 0.003, 'rail_u0')
        box(U1 - dep, U1, T0, T1, z0, z1, m, 0.003, 'rail_u1')
        for a, b in _t_runs(0.0 if z0 == 0.0 else z0):
            box(a, b, T1 - dep, T1, z0, z1, m, 0.003, 'rail_t1')
        for a, b in _t0_runs(z0, z1):
            box(a, b, T0, T0 + dep, z0, z1, m, 0.003, 'rail_t0')
    # A water stain on the ceiling over the sofa, and a darker mark where the fan sits.
    box(1.0, 2.1, 5.0, 6.4, H - 0.002, H, STAIN, 0, 'stain')


def _t_runs(z):
    """The back wall's runs a rail at height z can take (not across the window)."""
    if WIN_T1[2] - 0.05 < z < WIN_T1[3]:
        return [(U0, WIN_T1[0]), (WIN_T1[1], U1)]
    return [(U0, U1)]


def _t0_runs(z0, z1):
    runs = [(U0, U1)]
    for o in ((DOOR[0], DOOR[1], 0.0, DOOR[2]), (WIN_T0[0], WIN_T0[1], WIN_T0[2], WIN_T0[3])):
        nxt = []
        for a, b in runs:
            if z1 > o[2] and z0 < o[3] and b > o[0] and a < o[1]:
                if a < o[0]:
                    nxt.append((a, o[0]))
                if b > o[1]:
                    nxt.append((o[1], b))
            else:
                nxt.append((a, b))
        runs = nxt
    return runs


def frame(u0, u1, z0, z1, t, inward, dep=0.05, w=0.05, m=None, full=False):
    """A window or door frame on a t wall (casing round the opening, a sill if it is a window)."""
    m = m or TRIM
    tt = t + IN * inward
    box(u0 - w, u0, tt, tt + dep * inward, z0 if full else z0 - w, z1 + w, m, 0.003, 'casing')
    box(u1, u1 + w, tt, tt + dep * inward, z0 if full else z0 - w, z1 + w, m, 0.003, 'casing')
    box(u0 - w, u1 + w, tt, tt + dep * inward, z1, z1 + w, m, 0.003, 'casing')
    if not full:
        box(u0 - w, u1 + w, tt, tt + (dep + 0.04) * inward, z0 - w, z0, m, 0.004, 'sill')


def build_openings():
    frame(*WIN_T1[:2], WIN_T1[2], WIN_T1[3], T1, -1)
    frame(*WIN_T0[:2], WIN_T0[2], WIN_T0[3], T0, +1)
    frame(DOOR[0], DOOR[1], 0.0, DOOR[2], T0, +1, full=True)
    # The door, shut, seen from inside: a varnished leaf with a frosted panel (the lettering is the game's), a brass knob.
    d0, d1 = DOOR[0], DOOR[1]
    t = T0 + 0.02
    box(d0, d1, t, t + 0.04, 0.0, DOOR[2], WOOD_D, 0.004, 'door')
    box(d0 + 0.10, d1 - 0.10, t + 0.04, t + 0.046, 0.95, 1.85, FROST, 0, 'door_glass')
    box(d0 + 0.07, d1 - 0.07, t + 0.04, t + 0.055, 0.92, 0.95, WOOD_D, 0.002, 'door_bar')
    box(d0 + 0.07, d1 - 0.07, t + 0.04, t + 0.055, 1.85, 1.88, WOOD_D, 0.002, 'door_bar')
    box(d0 + 0.07, d0 + 0.10, t + 0.04, t + 0.055, 0.92, 1.88, WOOD_D, 0.002, 'door_bar')
    box(d1 - 0.10, d1 - 0.07, t + 0.04, t + 0.055, 0.92, 1.88, WOOD_D, 0.002, 'door_bar')
    cyl(d1 - 0.09, t + 0.05, 0.98, 1.03, 0.025, BRASS, 16, name='knob', axis='Y')
    box(d1 - 0.12, d1 - 0.06, t + 0.04, t + 0.045, 1.0, 1.06, BRASS, 0, 'plate')
    # The front window (onto the corridor): plain frame and a pane of wired glass is the game's own.
    # The back window's venetian blinds, drawn up to a third of the way and the slats tilted so the neon cuts in stripes.
    u0, u1, z0, z1 = WIN_T1
    t = T1 - 0.05
    print('blinds at t', t, 'slats from', z1 - 0.12)
    box(u0, u1, t - 0.01, t + 0.02, z1 - 0.07, z1 - 0.01, BLIND, 0.003, 'blind_head')
    n = 22
    for i in range(n):
        z = z1 - 0.12 - i * 0.052
        if z < z0 + 0.03:
            break
        rot_box((u0 + u1) / 2, t, z, u1 - u0 - 0.04, 0.05, 0.003, math.radians(-38), BLIND, 0.0005, 'slat')
    for uu in (u0 + 0.06, u1 - 0.06):
        box(uu - 0.003, uu + 0.003, t - 0.005, t + 0.005, z0 + 0.03, z1 - 0.07, BLIND, 0, 'cord')
    box(u0 + 0.5, u0 + 0.55, t - 0.01, t + 0.01, z0 + 0.02, z1 - 0.07, BLIND, 0, 'tape')


# ---- furniture ----------------------------------------------------------------------------------------------------


def drawer_front(u0, u1, t, inward, z0, z1, material, knob=True):
    d = 0.012
    tt = t
    box(u0, u1, tt, tt + d * inward, z0, z1, material, 0.003, 'drawer')
    if knob:
        box((u0 + u1) / 2 - 0.05, (u0 + u1) / 2 + 0.05, tt + d * inward, tt + (d + 0.02) * inward, (z0 + z1) / 2 - 0.008, (z0 + z1) / 2 + 0.008, CHROME, 0.002, 'pull')


def build_entry():
    # Coat stand by the door: a turned pole on a cast foot, hooks, the trench coat and the hat.
    cu, ct = 0.55, 2.35
    cyl(cu, ct, 0.0, 0.05, 0.19, BLACK, 20, r2=0.15, name='stand_foot')
    cyl(cu, ct, 0.05, 1.78, 0.022, BLACK, 12, name='stand_pole')
    sphere(cu, ct, 1.8, 0.035, BLACK, name='stand_knob')
    for k in range(4):
        a = math.radians(45 + 90 * k)
        cyl(cu + 0.07 * math.cos(a), ct + 0.07 * math.sin(a), 1.62, 1.66, 0.012, BLACK, 8, name='hook')
    # The trench coat: a draped slab with shoulders and a belt, tobacco-tan.
    coat = mat('coat', (0.36, 0.28, 0.16), 0.85, grain='plaster', scale=40, strength=0.3)
    box(cu - 0.19, cu + 0.19, ct + 0.02, ct + 0.2, 0.62, 1.58, coat, 0.04, 'coat')
    box(cu - 0.22, cu + 0.22, ct + 0.0, ct + 0.22, 1.42, 1.58, coat, 0.04, 'coat_shoulders')
    box(cu - 0.2, cu + 0.2, ct - 0.005, ct + 0.225, 1.12, 1.17, mat('belt', (0.20, 0.13, 0.07), 0.6), 0.01, 'belt')
    # The hat on the top hook: a brim and a pinched crown.
    felt = mat('felt', (0.10, 0.09, 0.08), 0.95, grain='plaster', scale=80, strength=0.2)
    cyl(cu - 0.07, ct + 0.07, 1.68, 1.70, 0.17, felt, 28, name='hat_brim')
    cyl(cu - 0.07, ct + 0.07, 1.70, 1.80, 0.1, felt, 24, r2=0.085, name='hat_crown')
    cyl(cu - 0.07, ct + 0.07, 1.70, 1.72, 0.103, BLACK, 24, name='hat_band')
    # An umbrella stand: a black cylinder with two umbrellas.
    cyl(1.0, 2.15, 0.0, 0.45, 0.11, BLACK, 20, name='umbrella_stand')
    cyl(1.0, 2.15, 0.45, 0.92, 0.012, WOOD_D, 8, name='umbrella')
    cyl(1.04, 2.12, 0.45, 0.88, 0.012, BLACK, 8, name='umbrella')
    cyl(1.0, 2.15, 0.88, 0.92, 0.03, BLACK, 12, r2=0.015, name='umbrella_furl')
    # The tea corner under the front window: an enamel sink counter, a kettle on a ring, cups, a little fridge.
    box(2.6, 4.25, 1.95, 2.55, 0.0, 0.84, WOOD, 0.005, 'counter')
    box(2.6, 4.25, 1.95, 2.55, 0.84, 0.88, STEEL, 0.004, 'counter_top')
    box(2.9, 3.5, 2.05, 2.5, 0.8, 0.86, ENAMEL, 0.01, 'sink')
    box(2.95, 3.45, 2.1, 2.45, 0.83, 0.87, BLACK, 0.01, 'sink_well')
    cyl(3.7, 2.25, 0.88, 0.89, 0.09, BLACK, 20, name='ring')
    kettle = mat('kettle', (0.25, 0.30, 0.34), 0.25, 0.9)
    cyl(3.7, 2.25, 0.89, 1.04, 0.075, kettle, 20, r2=0.06, name='kettle')
    cyl(3.7, 2.25, 1.04, 1.06, 0.02, BLACK, 12, name='kettle_knob')
    for i, uu in enumerate((4.0, 4.1)):
        cyl(uu, 2.3, 0.88, 0.94, 0.036, ENAMEL if i else TRIM, 16, r2=0.032, name='cup')
    for k in range(3):
        box(2.65 + k * 0.28, 2.88 + k * 0.28, 1.96, 2.54, 0.04, 0.8, WOOD_D, 0.003, 'cupboard')
    box(0.25, 0.85, 1.95, 2.6, 0.0, 0.88, ENAMEL, 0.01, 'fridge')
    box(0.26, 0.84, 2.595, 2.6, 0.55, 0.57, BLACK, 0, 'fridge_seam')
    box(0.27, 0.3, 2.6, 2.63, 0.6, 0.82, CHROME, 0.002, 'fridge_handle')
    # A shelf above the counter with tins and a canister; a calendar.
    box(2.7, 4.2, 1.96, 2.2, 1.35, 1.38, WOOD_D, 0.003, 'shelf')
    for k, c in enumerate(((0.55, 0.12, 0.08), (0.14, 0.30, 0.20), (0.62, 0.50, 0.20), (0.30, 0.30, 0.34))):
        cyl(2.85 + k * 0.3, 2.08, 1.38, 1.38 + 0.14 + 0.02 * k, 0.05, mat('tin%d' % k, c, 0.35, 0.5), 16, name='tin')


def build_wc_and_files():
    # The water closet: a plain door in the u0 wall, a handle, a frosted lights panel.
    box(0.25, 1.1, 3.2, 4.3, 0.0, 2.15, PLASTER, 0.0, 'wc_box')
    box(0.88, 1.1, 3.25, 4.25, 0.0, 2.1, WOOD_D, 0.004, 'wc_door')
    box(1.1, 1.14, 3.55, 3.95, 0.0, 2.1, WOOD_D, 0.003, 'wc_door_face')
    cyl(1.15, 3.65, 1.0, 1.04, 0.022, BRASS, 16, name='wc_knob', axis='X')
    box(1.14, 1.145, 3.6, 3.9, 1.4, 1.9, FROST, 0, 'wc_glass')
    # Filing cabinets against the u1 wall: three four-drawer steel cabinets, one drawer ajar, a stencilled label card.
    for k in range(3):
        t0 = 3.45 + k * 0.58
        box(3.7, 4.25, t0, t0 + 0.55, 0.0, 1.32, STEEL_G, 0.006, 'cabinet')
        for r in range(4):
            z0 = 0.05 + r * 0.31
            drawer_front(3.7, 3.7 + 0.001, t0 + 0.04, 1, z0, z0 + 0.28, STEEL_G, False)
        # Drawers face the room (-u): the fronts are slabs on the u = 3.7 side.
        for r in range(4):
            z0 = 0.05 + r * 0.31
            box(3.675, 3.7, t0 + 0.03, t0 + 0.52, z0, z0 + 0.28, STEEL_G, 0.004, 'drawer')
            box(3.66, 3.675, t0 + 0.2, t0 + 0.38, z0 + 0.12, z0 + 0.135, CHROME, 0.002, 'pull')
            box(3.668, 3.675, t0 + 0.2, t0 + 0.38, z0 + 0.19, z0 + 0.25, PAPER_W, 0, 'label')
    box(3.5, 3.675, 3.48 + 0.58 * 1 + 0.03, 3.48 + 0.58 * 1 + 0.52, 0.36, 0.64, STEEL_G, 0.004, 'drawer_open')
    box(3.52, 3.66, 3.55 + 0.58, 3.5 + 0.58 + 0.45, 0.62, 0.7, PAPER, 0, 'files_in_drawer')
    # Files on top of the cabinets, a plant that never gets watered.
    for k in range(5):
        box(3.8 + 0.03 * k, 3.84 + 0.03 * k, 3.5, 3.85, 1.32, 1.32 + 0.12 + 0.01 * k, (PAPER, mat('buff', (0.65, 0.5, 0.25), 0.9), PAPER_W)[k % 3], 0, 'folder')
    cyl(3.95, 4.85, 1.32, 1.46, 0.07, ENAMEL, 16, r2=0.06, name='pot')
    for k in range(5):
        a = k * 1.256
        cyl(3.95 + 0.07 * math.cos(a), 4.85 + 0.07 * math.sin(a), 1.46, 1.66, 0.025, mat('leaf', (0.30, 0.24, 0.08), 0.8), 6, r2=0.003, name='dead_leaf')


def build_waiting():
    # An old red-brown rug under the client area.
    box(0.85, 3.35, 4.9, 7.5, 0.0, 0.012, RUG, 0.004, 'rug')
    edge = mat('rug_edge', (0.55, 0.40, 0.18), 0.9)
    box(0.9, 3.3, 4.95, 5.0, 0.012, 0.014, edge, 0, 'rug_border')
    box(0.9, 3.3, 7.4, 7.45, 0.012, 0.014, edge, 0, 'rug_border')
    box(0.9, 0.95, 4.95, 7.45, 0.012, 0.014, edge, 0, 'rug_border')
    box(3.25, 3.3, 4.95, 7.45, 0.012, 0.014, edge, 0, 'rug_border')
    # The client sofa on the u0 wall: a two-seat leather settee, worn.
    su0, su1, st0, st1 = 0.30, 0.98, 5.2, 6.95
    box(su0 + 0.1, su1, st0, st1, 0.0, 0.14, WOOD_D, 0.01, 'sofa_base')
    box(su0 + 0.1, su1, st0 + 0.05, st1 - 0.05, 0.14, 0.44, LEATHER, 0.06, 'sofa_seat')
    box(su0, su0 + 0.22, st0, st1, 0.14, 0.86, LEATHER, 0.07, 'sofa_back')
    box(su0 + 0.1, su1, st0, st0 + 0.15, 0.14, 0.62, LEATHER, 0.06, 'sofa_arm')
    box(su0 + 0.1, su1, st1 - 0.15, st1, 0.14, 0.62, LEATHER, 0.06, 'sofa_arm')
    box(su0 + 0.2, su1 - 0.04, 6.04, 6.08, 0.44, 0.47, BLACK, 0, 'cushion_seam')
    for z in (0.5, 0.68):
        box(su0 + 0.22, su0 + 0.24, 5.4, 6.7, z, z + 0.012, BLACK, 0, 'button_row')
    # The low table: a walnut slab on four legs, an ashtray, a magazine, a folded paper.
    box(1.35, 2.15, 5.45, 6.65, 0.38, 0.42, WOOD, 0.006, 'table_top')
    for uu in (1.4, 2.08):
        for tt in (5.5, 6.58):
            box(uu, uu + 0.045, tt, tt + 0.045, 0.0, 0.38, WOOD_D, 0.003, 'table_leg')
    cyl(1.55, 5.7, 0.42, 0.455, 0.07, BLACK, 20, r2=0.06, name='ashtray')
    for k in range(4):
        cyl(1.55 + 0.02 * k, 5.7 - 0.01 * k, 0.455, 0.46, 0.006, PAPER_W, 6, name='butt')
    box(1.7, 2.05, 5.95, 6.3, 0.42, 0.435, mat('mag', (0.65, 0.18, 0.12), 0.8), 0, 'magazine')
    box(1.75, 2.0, 6.0, 6.25, 0.435, 0.438, PAPER_W, 0, 'magazine_page')
    box(1.9, 2.1, 6.4, 6.6, 0.42, 0.43, PAPER, 0, 'folded_paper')
    # A floor lamp by the sofa: a green shade on a brass stem.
    cyl(0.45, 7.3, 0.0, 0.03, 0.12, BLACK, 20, name='floorlamp_base')
    cyl(0.45, 7.3, 0.03, 1.5, 0.012, BRASS, 8, name='floorlamp_stem')
    cyl(0.45, 7.3, 1.45, 1.7, 0.14, LAMPSHADE, 24, r2=0.08, name='floorlamp_shade')


def build_desk():
    # The desk: a big oak partners' desk on the back wall, facing the door, the window and blinds behind the chair.
    du0, du1, dt0, dt1 = 0.95, 3.05, 9.9, 10.9
    dz = 0.76
    box(du0, du1, dt0, dt1, dz - 0.05, dz, WOOD, 0.006, 'desk_top')
    box(du0 + 0.04, du1 - 0.04, dt0 + 0.04, dt1 - 0.04, dz - 0.07, dz - 0.05, WOOD_D, 0.003, 'desk_under')
    for side in (0, 1):
        ua = du0 + 0.03 if side == 0 else du1 - 0.55
        box(ua, ua + 0.52, dt0 + 0.05, dt1 - 0.05, 0.0, dz - 0.05, WOOD_D, 0.006, 'pedestal')
        for r in range(3):
            z0 = 0.06 + r * 0.21
            box(ua + 0.02, ua + 0.5, dt0 + 0.035, dt0 + 0.05, z0, z0 + 0.19, WOOD, 0.004, 'drawer')
            box(ua + 0.2, ua + 0.32, dt0 + 0.02, dt0 + 0.035, z0 + 0.085, z0 + 0.1, BRASS, 0.002, 'pull')
    box(du0 + 0.58, du1 - 0.58, dt0 + 0.04, dt0 + 0.05, 0.38, 0.69, WOOD_D, 0.003, 'modesty')
    # The green blotter, the banker's lamp, the phone, the typewriter, the ashtray, a stack of files, a glass.
    box(1.5, 2.3, 10.1, 10.55, dz, dz + 0.006, mat('blotter', (0.10, 0.20, 0.13), 0.9), 0, 'blotter')
    for k, c in enumerate((PAPER, PAPER_W, PAPER)):
        box(1.55 + 0.04 * k, 2.0 + 0.04 * k, 10.12 + 0.02 * k, 10.5 + 0.02 * k, dz + 0.006 + 0.002 * k, dz + 0.008 + 0.002 * k, c, 0, 'paper')
    # banker's lamp (the baked light's source)
    cyl(2.75, 10.6, dz, dz + 0.02, 0.09, BRASS, 20, name='lamp_base')
    cyl(2.75, 10.6, dz + 0.02, dz + 0.3, 0.012, BRASS, 8, name='lamp_stem')
    box(2.62, 2.88, 10.5, 10.7, dz + 0.3, dz + 0.4, LAMPSHADE, 0.01, 'lamp_shade')
    # the telephone: a black rotary on the corner
    box(1.05, 1.3, 10.55, 10.8, dz, dz + 0.1, BLACK, 0.02, 'phone')
    cyl(1.175, 10.675, dz + 0.1, dz + 0.115, 0.07, BRASS, 20, name='dial')
    box(1.0, 1.35, 10.55, 10.62, dz + 0.1, dz + 0.14, BLACK, 0.015, 'handset')
    # the typewriter
    box(1.55, 2.0, 10.55, 10.85, dz, dz + 0.11, BLACK, 0.02, 'typewriter')
    box(1.58, 1.97, 10.78, 10.9, dz + 0.1, dz + 0.17, BLACK, 0.01, 'typewriter_back')
    box(1.62, 1.93, 10.58, 10.78, dz + 0.11, dz + 0.14, CHROME, 0.004, 'keys')
    box(1.62, 1.83, 10.88, 10.9, dz + 0.17, dz + 0.3, PAPER_W, 0, 'typed_sheet')
    # a cut-glass ashtray with a cigarette, a whisky glass, a stack of case files
    cyl(2.45, 10.2, dz, dz + 0.03, 0.065, GLASS_D, 20, name='ashtray')
    box(2.4, 2.5, 10.19, 10.2, dz + 0.03, dz + 0.04, PAPER_W, 0, 'cigarette')
    cyl(2.2, 10.35, dz, dz + 0.1, 0.034, GLASS_D, 16, r2=0.04, name='glass')
    cyl(2.2, 10.35, dz + 0.005, dz + 0.04, 0.03, WHISKY, 16, name='whisky_in_glass')
    for k in range(4):
        box(2.45, 2.8, 10.3, 10.5, dz + k * 0.025, dz + (k + 1) * 0.025, (PAPER, mat('buff', (0.65, 0.5, 0.25), 0.9), PAPER_W)[k % 3], 0, 'case_file')
    # the swivel chair behind it: a wooden-armed, dark-leather chair, a little turned, in front of the window
    cu, ct = 2.0, 11.3
    cyl(cu, ct, 0.0, 0.05, 0.28, BLACK, 5, name='chair_star')
    cyl(cu, ct, 0.05, 0.42, 0.03, CHROME, 12, name='chair_post')
    box(cu - 0.25, cu + 0.25, ct - 0.25, ct + 0.25, 0.42, 0.5, LEATHER, 0.05, 'chair_seat')
    box(cu - 0.24, cu + 0.24, ct + 0.2, ct + 0.28, 0.5, 1.12, LEATHER, 0.05, 'chair_back')
    for s in (-1, 1):
        box(cu + s * 0.26 - 0.02, cu + s * 0.26 + 0.02, ct - 0.2, ct + 0.2, 0.62, 0.66, WOOD_D, 0.004, 'chair_arm')
        box(cu + s * 0.26 - 0.015, cu + s * 0.26 + 0.015, ct - 0.18, ct - 0.14, 0.5, 0.62, WOOD_D, 0.003, 'chair_arm_post')
    # two client chairs facing the desk
    for uu in (1.3, 2.6):
        for t0, t1 in ((9.0, 9.45),):
            box(uu - 0.22, uu + 0.22, t0, t1, 0.42, 0.46, WOOD, 0.01, 'client_seat')
            box(uu - 0.22, uu + 0.22, t0, t0 + 0.04, 0.46, 0.9, WOOD, 0.01, 'client_back')
            for du, dt in ((-0.2, 0.0), (0.18, 0.0), (-0.2, 0.41), (0.18, 0.41)):
                box(uu + du, uu + du + 0.04, t0 + dt, t0 + dt + 0.04, 0.0, 0.42, WOOD_D, 0.003, 'client_leg')
    # The steel file shelf on the u0 wall (the plan's), the safe in the corner, the credenza on the u1 wall.
    box(0.25, 0.27, 8.9, 10.6, 0.0, 1.8, STEEL, 0.002, 'file_shelf_back')
    box(0.25, 0.6, 8.9, 8.92, 0.0, 1.8, STEEL, 0.002, 'file_shelf_side')
    box(0.25, 0.6, 10.58, 10.6, 0.0, 1.8, STEEL, 0.002, 'file_shelf_side')
    box(0.25, 0.6, 8.9, 10.6, 1.78, 1.8, STEEL, 0.002, 'file_shelf_top')
    for k in range(5):
        z = 0.05 + k * 0.35
        box(0.25, 0.6, 8.9, 10.6, z, z + 0.015, STEEL_G, 0, 'file_shelf_board')
        for i in range(24):
            if (i * 7 + k * 3) % 11 == 0:
                continue
            box(0.28, 0.58, 8.93 + i * 0.07, 8.93 + i * 0.07 + 0.055, z + 0.015, z + 0.015 + 0.2 + 0.02 * ((i * 5 + k) % 4), (PAPER, mat('buff', (0.65, 0.5, 0.25), 0.9), mat('navy', (0.12, 0.17, 0.30), 0.8), mat('maroon', (0.34, 0.10, 0.08), 0.8))[(i + k) % 4], 0, 'file')
    # the safe: dark green steel, brass dial and handle
    box(3.55, 4.2, 11.15, 11.8, 0.0, 0.8, mat('safe', (0.09, 0.17, 0.13), 0.35, 0.6), 0.012, 'safe')
    box(3.57, 3.58, 11.2, 11.75, 0.04, 0.76, BLACK, 0, 'safe_seam')
    cyl(3.54, 11.45, 0.45, 0.47, 0.06, BRASS, 24, name='safe_dial', axis='X')
    box(3.5, 3.54, 11.55, 11.62, 0.4, 0.52, BRASS, 0.004, 'safe_handle')
    cyl(3.9, 11.5, 0.8, 0.96, 0.02, BLACK, 10, name='safe_top_item')
    # the credenza under the case board: a low sideboard with a decanter, tumblers and the radio
    box(3.75, 4.25, 9.0, 10.5, 0.0, 0.76, WOOD_D, 0.008, 'credenza')
    box(3.72, 4.28, 8.98, 10.52, 0.76, 0.79, WOOD, 0.006, 'credenza_top')
    for r, (a, b) in enumerate(((9.03, 9.5), (9.53, 10.0), (10.03, 10.47))):
        box(3.715, 3.75, a, b, 0.06, 0.7, WOOD, 0.004, 'credenza_door')
        box(3.7, 3.715, (a + b) / 2 - 0.01, (a + b) / 2 + 0.01, 0.35, 0.42, BRASS, 0.002, 'pull')
    cyl(4.05, 9.3, 0.79, 0.91, 0.045, GLASS_D, 20, r2=0.06, name='decanter')
    cyl(4.05, 9.3, 0.79, 0.84, 0.04, WHISKY, 20, name='decanter_fill')
    cyl(4.05, 9.3, 0.91, 0.97, 0.018, GLASS_D, 12, name='decanter_neck')
    for k in range(2):
        cyl(3.9 + 0.1 * k, 9.5 + 0.08 * k, 0.79, 0.87, 0.032, GLASS_D, 16, r2=0.038, name='tumbler')
    # the radio: a bakelite cabinet with a lit dial
    box(3.85, 4.2, 9.8, 10.25, 0.79, 1.0, mat('bakelite', (0.17, 0.08, 0.04), 0.3), 0.025, 'radio')
    box(3.84, 3.85, 9.88, 10.1, 0.86, 0.95, mat('dial', (0.9, 0.7, 0.35), 0.4, emit=(1.0, 0.65, 0.2, 2.0)), 0, 'radio_dial')
    for k in range(2):
        cyl(3.83, 10.15 + 0.045 * k, 0.88, 0.89, 0.015, BRASS, 12, name='radio_knob', axis='X')


def build_ceiling():
    # A tube light on the ceiling over the middle of the room, and a slow ceiling fan over the desk.
    box(2.0, 2.5, 4.5, 7.3, H - 0.05, H, ENAMEL, 0.006, 'tube_housing')
    box(2.1, 2.4, 4.6, 7.2, H - 0.052, H - 0.05, TUBE, 0, 'tube')
    cyl(2.25, 9.6, H - 0.18, H, 0.02, BLACK, 8, name='fan_rod')
    cyl(2.25, 9.6, H - 0.26, H - 0.18, 0.1, BLACK, 20, name='fan_motor')
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        o = rot_box(2.25 + 0.4 * math.cos(a), 9.6 + 0.4 * math.sin(a), H - 0.23, 0.12, 0.7, 0.012, 0.0, WOOD, 0.003, 'fan_blade')
        o.rotation_euler = (0, 0, a - math.pi / 2)
    # A bare bulb at the entry on a flex.
    cyl(1.4, 3.0, H - 0.3, H, 0.004, BLACK, 6, name='flex')
    sphere(1.4, 3.0, H - 0.34, 0.035, BULB, 1, 1, 1.25, name='bulb')


def lights():
    def point(u, t, z, rgb, watts, r=0.05, name='light'):
        bpy.ops.object.light_add(type='POINT', location=(u, t, z))
        o = bpy.context.active_object
        o.name = name
        o.data.color = rgb
        o.data.energy = watts
        o.data.shadow_soft_size = r
        return o

    point(2.25, 5.9, H - 0.1, (0.85, 1.0, 0.82), 38, 0.3, 'tube_light')
    point(1.4, 3.0, H - 0.34, (1.0, 0.8, 0.5), 22, 0.05, 'entry_bulb')
    point(2.75, 10.6, 1.28, (1.0, 0.72, 0.38), 38, 0.08, 'desk_lamp')
    point(0.45, 7.3, 1.58, (1.0, 0.7, 0.4), 12, 0.1, 'floor_lamp')
    # The neon outside the back window: a magenta strip high and a cold cyan one low, shining in through the slats.
    for (zc, rgb, w) in ((1.9, (1.0, 0.18, 0.5), 160), (0.9, (0.2, 0.7, 1.0), 110)):
        bpy.ops.object.light_add(type='AREA', location=((WIN_T1[0] + WIN_T1[1]) / 2, T1 + 1.4, zc))
        o = bpy.context.active_object
        o.name = 'neon'
        o.data.shape = 'RECTANGLE'
        o.data.size = 2.4
        o.data.size_y = 0.3
        o.data.color = rgb
        o.data.energy = w
        o.rotation_euler = (math.radians(90 + 8), 0, 0)
    # The corridor's yellow light through the frosted door panel.
    bpy.ops.object.light_add(type='AREA', location=((DOOR[0] + DOOR[1]) / 2, T0 - 0.4, 1.4))
    o = bpy.context.active_object
    o.name = 'corridor'
    o.data.size = 0.7
    o.data.color = (1.0, 0.85, 0.5)
    o.data.energy = 30
    o.rotation_euler = (math.radians(-90), 0, 0)
    # The window's cool daylight, almost nothing: the room's world is black.
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.01, 0.012, 0.02, 1)
    scene.world = w



OFFICE_SHOTS = {
    'door': ((2.0, 2.2, 1.55), (2.3, 11.0, 1.2)),
    'sofa': ((0.5, 5.3, 1.2), (3.2, 8.2, 1.0)),
    'desk': ((2.1, 7.5, 1.6), (2.0, 11.3, 0.9)),
    'window': ((2.4, 11.6, 1.3), (2.0, 4.0, 1.0)),
    'files': ((2.0, 5.5, 1.5), (4.2, 4.2, 0.9)),
    'blinds': ((2.3, 10.2, 1.5), (2.3, 11.85, 1.4)),
}

build_shell()
build_openings()
build_entry()
build_wc_and_files()
build_waiting()
build_desk()
build_ceiling()
lights()
room_obj = bake_and_export('office_kirishima')
preview(room_obj, OFFICE_SHOTS)
