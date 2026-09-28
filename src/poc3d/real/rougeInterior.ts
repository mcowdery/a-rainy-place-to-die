import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { addCar } from './cars';
import { Draw, type C3 } from './interiorDraw';
import type { Interior } from './interiors';
import { Kit, text } from './kit';
import { localFrame, localRect, toLocal, toWorld } from './localFrame';
import { EMIT } from './meshBuilder';

/**
 * Hotel Rouge (ホテル ルージュ), inside: the castle's keep (18 x 14 m, three floors). You walk in through the
 * front doors (or E at them, or at the hidden side door, which lets you into the back hall).
 *
 *   1F  the lobby: the lit room panel (pick a room: lit = free, dark = taken), the front desk's little window
 *       with a lace curtain (you never see a face), a bench; behind it the back hall with the free amenity
 *       bar, the costume rack and a vending machine; the garage (a car behind the strip curtain).
 *   2F  201 Castle (a canopy bed, a chandelier) and 203 Space (a round bed under the stars); 202, 205, 206
 *       are taken. A housekeeping cart in the corridor.
 *   3F  301 Onsen (tatami, a hinoki bath) and 302 Karaoke (the screen, a mirror ball, a heart headboard);
 *       303, the Rouge Suite, is the story's door (taken: it hands off to the VN).
 *
 * No room 4, as in many Japanese hotels. A switchback stair joins the floors. The local frame is the love
 * hotel's (u along the 24 m front, t inward); the keep's inside is u 3.3-20.7, t 4.3-17.7.
 */

const IN = { u0: 3.3, u1: 20.7, t0: 4.3, t1: 17.7 } as const;
export const ROUGE_FLOORS = [0, 5, 10] as const;
const CEIL = 4.1;
/** The front doors (a gap in the front wall; the exterior keeps a pocket there, loveHotel.ts). */
export const ROUGE_DOOR = { u0: 10.5, u1: 13.5 } as const;
/** The switchback stair: flights along two lanes, a landing at the east end, 2.5 m per flight. */
const ST = { u0: 15.8, u1: 19.3, land: IN.u1, lane1: [16.3, IN.t1] as const, lane2: [14.9, 16.2] as const, rise: 2.5 } as const;
const WELL = [ST.u0, IN.u1, ST.lane2[0], IN.t1] as const;
const DIVIDER = [ST.u0, ST.u1, ST.lane2[1], ST.lane1[0]] as const;
const WELL_WALL = [ST.u0, IN.u1, 14.7, ST.lane2[0]] as const;

type R4 = readonly [number, number, number, number];

/** Upper floors: three rooms along the front, the corridor, two rooms behind, the stair stub and a closet. */
const FRONT_ROOMS: readonly R4[] = [[IN.u0, 8.95, IN.t0, 10.2], [9.05, 14.75, IN.t0, 10.2], [14.85, IN.u1, IN.t0, 10.2]];
const BACK_ROOMS: readonly R4[] = [[IN.u0, 8.1, 12.4, IN.t1], [8.1, 13, 12.4, IN.t1]];
const CLOSET = [ST.u0, IN.u1, 12.4, 14.7] as const;
const DOOR_HALF = 0.65;
const mid = (r: R4): number => (r[0] + r[1]) / 2;

type Theme = 'castle' | 'space' | 'onsen' | 'karaoke';
interface Room {
  readonly no: string;
  readonly floor: number;
  readonly r: R4;
  /** A theme: you can go in. Null: taken (the door is shut, its lamp red). */
  readonly theme: Theme | null;
  readonly back?: boolean;
}
const ROOMS: readonly Room[] = [
  { no: '201', floor: 5, r: FRONT_ROOMS[0], theme: 'castle' },
  { no: '202', floor: 5, r: FRONT_ROOMS[1], theme: null },
  { no: '203', floor: 5, r: FRONT_ROOMS[2], theme: 'space' },
  { no: '205', floor: 5, r: BACK_ROOMS[0], theme: null, back: true },
  { no: '206', floor: 5, r: BACK_ROOMS[1], theme: null, back: true },
  { no: '301', floor: 10, r: FRONT_ROOMS[0], theme: 'onsen' },
  { no: '302', floor: 10, r: FRONT_ROOMS[1], theme: 'karaoke' },
  { no: '303', floor: 10, r: FRONT_ROOMS[2], theme: null },
  { no: '305', floor: 10, r: BACK_ROOMS[0], theme: null, back: true },
  { no: '306', floor: 10, r: BACK_ROOMS[1], theme: null, back: true },
];

/** An open room's furniture: the bed (with nightstands) at the front wall, the sofa and table, the bath. */
const roomFurniture = (r: R4): { bed: R4; sofa: R4; table: R4; bath: R4 } => {
  const m = mid(r);
  return {
    bed: [m - 1.15, m + 1.15, IN.t0, 6.8],
    sofa: [r[0] + 0.2, r[0] + 0.9, 7.1, 9.4],
    table: [r[0] + 1.15, r[0] + 1.8, 7.6, 8.8],
    bath: [r[1] - 2.0, r[1], 6.9, 10.1],
  };
};

// 1F
const LOBBY = [8.4, 15.3, IN.t0, 9.6] as const;
const PANEL_WALL = [8.4, 13.8, 9.6, 9.8] as const;
const STAFF = [IN.u0, 8.4, IN.t0, 11.3] as const;
const GARAGE = [15.5, IN.u1, IN.t0, 11.2] as const;
const GARAGE_DOOR = [7, 8.2] as const;
const LINEN = [15.5, IN.u1, 11.3, 14.9] as const;
const ROOM_101 = [IN.u0, 10.1, 13.9, IN.t1] as const;
const AMENITY = [8.6, 13.4, 9.8, 10.3] as const;
const COSTUMES = [IN.u0, 4.0, 12.9, 13.8] as const;
const VENDING = [10.2, 11.0, 14.2, 15.0] as const;
const BENCH = [8.8, 10.2, 4.6, 5.1] as const;
const SIDE_DOOR = [11.5, 12.5] as const;

