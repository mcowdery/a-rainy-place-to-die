import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { WIN } from './buildings';
import { addCar } from './cars';
import { Draw, type C3 } from './interiorDraw';
import type { Interior } from './interiors';
import { Kit, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toLocal, toWorld } from './localFrame';
import { EMIT } from './meshBuilder';
import { GROUNDS_BUILDERS, groundsColliders, groundsLights, groundsShelters } from './kasumiGrounds';

/**
 * 霞町 Kasumi-chō's set pieces (the whole-city plan: docs/city-plan.md), registered with the kit landmarks
 * (asagiri.ts), in the building's local frame (u along the street face, t inward):
 * - hospital: 霞町総合病院 Kasumi General Hospital on 霞通り Kasumi-dōri, under the monorail (autumn's hospital: the
 *   oyabun's bed upstairs, the sealed floor below). A forecourt with a canopied drop-off, a taxi waiting, the
 *   emergency bay and its ambulance; a two-storey podium with a glass lobby, a nine-storey ward tower with its name
 *   and a green cross on top.
 * - cemetery (霞町霊園, the cemetery avenue) and construction (the redevelopment site): kasumiGrounds.ts.
 *
 * Inside (interiors.ts, `hides: 'shell'`; the elevators are `station` nodes: a fade and you're on the floor):
 *   1F  the lobby: reception, cashier and pharmacy along one counter under the number display, rows of benches
 *       with people waiting, the information desk, the kiosk, vending machines, the floor guide, the elevators.
 *   5F  a ward: the corridor of rooms with their name plates, the nurse station, the day room with its view,
 *       and at the end 501, the private room (a story door).
 *   B1  the basement corridor: the morgue (霊安室), MRI, the plant room, a gurney under a sheet; at its end the
 *       steel door to B2, authorised personnel only (a story door: what's behind it is the story's).
 */
export const KASUMI_KINDS = ['hospital', 'cemetery', 'construction'] as const;
export type KasumiKind = (typeof KASUMI_KINDS)[number];

/** The hospital's plan (local metres): 64 m along Kasumi-dōri, 46 deep, the forecourt in its first 14 m. */
export const HOSP = {
  w: 64,
  d: 46,
  bldg: { u0: 4, u1: 60, t0: 14, t1: 44 },
  lobby: { u0: 14, u1: 50, t0: 14.3, t1: 34 },
  door: [30, 34] as const,
  tower: { u0: 8, u1: 56, t0: 18, t1: 42 },
  podium: 8.4,
  top: 33.6,
  ceil: 3.8,
  ward: 15.6,
  b1: -4.5,
  corridor: [28, 31] as const,
  lifts: [28, 36] as const,
  liftEnd: 34,
} as const;

type R4 = readonly [number, number, number, number];
const { lobby: LB, corridor: CO, lifts: LF, liftEnd: LE } = HOSP;

// ---- The lobby's fittings ----
const COUNTER: R4 = [18, 18.8, 17, 29];
const BENCHES: readonly R4[] = [21.5, 23.5, 25.5, 27.5].map((u) => [u, u + 0.55, 18, 27] as R4);
const INFO: R4 = [35.5, 38, 17, 17.8];
const KIOSK: R4 = [42, 42.6, 15, 22];
const KIOSK_WALL: R4 = [42, LB.u1, 22, 22.3];
const VENDING: R4 = [49.2, LB.u1, 24, 28];
const PLANTS: readonly (readonly [number, number])[] = [[15, 15.2], [28.8, 15.2], [35.2, 15.2], [49, 32.8]];

/** The lobby level: its walls (the doors open), the counter, the benches, the desk, the kiosk, the machines. */
function lobbyRects(): R4[] {
  return [
    [LB.u0, HOSP.door[0], 14, LB.t0],
    [HOSP.door[1], LB.u1, 14, LB.t0],
    [LB.u0 - 0.3, LB.u0, 14, LB.t1],
    [LB.u1, LB.u1 + 0.3, 14, LB.t1],
    [LB.u0, LB.u1, LB.t1, LB.t1 + 0.3],
    COUNTER,
    ...BENCHES,
    INFO,
    KIOSK,
    KIOSK_WALL,
    VENDING,
    ...PLANTS.map(([u, t]) => [u - 0.3, u + 0.3, t - 0.3, t + 0.3] as R4),
  ];
}

// ---- The ward (5F): a corridor along the tower, the lift lobby off it, the nurse station, the day room ----
const WARD = { u0: 9, u1: 55, day: [9, 16, 20, CO[0]] as R4, station: [26, 38] as const };
const DAY_TABLES: readonly R4[] = [[10.5, 11.7, 22, 23.2], [13.3, 14.5, 24.5, 25.7]];
const WARD_CART: R4 = [44, 45.2, 30.3, 30.9];

function liftLobby(): R4[] {
  return [[LF[0] - 0.3, LF[0], CO[1], LE], [LF[1], LF[1] + 0.3, CO[1], LE], [LF[0], LF[1], LE, LE + 0.3]];
}

function wardRects(): R4[] {
  const [du0, du1, dt0] = WARD.day;
  return [
    [du1, WARD.station[0], CO[0] - 0.3, CO[0]],
    [WARD.station[1], WARD.u1, CO[0] - 0.3, CO[0]],
    [WARD.station[0], WARD.station[1], CO[0] - 0.8, CO[0]],
    [du0 - 0.3, du0, dt0, CO[1]],
    [du0, du1, dt0 - 0.3, dt0],
    [du1, du1 + 0.3, dt0, CO[0] - 0.3],
    [WARD.u0, LF[0], CO[1], CO[1] + 0.3],
    [LF[1], WARD.u1, CO[1], CO[1] + 0.3],
    ...liftLobby(),
    [WARD.u1, WARD.u1 + 0.3, CO[0], CO[1]],
    ...DAY_TABLES,
    [du0, du0 + 0.8, 20.3, 22],
    WARD_CART,
  ];
}

// ---- The basement (B1): one corridor, the lift lobby, the sealed door at its west end ----
const B1 = { u0: 14, u1: 50 };
const GURNEY: R4 = [20.6, 22.6, 28.1, 28.9];
const LAUNDRY: readonly R4[] = [[40, 41, 30.1, 30.9], [41.3, 42.3, 30.1, 30.9]];

