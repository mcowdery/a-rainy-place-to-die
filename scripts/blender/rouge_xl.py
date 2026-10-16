"""Hotel Rouge, the big plan, modelled and baked in Blender: a candidate for the showroom review.

  "<blender.exe>" -b --python scripts/blender/rouge_xl.py -- <out.glb> --part ground|f2|f3 [--tex 4096] [--samples 64] [--jpeg]
      [--preview <dir>] [--only 201,202]   (--only builds just those rooms, for a quick look)

Everything comes from content/world3d/rouge_plan.json (the game reads the same file): the keep's inside is u 3.3-30.7,
t 4.3-27.7 in the building's local frame (Blender X = u, Y = t, Z up); the storeys are at 0 / 5 / 10; each guest room and
service room is built in its own frame (rougexl/common.py RM). One GLB a part, each with a baked picture of its own.

  ground  the keep's walls to the roof, the lobby, the front office, the garage, the back hall, 101, the laundry, the stair.
  f2      the 2F: the corridor, 201-203 and 205-206, housekeeping.
  f3      the 3F: the corridor, 301-303 and 305-306, the manager's office.
What the game draws over it: the canvas signs, the doors that swing, the baths' glass and water, the people, the car.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'rougexl'))
import bakelib as B  # noqa: E402
import common as C  # noqa: E402
import floors as FL  # noqa: E402
import ground as G  # noqa: E402
import rooms as GR  # noqa: E402
import service as SV  # noqa: E402

PART = B.arg('--part', 'ground')
LIGHTS_OUT = B.arg('--lights', '')  # write every light made, for the game (halos at the fixtures, light on Mack)
MADE = []
ONLY = [s for s in B.arg('--only', '').split(',') if s]
FLOOR = {'ground': 0, 'f2': 5, 'f3': 10}[PART]


def point(u, t, z, rgb, w, r=0.1, name='light'):
    import bpy
    bpy.ops.object.light_add(type='POINT', location=(u, t, z))
    o = bpy.context.active_object
    o.name = name
    o.data.color = rgb
    o.data.energy = w * 2.6
    o.data.shadow_soft_size = r
    MADE.append([round(u, 3), round(t, 3), round(z, 3), round(rgb[0], 3), round(rgb[1], 3), round(rgb[2], 3), round(w, 2), name])
    return o


def build():
    if PART == 'ground':
        G.build_ground_fixed()
        for r in C.rooms(0):
            if ONLY and r['no'] not in ONLY:
                continue
            (GR.guest if r['kind'] == 'guest' else SV.service)(r)
        G.ground_lights(point)
        for r in C.rooms(0):
            R = C.RM(r)
            (GR.room_lights(R, r['theme'], point) if r['kind'] == 'guest' else SV.service_lights(R, point))
    else:
        FL.slabs(FLOOR)
        FL.corridor(FLOOR)
        for r in C.rooms(FLOOR):
            if ONLY and r['no'] not in ONLY:
                continue
            (GR.guest if r['kind'] == 'guest' else SV.service)(r)
        FL.floor_lights(FLOOR, point)
    import bpy
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.01, 0.006, 0.01, 1)
    B.scene.world = w


def shots():
    y = FLOOR
    s = {}
    CX = G.CX
    if PART == 'ground':
        s.update({
            'lobby_in': ((CX, 5.0, 1.6), (CX, 12.0, 1.5)),
            'lobby_panel': ((CX, 7.5, 1.6), (CX, 12.3, 1.6)),
            'staff_window': ((14.0, 6.8, 1.5), (10.4, 6.8, 1.2)),
            'garage': ((21.0, 7.6, 1.6), (27.0, 8.5, 1.2)),
            'hall_west': ((14.0, 16.0, 1.6), (4.0, 15.0, 1.4)),
            'hall_amenity': ((16.9, 15.5, 1.6), (16.9, 12.6, 1.0)),
            'vending': ((8.8, 16.0, 1.5), (8.8, 12.6, 1.2)),
            'stairs': ((23.0, 16.9, 1.6), (27.5, 16.9, 2.3)),
            'stairs_flight2': ((28.0, 15.5, 3.4), (25.5, 15.5, 4.6)),
            'hall_east': ((14.0, 22.0, 1.6), (26.0, 22.0, 1.3)),
        })
    else:
        s.update({
            'corridor_w': ((24.0, 13.65, y + 1.6), (4.0, 13.65, y + 1.5)),
            'corridor_e': ((6.0, 13.65, y + 1.6), (30.0, 13.65, y + 1.5)),
            'stair_hall': ((23.0, 13.7, y + 1.6), (23.0, 17.5, y + 1.4)),
        })
    for r in C.rooms(FLOOR):
        if ONLY and r['no'] not in ONLY:
            continue
        R = C.RM(r)
        du = R.du
        no = r['no']
        s[no + '_door'] = ((R.U(du), R.T(R.D + 1.2), y + 1.6), (R.U(du), R.T(R.D - 3.0), y + 1.2))
        s[no + '_in'] = ((R.U(du), R.T(R.D - 0.9), y + 1.6), (R.U(R.W * 0.35), R.T(1.5), y + 1.0))
        s[no + '_far'] = ((R.U(R.W * 0.5), R.T(1.0), y + 1.6), (R.U(R.W * 0.5), R.T(R.D - 0.5), y + 1.3))
        if r['kind'] == 'guest':
            s[no + '_bath'] = ((R.U(1.4), R.T(5.0), y + 1.5), (R.U(R.W - 1.8), R.T(1.9), y + 0.8))
    return s


build()
if LIGHTS_OUT:
    import json
    with open(LIGHTS_OUT, 'w', encoding='utf-8') as fh:
        json.dump(MADE, fh, separators=(',', ':'))
    print('lights', len(MADE), LIGHTS_OUT)
room_obj = B.bake_and_export('rouge_xl_' + PART)
B.preview(room_obj, shots())
