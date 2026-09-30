import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { addTree } from '../models/trees';
import { addCar } from './cars';
import { Kit, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toLocal, toWorld } from './localFrame';
import { EMIT, KIND, lin } from './meshBuilder';

/**
 * The outer districts' set pieces (Takanodai on the heights, Nishihara in the western suburbs; the whole-city
 * plan: docs/city-plan.md), registered with the kit landmarks (asagiri.ts), in the building's local frame (u along
 * the street face, t inward):
 * - lookout: 鷹ノ台展望公園, the park on Takanodai's summit: a railed viewing terrace looking out over the city,
 *   coin telescopes, benches, a shelter, cherry trees, lamps, couples at the rail.
 * - ryokan: 鷹の湯, a traditional inn on the hillside: its gate and lanterns, the garden, the two-storey wooden inn
 *   with its engawa, steam rising from the outdoor bath behind the fence.
 * - villa: the house at the top of the heights (the top of the MC's housing ladder): white walls and glass, the
 *   three-car garage, the terrace with its pool looking out.
 * - flood_shaft: the flood tunnel's hidden entrance (the pillared halls under the heights): a fenced concrete shaft
 *   house with its steel door and warning signs.
 * - danchi: 西原団地, a 1960s housing estate: five-storey slab blocks in rows with their numbers painted on, bicycle
 *   sheds, a playground, the water tower. The salaryman lives in block 3.
 * - ruined_park: 西原ドリームランド, an amusement park closed for years at the city's edge: the rusted wheel, the
 *   broken coaster track, the ticket gate chained shut, weeds everywhere.
 */
export const SUBURB_KINDS = ['lookout', 'ryokan', 'villa', 'flood_shaft', 'danchi', 'ruined_park'] as const;
export type SuburbKind = (typeof SUBURB_KINDS)[number];

type C3 = [number, number, number];

/**
 * The lookout's observation deck, raised over the houses on the slope below the summit: a timber platform on posts,
 * a straight stair up to it from the west (its foot at u0, its head at the deck's edge).
 */
export const LOOKOUT_DECK = { y: 8, u0: 22, u1: 58, t0: 33, t1: 45, stair: { u0: 6, t0: 38.5, t1: 41 } } as const;

/** Floors above the ground: the lookout's stair and deck (relative to the landmark's footing). */
export function suburbFloor(kind: SuburbKind, b: Building3, x: number, z: number, current: number): number | null {
  if (kind !== 'lookout') return null;
  const D = LOOKOUT_DECK;
  const [u, t] = toLocal(localFrame(b), x, z);
  if (t > D.stair.t0 && t < D.stair.t1 && u > D.stair.u0 && u < D.u0 + 0.5) {
    const y = (D.y * Math.min(1, (u - D.stair.u0) / (D.u0 - D.stair.u0)));
    // The stair only for someone on it (you walk under its upper flight on the ground).
    return Math.abs(y - current) < 1.2 ? y : null;
  }
  if (current > D.y / 2 && u > D.u0 && u < D.u1 && t > D.t0 && t < D.t1) return D.y;
  return null;
}

/** Collision above the ground: the deck's rails (open where the stair arrives) and the stair's sides. */
export function suburbRaisedColliders(kind: SuburbKind, b: Building3, floor: number): Rect[] {
  if (kind !== 'lookout') return [];
  const D = LOOKOUT_DECK;
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  const deck = [R(D.u0, D.u1, D.t0, D.t0 + 0.3), R(D.u0, D.u1, D.t1 - 0.3, D.t1), R(D.u1 - 0.3, D.u1, D.t0, D.t1), R(D.u0, D.u0 + 0.3, D.t0, D.stair.t0), R(D.u0, D.u0 + 0.3, D.stair.t1, D.t1)];
  const stair = [R(D.stair.u0, D.u0, D.stair.t0 - 0.3, D.stair.t0), R(D.stair.u0, D.u0, D.stair.t1, D.stair.t1 + 0.3)];
  return floor > D.y - 1 ? deck : stair;
}

