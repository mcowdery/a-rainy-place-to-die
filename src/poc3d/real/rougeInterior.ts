import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { addCar } from './cars';
import { placeModel } from './homes';
import { FixtureHalos, fixturesFrom, nearestFixtures, noFixtures, type Fixture } from './fixtureLights';
import { doorOpen } from './swingDoors';
import { Draw } from './interiorDraw';
import type { Interior } from './interiors';
import { Kit, text } from './kit';
import { localFrame, localRect, toLocal, toWorld } from './localFrame';
import { CORRIDOR, DOOR_HALF, FLOORS, FRONT_DOOR, GROUND, HOTEL, IN, ROOM_CEIL, ROOMS, roomsOn, SIDE_DOOR, STAIR, TUB, type PlanRoom, type R4 } from './rougePlan';

/**
 * Hotel Rouge (ホテル ルージュ), inside: the castle's keep, 27 x 23 m on three floors. You walk in through the front doors
 * (they slide open as you come) or the side doorway; every room has a door you open with E.
 *
 *   1F  the lobby with its room-select panel, the front office behind its little window, the garage (a car), the back
 *       hall (amenities, costumes, a vending machine), room 101, the laundry; the stair at the east end.
 *   2F  the corridor, 201 Castle, 202 Marine, 203 Space, 205 Resort, 206 Mirror, and the housekeeping room.
 *   3F  the corridor, 301 Onsen, 302 Karaoke, 303 the Rouge Suite, 305 Retro, 306 Sakura, and the manager's office.
 *
 * Where everything is lives in content/world3d/rouge_plan.json (rougePlan.ts); the rooms are baked Blender models
 * (scripts/blender/rouge_xl.py, one GLB a floor in assets/interiors/). This file keeps the layout (collision, floors,
 * the stair) and what moves or is a picture: the signs and the room panel, the doors that swing, the entrance's sliding
 * doors, the baths' glass and water, the people, the car.
 *
 * No room 4, as in many Japanese hotels. A switchback stair joins the floors. The local frame is the love hotel's (u along
 * the 34 m front, t inward).
 */

export const ROUGE_FLOORS = FLOORS;
/** The front doors (a gap in the front wall; the exterior keeps a pocket there, loveHotel.ts). */
export const ROUGE_DOOR = { u0: FRONT_DOOR[0], u1: FRONT_DOOR[1] } as const;
export { SIDE_DOOR };
const ST = STAIR;
const WELL: R4 = [ST.u0, IN.u1, ST.lane2[0], ST.lane1[1]];
const DIVIDER: R4 = [ST.u0, ST.u1, ST.lane2[1], ST.lane1[0]];
const WELL_WALL: R4 = [ST.u0, IN.u1, CORRIDOR.t1, ST.lane2[0]];
const SHAFT_NORTH: R4 = [ST.u0, IN.u1, ST.lane1[1], ST.lane1[1] + 0.1];
const CX = (FRONT_DOOR[0] + FRONT_DOOR[1]) / 2;

/** A moving part's step (seconds since the last frame, the camera), run by the interior's `tick`. */
type Anim = (dt: number, cam: THREE.Vector3) => void;

const G = GROUND;

function ring(front: boolean): R4[] {
  return [
    // The west wall, with the side doorway you walk through on the ground floor (the front ring).
    ...(front
      ? ([[IN.u0 - 0.3, IN.u0, IN.t0, SIDE_DOOR[0]], [IN.u0 - 0.3, IN.u0, SIDE_DOOR[1], IN.t1]] as R4[])
      : ([[IN.u0 - 0.3, IN.u0, IN.t0, IN.t1]] as R4[])),
    [IN.u1, IN.u1 + 0.3, IN.t0, IN.t1],
    [IN.u0 - 0.3, IN.u1 + 0.3, IN.t1, IN.t1 + 0.3],
    ...(front
      ? ([[IN.u0 - 0.3, FRONT_DOOR[0], IN.t0 - 0.3, IN.t0], [FRONT_DOOR[1], IN.u1 + 0.3, IN.t0 - 0.3, IN.t0]] as R4[])
      : ([[IN.u0 - 0.3, IN.u1 + 0.3, IN.t0 - 0.3, IN.t0]] as R4[])),
  ];
}

const roomRects = (floor: number): R4[] => roomsOn(floor).flatMap((r) => [...r.walls, ...r.solids]);

function upperRects(floor: number): R4[] {
  const out: R4[] = [...ring(false), WELL_WALL, DIVIDER, ...roomRects(floor)];
  // The top floor has no flight up: the well over the last flight and the landing is fenced off.
  if (floor === FLOORS[2]) out.push([ST.u0, IN.u1, ST.lane2[1], ST.lane1[1]], [ST.u1, IN.u1, ST.lane2[0], ST.lane2[1]]);
  return out;
}