function ring(front: boolean): R4[] {
  return [
    [IN.u0 - 0.3, IN.u0, IN.t0, IN.t1],
    [IN.u1, IN.u1 + 0.3, IN.t0, IN.t1],
    [IN.u0 - 0.3, IN.u1 + 0.3, IN.t1, IN.t1 + 0.3],
    ...(front ? ([[IN.u0 - 0.3, ROUGE_DOOR.u0, IN.t0 - 0.3, IN.t0], [ROUGE_DOOR.u1, IN.u1 + 0.3, IN.t0 - 0.3, IN.t0]] as R4[]) : ([[IN.u0 - 0.3, IN.u1 + 0.3, IN.t0 - 0.3, IN.t0]] as R4[])),
  ];
}

function upperRects(floor: number): R4[] {
  const out: R4[] = [...ring(false), WELL_WALL, DIVIDER, CLOSET, [IN.u0, 13.05, 12.3, IN.t1]];
  // The front rooms' corridor wall, with doors; the walls between them.
  const rooms = ROOMS.filter((r) => r.floor === floor && !r.back);
  let u = IN.u0;
  for (const room of rooms) {
    const m = mid(room.r);
    if (room.theme) {
      out.push([u, m - DOOR_HALF, 10.1, 10.3]);
      u = m + DOOR_HALF;
      const f = roomFurniture(room.r);
      out.push(f.bed, f.sofa, f.table, f.bath);
    } else out.push([room.r[0], room.r[1], IN.t0, 10.3]);
  }
  out.push([u, IN.u1, 10.1, 10.3], [8.95, 9.05, IN.t0, 10.2], [14.75, 14.85, IN.t0, 10.2]);
  if (floor === ROUGE_FLOORS[1]) out.push([9.8, 10.8, 11.8, 12.3]);
  // The top floor has no flight up: the well over the last flight and the landing is fenced off.
  if (floor === ROUGE_FLOORS[2]) out.push([ST.u0, IN.u1, ST.lane2[1], IN.t1], [ST.u1, IN.u1, ST.lane2[0], IN.t1]);
  return out;
}

function groundRects(): R4[] {
  return [
    ...ring(true),
    STAFF,
    PANEL_WALL,
    [15.3, 15.5, IN.t0, GARAGE_DOOR[0]],
    [15.3, 15.5, GARAGE_DOOR[1], 11.3],
    [15.3, IN.u1, 11.1, 11.3],
    [16.6, 18.4, 5.2, 9.8],
    LINEN,
    WELL_WALL,
    DIVIDER,
    [ST.u0, ST.u1, ST.lane2[0], ST.lane2[1]],
    ROOM_101,
    AMENITY,
    COSTUMES,
    VENDING,
    BENCH,
    [14.5, 15.2, 4.5, 5.2],
  ];
}

/** Heights of the stair pieces at a point (each flight and the landing, for both storeys), or none. */
function stairAt(u: number, t: number): number[] {
  const ys: number[] = [];
  const onLane = (lane: readonly [number, number]): boolean => t > lane[0] && t < lane[1];
  for (const base of [0, 5]) {
    if (u > ST.u0 && u < ST.u1 && onLane(ST.lane1)) ys.push(base + ((u - ST.u0) / (ST.u1 - ST.u0)) * ST.rise);
    if (u > ST.u0 && u < ST.u1 && onLane(ST.lane2)) ys.push(base + ST.rise + ((ST.u1 - u) / (ST.u1 - ST.u0)) * ST.rise);
    if (u >= ST.u1 && u < IN.u1 && t > ST.lane2[0] && t < IN.t1) ys.push(base + ST.rise);
  }
  return ys;
}

/** The hotel's layout alone (collision per level, floors, the stair, what counts as inside). */
export function rougeLayout(b: Building3): Omit<Interior, 'group'> {
  const f = localFrame(b);
  const W = (rs: readonly R4[]): Rect[] => rs.map((r) => localRect(f, r[0], r[1], r[2], r[3]));
  const g = W(groundRects());
  const f2 = W(upperRects(ROUGE_FLOORS[1]));
  const f3 = W(upperRects(ROUGE_FLOORS[2]));
  const stairs = W([...ring(false), WELL_WALL, DIVIDER]);
  const inKeep = (u: number, t: number): boolean => u > IN.u0 && u < IN.u1 && t > IN.t0 && t < IN.t1;
  const inWell = (u: number, t: number): boolean => u > WELL[0] && u < WELL[1] && t > WELL[2] && t < WELL[3];
  return {
    colliders: (floor) => (floor < 1.25 ? g : floor < 3.75 ? stairs : floor < 6.25 ? f2 : floor < 8.75 ? stairs : f3),
    floorAt(x, z, current) {
      if (current > 14) return null;
      const [u, t] = toLocal(f, x, z);
      if (!inKeep(u, t)) return null;
      // In the stairwell only the stair counts (the ground floor under it is walled off); elsewhere the storeys.
      const cands: number[] = inWell(u, t) ? stairAt(u, t).filter((y) => Math.abs(y - current) < 1.5) : [...ROUGE_FLOORS];
      if (cands.length === 0) cands.push(0);
      let best = cands[0];
      for (const y of cands) if (Math.abs(y - current) < Math.abs(best - current)) best = y;
      return best;
    },
    contains(x, z, y) {
      const [u, t] = toLocal(f, x, z);
      return y > -1 && y < 15 && inKeep(u, t);
    },
  };
}

// ---- Geometry ----

const CARPET = 0x4a1424;
const WALL = 0x6a3048;
const DAMASK = 0x5a2440;
const GOLD = 0xc8a050;
const PINK: C3 = [1.2, 0.3, 0.7];
const WARM: C3 = [0.9, 0.6, 0.4];