export function suburbColliders(kind: SuburbKind, b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  switch (kind) {
    case 'lookout':
      // The rail along the far edge, the shelter.
      return [R(2, 78, 47.4, 48), R(4, 12, 20, 28)];
    case 'ryokan':
      return [R(0, 16, 0, 0.6), R(24, 40, 0, 0.6), R(4, 36, 12, 30), R(0, 0.6, 0, 34), R(39.4, 40, 0, 34)];
    case 'villa':
      return [R(2, 34, 4, 26)];
    case 'flood_shaft':
      return [R(3, 13, 3, 11), R(0, 16, 0, 0.3), R(0, 0.3, 0, 12), R(15.7, 16, 0, 12), R(0, 16, 11.7, 12)];
    case 'danchi':
      return DANCHI.map(([t0, t1]) => R(10, 94, t0, t1));
    case 'ruined_park':
      // The fence but for a gap at the far end (88-91), the chained gate, the carousel.
      return [R(0, 42, 0, 0.5), R(58, 88, 0, 0.5), R(91, 100, 0, 0.5), R(42, 58, 1.2, 1.7), R(66, 78, 40, 52)];
  }
}

export function suburbShelters(kind: SuburbKind, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): { rect: Rect; y0: number; y1: number; enclosed: boolean } => ({ rect: localRect(f, u0, u1, t0, t1), y0, y1, enclosed: false });
  switch (kind) {
    case 'lookout':
      return [R(4, 12, 20, 28, 0, 3)];
    case 'ryokan':
      return [R(16, 24, 0, 3, 0, 3.2)];
    default:
      return [];
  }
}

export function suburbLights(kind: SuburbKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  const warm: C3 = [1.0, 0.78, 0.52];
  const cool: C3 = [0.85, 0.92, 1.0];
  switch (kind) {
    case 'lookout':
      return [15, 40, 65].map((u) => L(u, 44, 9, warm, 0.6));
    case 'ryokan':
      return [L(20, -1, 7, warm, 0.9), L(20, 10, 8, warm, 0.6)];
    case 'villa':
      return [L(18, 2, 8, cool, 0.6), L(18, 30, 10, [0.4, 0.8, 1.0], 0.5)];
    case 'flood_shaft':
      return [L(8, -1, 5, [1.0, 0.85, 0.4], 0.5)];
    case 'danchi':
      return [L(30, 4, 10, cool, 0.5), L(70, 4, 10, cool, 0.5), L(50, 90, 9, cool, 0.4)];
    case 'ruined_park':
      return [];
  }
}

/** The danchi's blocks: their bands across the lot (t0, t1). */
const DANCHI: readonly (readonly [number, number])[] = [[14, 26], [36, 48], [58, 70]];

function plate(k: Kit, w: number, h: number, u: number, t: number, y: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, neon = false, facing: 'out' | 'in' | '+u' | '-u' = 'out'): THREE.Mesh {
  const W = Math.round(w * 64);
  const H = Math.round(h * 64);
  return k.plane(k.canvas(W, H, (g) => draw(g, W, H)), w, h, u, t, y, facing, neon ? 1.4 : 1.0, neon);
}

function tree(k: Kit, u: number, t: number, species: Parameters<typeof addTree>[1]['species'], size: number, seed: number): void {
  const [x, z] = toWorld(k.f, u, t);
  addTree(k.mb, { x, z, species, size, seed });
}

/** A straight member between two local points [u, t, y] (girders, spokes, braces), r its thickness. */
function beam(k: Kit, hex: number, a: C3, b: C3, r: number): void {
  const [ax, az] = toWorld(k.f, a[0], a[1]);
  const [bx, bz] = toWorld(k.f, b[0], b[1]);
  k.mb.kind = KIND.plain;
  k.mb.color = lin(hex);
  k.mb.beam([ax, a[2], az], [bx, b[2], bz], r);
}