function b1Rects(): R4[] {
  return [
    [B1.u0, B1.u1, CO[0] - 0.3, CO[0]],
    [B1.u0, LF[0], CO[1], CO[1] + 0.3],
    [LF[1], B1.u1, CO[1], CO[1] + 0.3],
    ...liftLobby(),
    [B1.u0 - 0.3, B1.u0, CO[0], CO[1]],
    [B1.u1, B1.u1 + 0.3, CO[0], CO[1]],
    GURNEY,
    ...LAUNDRY,
  ];
}

export function hospitalLayout(b: Building3): Omit<Interior, 'group'> {
  const f = localFrame(b);
  const W = (rs: readonly R4[]): Rect[] => rs.map((r) => localRect(f, r[0], r[1], r[2], r[3]));
  const lobby = W(lobbyRects());
  const ward = W(wardRects());
  const b1 = W(b1Rects());
  const B = HOSP.bldg;
  return {
    colliders: (floor) => (floor < -2 ? b1 : floor < 8 ? lobby : ward),
    floorAt(x, z, current) {
      const [u, t] = toLocal(f, x, z);
      if (u < B.u0 || u > B.u1 || t < LB.t0 || t > B.t1) return null;
      return current > 8 ? HOSP.ward : current < -2 ? HOSP.b1 : 0;
    },
    contains(x, z, y) {
      const [u, t] = toLocal(f, x, z);
      return y > HOSP.b1 - 1 && y < HOSP.ward + 4 && u > B.u0 + 0.3 && u < B.u1 - 0.3 && t > 14.15 && t < B.t1 - 0.3;
    },
  };
}

/** The forecourt's solids, in local rects: the canopy's columns, the sign pylon, the taxi, the ambulance, the hedges. */
const COLUMNS: readonly (readonly [number, number])[] = [[25, 7], [39, 7], [25, 13.4], [39, 13.4]];
const FORECOURT: readonly R4[] = [
  ...COLUMNS.map(([u, t]) => [u - 0.4, u + 0.4, t - 0.4, t + 0.4] as R4),
  [5.2, 7.6, 1.1, 1.6],
  [27.6, 32.4, 8.6, 10.4],
  [54, 56, 4.2, 9.2],
  [9, 22, 0.6, 1.6],
  [42, 50, 0.6, 1.6],
];

export function kasumiColliders(kind: KasumiKind, b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  switch (kind) {
    case 'hospital': {
      // Solid, but for a pocket at the front doors (the interior takes over past the threshold).
      const B = HOSP.bldg;
      return [R(B.u0, HOSP.door[0], B.t0, B.t1), R(HOSP.door[1], B.u1, B.t0, B.t1), R(HOSP.door[0], HOSP.door[1], B.t0 + 1, B.t1), ...FORECOURT.map((r) => R(r[0], r[1], r[2], r[3]))];
    }
    default:
      return groundsColliders(kind, b);
  }
}

export function kasumiShelters(kind: KasumiKind, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  switch (kind) {
    case 'hospital': {
      const B = HOSP.bldg;
      return [
        { rect: localRect(f, B.u0, B.u1, B.t0, B.t1), y0: HOSP.b1 - 1, y1: HOSP.top, enclosed: true },
        { rect: localRect(f, 24, 40, 6, 14), y0: 0, y1: 4.3, enclosed: false },
        { rect: localRect(f, 51.5, 58.5, 10.5, 14), y0: 0, y1: 3, enclosed: false },
      ];
    }
    default:
      return groundsShelters(kind, b);
  }
}

export function kasumiLights(kind: KasumiKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  switch (kind) {
    case 'hospital':
      return [L(32, 10, 12, [0.95, 0.98, 1.0], 0.9), L(22, 12, 8, [0.95, 0.98, 1.0], 0.5), L(42, 12, 8, [0.95, 0.98, 1.0], 0.5), L(55, 9, 6, [1.0, 0.3, 0.25], 0.5), L(6.4, 0.6, 5, [0.6, 1.0, 0.8], 0.4)];
    default:
      return groundsLights(kind, b);
  }
}

const SANS = "'Yu Gothic', 'Meiryo', sans-serif";
const TILE = 0xe6e2d8;
const TOWER = 0xefece4;
const GREEN = '#0e5a4a';

/** A green cross (not the red one): the hospital's mark. */
function cross(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string): void {
  g.fillStyle = fill;
  g.fillRect(x - s * 0.16, y - s * 0.5, s * 0.32, s);
  g.fillRect(x - s * 0.5, y - s * 0.16, s, s * 0.32);
}

function car(k: Kit, u: number, t: number, du: number, dt: number, type: 'taxi' | 'van', paint: number | undefined, variant: number): void {
  const [x, z] = toWorld(k.f, u, t);
  addCar(k.mb, { x, z, fx: k.f.r[0] * du - k.f.n[0] * dt, fz: k.f.r[2] * du - k.f.n[2] * dt, variant, type, ...(paint === undefined ? {} : { paint }) });
}