function groundRects(): R4[] {
  const l1 = G.lobby[1];
  return [
    ...ring(true),
    [G.staffWall[0], G.staffWall[1], IN.t0, 12.4],
    // The garage's west wall, with the door through to the lobby; its back wall; the car.
    [l1, G.garage[0], IN.t0, G.garageDoor[0]],
    [l1, G.garage[0], G.garageDoor[1], 12.5],
    [G.garage[0], G.garage[1], 12.3, 12.5],
    [G.car[0] - 1.1, G.car[0] + 1.1, G.car[1] - 2.3, G.car[1] + 2.3],
    G.panelWall,
    WELL_WALL,
    DIVIDER,
    [ST.u0, ST.u1, ST.lane2[0], ST.lane2[1]],
    ...roomRects(0),
    G.amenity,
    G.costumes,
    G.vending,
    G.bench,
    [G.plant[0] - 0.3, G.plant[0] + 0.3, G.plant[1] - 0.3, G.plant[1] + 0.3],
    [l1 - 0.45, l1, 5.6, 6.7],
    ...G.hallBenches,
    G.payphone,
  ];
}

/** Heights of the stair pieces at a point (each flight and the landing, for both storeys), or none. */
function stairAt(u: number, t: number): number[] {
  const ys: number[] = [];
  const onLane = (lane: readonly [number, number]): boolean => t > lane[0] && t < lane[1];
  for (const base of [0, 5]) {
    if (u > ST.u0 && u < ST.u1 && onLane(ST.lane1)) ys.push(base + ((u - ST.u0) / (ST.u1 - ST.u0)) * ST.rise);
    if (u > ST.u0 && u < ST.u1 && onLane(ST.lane2)) ys.push(base + ST.rise + ((ST.u1 - u) / (ST.u1 - ST.u0)) * ST.rise);
    if (u >= ST.u1 && u < IN.u1 && t > ST.lane2[0] && t < ST.lane1[1]) ys.push(base + ST.rise);
  }
  return ys;
}

