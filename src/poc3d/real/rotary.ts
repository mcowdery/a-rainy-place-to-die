import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import { addTree } from '../models/trees';
import type { Building3 } from '../district/plan';
import { addCar } from './cars';
import { subtract } from './ground';
import { Kit, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toLocal, toWorld } from './localFrame';
import { EMIT, KIND } from './meshBuilder';
import { PASSAGE_T } from './subwayStation';
import { parkedBus } from './traffic';

/**
 * The terminal's west exit (landmark: rotary): a bus and taxi rotary in front of Toto-Chuo station.
 * On the street: a one-way loop road (clockwise: traffic keeps left) round an island with trees and a
 * clock tower; bus bays along its south kerb (buses standing, shelters, bay signs, people queueing),
 * a taxi rank along its north kerb; two stair kiosks down to the underground mall. Below: the mall
 * (東都中央地下街), a corridor lined with shops at the concourse level (-5 m) running east from under the
 * plaza, under the Toto Line, into the concourse of Kaburo-nishiguchi on the Yakō Line (that station's
 * stamp sets passage: u1, opening its concourse wall at PASSAGE_T).
 *
 * Local frame (localFrame.ts): u along the 80 m street face (the stamp faces north across the road the
 * Yakō Line runs under, from Kaburo-nishiguchi's side, so the station and the plaza share t), t inward
 * (south), 50 m deep. The corridor reaches past the footprint (u < 0) under the tracks.
 */
export const ROTARY = { fw: 80, depth: 50, b1: -5 } as const;

/** The loop road's outer edge and the island inside it. */
const RING = { u0: 6, u1: 74, t0: 5, t1: 33 } as const;
const ISLAND = { u0: 14, u1: 66, t0: 13, t1: 25 } as const;
/** The arms joining the loop to the road in front. */
const ARMS = [[6, 14], [66, 74]] as const;
/** Stairs down to the mall (top at t1 on the plaza, bottom at t0 by the corridor). */
const STAIRS = [[1.5, 4.5], [75.5, 78.5]] as const;
const ST = { t0: 4.5, t1: 13.5 } as const;
/** The mall corridor: from the Kaburo-nishiguchi concourse (u -31) to the far end of the plaza. */
const HALL = { u0: -31, u1: 80, t0: PASSAGE_T[0], t1: PASSAGE_T[1], ceil: -1.5 } as const;
/** Where the corridor meets the station's concourse wall (u < JOIN is the station's). */
const JOIN = -30;
const BAYS = [16, 30, 44, 58];
const BAY_TO = ['朝霧公園 Asagiri-kōen', '東都駅前 Tōto-ekimae', '歌舞路 Kaburo', '空港 Airport'];
const TAXIS = [21, 26.2, 31.4, 36.6, 41.8, 47];
const TREES: readonly (readonly [number, number])[] = [[19, 16], [19, 22], [61, 16], [61, 22], [30, 19], [50, 19]];
const CLOCK = [40, 19] as const;

const inStair = (u: number, t: number): boolean => t >= ST.t0 && t <= ST.t1 && STAIRS.some(([a, b]) => u >= a && u <= b);
const inHall = (u: number, t: number): boolean =>
  (u >= HALL.u0 && u <= HALL.u1 && t >= HALL.t0 && t <= HALL.t1) || (t >= HALL.t1 && t <= ST.t0 && STAIRS.some(([a, b]) => u >= a && u <= b));

/** Floor height at a world point: the stairs, or the mall for a walker already below (else null: the street). */
export function rotaryFloor(b: Building3, x: number, z: number, current: number): number | null {
  const [u, t] = toLocal(localFrame(b), x, z);
  if (inStair(u, t)) return (ROTARY.b1 * (ST.t1 - t)) / (ST.t1 - ST.t0);
  if (current < -2.5 && current > -8 && inHall(u, t)) return ROTARY.b1;
  return null;
}

type R4 = readonly [number, number, number, number];

