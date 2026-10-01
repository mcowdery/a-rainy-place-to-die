import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { addCar } from './cars';
import { Kit, neonText, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toWorld } from './localFrame';
import { EMIT } from './meshBuilder';

/**
 * Tōto Port's set pieces (the whole-city plan: docs/city-plan.md), built like Asagiri's (asagiri.ts registers
 * them; each has a builder, collision, shelters and lightmap lights, all in the building's local frame: u along
 * the street face, t inward, so behind a quayside piece is the sea):
 * - fish_market: 東都中央卸売市場, the wholesale market (Tsukiji-like): the long hall, its loading bays and
 *   turret trucks, styrofoam boxes, and the outer market's little shops and food stalls at one end.
 * - disco: JULIET BAYSIDE, a bubble-era disco in a black warehouse: the neon name, a lit portal, velvet ropes and
 *   a queue, doormen, a limousine at the kerb.
 * - tuning_shop: SPEED LAB, a tuning shop: three bays (one car up on the lift), tyre stacks, oil drums, a sports
 *   car out front, the mechanic.
 * - ferry_terminal: the ferry terminal on the quay: a glass hall under a canopy, the departure board, and the
 *   ferry moored behind it with its gangway.
 * - gantry: the container terminal's quay cranes, three on their rails, booms out over the water.
 * The islands:
 * - parking_area: 恵比寿島PA on Ebisu-jima (Daikoku-like): a floodlit lot where the street-racing scene meets at
 *   night (tuned cars in rows, their drivers round them), the rest building with its vending machines, and the
 *   spiral ramp climbing round behind the lot.
 * - tv_station: 東都テレビ on Shiomi-jima (Fuji TV-like): two towers joined by a lattice of sky bridges, and the
 *   titanium sphere held in the lattice.
 * - ferris_wheel: the big wheel on Shiomi-jima, 100 m across, turning slowly, its gondolas hanging level and its
 *   rim lit at night.
 * - bay_hall: TŌTO BAY HALL (Zepp-like), a black box concert hall: tonight's show on the marquee, fans queueing
 *   with light sticks, the merch tent.
 * Hanejima (the airfield itself is real/airport.ts):
 * - airport_terminal: 東都空港 TŌTO AIRPORT's terminal: a long glass hall under a wing of a roof, the departures
 *   kerb with its canopy, taxis and buses waiting, the name along the roof.
 * - control_tower: the control tower, its cab glowing green-blue at night, the beacon on top.
 */
export const PORT_KINDS = ['fish_market', 'disco', 'tuning_shop', 'ferry_terminal', 'gantry', 'parking_area', 'tv_station', 'ferris_wheel', 'bay_hall', 'airport_terminal', 'control_tower'] as const;
export type PortKind = (typeof PORT_KINDS)[number];

type C3 = [number, number, number];

export function portColliders(kind: PortKind, b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  switch (kind) {
    case 'fish_market':
      return [R(0, 64, 2, 40), R(0, 14, -0.6, 2)];
    case 'disco':
      // The black box; the rope line's posts.
      return [R(0, 30, 1.5, 26), ...[3, 6, 9, 21, 24, 27].map((u) => R(u - 0.15, u + 0.15, -2.7, -2.3))];
    case 'tuning_shop':
      return [R(0, 24, 7, 18), R(0, 0.5, 0.6, 7), R(23.5, 24, 0.6, 7), R(7.8, 8.2, 0.6, 7), R(15.8, 16.2, 0.6, 7), R(1.5, 6.5, 2, 5.5)];
    case 'ferry_terminal':
      return [R(0, 40, 3, 20)];
    case 'gantry':
      // Only the cranes' legs stand on the quay.
      return [15, 55, 95].flatMap((c) => [c - 8, c + 8].flatMap((u) => [R(u - 0.8, u + 0.8, 2, 3.6), R(u - 0.8, u + 0.8, 18.4, 20)]));
    case 'parking_area': {
      // The rest building, the vending machines along its front, the spiral's piers.
      const piers = SPIRAL_PIERS.map(([u, t]) => R(u - 0.8, u + 0.8, t - 0.8, t + 0.8));
      return [R(66, 96, 58, 92), R(68, 90, 56.6, 57.6), ...piers];
    }
    case 'tv_station':
      return [R(0, 28, 8, 60), R(52, 80, 8, 60)];
    case 'ferris_wheel':
      return [R(10, 30, 4, 20), R(1, 3, 11, 13), R(37, 39, 11, 13)];
    case 'bay_hall':
      return [R(0, 50, 2, 36), R(36, 36.3, -6, -5.7), R(45.7, 46, -6, -5.7)];
    case 'airport_terminal':
      return [R(0, 96, 6, 60), ...[8, 32, 56, 80].map((u) => R(u - 0.4, u + 0.4, -6.4, -5.6))];
    case 'control_tower':
      return [R(0, 16, 0, 16)];
  }
}

export function portShelters(kind: PortKind, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, enclosed = false): { rect: Rect; y0: number; y1: number; enclosed: boolean } => ({ rect: localRect(f, u0, u1, t0, t1), y0, y1, enclosed });
  switch (kind) {
    case 'fish_market':
      return [R(0, 64, -4, 2, 0, 5), R(0, 14, -3, 0, 0, 3.2)];
    case 'disco':
      return [R(9, 21, -3, 1.5, 0, 4.2)];
    case 'tuning_shop':
      return [R(0.5, 23.5, 0.6, 7, 0, 5)];
    case 'ferry_terminal':
      return [R(0, 40, -5, 3, 0, 6)];
    case 'parking_area':
      return [R(66, 96, 52, 58, 0, 4)];
    case 'bay_hall':
      return [R(10, 40, -3, 2, 0, 5), R(36, 46, -6, -1.5, 0, 3)];
    case 'airport_terminal':
      return [R(0, 96, -7, 6, 0, 8)];
    default:
      return [];
  }
}