export const KASUMI_BUILDERS: Record<KasumiKind, (k: Kit, id: string, part: (name: string) => Kit) => void> = {
  ...GROUNDS_BUILDERS,
  hospital(k, _id, part) {
    const s = part('shell');
    const B = HOSP.bldg;
    const T = HOSP.tower;
    // ---- The podium: two wings in tile with ribbon windows, the glass lobby between them under an upper band ----
    s.facade(TILE, [3.0, 0.55, 1.6, WIN.ribbon], 2 * 16, B.u0, LB.u0, B.t0, B.t1, 0, HOSP.podium, false);
    s.facade(TILE, [3.0, 0.55, 1.6, WIN.ribbon], 2 * 16, LB.u1, B.u1, B.t0, B.t1, 0, HOSP.podium, false);
    s.facade(TILE, [3.0, 0.55, 1.6, WIN.ribbon], 3 * 16, LB.u0, LB.u1, B.t0, B.t1, 4.0, HOSP.podium, false);
    s.box(0x8a8e94, LB.u0, LB.u1, B.t0, B.t0 + 0.3, 3.2, 4.0);
    for (let u = LB.u0; u <= LB.u1; u += 4) if (u < HOSP.door[0] - 1 || u > HOSP.door[1] + 1 || u === LB.u0 || u === LB.u1) s.box(0x8a8e94, u - 0.06, u + 0.06, B.t0 + 0.05, B.t0 + 0.25, 0, 3.2);
    for (const u of HOSP.door) s.box(0x8a8e94, u - 0.08, u + 0.08, B.t0, B.t0 + 0.3, 0, 3.2);
    s.pane(LB.u0, HOSP.door[0], 0, 3.2, B.t0 + 0.12);
    s.pane(HOSP.door[1], LB.u1, 0, 3.2, B.t0 + 0.12);
    // The lobby seen through the glass: a lit floor and back wall, the benches and the counter as shapes.
    s.lit(0xd8d4c8, LB.u0, LB.u1, B.t0 + 0.3, 22, 0, 0.02, true);
    s.lit(0xe8e4da, LB.u0, LB.u1, 21.9, 22, 0, 4.0, true);
    s.lit(0xf2f0ea, LB.u0, LB.u1, B.t0 + 0.3, 22, 3.95, 4.0, true, true);
    for (let u = LB.u0 + 3; u < LB.u1; u += 6) s.glow([1.6, 1.65, 1.7], u - 0.6, u + 0.6, 17.4, 18.6, 3.92, 3.95);
    s.lit(0xf0ece2, 18, 18.8, 17, 22, 0, 1.05, true);
    for (const r of BENCHES) s.lit(0x6a8a9a, r[0], r[1], 18, 22, 0.2, 0.85, true);
    s.box(TILE, LB.u0, LB.u1, 22, B.t1, 0, 4.0);
    // ---- The ward tower: nine storeys of ribbon windows, lit by floors at night; the parapet, the plant on top ----
    s.facade(TOWER, [3.2, 0.62, 1.5, WIN.ribbon], 3 * 16, T.u0, T.u1, T.t0, T.t1, HOSP.podium, HOSP.top, false);
    s.box(0x6a6e72, T.u0 - 0.1, T.u1 + 0.1, T.t0 - 0.1, T.t1 + 0.1, HOSP.top, HOSP.top + 0.9);
    s.box(0x8a8e94, 26, 38, 26, 36, HOSP.top + 0.9, HOSP.top + 4.2);
    s.glow([1.6, 0.1, 0.1], 31.8, 32.2, 30.8, 31.2, HOSP.top + 4.2, HOSP.top + 4.5, EMIT.lamp);
    for (const u of [12, 18, 46, 52]) s.box(0xc8c8c4, u - 1, u + 1, 28, 31, HOSP.top + 0.9, HOSP.top + 2.2);
    // The podium's roof: gravel grey, a parapet.
    s.box(0x6a6e72, B.u0 - 0.1, B.u1 + 0.1, B.t0 - 0.1, B.t0 + 0.2, HOSP.podium, HOSP.podium + 0.6);
    // ---- The emergency entrance on the east wing: steel doors under its own canopy, the red sign ----
    s.box(0xc8ccd0, 53, 57, B.t0 - 0.06, B.t0, 0, 2.6);
    s.box(0x5a5e64, 54.96, 55.04, B.t0 - 0.08, B.t0, 0, 2.6);
    s.box(0xe8e8e4, 51.5, 58.5, 10.5, B.t0, 3.0, 3.35);
    s.box(0xc81818, 51.5, 58.5, 10.45, 10.5, 3.0, 3.35);
    for (const u of [52, 58]) s.post(0x8a8e94, u, 10.9, 0, 3.0, 0.1, 8);

    // ---- The forecourt (it stays while you're inside): the canopy over the drop-off, the taxi, the pylon sign,
    // the ambulance in the emergency bay, hedges along the pavement, people ----
    for (const [u, t] of COLUMNS) k.post(0xd8d8d4, u, t, 0, 4.3, 0.28, 12);
    k.box(0xe8e8e4, 24, 40, 6, B.t0, 4.3, 4.75);
    k.lit(0xf4f4f0, 24.2, 39.8, 6.2, B.t0, 4.28, 4.3, false, true);
    for (const u of [27, 32, 37]) for (const t of [8, 12]) k.glow([1.7, 1.75, 1.8], u - 0.25, u + 0.25, t - 0.25, t + 0.25, 4.26, 4.28, EMIT.lamp);
    k.plane(k.canvas(1024, 44, (g) => {
      g.fillStyle = '#e8e8e4';
      g.fillRect(0, 0, 1024, 44);
      cross(g, 250, 22, 30, GREEN);
      text(g, '霞町総合病院   正面玄関  MAIN ENTRANCE', 560, 24, `bold 28px ${SANS}`, GREEN);
    }), 10.4, 0.44, 32, 5.98, 4.52, 'out', 1.0);
    // The name across the top of the tower, lit at night.
    k.plane(k.canvas(1280, 128, (g) => {
      g.fillStyle = GREEN;
      g.fillRect(0, 0, 1280, 128);
      cross(g, 110, 64, 84, '#ffffff');
      text(g, '霞町総合病院', 500, 66, `900 88px ${SANS}`, '#ffffff');
      text(g, 'KASUMI GENERAL HOSPITAL', 1000, 68, 'bold 34px Arial, sans-serif', '#ffffff');
    }), 24, 2.4, 32, T.t0 - 0.03, HOSP.top - 1.5, 'out', 1.2, true);
    // The pylon at the pavement.
    k.box(0x0e5a4a, 5.2, 7.6, 1.2, 1.5, 0, 4.4);
    for (const [t, facing] of [[1.19, 'out'], [1.51, 'in']] as const) {
      k.plane(k.canvas(300, 540, (g) => {
        g.fillStyle = GREEN;
        g.fillRect(0, 0, 300, 540);
        cross(g, 150, 70, 90, '#ffffff');
        text(g, '霞町総合病院', 150, 160, `900 40px ${SANS}`, '#ffffff');
        text(g, 'KASUMI GENERAL HOSPITAL', 150, 200, 'bold 17px Arial, sans-serif', '#ffffff');
        g.fillStyle = '#c81818';
        g.fillRect(20, 240, 260, 70);
        text(g, '救急 24時間', 150, 276, `900 38px ${SANS}`, '#ffffff');
        text(g, '外来受付 8:30〜11:30', 150, 360, `bold 26px ${SANS}`, '#ffffff');
        text(g, '面会 14:00〜20:00', 150, 410, `bold 26px ${SANS}`, '#ffffff');
        text(g, 'P 駐車場 →', 150, 480, `900 34px ${SANS}`, '#ffe45f');
      }), 2.3, 4.14, 6.4, t, 2.25, facing, 1.15, true);
    }
    // The emergency sign (red, lit), the ambulance backed up to the doors with its lights on.
    k.plane(k.canvas(640, 80, (g) => {
      g.fillStyle = '#c81818';
      g.fillRect(0, 0, 640, 80);
      text(g, '救急入口  EMERGENCY', 320, 42, `900 46px ${SANS}`, '#ffffff');
    }), 5.6, 0.7, 55, 10.42, 3.9, 'out', 1.3, true);
    car(k, 55, 6.7, 0, -1, 'van', 0xf4f4f0, 71);
    k.glow([1.8, 0.12, 0.1], 54.45, 55.55, 5.7, 5.95, 1.98, 2.1, EMIT.always);
    k.box(0xc81818, 53.98, 54.02, 4.9, 8.6, 1.0, 1.14);
    k.box(0xc81818, 55.98, 56.02, 4.9, 8.6, 1.0, 1.14);
    car(k, 30, 9.5, 1, 0, 'taxi', undefined, 12);
    for (const [u0, u1] of [[9, 22], [42, 50]] as const) {
      k.box(0x8a847a, u0, u1, 0.6, 1.6, 0, 0.3);
      k.box(0x2f4f2c, u0 + 0.1, u1 - 0.1, 0.7, 1.5, 0.3, 0.85);
    }
    for (const u of [23.4, 40.6]) k.post(0x5a5e64, u, 5.4, 0, 0.9, 0.08, 8);
    // People: a visitor with flowers going in, an old man waiting for his taxi, someone on the phone by the doors.
    k.person(33.5, 11.5, -0.2, 1, { body: 'woman', pose: 'hold', outfit: 'long', hair: 'long', long: true, color: [0.3, 0.26, 0.3] });
    k.person(27.2, 11.8, 0.4, -1, { body: 'elder', pose: 'stand', outfit: 'plain', hair: 'none', color: [0.3, 0.3, 0.28] });
    k.person(36.6, 13.2, -1, -0.4, { body: 'man', pose: 'phone', outfit: 'suit', hair: 'short', color: [0.14, 0.14, 0.18] });
  },
};