/** Walls round a room's inside (its door in the corridor wall), from y0 to y1. */
function roomShell(d: Draw, r: R4, y: number, hex: number, doorOnT1: boolean): void {
  const [u0, u1, t0, t1] = r;
  const m = mid(r);
  d.W(hex, u0, u0 + 0.05, t0, t1, y, y + CEIL);
  d.W(hex, u1 - 0.05, u1, t0, t1, y, y + CEIL);
  d.W(hex, u0, u1, t0, t0 + 0.05, y, y + CEIL);
  if (doorOnT1) {
    d.W(hex, u0, m - DOOR_HALF, t1 - 0.05, t1, y, y + CEIL);
    d.W(hex, m + DOOR_HALF, u1, t1 - 0.05, t1, y, y + CEIL);
    d.W(hex, m - DOOR_HALF, m + DOOR_HALF, t1 - 0.05, t1, y + 2.2, y + CEIL);
  }
}

/** A corridor door: frame, number plate, the lamp over it (red: taken; green: free), the leaf if shut. */
function corridorDoor(d: Draw, u: number, t: number, y: number, face: 1 | -1, no: string, open: boolean): void {
  const tf = t + face * 0.02;
  d.W(GOLD, u - DOOR_HALF - 0.06, u - DOOR_HALF, t - 0.08, t + 0.08, y, y + 2.26);
  d.W(GOLD, u + DOOR_HALF, u + DOOR_HALF + 0.06, t - 0.08, t + 0.08, y, y + 2.26);
  d.W(GOLD, u - DOOR_HALF - 0.06, u + DOOR_HALF + 0.06, t - 0.08, t + 0.08, y + 2.2, y + 2.26);
  if (!open) d.W(0x3a1020, u - DOOR_HALF, u + DOOR_HALF, t - 0.04, t + 0.04, y, y + 2.2);
  d.glow(open ? [0.2, 1.4, 0.5] : [1.6, 0.12, 0.12], u - 0.08, u + 0.08, tf - 0.03, tf + 0.03, y + 2.4, y + 2.5);
  d.k.plane(d.sign(no, '', '#1a0a12', '#e8c878', 256, 128), 0.4, 0.2, u + DOOR_HALF + 0.35, tf + face * 0.02, y + 1.55, face > 0 ? 'in' : 'out', 1.0);
}

