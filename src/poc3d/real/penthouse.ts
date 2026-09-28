import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { Draw, type C3 } from './interiorDraw';
import type { Interior } from './interiors';
import { Kit, text } from './kit';
import { localFrame, localRect, toLocal } from './localFrame';
import { EMIT } from './meshBuilder';

/**
 * THE PEAK's penthouse (ザ・ピーク朝霧): the CEO's home on the tower's top floor, 130 m up, glass all round. A
 * door-entered interior at the building's true position (see interiors.ts): the private elevator in the lobby
 * brings you up. While you're inside, only the tower's crown (the top floor, the roof pavilion and terrace,
 * built by penthouseCrown as the exterior part 'crown') is swapped for this; the tower below stays, so you
 * look down its face through the glass.
 *
 *   130 m  the main floor: the foyer off the elevator, the living room (sectional facing the view, a
 *          fireplace, a grand piano), dining for eight, the kitchen, the CEO's study (desk, shelves, a model
 *          of the city), and a stair up.
 *   136.6  the roof: the master suite in a glass pavilion (bed facing the view, a bath by the glass, the
 *          dressing room), and the terrace round it (an infinity pool, loungers, a fire lounge).
 *
 * Local frame as everywhere (u along the street face, t inward); the tower's plate is u 6-28, t 12-30.
 */

export const PH = { floor: 130, ceil: 135.8, roof: 136.6, pavCeil: 140.6 } as const;
const PLATE = { u0: 6, u1: 28, t0: 12, t1: 30 } as const;
/** The stair up: along the right-hand glass, rising inward. */
const STAIR = { u0: 26.2, u1: 27.7, t0: 18, t1: 18 + (PH.roof - PH.floor) * 1.5 } as const;
/** The cut in the roof slab over the stair (head room from about a third of the way up). */
const HOLE = [26.1, 27.7, 21, STAIR.t1] as const;
/** The master suite on the roof. Its glass: the front (t0) and the left (u0), with doors to the terrace. */
const PAV = { u0: 15, u1: 28, t0: 19, t1: 30 } as const;
const PAV_DOOR_U = [20, 22.4] as const;
const PAV_DOOR_T = [21, 23] as const;
/** The private elevator's shaft (doors facing the foyer). */
const LIFT = { u0: 14, u1: 17, t0: 27.2, t1: 30 } as const;
const POOL = { u0: 8, u1: 20, t0: 12.8, t1: 16.4 } as const;
/** The pool's opening in the deck (it runs to the front glass: an infinity edge). */
const POOL_CUT = [POOL.u0, POOL.u1, PLATE.t0, POOL.t1] as const;
/** The roof's floors are built up this deep on the slab (the pool is sunk into it). */
const BUILDUP = 0.4;
/** The study's walls: along t 21 (a door at 11.6-12.8) and along u 13. */
const STUDY_DOOR = [11.1, 12.7] as const;

type R4 = readonly [number, number, number, number];

const RING: R4[] = [
  [PLATE.u0, PLATE.u0 + 0.3, PLATE.t0, PLATE.t1],
  [PLATE.u1 - 0.3, PLATE.u1, PLATE.t0, PLATE.t1],
  [PLATE.u0, PLATE.u1, PLATE.t0, PLATE.t0 + 0.3],
  [PLATE.u0, PLATE.u1, PLATE.t1 - 0.3, PLATE.t1],
];
const SOFAS: R4[] = [[9, 15, 17.2, 18.1], [8.2, 9.1, 13.6, 18.1]];
const COFFEE: R4 = [10.5, 13.5, 14.4, 15.8];
const PIANO: R4 = [16.8, 19.4, 13.2, 15.6];
const DINING: R4 = [21.4, 27.4, 13.3, 16.1];
const SIDEBOARD: R4 = [21.2, 24, 17.3, 17.9];
const ISLAND: R4 = [21.5, 24.5, 23, 24.5];
const COUNTER: R4 = [20.1, 26, 29.1, 29.7];
const FRIDGE: R4 = [20.1, 20.8, 25.9, 27.9];
const DESK: R4 = [8, 11, 25.6, 26.6];
const SHELVES: R4 = [12.3, 12.9, 22.8, 29];
const MODEL: R4 = [7, 9.4, 22, 23.6];
const FOYER_TABLE = [18.8, 24.4] as const;
const LOUNGERS: R4 = [21.5, 27.5, 13, 15.3];
const FIRE_SOFAS: R4[] = [[7, 7.9, 21, 28], [7, 13, 28.4, 29.4]];
const FIRE_TABLE: R4 = [9.5, 12, 23.5, 25.5];
const BED: R4 = [18.8, 22.6, 26, 29.7];
const TUB: R4 = [24, 25.8, 20.2, 21.3];
const CLOSET: R4[] = [[15.1, 18.5, 29.1, 29.7], [15.1, 15.7, 25.5, 29.1]];
const VANITY: R4 = [22.8, 25, 29.1, 29.7];
const PLANTERS: R4[] = [[6.3, 7.5, 17, 18.2], [12.6, 14.2, 19.4, 20.6]];