/** The hotel's layout alone (collision per level, floors, the stair, what counts as inside). */
export function rougeLayout(b: Building3): Omit<Interior, 'group'> {
  const f = localFrame(b);
  const W = (rs: readonly R4[]): Rect[] => rs.map((r) => localRect(f, r[0], r[1], r[2], r[3]));
  const g = W(groundRects());
  const f2 = W(upperRects(FLOORS[1]));
  const f3 = W(upperRects(FLOORS[2]));
  const stairs = W([...ring(false), WELL_WALL, DIVIDER, SHAFT_NORTH]);
  const inKeep = (u: number, t: number): boolean => u > IN.u0 && u < IN.u1 && t > IN.t0 && t < IN.t1;
  const inWell = (u: number, t: number): boolean => u > WELL[0] && u < WELL[1] && t > WELL[2] && t < WELL[3];
  return {
    colliders: (floor) => (floor < 1.25 ? g : floor < 3.75 ? stairs : floor < 6.25 ? f2 : floor < 8.75 ? stairs : f3),
    floorAt(x, z, current) {
      if (current > 14) return null;
      const [u, t] = toLocal(f, x, z);
      if (!inKeep(u, t)) return null;
      // In the stairwell only the stair counts (the ground floor under it is walled off); elsewhere the storeys.
      const cands: number[] = inWell(u, t) ? stairAt(u, t).filter((y) => Math.abs(y - current) < 1.5) : [...FLOORS];
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

/**
 * Covered (no rain inside): the keep, all three storeys and the stair, to its roof; out to its walls' outer faces
 * (0.3 m), so a slanting streak's tail can't lean in through a wall.
 */
export function rougeShelters(b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  return [{ rect: localRect(localFrame(b), IN.u0 - 0.3, IN.u1 + 0.3, IN.t0 - 0.3, IN.t1 + 0.3), y0: -1, y1: 15, enclosed: true }];
}

// ---- What the game draws over the baked rooms ----

const GOLD = 0xc8a050;

/** A door's number plate beside it, on the corridor side (the door itself is the model's frame and the game's leaf). */
function doorPlate(d: Draw, r: PlanRoom): void {
  const corridorSide: 1 | -1 = r.wall === 't1' ? 1 : -1;
  const t = r.wall === 't1' ? r.slab[3] + 0.02 : r.slab[2] - 0.02;
  const u = r.doorU + DOOR_HALF + 0.4;
  const label: Record<string, [string, string]> = { staff: ['事務室', 'OFFICE'], laundry: ['ランドリー', 'LAUNDRY'], housekeeping: ['清掃用具', 'HOUSEKEEPING'], office: ['支配人室', 'MANAGER'] };
  if (r.kind === 'service') {
    const [jp, en] = label[r.no];
    d.k.plane(d.sign(jp, en, '#2a2a2e', '#ffffff', 256, 96, false), 0.6, 0.22, u - 0.1, t, r.floor + 1.55, corridorSide > 0 ? 'in' : 'out', 1.0);
  } else d.k.plane(d.sign(r.no, '', '#1a0a12', '#e8c878', 256, 128), 0.4, 0.2, u, t, r.floor + 1.55, corridorSide > 0 ? 'in' : 'out', 1.0);
}

function* groundFloor(d: Draw, k: Kit, anims: Anim[]): Generator<void> {
  d.level = 0;
  frontDoors(d, anims);
  for (const door of DOORS.filter((dr) => dr.floor === 0)) swingDoor(d, door, anims);
  // The name over the doors.
  d.k.plane(d.k.canvas(640, 160, (g) => {
    g.fillStyle = '#2a0c1a';
    g.fillRect(0, 0, 640, 160);
    text(g, HOTEL.en, 320, 70, "italic bold 76px 'Georgia', serif", '#f0c8d8');
    text(g, 'ようこそ  WELCOME', 320, 130, "28px 'Yu Gothic', sans-serif", '#d8a8b8');
  }), 3.0, 0.75, CX, IN.t0 + 0.02, 3.45, 'in', 1.0);
  // The front office's lace curtain (you never see a face) and its FRONT plate, on the lobby side of its little window.
  const wy = (G.staffWindow[0] + G.staffWindow[1]) / 2;
  d.k.plane(d.k.canvas(256, 64, (g) => {
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(250,240,245,0.92)';
    for (let x = 0; x < 256; x += 16) {
      g.beginPath();
      g.arc(x + 8, 64, 10, Math.PI, 0);
      g.fill();
    }
    g.fillRect(0, 0, 256, 56);
  }), 1.4, 0.35, G.staffWall[1] + 0.035, wy, 1.45, '+u', 1.0);
  const lace = d.k.group.children[d.k.group.children.length - 1] as THREE.Mesh;
  (lace.material as THREE.MeshBasicMaterial).transparent = true;
  d.k.plane(d.sign('フロント', 'FRONT', '#1a0a12', '#e8c878', 256, 96, false), 0.8, 0.3, G.staffWall[1] + 0.03, wy, 2.0, '+u', 1.0);
  yield;

  // The room panel: every room's photo, lit when it's free (they all are, as far as the hotel says).
  const panel = d.k.canvas(1024, 480, (g) => {
    g.fillStyle = '#12060c';
    g.fillRect(0, 0, 1024, 480);
    text(g, 'ROOM SELECT  お部屋をお選びください', 512, 30, "bold 26px 'Yu Gothic', sans-serif", '#f0c8d8');
    const col: Record<string, string> = { dungeon: '#7a2020', castle: '#e890b0', marine: '#4a90c0', space: '#3a3a8a', resort: '#60a870', mirror: '#a0a0b8', onsen: '#b08a50', karaoke: '#9a50c8', suite: '#c02040', retro: '#c89040', sakura: '#f0a0c0' };
    const free = new Set(['201', '203', '301', '302']);
    ROOMS.filter((r) => r.kind === 'guest').forEach((r, i) => {
      const x = 16 + (i % 4) * 252;
      const yy = 56 + Math.floor(i / 4) * 140;
      const on = free.has(r.no);
      g.fillStyle = on ? col[r.theme] : '#2a2226';
      g.fillRect(x, yy, 240, 104);
      g.fillStyle = on ? 'rgba(255,255,255,0.85)' : 'rgba(120,110,115,0.6)';
      g.fillRect(x + 60, yy + 44, 120, 44);
      g.fillStyle = on ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.2)';
      g.fillRect(x + 60, yy + 36, 120, 12);
      text(g, `${r.no}  ${r.name}`, x + 120, yy + 20, "bold 22px 'Segoe UI', sans-serif", on ? '#ffffff' : '#6a6064');
      text(g, on ? '休憩 ¥4,800' : '使用中', x + 120, yy + 124, "bold 20px 'Yu Gothic', sans-serif", on ? '#80f0a0' : '#c05060');
    });
  });
  const p = G.panelWall;
  d.k.plane(panel, 4.3, 2.0, CX, p[2] - 0.06, 1.75, 'out', 1.1);
  d.person(CX - 0.6, 10.7, 0, 1, { body: 'man', pose: 'hold', color: [0.68, 0.52, 1.0], side: 1 });
  d.person(CX + 0.05, 10.6, -0.2, 1, { body: 'woman', pose: 'hold', color: [1.0, 0.42, 0.72], side: -1, hair: 'long', long: true });
  yield;

  // The garage: a car with its nose to the wall, its parking sign.
  const [cx, cz] = toWorld(k.f, G.car[0], G.car[1]);
  addCar(k.mb, { x: cx, z: cz, fx: -k.f.n[0], fz: -k.f.n[2], variant: 31, type: 'sedan', paint: 0x14141a });
  d.k.plane(d.sign('P', 'ROUGE PARKING', '#1a3a8a', '#ffffff', 256, 160, false), 0.8, 0.5, G.garage[1] - 1.7, 12.28, 2.6, 'out', 1.0);
  yield;

  // The back hall's signs: the amenity bar's (and each basket's label), the costume rack's, the vending machine's front.
  const a = G.amenity;
  d.k.plane(d.sign('アメニティ ご自由にどうぞ', 'FREE AMENITIES', '#3a1a28', '#f0c8d8', 640, 128, false), 2.4, 0.48, (a[0] + a[1]) / 2, a[2] + 0.02, 1.9, 'in', 1.0);
  const AMEN: [string, string][] = [['歯ブラシ', 'TOOTHBRUSH'], ['カミソリ', 'RAZOR'], ['シャワーキャップ', 'SHOWER CAP'], ['ヘアゴム', 'HAIR TIES'], ['綿棒', 'COTTON SWABS'], ['シートマスク', 'FACE MASKS'], ['ローション', 'LOTION']];
  AMEN.forEach(([jp, en], j) => d.k.plane(d.sign(jp, en, '#3a1a28', '#f0c8d8', 256, 96, false), 0.52, 0.2, a[0] + 0.2 + j * 0.6 + 0.225, a[3] + 0.016, 0.62, 'in', 1.0));
  const c = G.costumes;
  d.k.plane(d.sign('コスプレ無料貸出', 'COSTUMES TO BORROW', '#1a0a12', '#f0c8d8', 512, 128, false), 1.4, 0.35, IN.u0 + 0.02, (c[2] + c[3]) / 2, 2.2, '+u', 1.0);
  const v = G.vending;
  d.k.plane(d.k.canvas(256, 360, (g) => {
    g.fillStyle = '#f4f0f4';
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = '#e83a6a';
    g.fillRect(0, 0, 256, 42);
    text(g, '自動販売機 VENDING', 128, 22, "bold 20px 'Yu Gothic', sans-serif", '#ffffff');
    const rows: [string, string, string, number][][] = [
      [['お茶', '#4a9a4a', 'bottle', 120], ['ピンクソーダ', '#e8689a', 'bottle', 130], ['コーヒー', '#6a4a2a', 'can', 130]],
      [['ミネラル', '#6ab0e8', 'bottle', 110], ['ビール', '#d8a838', 'can', 300], ['エナジー', '#e8e050', 'can', 250]],
      [['おつまみ', '#c87a3a', 'box', 400], ['ミント', '#8ad8c8', 'box', 200], ['ナイトセット', '#8a4aa8', 'box', 1200]],
    ];
    rows.forEach((row, r) => row.forEach(([name, colr, kind, price], cc) => {
      const x = 12 + cc * 80;
      const y = 54 + r * 100;
      g.fillStyle = '#d8d4d8';
      g.fillRect(x, y, 72, 76);
      g.fillStyle = colr;
      if (kind === 'bottle') {
        g.fillRect(x + 26, y + 6, 20, 14);
        g.beginPath();
        g.roundRect(x + 20, y + 18, 32, 54, 8);
        g.fill();
      } else if (kind === 'can') g.fillRect(x + 20, y + 14, 32, 56);
      else g.fillRect(x + 12, y + 20, 48, 44);
      text(g, name, x + 36, y + 90, "bold 11px 'Yu Gothic', sans-serif", '#2a2a2e');
      text(g, `¥${price}`, x + 60, y + 12, "bold 11px 'Segoe UI', sans-serif", '#c81a4a');
    }));
  }), 0.62, 0.87, (v[0] + v[1]) / 2, v[3] + 0.035, 1.22, 'in', 1.0);
  for (const r of roomsOn(0)) doorPlate(d, r);
  d.person(15.4, 26.3, 1, 0.3, { body: 'woman', pose: 'phone', color: [0.95, 0.7, 0.85], hair: 'long', long: true });
}

function* upperFloor(d: Draw, y: number, anims: Anim[]): Generator<void> {
  d.level = y;
  const n = y === FLOORS[1] ? 2 : 3;
  // The floor sign on the corridor's east end wall.
  d.k.plane(d.sign(`${n}F`, n === 2 ? '201 - 206' : '301 - 306', '#1a0a12', '#e8c878', 256, 160), 0.8, 0.5, IN.u1 - 0.02, (CORRIDOR.t0 + CORRIDOR.t1) / 2, y + 2.2, '-u', 1.0);
  for (const door of DOORS.filter((dr) => dr.floor === y)) swingDoor(d, door, anims);
  for (const r of roomsOn(y)) doorPlate(d, r);
  if (n === 2) d.person(14.0, 13.6, -1, 0, { body: 'woman', color: [0.9, 0.9, 1.0], hair: 'bun', long: true });
  else {
    d.person(20.0, 13.4, 1, 0, { body: 'man', pose: 'walk', color: [0.8, 0.6, 1.0], phase: 0.3 });
    d.person(19.4, 13.8, 1, 0, { body: 'woman', pose: 'walk', color: [1.0, 0.5, 0.75], phase: 0.8, hair: 'long', long: true });
  }
  yield;
  for (const room of roomsOn(y).filter((r) => r.kind === 'guest')) {
    themedRoom(d, room, anims);
    yield;
  }
}

/**
 * A door you open and close (hotspot nodes with `swing`, hotel_rouge.yaml): a shut leaf in its doorway that swings
 * about 100 degrees when its node is used (real/swingDoors.ts). While it's shut the doorway is a wall (the node's
 * `gap`, the district's `blocked`). Directions are the building's local (u along the front, t inward).
 */
interface DoorDef {
  readonly key: string;
  readonly floor: number;
  /** The hinge (local u, t); the leaf's closed direction and the side it swings to (local unit vectors). */
  readonly hinge: readonly [number, number];
  readonly closed: readonly [number, number];
  readonly open: readonly [number, number];
  readonly width: number;
  readonly style: 'wine' | 'steel' | 'wood' | 'glass';
}
const SERVICE_STYLE: Record<string, DoorDef['style']> = { staff: 'wood', laundry: 'steel', housekeeping: 'steel', office: 'wood' };
const DOORS: readonly DoorDef[] = [
  ...ROOMS.map((r): DoorDef => {
    const tm = (r.slab[2] + r.slab[3]) / 2;
    return { key: r.key, floor: r.floor, hinge: [r.doorU - DOOR_HALF + 0.01, tm], closed: [1, 0], open: [0, r.wall === 't1' ? -1 : 1], width: 2 * DOOR_HALF - 0.02, style: r.kind === 'guest' ? 'wine' : SERVICE_STYLE[r.no] };
  }),
  // The baths' glass doors, hinged at the end nearer the bed wall, opening out into the room.
  ...ROOMS.filter((r) => r.bathDoor).map((r): DoorDef => {
    const b = r.bathDoor!;
    return { key: b.key, floor: r.floor, hinge: [b.hinge[0], b.hinge[1] + b.closed[1] * 0.02], closed: b.closed, open: [-1, 0], width: b.width - 0.04, style: 'glass' };
  }),
  { key: 'hotel_rouge.garage_door', floor: 0, hinge: [G.lobby[1] + 0.1, G.garageDoor[0] + 0.03], closed: [0, 1], open: [-1, 0], width: 1.14, style: 'steel' },
  { key: 'hotel_rouge.side_door', floor: 0, hinge: [IN.u0 - 0.15, SIDE_DOOR[0] + 0.03], closed: [0, 1], open: [1, 0], width: 0.94, style: 'wood' },
];

/** A door's face, by style (wine the guest rooms'; steel the garage's and the laundry's; wood the side door's and the offices'). */
function doorTexture(d: Draw, style: Exclude<DoorDef['style'], 'glass'>): THREE.Texture {
  return d.k.canvas(256, 512, (g) => {
    if (style === 'wine') {
      g.fillStyle = '#4a1830';
      g.fillRect(0, 0, 256, 512);
      g.strokeStyle = '#c8a050';
      g.lineWidth = 6;
      g.strokeRect(18, 18, 220, 476);
      g.lineWidth = 4;
      g.strokeRect(46, 50, 164, 190);
      g.strokeRect(46, 270, 164, 190);
      g.fillStyle = '#c8a050';
      g.beginPath();
      g.arc(222, 262, 9, 0, Math.PI * 2);
      g.fill();
    } else if (style === 'steel') {
      g.fillStyle = '#6a6e72';
      g.fillRect(0, 0, 256, 512);
      g.fillStyle = '#4a4e52';
      g.fillRect(0, 440, 256, 72);
      g.fillStyle = 'rgba(170,200,210,0.8)';
      g.fillRect(70, 70, 116, 150);
      g.strokeStyle = '#2a2e32';
      g.lineWidth = 6;
      g.strokeRect(70, 70, 116, 150);
      g.fillStyle = '#b8b8b8';
      g.fillRect(200, 250, 30, 12);
    } else {
      g.fillStyle = '#5a4a3a';
      g.fillRect(0, 0, 256, 512);
      g.strokeStyle = '#3a2a1a';
      g.lineWidth = 5;
      g.strokeRect(24, 40, 208, 200);
      g.strokeRect(24, 270, 208, 200);
      g.fillStyle = '#c8a050';
      g.beginPath();
      g.arc(222, 262, 9, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function swingDoor(d: Draw, door: DoorDef, anims: Anim[]): void {
  const f = d.k.f;
  const world = (v: readonly [number, number]): [number, number] => [f.r[0] * v[0] - f.n[0] * v[1], f.r[2] * v[0] - f.n[2] * v[1]];
  const [hx, hz] = toWorld(f, door.hinge[0], door.hinge[1]);
  const [cx, cz] = world(door.closed);
  const [ox, oz] = world(door.open);
  // Three's rotation about y turns +x to (cos a, -sin a) in (x, z): the angle of a world direction is atan2(-z, x).
  const shut = Math.atan2(-cz, cx);
  let delta = Math.atan2(-oz, ox) - shut;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const swing = delta * (100 / 90);
  const hinge = new THREE.Group();
  hinge.position.set(hx, door.floor, hz);
  hinge.rotation.y = shut;
  const h = door.style === 'steel' ? 2.1 : 2.2;
  if (door.style === 'glass') {
    // A frameless glass door: the pane, a steel rail top and bottom, a bar handle either side.
    const steel = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.17, 0.18) });
    const pane = new THREE.Mesh(new THREE.BoxGeometry(door.width, h, 0.012), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.27, 0.3), transparent: true, opacity: 0.16, depthWrite: false }));
    pane.position.set(door.width / 2, h / 2, 0);
    pane.renderOrder = 3;
    hinge.add(pane);
    for (const [bx, by, bw, bh, bd] of [[door.width / 2, 0.04, door.width, 0.08, 0.03], [door.width / 2, h - 0.03, door.width, 0.06, 0.03], [door.width - 0.12, 1.1, 0.03, 0.5, 0.09]] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), steel);
      bar.position.set(bx, by, 0);
      hinge.add(bar);
    }
  } else {
    const tint = door.style === 'wine' ? new THREE.Color(0.62, 0.55, 0.58) : new THREE.Color(0.7, 0.68, 0.66);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(door.width, h, 0.04), new THREE.MeshBasicMaterial({ map: doorTexture(d, door.style), color: tint }));
    leaf.position.set(door.width / 2, h / 2, 0);
    hinge.add(leaf);
  }
  let angle = 0;
  anims.push((dt) => {
    angle += Math.max(-dt * 2.4, Math.min(dt * 2.4, (doorOpen(door.key) ? 1 : 0) - angle));
    hinge.rotation.y = shut + swing * angle * angle * (3 - 2 * angle);
  });
  d.k.group.add(hinge);
}