function* groundFloor(d: Draw, k: Kit): Generator<void> {
  const y = 0;
  d.level = y;
  d.W(CARPET, IN.u0, IN.u1, IN.t0, IN.t1, y - 0.05, y + 0.02);
  for (const [a, b, c, e] of [[IN.u0, IN.u1, IN.t0, WELL[2]], [IN.u0, WELL[0], WELL[2], IN.t1]] as const) d.W(0x2a1420, a, b, c, e, CEIL, 5, true);
  d.W(0x3a3a3c, GARAGE[0], GARAGE[1], GARAGE[2], GARAGE[3], y + 0.02, y + 0.03);
  d.W(0x5a5a5c, GARAGE[0], IN.u1, IN.t0, IN.t0 + 0.02, y, CEIL);
  // The lobby: a chandelier, the name over the doors, a bench, a plant, a mirror.
  d.lathe(0, 11.9, 7, [[CEIL - 1.1, 0.02], [CEIL - 1.0, 0.5], [CEIL - 0.75, 0.7], [CEIL - 0.5, 0.45], [CEIL - 0.35, 0.1]], 12, EMIT.always, [1.2, 0.8, 0.9]);
  d.W(GOLD, 11.88, 11.92, 6.98, 7.02, CEIL - 0.35, CEIL);
  for (const [a, b] of [[8.6, 9.2], [14.6, 15.2]] as const) d.glow(PINK, a, b, IN.t0 + 0.05, IN.t0 + 0.12, CEIL - 0.3, CEIL - 0.25);
  d.k.plane(d.k.canvas(640, 160, (g) => {
    g.fillStyle = '#2a0c1a';
    g.fillRect(0, 0, 640, 160);
    text(g, 'Hotel Rouge', 320, 70, "italic bold 76px 'Georgia', serif", '#f0c8d8');
    text(g, 'ようこそ  WELCOME', 320, 130, "28px 'Yu Gothic', sans-serif", '#d8a8b8');
  }), 3.0, 0.75, 12, IN.t0 + 0.02, 3.45, 'in', 1.0);
  d.W(0x8a3a5a, BENCH[0], BENCH[1], BENCH[2], BENCH[3], y, y + 0.45);
  d.W(0x8a3a5a, BENCH[0], BENCH[1], BENCH[2], BENCH[2] + 0.15, y + 0.45, y + 0.9);
  d.lathe(0x8a6a4a, 14.85, 4.85, [[y, 0.25], [y + 0.5, 0.3]], 10);
  d.lathe(0x2e5a34, 14.85, 4.85, [[y + 0.5, 0.1], [y + 1.0, 0.45], [y + 1.6, 0.35], [y + 1.9, 0.05]], 8);
  d.glow([0.5, 0.45, 0.5], LOBBY[1] - 0.03, LOBBY[1] - 0.01, 5.5, 6.8, 0.4, 2.3);
  // The staff room's wall, its little window (a lit slot under a lace curtain, a bell on the ledge).
  d.W(WALL, STAFF[1] - 0.1, STAFF[1], IN.t0, STAFF[3], y, CEIL);
  d.W(WALL, IN.u0, STAFF[1], STAFF[3] - 0.1, STAFF[3], y, CEIL);
  d.W(0x1a0a12, STAFF[1], STAFF[1] + 0.02, 6.1, 7.5, 0.95, 1.35);
  d.glow([0.9, 0.7, 0.5], STAFF[1] + 0.02, STAFF[1] + 0.03, 6.2, 7.4, 1.0, 1.28);
  d.W(0x3a1a28, STAFF[1], STAFF[1] + 0.3, 6.0, 7.6, 0.9, 0.95);
  d.lathe(GOLD, STAFF[1] + 0.15, 6.4, [[0.95, 0.05], [1.0, 0.05], [1.02, 0.02]], 8);
  d.k.plane(d.k.canvas(256, 64, (g) => {
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(250,240,245,0.92)';
    for (let x = 0; x < 256; x += 16) {
      g.beginPath();
      g.arc(x + 8, 64, 10, Math.PI, 0);
      g.fill();
    }
    g.fillRect(0, 0, 256, 56);
  }), 1.4, 0.35, STAFF[1] + 0.035, 6.8, 1.45, '+u', 1.0);
  const lace = d.k.group.children[d.k.group.children.length - 1] as THREE.Mesh;
  (lace.material as THREE.MeshBasicMaterial).transparent = true;
  d.k.plane(d.sign('フロント', 'FRONT', '#1a0a12', '#e8c878', 256, 96, false), 0.8, 0.3, STAFF[1] + 0.03, 6.8, 2.0, '+u', 1.0);
  yield;

  // The room panel: every room's photo, lit when it's free; press the button under one to take it.
  const panel = d.k.canvas(1024, 480, (g) => {
    g.fillStyle = '#12060c';
    g.fillRect(0, 0, 1024, 480);
    text(g, 'ROOM SELECT  お部屋をお選びください', 512, 30, "bold 26px 'Yu Gothic', sans-serif", '#f0c8d8');
    const tiles: [string, string, string, boolean][] = [
      ['101', 'Classic', '#a05060', false], ['201', 'Castle', '#e890b0', true], ['202', 'Marine', '#4a90c0', false], ['203', 'Space', '#3a3a8a', true],
      ['205', 'Resort', '#60a870', false], ['206', 'Mirror', '#a0a0b8', false], ['301', 'Onsen', '#b08a50', true], ['302', 'Karaoke', '#9a50c8', true],
      ['303', 'Rouge Suite', '#c02040', false], ['305', 'Retro', '#c89040', false], ['306', 'Sakura', '#f0a0c0', false], ['', '', '#000', false],
    ];
    tiles.forEach(([no, name, col, free], i) => {
      if (!no) return;
      const x = 16 + (i % 4) * 252;
      const yy = 56 + Math.floor(i / 4) * 140;
      g.fillStyle = free ? col : '#2a2226';
      g.fillRect(x, yy, 240, 104);
      g.fillStyle = free ? 'rgba(255,255,255,0.85)' : 'rgba(120,110,115,0.6)';
      g.fillRect(x + 60, yy + 44, 120, 44);
      g.fillStyle = free ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.2)';
      g.fillRect(x + 60, yy + 36, 120, 12);
      text(g, `${no}  ${name}`, x + 120, yy + 20, "bold 22px 'Segoe UI', sans-serif", free ? '#ffffff' : '#6a6064');
      text(g, free ? '休憩 ¥4,800' : '使用中', x + 120, yy + 124, `bold 20px 'Yu Gothic', sans-serif`, free ? '#80f0a0' : '#c05060');
    });
  });
  d.W(0x1a0a12, PANEL_WALL[0], PANEL_WALL[1], PANEL_WALL[2], PANEL_WALL[3], y, CEIL);
  d.W(GOLD, 8.9, 13.3, PANEL_WALL[2] - 0.05, PANEL_WALL[2], 0.55, 2.95);
  d.k.plane(panel, 4.3, 2.0, 11.1, PANEL_WALL[2] - 0.06, 1.75, 'out', 1.1);
  d.glow([0.4, 1.2, 0.5], 12.9, 13.1, PANEL_WALL[2] - 0.08, PANEL_WALL[2] - 0.05, 0.55, 0.65);
  d.person(11.3, 8.2, 0, 1, { body: 'man', pose: 'hold', color: [0.68, 0.52, 1.0], side: 1 });
  d.person(11.95, 8.1, -0.2, 1, { body: 'woman', pose: 'hold', color: [1.0, 0.42, 0.72], side: -1, hair: 'long', long: true });
  yield;

  // The garage: concrete, a car with its nose to the wall, the strip curtain, a light.
  d.W(WALL, GARAGE[0] - 0.2, GARAGE[0], IN.t0, GARAGE_DOOR[0], y, CEIL);
  d.W(WALL, GARAGE[0] - 0.2, GARAGE[0], GARAGE_DOOR[1], GARAGE[3], y, CEIL);
  d.W(WALL, GARAGE[0] - 0.2, GARAGE[0], GARAGE_DOOR[0], GARAGE_DOOR[1], 2.3, CEIL);
  d.W(0x8a8a8c, GARAGE[0], IN.u1, GARAGE[3] - 0.1, GARAGE[3] + 0.1, y, CEIL);
  for (let s = 16.4; s < 18.7; s += 0.2) d.W(0xe06090, s, s + 0.14, IN.t0 + 0.02, IN.t0 + 0.05, 0.35, 2.7);
  d.glow([1.1, 1.1, 1.0], 17, 18.2, 7, 7.3, CEIL - 0.03, CEIL);
  const [cx, cz] = toWorld(k.f, 17.5, 7.5);
  addCar(k.mb, { x: cx, z: cz, fx: -k.f.n[0], fz: -k.f.n[2], variant: 31, type: 'sedan', paint: 0x14141a });
  d.k.plane(d.sign('P', 'ROUGE PARKING', '#1a3a8a', '#ffffff', 256, 160, false), 0.8, 0.5, 19, 11.05, 2.6, 'out', 1.0);
  yield;

  // The back hall: the amenity bar, the costume rack, the vending machine, room 101 (taken), the linen
  // room, the side door, and the stairs up.
  d.W(0x3a1a28, AMENITY[0], AMENITY[1], AMENITY[2], AMENITY[3], y, y + 0.9);
  d.W(0xe8d8c8, AMENITY[0], AMENITY[1], AMENITY[2], AMENITY[3], y + 0.9, y + 0.94);
  for (let u = AMENITY[0] + 0.2; u < AMENITY[1] - 0.4; u += 0.6) {
    d.W(0xc8a878, u, u + 0.45, AMENITY[2] + 0.08, AMENITY[3] - 0.08, y + 0.94, y + 1.08);
    for (let i = 0; i < 4; i++) d.W(d.pick([0xf4c8d8, 0xffffff, 0xa8d8f0, 0xf0e0a0, 0xc8f0c8]), u + 0.05 + i * 0.1, u + 0.12 + i * 0.1, AMENITY[2] + 0.15, AMENITY[3] - 0.15, y + 1.08, y + 1.2);
  }
  d.k.plane(d.sign('アメニティ ご自由にどうぞ', 'FREE AMENITIES', '#3a1a28', '#f0c8d8', 640, 128, false), 2.4, 0.48, 11, AMENITY[2] + 0.02, 1.9, 'in', 1.0);
  d.W(0x8a8e92, COSTUMES[0], COSTUMES[1], COSTUMES[2], COSTUMES[2] + 0.04, y, y + 1.8);
  d.W(0x8a8e92, COSTUMES[0], COSTUMES[1], COSTUMES[3] - 0.04, COSTUMES[3], y, y + 1.8);
  d.W(0x8a8e92, IN.u0 + 0.3, IN.u0 + 0.34, COSTUMES[2], COSTUMES[3], y + 1.76, y + 1.8);
  for (let t = COSTUMES[2] + 0.08; t < COSTUMES[3] - 0.08; t += 0.12) d.W(d.pick([0xf4f4f8, 0x1a1a2a, 0xe83a5a, 0x3a5ae8, 0xf4a0c0]), IN.u0 + 0.05, IN.u0 + 0.6, t, t + 0.06, y + 0.7, y + 1.72);
  d.k.plane(d.sign('コスプレ無料貸出', 'COSTUMES TO BORROW', '#1a0a12', '#f0c8d8', 512, 128, false), 1.4, 0.35, IN.u0 + 0.02, 13.35, 2.2, '+u', 1.0);
  d.W(0xe83a6a, VENDING[0], VENDING[1], VENDING[2], VENDING[3], y, y + 1.85);
  d.glow([0.95, 0.9, 1.0], VENDING[1], VENDING[1] + 0.02, VENDING[2] + 0.08, VENDING[3] - 0.08, y + 0.8, y + 1.7);
  d.W(WALL, ROOM_101[0], ROOM_101[1], ROOM_101[2], ROOM_101[2] + 0.1, y, CEIL);
  d.W(WALL, ROOM_101[1] - 0.1, ROOM_101[1], ROOM_101[2], ROOM_101[3], y, CEIL);
  corridorDoor(d, 8.5, ROOM_101[2], y, -1, '101', false);
  d.W(WALL, LINEN[0], LINEN[0] + 0.2, LINEN[2], LINEN[3], y, CEIL);
  d.W(0x5a5a5c, LINEN[0] - 0.02, LINEN[0], 12.2, 13.2, y, 2.1);
  d.k.plane(d.sign('STAFF ONLY', '関係者以外立入禁止', '#2a2a2e', '#ffffff', 384, 128, false), 0.8, 0.27, LINEN[0] - 0.03, 12.7, 1.6, '-u', 1.0);
  d.W(0x5a4a3a, IN.u0, IN.u0 + 0.05, SIDE_DOOR[0], SIDE_DOOR[1], y, 2.2);
  d.glow([0.2, 1.3, 0.4], IN.u0 + 0.05, IN.u0 + 0.08, 11.75, 12.25, 2.35, 2.55);
  for (let t = 11.5; t < IN.t1 - 0.5; t += 2) d.glow(WARM, IN.u0 + 0.05, IN.u0 + 0.12, t, t + 0.2, 2.3, 2.6);
  d.person(7.6, 13.0, 1, 0.3, { body: 'woman', pose: 'phone', color: [0.95, 0.7, 0.85], hair: 'long', long: true });
}

