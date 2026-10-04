import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import { makeRoad, type Road } from '../district/expressway';
import type { Building3 } from '../district/plan';
import { addCar } from './cars';
import { Kit, neonText, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toWorld } from './localFrame';
import { EMIT, KIND } from './meshBuilder';
import { buildMaidCafe, maidCafeColliders, maidCafeLights, maidCafeShelters } from './maidCafe';

/**
 * 電光町 Denkō-chō's set pieces (the whole-city plan: docs/city-plan.md), registered with the kit landmarks
 * (asagiri.ts), in the building's local frame (u along the street face, t inward):
 * - idol_theatre: STELLA THEATER, the small idol venue (Akihabara's theatre on an upper floor): a narrow tower
 *   with the theatre's banner down its face, the goods shop at street level, fans queueing with light sticks and a
 *   staffer holding the end-of-line sign; the lift up is a story door.
 * - arcade: DENKŌ GAME TOWER, a game centre: a red tower of neon, crane games glowing through its open front.
 * - car_park: 電光町パーキング, a multi-storey car park you can drive up: two floors and a rooftop, switchback
 *   ramps at either end, landings joining them to the floors (their decks join the expressway's network for
 *   driving: `carParkDecks`); the rooftop is open for drifting.
 * - maid_cafe: めいどかふぇ ♡ぴゅあ♡, the maid café up a stair over an anime goods shop, walk-in (maidCafe.ts).
 */
export const DENKO_KINDS = ['idol_theatre', 'arcade', 'car_park', 'maid_cafe'] as const;
export type DenkoKind = (typeof DENKO_KINDS)[number];

type C3 = [number, number, number];

/** The car park's plan (local metres): floor heights, the floors' extent, the ramps' centrelines. */
export const PARK = { levels: [3.2, 6.4, 9.6], u0: 10, u1: 67, t0: 3, t1: 37, west: 3.5, east: 73.5, rampHalf: 3.5, w: 77, d: 40 } as const;

/**
 * A ramp's height at local t: level under its landings (t 3..10 and 30..37), sloping between (R1 from the street
 * at t -4 up to the first floor at 30; R2 from the first floor at 30 down-t to the second at 10; R3 from the second
 * at 10 up to the roof at 30).
 */
export function rampY(ramp: 1 | 2 | 3, t: number): number {
  const c = (v: number): number => Math.max(0, Math.min(1, v));
  const [a, b, c2] = PARK.levels;
  if (ramp === 1) return a * c((t + 4) / 34);
  if (ramp === 2) return a + (b - a) * c((30 - t) / 20);
  return b + (c2 - b) * c((t - 10) / 20);
}

/**
 * The car park's driving surfaces, in world coordinates (kind 'deck' on the expressway's network): the floors,
 * the ramps (R1 from the street to the first floor at the east end, R2 up to the second at the west end, R3 up to
 * the roof at the east end again, over R1), and short landings joining each ramp's end to its floor (a gap
 * elsewhere keeps a floor and the ramp beside it apart, a wall to drive into).
 */
export function carParkDecks(b: Building3, id: string): Road[] {
  const f = localFrame(b);
  const road = (name: string, pts: [number, number][], y: (i: number, n: number) => number, half: number): Road => {
    const xs: number[] = [];
    const zs: number[] = [];
    const [a, c] = pts;
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    for (let s = 0; s <= L; s += 1) {
      const [x, z] = toWorld(f, a[0] + ((c[0] - a[0]) * s) / L, a[1] + ((c[1] - a[1]) * s) / L);
      xs.push(x);
      zs.push(z);
    }
    return makeRoad(`${id}.${name}`, 'deck', xs, zs, y, half, false);
  };
  const { levels, u0, u1, t0, t1, west, east, rampHalf } = PARK;
  const tm = (t0 + t1) / 2;
  const out: Road[] = [];
  levels.forEach((y, k) => out.push(road(`floor${k + 1}`, [[u0 - 0.5, tm], [u1 + 0.5, tm]], () => y, (t1 - t0) / 2)));
  // (Samples are a metre apart: sample i is at t = start ± i.)
  out.push(road('ramp1', [[east, -4], [east, 36]], (i) => rampY(1, -4 + i), rampHalf));
  out.push(road('ramp2', [[west, 36], [west, 4]], (i) => rampY(2, 36 - i), rampHalf));
  out.push(road('ramp3', [[east, 4], [east, 36]], (i) => rampY(3, 4 + i), rampHalf));
  // Landings: at each ramp's ends, across the gap to the floor.
  const landing = (name: string, u: number, t: number, y: number): void => void out.push(road(name, [[u - 3, t], [u + 3, t]], () => y, 3.5));
  landing('l1', u1 + 1.5, 33.5, levels[0]);
  landing('l2', u0 - 1.5, 33.5, levels[0]);
  landing('l3', u0 - 1.5, 6.5, levels[1]);
  landing('l4', u1 + 1.5, 6.5, levels[1]);
  landing('l5', u1 + 1.5, 33.5, levels[2]);
  return out;
}