/**
 * The entrance's automatic glass doors (the gap in the front wall, FRONT_DOOR): two gold-framed tinted leaves on the
 * wall's inside that slide apart into the wall as you come within a few metres, from either side, and close again.
 * (From the street the building's own tinted doors show: this is the inside of them.)
 */
function frontDoors(d: Draw, anims: Anim[]): void {
  const f = d.k.f;
  const [x, z] = toWorld(f, CX, IN.t0 + 0.04);
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = Math.atan2(f.n[0], f.n[2]);
  const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.28, 0.36, 0.4), transparent: true, opacity: 0.3, depthWrite: false });
  const gold = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.46, 0.2) });
  const half = (FRONT_DOOR[1] - FRONT_DOOR[0]) / 2;
  const leaves = [-1, 1].map((side) => {
    const g = new THREE.Group();
    const w = half;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, 2.9, 0.02), glass);
    pane.renderOrder = 3;
    g.add(pane);
    for (const [bx, by, bw, bh] of [[-w / 2 + 0.03, 0, 0.06, 2.9], [w / 2 - 0.03, 0, 0.06, 2.9], [0, 1.43, w, 0.06], [0, -1.43, w, 0.06], [0, -0.7, w, 0.04]] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.035), gold);
      bar.position.set(bx, by, 0);
      g.add(bar);
    }
    g.position.set(side * (w / 2), 1.45, 0);
    root.add(g);
    return { g, side, base: side * (w / 2) };
  });
  let slide = 0;
  anims.push((dt, cam) => {
    const [u, t] = toLocal(f, cam.x, cam.z);
    const near = Math.abs(u - CX) < 3.4 && t > 0.5 && t < 8 && cam.y < 3.2;
    slide += Math.max(-dt * 1.8, Math.min(dt * 1.8, (near ? 1 : 0) - slide));
    const e = slide * slide * (3 - 2 * slide);
    for (const l of leaves) l.g.position.x = l.base + l.side * (half - 0.05) * e;
  });
  d.k.group.add(root);
}