export function portLights(kind: PortKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  const fluo: C3 = [0.85, 0.95, 1.0];
  const warm: C3 = [1.0, 0.8, 0.55];
  switch (kind) {
    case 'fish_market':
      return [...[10, 26, 42, 58].map((u) => L(u, -1.5, 9, fluo, 0.8)), L(6, -2, 6, warm, 0.7)];
    case 'disco':
      return [L(15, -2, 9, [1.0, 0.35, 0.85], 0.9), L(15, -6, 12, [0.6, 0.4, 1.0], 0.5)];
    case 'tuning_shop':
      return [L(4, 3, 6, fluo, 0.8), L(12, 3, 6, fluo, 0.8), L(20, 3, 6, fluo, 0.6), L(12, -3, 7, [1.0, 0.6, 0.3], 0.4)];
    case 'ferry_terminal':
      return [L(10, -2, 9, fluo, 0.7), L(30, -2, 9, fluo, 0.7), L(20, -4, 8, warm, 0.5)];
    case 'gantry':
      return [15, 55, 95].map((u) => L(u, 11, 22, [0.95, 0.95, 1.0], 0.9));
    case 'parking_area':
      // Tall floodlights over the lot, the rest building's glow.
      return [...[[12, 18], [40, 18], [12, 44], [40, 44], [62, 30]].map(([u, t]) => L(u, t, 22, [0.95, 0.95, 1.0], 0.85)), L(80, 52, 10, warm, 0.8)];
    case 'tv_station':
      return [L(40, -4, 14, fluo, 0.6), L(14, 4, 8, warm, 0.6), L(66, 4, 8, warm, 0.6)];
    case 'ferris_wheel':
      return [L(20, -2, 12, [1.0, 0.7, 0.9], 0.7)];
    case 'bay_hall':
      return [L(25, -2, 12, [1.0, 0.5, 0.9], 0.8), L(41, -4, 6, warm, 0.7)];
    case 'airport_terminal':
      return [20, 48, 76].map((u) => L(u, -3, 12, fluo, 0.8));
    case 'control_tower':
      return [L(8, 8, 8, fluo, 0.4)];
  }
}

/** A car parked in local coordinates, nose along local (du, dt). */
function car(k: Kit, u: number, t: number, du: number, dt: number, type: 'sedan' | 'minivan' | 'kei' | 'taxi', paint: number, variant: number, y = 0): void {
  const [x, z] = toWorld(k.f, u, t);
  const fx = k.f.r[0] * du - k.f.n[0] * dt;
  const fz = k.f.r[2] * du - k.f.n[2] * dt;
  const before = k.mb.vertexCount;
  addCar(k.mb, { x, z, fx, fz, variant, type, paint });
  // Up on a lift: raise what was just added.
  if (y) k.mb.lift(before, y);
}

/** A sign: a canvas plate facing out, `lines` of [text, font, colour], on a dark (or given) ground. */
function plate(k: Kit, w: number, h: number, u: number, t: number, y: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, neon = false, facing: 'out' | 'in' = 'out'): THREE.Mesh {
  const W = Math.round(w * 64);
  const H = Math.round(h * 64);
  return k.plane(k.canvas(W, H, (g) => draw(g, W, H)), w, h, u, t, y, facing, neon ? 1.4 : 1.0, neon);
}

/** The PA's spiral ramp: its centre and radius (local), and where its piers stand. */
const SPIRAL = { u: 26, t: 76, r: 18, w: 8 } as const;
const SPIRAL_PIERS: readonly [number, number][] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return [SPIRAL.u + Math.cos(a) * SPIRAL.r, SPIRAL.t + Math.sin(a) * SPIRAL.r] as [number, number];
});