function levelRects(): { main: R4[]; roof: R4[] } {
  const main: R4[] = [
    ...RING,
    [PLATE.u0, STUDY_DOOR[0], 20.9, 21.1],
    [STUDY_DOOR[1], 13.1, 20.9, 21.1],
    [12.9, 13.1, 21, PLATE.t1],
    [19.9, 20.1, 25, PLATE.t1],
    [LIFT.u0 - 0.1, LIFT.u1 + 0.1, LIFT.t0, PLATE.t1],
    ...SOFAS,
    COFFEE,
    PIANO,
    DINING,
    SIDEBOARD,
    ISLAND,
    COUNTER,
    FRIDGE,
    DESK,
    [9, 10, 26.6, 27.6],
    SHELVES,
    MODEL,
    [FOYER_TABLE[0] - 0.6, FOYER_TABLE[0] + 0.6, FOYER_TABLE[1] - 0.6, FOYER_TABLE[1] + 0.6],
    // The stair's balustrade, and the space under its top half (and the landing).
    [STAIR.u0 - 0.2, STAIR.u0, STAIR.t0, STAIR.t1],
    [STAIR.u0, STAIR.u1, 25, PLATE.t1],
  ];
  const roof: R4[] = [
    ...RING,
    [PAV.u0, PAV_DOOR_U[0], PAV.t0 - 0.1, PAV.t0 + 0.1],
    [PAV_DOOR_U[1], PAV.u1, PAV.t0 - 0.1, PAV.t0 + 0.1],
    [PAV.u0 - 0.1, PAV.u0 + 0.1, PAV.t0, PAV_DOOR_T[0]],
    [PAV.u0 - 0.1, PAV.u0 + 0.1, PAV_DOOR_T[1], PAV.t1],
    [POOL.u0 - 0.3, POOL.u1 + 0.3, PLATE.t0, POOL.t1 + 0.3],
    LOUNGERS,
    ...FIRE_SOFAS,
    FIRE_TABLE,
    ...PLANTERS,
    BED,
    TUB,
    ...CLOSET,
    VANITY,
    [16, 17, 20, 21.2],
    // Rails round the stairwell.
    [HOLE[0] - 0.2, HOLE[0], HOLE[2], HOLE[3]],
    [HOLE[0] - 0.2, HOLE[1], HOLE[2] - 0.2, HOLE[2]],
  ];
  return { main, roof };
}

const MID = (PH.floor + PH.roof) / 2;
const onStair = (u: number, t: number): number | null =>
  u > STAIR.u0 && u < STAIR.u1 && t > STAIR.t0 && t < STAIR.t1 ? PH.floor + ((t - STAIR.t0) / (STAIR.t1 - STAIR.t0)) * (PH.roof - PH.floor) : null;

/** The penthouse's layout alone (collision, floors, the stair, what counts as inside), without geometry. */
export function penthouseLayout(b: Building3): Omit<Interior, 'group'> {
  const f = localFrame(b);
  const W = (rs: readonly R4[]): Rect[] => rs.map((r) => localRect(f, r[0], r[1], r[2], r[3]));
  const lv = levelRects();
  const main = W(lv.main);
  const roof = W(lv.roof);
  const inPlate = (u: number, t: number): boolean => u > PLATE.u0 && u < PLATE.u1 && t > PLATE.t0 && t < PLATE.t1;
  return {
    colliders: (floor) => (floor < PH.floor - 1 ? [] : floor < MID ? main : roof),
    floorAt(x, z, current) {
      if (current < PH.floor - 2) return null;
      const [u, t] = toLocal(f, x, z);
      if (!inPlate(u, t)) return null;
      const y = onStair(u, t);
      if (y !== null && Math.abs(y - current) < 1.5) return y;
      return current < MID ? PH.floor : PH.roof;
    },
    contains(x, z, y) {
      const [u, t] = toLocal(f, x, z);
      return y > PH.floor - 1 && y < PH.pavCeil + 6 && inPlate(u, t);
    },
  };
}

// ---- Geometry ----

/** The rectangle less a hole, as up to four pieces. */
function around(r: R4, h: R4): R4[] {
  const qs: R4[] = [
    [r[0], r[1], r[2], h[2]],
    [r[0], r[1], h[3], r[3]],
    [r[0], h[0], h[2], h[3]],
    [h[1], r[1], h[2], h[3]],
  ];
  return qs.filter((q) => q[1] - q[0] > 0.01 && q[3] - q[2] > 0.01);
}

const WALNUT = 0x4a3426;
const CREAM = 0xe8e2d8;
const STONE = 0x3a3834;
const WARM: C3 = [0.62, 0.48, 0.32];

/** Mullions and floor-to-ceiling glass round a rectangle's edges, from y0 to y1 (sides: which edges). */
function glassBox(d: Draw, r: R4, y0: number, y1: number, sides: { t0?: boolean; t1?: boolean; u0?: boolean; u1?: boolean }, gaps: { t0?: readonly [number, number]; u0?: readonly [number, number] } = {}): void {
  const [u0, u1, t0, t1] = r;
  const k = d.k;
  const runU = (t: number, gap?: readonly [number, number]): void => {
    const spans: [number, number][] = gap ? [[u0, gap[0]], [gap[1], u1]] : [[u0, u1]];
    for (const [a, b] of spans) k.pane(a, b, y0, y1, t);
    for (let u = u0; u <= u1 + 0.01; u += 2.2) if (!gap || u < gap[0] - 0.05 || u > gap[1] + 0.05) k.box(0x1a1a1c, u - 0.04, u + 0.04, t - 0.04, t + 0.04, y0, y1, y0 > 0.3);
    if (gap) for (const u of gap) k.box(0x1a1a1c, u - 0.05, u + 0.05, t - 0.05, t + 0.05, y0, y1, y0 > 0.3);
  };
  const runT = (u: number, gap?: readonly [number, number]): void => {
    const spans: [number, number][] = gap ? [[t0, gap[0]], [gap[1], t1]] : [[t0, t1]];
    for (const [a, b] of spans) k.paneT(u, a, b, y0, y1);
    for (let t = t0; t <= t1 + 0.01; t += 2.2) if (!gap || t < gap[0] - 0.05 || t > gap[1] + 0.05) k.box(0x1a1a1c, u - 0.04, u + 0.04, t - 0.04, t + 0.04, y0, y1, y0 > 0.3);
    if (gap) for (const t of gap) k.box(0x1a1a1c, u - 0.05, u + 0.05, t - 0.05, t + 0.05, y0, y1, y0 > 0.3);
  };
  if (sides.t0) runU(t0, gaps.t0);
  if (sides.t1) runU(t1);
  if (sides.u0) runT(u0, gaps.u0);
  if (sides.u1) runT(u1);
}