/**
 * Each guest room's tub water. The tub is the baked model (its sizes are the plan's `tub`, its centre the plan's layout
 * `tub`); the water is a surface with a shader of its own (the user, 2026-10-12: "make the hot tub water look like real
 * water"; it had been a tinted disc with ripple light drifting over it). A small swell and the chop a tub's jets make
 * tilt the surface's normal; looking down you see into the water (its colour, and a net of caustic light moving over
 * the basin), and at a shallow angle it mirrors the room instead (Fresnel): a dark ceiling, and the glint of the lamps.
 * The room it mirrors is made up (the bake is all there is of it): the theme's light colour stands for its lamps.
 */
const WATER_Y = TUB.water;
const TUB_R = TUB.rIn;
const ONSEN_TUB = TUB.onsen;
const WATER: Record<string, { tint: [number, number, number]; light: [number, number, number] }> = {
  castle: { tint: [0.2, 0.42, 0.5], light: [1.0, 0.75, 0.85] },
  space: { tint: [0.05, 0.12, 0.4], light: [0.45, 0.6, 1.0] },
  karaoke: { tint: [0.3, 0.08, 0.36], light: [1.0, 0.45, 0.95] },
  onsen: { tint: [0.3, 0.36, 0.3], light: [1.0, 0.8, 0.55] },
  marine: { tint: [0.05, 0.3, 0.42], light: [0.5, 0.9, 1.0] },
  resort: { tint: [0.1, 0.4, 0.36], light: [1.0, 0.9, 0.6] },
  mirror: { tint: [0.16, 0.17, 0.28], light: [0.85, 0.85, 1.0] },
  suite: { tint: [0.3, 0.1, 0.1], light: [1.0, 0.65, 0.5] },
  retro: { tint: [0.34, 0.14, 0.3], light: [1.0, 0.55, 0.85] },
  sakura: { tint: [0.36, 0.24, 0.28], light: [1.0, 0.8, 0.85] },
};