function collidersLocal(street: boolean): R4[] {
  const out: R4[] = [];
  if (street) {
    // Rails round the stairwells (open at their heads, to the south).
    for (const [a, b] of STAIRS) out.push([a - 0.3, a, ST.t0, ST.t1], [b, b + 0.3, ST.t0, ST.t1], [a - 0.3, b + 0.3, ST.t0 - 0.3, ST.t0]);
    // Buses in their bays, taxis in the rank, the shelters' backs, the island's planters and clock.
    for (const c of BAYS) out.push([c - 5.3, c + 5.3, 29.9, 32.5], [c - 2.2, c + 2.2, 36.3, 36.6]);
    for (const c of TAXIS) out.push([c - 2.4, c + 2.4, 5.9, 7.7]);
    for (const [u, t] of TREES) out.push([u - 1.3, u + 1.3, t - 1.3, t + 1.3]);
    out.push([CLOCK[0] - 0.7, CLOCK[0] + 0.7, CLOCK[1] - 0.7, CLOCK[1] + 0.7]);
    return out;
  }
  // The mall: its walls (shopfronts), open to the stairs and at the station end, closed at the far end.
  out.push([JOIN, HALL.u1, HALL.t0 - 0.3, HALL.t0]);
  let u = JOIN;
  for (const [a, b] of STAIRS) {
    out.push([u, a, HALL.t1, HALL.t1 + 0.3]);
    u = b;
  }
  out.push([u, HALL.u1, HALL.t1, HALL.t1 + 0.3], [HALL.u1, HALL.u1 + 0.3, HALL.t0, HALL.t1]);
  for (const [a, b] of STAIRS) out.push([a - 0.3, a, HALL.t1, ST.t1], [b, b + 0.3, HALL.t1, ST.t1]);
  return out;
}

const cache = new Map<string, Rect[]>();

/** Collision at a walker's floor: the plaza (street) or the mall (below). */
export function rotaryColliders(b: Building3, floor: number): Rect[] {
  // The mall is at the concourse level; deeper (subway platforms) it isn't there.
  if (floor <= -8) return [];
  const street = floor > -1;
  const key = `${b.id}:${street}`;
  let out = cache.get(key);
  if (!out) {
    const f = localFrame(b);
    out = collidersLocal(street).map(([u0, u1, t0, t1]) => localRect(f, u0, u1, t0, t1));
    cache.set(key, out);
  }
  return out;
}

export function rotaryHoles(b: Building3): Rect[] {
  const f = localFrame(b);
  return STAIRS.map(([a, bb]) => localRect(f, a, bb, ST.t0, ST.t1));
}

export function rotaryShelters(b: Building3): { rect: Rect; y0: number; y1: number; enclosed?: boolean }[] {
  const f = localFrame(b);
  return [
    { rect: localRect(f, HALL.u0, HALL.u1, HALL.t0, HALL.t1 + 1), y0: -7, y1: -0.9, enclosed: true },
    ...STAIRS.map(([a, bb]) => ({ rect: localRect(f, a - 0.4, bb + 0.4, ST.t0 - 0.4, ST.t1), y0: -7, y1: 3 })),
    ...BAYS.map((c) => ({ rect: localRect(f, c - 2.2, c + 2.2, 33.8, 36.6), y0: 0, y1: 2.5 })),
  ];
}

export function rotaryLights(b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  const warm: [number, number, number] = [1.0, 0.82, 0.6];
  return [
    ...[3, 20, 40, 60, 77].map((u) => L(u, 2.5, 9, warm, 0.7)),
    ...[3, 20, 40, 60, 77].map((u) => L(u, 43, 9, warm, 0.6)),
    ...BAYS.map((c) => L(c, 35, 5, [0.85, 0.92, 1.0], 0.6)),
    L(40, 19, 10, [1.0, 0.9, 0.75], 0.5),
    ...STAIRS.map(([a, bb]) => L((a + bb) / 2, 12, 5, [0.9, 0.95, 1.0], 0.7)),
  ];
}

export interface RotaryBuilt {
  readonly group: THREE.Group;
  /** The mall below (shown below ground, or near the stairs). */
  readonly below: THREE.Group;
  update(u: import('./city').CityUniforms): void;
}