function* upperFloor(d: Draw, y: number): Generator<void> {
  d.level = y;
  const n = y === ROUGE_FLOORS[1] ? 2 : 3;
  for (const [a, b, c, e] of [[IN.u0, IN.u1, IN.t0, WELL[2]], [IN.u0, WELL[0], WELL[2], IN.t1]] as const) {
    d.W(CARPET, a, b, c, e, y - 0.05, y + 0.02);
    d.W(0x2a1420, a, b, c, e, y + CEIL, y + 5, true);
  }
  // Corridor: damask walls, sconces, downlights, the floor sign by the stairs.
  d.W(DAMASK, IN.u0, 13.05, 12.35, 12.45, y, y + CEIL);
  d.W(DAMASK, 12.95, 13.05, 12.4, IN.t1, y, y + CEIL);
  d.W(DAMASK, CLOSET[0], CLOSET[1], CLOSET[2], CLOSET[2] + 0.1, y, y + CEIL);
  d.W(DAMASK, IN.u0, IN.u0 + 0.1, 10.2, 12.4, y, y + CEIL);
  d.W(DAMASK, IN.u1 - 0.1, IN.u1, 10.2, 12.4, y, y + CEIL);
  for (let u = 5; u < 20; u += 3) d.glow([0.8, 0.55, 0.5], u, u + 0.2, 11.2, 11.4, y + CEIL - 0.02, y + CEIL);
  for (let u = 4.5; u < 20; u += 4) d.glow(WARM, u, u + 0.2, 12.33, 12.36, y + 1.9, y + 2.2);
  d.k.plane(d.sign(`${n}F`, n === 2 ? '201 - 206' : '301 - 306', '#1a0a12', '#e8c878', 256, 160), 0.8, 0.5, 14.4, 12.47, y + 2.4, 'in', 1.0);
  d.glow([0.2, 1.3, 0.4], 14, 14.8, IN.t1 - 0.06, IN.t1 - 0.02, y + 2.6, y + 2.85);
  // Doors: the front rooms' (from the corridor, facing +t), the back rooms' (facing -t), the linen room's.
  for (const room of ROOMS.filter((r) => r.floor === y)) {
    if (room.back) corridorDoor(d, mid(room.r) + 0.6, 12.4, y, -1, room.no, false);
    else {
      corridorDoor(d, mid(room.r), 10.2, y, 1, room.no, room.theme !== null);
      if (!room.theme) {
        d.W(WALL, room.r[0], room.r[1], 10.1, 10.2, y, y + CEIL);
      }
    }
  }
  d.W(0x5a5a5c, 17.2, 18.2, CLOSET[2] - 0.02, CLOSET[2], y, y + 2.1);
  if (n === 2) {
    // A housekeeping cart and the maid.
    d.W(0xe8e8ec, 9.8, 10.8, 11.8, 12.3, y, y + 1.0);
    for (const h of [0.35, 0.7]) d.W(d.pick([0xffffff, 0xf4d8e0]), 9.85, 10.75, 11.85, 12.25, y + h, y + h + 0.12);
    d.person(11.3, 11.9, -1, 0, { body: 'woman', color: [0.9, 0.9, 1.0], hair: 'bun', long: true });
  } else {
    d.person(12.5, 11.2, 1, 0, { body: 'man', pose: 'walk', color: [0.8, 0.6, 1.0], phase: 0.3 });
    d.person(12.0, 11.5, 1, 0, { body: 'woman', pose: 'walk', color: [1.0, 0.5, 0.75], phase: 0.8, hair: 'long', long: true });
  }
  yield;
  for (const room of ROOMS.filter((r) => r.floor === y && r.theme)) {
    themedRoom(d, room);
    yield;
  }
}