const WATER_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTint;
  uniform vec3 uLight;
  uniform vec2 uCentre;
  uniform float uSize;
  varying vec3 vWorld;
  // The surface's height: four crossing swells and the rings the jets push out from the middle.
  float height(vec2 p) {
    float t = uTime;
    float h = 0.011 * sin(dot(p, vec2(6.2, 3.4)) + t * 1.7);
    h += 0.008 * sin(dot(p, vec2(-6.0, 7.5)) - t * 2.1);
    h += 0.005 * sin(dot(p, vec2(4.4, -13.9)) + t * 2.9);
    h += 0.003 * sin(dot(p, vec2(22.0, 13.8)) - t * 3.7);
    float d = length(p - uCentre);
    h += 0.004 * sin(d * 16.0 - t * 5.0) * smoothstep(uSize, 0.0, d);
    return h;
  }
  // Caustics: bright lines where two warped wave fields cross zero, drifting.
  float caustic(vec2 p) {
    float t = uTime;
    vec2 q = p + 0.3 * vec2(sin(p.y * 1.9 + t * 0.9), cos(p.x * 1.7 - t * 0.8));
    q += 0.17 * vec2(sin(q.y * 3.7 - t * 1.3), cos(q.x * 3.3 + t * 1.1));
    float a = 1.0 - abs(0.5 * (sin(q.x * 4.0) + sin(q.y * 4.0)));
    float b = 1.0 - abs(0.5 * (sin((q.x + q.y) * 2.9 + t * 0.5) + sin((q.x - q.y) * 3.4 - t * 0.4)));
    return pow(a, 7.0) * 0.65 + pow(b, 9.0) * 0.5;
  }
  void main() {
    vec2 p = vWorld.xz;
    float e = 0.012;
    float h0 = height(p);
    vec3 n = normalize(vec3(-(height(p + vec2(e, 0.0)) - h0) / e, 1.0, -(height(p + vec2(0.0, e)) - h0) / e));
    vec3 v = normalize(cameraPosition - vWorld);
    float nv = clamp(dot(n, v), 0.0, 1.0);
    float fresnel = 0.03 + 0.97 * pow(1.0 - nv, 5.0);
    vec3 r = reflect(-v, n);
    // The room in the water: dark, brighter overhead, and two lamps' glints.
    vec3 room = uLight * (0.035 + 0.16 * smoothstep(0.55, 1.0, r.y));
    float glint = pow(max(dot(r, normalize(vec3(0.35, 0.9, 0.25))), 0.0), 220.0) + 0.6 * pow(max(dot(r, normalize(vec3(-0.45, 0.85, -0.3))), 0.0), 140.0);
    // Into the water: its colour, lit by the caustic net (seen bent by the surface).
    vec3 deep = uTint * (0.5 + 1.5 * caustic(p * 2.2 + n.xz * 0.9)) * (0.6 + 0.4 * uLight);
    vec3 col = mix(deep, room, fresnel) + uLight * glint * 2.2;
    gl_FragColor = vec4(col, mix(0.72, 0.97, fresnel));
  }