export function denkoColliders(kind: DenkoKind, b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  switch (kind) {
    case 'idol_theatre':
      return [R(0, 16, 1.5, 20)];
    case 'arcade':
      // The tower, and the crane games along the open front.
      return [R(0, 18, 7, 20), R(0, 0.5, 0, 7), R(17.5, 18, 0, 7), ...[2, 6, 10, 14].map((u) => R(u, u + 1.6, 4.4, 6))];
    case 'car_park': {
      // Pillars, the rising first ramp (a wall to walk into; a car drives up it), the cars parked downstairs.
      const out: Rect[] = [];
      for (let u = PARK.u0; u <= PARK.u1; u += 8) for (const t of [PARK.t0 + 0.5, 20, PARK.t1 - 0.5]) out.push(R(u - 0.4, u + 0.4, t - 0.4, t + 0.4));
      out.push(R(PARK.east - PARK.rampHalf, PARK.east + PARK.rampHalf, 2, 36));
      for (let u = 13; u < 60; u += 12) out.push(R(u - 1, u + 1, 31, 36));
      return out;
    }
    case 'maid_cafe':
      return maidCafeColliders(b);
  }
}

export function denkoShelters(kind: DenkoKind, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): { rect: Rect; y0: number; y1: number; enclosed: boolean } => ({ rect: localRect(f, u0, u1, t0, t1), y0, y1, enclosed: false });
  switch (kind) {
    case 'idol_theatre':
      return [R(0, 16, -2, 1.5, 0, 4)];
    case 'arcade':
      return [R(0.5, 17.5, 0, 7, 0, 5)];
    case 'car_park':
      return [R(PARK.u0, PARK.u1, PARK.t0, PARK.t1, 0, PARK.levels[2] - 0.4)];
    case 'maid_cafe':
      return maidCafeShelters(b);
  }
}

export function denkoLights(kind: DenkoKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  switch (kind) {
    case 'idol_theatre':
      return [L(8, -2, 9, [1.0, 0.6, 0.9], 0.9)];
    case 'arcade':
      return [L(9, 2, 10, [1.0, 0.4, 0.5], 1.0), L(9, -3, 8, [0.6, 0.5, 1.0], 0.6)];
    case 'car_park':
      return [L(20, 20, 12, [0.85, 0.95, 1.0], 0.7), L(50, 20, 12, [0.85, 0.95, 1.0], 0.7), L(PARK.east, -3, 6, [1.0, 0.85, 0.5], 0.7)];
    case 'maid_cafe':
      return maidCafeLights(b);
  }
}

function plate(k: Kit, w: number, h: number, u: number, t: number, y: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, neon = false): THREE.Mesh {
  const W = Math.round(w * 64);
  const H = Math.round(h * 64);
  return k.plane(k.canvas(W, H, (g) => draw(g, W, H)), w, h, u, t, y, 'out', neon ? 1.4 : 1.0, neon);
}

function car(k: Kit, u: number, t: number, du: number, dt: number, paint: number, variant: number): void {
  const [x, z] = toWorld(k.f, u, t);
  addCar(k.mb, { x, z, fx: k.f.r[0] * du - k.f.n[0] * dt, fz: k.f.r[2] * du - k.f.n[2] * dt, variant, type: 'sedan', paint });
}