/** A door in a corridor wall: a slab proud of the wall at t (facing ±t by `side`), its number plate, a lamp over it. */
function roomDoor(k: Kit, d: Draw, u: number, t: number, side: 1 | -1, y: number, label: string, hex = 0xd8c8b0): void {
  const a = side > 0 ? t : t - 0.04;
  d.W(hex, u - 0.6, u + 0.6, a, a + 0.04, y, y + 2.1);
  d.W(0x8a8e94, u + 0.42, u + 0.46, a - 0.02, a + 0.06, y + 0.95, y + 1.1);
  k.plane(k.canvas(128, 64, (g) => {
    g.fillStyle = '#f4f4ee';
    g.fillRect(0, 0, 128, 64);
    text(g, label, 64, 34, `bold ${label.length > 4 ? 22 : 34}px ${SANS}`, '#1a3a5a');
  }), 0.36, 0.18, u + 0.95, side > 0 ? t + 0.045 : t - 0.045, y + 1.6, side > 0 ? 'in' : 'out', 1.0);
}

/** A pair of elevator doors in the wall at the back of a lift lobby, with the floor shown over each. */
function elevators(k: Kit, d: Draw, y: number, here: string): void {
  for (const u of [30, 34]) {
    d.W(0x6a6e72, u - 1.1, u + 1.1, LE - 0.06, LE, y, y + 2.4);
    d.W(0xb8bcc0, u - 0.95, u - 0.02, LE - 0.09, LE - 0.06, y, y + 2.2);
    d.W(0xb8bcc0, u + 0.02, u + 0.95, LE - 0.09, LE - 0.06, y, y + 2.2);
    d.glow([1.6, 0.9, 0.2], u - 0.2, u + 0.2, LE - 0.08, LE - 0.06, y + 2.26, y + 2.36);
    d.glow([0.3, 1.2, 0.4], u + 1.2, u + 1.26, LE - 0.04, LE - 0.02, y + 1.1, y + 1.2);
  }
  k.plane(k.canvas(256, 96, (g) => {
    g.fillStyle = '#1a3a5a';
    g.fillRect(0, 0, 256, 96);
    text(g, `エレベーター  ${here}`, 128, 50, `bold 30px ${SANS}`, '#ffffff');
  }), 1.2, 0.45, 32, LE - 0.05, y + 2.65, 'out', 1.0);
}