export const PORT_BUILDERS: Record<PortKind, (k: Kit, id: string, part: (name: string) => Kit) => ((camera: THREE.Vector3, dt: number) => void) | void> = {
  // ---- 東都中央卸売市場: the long wholesale hall (sawtooth roof, grey concrete), open loading bays under a deep
  // canopy with turret trucks and stacks of styrofoam boxes, and the outer market's shops at the west end ----
  fish_market(k) {
    const CONC = 0x8a8c88;
    const DARK = 0x3a3c3e;
    k.box(CONC, 14, 64, 6, 40, 0, 8);
    k.box(CONC, 0, 14, 6, 40, 0, 7);
    // Sawtooth roof lights (north-facing glass strips) across the hall.
    for (let t = 8; t < 38; t += 6) {
      k.box(0x6a6c6a, 14, 64, t, t + 3.2, 8, 9.6);
      k.lit(0xd8e8f0, 14, 64, t + 3.2, t + 3.3, 8, 9.6);
    }
    // The loading bays: dark openings with lit interiors, turret trucks and boxes in front.
    for (let i = 0; i < 6; i++) {
      const u = 16 + i * 8;
      k.lit(0xc8d8d0, u, u + 6, 5.9, 6, 0.2, 4.2, true);
      k.box(DARK, u - 1, u, 2, 6, 0, 5);
    }
    k.box(DARK, 63, 64, 2, 6, 0, 5);
    k.box(CONC, 14, 64, 2, 6, 5, 8);
    // The canopy over the loading apron: dark steel, fluorescent strips underneath.
    k.box(0x4a4c4a, 14, 64, -4, 2, 5, 5.4);
    for (let u = 17; u < 63; u += 5) k.lit(0xe8f0f0, u, u + 2.2, -2.2, -1.8, 4.96, 5.0, false, true);
    for (const u of [16, 32, 48, 63]) k.post(0x4a4c4a, u, -3.6, 0, 5, 0.15, 8);
    // Turret trucks (the market's little three-wheeled carts) and styrofoam box stacks.
    const rnd = (n: number): number => (Math.sin(n * 12.9898) * 43758.5453) % 1;
    for (let i = 0; i < 7; i++) {
      const u = 18 + i * 6.3;
      const t = -1.5 - Math.abs(rnd(i)) * 1.5;
      k.box([0x3a6ac8, 0x2a8a4a, 0xd8a820][i % 3], u, u + 1.3, t - 0.6, t + 0.6, 0.3, 0.9);
      k.post(0x2a2a2a, u + 0.3, t, 0.9, 1.9, 0.35, 10);
      k.box(0xe8e8e0, u + 1.4, u + 2.6, t - 0.5, t + 0.5, 0, 0.35 + Math.floor(Math.abs(rnd(i + 20)) * 4) * 0.35);
    }
    // The outer market (場外): little shops under awnings, each its own colour, with noren and food signs.
    const shops: [number, string, string][] = [
      [0, '#c83a2a', '海鮮丼'],
      [3.5, '#2a4a8a', '寿司'],
      [7, '#d89a20', '玉子焼'],
      [10.5, '#2a6a3a', '刃物'],
    ];
    for (const [u, color, name] of shops) {
      k.facade(0x9a8a78, [3.5, 0.3, 1.4, 0], 1 + 3 * 2, u, u + 3.5, 0, 6, 0, 7, true);
      const c = new THREE.Color(color);
      k.box(c.getHex(), u + 0.1, u + 3.4, -1.6, 0, 3.0, 3.2);
      plate(k, 3.2, 0.9, u + 1.75, -0.02, 3.8, (g, W, H) => {
        g.fillStyle = color;
        g.fillRect(0, 0, W, H);
        text(g, name, W / 2, H * 0.72, `bold ${Math.round(H * 0.7)}px 'Yu Gothic', sans-serif`, '#ffffff');
      });
    }
    // The name over the hall's front.
    plate(k, 26, 2.4, 39, -0.05, 6.6, (g, W, H) => {
      g.fillStyle = '#f2f0e8';
      g.fillRect(0, 0, W, H);
      text(g, '東都中央卸売市場', W / 2, H * 0.62, `bold ${Math.round(H * 0.56)}px 'Yu Gothic', sans-serif`, '#1a3a6a');
      text(g, 'TŌTO CENTRAL WHOLESALE MARKET', W / 2, H * 0.9, `600 ${Math.round(H * 0.18)}px Consolas, monospace`, '#1a3a6a');
    });
    k.person(20, -2, 0, 1, { body: 'man', pose: 'stand', color: [0.8, 0.86, 1.0] });
    k.person(34, -2.5, 1, 0, { body: 'man', pose: 'talk', color: [0.85, 0.8, 0.7] });
    k.person(5, -2.2, 0, 1, { body: 'woman', pose: 'stand', color: [1.0, 0.8, 0.85] });
  },

  // ---- JULIET BAYSIDE (ジュリエット湾岸): a black warehouse turned disco. Its name in neon over a lit portal,
  // a rope line with a queue in bodycon and suits, two doormen, and a black limousine at the kerb ----
  disco(k) {
    const BLACK = 0x121216;
    k.box(BLACK, 0, 30, 1.5, 26, 0, 10);
    k.box(0x1c1c22, 0, 30, 1.5, 26, 10, 10.6);
    // The portal: a lit frame round the doors, pink and violet bands.
    k.glow([2.2, 0.35, 1.6], 11, 19, 1.4, 1.5, 4.0, 4.3, EMIT.neon);
    k.glow([2.2, 0.35, 1.6], 11, 11.3, 1.4, 1.5, 0, 4.3, EMIT.neon);
    k.glow([2.2, 0.35, 1.6], 18.7, 19, 1.4, 1.5, 0, 4.3, EMIT.neon);
    k.glow([0.9, 0.5, 2.2], 10.4, 19.6, 1.3, 1.4, 4.5, 4.7, EMIT.neon);
    k.lit(0x3a1a3a, 11.3, 18.7, 1.45, 1.5, 0, 4.0, true);
    // A short canopy over the door.
    k.box(0x2a2a30, 9, 21, -3, 1.5, 4.2, 4.5);
    k.lit(0xe8c8e8, 9.2, 20.8, -2.8, 1.3, 4.18, 4.2);
    // The rope line: brass posts and red rope, either side of the path to the door.
    for (const [a, b] of [[3, 9], [21, 27]] as const) {
      for (let u = a; u <= b; u += 3) k.post(0xc8a040, u, -2.5, 0, 1.0, 0.07, 8);
      k.box(0xa01a2a, a, b, -2.53, -2.47, 0.85, 0.9);
    }
    // The name in neon, big over the front, and the katakana under it.
    plate(k, 22, 4.5, 15, -0.05, 7.4, (g, W, H) => {
      g.fillStyle = '#060608';
      g.fillRect(0, 0, W, H);
      neonText(g, 'JULIET', W / 2, H * 0.5, `italic 900 ${Math.round(H * 0.42)}px Georgia, serif`, '#ff5fc8');
      neonText(g, 'BAYSIDE · ジュリエット湾岸', W / 2, H * 0.86, `600 ${Math.round(H * 0.16)}px 'Yu Gothic', sans-serif`, '#b48cff');
    }, true);
    // The queue and the doormen.
    const q: [number, 'woman' | 'man'][] = [[4, 'woman'], [5.2, 'woman'], [6.6, 'man'], [7.8, 'woman'], [22.5, 'woman'], [23.8, 'man'], [25.2, 'woman']];
    q.forEach(([u, body], i) => k.person(u, -3.3, i < 4 ? 1 : -1, 0, { body, pose: i % 3 === 1 ? 'phone' : 'stand', color: body === 'woman' ? [1.0, 0.7, 0.9] : [0.75, 0.8, 1.0], ...(body === 'woman' ? { hair: 'long' as const } : {}) }));
    k.person(10.4, -0.8, 0, -1, { body: 'man', pose: 'pockets', color: [0.6, 0.6, 0.7] });
    k.person(19.6, -0.8, 0, -1, { body: 'man', pose: 'pockets', color: [0.6, 0.6, 0.7] });
    // The limousine at the kerb (a long black sedan).
    car(k, 15, -8, 1, 0, 'sedan', 0x0a0a0c, 7);
  },

  // ---- SPEED LAB: a tuning shop. Three bays under a steel canopy, one with a car up on the lift, the next with a
  // car on stands, the third's shutter half down; tyre stacks and drums; a sports car out front ----
  tuning_shop(k) {
    const STEEL = 0x5a6068;
    k.box(STEEL, 0, 24, 7, 18, 0, 7.5);
    for (const u of [0, 7.8, 15.8, 23.5]) k.box(0x3a3e44, u, u + 0.5, 0.6, 7, 0, 5.2);
    k.box(0x3a3e44, 0, 24, 0.6, 7, 5.0, 5.4);
    k.box(0x2a2e34, 0, 24, 0.6, 7, 5.4, 7.5);
    // Inside: lit bays, a back wall of tools.
    k.lit(0xd0d8e0, 0.5, 23.5, 6.9, 7, 0.1, 5, true);
    k.lit(0xe8eef4, 0.5, 23.5, 0.6, 7, 4.98, 5.0, true, true);
    k.box(0x2a2a2a, 0.5, 23.5, 0.6, 7, 0, 0.05);
    // Bay 1: a car on the two-post lift.
    for (const u of [1.8, 6.2]) k.box(0xc8a020, u - 0.15, u + 0.15, 1.5, 1.8, 0, 2.6);
    car(k, 4, 3.8, 0, 1, 'sedan', 0xe8e8e4, 11, 1.6);
    // Bay 2: a car in for work; bay 3: the shutter half down.
    car(k, 12, 3.6, 0, 1, 'kei', 0x2a5ad0, 12);
    k.box(0x9aa0a6, 16.2, 23.5, 0.55, 0.65, 2.6, 5.0);
    for (let y = 2.8; y < 5; y += 0.3) k.box(0x7a8086, 16.2, 23.5, 0.5, 0.55, y, y + 0.06);
    // Tyre stacks and drums outside.
    for (const [u, t, n] of [[-1.2, 2, 4], [-1.2, 4, 3], [25.2, 2.5, 5]] as const) {
      for (let i = 0; i < n; i++) k.lathe(0x1a1a1a, u, t, [[i * 0.24, 0.32], [i * 0.24 + 0.22, 0.32]], 12);
    }
    for (const u of [25, 25.8]) k.lathe(0x2a5a9a, u, 5.5, [[0, 0.3], [0.9, 0.3]], 12);
    // The sign over the bays.
    plate(k, 14, 1.8, 12, 0.55, 6.4, (g, W, H) => {
      g.fillStyle = '#101418';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#e8c020';
      g.fillRect(0, H * 0.82, W, H * 0.1);
      text(g, 'SPEED LAB', W * 0.36, H * 0.68, `italic 900 ${Math.round(H * 0.62)}px Arial, sans-serif`, '#ffffff');
      text(g, 'チューニング 東都', W * 0.8, H * 0.62, `bold ${Math.round(H * 0.32)}px 'Yu Gothic', sans-serif`, '#e8c020');
    });
    // Out front: a customer's sports car and the mechanic.
    car(k, 18, -4, 1, 0, 'sedan', 0xc81a1a, 13);
  },

  // ---- The ferry terminal: a glass hall under a long canopy on the street side, its name and a departure board;
  // behind it on the quay, a gangway up to the ferry moored alongside ----
  ferry_terminal(k) {
    const WHITE = 0xd8dcdc;
    k.box(WHITE, 0, 40, 3, 20, 0, 3.2);
    k.box(0x9aa4ac, 0, 40, 3, 20, 3.2, 9);
    k.box(WHITE, 0, 40, 3, 20, 9, 11);
    // The glass front, lit inside.
    k.lit(0xe8eef0, 1, 39, 3.2, 3.3, 0.1, 8.8, true);
    for (let u = 1; u < 39; u += 3.8) k.pane(u, Math.min(39, u + 3.8), 0, 8.8, 3.05);
    for (let u = 1; u <= 39; u += 3.8) k.box(0x6a7078, u - 0.08, u + 0.08, 2.95, 3.05, 0, 9);
    // The canopy.
    k.box(0xe8ecec, -1, 41, -5, 3, 6, 6.4);
    k.lit(0xf0f4f4, -0.8, 40.8, -4.8, 2.8, 5.98, 6.0);
    for (const u of [2, 14, 26, 38]) k.post(0xb8c0c4, u, -4.5, 0, 6, 0.18, 10);
    plate(k, 30, 2.2, 20, 2.9, 10, (g, W, H) => {
      g.fillStyle = '#1a4a8a';
      g.fillRect(0, 0, W, H);
      text(g, '東都港フェリーターミナル', W / 2, H * 0.6, `bold ${Math.round(H * 0.5)}px 'Yu Gothic', sans-serif`, '#ffffff');
      text(g, 'TŌTO PORT FERRY TERMINAL', W / 2, H * 0.9, `600 ${Math.round(H * 0.18)}px Consolas, monospace`, '#c8e0ff');
    });
    plate(k, 5, 2.4, 33, 3.4, 2.6, (g, W, H) => {
      g.fillStyle = '#06080a';
      g.fillRect(0, 0, W, H);
      const rows = [['21:30', '伊豆大島', 'OSHIMA'], ['22:00', '神津島', 'KŌZU'], ['23:00', '徳島', 'TOKUSHIMA']];
      text(g, 'DEPARTURES 出航', W / 2, H * 0.16, `bold ${Math.round(H * 0.11)}px Consolas, monospace`, '#ffd040');
      rows.forEach(([t, jp, en], i) => {
        const y = H * (0.36 + i * 0.22);
        text(g, t, W * 0.16, y, `bold ${Math.round(H * 0.1)}px Consolas, monospace`, '#40ff90', 'center');
        text(g, `${jp} ${en}`, W * 0.62, y, `${Math.round(H * 0.09)}px 'Yu Gothic', sans-serif`, '#e8e8e8');
      });
    }, true, 'in');
    // The gangway from the upper floor out over the quay to the ferry.
    k.box(0xb8c0c4, 26, 29, 20, 34, 6.2, 6.6);
    k.lit(0xe8eef0, 26.2, 28.8, 20, 34, 6.6, 8.6, false);
    // The ferry, moored alongside: hull (below the waterline too), white decks, a blue band, lit windows, funnel.
    const T0 = 34;
    k.box(0x1a2a4a, -30, 70, T0, T0 + 16, -3, 1);
    k.box(0xf0f0ec, -30, 70, T0, T0 + 16, 1, 6);
    k.box(0x1a4aa0, -30, 70, T0 - 0.02, T0 + 16.02, 2.2, 2.9);
    k.box(0xf0f0ec, -18, 56, T0 + 1.5, T0 + 14.5, 6, 10.5);
    k.box(0xf0f0ec, -8, 36, T0 + 2.5, T0 + 13.5, 10.5, 14);
    // Its windows, a row to each deck: separate panes, warm and soft (lit cabins, not floodlights).
    for (const [y0, y1, u0, u1, w, step] of [[7.3, 8.3, -17, 55, 1.2, 1.9], [11.6, 12.5, -7, 35, 1.0, 1.7], [3.7, 4.5, -26, 66, 0.55, 2.4]] as const) {
      for (let u = u0 + 0.6; u + w < u1 - 0.4; u += step) k.glow([0.45, 0.36, 0.23], u, u + w, T0 - 0.04, T0 + 0.04, y0, y1, EMIT.lamp);
    }
    k.box(0x1a4aa0, 10, 18, T0 + 5, T0 + 11, 14, 19);
    k.box(0x101010, 10, 18, T0 + 5, T0 + 11, 19, 20);
    k.glow([2.5, 0.2, 0.15], 13.8, 14.2, T0 + 7.8, T0 + 8.2, 20, 20.4, EMIT.always);
    plate(k, 18, 1.6, 20, T0 - 0.1, 4.2, (g, W, H) => {
      g.fillStyle = '#f0f0ec';
      g.fillRect(0, 0, W, H);
      text(g, 'フェリーかもめ 東都', W / 2, H * 0.72, `bold ${Math.round(H * 0.6)}px 'Yu Gothic', sans-serif`, '#1a4aa0');
    }, false, 'in');
    k.person(12, -2, 0, 1, { body: 'woman', pose: 'stand', color: [0.9, 0.85, 1.0] });
    k.person(22, -3, -1, 0, { body: 'man', pose: 'phone', color: [0.8, 0.9, 1.0] });
  },

  // ---- The quay cranes: three container gantry cranes on their rails along the quay (legs 16 m apart, 40 m up),
  // each with its machinery house, the cab under the boom, and the boom out over the water, red lights on top ----
  gantry(k) {
    const BLUE = 0x5a9ad0;
    const WHITE = 0xe8ecec;
    // The rails along the quay.
    for (const t of [2.8, 19.2]) k.box(0x6a6a6a, 0, 106, t - 0.15, t + 0.15, 0, 0.12);
    for (const [ci, c] of [15, 55, 95].entries()) {
      // Legs (a portal frame across the rails) and their bogies.
      for (const u of [c - 8, c + 8]) {
        for (const t of [2.8, 19.2]) {
          k.box(0x3a3a3a, u - 0.8, u + 0.8, t - 0.8, t + 0.8, 0, 1.2);
          k.box(BLUE, u - 0.6, u + 0.6, t - 0.6, t + 0.6, 1.2, 40);
        }
        k.box(BLUE, u - 0.6, u + 0.6, 2.2, 19.8, 12, 13.2);
        k.box(BLUE, u - 0.6, u + 0.6, 2.2, 19.8, 38.8, 40);
      }
      for (const t of [2.8, 19.2]) k.box(BLUE, c - 8.6, c + 8.6, t - 0.6, t + 0.6, 38.8, 40);
      // The boom along t: back over the quay, out over the water; its girder pair, the machinery house, the cab.
      k.box(WHITE, c - 2.5, c - 1.5, -22, 62, 40, 42);
      k.box(WHITE, c + 1.5, c + 2.5, -22, 62, 40, 42);
      for (let t = -20; t < 62; t += 6) k.box(WHITE, c - 2.5, c + 2.5, t, t + 0.4, 41.6, 42);
      k.box(WHITE, c - 5, c + 5, -20, -8, 42, 47);
      k.glow([1.4, 1.4, 1.2], c - 4.8, c + 4.8, -20.05, -19.95, 44, 45, EMIT.lamp);
      k.box(0x2a2e34, c - 1.4, c + 1.4, 20 + ci * 4, 23 + ci * 4, 37, 39.6);
      k.glow([1.6, 1.5, 1.2], c - 1.3, c + 1.3, 19.95 + ci * 4, 20 + ci * 4, 37.6, 39, EMIT.lamp);
      // Stays up to an apex frame over the legs.
      k.box(BLUE, c - 0.6, c + 0.6, 10, 12, 40, 58);
      k.glow([3.0, 0.2, 0.15], c - 0.4, c + 0.4, 10.6, 11.4, 58, 58.8, EMIT.always);
      k.glow([3.0, 0.2, 0.15], c - 0.4, c + 0.4, 61.2, 62, 42, 42.8, EMIT.always);
      // Floodlights under the frame, onto the quay.
      k.glow([2.0, 2.0, 1.8], c - 7, c + 7, 10.6, 11.4, 12.6, 12.8, EMIT.lamp);
    }
  },

  // ---- 恵比寿島PA: a floodlit parking area where the racing scene meets. Rows of bays with tuned cars nose to
  // nose and their drivers standing round them, the rest building with lit windows and a row of vending machines,
  // tall floodlights, the green PA sign at the entrance, and the spiral ramp climbing round behind the lot ----
  parking_area(k) {
    k.box(0x2a2a2e, 0, 100, 0, 100, 0, 0.03);
    // Bays: two rows facing each other across an aisle, twice over.
    const PAINTS = [0xc81a1a, 0xe8e8e4, 0x1a1a1c, 0x2a5ad0, 0xe8c020, 0x8a2ac8, 0xd86a1e, 0x2a8a4a, 0xa8b0b8];
    let n = 0;
    for (const [t0, facing] of [[12, 1], [23, -1], [34, 1], [45, -1]] as const) {
      for (let u = 6; u < 58; u += 2.8) {
        k.box(0xd8d8d0, u - 0.06, u + 0.06, t0, t0 + 5.4, 0.03, 0.05);
        const hot = (Math.sin(u * 3.1 + t0) * 43758.5453) % 1;
        if (Math.abs(hot) < 0.6) car(k, u + 1.4, t0 + 2.7, 0, facing, 'sedan', PAINTS[n++ % PAINTS.length], 20 + n);
      }
    }
    // Drivers in knots between the rows, some on their phones.
    const knots: [number, number][] = [[14, 20.5], [30, 20.5], [48, 20.5], [20, 42.5], [40, 42.5]];
    knots.forEach(([u, t], i) => {
      k.person(u, t, 1, 0, { body: 'man', pose: 'talk', color: [0.8, 0.85, 1.0] });
      k.person(u + 1.1, t - 0.4, -1, 0, { body: i % 2 ? 'woman' : 'man', pose: i % 3 ? 'stand' : 'phone', color: [1.0, 0.8, 0.9], ...(i % 2 ? { hair: 'long' as const } : {}) });
      k.person(u + 0.5, t + 0.8, 0, -1, { body: 'man', pose: 'pockets', color: [0.75, 0.8, 0.9], hair: 'cap' });
    });
    // Floodlights: tall poles with a head of lamps.
    for (const [u, t] of [[12, 18], [40, 18], [12, 44], [40, 44], [62, 30]] as const) {
      k.post(0x6a6e72, u, t, 0, 16, 0.2, 8);
      k.box(0x4a4e52, u - 1.4, u + 1.4, t - 0.5, t + 0.5, 15.6, 16.3);
      k.glow([2.2, 2.2, 2.0], u - 1.3, u + 1.3, t - 0.45, t + 0.45, 15.5, 15.6, EMIT.lamp);
    }
    // The rest building: low, lit, a row of vending machines under its canopy, the toilets' signs.
    k.facade(0xc8c8c0, [3, 0.5, 1.6, 1], 1 + 2 * 2, 66, 96, 58, 92, 0, 6, false);
    k.box(0x5a5c5e, 64, 98, 52, 58, 3.8, 4.2);
    k.lit(0xeef2f4, 64.2, 97.8, 52.2, 57.8, 3.78, 3.8, false, true);
    const VEND = [[0.9, 0.2, 0.15], [0.2, 0.5, 1.0], [0.95, 0.95, 0.9], [1.0, 0.6, 0.1], [0.2, 0.8, 0.4]] as const;
    for (let i = 0; i < 11; i++) {
      const u = 68 + i * 2;
      k.box([0xc82a2a, 0x2a5ad0, 0xe8e8e0, 0xd87a1a, 0x2a8a4a][i % 5], u, u + 1.8, 56.6, 57.6, 0, 1.9);
      k.glow([VEND[i % 5][0] * 1.4, VEND[i % 5][1] * 1.4, VEND[i % 5][2] * 1.4], u + 0.1, u + 1.7, 56.55, 56.6, 0.9, 1.7, EMIT.always);
    }
    plate(k, 24, 2.2, 81, 57.95, 5.0, (g, W, H) => {
      g.fillStyle = '#1a6a3a';
      g.fillRect(0, 0, W, H);
      text(g, '恵比寿島パーキングエリア', W / 2, H * 0.55, `bold ${Math.round(H * 0.52)}px 'Yu Gothic', sans-serif`, '#ffffff');
    });
    // The green PA sign at the entrance.
    k.post(0x6a6e72, 50, -2, 0, 6.5, 0.15, 8);
    plate(k, 7, 3.2, 50, -2.25, 5.0, (g, W, H) => {
      g.fillStyle = '#1a6a3a';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 6;
      g.strokeRect(6, 6, W - 12, H - 12);
      text(g, 'P 恵比寿島', W / 2, H * 0.36, `bold ${Math.round(H * 0.28)}px 'Yu Gothic', sans-serif`, '#ffffff');
      text(g, 'EBISU-JIMA PA', W / 2, H * 0.74, `bold ${Math.round(H * 0.2)}px Arial, sans-serif`, '#ffffff');
    });
    // The spiral: a ramp deck climbing two turns round behind the lot, on piers, parapets and lamps along it.
    const { u: cu, t: ct, r, w } = SPIRAL;
    const steps = 96;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 4;
      const y = 5 + (i / steps) * 10;
      const u = cu + Math.cos(a) * r;
      const t = ct + Math.sin(a) * r;
      k.box(0x8a8a84, u - 1.7, u + 1.7, t - 1.7, t + 1.7, y - 1, y);
      const uo = cu + Math.cos(a) * (r + w / 2);
      const to = ct + Math.sin(a) * (r + w / 2);
      k.box(0x9a9a96, uo - 0.4, uo + 0.4, to - 0.4, to + 0.4, y, y + 1.1);
      const ui = cu + Math.cos(a) * (r - w / 2);
      const ti = ct + Math.sin(a) * (r - w / 2);
      k.box(0x8a8a84, ui - 1.2, ui + 1.2, ti - 1.2, ti + 1.2, y - 1, y);
      if (i % 8 === 0) k.glow([2.4, 1.1, 0.3], uo - 0.3, uo + 0.3, to - 0.3, to + 0.3, y + 5, y + 5.3, EMIT.lamp);
    }
    for (const [u, t] of SPIRAL_PIERS) k.box(0x8a8a84, u - 0.8, u + 0.8, t - 0.8, t + 0.8, 0, 5);
  },

  // ---- 東都テレビ TŌTO TV: two towers of glass and grey steel joined by a lattice of sky bridges, the titanium
  // sphere held in the lattice between them, the name on the east tower and a plaza under the lattice ----
  tv_station(k) {
    const STEEL = 0x8a949c;
    for (const [u0, u1] of [[0, 28], [52, 80]] as const) {
      k.facade(0xb8c0c8, [2.4, 0.6, 1.4, 2], 1 + 1 * 2, u0, u1, 8, 60, 0, 92, true);
      k.box(0x6a747c, u0, u1, 8, 60, 92, 94);
    }
    // The lattice: beams across between the towers at every level, and posts, a grid of sky bridges.
    for (const y of [22, 38, 54, 70, 86]) {
      for (const t of [12, 24, 36, 48]) k.box(STEEL, 28, 52, t - 1, t + 1, y - 1.5, y);
      for (const u of [34, 40, 46]) k.box(STEEL, u - 0.6, u + 0.6, 12, 48, y - 1.5, y);
    }
    for (const u of [34, 46]) for (const t of [12, 48]) k.box(STEEL, u - 0.6, u + 0.6, t - 0.6, t + 0.6, 22, 86);
    // The sphere, in the lattice's upper storeys.
    const R = 15;
    const rings: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      rings.push([70 + Math.sin(a) * R, Math.max(0.01, Math.cos(a) * R)]);
    }
    k.lathe(0xd0d4d8, 40, 30, rings, 24);
    k.glow([1.6, 1.4, 1.1], 38, 42, 15.5, 16, 68, 72, EMIT.lamp);
    // The plaza's canopy and the name.
    k.box(0x5a646c, 28, 52, 2, 8, 6, 6.4);
    k.lit(0xe8eef0, 28.2, 51.8, 2.2, 7.8, 5.98, 6.0);
    plate(k, 20, 3.6, 66, 7.9, 30, (g, W, H) => {
      g.fillStyle = '#e8eef0';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#e8401a';
      g.beginPath();
      g.arc(H * 0.5, H * 0.5, H * 0.34, 0, Math.PI * 2);
      g.fill();
      text(g, '東都テレビ', W * 0.58, H * 0.45, `bold ${Math.round(H * 0.4)}px 'Yu Gothic', sans-serif`, '#1a2a4a');
      text(g, 'TŌTO TV', W * 0.58, H * 0.82, `bold ${Math.round(H * 0.2)}px Arial, sans-serif`, '#e8401a');
    });
    k.person(36, -3, 0, 1, { body: 'woman', pose: 'phone', color: [1.0, 0.85, 0.9] });
    k.person(44, -2, -1, 0, { body: 'man', pose: 'walk', color: [0.8, 0.9, 1.0] });
  },

  // ---- The big wheel: 100 m across on two A-frame legs over its boarding station, turning once every eight
  // minutes; the gondolas hang level as it turns, and the rim and spokes are lit at night ----
  ferris_wheel(k, _id, part) {
    const HUB = { u: 20, t: 12, y: 58 };
    const R = 50;
    // The boarding station and the legs (static).
    k.box(0xe8ecec, 10, 30, 4, 20, 0, 5);
    k.lit(0xf4e8f0, 10.5, 29.5, 3.9, 4, 0.2, 4.6, true);
    for (const du of [-18, 18]) {
      for (const dt of [-6, 6]) {
        // A leg from the ground out wide up to the hub: stacked boxes stepping in.
        const u0 = HUB.u + du;
        const t0 = HUB.t + dt;
        const n = 24;
        for (let i = 0; i < n; i++) {
          const f = i / n;
          const u = u0 + (HUB.u - u0) * f;
          const t = t0 + (HUB.t - t0) * f * 0.8;
          k.box(0xe8ecec, u - 0.7, u + 0.7, t - 0.7, t + 0.7, (HUB.y * i) / n, (HUB.y * (i + 1)) / n + 0.2);
        }
      }
    }
    plate(k, 18, 2, 20, 3.9, 6.2, (g, W, H) => {
      g.fillStyle = '#1a1a2a';
      g.fillRect(0, 0, W, H);
      neonText(g, '汐見 SKY WHEEL', W / 2, H * 0.55, `bold ${Math.round(H * 0.55)}px 'Yu Gothic', sans-serif`, '#ff8ad8');
    }, true);
    // The wheel (a separate part, turned about the hub): rim, spokes, the hub, lights on the rim.
    const w = part('wheel');
    const at = (a: number, r: number): [number, number] => [HUB.u + Math.cos(a) * r, HUB.y + Math.sin(a) * r];
    const SEG = 72;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const [u, y] = at(a, R);
      for (const dt of [-1.8, 1.8]) w.box(0xe0e4e8, u - 2.3, u + 2.3, HUB.t + dt - 0.35, HUB.t + dt + 0.35, y - 2.3, y + 2.3);
      // A ring of lights on the rim, in bands of pink, blue and gold (bright enough to read from the mainland).
      const c = [[3.2, 0.5, 2.4], [0.7, 1.6, 3.2], [3.2, 2.2, 0.6]][Math.floor(i / 6) % 3] as [number, number, number];
      w.glow(c, u - 0.9, u + 0.9, HUB.t - 2.5, HUB.t - 2.2, y - 0.9, y + 0.9, EMIT.neon);
      w.glow(c, u - 0.9, u + 0.9, HUB.t + 2.2, HUB.t + 2.5, y - 0.9, y + 0.9, EMIT.neon);
    }
    const SPOKES = 18;
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2;
      for (let r = 3; r < R; r += 3) {
        const [u, y] = at(a, r);
        w.box(0xc8ccd0, u - 0.3, u + 0.3, HUB.t - 0.3, HUB.t + 0.3, y - 0.3, y + 0.3);
      }
    }
    w.box(0xb8bcc0, HUB.u - 2.5, HUB.u + 2.5, HUB.t - 3, HUB.t + 3, HUB.y - 2.5, HUB.y + 2.5);
    // The gondolas: one instanced mesh, placed each frame round the rim, always level.
    const GONDOLAS = 36;
    const gm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 2.4, 2.4), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.12 }), GONDOLAS);
    const COL = [0xe84a8a, 0x4a8ae8, 0xe8c84a, 0x4ae88a, 0xe87a3a, 0xa84ae8];
    for (let i = 0; i < GONDOLAS; i++) gm.setColorAt(i, new THREE.Color(COL[i % COL.length]));
    gm.frustumCulled = false;
    k.group.add(gm);
    const f = k.f;
    const hub = toWorld(f, HUB.u, HUB.t);
    // The wheel's axis is across its face (the local t direction, into the lot): world -n.
    const axis = new THREE.Vector3(-f.n[0], 0, -f.n[2]).normalize();
    let angle = 0;
    let pivot: THREE.Object3D | null = null;
    const m = new THREE.Matrix4();
    const along = new THREE.Vector3(f.r[0], 0, f.r[2]);
    return (_c, dt) => {
      // The wheel part is built by now (finish runs before the first update): hang it on a pivot at the hub.
      if (!pivot && w.group.parent) {
        pivot = new THREE.Object3D();
        pivot.position.set(hub[0], HUB.y, hub[1]);
        w.group.parent.add(pivot);
        pivot.add(w.group);
        w.group.position.set(-hub[0], -HUB.y, -hub[1]);
      }
      angle = (angle + dt * ((Math.PI * 2) / 480)) % (Math.PI * 2);
      if (pivot) pivot.quaternion.setFromAxisAngle(axis, angle);
      for (let i = 0; i < GONDOLAS; i++) {
        const a = (i / GONDOLAS) * Math.PI * 2 + angle;
        // Round the rim in the wheel's plane (along r and up), hanging 2.4 m below its pin.
        const x = hub[0] + along.x * Math.cos(a) * (R - 1);
        const z = hub[1] + along.z * Math.cos(a) * (R - 1);
        const y = HUB.y + Math.sin(a) * (R - 1) - 2.4;
        m.makeTranslation(x, y, z);
        gm.setMatrixAt(i, m);
      }
      gm.instanceMatrix.needsUpdate = true;
    };
  },

  // ---- TŌTO BAY HALL: a black box hall with tonight's show on the marquee, fans queueing along the front with
  // light sticks, the merch tent, and the tour's trucks round the side ----
  bay_hall(k) {
    const BLACK = 0x16161a;
    k.box(BLACK, 0, 50, 2, 36, 0, 16);
    k.box(0x222228, 0, 50, 2, 36, 16, 16.6);
    // The entrance: glass doors under a lit canopy.
    k.lit(0x3a2a3a, 18, 32, 1.95, 2, 0, 3.8, true);
    k.box(0x2a2a30, 10, 40, -3, 2, 4.6, 5.0);
    k.lit(0xf0d8f0, 10.2, 39.8, -2.8, 1.8, 4.58, 4.6);
    // The name, and the marquee with tonight's show.
    plate(k, 34, 3.2, 25, 1.9, 12.4, (g, W, H) => {
      g.fillStyle = '#08080a';
      g.fillRect(0, 0, W, H);
      neonText(g, 'TŌTO BAY HALL', W / 2, H * 0.45, `900 ${Math.round(H * 0.5)}px Arial, sans-serif`, '#ffffff');
      text(g, '東都ベイホール', W / 2, H * 0.85, `bold ${Math.round(H * 0.22)}px 'Yu Gothic', sans-serif`, '#ff8ad8');
    }, true);
    plate(k, 26, 2.6, 25, 1.9, 7.6, (g, W, H) => {
      g.fillStyle = '#1a0a1a';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = '#ffe45f';
      g.lineWidth = 5;
      g.strokeRect(5, 5, W - 10, H - 10);
      text(g, 'TONIGHT ✦ STELLA PRODUCTION PRESENTS', W / 2, H * 0.34, `bold ${Math.round(H * 0.18)}px Arial, sans-serif`, '#ffe45f');
      text(g, '星屑ガールズ LIVE 2026', W / 2, H * 0.7, `bold ${Math.round(H * 0.3)}px 'Yu Gothic', sans-serif`, '#ff8ad8');
    }, true);
    // The queue along the front, light sticks up (waving), and a few more by the merch tent.
    for (let i = 0; i < 14; i++) {
      const u = 2 + i * 1.1;
      k.person(u, -1.2 - (i % 2) * 0.8, 1, 0, { body: i % 3 === 0 ? 'woman' : 'man', pose: i % 4 === 0 ? 'wave' : i % 4 === 1 ? 'phone' : 'stand', color: i % 2 ? [1.0, 0.6, 0.9] : [0.6, 0.8, 1.0], ...(i % 3 === 0 ? { hair: 'long' as const } : {}) });
    }
    // The merch tent.
    k.box(0xe8e8e8, 36, 46, -6, -1.5, 2.8, 3.0);
    k.lit(0xfff0f8, 36.2, 45.8, -5.8, -1.7, 2.78, 2.8);
    for (const u of [36.15, 45.85]) for (const t of [-5.85, -1.65]) k.post(0xc8c8c8, u, t, 0, 2.8, 0.06, 6);
    k.box(0xd84a8a, 36.5, 45.5, -2.4, -1.8, 0, 1.0);
    k.person(41, -3, 0, -1, { body: 'woman', pose: 'stand', color: [1.0, 0.85, 0.9] });
    // The tour's trucks round the side.
    car(k, 54, 20, 0, 1, 'minivan', 0xe8e8e4, 31);
    car(k, 54, 28, 0, 1, 'minivan', 0x1a1a1c, 32);
  },

  // ---- 東都空港 TŌTO AIRPORT's terminal: a long glass hall lit inside, a deep wing of a roof over it and the
  // departures kerb, the name along the roof edge, taxis and a limousine bus at the kerb, travellers with cases ----
  airport_terminal(k) {
    k.lit(0xe8eef0, 0, 96, 6, 60, 0, 14, true);
    for (let u = 0; u <= 96; u += 4) k.box(0x8a949c, u - 0.12, u + 0.12, 5.9, 6.1, 0, 14);
    for (let u = 0; u < 96; u += 4) k.pane(u, u + 4, 0, 14, 5.95);
    k.box(0xc8ccd0, 0, 96, 8, 60, 14, 15);
    // The wing of a roof, reaching out over the kerb, and its columns.
    k.box(0xdce0e4, -4, 100, -7, 62, 15, 16.2);
    k.lit(0xf0f4f4, -3.8, 99.8, -6.8, 5.8, 14.95, 15.0);
    for (const u of [8, 32, 56, 80]) k.post(0xb8c0c4, u, -6, 0, 15, 0.4, 12);
    plate(k, 46, 3.2, 48, -7.1, 17.9, (g, W, H) => {
      g.fillStyle = '#f4f6f8';
      g.fillRect(0, 0, W, H);
      text(g, '東都空港', W * 0.3, H * 0.55, `bold ${Math.round(H * 0.6)}px 'Yu Gothic', sans-serif`, '#1a2a5a');
      text(g, 'TŌTO AIRPORT · DEPARTURES 出発', W * 0.72, H * 0.55, `bold ${Math.round(H * 0.24)}px Arial, sans-serif`, '#1a4aa0');
    });
    // The kerb: taxis in a line, the limousine bus, travellers.
    for (let i = 0; i < 4; i++) car(k, 12 + i * 5.5, -9, 1, 0, 'taxi', 0x2a2a2e, 40 + i);
    car(k, 60, -9, 1, 0, 'minivan', 0xe8e8e4, 45);
    const who: ['man' | 'woman', number][] = [['woman', 20], ['man', 34], ['man', 46], ['woman', 58], ['woman', 70], ['man', 84]];
    who.forEach(([body, u], i) => k.person(u, -3 - (i % 2) * 1.5, i % 2 ? 1 : -1, 0, { body, pose: i % 3 === 0 ? 'phone' : 'walk', color: body === 'woman' ? [1.0, 0.85, 0.9] : [0.8, 0.88, 1.0], ...(body === 'woman' ? { hair: 'long' as const } : {}) }));
  },

  // ---- The control tower: a tapering shaft, the cab of green-tinted glass (lit at night), antennas, the beacon ----
  control_tower(k) {
    k.box(0xc8ccd0, 4, 12, 4, 12, 0, 54);
    k.box(0x9aa0a6, 2, 14, 2, 14, 54, 56);
    k.lit(0x6ac8b0, 2.4, 13.6, 2.4, 13.6, 56, 61, false);
    for (const [u0, u1, t0, t1] of [[2, 14, 2, 2.4], [2, 14, 13.6, 14], [2, 2.4, 2, 14], [13.6, 14, 2, 14]] as const) k.box(0x3a4046, u0, u1, t0, t1, 60.5, 61);
    k.box(0x5a6066, 1.6, 14.4, 1.6, 14.4, 61, 62.2);
    k.post(0x8a8e92, 8, 8, 62.2, 70, 0.15, 6);
    k.glow([3.0, 0.2, 0.15], 7.6, 8.4, 7.6, 8.4, 70, 70.8, EMIT.always);
    plate(k, 10, 1.4, 8, -0.05, 50, (g, W, H) => {
      g.fillStyle = '#e8ecf0';
      g.fillRect(0, 0, W, H);
      text(g, 'TŌTO TOWER', W / 2, H * 0.6, `bold ${Math.round(H * 0.55)}px Arial, sans-serif`, '#1a2a5a');
    });
  },
};