function* mainFloor(d: Draw): Generator<void> {
  const y = PH.floor;
  d.level = y;
  const plate: R4 = [PLATE.u0, PLATE.u1, PLATE.t0, PLATE.t1];
  // Floors: walnut, a stone foyer and kitchen, the study's carpet, a rug under the sofas.
  d.W(WALNUT, PLATE.u0, PLATE.u1, PLATE.t0, PLATE.t1, y - 0.05, y + 0.02);
  d.W(0xd8d2c8, 13.1, 19.9, 21, LIFT.t0, y + 0.02, y + 0.03);
  d.W(0xc8c4bc, 20.1, PLATE.u1, 21, PLATE.t1, y + 0.02, y + 0.03);
  d.W(0x2a3a30, PLATE.u0, 12.9, 21.1, PLATE.t1, y + 0.02, y + 0.03);
  d.W(0xd8ccb8, 8.4, 15.6, 13.2, 18.6, y + 0.02, y + 0.035);
  // The ceiling (and the roof slab over it), cut for the stair; cove light round the edge, downlights.
  for (const q of around(plate, HOLE)) d.W(CREAM, q[0], q[1], q[2], q[3], PH.ceil, PH.roof - BUILDUP, true);
  d.W(0x1a1a1c, HOLE[0] - 0.05, HOLE[0], HOLE[2], HOLE[3], PH.ceil, PH.roof, true);
  d.W(0x1a1a1c, HOLE[0], HOLE[1], HOLE[2] - 0.05, HOLE[2], PH.ceil, PH.roof, true);
  for (const [a, b, c, e] of [[6.4, 27.6, 12.4, 12.5], [6.4, 27.6, 29.5, 29.6], [6.4, 6.5, 12.5, 29.5], [27.5, 27.6, 12.5, 29.5]] as const) d.glow(WARM, a, b, c, e, PH.ceil - 0.03, PH.ceil);
  for (let u = 8; u < 27; u += 3) {
    for (let t = 14; t < 29; t += 3) {
      if (u + 0.15 > HOLE[0] && t > HOLE[2] - 0.3) continue;
      d.glow([0.9, 0.8, 0.62], u - 0.1, u + 0.1, t - 0.1, t + 0.1, PH.ceil - 0.02, PH.ceil);
    }
  }
  glassBox(d, plate, y, PH.ceil, { t0: true, t1: true, u0: true, u1: true });
  yield;

  // The study's walls: the living room side is a dark stone fireplace wall.
  d.W(CREAM, PLATE.u0 + 0.3, STUDY_DOOR[0], 20.9, 21.1, y, PH.ceil);
  d.W(CREAM, STUDY_DOOR[1], 13.1, 20.9, 21.1, y, PH.ceil);
  d.W(CREAM, STUDY_DOOR[0], STUDY_DOOR[1], 20.9, 21.1, y + 2.5, PH.ceil);
  d.W(CREAM, 12.9, 13.1, 21.1, PLATE.t1 - 0.3, y, PH.ceil);
  d.W(STONE, 6.6, 10.9, 20.7, 20.9, y, PH.ceil - 0.4);
  d.W(0x121212, 7.3, 10.6, 20.66, 20.7, y + 0.35, y + 1.05);
  d.glow([1.7, 0.72, 0.26], 7.5, 10.4, 20.64, 20.66, y + 0.4, y + 0.62);
  d.glow([0.9, 0.36, 0.12], 7.5, 10.4, 20.64, 20.66, y + 0.62, y + 0.85);
  d.W(0x5a5650, 6.8, 10.7, 20.3, 20.7, y, y + 0.35);
  // A big abstract canvas over the fireplace.
  d.k.plane(d.k.canvas(512, 320, (g) => {
    g.fillStyle = '#1a1c24';
    g.fillRect(0, 0, 512, 320);
    const cols = ['#c8402a', '#e8b050', '#2a4a7a', '#e8e0d0'];
    for (let i = 0; i < 14; i++) {
      g.fillStyle = cols[i % cols.length];
      g.globalAlpha = 0.75;
      g.beginPath();
      g.arc(60 + ((i * 173) % 400), 50 + ((i * 97) % 220), 18 + ((i * 37) % 60), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }), 3.4, 2.1, 8.95, 20.64, y + 3.2, 'out', 1.0);
  // Kitchen side wall (the foyer beyond), with a lit wine fridge.
  d.W(CREAM, 19.9, 20.1, 25, PLATE.t1 - 0.3, y, PH.ceil);
  d.glow([0.9, 0.5, 0.3], 20.1, 20.12, 25.2, 25.8, y + 0.2, y + 1.8);
  // The elevator: a dark stone shaft, brass doors facing the foyer.
  d.W(0x2a2826, LIFT.u0 - 0.1, LIFT.u1 + 0.1, LIFT.t0, PLATE.t1 - 0.3, y, PH.ceil);
  d.W(0xb89a5a, LIFT.u0 + 0.3, LIFT.u1 - 0.3, LIFT.t0 - 0.04, LIFT.t0, y, y + 2.7);
  d.W(0x6a5634, (LIFT.u0 + LIFT.u1) / 2 - 0.01, (LIFT.u0 + LIFT.u1) / 2 + 0.01, LIFT.t0 - 0.05, LIFT.t0 - 0.04, y, y + 2.7);
  d.glow([1.2, 0.9, 0.5], LIFT.u1 + 0.02, LIFT.u1 + 0.1, LIFT.t0 - 0.06, LIFT.t0 - 0.02, y + 1.2, y + 1.4);
  d.k.plane(d.sign('PH', 'THE PEAK', '#2a2826', '#d8b870', 256, 128), 0.5, 0.25, (LIFT.u0 + LIFT.u1) / 2, LIFT.t0 - 0.05, y + 2.95, 'out', 1.0);
  yield;

  // The living room: a sectional facing the view, a marble coffee table, a grand piano, floor lamps.
  const [s0, s1] = SOFAS;
  d.W(0xd8d0c4, s0[0], s0[1], s0[2], s0[3], y, y + 0.42);
  d.W(0xd8d0c4, s0[0], s0[1], s0[3] - 0.25, s0[3], y + 0.42, y + 0.85);
  d.W(0xd8d0c4, s1[0], s1[1], s1[2], s1[3], y, y + 0.42);
  d.W(0xd8d0c4, s1[0], s1[0] + 0.25, s1[2], s1[3], y + 0.42, y + 0.85);
  for (let u = 9.3; u < 14.8; u += 1.3) d.W(d.pick([0x8a2a2a, 0x2a3a5a, 0xc8a870]), u, u + 0.45, 17.6, 17.8, y + 0.42, y + 0.8);
  d.W(0xf0ece6, COFFEE[0], COFFEE[1], COFFEE[2], COFFEE[3], y + 0.3, y + 0.38);
  d.W(0x1a1a1c, COFFEE[0] + 0.3, COFFEE[1] - 0.3, COFFEE[2] + 0.3, COFFEE[3] - 0.3, y, y + 0.3);
  d.W(0x1a1a1c, 11.6, 12.1, 14.9, 15.3, y + 0.38, y + 0.5);
  d.lathe(0x2a5a3a, 12.6, 15.1, [[y + 0.38, 0.08], [y + 0.55, 0.1], [y + 0.62, 0.05]], 8);
  const [p0, p1, p2, p3] = PIANO;
  d.W(0x0a0a0c, p0, p1, p2, p3, y + 0.62, y + 0.95);
  for (const [a, b] of [[p0 + 0.2, p2 + 0.2], [p1 - 0.3, p2 + 0.2], [p0 + 0.2, p3 - 0.3]] as const) d.W(0x0a0a0c, a, a + 0.1, b, b + 0.1, y, y + 0.62);
  d.W(0xf4f2ee, p0 + 0.3, p1 - 0.3, p3 - 0.02, p3 + 0.12, y + 0.78, y + 0.82);
  d.quad(0x0a0a0c, d.P(p0, p2, y + 0.95), d.P(p1, p2, y + 0.95), d.P(p1, p3 - 0.4, y + 1.9), d.P(p0, p3 - 0.4, y + 1.9));
  d.W(0x0a0a0c, (p0 + p1) / 2 - 0.4, (p0 + p1) / 2 + 0.4, p3 + 0.5, p3 + 0.85, y, y + 0.5);
  for (const [u, t] of [[8.6, 13.0], [15.5, 18.4]] as const) {
    d.W(0x1a1a1c, u - 0.02, u + 0.02, t - 0.02, t + 0.02, y, y + 1.55);
    d.lathe(0, u, t, [[y + 1.5, 0.22], [y + 1.8, 0.16]], 12, EMIT.always, [1.1, 0.85, 0.55]);
  }
  d.person(20.8, 13.1, 0, -1, { body: 'woman', color: [1.0, 0.85, 0.75], hair: 'long', long: true });
  yield;

  // Dining for eight under a row of pendants; the sideboard.
  const [q0, q1, q2, q3] = DINING;
  d.W(0x2a1e16, q0 + 0.6, q1 - 0.6, q2 + 0.7, q3 - 0.7, y + 0.72, y + 0.78);
  for (const u of [q0 + 0.9, q1 - 1.0]) for (const t of [q2 + 0.9, q3 - 1.0]) d.W(0x2a1e16, u, u + 0.1, t, t + 0.1, y, y + 0.72);
  for (let i = 0; i < 4; i++) {
    const u = q0 + 1.0 + i * 1.25;
    for (const [t, back] of [[q2 + 0.05, q2 + 0.05], [q3 - 0.5, q3 - 0.1]] as const) {
      d.W(0xe8e0d4, u, u + 0.45, t, t + 0.45, y + 0.44, y + 0.5);
      d.W(0xe8e0d4, u, u + 0.45, back, back + 0.05, y + 0.5, y + 1.0);
      d.W(0x3a2a1e, u + 0.05, u + 0.4, t + 0.05, t + 0.4, y, y + 0.44);
    }
    d.lathe(0, u + 0.2, (q2 + q3) / 2, [[PH.ceil - 1.6, 0.2], [PH.ceil - 1.45, 0.08]], 10, EMIT.always, [1.2, 0.9, 0.55]);
    d.W(0x1a1a1c, u + 0.19, u + 0.21, (q2 + q3) / 2 - 0.01, (q2 + q3) / 2 + 0.01, PH.ceil - 1.45, PH.ceil);
  }
  d.W(WALNUT, SIDEBOARD[0], SIDEBOARD[1], SIDEBOARD[2], SIDEBOARD[3], y, y + 0.85);
  d.lathe(0xe8e0d0, 22.4, 17.6, [[y + 0.85, 0.08], [y + 1.1, 0.14], [y + 1.3, 0.06]], 10);
  d.ball(0xc83a4a, 22.4, 17.6, y + 1.3, 0.16);
  d.W(0xc8a860, 23.2, 23.7, 17.45, 17.75, y + 0.85, y + 1.25);
  yield;

  // The kitchen: a marble island with stools, dark cabinets along the back glass, the fridge.
  const [i0, i1, i2, i3] = ISLAND;
  d.W(0x1a1a1c, i0 + 0.1, i1 - 0.1, i2 + 0.1, i3 - 0.1, y, y + 0.88);
  d.W(0xf4f2ee, i0, i1, i2, i3, y + 0.88, y + 0.94);
  for (const u of [i0 + 0.5, (i0 + i1) / 2, i1 - 0.5]) d.lathe(0x1a1a1c, u, i2 - 0.45, [[y, 0.18], [y + 0.02, 0.18], [y + 0.03, 0.03], [y + 0.72, 0.03], [y + 0.73, 0.2], [y + 0.8, 0.2]], 10);
  for (const u of [i0 + 0.8, i1 - 0.8]) d.lathe(0, u, (i2 + i3) / 2, [[y + 3.0, 0.16], [y + 3.3, 0.06]], 10, EMIT.always, [1.1, 0.9, 0.6]);
  d.W(0x1a1a1c, COUNTER[0], COUNTER[1], COUNTER[2], COUNTER[3], y, y + 0.9);
  d.W(0xf4f2ee, COUNTER[0], COUNTER[1], COUNTER[2] - 0.05, COUNTER[3], y + 0.9, y + 0.95);
  d.W(0x8a8e92, 22.5, 23.3, COUNTER[2] + 0.05, COUNTER[3] - 0.05, y + 0.95, y + 0.97);
  d.W(0xb8bcc0, FRIDGE[0], FRIDGE[1], FRIDGE[2], FRIDGE[3], y, y + 2.3);
  d.W(0x8a8e92, FRIDGE[1], FRIDGE[1] + 0.02, FRIDGE[2] + 0.2, FRIDGE[3] - 0.2, y + 0.9, y + 1.6);
  yield;

  // The foyer: a round table with flowers, a butler waiting.
  const [fu, ft] = FOYER_TABLE;
  d.lathe(0x2a2826, fu, ft, [[y, 0.35], [y + 0.1, 0.25], [y + 0.12, 0.08], [y + 0.72, 0.08], [y + 0.74, 0.55], [y + 0.8, 0.55]], 16);
  d.lathe(0xe8e4dc, fu, ft, [[y + 0.8, 0.1], [y + 1.1, 0.16], [y + 1.3, 0.08]], 12);
  for (const [a, b, hex] of [[0, 0, 0xf4f0f0], [0.18, 0.1, 0xe8a0b0], [-0.15, 0.12, 0xf4f0f0], [0.05, -0.18, 0xd83a4a]] as const) d.ball(hex, fu + a, ft + b, y + 1.3, 0.14, 7);
  d.person(19.4, 22.4, -1, 0, { body: 'man', color: [0.95, 0.92, 0.85], long: true, hair: 'short' });

  // The study: desk and monitors, shelves of books, the model of the city, a globe.
  const [k0, k1, k2, k3] = DESK;
  d.W(WALNUT, k0, k1, k2, k3, y + 0.72, y + 0.78);
  d.W(WALNUT, k0, k0 + 0.08, k2, k3, y, y + 0.72);
  d.W(WALNUT, k1 - 0.08, k1, k2, k3, y, y + 0.72);
  for (const u of [8.7, 9.9]) {
    d.W(0x1a1a1c, u - 0.02, u + 0.02, 26.2, 26.3, y + 0.78, y + 1.0);
    d.W(0x1a1a1c, u - 0.5, u + 0.5, 26.18, 26.22, y + 1.0, y + 1.6);
    d.glow([0.35, 0.5, 0.7], u - 0.46, u + 0.46, 26.16, 26.18, y + 1.04, y + 1.56);
  }
  d.W(0x1a1a1c, 9, 10, 26.8, 27.6, y + 0.45, y + 0.55);
  d.W(0x1a1a1c, 9, 10, 27.45, 27.6, y + 0.55, y + 1.3);
  const [h0, h1, h2, h3] = SHELVES;
  d.W(WALNUT, h0, h1, h2, h3, y, y + 2.8);
  for (let sy = 0.35; sy < 2.6; sy += 0.5) {
    for (let t = h2 + 0.1; t < h3 - 0.15; t += 0.06 + 0.04 * d.rnd()) {
      if (d.rnd() < 0.12) continue;
      d.W(d.pick([0x6a1a1a, 0x1a2a4a, 0x2a4a2a, 0xc8b890, 0x3a2a1e]), h0 - 0.02, h0 + 0.22, t, t + 0.05, y + sy, y + sy + 0.26 + 0.1 * d.rnd());
    }
  }
  const [m0, m1, m2, m3] = MODEL;
  d.W(WALNUT, m0, m1, m2, m3, y, y + 0.85);
  for (let u = m0 + 0.15; u < m1 - 0.15; u += 0.22) {
    for (let t = m2 + 0.15; t < m3 - 0.15; t += 0.22) {
      const h = 0.05 + 0.3 * d.rnd() * d.rnd();
      d.W(0xe8e8e4, u, u + 0.14, t, t + 0.14, y + 0.85, y + 0.85 + h);
    }
  }
  d.W(0xc82a2a, 8.2, 8.34, 22.8, 22.94, y + 0.85, y + 1.35);
  d.lathe(0x3a2a1e, 7.4, 28.6, [[y, 0.2], [y + 0.05, 0.05], [y + 0.8, 0.05]], 8);
  d.ball(0x2a5a8a, 7.4, 28.6, y + 0.8, 0.28, 12);
  yield;

  // The stair up: walnut treads on a black stringer, a glass balustrade, the handrail.
  const rise = PH.roof - PH.floor;
  const ramp = (t: number): number => y + ((t - STAIR.t0) / (STAIR.t1 - STAIR.t0)) * rise;
  for (let t = STAIR.t0; t < STAIR.t1 - 0.01; t += 0.3) {
    const top = ramp(Math.min(STAIR.t1, t + 0.3));
    d.W(WALNUT, STAIR.u0, STAIR.u1, t, t + 0.3, top - 0.05, top);
  }
  d.quad(0x1a1a1c, d.P(STAIR.u0, STAIR.t0, y), d.P(STAIR.u1, STAIR.t0, y), d.P(STAIR.u1, STAIR.t1, PH.roof - 0.35), d.P(STAIR.u0, STAIR.t1, PH.roof - 0.35));
  d.quad(0x1a1a1c, d.P(STAIR.u0 - 0.02, STAIR.t0, y), d.P(STAIR.u0 - 0.02, STAIR.t1, PH.roof - 0.35), d.P(STAIR.u0 - 0.02, STAIR.t1, PH.roof), d.P(STAIR.u0 - 0.02, STAIR.t0, y + 0.05));
  for (let t = STAIR.t0; t < STAIR.t1 - 0.01; t += 0.3) d.k.paneT(STAIR.u0 - 0.1, t, t + 0.3, ramp(t) + 0.05, ramp(t) + 1.0);
  d.quad(0x1a1a1c, d.P(STAIR.u0 - 0.15, STAIR.t0, y + 1.0), d.P(STAIR.u0 - 0.05, STAIR.t0, y + 1.0), d.P(STAIR.u0 - 0.05, STAIR.t1, PH.roof + 1.0), d.P(STAIR.u0 - 0.15, STAIR.t1, PH.roof + 1.0));
  // Under the stair's top: a closed store (the space the collision keeps you out of).
  d.W(CREAM, STAIR.u0 - 0.05, STAIR.u0, 25, PLATE.t1 - 0.3, y, PH.ceil);
}

function* roofLevel(d: Draw): Generator<void> {
  const y = PH.roof;
  d.level = y;
  const k = d.k;
  const night = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom = false): void => k.lit(hex, u0, u1, t0, t1, y0, y1, false, bottom);
  // The terrace: teak decking in front, stone at the side; the glass parapet round it.
  for (const q of around([PLATE.u0, PLATE.u1, PLATE.t0, PAV.t0], POOL_CUT)) night(0x8a6a4a, q[0], q[1], q[2], q[3], y - BUILDUP, y + 0.02);
  night(0xb8b0a4, PLATE.u0, PAV.u0, PAV.t0, PLATE.t1, y - BUILDUP, y + 0.02);
  for (const [a, b, c, e] of [[PLATE.u0, PLATE.u1, PLATE.t0, PLATE.t0 + 0.12], [PLATE.u0, PLATE.u0 + 0.12, PLATE.t0, PLATE.t1], [PLATE.u1 - 0.12, PLATE.u1, PLATE.t0, PAV.t0], [PLATE.u0, PAV.u0, PLATE.t1 - 0.12, PLATE.t1]] as const) k.box(0x2a2a2e, a, b, c, e, y + 1.2, y + 1.26, true);
  k.pane(PLATE.u0, PLATE.u1, y, y + 1.2, PLATE.t0 + 0.06);
  k.paneT(PLATE.u0 + 0.06, PLATE.t0, PLATE.t1, y, y + 1.2);
  k.paneT(PLATE.u1 - 0.06, PLATE.t0, PAV.t0, y, y + 1.2);
  k.pane(PLATE.u0, PAV.u0, y, y + 1.2, PLATE.t1 - 0.06);
  yield;

  // The infinity pool: its water to the glass edge, lit from below.
  d.W(0x0c3c48, POOL.u0, POOL.u1, PLATE.t0, POOL.t1, y - BUILDUP, y - 0.12);
  k.glow([0.002, 0.012, 0.016], POOL.u0 + 0.1, POOL.u1 - 0.1, PLATE.t0 + 0.1, POOL.t1 - 0.1, y - 0.12, y - 0.115, EMIT.lamp);
  night(0xe8e4dc, POOL.u0 - 0.3, POOL.u1 + 0.3, POOL.t1, POOL.t1 + 0.3, y, y + 0.08);
  night(0xe8e4dc, POOL.u0 - 0.3, POOL.u0, PLATE.t0, POOL.t1, y, y + 0.08);
  night(0xe8e4dc, POOL.u1, POOL.u1 + 0.3, PLATE.t0, POOL.t1, y, y + 0.08);
  // Loungers with towels, the fire lounge, planters, bollard lights.
  for (let i = 0; i < 3; i++) {
    const u = LOUNGERS[0] + 0.3 + i * 2.0;
    night(0xf0ece6, u, u + 0.7, LOUNGERS[2] + 0.4, LOUNGERS[3], y + 0.3, y + 0.38);
    d.quad(0xf0ece6, d.P(u, LOUNGERS[2] + 0.4, y + 0.38), d.P(u + 0.7, LOUNGERS[2] + 0.4, y + 0.38), d.P(u + 0.7, LOUNGERS[2] - 0.1, y + 0.95), d.P(u, LOUNGERS[2] - 0.1, y + 0.95));
    night(i === 1 ? 0x2a6a9a : 0xe8d8b0, u + 0.05, u + 0.65, LOUNGERS[2] + 1.0, LOUNGERS[2] + 1.6, y + 0.38, y + 0.42);
    for (const t of [LOUNGERS[2] + 0.5, LOUNGERS[3] - 0.1]) k.box(0x8a8e92, u + 0.05, u + 0.65, t - 0.05, t, y, y + 0.3);
  }
  for (const [a, b, c, e] of FIRE_SOFAS) {
    night(0x6a6a6e, a, b, c, e, y, y + 0.45);
    night(0x6a6a6e, a, b === 7.9 ? a + 0.25 : b, c, b === 7.9 ? e : c + 0.25, y + 0.45, y + 0.85);
  }
  const [x0, x1, x2, x3] = FIRE_TABLE;
  night(0x3a3834, x0, x1, x2, x3, y, y + 0.42);
  k.box(0x1a1a1a, x0 + 0.2, x1 - 0.2, x2 + 0.5, x3 - 0.5, y + 0.42, y + 0.44);
  d.glow([1.6, 0.66, 0.22], x0 + 0.35, x1 - 0.35, x2 + 0.85, x3 - 0.85, y + 0.44, y + 0.62);
  for (const [a, b, c, e] of PLANTERS) {
    night(0x3a3834, a, b, c, e, y, y + 0.7);
    k.lathe(0x2e5a34, (a + b) / 2, (c + e) / 2, [[y + 0.7, 0.1], [y + 1.2, 0.7], [y + 2.0, 0.6], [y + 2.6, 0.08]], 8);
  }
  for (const [u, t] of [[6.8, 20], [6.8, 25], [14.3, 24.5], [14.3, 28.5], [21, 18.4], [27.2, 18.4]] as const) {
    k.box(0x1a1a1c, u - 0.08, u + 0.08, t - 0.08, t + 0.08, y, y + 0.55);
    k.glow([1.0, 0.8, 0.5], u - 0.07, u + 0.07, t - 0.07, t + 0.07, y + 0.55, y + 0.62, EMIT.lamp);
  }
  d.person(18.6, 18.3, 0, -1, { body: 'man', pose: 'pockets', color: [0.6, 0.62, 0.72], hair: 'short', long: true });
  yield;

  // The master suite: a glass pavilion (doors to the terrace), its ceiling, a wood floor round the stairwell.
  const pav: R4 = [PAV.u0, PAV.u1, PAV.t0, PAV.t1];
  for (const q of around(pav, HOLE)) d.W(0x8a6a4a, q[0], q[1], q[2], q[3], y - BUILDUP, y + 0.03);
  d.W(CREAM, PAV.u0, PAV.u1, PAV.t0, PAV.t1, PH.pavCeil, PH.pavCeil + 0.1, true);
  k.box(0x2a2a2e, PAV.u0 - 0.3, PAV.u1, PAV.t0 - 0.3, PAV.t1, PH.pavCeil + 0.1, PH.pavCeil + 0.6, true);
  for (const [a, b, c, e] of [[PAV.u0 + 0.2, PAV.u1 - 0.2, PAV.t0 + 0.2, PAV.t0 + 0.3], [PAV.u0 + 0.2, PAV.u0 + 0.3, PAV.t0 + 0.3, PAV.t1 - 0.3]] as const) d.glow(WARM, a, b, c, e, PH.pavCeil - 0.03, PH.pavCeil);
  glassBox(d, pav, y, PH.pavCeil, { t0: true, t1: true, u0: true, u1: true }, { t0: PAV_DOOR_U, u0: PAV_DOOR_T });
  // Rails round the stairwell.
  d.k.paneT(HOLE[0] - 0.1, HOLE[2], HOLE[3], y, y + 1.0);
  d.k.pane(HOLE[0] - 0.1, HOLE[1], y, y + 1.0, HOLE[2] - 0.1);
  k.box(0x1a1a1c, HOLE[0] - 0.14, HOLE[0] - 0.06, HOLE[2] - 0.14, HOLE[3], y + 1.0, y + 1.05, true);
  k.box(0x1a1a1c, HOLE[0] - 0.14, HOLE[1], HOLE[2] - 0.14, HOLE[2] - 0.06, y + 1.0, y + 1.05, true);
  // The bed facing the view, nightstands and lamps, a rug.
  const [b0, b1, b2, b3] = BED;
  d.W(0xb8a890, b0 - 0.4, b1 + 0.4, b2 - 0.8, b3, y + 0.03, y + 0.04);
  d.W(0x3a2a24, b0 + 0.6, b1 - 0.6, b2 + 0.1, b3 - 0.2, y, y + 0.3);
  d.W(0xf0ece6, b0 + 0.6, b1 - 0.6, b2 + 0.1, b3 - 0.2, y + 0.3, y + 0.58);
  d.W(0x2a3a5a, b0 + 0.55, b1 - 0.55, b2 + 0.1, b2 + 0.9, y + 0.58, y + 0.62);
  d.W(0x3a2a24, b0 + 0.5, b1 - 0.5, b3 - 0.2, b3, y, y + 1.3);
  for (const u of [b0 + 0.9, b1 - 1.6]) d.W(0xf8f6f2, u, u + 0.7, b3 - 0.6, b3 - 0.2, y + 0.58, y + 0.72);
  for (const u of [b0, b1 - 0.55]) {
    d.W(WALNUT, u, u + 0.55, b3 - 0.6, b3 - 0.1, y, y + 0.55);
    d.lathe(0, u + 0.27, b3 - 0.35, [[y + 0.75, 0.16], [y + 0.95, 0.12]], 10, EMIT.always, [1.0, 0.78, 0.5]);
    d.W(0x1a1a1c, u + 0.26, u + 0.28, b3 - 0.36, b3 - 0.34, y + 0.55, y + 0.75);
  }
  // The bath by the glass, the lounge chair, the vanity, the dressing room's rails of suits.
  const [w0, w1, w2, w3] = TUB;
  d.W(0xf4f4f2, w0, w1, w2, w3, y, y + 0.6);
  d.glow([0.3, 0.42, 0.46], w0 + 0.1, w1 - 0.1, w2 + 0.1, w3 - 0.1, y + 0.6, y + 0.61);
  d.W(0x8a8e92, w1 - 0.1, w1 - 0.05, (w2 + w3) / 2 - 0.03, (w2 + w3) / 2 + 0.03, y + 0.6, y + 1.0);
  d.W(0x3a2a24, 16, 17, 20, 21.2, y, y + 0.4);
  d.quad(0x3a2a24, d.P(16, 21.2, y + 0.4), d.P(17, 21.2, y + 0.4), d.P(17, 21.5, y + 1.0), d.P(16, 21.5, y + 1.0));
  const [v0, v1, v2, v3] = VANITY;
  d.W(0xf4f2ee, v0, v1, v2, v3, y, y + 0.85);
  d.glow([0.55, 0.57, 0.6], v0 + 0.1, v1 - 0.1, v3 - 0.12, v3 - 0.1, y + 1.0, y + 2.0);
  for (const [a, b, c, e] of CLOSET) {
    d.W(0xe8e2d8, a, b, c, e, y, y + 2.4);
    const alongU = b - a > e - c;
    const n = alongU ? Math.floor((b - a) / 0.12) : Math.floor((e - c) / 0.12);
    for (let i = 0; i < n; i++) {
      const hex = d.pick([0x1a1a1c, 0x2a2a3a, 0x3a3a40, 0xe8e8ec, 0x1a2a4a]);
      if (alongU) d.W(hex, a + 0.05 + i * 0.12, a + 0.1 + i * 0.12, c - 0.55, c, y + 0.9, y + 1.9);
      else d.W(hex, b, b + 0.55, c + 0.05 + i * 0.12, c + 0.1 + i * 0.12, y + 0.9, y + 1.9);
    }
  }
}

/** The penthouse interior (hidden until you're inside), built a slice at a time. */
export function* penthouseInterior(b: Building3, city: THREE.Material, ghost: THREE.Material): Generator<void, Interior> {
  const k = new Kit(b);
  const d = new Draw(k);
  yield* mainFloor(d);
  yield* roofLevel(d);
  const group = k.finish(city, ghost);
  group.visible = false;
  return { group, ...penthouseLayout(b) };
}

/**
 * The tower's crown as seen from outside (the exterior part the interior replaces): the lit glass top floor, the
 * slab, the pavilion on the roof, the pool's glow, the planters and parapet.
 */
export function penthouseCrown(k: Kit): void {
  const glowRGB: C3 = [0.34, 0.24, 0.13];
  const { floor: y1, ceil, roof, pavCeil } = PH;
  k.glow(glowRGB, PLATE.u0 + 0.2, PLATE.u1 - 0.2, PLATE.t0, PLATE.t0 + 0.1, y1, ceil, EMIT.lamp);
  k.glow(glowRGB, PLATE.u0 + 0.2, PLATE.u1 - 0.2, PLATE.t1 - 0.1, PLATE.t1, y1, ceil, EMIT.lamp);
  k.glow(glowRGB, PLATE.u0, PLATE.u0 + 0.1, PLATE.t0 + 0.2, PLATE.t1 - 0.2, y1, ceil, EMIT.lamp);
  k.glow(glowRGB, PLATE.u1 - 0.1, PLATE.u1, PLATE.t0 + 0.2, PLATE.t1 - 0.2, y1, ceil, EMIT.lamp);
  k.box(0x1a1a1c, PLATE.u0 + 0.1, PLATE.u1 - 0.1, PLATE.t0 + 0.1, PLATE.t1 - 0.1, y1, ceil);
  for (let u = PLATE.u0; u <= PLATE.u1 + 0.01; u += 2.2) {
    k.box(0x1a1a1c, u - 0.05, u + 0.05, PLATE.t0 - 0.05, PLATE.t0 + 0.05, y1, ceil);
    k.box(0x1a1a1c, u - 0.05, u + 0.05, PLATE.t1 - 0.05, PLATE.t1 + 0.05, y1, ceil);
  }
  for (let t = PLATE.t0; t <= PLATE.t1 + 0.01; t += 2.2) {
    k.box(0x1a1a1c, PLATE.u0 - 0.05, PLATE.u0 + 0.05, t - 0.05, t + 0.05, y1, ceil);
    k.box(0x1a1a1c, PLATE.u1 - 0.05, PLATE.u1 + 0.05, t - 0.05, t + 0.05, y1, ceil);
  }
  k.box(0xd8d0c0, PLATE.u0 - 0.4, PLATE.u1 + 0.4, PLATE.t0 - 0.4, PLATE.t1 + 0.4, ceil, roof - BUILDUP);
  k.lit(0xb8b0a4, PLATE.u0, PAV.u0, PAV.t0, PLATE.t1, roof - BUILDUP, roof + 0.02);
  k.box(0x1a1a1c, PAV.u0, PAV.u1, PAV.t0, PAV.t1, roof - BUILDUP, roof);
  // The pavilion: lit glass, a dark roof.
  k.glow(glowRGB, PAV.u0 + 0.1, PAV.u1, PAV.t0, PAV.t0 + 0.1, roof, pavCeil, EMIT.lamp);
  k.glow(glowRGB, PAV.u0, PAV.u0 + 0.1, PAV.t0, PAV.t1, roof, pavCeil, EMIT.lamp);
  k.glow(glowRGB, PAV.u0 + 0.1, PAV.u1, PAV.t1 - 0.1, PAV.t1, roof, pavCeil, EMIT.lamp);
  k.glow(glowRGB, PAV.u1 - 0.1, PAV.u1, PAV.t0, PAV.t1, roof, pavCeil, EMIT.lamp);
  k.box(0x1a1a1c, PAV.u0 + 0.1, PAV.u1 - 0.1, PAV.t0 + 0.1, PAV.t1 - 0.1, roof, pavCeil);
  k.box(0x2a2a2e, PAV.u0 - 0.3, PAV.u1, PAV.t0 - 0.3, PAV.t1, pavCeil, pavCeil + 0.6);
  for (let u = PAV.u0; u <= PAV.u1 + 0.01; u += 2.2) k.box(0x1a1a1c, u - 0.05, u + 0.05, PAV.t0 - 0.05, PAV.t0 + 0.05, roof, pavCeil);
  // The terrace: the pool's glow, loungers, planters, the glass parapet.
  k.lit(0x0c3c48, POOL.u0, POOL.u1, PLATE.t0, POOL.t1, roof - BUILDUP, roof - 0.12);
  k.glow([0.006, 0.035, 0.045], POOL.u0 + 0.1, POOL.u1 - 0.1, PLATE.t0 + 0.1, POOL.t1 - 0.1, roof - 0.12, roof - 0.115, EMIT.lamp);
  for (const q of around([PLATE.u0, PLATE.u1, PLATE.t0, PAV.t0], POOL_CUT)) k.lit(0x8a6a4a, q[0], q[1], q[2], q[3], roof - BUILDUP, roof + 0.02);
  for (const [a, b, c, e] of PLANTERS) {
    k.box(0x3a3834, a, b, c, e, roof, roof + 0.7);
    k.lathe(0x2e5a34, (a + b) / 2, (c + e) / 2, [[roof + 0.7, 0.1], [roof + 1.2, 0.7], [roof + 2.0, 0.6], [roof + 2.6, 0.08]], 8);
  }
  k.glow([1.6, 0.66, 0.22], FIRE_TABLE[0] + 0.35, FIRE_TABLE[1] - 0.35, FIRE_TABLE[2] + 0.85, FIRE_TABLE[3] - 0.85, roof + 0.3, roof + 0.5, EMIT.lamp);
  k.pane(PLATE.u0, PLATE.u1, roof, roof + 1.2, PLATE.t0);
  k.paneT(PLATE.u0, PLATE.t0, PLATE.t1, roof, roof + 1.2);
  k.paneT(PLATE.u1, PLATE.t0, PAV.t0, roof, roof + 1.2);
}

/** Lobby furniture sign for the private elevator. */
export function peakLiftSign(k: Kit, u: number, t: number, y: number): void {
  k.plane(k.canvas(384, 128, (g) => {
    g.fillStyle = '#2a2826';
    g.fillRect(0, 0, 384, 128);
    text(g, 'PRIVATE · PH', 192, 52, "300 44px 'Georgia', serif", '#d8b870');
    text(g, 'ペントハウス専用', 192, 100, "24px 'Yu Gothic', sans-serif", '#b8a070');
  }), 1.5, 0.5, u, t, y, 'out', 1.0);
}