/** The interior, built a slice at a time: the lobby, the ward, the basement. */
export function* hospitalInterior(b: Building3, city: THREE.Material, ghost: THREE.Material): Generator<void, Interior> {
  const k = new Kit(b);
  const d = new Draw(k);
  const WALL = 0xe8e4da;
  const CEIL = HOSP.ceil;

  // ---- 1F, the lobby: the shell (floor, walls, the glass front, the ceiling's lights) ----
  d.W(0xd8d4c8, LB.u0, LB.u1, 14, LB.t1, 0, 0.02);
  d.W(0xf2f0ea, LB.u0, LB.u1, 14, LB.t1, CEIL, CEIL + 0.1, true);
  d.W(WALL, LB.u0 - 0.3, LB.u0, 14, LB.t1, 0, CEIL);
  d.W(WALL, LB.u1, LB.u1 + 0.3, 14, LB.t1, 0, CEIL);
  d.W(WALL, LB.u0, LB.u1, LB.t1, LB.t1 + 0.3, 0, CEIL);
  d.W(0x8a8e94, LB.u0, LB.u1, 14, LB.t0, 3.2, CEIL);
  for (let u = LB.u0; u <= LB.u1; u += 4) if (u < HOSP.door[0] - 1 || u > HOSP.door[1] + 1) d.W(0x8a8e94, u - 0.06, u + 0.06, 14.05, 14.25, 0, 3.2);
  for (const u of HOSP.door) d.W(0x8a8e94, u - 0.08, u + 0.08, 14, LB.t0, 0, 3.2);
  k.pane(LB.u0, HOSP.door[0], 0, 3.2, 14.12);
  k.pane(HOSP.door[1], LB.u1, 0, 3.2, 14.12);
  for (let u = LB.u0 + 3; u < LB.u1; u += 6) for (let t = 17; t < LB.t1; t += 5) d.glow([1.6, 1.65, 1.7], u - 0.6, u + 0.6, t - 0.6, t + 0.6, CEIL - 0.03, CEIL);
  // A guide line on the floor from the doors to the elevators.
  d.W(0x3a8a6a, 31.9, 32.1, 14.4, LB.t1 - 0.4, 0.02, 0.025);
  // ---- The counter: reception, cashier, pharmacy, their signs overhead and the number being called ----
  d.W(0xf0ece2, COUNTER[0], COUNTER[1], COUNTER[2], COUNTER[3], 0, 1.05);
  d.W(0x9a7a5a, COUNTER[0] - 0.02, COUNTER[1] + 0.06, COUNTER[2] - 0.05, COUNTER[3] + 0.05, 1.05, 1.1);
  d.W(WALL, COUNTER[0], COUNTER[1], COUNTER[2], COUNTER[3], 2.9, CEIL);
  const desks: [string, string, string][] = [['① 総合受付', 'RECEPTION', '#1a5a8a'], ['② 会計', 'CASHIER', '#8a5a1a'], ['③ お薬', 'PHARMACY', '#0e5a4a']];
  desks.forEach(([jp, en, bg], i) => {
    const t = 19 + i * 4;
    k.plane(k.canvas(512, 128, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, 512, 128);
      text(g, jp, 256, 50, `900 56px ${SANS}`, '#ffffff');
      text(g, en, 256, 104, 'bold 26px Arial, sans-serif', '#ffffff');
    }), 2.6, 0.65, COUNTER[1] + 0.02, t, 3.3, '+u', 1.1);
    d.W(0x2a2a2e, COUNTER[0] + 0.1, COUNTER[0] + 0.5, t - 0.3, t + 0.3, 1.1, 1.5);
    // (The receptionist at the first desk is the story's npc.)
    if (i > 0) k.person(17.2, t, 1, 0, { y: -0.13, body: i === 1 ? 'man' : 'woman', pose: 'stand', outfit: 'plain', hair: i === 1 ? 'short' : 'bun', color: [0.5, 0.52, 0.56] });
  });
  k.plane(k.canvas(384, 128, (g) => {
    g.fillStyle = '#0a0a0c';
    g.fillRect(0, 0, 384, 128);
    text(g, '受付番号', 100, 64, `bold 34px ${SANS}`, '#ff5a3a');
    text(g, '147', 280, 68, '900 84px Consolas, monospace', '#ff5a3a');
  }), 1.6, 0.53, COUNTER[1] + 0.02, 21, 2.45, '+u', 1.3);
  for (let t = 14.6; t < 33.5; t += 1.3) d.W(0xc8c4b8, LB.u0, LB.u0 + 0.45, t, t + 1.1, 0, 2.0);
  yield;

  // ---- The waiting benches (blue-grey vinyl, in rows facing the counter) and who's on them ----
  const WAIT: [number, number, 'man' | 'woman' | 'elder' | 'child', 'short' | 'long' | 'bun' | 'none'][] = [
    [0, 19, 'elder', 'none'], [0, 23.2, 'woman', 'long'], [0, 24, 'child', 'short'], [1, 20.4, 'man', 'short'], [1, 25.6, 'elder', 'bun'],
    [2, 18.6, 'woman', 'bun'], [2, 22.4, 'elder', 'short'], [3, 21.2, 'man', 'short'], [3, 26.2, 'woman', 'long'],
  ];
  BENCHES.forEach((r, i) => {
    d.W(0x6a8a9a, r[0], r[1], r[2], r[3], 0.38, 0.46);
    d.W(0x6a8a9a, r[1] - 0.06, r[1], r[2], r[3], 0.46, 0.88);
    for (let t = r[2] + 0.3; t < r[3]; t += 1.7) d.W(0x6a6e72, r[0] + 0.2, r[0] + 0.3, t, t + 0.06, 0, 0.38);
    for (const [bi, t, body, hair] of WAIT) if (bi === i) k.person(r[0] + 0.24, t, -1, 0, { y: -0.13, body, pose: 'sit', outfit: body === 'man' ? 'suit' : 'plain', hair, long: body === 'woman', color: [0.24 + 0.03 * (t % 3), 0.24, 0.28] });
  });
  // ---- The information desk by the doors, the kiosk, the vending machines, the plants, the floor guide ----
  d.W(0xfdfdfa, INFO[0], INFO[1], INFO[2], INFO[3], 0, 1.05);
  d.W(0x3a8a6a, INFO[0], INFO[1], INFO[2] - 0.02, INFO[2], 0.6, 1.0);
  k.plane(k.canvas(384, 96, (g) => {
    g.fillStyle = '#3a8a6a';
    g.fillRect(0, 0, 384, 96);
    text(g, '総合案内  INFORMATION', 192, 50, `bold 30px ${SANS}`, '#ffffff');
  }), 2.2, 0.55, (INFO[0] + INFO[1]) / 2, INFO[2] - 0.03, 0.8, 'out', 1.0);
  k.person(36.7, 18.5, 0, -1, { y: -0.13, body: 'woman', pose: 'stand', outfit: 'plain', hair: 'bun', color: [0.5, 0.52, 0.56] });
  d.W(0xe8dcc0, KIOSK[0], KIOSK[1], KIOSK[2], KIOSK[3], 0, 0.95);
  d.W(WALL, KIOSK_WALL[0], KIOSK_WALL[1], KIOSK_WALL[2], KIOSK_WALL[3], 0, CEIL);
  d.W(WALL, KIOSK[0], KIOSK[1], KIOSK[2], KIOSK[3], 2.7, CEIL);
  k.plane(k.canvas(512, 112, (g) => {
    g.fillStyle = '#e8762a';
    g.fillRect(0, 0, 512, 112);
    text(g, '売店  KIOSK', 256, 58, `900 60px ${SANS}`, '#ffffff');
  }), 3.4, 0.74, KIOSK[0] - 0.02, 18.5, 3.2, '-u', 1.1);
  for (let y = 0.4; y < 2.4; y += 0.5) {
    d.W(0xc8c4b8, LB.u1 - 0.5, LB.u1, 15, 21.8, y, y + 0.03);
    for (let t = 15.1, i = Math.round(y * 6); t < 21.6; t += 0.34, i++) d.W([0xd84a3a, 0x3a7ad8, 0xe8c83a, 0x4aa85a, 0xf0f0e8][i % 5], LB.u1 - 0.42, LB.u1 - 0.12, t, t + 0.26, y + 0.03, y + 0.3);
  }
  for (let t = 15.4; t < 21.6; t += 1.0) d.W([0xe8c83a, 0xd84a3a, 0xf0f0e8][Math.round(t) % 3], KIOSK[0] + 0.1, KIOSK[1] - 0.1, t, t + 0.5, 0.95, 1.12);
  k.person(43.4, 18.4, -1, 0, { y: -0.13, body: 'woman', pose: 'stand', outfit: 'plain', hair: 'short', color: [0.5, 0.4, 0.3] });
  const machines: [number, number, C3][] = [[24, 0xe8e8ec, [0.9, 1.2, 1.5]], [26, 0xc82a2a, [1.5, 1.2, 1.0]]];
  for (const [t0, hex, rgb] of machines) {
    d.W(hex, VENDING[0], VENDING[1], t0 + 0.1, t0 + 1.9, 0, 1.9);
    d.glow(rgb, VENDING[0] - 0.01, VENDING[0], t0 + 0.2, t0 + 1.8, 0.75, 1.75);
  }
  for (const [u, t] of PLANTS) {
    d.lathe(0x8a6a4a, u, t, [[0, 0.22], [0.5, 0.27], [0.5, 0.001]], 10);
    d.ball(0x3a6a3a, u, t, 0.55, 0.38);
    d.ball(0x467a42, u + 0.1, t - 0.05, 1.0, 0.28);
  }
  k.plane(k.canvas(420, 520, (g) => {
    g.fillStyle = '#fdfdf8';
    g.fillRect(0, 0, 420, 520);
    g.fillStyle = '#1a3a5a';
    g.fillRect(0, 0, 420, 70);
    text(g, '院内案内  FLOOR GUIDE', 210, 38, `bold 30px ${SANS}`, '#ffffff');
    const rows = ['6F〜9F  病棟', '5F  病棟・特別室', '4F  手術室・ICU', '3F  検査・リハビリ', '2F  外来 内科 外科 整形外科', '1F  総合受付・会計・薬局・売店', 'B1  放射線・霊安室'];
    rows.forEach((r, i) => text(g, r, 24, 112 + i * 58, `bold 26px ${SANS}`, i === 5 ? '#c81818' : '#1a1a1a', 'left'));
  }), 1.6, 2.0, LB.u1 - 0.02, 30.4, 1.7, '-u', 1.0);
  // The back wall: the elevators, the way to the clinics (closed after hours), the toilets.
  elevators(k, d, 0, '1F');
  d.W(0xc8d0d4, 44, 47.4, LB.t1 - 0.05, LB.t1, 0, 2.3);
  k.plane(k.canvas(512, 96, (g) => {
    g.fillStyle = '#1a5a8a';
    g.fillRect(0, 0, 512, 96);
    text(g, '外来 → 内科 外科 整形外科', 256, 50, `bold 34px ${SANS}`, '#ffffff');
  }), 3.2, 0.6, 45.7, LB.t1 - 0.02, 2.75, 'out', 1.0);
  k.plane(k.canvas(384, 96, (g) => {
    g.fillStyle = '#5a5e64';
    g.fillRect(0, 0, 384, 96);
    text(g, '← お手洗い  階段', 192, 50, `bold 34px ${SANS}`, '#ffffff');
  }), 2.4, 0.6, 23, LB.t1 - 0.02, 2.75, 'out', 1.0);
  yield;

  // ---- 5F, the ward: the corridor (a handrail down both walls, doors with their numbers), the lift lobby ----
  const wy = HOSP.ward;
  const wc = wy + 2.8;
  const PALE = 0xe6ebe4;
  d.W(0xd0d4cc, WARD.u0, WARD.u1, CO[0], CO[1], wy - 0.2, wy);
  d.W(0xd0d4cc, LF[0], LF[1], CO[1], LE, wy - 0.2, wy);
  d.W(0xc8a878, WARD.day[0], WARD.day[1], WARD.day[2], CO[0], wy - 0.2, wy);
  d.W(0xd0d4cc, WARD.station[0], WARD.station[1], 23.5, CO[0], wy - 0.2, wy);
  d.W(0xf2f2ee, WARD.u0 - 0.3, WARD.u1 + 0.3, 19.7, LE + 0.3, wc, wc + 0.1, true);
  const wall = (r: R4, y0: number, y1: number, hex: number): void => d.W(hex, r[0], r[1], r[2], r[3], y0, y1);
  // (The first twelve rects are the walls; the nurse station's counter and the day room's window wall are drawn below.)
  wardRects().slice(0, 12).forEach((r, i) => {
    if (i !== 2 && i !== 3) wall(r, wy, wc, PALE);
  });
  d.W(PALE, WARD.u0 - 0.3, WARD.u0, CO[0] - 0.3, CO[1], wy, wc);
  for (const [a, b2, t] of [[WARD.day[1] + 0.3, WARD.station[0], CO[0]], [WARD.station[1], WARD.u1, CO[0]], [WARD.u0, LF[0], CO[1] - 0.06], [LF[1], WARD.u1, CO[1] - 0.06]] as const) d.W(0x9a7a5a, a, b2, t, t + 0.06, wy + 0.82, wy + 0.9);
  for (let u = WARD.u0 + 3; u < WARD.u1; u += 6) d.glow([1.5, 1.55, 1.5], u - 0.6, u + 0.6, 29.2, 29.8, wc - 0.03, wc);
  let room = 502;
  for (const u of [19, 23, 41, 45, 49, 53]) roomDoor(k, d, u, CO[0], 1, wy, String(room++));
  for (const u of [12, 16, 20, 24, 39, 43, 47, 51]) roomDoor(k, d, u, CO[1], -1, wy, String(room++));
  elevators(k, d, wy, '5F');
  // 501, the private room, at the corridor's end: a darker door, its plate, a stand of flowers by it.
  d.W(0x5a3a26, WARD.u1 - 0.04, WARD.u1, 28.8, 30.2, wy, wy + 2.2);
  k.plane(k.canvas(256, 96, (g) => {
    g.fillStyle = '#f4f0e4';
    g.fillRect(0, 0, 256, 96);
    text(g, '501  特別室', 128, 36, `bold 34px ${SANS}`, '#3a2a1a');
    text(g, '面会謝絶', 128, 76, `bold 24px ${SANS}`, '#c81818');
  }), 0.6, 0.22, WARD.u1 - 0.05, 29.5, wy + 2.4, '-u', 1.0);
  d.lathe(0xe8e4d8, 54.4, 28.4, [[wy, 0.16], [wy + 0.7, 0.05], [wy + 0.75, 0.2], [wy + 0.76, 0.001]], 10);
  d.ball(0xf4f0e8, 54.4, 28.4, wy + 0.78, 0.2);
  d.ball(0xe8c8d8, 54.3, 28.5, wy + 0.95, 0.12);
  // The medicine cart and an IV stand left in the corridor.
  d.W(0xd8dce0, WARD_CART[0], WARD_CART[1], WARD_CART[2], WARD_CART[3], wy + 0.15, wy + 0.95);
  d.W(0xc8ccd0, 40, 40.03, 30.6, 30.63, wy, wy + 1.8);
  d.W(0xf0f0f4, 39.92, 40.1, 30.56, 30.68, wy + 1.5, wy + 1.75);
  yield;

  // ---- The nurse station (a counter on the corridor, monitors, the chart shelves) and the day room ----
  const [s0, s1] = WARD.station;
  d.W(0xfdfdfa, s0, s1, CO[0] - 0.8, CO[0], wy, wy + 1.05);
  d.W(0x8ab8a8, s0, s1, CO[0] - 0.02, CO[0], wy + 0.6, wy + 1.0);
  d.W(PALE, s0 - 0.3, s0, 23.5, CO[0] - 0.8, wy, wc);
  d.W(PALE, s1, s1 + 0.3, 23.5, CO[0] - 0.8, wy, wc);
  d.W(PALE, s0, s1, 23.2, 23.5, wy, wc);
  k.plane(k.canvas(640, 96, (g) => {
    g.fillStyle = '#8ab8a8';
    g.fillRect(0, 0, 640, 96);
    text(g, 'ナースステーション  NURSE STATION', 320, 50, `bold 34px ${SANS}`, '#ffffff');
  }), 4.6, 0.7, (s0 + s1) / 2, CO[0] - 0.02, wy + 2.4, 'in', 1.05);
  for (const u of [28.5, 32, 35.5]) {
    d.W(0xd8d8d4, u - 0.8, u + 0.8, 24.6, 25.4, wy + 0.7, wy + 0.74);
    d.W(0x2a2a2e, u - 0.3, u + 0.3, 24.7, 24.78, wy + 0.74, wy + 1.15);
    d.glow([0.4, 0.9, 0.6], u - 0.27, u + 0.27, 24.79, 24.8, wy + 0.78, wy + 1.12);
  }
  for (let u = s0 + 0.4, i = 0; u < s1 - 0.4; u += 0.14, i++) d.W([0x3a7ad8, 0xd84a3a, 0xe8c83a, 0x4aa85a][i % 4], u, u + 0.1, 23.5, 23.75, wy + 1.2, wy + 1.55);
  k.person(29.4, 26.0, 0.3, 1, { y: wy - 0.15, body: 'woman', pose: 'stand', outfit: 'plain', hair: 'bun', color: [0.55, 0.56, 0.6] });
  k.person(35.5, 25.9, 0, -1, { y: wy - 0.15, body: 'woman', pose: 'sit', outfit: 'plain', hair: 'short', color: [0.55, 0.56, 0.6] });
  // The day room: tables, the TV, a bookshelf, a drinks machine; a window over Kasumi-chō.
  const [du0, du1, dt0] = WARD.day;
  d.W(PALE, du0 - 0.3, du0, dt0, CO[0] - 0.3, wy, wy + 0.9);
  d.W(PALE, du0 - 0.3, du0, dt0, CO[0] - 0.3, wy + 2.4, wc);
  d.W(PALE, du0 - 0.3, du0, dt0, dt0 + 0.3, wy + 0.9, wy + 2.4);
  k.paneT(du0 - 0.15, dt0 + 0.3, CO[0] - 0.3, wy + 0.9, wy + 2.4);
  for (const r of DAY_TABLES) {
    d.W(0xf0ece2, r[0], r[1], r[2], r[3], wy + 0.68, wy + 0.72);
    d.W(0x8a8e94, (r[0] + r[1]) / 2 - 0.04, (r[0] + r[1]) / 2 + 0.04, (r[2] + r[3]) / 2 - 0.04, (r[2] + r[3]) / 2 + 0.04, wy, wy + 0.68);
    for (const side of [-1, 1]) {
      const tc = (r[2] + r[3]) / 2 + side * 0.95;
      d.W(0x6a8a9a, (r[0] + r[1]) / 2 - 0.22, (r[0] + r[1]) / 2 + 0.22, tc - 0.22, tc + 0.22, wy + 0.4, wy + 0.46);
    }
  }
  k.person(11.1, 21.65, 0, 1, { y: wy - 0.15, body: 'elder', pose: 'sit', outfit: 'plain', hair: 'none', color: [0.5, 0.56, 0.6] });
  k.person(13.9, 26.05, 0, -1, { y: wy - 0.15, body: 'elder', pose: 'sit', outfit: 'plain', hair: 'bun', color: [0.56, 0.5, 0.56] });
  k.person(13.9, 24.15, 0, 1, { y: wy - 0.15, body: 'woman', pose: 'sit', outfit: 'long', hair: 'long', long: true, color: [0.26, 0.24, 0.3] });
  d.W(0xe8e8ec, du0, du0 + 0.8, 20.3, 22, wy, wy + 1.9);
  d.glow([0.9, 1.2, 1.5], du0 + 0.8, du0 + 0.81, 20.4, 21.9, wy + 0.75, wy + 1.75);
  d.W(0x1a1a1c, 11.5, 13.5, dt0, dt0 + 0.08, wy + 1.4, wy + 2.4);
  d.glow([0.5, 0.6, 0.75], 11.6, 13.4, dt0 + 0.08, dt0 + 0.09, wy + 1.46, wy + 2.34);
  for (let y = wy + 0.3; y < wy + 1.6; y += 0.4) {
    d.W(0x9a7a5a, du1 - 0.35, du1, 20.6, 23, y, y + 0.03);
    for (let t = 20.7, i = 0; t < 22.9; t += 0.09, i++) d.W([0x8a3a2a, 0x2a4a7a, 0xc8a84a, 0x3a6a4a, 0xd8d4c8][i % 5], du1 - 0.3, du1 - 0.08, t, t + 0.07, y + 0.03, y + 0.3);
  }
  yield;

  // ---- B1: a long corridor under pipes, the doors (the morgue, MRI, plant, linen), a gurney under a sheet;
  // at its west end the steel door to B2 ----
  const by = HOSP.b1;
  const bc = by + 2.6;
  const GREENISH = 0x9aa398;
  d.W(0x6a7a70, B1.u0, B1.u1, CO[0], CO[1], by - 0.2, by);
  d.W(0x6a7a70, LF[0], LF[1], CO[1], LE, by - 0.2, by);
  d.W(0xc8b84a, B1.u0, B1.u1, 29.45, 29.55, by, by + 0.005);
  d.W(0x8a8e88, B1.u0 - 0.3, B1.u1 + 0.3, CO[0] - 0.3, LE + 0.3, bc, bc + 0.1, true);
  for (const r of b1Rects().slice(0, 8)) wall(r, by, bc, GREENISH);
  // Pipes and ducts along the ceiling; tubes, one of them nearly dead.
  for (const [t, r, hex] of [[28.3, 0.07, 0x7a7e78], [28.55, 0.05, 0x8a4a3a], [30.6, 0.12, 0x9a9e98]] as const) d.W(hex, B1.u0, B1.u1, t - r, t + r, bc - 0.1 - 2 * r, bc - 0.1);
  for (let u = B1.u0 + 4, i = 0; u < B1.u1; u += 7, i++) d.glow(i === 1 ? [0.25, 0.3, 0.25] : [0.85, 1.0, 0.85], u - 0.6, u + 0.6, 29.4, 29.52, bc - 0.05, bc - 0.02);
  roomDoor(k, d, 19, CO[0], 1, by, '霊安室', 0x8a9098);
  roomDoor(k, d, 20.2, CO[0], 1, by, '', 0x8a9098);
  roomDoor(k, d, 26, CO[0], 1, by, '解剖室', 0x8a9098);
  roomDoor(k, d, 41, CO[0], 1, by, 'MRI', 0x8a9098);
  roomDoor(k, d, 16.5, CO[1], -1, by, '機械室', 0x8a9098);
  roomDoor(k, d, 44.5, CO[1], -1, by, 'リネン', 0x8a9098);
  k.plane(k.canvas(256, 256, (g) => {
    g.fillStyle = '#f0c820';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#1a1a1a';
    g.beginPath();
    g.moveTo(128, 30);
    g.lineTo(226, 196);
    g.lineTo(30, 196);
    g.fill();
    text(g, '!', 128, 140, '900 110px Arial, sans-serif', '#f0c820');
    text(g, '強磁場 注意', 128, 228, `900 30px ${SANS}`, '#1a1a1a');
  }), 0.5, 0.5, 42.6, CO[0] + 0.045, by + 1.5, 'in', 1.0);
  elevators(k, d, by, 'B1');
  // The gurney: a frame, a mattress, a sheet over what's on it.
  d.W(0x9a9ea2, GURNEY[0], GURNEY[1], GURNEY[2], GURNEY[3], by + 0.55, by + 0.62);
  d.W(0xe8e8e4, GURNEY[0] + 0.05, GURNEY[1] - 0.05, GURNEY[2] + 0.05, GURNEY[3] - 0.05, by + 0.62, by + 0.86);
  d.W(0xf2f2ee, GURNEY[0] + 0.3, GURNEY[1] - 0.2, GURNEY[2] + 0.18, GURNEY[3] - 0.18, by + 0.86, by + 0.98);
  for (const u of [GURNEY[0] + 0.15, GURNEY[1] - 0.15]) for (const t of [GURNEY[2] + 0.12, GURNEY[3] - 0.12]) d.W(0x6a6e72, u - 0.03, u + 0.03, t - 0.03, t + 0.03, by, by + 0.55);
  for (const r of LAUNDRY) {
    d.W(0xd8d4c8, r[0], r[1], r[2], r[3], by + 0.15, by + 0.95);
    d.W(0xf0f0ec, r[0] + 0.08, r[1] - 0.08, r[2] + 0.08, r[3] - 0.08, by + 0.95, by + 1.1);
  }
  // The sealed door: heavy steel in a hazard-striped frame, a keypad's red light, the notice.
  d.W(0x4a4e52, B1.u0, B1.u0 + 0.06, 28.6, 30.4, by, by + 2.3);
  d.W(0x3a3e42, B1.u0 + 0.06, B1.u0 + 0.09, 29.46, 29.54, by, by + 2.3);
  (k.plane(k.canvas(512, 600, (g) => {
    g.clearRect(0, 0, 512, 600);
    for (let i = -12; i < 24; i++) {
      g.fillStyle = i % 2 ? '#1a1a1a' : '#e8c020';
      g.beginPath();
      g.moveTo(i * 40, 0);
      g.lineTo(i * 40 + 40, 0);
      g.lineTo(i * 40 + 40 + 600, 600);
      g.lineTo(i * 40 + 600, 600);
      g.fill();
    }
    g.clearRect(40, 40, 432, 560);
  }), 2.2, 2.55, B1.u0 + 0.1, 29.5, by + 1.28, '+u', 1.0).material as THREE.MeshBasicMaterial).setValues({ transparent: true, alphaTest: 0.5 });
  k.plane(k.canvas(512, 200, (g) => {
    g.fillStyle = '#c81818';
    g.fillRect(0, 0, 512, 200);
    text(g, '関係者以外立入禁止', 256, 60, `900 46px ${SANS}`, '#ffffff');
    text(g, 'AUTHORIZED PERSONNEL ONLY', 256, 118, 'bold 28px Arial, sans-serif', '#ffffff');
    text(g, 'B2', 256, 166, '900 40px Arial, sans-serif', '#ffffff');
  }), 1.1, 0.43, B1.u0 + 0.12, 29.5, by + 1.75, '+u', 1.0);
  d.W(0x2a2a2e, B1.u0 + 0.06, B1.u0 + 0.1, 30.5, 30.66, by + 1.1, by + 1.4);
  d.glow([1.6, 0.1, 0.08], B1.u0 + 0.1, B1.u0 + 0.105, 30.56, 30.6, by + 1.33, by + 1.37);
  k.plane(k.canvas(256, 96, (g) => {
    g.fillStyle = '#0e5a2a';
    g.fillRect(0, 0, 256, 96);
    text(g, '非常口  EXIT →', 128, 50, `bold 34px ${SANS}`, '#ffffff');
  }), 0.9, 0.34, 26, CO[1] - 0.045, by + 2.25, 'out', 1.3);

  const group = k.finish(city, ghost);
  group.visible = false;
  return { group, ...hospitalLayout(b) };
}