export function buildRotary(b: Building3, city: THREE.Material, ghost: THREE.Material): RotaryBuilt {
  const k = new Kit(b);
  const f = k.f;
  const W = ROTARY.fw;
  const D = ROTARY.depth;

  // ---- The plaza: paving, the loop road and its arms (asphalt), the island (raised), paint ----
  const road: Rect[] = [{ x: RING.u0, y: RING.t0, w: RING.u1 - RING.u0, h: RING.t1 - RING.t0 }, ...ARMS.map(([a, bb]) => ({ x: a, y: 0, w: bb - a, h: RING.t0 }))];
  const holes = STAIRS.map(([a, bb]) => ({ x: a, y: ST.t0, w: bb - a, h: ST.t1 - ST.t0 }));
  for (const p of subtract({ x: 0, y: 0, w: W, h: D }, [...road, ...holes])) k.kind(KIND.sidewalk, 0xa8a298, p.x, p.x + p.w, p.y, p.y + p.h, 0, 0.15);
  for (const r of road) for (const p of subtract(r, [{ x: ISLAND.u0, y: ISLAND.t0, w: ISLAND.u1 - ISLAND.u0, h: ISLAND.t1 - ISLAND.t0 }])) k.kind(KIND.asphalt, 0x2a2a2e, p.x, p.x + p.w, p.y, p.y + p.h, 0, 0.02);
  k.kind(KIND.sidewalk, 0x9a968c, ISLAND.u0, ISLAND.u1, ISLAND.t0, ISLAND.t1, 0, 0.18);
  // Lane lines round the loop, bay boxes, the crossings to the island.
  const paint = (hex: number, u0: number, u1: number, t0: number, t1: number): void => k.kind(KIND.paint, hex, u0, u1, t0, t1, 0.02, 0.026);
  paint(0xd8d8d0, ISLAND.u0 - 4.1, ISLAND.u1 + 4.1, ISLAND.t0 - 4.1, ISLAND.t0 - 3.95);
  paint(0xd8d8d0, ISLAND.u0 - 4.1, ISLAND.u1 + 4.1, ISLAND.t1 + 3.95, ISLAND.t1 + 4.1);
  for (const c of BAYS) {
    paint(0xd8a830, c - 5.8, c + 5.8, RING.t1 - 3.4, RING.t1 - 3.3);
    paint(0xd8a830, c - 5.8, c - 5.7, RING.t1 - 3.4, RING.t1);
    paint(0xd8a830, c + 5.7, c + 5.8, RING.t1 - 3.4, RING.t1);
  }
  for (let t = RING.t0 + 0.4; t < ISLAND.t0 - 0.3; t += 0.9) paint(0xd8d8d0, 38, 42, t, t + 0.45);
  for (let t = ISLAND.t1 + 0.4; t < RING.t1 - 0.3; t += 0.9) paint(0xd8d8d0, 38, 42, t, t + 0.45);

  // ---- The island: trees in planters, benches, the clock tower ----
  for (const [u, t] of TREES) {
    k.box(0x8e8a82, u - 1.2, u + 1.2, t - 1.2, t + 1.2, 0.18, 0.7);
    const [x, z] = toWorld(f, u, t);
    addTree(k.mb, { x, z, species: u === 30 || u === 50 ? 'ginkgo' : 'zelkova', size: 0.7, seed: u * 7 + t, lift: 0.5 });
  }
  k.box(0x5a5c60, CLOCK[0] - 0.6, CLOCK[0] + 0.6, CLOCK[1] - 0.6, CLOCK[1] + 0.6, 0.18, 7);
  k.box(0x3a3c40, CLOCK[0] - 0.9, CLOCK[0] + 0.9, CLOCK[1] - 0.9, CLOCK[1] + 0.9, 7, 8.8);
  const face = k.canvas(256, 256, (g) => {
    g.fillStyle = '#f4f0e4';
    g.beginPath();
    g.arc(128, 128, 120, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 6;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96);
      g.lineTo(128 + Math.sin(a) * 110, 128 - Math.cos(a) * 110);
      g.stroke();
    }
    // Twenty to midnight.
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + Math.sin(-0.17) * 64, 128 - Math.cos(-0.17) * 64);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + Math.sin((40 / 60) * Math.PI * 2) * 92, 128 - Math.cos((40 / 60) * Math.PI * 2) * 92);
    g.stroke();
  });
  for (const [facing, du, dt] of [['out', 0, -0.91], ['in', 0, 0.91], ['+u', 0.91, 0], ['-u', -0.91, 0]] as const) k.plane(face, 1.5, 1.5, CLOCK[0] + du, CLOCK[1] + dt, 7.9, facing, 1.2);
  for (const t of [ISLAND.t0 + 1.2, ISLAND.t1 - 1.2]) {
    for (const u of [25, 35, 45, 55]) {
      k.box(0x7a5a3c, u - 0.8, u + 0.8, t - 0.22, t + 0.22, 0.6, 0.65);
      k.box(0x3a3c40, u - 0.75, u + 0.75, t - 0.2, t + 0.2, 0.18, 0.6);
    }
  }
  // The west-exit sign on a low wall at the plaza's north-west corner.
  k.box(0x6a6660, 60, 72, 0.6, 1.4, 0, 1.2);
  k.plane(k.canvas(900, 110, (g) => {
    g.fillStyle = '#16181c';
    g.fillRect(0, 0, 900, 110);
    text(g, '東都中央駅 西口  TŌTO-CHŪŌ STATION · WEST EXIT', 450, 58, "bold 44px 'Yu Gothic', 'Meiryo', sans-serif", '#e8e6f0');
  }), 11.6, 1.4, 66, 0.58, 0.7, 'out', 1.1);

  // ---- Bus bays: shelters, bay signs, buses standing, people queueing ----
  const busGroup = new THREE.Group();
  BAYS.forEach((c, i) => {
    k.box(0x3a3c40, c - 2.2, c + 2.2, 33.8, 36.6, 2.4, 2.55);
    for (const u of [c - 2.1, c + 2.1]) k.box(0x8a8e94, u - 0.05, u + 0.05, 36.3, 36.5, 0, 2.4);
    k.pane(c - 2.1, c + 2.1, 0.2, 2.3, 36.45);
    k.box(0x7a5a3c, c - 1.4, c + 1.4, 35.8, 36.2, 0.45, 0.5);
    k.glow([0.9, 0.95, 1.0], c - 2, c + 2, 34.6, 34.8, 2.36, 2.4);
    k.box(0x8a8c90, c + 2.5, c + 2.6, 33.4, 33.5, 0, 2.9);
    k.plane(k.canvas(260, 200, (g) => {
      g.fillStyle = '#1a4a8a';
      g.fillRect(0, 0, 260, 200);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(52, 58, 38, 0, Math.PI * 2);
      g.fill();
      text(g, String(i + 1), 52, 62, "bold 56px 'Arial', sans-serif", '#1a4a8a');
      text(g, 'のりば', 170, 60, "bold 40px 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff');
      text(g, BAY_TO[i].split(' ')[0], 130, 128, "bold 36px 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff');
      text(g, BAY_TO[i].split(' ')[1], 130, 170, "24px 'Arial', sans-serif", '#c8d8f0');
    }), 1.3, 1.0, c + 2.55, 33.3, 2.4, 'out', 1.15);
    const bus = parkedBus(BAY_TO[i].split(' ')[0], city, BAY_TO[i].split(' ').slice(1).join(' '));
    const [x, z] = toWorld(f, c, 31.2);
    bus.position.set(x, 0.02, z);
    // Heading +u (keep left: the doors, on the bus's left, open onto the south kerb).
    const d = [f.r[0], f.r[2]];
    bus.rotation.y = Math.atan2(d[0], d[1]);
    busGroup.add(bus);
    for (let q = 0; q < 2 + (i % 3); q++) k.person(c - 1.2 + q * 0.7, 37.6 + q * 0.6, 0, -1, { pose: q % 2 ? 'phone' : 'stand', body: q % 3 === 2 ? 'woman' : 'man' });
  });
  // ---- The taxi rank: taxis nose to tail along the north kerb, heading -u; a sign and a short queue ----
  TAXIS.forEach((c, i) => {
    const [x, z] = toWorld(f, c, 6.8);
    addCar(k.mb, { x, z, fx: -f.r[0], fz: -f.r[2], variant: 4000 + i * 37, type: 'taxi', paint: [0x121316, 0xe0a818, 0x1f5a36][i % 3] });
  });
  k.box(0x8a8c90, 17.4, 17.5, 4.2, 4.3, 0, 2.9);
  k.plane(k.canvas(300, 120, (g) => {
    g.fillStyle = '#e0a818';
    g.fillRect(0, 0, 300, 120);
    text(g, 'タクシーのりば', 150, 44, "bold 40px 'Yu Gothic', 'Meiryo', sans-serif", '#1a1a1a');
    text(g, 'TAXI', 150, 94, "bold 40px 'Arial', sans-serif", '#1a1a1a');
  }), 1.4, 0.56, 17.45, 4.15, 2.6, 'in', 1.15);
  for (let q = 0; q < 3; q++) k.person(15.5 - q * 0.8, 3.8, 1, 0, { pose: q === 1 ? 'phone' : 'pockets', body: q === 2 ? 'woman' : 'man' });

  // ---- Plaza lamps (north and south edges) ----
  for (const t of [2.5, 43]) {
    for (const u of [3, 20, 40, 60, 77]) {
      if (t < 5 && ARMS.some(([a, bb]) => u > a && u < bb)) continue;
      k.post(0x3a3c40, u, t, 0, 4.2, 0.08, 6);
      k.glow([1.0, 0.85, 0.62], u - 0.2, u + 0.2, t - 0.2, t + 0.2, 4.2, 4.6, EMIT.lamp);
    }
  }

  // ---- The stair kiosks: steps down to the mall, walls, handrails, a canopy with the mall's sign ----
  for (const [a, bb] of STAIRS) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const t0 = ST.t0 + (i * (ST.t1 - ST.t0)) / n;
      const t1s = t0 + (ST.t1 - ST.t0) / n;
      const top = (ROTARY.b1 * (ST.t1 - t1s)) / (ST.t1 - ST.t0);
      k.lit(i % 2 ? 0x9a968e : 0x908c84, a, bb, t0, t1s, ROTARY.b1, Math.max(ROTARY.b1 + 0.01, top), true);
    }
    k.lit(0xd8d2c4, a - 0.3, a, HALL.t1, ST.t1, ROTARY.b1, 0, true);
    k.lit(0xd8d2c4, bb, bb + 0.3, HALL.t1, ST.t1, ROTARY.b1, 0, true);
    k.lit(0xd8d2c4, a - 0.3, bb + 0.3, ST.t1, ST.t1 + 0.3, ROTARY.b1, 0, true);
    for (const u of [a - 0.15, bb + 0.15]) k.box(0x9aa0a6, u - 0.04, u + 0.04, ST.t0, ST.t1, 0.15, 1.1);
    k.box(0x9aa0a6, a - 0.3, bb + 0.3, ST.t0 - 0.2, ST.t0 - 0.12, 0.15, 1.1);
    for (const [u, t] of [[a - 0.3, ST.t0 - 0.3], [bb + 0.3, ST.t0 - 0.3], [a - 0.3, ST.t1], [bb + 0.3, ST.t1]] as const) k.box(0x6a6e72, u - 0.06, u + 0.06, t - 0.06, t + 0.06, 0.15, 2.9);
    k.box(0x3a3c40, a - 0.5, bb + 0.5, ST.t0 - 0.5, ST.t1 + 0.2, 2.9, 3.05);
    k.glow([1.2, 1.25, 1.3], a, bb, ST.t0 + 1, ST.t1 - 1, 2.86, 2.9);
    k.plane(k.canvas(420, 160, (g) => {
      g.fillStyle = '#16181c';
      g.fillRect(0, 0, 420, 160);
      text(g, '地下街', 210, 54, "bold 56px 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff');
      text(g, 'Underground mall · 夜光線 Yakō Line', 210, 118, "26px 'Arial', sans-serif", '#c8ccd4');
    }), (bb - a) + 0.9, 0.6, (a + bb) / 2, ST.t1 + 0.22, 3.4, 'in', 1.2);
  }
  const group = k.finish(city, ghost);
  group.add(busGroup);

  // ---- Below: the mall ----
  const m = new Kit(b);
  const Y = ROTARY.b1;
  const LIGHT: [number, number, number] = [1.3, 1.3, 1.25];
  // From the station's wall line (the concourse has its own floor and ceiling); a lintel where the ceilings meet.
  m.lit(0xb8b0a4, JOIN, HALL.u1, HALL.t0, HALL.t1, Y - 0.2, Y, true);
  m.lit(0xd8d0c0, JOIN, JOIN + 0.3, HALL.t0, HALL.t1, HALL.ceil, -1, true, true);
  for (const [a, bb] of STAIRS) m.lit(0xb8b0a4, a, bb, HALL.t1, ST.t0, Y - 0.2, Y, true);
  m.lit(0x8e8a84, JOIN, HALL.u1, HALL.t0, HALL.t1, HALL.ceil, HALL.ceil + 0.2, true, true);
  for (let u = JOIN + 1; u < HALL.u1 - 1; u += 3.5) m.glow(LIGHT, u, u + 2.4, -0.15, 0.15, HALL.ceil - 0.03, HALL.ceil);
  m.lit(0xd8d0c0, HALL.u1, HALL.u1 + 0.3, HALL.t0, HALL.t1, Y, HALL.ceil, true);
  // Shopfronts along both sides: pillars, a lit interior behind glass, a sign strip in the shop's colour.
  const SHOP: [number, number, number][] = [[1.3, 0.95, 0.6], [0.8, 1.1, 1.3], [1.3, 0.7, 0.9], [1.1, 1.2, 0.7], [0.7, 1.2, 0.9], [1.3, 1.1, 0.9]];
  const NAMES = ['喫茶 ルナ', '書店', 'パン', '花屋', 'ドラッグ', '靴', 'そば', '雑貨', 'ケーキ', '眼鏡', '時計', '洋菓子', 'たい焼き', '古着', '鞄', 'カレー'];
  let si = 0;
  for (const side of [-1, 1] as const) {
    const wallT = side < 0 ? HALL.t0 : HALL.t1;
    const back = wallT + side * 4.4;
    for (let u = JOIN; u < HALL.u1 - 1; u += 6) {
      const u1 = Math.min(HALL.u1, u + 6);
      if (side > 0 && STAIRS.some(([a, bb]) => a < u1 && bb > u)) {
        // The stair opening: plain wall either side of it.
        for (const [a, bb] of STAIRS) if (a < u1 && bb > u) {
          if (a - 0.3 > u) m.lit(0xd8d0c0, u, a - 0.3, wallT, wallT + side * 0.3, Y, HALL.ceil, true);
          if (bb + 0.3 < u1) m.lit(0xd8d0c0, bb + 0.3, u1, wallT, wallT + side * 0.3, Y, HALL.ceil, true);
        }
        continue;
      }
      const c = SHOP[si % SHOP.length];
      m.lit(0xd8d0c0, u, u + 0.4, wallT, back, Y, HALL.ceil, true);
      m.glow([c[0] * 0.55, c[1] * 0.55, c[2] * 0.55], u + 0.4, u1, back - side * 0.05, back, Y, HALL.ceil - 0.6);
      m.lit(0x3a3630, u + 0.4, u1, wallT + side * 0.2, back, Y, Y + 0.02, true);
      for (let q = u + 1; q < u1 - 0.8; q += 1.3) m.glow([c[0] * 0.9, c[1] * 0.9, c[2] * 0.9], q, q + 0.8, back - side * 1.2, back - side * 0.6, Y + 0.6, Y + 1.8);
      m.glow(c, u + 0.4, u1, wallT - side * 0.02, wallT, HALL.ceil - 0.6, HALL.ceil - 0.1);
      m.pane(u + 0.4, u1, Y + 0.1, HALL.ceil - 0.65, wallT);
      if (si % 2 === 0) {
        const name = NAMES[(si / 2) % NAMES.length];
        m.plane(m.canvas(360, 90, (g) => {
          g.fillStyle = `rgb(${Math.round(c[0] * 150)}, ${Math.round(c[1] * 150)}, ${Math.round(c[2] * 150)})`;
          g.fillRect(0, 0, 360, 90);
          text(g, name, 180, 48, "bold 48px 'Yu Gothic', 'Meiryo', sans-serif", '#1a1a1a');
        }), 3.4, 0.45, u + 3.2, wallT - side * 0.04, HALL.ceil - 0.35, side < 0 ? 'in' : 'out', 1.1);
      }
      si++;
    }
  }
  // Direction signs hanging over the corridor, and the mall's name at its far end.
  const sign = (lines: [string, string], u: number, facing: '+u' | '-u', color = '#16181c'): void => {
    m.plane(m.canvas(520, 130, (g) => {
      g.fillStyle = color;
      g.fillRect(0, 0, 520, 130);
      text(g, lines[0], 260, 46, "bold 44px 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff');
      text(g, lines[1], 260, 100, "28px 'Arial', sans-serif", '#c8ccd4');
    }), 4.2, 1.05, u, 0.1, HALL.ceil - 0.7, facing, 1.2);
  };
  sign(['← 夜光線 歌舞路西口駅', 'Yakō Line · Kaburo-nishiguchi'], 12, '+u', '#3a2a6a');
  sign(['西口 · 東都線 東都中央駅 →', 'West Exit · Toto Line'], -18, '-u');
  sign(['東都中央地下街', 'TŌTO-CHŪŌ UNDERGROUND MALL'], 79.6, '-u', '#5a1a2a');
  for (let q = 0; q < 10; q++) {
    const u = -22 + q * 10.3;
    m.person(u, (q % 3) - 1, q % 2 ? 1 : -1, 0, { pose: q % 4 === 3 ? 'phone' : 'walk', body: q % 3 === 1 ? 'woman' : 'man', phase: q * 0.37 });
  }
  const below = m.finish(city, ghost);
  group.add(below);
  return {
    group,
    below,
    update(u) {
      k.update(u);
      m.update(u);
    },
  };
}
