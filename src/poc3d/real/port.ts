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
 */
export const PORT_KINDS = ['fish_market', 'disco', 'tuning_shop', 'ferry_terminal', 'gantry'] as const;
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

export const PORT_BUILDERS: Record<PortKind, (k: Kit) => ((camera: THREE.Vector3, dt: number) => void) | void> = {
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
    for (const [y0, y1, u0, u1] of [[7.2, 8.4, -17, 55], [11.5, 12.6, -7, 35], [3.6, 4.6, -26, 66]] as const) k.glow([1.6, 1.4, 1.0], u0, u1, T0 - 0.05, T0 + 0.05, y0, y1, EMIT.lamp);
    k.box(0x1a4aa0, 10, 18, T0 + 5, T0 + 11, 14, 19);
    k.box(0x101010, 10, 18, T0 + 5, T0 + 11, 19, 20);
    k.glow([2.5, 0.2, 0.15], 13.8, 14.2, T0 + 7.8, T0 + 8.2, 20, 20.4, EMIT.always);
    plate(k, 18, 1.6, 20, T0 - 0.1, 4.2, (g, W, H) => {
      g.fillStyle = '#f0f0ec';
      g.fillRect(0, 0, W, H);
      text(g, 'さんふらわあ とうと', W / 2, H * 0.72, `bold ${Math.round(H * 0.6)}px 'Yu Gothic', sans-serif`, '#1a4aa0');
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
};