/** A room you can go into: the shell, the bed, the sofa and table, the glass bath, the lights, the theme. */
function themedRoom(d: Draw, room: Room): void {
  const y = room.floor;
  const r = room.r;
  const [u0, u1] = r;
  const m = mid(r);
  const fz = roomFurniture(r);
  const look: Record<Theme, { wall: number; floor: number; bed: number; head: number; sofa: number; light: C3 }> = {
    castle: { wall: 0xf4d0dc, floor: 0xe8c8d0, bed: 0xfaf0f4, head: 0xd8b060, sofa: 0xb02848, light: [1.3, 0.6, 0.8] },
    space: { wall: 0x14163a, floor: 0x1a1c30, bed: 0x2a3a7a, head: 0x0a0c20, sofa: 0x3a3a6a, light: [0.3, 0.5, 1.5] },
    onsen: { wall: 0xc8a878, floor: 0xc8b87a, bed: 0xf4f0e6, head: 0x6a4a2a, sofa: 0x8a6a4a, light: [1.2, 0.8, 0.45] },
    karaoke: { wall: 0x3a1a4a, floor: 0x2a1030, bed: 0xe8203a, head: 0xe8203a, sofa: 0x6a2a8a, light: [1.1, 0.2, 1.3] },
  };
  const L = look[room.theme!];
  roomShell(d, r, y, L.wall, true);
  d.W(L.floor, u0, u1, IN.t0, 10.2, y + 0.02, y + 0.035);
  d.W(L.wall, u0, u1, IN.t0, 10.2, y + CEIL - 0.05, y + CEIL, true);
  // Mood light: a glowing cove round the ceiling.
  for (const [a, b, c, e] of [[u0 + 0.1, u1 - 0.1, IN.t0 + 0.1, IN.t0 + 0.16], [u0 + 0.1, u0 + 0.16, IN.t0 + 0.1, 10.1], [u1 - 0.16, u1 - 0.1, IN.t0 + 0.1, 10.1]] as const) d.glow(L.light, a, b, c, e, y + CEIL - 0.1, y + CEIL - 0.06);
  // The bed with its headboard (a control panel of dials), nightstands and lamps.
  const [b0, b1, b2, b3] = fz.bed;
  d.W(L.head, m - 1.0, m + 1.0, b2 + 0.05, b2 + 0.35, y, y + 1.15);
  d.glow([0.6, 0.5, 0.4], m - 0.4, m + 0.4, b2 + 0.36, b2 + 0.37, y + 0.75, y + 0.9);
  if (room.theme === 'onsen') {
    d.W(0x8a6a4a, m - 1.0, m + 1.0, b2 + 0.4, b3, y, y + 0.25);
    d.W(L.bed, m - 0.9, m + 0.9, b2 + 0.45, b3 - 0.1, y + 0.25, y + 0.38);
  } else if (room.theme === 'space') {
    d.lathe(L.bed, m, (b2 + b3) / 2 + 0.2, [[y, 1.05], [y + 0.45, 1.05], [y + 0.55, 0.95], [y + 0.56, 0.01]], 24);
    d.lathe(0, m, (b2 + b3) / 2 + 0.2, [[y + 0.02, 1.07], [y + 0.08, 1.07]], 24, EMIT.always, [0.2, 0.5, 1.6]);
  } else {
    d.W(0x3a2a2a, m - 0.9, m + 0.9, b2 + 0.4, b3, y, y + 0.35);
    d.W(L.bed, m - 0.9, m + 0.9, b2 + 0.4, b3, y + 0.35, y + 0.6);
    for (const du of [-0.45, 0.45]) d.W(0xffffff, m + du - 0.3, m + du + 0.3, b2 + 0.45, b2 + 0.85, y + 0.6, y + 0.72);
  }
  if (room.theme === 'karaoke') {
    const heart = d.k.plane(d.k.canvas(256, 256, (g) => {
      g.clearRect(0, 0, 256, 256);
      g.fillStyle = '#ff3a6a';
      g.beginPath();
      g.moveTo(128, 236);
      g.bezierCurveTo(-60, 110, 40, -40, 128, 60);
      g.bezierCurveTo(216, -40, 316, 110, 128, 236);
      g.fill();
    }), 2.0, 2.0, m, b2 + 0.37, y + 1.6, 'in', 1.2);
    (heart.material as THREE.MeshBasicMaterial).transparent = true;
  }
  for (const u of [b0 + 0.05, b1 - 0.45]) {
    d.W(L.head, u, u + 0.4, b2 + 0.1, b2 + 0.5, y, y + 0.55);
    d.lathe(0, u + 0.2, b2 + 0.3, [[y + 0.7, 0.13], [y + 0.9, 0.09]], 10, EMIT.always, L.light);
  }
  // The sofa and the low table; a TV on the side wall.
  const [s0, s1, s2, s3] = fz.sofa;
  d.W(L.sofa, s0, s1, s2, s3, y, y + 0.42);
  d.W(L.sofa, s0, s0 + 0.2, s2, s3, y + 0.42, y + 0.85);
  const [t0, t1, t2, t3] = fz.table;
  d.W(room.theme === 'onsen' ? 0x6a4a2a : 0x1a1a1c, t0, t1, t2, t3, y, y + 0.4);
  d.W(0x0a0a0c, u0 + 0.4, u0 + 1.9, 10.06, 10.12, y + 1.2, y + 2.05);
  if (room.theme !== 'karaoke') d.glow([0.25, 0.3, 0.45], u0 + 0.45, u0 + 1.85, 10.05, 10.06, y + 1.25, y + 2.0);
  // The bath behind glass, lit from below.
  const [w0, w1, w2, w3] = fz.bath;
  d.k.paneT(w0, w2, w3 - 0.1, y, y + 2.4);
  d.k.pane(w0, w1, y, y + 2.4, w2);
  d.W(room.theme === 'onsen' ? 0xc8a070 : 0xf4f2ee, w0 + 0.2, w1 - 0.1, w2 + 0.2, w2 + 2.0, y, y + 0.6);
  d.glow(room.theme === 'onsen' ? [0.12, 0.1, 0.07] : [0.03, 0.09, 0.12], w0 + 0.3, w1 - 0.2, w2 + 0.3, w2 + 1.9, y + 0.6, y + 0.61);
  d.W(0xd8d8dc, w0, w1, w2, w3, y + 0.02, y + 0.04);
  // The theme's own pieces.
  switch (room.theme) {
    case 'castle':
      for (const [a, b] of [[m - 1.05, b2 + 0.1], [m + 0.95, b2 + 0.1], [m - 1.05, b3 - 0.1], [m + 0.95, b3 - 0.1]] as const) d.W(L.head, a, a + 0.1, b, b + 0.1, y, y + 2.6);
      d.W(0xf8e0ea, m - 1.1, m + 1.1, b2 + 0.05, b3, y + 2.6, y + 2.7);
      d.quad(0xf8e0ea, d.P(m - 1.1, b3, y + 2.6), d.P(m + 1.1, b3, y + 2.6), d.P(m + 1.1, b3 + 0.05, y + 1.6), d.P(m - 1.1, b3 + 0.05, y + 1.6));
      d.lathe(0, m, 8.3, [[y + CEIL - 1.0, 0.02], [y + CEIL - 0.9, 0.45], [y + CEIL - 0.65, 0.55], [y + CEIL - 0.45, 0.3]], 12, EMIT.always, [1.3, 1.0, 0.8]);
      d.W(GOLD, u1 - 0.06, u1 - 0.04, 4.8, 6.0, y + 0.9, y + 2.4);
      d.glow([0.55, 0.52, 0.55], u1 - 0.07, u1 - 0.06, 4.9, 5.9, y + 1.0, y + 2.3);
      break;
    case 'space': {
      d.k.plane(d.k.canvas(512, 512, (g) => {
        g.fillStyle = '#05061a';
        g.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 260; i++) {
          const a = (i * 2654435761) >>> 0;
          g.fillStyle = `rgba(255,255,255,${0.4 + (a % 60) / 100})`;
          g.fillRect(a % 512, (a >>> 9) % 512, 1 + (a % 3 === 0 ? 1 : 0), 1 + (a % 3 === 0 ? 1 : 0));
        }
        const neb = g.createRadialGradient(330, 200, 10, 330, 200, 200);
        neb.addColorStop(0, 'rgba(160,80,220,0.5)');
        neb.addColorStop(1, 'rgba(160,80,220,0)');
        g.fillStyle = neb;
        g.fillRect(0, 0, 512, 512);
      }), u1 - u0 - 0.2, 5.6, m, 7.25, y + CEIL - 0.07, 'out', 1.0).rotation.set(Math.PI / 2, 0, 0);
      d.lathe(0, u0 + 0.6, 5.0, [[y + 1.8, 0.001], [y + 1.89, 0.22], [y + 2.1, 0.3], [y + 2.31, 0.22], [y + 2.4, 0.001]], 12, EMIT.always, [1.3, 0.6, 0.3]);
      d.lathe(0, u0 + 0.6, 5.0, [[y + 2.08, 0.5], [y + 2.12, 0.5]], 16, EMIT.always, [0.9, 0.8, 0.6]);
      break;
    }
    case 'onsen':
      d.k.plane(d.k.canvas(256, 384, (g) => {
        g.fillStyle = '#f4ecd8';
        g.fillRect(0, 0, 256, 384);
        g.strokeStyle = '#6a4a2a';
        g.lineWidth = 6;
        for (let x = 0; x <= 256; x += 64) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, 384);
          g.stroke();
        }
        for (let yy = 0; yy <= 384; yy += 64) {
          g.beginPath();
          g.moveTo(0, yy);
          g.lineTo(256, yy);
          g.stroke();
        }
      }), 1.6, 2.4, m + 1.8, IN.t0 + 0.06, y + 1.4, 'in', 1.1);
      d.W(0x6a4a2a, u0 + 0.1, u0 + 1.2, IN.t0 + 0.1, IN.t0 + 0.5, y, y + 0.3);
      d.W(0xf4ecd8, u0 + 0.5, u0 + 0.8, IN.t0 + 0.2, IN.t0 + 0.4, y + 0.3, y + 0.9);
      d.glow([1.2, 0.8, 0.45], u0 + 0.55, u0 + 0.75, IN.t0 + 0.24, IN.t0 + 0.36, y + 0.4, y + 0.8);
      for (let t = IN.t0 + 0.3; t < 10; t += 0.9) d.W(0x5a4020, u0, u1, t, t + 0.02, y + 0.035, y + 0.04);
      break;
    case 'karaoke': {
      d.k.plane(d.k.canvas(512, 288, (g) => {
        const gr = g.createLinearGradient(0, 0, 512, 288);
        gr.addColorStop(0, '#3a0a5a');
        gr.addColorStop(1, '#e83a8a');
        g.fillStyle = gr;
        g.fillRect(0, 0, 512, 288);
        text(g, '♪ 夜の街で 君を探して', 256, 190, "bold 34px 'Yu Gothic', sans-serif", '#ffffff');
        text(g, 'CITY LIGHTS / ROUGE', 256, 250, "20px 'Segoe UI', sans-serif", '#ffe0f0');
        g.fillStyle = '#60e0ff';
        g.fillRect(96, 206, 150, 4);
      }), 1.4, 0.79, u0 + 1.15, 10.04, y + 1.62, 'out', 1.2);
      d.ball(0xd8d8e0, m, 8.3, y + CEIL - 0.9, 0.25, 10);
      d.W(0xd8d8e0, m - 0.01, m + 0.01, 8.29, 8.31, y + CEIL - 0.4, y + CEIL);
      for (let i = 0; i < 12; i++) {
        const a = i * 2.39996;
        const cu = m + Math.cos(a) * (1.2 + (i % 3) * 0.6);
        const ct = 7.4 + Math.sin(a) * 1.4;
        d.glow(i % 2 ? [1.2, 0.3, 1.2] : [0.3, 0.8, 1.4], cu - 0.05, cu + 0.05, ct - 0.05, ct + 0.05, y + CEIL - 0.04, y + CEIL - 0.03);
      }
      d.W(0x1a1a1c, u0 + 1.5, u0 + 1.54, 9.0, 9.04, y, y + 1.4);
      d.ball(0x2a2a2e, u0 + 1.52, 9.02, y + 1.4, 0.05, 8);
      break;
    }
  }
}