export const DENKO_BUILDERS: Record<DenkoKind, (k: Kit, id: string, part: (name: string) => Kit) => ((camera: THREE.Vector3, dt: number) => void) | void> = {
  maid_cafe: buildMaidCafe,
  // ---- STELLA THEATER: a narrow nine-storey tower (the theatre on the eighth floor), its banner down the face,
  // the goods shop at street level, the queue along the pavement with light sticks, the end-of-line sign ----
  idol_theatre(k) {
    k.facade(0xe8e4ec, [2.6, 0.5, 1.4, 1], 1 + 3 * 2, 0, 16, 1.5, 20, 0, 31, true);
    k.box(0x2a2a34, 0, 16, 1.5, 20, 31, 31.8);
    // The theatre floor: a lit band of glass high up, pink.
    k.glow([1.6, 0.6, 1.3], 0.2, 15.8, 1.45, 1.5, 25.2, 27.8, EMIT.neon);
    // The banner down the face, and the name over the door.
    plate(k, 4.2, 18, 12.2, 1.4, 14.5, (g, W, H) => {
      g.fillStyle = '#1a0a1e';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = '#ff8ad8';
      g.lineWidth = 10;
      g.strokeRect(8, 8, W - 16, H - 16);
      const chars = ['ス', 'テ', 'ラ', '劇', '場'];
      chars.forEach((c, i) => neonText(g, c, W / 2, H * (0.1 + i * 0.13), `bold ${Math.round(W * 0.62)}px 'Yu Gothic', sans-serif`, '#ff8ad8'));
      neonText(g, '8F', W / 2, H * 0.8, `900 ${Math.round(W * 0.5)}px Arial, sans-serif`, '#ffe45f');
      text(g, 'STELLA', W / 2, H * 0.92, `bold ${Math.round(W * 0.2)}px Arial, sans-serif`, '#ffffff');
    }, true);
    plate(k, 11, 1.6, 6, 1.4, 4.6, (g, W, H) => {
      g.fillStyle = '#ff5fc8';
      g.fillRect(0, 0, W, H);
      text(g, 'STELLA THEATER ステラ劇場', W / 2, H * 0.58, `bold ${Math.round(H * 0.5)}px 'Yu Gothic', sans-serif`, '#ffffff');
    }, true);
    // Street level: the goods shop, lit, its window of posters.
    k.lit(0xfff0f8, 0.5, 15.5, 1.45, 1.5, 0.2, 3.8, true);
    plate(k, 5.2, 2.2, 3.4, 1.35, 2.0, (g, W, H) => {
      g.fillStyle = '#fff4fa';
      g.fillRect(0, 0, W, H);
      const lines = ['本日公演 18:30', '星屑ガールズ', 'チェキ会 あり', '当日券 あり'];
      lines.forEach((l, i) => text(g, l, W / 2, H * (0.18 + i * 0.22), `bold ${Math.round(H * 0.16)}px 'Yu Gothic', sans-serif`, i === 1 ? '#e8308a' : '#3a2a4a'));
    });
    // The queue along the pavement, light sticks up; the staffer at its end with the sign.
    for (let i = 0; i < 12; i++) {
      const u = 15.5 - i * 1.1;
      k.person(u, -1.2 - (i % 2) * 0.7, 1, 0, { body: i % 4 === 0 ? 'woman' : 'man', pose: i % 3 === 0 ? 'wave' : i % 3 === 1 ? 'phone' : 'stand', color: i % 2 ? [1.0, 0.6, 0.9] : [0.6, 0.8, 1.0], ...(i % 4 === 0 ? { hair: 'long' as const } : {}) });
    }
    k.person(1.5, -2.2, 1, 0, { body: 'man', pose: 'stand', color: [1.0, 0.9, 0.4], hair: 'cap' });
    plate(k, 1.2, 0.9, 1.5, 2.5, 2.2, (g, W, H) => {
      g.fillStyle = '#ffe45f';
      g.fillRect(0, 0, W, H);
      text(g, '最後尾', W / 2, H * 0.4, `bold ${Math.round(H * 0.36)}px 'Yu Gothic', sans-serif`, '#1a1a1a');
      text(g, 'END OF LINE', W / 2, H * 0.78, `bold ${Math.round(H * 0.16)}px Arial, sans-serif`, '#1a1a1a');
    });
  },

  // ---- DENKŌ GAME TOWER: a red tower of neon over an open front of crane games, a purikura booth, regulars ----
  arcade(k) {
    k.facade(0xb81a2a, [2.8, 0.3, 1.2, 5], 1 + 2 * 2, 0, 18, 7, 20, 0, 24, false);
    k.box(0xb81a2a, 0, 18, 0.5, 7, 4.8, 24);
    k.box(0x1a1a1e, 0, 18, 0.5, 7, 24, 24.6);
    // The open ground floor, lit, and the crane games along its front.
    k.lit(0xfff0f0, 0.5, 17.5, 0, 7, 4.78, 4.8, true, true);
    k.lit(0x3a1a2a, 0.5, 17.5, 6.9, 7, 0, 4.8, true);
    const COL: C3[] = [[2.4, 0.6, 1.6], [0.6, 1.6, 2.4], [2.4, 2.0, 0.5], [0.6, 2.4, 1.0]];
    [2, 6, 10, 14].forEach((u, i) => {
      k.box(0xe8e8e8, u, u + 1.6, 4.4, 6, 0, 0.9);
      k.glow(COL[i], u + 0.1, u + 1.5, 4.5, 5.9, 0.9, 2.2, EMIT.always);
      k.box(0xe8e8e8, u, u + 1.6, 4.4, 6, 2.2, 2.5);
    });
    k.box(0xff8ad8, 0.8, 1.9, 1.2, 3.8, 0, 2.2);
    // Neon: the vertical name down the corner, the horizontal band over the front.
    plate(k, 3.2, 16, 16, -0.05, 14, (g, W, H) => {
      g.fillStyle = '#0a0a0e';
      g.fillRect(0, 0, W, H);
      ['ゲ', 'ー', 'ム'].forEach((c, i) => neonText(g, c, W / 2, H * (0.14 + i * 0.2), `bold ${Math.round(W * 0.7)}px 'Yu Gothic', sans-serif`, '#ff4f4f'));
      neonText(g, 'GAME', W / 2, H * 0.78, `900 ${Math.round(W * 0.3)}px Arial, sans-serif`, '#4fe3ff');
    }, true);
    plate(k, 15, 2, 8, -0.05, 6, (g, W, H) => {
      g.fillStyle = '#0a0a0e';
      g.fillRect(0, 0, W, H);
      neonText(g, 'DENKŌ GAME TOWER', W / 2, H * 0.55, `900 ${Math.round(H * 0.5)}px Arial, sans-serif`, '#ffe45f');
    }, true);
    k.person(4, 3.2, 0, 1, { body: 'man', pose: 'stand', color: [0.7, 0.8, 1.0] });
    k.person(12, 3.4, 0, 1, { body: 'woman', pose: 'phone', color: [1.0, 0.75, 0.9], hair: 'long' });
  },

  // ---- 電光町パーキング: the multi-storey car park. Floors on a grid of pillars, lit underneath; switchback
  // ramps at either end; parapets round the floors (open where the landings join); the rooftop, lamps round it;
  // the big P sign on the front and the ROOF arrow at the entrance ----
  car_park(k) {
    const CONC = 0x9a9a94;
    const { levels, u0, u1, t0, t1, west, east, rampHalf } = PARK;
    k.box(0x3a3a3e, u0 - 1, u1 + 1, t0, t1, 0, 0.03);
    levels.forEach((y, li) => {
      const roof = li === levels.length - 1;
      k.kind(KIND.asphalt, roof ? 0x3a3a3e : 0x4a4a4e, u0 - 0.5, u1 + 0.5, t0, t1, y - 0.35, y);
      // Fluorescent strips on the ceiling below this floor.
      for (let u = u0 + 4; u < u1; u += 8) k.lit(0xe8f0f4, u - 1.2, u + 1.2, 19.8, 20.2, y - 0.37, y - 0.35, false, true);
      // Parapets: the long edges, and the ends but for the landings (t 3..10 and 30..37 are openings).
      for (const t of [t0, t1 - 0.3]) k.box(CONC, u0 - 0.5, u1 + 0.5, t, t + 0.3, y, y + 1.1);
      for (const u of [u0 - 0.5, u1 + 0.2]) k.box(CONC, u, u + 0.3, 10, 30, y, y + 1.1);
      // Bay lines on the floors below the roof.
      if (!roof) for (let u = u0 + 2; u < u1 - 2; u += 2.6) for (const t of [t0 + 0.8, t1 - 5.8]) k.box(0xd8d8d0, u - 0.05, u + 0.05, t, t + 5, y, y + 0.01);
    });
    // Pillars from the ground to the roof.
    for (let u = u0; u <= u1; u += 8) for (const t of [t0 + 0.5, 20, t1 - 0.5]) k.box(CONC, u - 0.4, u + 0.4, t - 0.4, t + 0.4, 0, levels[2] - 0.35);
    // Ramps: sloped runs of slab (1 m steps), a parapet along the outer side.
    const ramp = (which: 1 | 2 | 3, u: number, ta: number, tb: number, outer: number): void => {
      const n = Math.abs(tb - ta);
      for (let i = 0; i < n; i++) {
        const t = ta + ((tb - ta) * (i + 0.5)) / n;
        const y = rampY(which, t);
        k.kind(KIND.asphalt, 0x44444a, u - rampHalf, u + rampHalf, t - 0.55, t + 0.55, y - 0.35, y);
        k.box(CONC, outer - 0.15, outer + 0.15, t - 0.55, t + 0.55, y, y + 1.0);
        k.box(CONC, u - rampHalf - 0.2, u - rampHalf + 0.1 + 0.001, t - 0.55, t + 0.55, y - 0.35, y - 0.05);
      }
    };
    ramp(1, east, -4, 36, east + rampHalf);
    ramp(2, west, 36, 4, west - rampHalf);
    ramp(3, east, 4, 36, east + rampHalf);
    // Landings.
    for (const [u, t, y] of [[u1 + 1.5, 33.5, levels[0]], [u0 - 1.5, 33.5, levels[0]], [u0 - 1.5, 6.5, levels[1]], [u1 + 1.5, 6.5, levels[1]], [u1 + 1.5, 33.5, levels[2]]] as const) {
      k.kind(KIND.asphalt, 0x44444a, u - 3, u + 3, t - 3.5, t + 3.5, y - 0.35, y);
    }
    // Ramp supports down to the ground.
    for (const [u, t, top] of [[east, 12, 0.9], [east, 28, 2.2], [west, 12, 5.3], [west, 28, 4.0]] as const) k.box(CONC, u - 0.4, u + 0.4, t - 0.4, t + 0.4, 0, top);
    // The rooftop's lamps.
    for (let u = u0 + 6; u < u1; u += 14) for (const t of [t0 + 1, t1 - 1]) {
      k.post(0x6a6e72, u, t, levels[2], levels[2] + 7, 0.12, 8);
      k.glow([2.2, 2.2, 2.0], u - 0.4, u + 0.4, t - 0.4, t + 0.4, levels[2] + 6.8, levels[2] + 7.1, EMIT.lamp);
    }
    // The P sign on the front, the ROOF arrow at the entrance.
    plate(k, 9, 6, 38, -0.1, 7.5, (g, W, H) => {
      g.fillStyle = '#1a4ac8';
      g.fillRect(0, 0, W, H);
      text(g, 'P', W * 0.26, H * 0.55, `900 ${Math.round(H * 0.8)}px Arial, sans-serif`, '#ffffff');
      text(g, '電光町', W * 0.7, H * 0.32, `bold ${Math.round(H * 0.22)}px 'Yu Gothic', sans-serif`, '#ffffff');
      text(g, 'パーキング', W * 0.7, H * 0.58, `bold ${Math.round(H * 0.16)}px 'Yu Gothic', sans-serif`, '#ffffff');
      text(g, '24H 満/空', W * 0.7, H * 0.82, `bold ${Math.round(H * 0.14)}px Arial, sans-serif`, '#ffe45f');
    }, true);
    plate(k, 5, 1.6, east, -4.2, 3.6, (g, W, H) => {
      g.fillStyle = '#1a6a3a';
      g.fillRect(0, 0, W, H);
      text(g, '入口 IN · 屋上 ROOF ↑', W / 2, H * 0.58, `bold ${Math.round(H * 0.38)}px 'Yu Gothic', sans-serif`, '#ffffff');
    });
    // Cars parked downstairs, along the back.
    const PAINTS = [0xe8e8e4, 0x1a1a1c, 0x8a8e94, 0x2a3a5a, 0x7a1a1a];
    for (let u = 13, i = 0; u < 60; u += 12, i++) car(k, u, 33.5, 0, 1, PAINTS[i % PAINTS.length], 50 + i);
  },
};