`;

function bathWater(d: Draw, room: PlanRoom, anims: Anim[]): void {
  if (!room.tub) return;
  const spec = WATER[room.theme] ?? WATER.castle;
  const f = d.k.f;
  const [x, z] = toWorld(f, room.tub.u, room.tub.t);
  const rect = room.theme === 'onsen';
  const geo = (rect ? new THREE.PlaneGeometry(ONSEN_TUB[0], ONSEN_TUB[1], 1, 1) : new THREE.CircleGeometry(TUB_R, 48)).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(...spec.tint) },
      uLight: { value: new THREE.Color(...spec.light) },
      uCentre: { value: new THREE.Vector2(x, z) },
      uSize: { value: rect ? Math.max(...ONSEN_TUB) / 2 : TUB_R },
    },
    transparent: true,
    depthWrite: false,
  });
  const water = new THREE.Mesh(geo, mat);
  water.position.set(x, room.floor + WATER_Y, z);
  water.rotation.y = Math.atan2(f.n[0], f.n[2]);
  water.renderOrder = 2;
  // (each tub keeps its own time, so no two tubs move alike)
  let t = (room.rect[0] * 7.3 + room.floor) % 50;
  anims.push((dt) => {
    t += dt;
    mat.uniforms.uTime.value = t;
  });
  d.k.group.add(water);
}

/** A guest room's glass and pictures (the room and its furniture are the baked model): the bath's panes, its water, the theme's canvases. */
function themedRoom(d: Draw, room: PlanRoom, anims: Anim[]): void {
  const y = room.floor;
  const fwd = room.wall === 't1';
  const bath = room.bath;
  if (bath) {
    // The glass on the bath's two open sides: along its west edge (but for its door, a leaf of its own, with a fixed
    // light over it), and along the edge away from the bed wall.
    const g = room.bathDoor?.gap;
    if (g) {
      d.k.paneT(bath[0], bath[2], g[2], y, y + 2.4);
      d.k.paneT(bath[0], g[3], bath[3], y, y + 2.4);
      d.k.paneT(bath[0], g[2], g[3], y + 2.2, y + 2.4);
    } else d.k.paneT(bath[0], bath[2], bath[3], y, y + 2.4);
    d.k.pane(bath[0], bath[1], y, y + 2.4, fwd ? bath[3] : bath[2]);
  }
  bathWater(d, room, anims);
  const [u0, u1] = [room.rect[0], room.rect[1]];
  const facing: 'in' | 'out' = fwd ? 'in' : 'out'; // looking from the far wall toward the door
  switch (room.theme) {
    case 'space':
      d.k.plane(d.k.canvas(512, 512, (g) => {
        g.fillStyle = '#05061a';
        g.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 360; i++) {
          const a = (i * 2654435761) >>> 0;
          g.fillStyle = `rgba(255,255,255,${0.4 + (a % 60) / 100})`;
          g.fillRect(a % 512, (a >>> 9) % 512, 1 + (a % 3 === 0 ? 1 : 0), 1 + (a % 3 === 0 ? 1 : 0));
        }
        const neb = g.createRadialGradient(330, 200, 10, 330, 200, 220);
        neb.addColorStop(0, 'rgba(160,80,220,0.5)');
        neb.addColorStop(1, 'rgba(160,80,220,0)');
        g.fillStyle = neb;
        g.fillRect(0, 0, 512, 512);
      }), u1 - u0 - 0.4, room.D - 0.6, (u0 + u1) / 2, (room.rect[2] + room.rect[3]) / 2, y + ROOM_CEIL - 0.02, 'out', 1.0).rotation.set(Math.PI / 2, 0, 0);
      break;
    case 'karaoke': {
      const [hu, ht] = room.pt(2.55, 0.37);
      const heart = d.k.plane(d.k.canvas(256, 256, (g) => {
        g.clearRect(0, 0, 256, 256);
        g.fillStyle = '#ff3a6a';
        g.beginPath();
        g.moveTo(128, 236);
        g.bezierCurveTo(-60, 110, 40, -40, 128, 60);
        g.bezierCurveTo(216, -40, 316, 110, 128, 236);
        g.fill();
      }), 1.7, 1.7, hu, ht, y + 2.35, facing, 1.2);
      (heart.material as THREE.MeshBasicMaterial).transparent = true;
      // The karaoke screen: the TV on the west wall (the plan's layout `tv`), facing the sofa.
      const [su, st] = room.pt(0.165, 5.5);
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
      }), 2.0, 1.12, su, st, y + 1.575, '+u', 1.2);
      break;
    }
  }
}

/**
 * The stair itself is the baked model. The top floor has no flight up, so where the next one would start (the hall's edge
 * over the flight below) there is a balustrade: glass, and its gold top. (It had been a rail the whole length of the
 * shaft at the top floor's height, which from the stair below was a bar hanging across the well: the user, 2026-10-12.)
 */
function* stairs(d: Draw): Generator<void> {
  d.level = 0;
  const y = FLOORS[2];
  d.k.paneT(ST.u0 + 0.03, ST.lane1[0], ST.lane1[1], y, y + 1.05);
  d.W(GOLD, ST.u0, ST.u0 + 0.06, ST.lane1[0], ST.lane1[1], y + 1.05, y + 1.1, true);
  yield;
}

/** The bake's lights, per floor (scripts/blender/rouge_xl.py --lights): what the game makes real at each fixture. */
const LIGHT_FILES = import.meta.glob('../../../content/world3d/rouge_lights_*.json', { eager: true, import: 'default' }) as Record<string, (number | string)[][]>;
/** The baked pictures are shown a little under their own brightness: the rooms are dimly lit, and the lamps (the halos, the light on a body) are what's bright. */
const DIM = 0.8;

/** The hotel's interior (hidden until you're inside), built a slice at a time. */
export function* rougeInterior(b: Building3, city: THREE.Material, ghost: THREE.Material): Generator<void, Interior> {
  const k = new Kit(b);
  const d = new Draw(k);
  const anims: Anim[] = [];
  yield* groundFloor(d, k, anims);
  yield* upperFloor(d, FLOORS[1], anims);
  yield* upperFloor(d, FLOORS[2], anims);
  yield* stairs(d);
  const group = k.finish(city, ghost);
  for (const m of ['rouge_xl_ground', 'rouge_xl_f2', 'rouge_xl_f3']) placeModel(group, b, 0, m, DIM);
  // The lamps: a glow at each (one draw), and the nearest light the body.
  const f = k.f;
  const fixtures: Fixture[] = Object.values(LIGHT_FILES).flatMap((l) => fixturesFrom(l, (u, t) => toWorld(f, u, t)));
  const halos = new FixtureHalos(fixtures);
  group.add(halos.object);
  let clock = 0;
  return {
    group,
    ...rougeLayout(b),
    tick: (dt, cam) => {
      clock += dt;
      for (const a of anims) a(dt, cam);
      halos.update(clock, 68, window.innerHeight);
      nearestFixtures(fixtures, cam.x, cam.y, cam.z, clock);
    },
    off: noFixtures,
  };
}