/** The stair: treads on both lanes for both storeys, the landings, the divider, rails. */
function* stairs(d: Draw): Generator<void> {
  d.level = 0;
  for (const base of [0, 5]) {
    const run = ST.u1 - ST.u0;
    for (let i = 0; i < 12; i++) {
      const a = ST.u0 + (i * run) / 12;
      const b = ST.u0 + ((i + 1) * run) / 12;
      const y1 = base + ((i + 1) / 12) * ST.rise;
      const y2 = base + ST.rise + ((12 - i) / 12) * ST.rise;
      d.W(CARPET, a, b, ST.lane1[0], ST.lane1[1], y1 - 0.2, y1);
      d.W(CARPET, a, b, ST.lane2[0], ST.lane2[1], y2 - 0.2, y2);
      d.W(GOLD, a, a + 0.04, ST.lane1[0], ST.lane1[1], y1 - 0.005, y1 + 0.005);
      d.W(GOLD, b - 0.04, b, ST.lane2[0], ST.lane2[1], y2 - 0.005, y2 + 0.005);
    }
    d.W(CARPET, ST.u1, IN.u1, ST.lane2[0], IN.t1, base + ST.rise - 0.25, base + ST.rise);
    d.quad(0x2a1420, d.P(ST.u0, ST.lane1[0], base - 0.2), d.P(ST.u0, ST.lane1[1], base - 0.2), d.P(ST.u1, ST.lane1[1], base + ST.rise - 0.25), d.P(ST.u1, ST.lane1[0], base + ST.rise - 0.25));
    d.quad(0x2a1420, d.P(ST.u1, ST.lane2[0], base + ST.rise - 0.25), d.P(ST.u1, ST.lane2[1], base + ST.rise - 0.25), d.P(ST.u0, ST.lane2[1], base + 2 * ST.rise - 0.25), d.P(ST.u0, ST.lane2[0], base + 2 * ST.rise - 0.25));
  }
  d.W(DAMASK, DIVIDER[0], DIVIDER[1], DIVIDER[2], DIVIDER[3], 0, 14.1);
  d.W(DAMASK, WELL_WALL[0], WELL_WALL[1], WELL_WALL[2], WELL_WALL[3], 0, 14.1);
  // The rail round the well on the top floor.
  d.k.pane(ST.u0, IN.u1, 10, 11.0, ST.lane2[1] + 0.02);
  d.k.paneT(ST.u1, ST.lane2[0], ST.lane2[1], 10, 11.0);
  d.W(GOLD, ST.u0, IN.u1, ST.lane2[1] - 0.02, ST.lane2[1] + 0.06, 11.0, 11.05, true);
  for (let y = 1.8; y < 14; y += 5) d.glow(WARM, IN.u1 - 0.12, IN.u1 - 0.05, 16.8, 17.0, y + 0.6, y + 0.9);
  yield;
}