/** A hipped tiled roof: stepped slabs narrowing to the ridge. */
function roof(k: Kit, u0: number, u1: number, t0: number, t1: number, y: number, h: number, over = 1, hex = 0x3a3c40): void {
  for (let i = 0; i < 5; i++) {
    const f = i / 5;
    const inset = (Math.min(u1 - u0, t1 - t0) / 2) * f * 0.85;
    const o = over * (1 - f);
    k.box(hex, u0 - o + inset, u1 + o - inset, t0 - o + inset, t1 + o - inset, y + (h * i) / 5, y + (h * (i + 1)) / 5 + 0.05);
  }
}

export const SUBURB_BUILDERS: Record<SuburbKind, (k: Kit) => ((camera: THREE.Vector3, dt: number) => void) | void> = {
  // ---- 鷹ノ台展望公園: the lookout on the summit. Gravel paths, the railed terrace along the far edge (the city
  // below it), coin telescopes, benches, a shelter, cherry trees and lamps; a couple at the rail ----
  lookout(k) {
    k.kind(KIND.grass, 0x4a6a34, 0, 80, 0, 48, 0, 0.04);
    k.kind(KIND.gravel, 0xb8a888, 36, 44, 0, 44, 0.04, 0.07);
    k.kind(KIND.sidewalk, 0xa8a090, 2, 78, 40, 47.5, 0.04, 0.12);
    // The rail.
    for (let u = 2; u <= 78; u += 2.5) k.box(0x6a6e72, u - 0.05, u + 0.05, 47.5, 47.6, 0.1, 1.15);
    k.box(0x8a8e92, 2, 78, 47.45, 47.65, 1.1, 1.2);
    // Telescopes and benches along it.
    for (const u of [12, 30, 50, 68]) {
      k.post(0x4a6a8a, u, 46.5, 0.1, 1.1, 0.08, 8);
      k.box(0x4a6a8a, u - 0.2, u + 0.2, 46.1, 46.9, 1.1, 1.45);
    }
    for (const u of [20, 40, 60]) {
      k.box(0x8a5a32, u - 1, u + 1, 44.2, 44.7, 0.45, 0.55);
      k.box(0x8a5a32, u - 1, u + 1, 44.6, 44.7, 0.55, 1.0);
    }
    // The shelter (azumaya): four posts, a pyramid roof.
    for (const [u, t] of [[4.5, 20.5], [11.5, 20.5], [4.5, 27.5], [11.5, 27.5]] as const) k.box(0x6a4a32, u - 0.15, u + 0.15, t - 0.15, t + 0.15, 0, 2.6);
    roof(k, 4, 12, 20, 28, 2.6, 1.6, 0.8, 0x4a3a2a);
    // Lamps, cherry trees.
    for (const u of [15, 40, 65]) {
      k.post(0x3a3a3a, u, 43.5, 0, 3.6, 0.06, 6);
      k.glow([1.4, 1.1, 0.8], u - 0.25, u + 0.25, 43.25, 43.75, 3.5, 3.9, EMIT.lamp);
    }
    for (const [u, t] of [[8, 8], [22, 14], [58, 10], [72, 18], [26, 32], [64, 30]] as const) tree(k, u, t, (u + t) % 3 ? 'sakuraBloom' : 'sakura', 0.9, u * 7 + t);
    plate(k, 5, 1.2, 40, -0.05, 1.4, (g, W, H) => {
      g.fillStyle = '#3a2a1a';
      g.fillRect(0, 0, W, H);
      text(g, '鷹ノ台展望公園', W / 2, H * 0.6, `bold ${Math.round(H * 0.55)}px 'Yu Mincho', serif`, '#f0e0c0');
    });
    // The observation deck over the slope's roofs: posts, the timber platform, its rails, the stair up.
    const D = LOOKOUT_DECK;
    const TIMBER = 0x6a4a32;
    for (let u = D.u0 + 0.3; u <= D.u1; u += 6) for (const t of [D.t0 + 0.3, (D.t0 + D.t1) / 2, D.t1 - 0.3]) k.box(0x5a5e62, u - 0.18, u + 0.18, t - 0.18, t + 0.18, 0, D.y - 0.3);
    k.box(TIMBER, D.u0, D.u1, D.t0, D.t1, D.y - 0.3, D.y);
    for (const [u0, u1, t0, t1] of [[D.u0, D.u1, D.t0, D.t0 + 0.1], [D.u0, D.u1, D.t1 - 0.1, D.t1], [D.u1 - 0.1, D.u1, D.t0, D.t1], [D.u0, D.u0 + 0.1, D.t0, D.stair.t0], [D.u0, D.u0 + 0.1, D.stair.t1, D.t1]] as const) {
      k.box(0x8a8e92, u0, u1, t0, t1, D.y + 1.05, D.y + 1.15);
      k.box(0x8a8e92, u0, u1, t0, t1, D.y + 0.5, D.y + 0.55);
    }
    const steps = 24;
    const run = D.u0 - D.stair.u0;
    for (let i = 0; i < steps; i++) {
      const u = D.stair.u0 + (run * i) / steps;
      k.box(TIMBER, u, u + run / steps + 0.02, D.stair.t0, D.stair.t1, (D.y * i) / steps, (D.y * (i + 1)) / steps);
    }
    for (const t of [D.stair.t0 - 0.05, D.stair.t1 + 0.05]) {
      for (let i = 0; i < 8; i++) {
        const u = D.stair.u0 + (run * i) / 8;
        k.box(0x8a8e92, u, u + run / 8 + 0.02, t - 0.05, t + 0.05, (D.y * (i + 1)) / 8 + 0.9, (D.y * (i + 1)) / 8 + 1.0);
      }
    }
    for (const u of [30, 50]) {
      k.post(0x4a6a8a, u, D.t1 - 0.8, D.y, D.y + 1.1, 0.08, 8);
      k.box(0x4a6a8a, u - 0.2, u + 0.2, D.t1 - 1.2, D.t1 - 0.4, D.y + 1.1, D.y + 1.45);
    }
    k.person(47, D.t1 - 0.6, 0, 1, { body: 'woman', pose: 'hold', color: [1.0, 0.85, 0.9], hair: 'long', y: D.y });
    k.person(48, D.t1 - 0.6, 0, 1, { body: 'man', pose: 'hold', color: [0.8, 0.88, 1.0], y: D.y });
    k.person(12, 45.8, 0, 1, { body: 'elder', pose: 'stand', color: [0.9, 0.85, 0.8] });
  },

  // ---- 鷹の湯: the ryokan. A roofed gate in a plastered wall, lanterns, stepping stones through a garden of pines
  // and maples, the two-storey wooden inn with its engawa and paper screens lit warm, steam over the bath fence ----
  ryokan(k) {
    const WOOD = 0x5a3a24;
    for (const [u0, u1] of [[0, 16], [24, 40]] as const) {
      k.box(0xe8e2d4, u0, u1, 0, 0.6, 0, 2.4);
      k.box(0x3a3c40, u0 - 0.2, u1 + 0.2, -0.2, 0.8, 2.4, 2.8);
    }
    for (const [u0, u1] of [[0, 0.6], [39.4, 40]] as const) {
      k.box(0xe8e2d4, u0, u1, 0, 34, 0, 2.4);
      k.box(0x3a3c40, u0 - 0.2, u1 + 0.2, 0, 34, 2.4, 2.8);
    }
    // The gate.
    for (const u of [16, 23.4]) k.box(WOOD, u, u + 0.6, 0, 2.6, 0, 3.2);
    roof(k, 15.5, 24.5, -0.8, 3.2, 3.2, 1.3, 1, 0x3a3c40);
    plate(k, 5, 0.9, 20, -0.9, 2.7, (g, W, H) => {
      g.fillStyle = '#3a2a1a';
      g.fillRect(0, 0, W, H);
      text(g, '旅館 鷹の湯', W / 2, H * 0.6, `bold ${Math.round(H * 0.6)}px 'Yu Mincho', serif`, '#f4e4c4');
    });
    for (const u of [14.4, 25.6]) {
      k.lathe(0xf4ecd8, u, -0.8, [[1.4, 0.25], [1.6, 0.35], [2.2, 0.35], [2.4, 0.25]], 10);
      k.glow([1.4, 1.1, 0.7], u - 0.2, u + 0.2, -1, -0.6, 1.5, 2.3, EMIT.lamp);
    }
    // Stepping stones, garden trees.
    for (let t = 2; t < 12; t += 1.3) k.box(0x9a968e, 19.2 + Math.sin(t) * 0.6, 20.8 + Math.sin(t) * 0.6, t, t + 0.9, 0, 0.12);
    tree(k, 8, 6, 'pine', 0.9, 3);
    tree(k, 32, 7, 'dogwoodBloom', 0.8, 5);
    tree(k, 6, 32, 'camphor', 0.8, 9);
    // The inn: ground floor with engawa and lit shoji, the upper floor, the roofs.
    k.box(0xd8ccb0, 4, 36, 13, 30, 0, 3.2);
    k.lit(0xfff0d0, 5, 35, 12.9, 13, 0.6, 2.8, false);
    for (let u = 5; u <= 35; u += 1.8) k.box(WOOD, u - 0.06, u + 0.06, 12.85, 12.95, 0.6, 2.8);
    k.box(WOOD, 4, 36, 11.4, 13, 0.4, 0.6);
    roof(k, 3, 37, 11, 31, 3.2, 1.2, 1.2, 0x3a3c40);
    k.box(0xd8ccb0, 7, 33, 15, 28, 4.4, 7.2);
    k.lit(0xfff0d0, 8, 32, 14.9, 15, 5, 6.8, false);
    for (let u = 8; u <= 32; u += 1.8) k.box(WOOD, u - 0.06, u + 0.06, 14.85, 14.95, 5, 6.8);
    roof(k, 6, 34, 14, 29, 7.2, 2.6, 1.4, 0x3a3c40);
    // The bath fence round the back, the steam.
    k.box(0x7a5a3a, 30, 38, 30, 33.6, 0, 2.2);
    const steam = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
    const [sx, sz] = toWorld(k.f, 34, 32);
    steam.position.set(sx, 3.5, sz);
    k.group.add(steam);
    let t = 0;
    return (_c, dt) => {
      t += dt;
      steam.scale.set(1 + Math.sin(t * 0.7) * 0.15, 1.2 + Math.sin(t * 0.5) * 0.25, 1 + Math.cos(t * 0.6) * 0.15);
      steam.position.y = 3.8 + Math.sin(t * 0.4) * 0.4;
    };
  },

  // ---- The villa: white walls and glass on two floors, a flat roof, the three-car garage, the pool on the terrace
  // at the back looking out over the city ----
  villa(k) {
    const WHITE = 0xf0eeea;
    k.box(WHITE, 2, 34, 4, 26, 0, 3.4);
    k.lit(0xfff4e0, 12, 33.9, 3.9, 4, 0.2, 3.1, false);
    for (let u = 12; u <= 34; u += 2.2) k.box(0x2a2a2e, u - 0.05, u + 0.05, 3.85, 3.95, 0, 3.3);
    k.box(0x2a2e34, 2.5, 11.5, 3.9, 4, 0.1, 2.6);
    for (const u of [5.5, 8.5]) k.box(0x5a5e62, u - 0.03, u + 0.03, 3.85, 3.9, 0.1, 2.6);
    k.box(WHITE, 6, 34, 6, 22, 3.4, 6.8);
    k.lit(0xfff4e0, 8, 33, 5.9, 6, 3.8, 6.4, false);
    k.box(0x2a2a2e, 1.5, 34.5, 3.5, 26.5, 6.8, 7.2);
    k.box(0x2a2a2e, 1.5, 34.5, 3.5, 26.5, 3.3, 3.5);
    // The drive, a car out on it.
    k.kind(KIND.sidewalk, 0x9a968e, 2.5, 11.5, 0, 4, 0, 0.05);
    const [cx, cz] = toWorld(k.f, 7, 1.6);
    addCar(k.mb, { x: cx, z: cz, fx: k.f.r[0], fz: k.f.r[2], variant: 71, type: 'sedan', paint: 0x1a1a22 });
    // The terrace and the pool behind.
    k.kind(KIND.sidewalk, 0xd8d4cc, 2, 34, 26, 36, 0, 0.3);
    k.glow([0.25, 0.9, 1.3], 10, 30, 28, 33, 0.3, 0.32, EMIT.always);
    k.box(0x7a8a92, 2, 34, 35.8, 36, 0.3, 1.3);
    for (const u of [5, 32]) tree(k, u, 30, 'box', 1.2, u);
    plate(k, 3, 0.5, 30, 3.85, 1.6, (g, W, H) => {
      g.fillStyle = '#e8e4dc';
      g.fillRect(0, 0, W, H);
      text(g, 'TAKANODAI 1-1', W / 2, H * 0.62, `600 ${Math.round(H * 0.5)}px Arial, sans-serif`, '#3a3a3a');
    });
  },

  // ---- The flood tunnel's entrance: a fenced concrete shaft house, its steel door, the warning signs ----
  flood_shaft(k) {
    for (const [u0, u1, t0, t1] of [[0, 6.5, 0, 0.3], [9.5, 16, 0, 0.3], [0, 0.3, 0, 12], [15.7, 16, 0, 12], [0, 16, 11.7, 12]] as const) {
      for (let u = u0; u <= u1; u += 2) k.box(0x6a6e72, u - 0.05, u + 0.05, t0, t1, 0, 2.4);
      k.box(0x6a6e72, u0, u1, t0, t1, 2.3, 2.4);
    }
    k.box(0x9a9a94, 3, 13, 3, 11, 0, 5);
    k.box(0x7a7a74, 2.6, 13.4, 2.6, 11.4, 5, 5.4);
    k.box(0x4a5a5a, 6.8, 9.2, 2.95, 3, 0, 2.4);
    k.glow([1.4, 1.1, 0.5], 7.6, 8.4, 2.9, 2.95, 2.6, 2.8, EMIT.lamp);
    plate(k, 3.2, 1.6, 8, -0.05, 1.4, (g, W, H) => {
      g.fillStyle = '#f0e030';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#1a1a1a';
      for (let i = -H; i < W; i += 28) g.fillRect(i, 0, 12, H * 0.14);
      text(g, '立入禁止', W / 2, H * 0.48, `bold ${Math.round(H * 0.3)}px 'Yu Gothic', sans-serif`, '#1a1a1a');
      text(g, '東都地下放水路 第3立坑', W / 2, H * 0.78, `bold ${Math.round(H * 0.14)}px 'Yu Gothic', sans-serif`, '#1a1a1a');
    });
  },

  // ---- 西原団地: three five-storey slab blocks in rows (their numbers painted big on the ends), balconies with
  // laundry, bicycle sheds, a playground between them, the water tower ----
  danchi(k) {
    DANCHI.forEach(([t0, t1], i) => {
      k.facade(0xd8d4c8, [3.2, 0.45, 1.5, 3], 256 + 128 + 1 * 16, 10, 94, t0, t1, 0, 15, true);
      k.box(0xa8a49a, 9.6, 94.4, t0 - 0.4, t1 + 0.4, 15, 15.6);
      // The number on the end wall.
      plate(k, 6, 6, 10.02, (t0 + t1) / 2, 11, (g, W, H) => {
        g.fillStyle = '#d8d4c8';
        g.fillRect(0, 0, W, H);
        text(g, `${i + 1}`, W / 2, H * 0.5, `900 ${Math.round(H * 0.7)}px Arial, sans-serif`, '#2a5a8a');
      }, false, '-u');
      // Laundry along the balconies.
      for (let fl = 0; fl < 4; fl++) for (let u = 12; u < 92; u += 6) k.box([0xf0f0f0, 0x8ab0d8, 0xe8c8a0, 0xd88a8a][(u + fl + i) % 4], u, u + 1.4, t0 - 0.9, t0 - 0.8, 4.6 + fl * 2.8, 5.4 + fl * 2.8);
      // A bicycle shed along the front.
      k.box(0x8a9098, 30, 50, t0 - 5, t0 - 3, 2.2, 2.35);
      for (const u of [30.2, 49.8]) k.box(0x6a6e72, u - 0.08, u + 0.08, t0 - 4.2, t0 - 3.8, 0, 2.2);
    });
    // The playground: a slide, swings, the sandpit.
    k.kind(KIND.gravel, 0xb89a70, 30, 70, 50, 56, 0, 0.04);
    k.box(0xd83a2a, 36, 37, 51, 55, 0, 2.2);
    for (const u of [52, 55]) k.box(0x3a6ac8, u - 0.06, u + 0.06, 52, 52.1, 0, 2.4);
    k.box(0x3a6ac8, 51.8, 55.2, 52, 52.1, 2.3, 2.4);
    // The water tower.
    k.post(0x9a9a94, 88, 84, 0, 18, 1.2, 12);
    k.lathe(0xb8b8b0, 88, 84, [[18, 1.2], [19, 4], [24, 4], [25, 2]], 16);
    k.box(0x9a968e, 2, 14, 0.1, 0.9, 0, 0.9);
    plate(k, 11, 1.2, 8, -0.02, 1.6, (g, W, H) => {
      g.fillStyle = '#2a5a8a';
      g.fillRect(0, 0, W, H);
      text(g, '都営 西原団地 NISHIHARA DANCHI', W / 2, H * 0.6, `bold ${Math.round(H * 0.45)}px 'Yu Gothic', sans-serif`, '#ffffff');
    });
    k.person(40, 30, 1, 0, { body: 'elder', pose: 'walk', color: [0.9, 0.85, 0.8] });
    k.person(53, 54, 0, 1, { body: 'child', pose: 'wave', color: [1.0, 0.85, 0.9] });
    k.person(55, 55, 0, -1, { body: 'woman', pose: 'stand', color: [1.0, 0.85, 0.9], hair: 'bun' });
  },

  // ---- 西原ドリームランド, closed for years: the ticket gate chained shut behind a fence, the rusted wheel (one
  // gondola hanging askew), a broken coaster track stopping in mid-air, the dead carousel, weeds everywhere ----
  ruined_park(k) {
    const RUST = 0x7a4a2e;
    k.kind(KIND.gravel, 0x6a6a52, 0, 100, 0, 100, 0, 0.04);
    // The fence along the street, the gate between its posts, chained.
    for (let u = 0; u <= 100; u += 2.5) if ((u < 42 || u > 58) && (u < 88 || u > 91)) k.box(0x6a6e72, u - 0.05, u + 0.05, 0, 0.1, 0, 2.6);
    k.box(0x6a6e72, 0, 42, 0, 0.1, 2.5, 2.6);
    k.box(0x6a6e72, 58, 88, 0, 0.1, 2.5, 2.6);
    k.box(0x6a6e72, 91, 100, 0, 0.1, 2.5, 2.6);
    // The gap: a fence panel bent back.
    k.box(0x6a6e72, 88, 88.1, 0.1, 2.6, 0, 2.5);
    k.box(0x8a3a2a, 42, 44, 0, 3, 0, 5);
    k.box(0x8a3a2a, 56, 58, 0, 3, 0, 5);
    k.box(0x8a3a2a, 42, 58, 0, 3, 5, 6.4);
    k.box(0x5a5e62, 44, 56, 1.4, 1.5, 0, 2.6);
    plate(k, 14, 1.4, 50, -0.05, 5.7, (g, W, H) => {
      g.fillStyle = '#d8c8a0';
      g.fillRect(0, 0, W, H);
      text(g, '西原ドリームランド', W / 2, H * 0.58, `bold ${Math.round(H * 0.6)}px 'Yu Gothic', sans-serif`, '#8a3a2a');
      g.fillStyle = 'rgba(60,40,20,0.45)';
      g.fillRect(W * 0.62, 0, W * 0.2, H);
    });
    plate(k, 3, 1.2, 50, -0.08, 1.8, (g, W, H) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
      text(g, '閉園 CLOSED', W / 2, H * 0.4, `bold ${Math.round(H * 0.3)}px 'Yu Gothic', sans-serif`, '#c81a1a');
      text(g, '関係者以外立入禁止', W / 2, H * 0.78, `bold ${Math.round(H * 0.16)}px 'Yu Gothic', sans-serif`, '#1a1a1a');
    });
    // The wheel: its two rims, spokes and cross-ties as girders, on an A-frame; gondolas, one hanging askew.
    const HU = 30;
    const HT = 60;
    const HY = 22;
    const R = 18;
    const N = 36;
    const rim = (a: number, t: number): C3 => [HU + Math.cos(a) * R, t, HY + Math.sin(a) * R];
    for (const t of [HT - 1, HT + 1]) {
      for (let i = 0; i < N; i++) beam(k, RUST, rim((i / N) * Math.PI * 2, t), rim(((i + 1) / N) * Math.PI * 2, t), 0.35);
      for (let i = 0; i < 12; i++) beam(k, RUST, [HU, t, HY], rim((i / 12) * Math.PI * 2 + 0.1, t), 0.18);
    }
    for (let i = 0; i < 12; i++) beam(k, RUST, rim((i / 12) * Math.PI * 2, HT - 1), rim((i / 12) * Math.PI * 2, HT + 1), 0.2);
    beam(k, RUST, [HU, HT - 3.2, HY], [HU, HT + 3.2, HY], 0.8);
    for (const dt of [-3, 3]) for (const du of [-9, 9]) beam(k, RUST, [HU + du, HT + dt, 0], [HU, HT + dt * 0.4, HY], 0.6);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const [u, , y] = rim(a, HT);
      if (i === 8) continue; // (fallen)
      const skew = i === 3 ? 0.8 : 0;
      k.box([0x8a6a4a, 0x6a7a6a, 0x7a5a5a][i % 3], u - 1 + skew, u + 1 + skew, HT - 0.9, HT + 0.9, y - 3.2 + skew * 0.5, y - 1.2);
      beam(k, RUST, [u, HT, y], [u + skew, HT, y - 1.2], 0.08);
    }
    // The fallen gondola in the weeds.
    k.box(0x7a5a5a, 22, 24, 70, 71.6, 0, 1.4);
    // The coaster: two rails on supports climbing east, then the track stops dead in mid-air.
    const path: C3[] = [];
    for (let u = 60; u <= 90; u += 3) path.push([u, 20 + Math.sin((u - 60) / 9) * 6, 2 + (u < 84 ? (u - 60) * 0.55 : 13.2 + (u - 84) * 0.2)]);
    for (let i = 0; i + 1 < path.length; i++) {
      const [a, b] = [path[i], path[i + 1]];
      for (const o of [-0.7, 0.7]) beam(k, RUST, [a[0], a[1] + o, a[2]], [b[0], b[1] + o, b[2]], 0.18);
      beam(k, RUST, [a[0], a[1] - 0.7, a[2] - 0.2], [a[0], a[1] + 0.7, a[2] - 0.2], 0.15);
      if (i % 2 === 0) {
        beam(k, 0x9a8a7a, [a[0], a[1], 0], [a[0], a[1], a[2] - 0.2], 0.3);
        beam(k, 0x9a8a7a, [a[0] - 1.5, a[1], 0], [a[0], a[1], a[2] * 0.6], 0.15);
      }
    }
    // A broken length hanging down from the end.
    const end = path[path.length - 1];
    beam(k, RUST, end, [end[0] + 2, end[1] + 0.4, end[2] - 5], 0.18);
    // The carousel, dead: its roof sagging on its pole.
    k.lathe(0x8a7a6a, 72, 46, [[0, 6], [0.6, 6]], 16);
    k.post(0xa89a7a, 72, 46, 0.6, 5, 0.3, 10);
    k.lathe(0x9a5a4a, 72, 46, [[4.6, 6.4], [6.2, 0.4]], 12);
    // Weeds, everywhere.
    for (let i = 0; i < 70; i++) {
      const u = 4 + ((i * 37) % 92);
      const t = 4 + ((i * 53) % 92);
      tree(k, u, t, 'box', 0.5 + (i % 5) * 0.12, i);
    }
  },
};