/** The keep's walls inside, full height, the front doors' gap on the ground floor. */
function walls(d: Draw): void {
  const top = 15;
  d.W(WALL, IN.u0 - 0.1, IN.u0, IN.t0, IN.t1, 0, top);
  d.W(WALL, IN.u1, IN.u1 + 0.1, IN.t0, IN.t1, 0, top);
  d.W(WALL, IN.u0, IN.u1, IN.t1, IN.t1 + 0.1, 0, top);
  d.W(WALL, IN.u0, ROUGE_DOOR.u0, IN.t0 - 0.1, IN.t0, 0, top);
  d.W(WALL, ROUGE_DOOR.u1, IN.u1, IN.t0 - 0.1, IN.t0, 0, top);
  d.W(WALL, ROUGE_DOOR.u0, ROUGE_DOOR.u1, IN.t0 - 0.1, IN.t0, 2.95, top);
  d.W(0x1a0a12, ROUGE_DOOR.u0 - 0.1, ROUGE_DOOR.u0, IN.t0 - 0.1, IN.t0 + 0.1, 0, 2.95);
  d.W(0x1a0a12, ROUGE_DOOR.u1, ROUGE_DOOR.u1 + 0.1, IN.t0 - 0.1, IN.t0 + 0.1, 0, 2.95);
}

/** The hotel's interior (hidden until you're inside), built a slice at a time. */
export function* rougeInterior(b: Building3, city: THREE.Material, ghost: THREE.Material): Generator<void, Interior> {
  const k = new Kit(b);
  const d = new Draw(k);
  walls(d);
  yield* groundFloor(d, k);
  yield* upperFloor(d, ROUGE_FLOORS[1]);
  yield* upperFloor(d, ROUGE_FLOORS[2]);
  yield* stairs(d);
  const group = k.finish(city, ghost);
  group.visible = false;
  return { group, ...rougeLayout(b) };
}
