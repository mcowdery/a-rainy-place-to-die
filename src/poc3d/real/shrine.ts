import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import type { Light } from './lightmap';
import { addTree, type TreeSpecies } from '../models/trees';
import { localBox, localFrame, localRect, toWorld, type LocalFrame } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * Kaburo Inari (歌舞路稲荷神社): an Inari shrine in its own grove (chinju no mori) in the back alleys. From
 * the street: a big front torii, a tunnel of small vermilion torii over a stone path, two fox guardians on
 * pedestals, stone lanterns, and a raised hall with a copper-green roof, a straw rope, a bell and an
 * offering box; camphor, zelkova, ginkgo and pine round it inside a low stone wall. Local frame
 * (localFrame.ts): u across the 24 m front, t inward over the 30 m depth; the path and hall are an inner
 * 10 x 24 m layout in the middle (inner(), u offset by INNER_U).
 */
export const SHRINE = { fw: 24, depth: 30 } as const;
/** The inner layout (path, torii, foxes, lanterns, hall), offset to the middle of the front. */
const INNER = { fw: 10, depth: 24 } as const;
const INNER_U = (SHRINE.fw - INNER.fw) / 2;
const inner = (f: LocalFrame): LocalFrame => ({ ...f, p: [f.p[0] + f.r[0] * INNER_U, f.p[1], f.p[2] + f.r[2] * INNER_U], fw: INNER.fw, depth: INNER.depth });

/** The grove, in the outer frame: [u, t, species, size]. */
const GROVE: readonly (readonly [number, number, TreeSpecies, number])[] = [
  [3.2, 26.5, 'camphor', 0.8],
  [20.6, 27.0, 'camphor', 0.75],
  [12.0, 28.0, 'zelkova', 0.6],
  [3.0, 17.5, 'zelkova', 0.6],
  [21.2, 18.5, 'ginkgo', 0.85],
  [3.4, 9.0, 'ginkgo', 0.75],
  [20.8, 9.5, 'zelkova', 0.55],
  [2.6, 2.6, 'pine', 0.7],
  [21.4, 2.8, 'pine', 0.65],
];
const SHRUBS: readonly (readonly [number, number, TreeSpecies])[] = [
  [5.6, 1.4, 'azalea'], [18.4, 1.4, 'azalea'], [5.8, 13.5, 'box'], [18.2, 13.5, 'box'], [1.2, 12.5, 'azalea'], [22.8, 13.0, 'azalea'],
];
/** Precinct wall: height and thickness; low at the front (tamagaki), higher round the sides and back. */
const WALL = { front: 0.9, back: 1.8, t: 0.3 } as const;

const MID = 5;
const TUNNEL = [2.8, 4.6, 6.4, 8.2, 10.0, 11.8];
const FOXES = [2.2, 7.8];
const LANTERNS = [1.6, 8.4];
const TREES: readonly (readonly [number, number, number])[] = [
  [1.3, 8.5, 1.0],
  [8.8, 4.0, 0.7],
];

/** Collision rects: the precinct wall, the grove, fences, torii pillars, pedestals, lanterns, trees and the hall. */
export function shrineColliders(b: Building3): Rect[] {
  const F = localFrame(b);
  const O = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(F, u0, u1, t0, t1);
  const { fw, depth } = SHRINE;
  const grove: Rect[] = [
    O(0, WALL.t, 0, depth), O(fw - WALL.t, fw, 0, depth), O(0, fw, depth - WALL.t, depth),
    O(0, INNER_U, 0, WALL.t), O(fw - INNER_U, fw, 0, WALL.t),
    ...GROVE.map(([u, t, , k]) => O(u - 0.35 - 0.2 * k, u + 0.35 + 0.2 * k, t - 0.35 - 0.2 * k, t + 0.35 + 0.2 * k)),
  ];
  const f = inner(F);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  const out: Rect[] = [...grove, R(0, 0.35, 0, INNER.depth), R(INNER.fw - 0.35, INNER.fw, 0, INNER.depth), R(1.5, 8.5, 16.9, INNER.depth)];
  for (const s of [-1, 1]) out.push(R(MID + s * 1.9 - 0.25, MID + s * 1.9 + 0.25, 0.6 - 0.25, 0.6 + 0.25));
  for (const t of TUNNEL) for (const s of [-1, 1]) out.push(R(MID + s * 1.45 - 0.15, MID + s * 1.45 + 0.15, t - 0.15, t + 0.15));
  for (const u of FOXES) out.push(R(u - 0.45, u + 0.45, 13.35, 14.25));
  for (const u of LANTERNS) out.push(R(u - 0.35, u + 0.35, 15.25, 15.95));
  for (const [u, t, s] of TREES) out.push(R(u - 0.35 * s, u + 0.35 * s, t - 0.35 * s, t + 0.35 * s));
  return out;
}

/** Lightmap lights: lanterns, the lamps along the torii tunnel, the hall's paper lanterns. */
export function shrineLights(b: Building3): Light[] {
  const f = inner(localFrame(b));
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  return [
    L(MID, -1, 6, [1.0, 0.75, 0.45], 0.45),
    ...[4, 8, 12].map((t) => L(MID, t, 4, [1.0, 0.55, 0.3], 0.4)),
    ...LANTERNS.map((u) => L(u, 15.6, 5, [1.0, 0.7, 0.4], 0.7)),
    L(2.0, 17.3, 4, [1.0, 0.35, 0.2], 0.5),
    L(8.0, 17.3, 4, [1.0, 0.35, 0.2], 0.5),
  ];
}

const VERMILION = 0xc8401e;
const STONE = 0x9a968c;
const FOX = 0xd8d4c8;

export function buildShrine(b: Building3, city: THREE.Material): THREE.Group {
  const F = localFrame(b);
  const f = inner(F);
  const group = new THREE.Group();
  const mb = new MeshBuilder();
  mb.id = b.id;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  // The grove (outer frame): mossy earth, the precinct wall (low at the front either side of the way in,
  // plaster on stone round the sides and back), the trees and shrubs.
  {
    const P = SHRINE;
    const ob = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, kind: number = KIND.plain): void => {
      mb.kind = kind;
      mb.color = lin(hex);
      localBox(mb, F, u0, u1, t0, t1, y0, y1, kind);
    };
    ob(0x3a4a2e, 0, P.fw, 0, P.depth, -0.02, 0.02, KIND.grass);
    const wall = (u0: number, u1: number, t0: number, t1: number, h: number): void => {
      ob(STONE, u0, u1, t0, t1, 0, Math.min(h, 0.6));
      if (h > 0.6) ob(0xd8d0c0, u0 + 0.03, u1 - 0.03, t0 + 0.03, t1 - 0.03, 0.6, h - 0.12);
      ob(0x5a5650, u0 - 0.05, u1 + 0.05, t0 - 0.05, t1 + 0.05, h - 0.12, h);
    };
    wall(0, WALL.t, 0, P.depth, WALL.back);
    wall(P.fw - WALL.t, P.fw, 0, P.depth, WALL.back);
    wall(0, P.fw, P.depth - WALL.t, P.depth, WALL.back);
    wall(0, INNER_U, 0, WALL.t, WALL.front);
    wall(P.fw - INNER_U, P.fw, 0, WALL.t, WALL.front);
    for (const [u, t, species, size] of GROVE) {
      const [x, z] = toWorld(F, u, t);
      addTree(mb, { x, z, species, size, seed: Math.round(u * 10 + t) });
    }
    for (const [u, t, species] of SHRUBS) {
      const [x, z] = toWorld(F, u, t);
      addTree(mb, { x, z, species, size: 1.1, seed: Math.round(u * 10 + t) });
    }
    // The sacred camphor's straw rope (shimenawa).
    const [sx, sz] = toWorld(F, GROVE[0][0], GROVE[0][1]);
    mb.kind = KIND.plain;
    mb.color = lin(0xd8c890);
    mb.lathe(sx, sz, [[1.5, 0.44], [1.62, 0.46], [1.74, 0.44]], 10);
  }
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
  };
  const glow = (rgb: [number, number, number], u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
    mb.style = [0, 0, 0, 0];
  };
  const W = (u: number, t: number): [number, number] => toWorld(f, u, t);
  const post = (hex: number, u: number, t: number, y0: number, y1: number, r: number, n = 10): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    const [x, z] = W(u, t);
    mb.cylinder(x, z, y0, y1, r, n);
  };
  const { fw, depth } = INNER;

  // Ground: raked gravel, a stone path of slabs, fences down both sides.
  box(0xb8b0a0, 0, fw, 0, depth, -0.02, 0.03);
  for (let t = 0.1; t < 16.8; t += 0.9) box(0xa8a49a, MID - 1.2, MID + 1.2, t, t + 0.84, 0, 0.07);
  for (const u of [0.15, fw - 0.3]) {
    for (let t = 0.2; t < depth; t += 2) box(VERMILION, u, u + 0.15, t, t + 0.15, 0, 1.0);
    box(VERMILION, u - 0.02, u + 0.17, 0, depth, 0.85, 0.95);
    box(VERMILION, u - 0.02, u + 0.17, 0, depth, 0.35, 0.42);
  }

  // Torii: the big front gate, then the tunnel of small ones.
  const torii = (t: number, half: number, h: number, r: number): void => {
    for (const s of [-1, 1]) {
      post(VERMILION, MID + s * half, t, 0, h, r);
      post(0x1a1a1a, MID + s * half, t, 0, 0.35, r + 0.03);
    }
    box(0x1a1a1a, MID - half - 0.7, MID + half + 0.7, t - 0.2, t + 0.2, h + 0.18, h + 0.3);
    box(VERMILION, MID - half - 0.6, MID + half + 0.6, t - 0.17, t + 0.17, h - 0.05, h + 0.18);
    box(VERMILION, MID - half - 0.25, MID + half + 0.25, t - 0.1, t + 0.1, h - 0.75, h - 0.55);
    box(VERMILION, MID - 0.08, MID + 0.08, t - 0.08, t + 0.08, h - 0.55, h - 0.05);
  };
  torii(0.6, 1.9, 4.3, 0.2);
  for (const t of TUNNEL) torii(t, 1.45, 2.9, 0.1);

  // Fox guardians (kitsune) on pedestals, facing the path, with red bibs.
  for (const u of FOXES) {
    const s = u < MID ? 1 : -1;
    box(STONE, u - 0.4, u + 0.4, 13.4, 14.2, 0, 1.0);
    box(0x8a867c, u - 0.45, u + 0.45, 13.35, 14.25, 0.9, 1.05);
    post(FOX, u, 13.9, 1.05, 1.6, 0.2, 8);
    box(FOX, u - 0.13, u + 0.13, 13.62, 13.9, 1.55, 1.82);
    box(FOX, u - 0.07, u + 0.07, 13.5, 13.64, 1.62, 1.72);
    for (const e of [-1, 1]) box(FOX, u + e * 0.09 - 0.035, u + e * 0.09 + 0.035, 13.72, 13.8, 1.82, 1.96);
    box(0xc02020, u - 0.17, u + 0.17, 13.68, 13.72, 1.3, 1.52);
    box(FOX, u - 0.07 + s * 0.12, u + 0.07 + s * 0.12, 14.05, 14.2, 1.1, 1.75);
  }

  // Stone lanterns (toro) with a warm light in the fire box.
  for (const u of LANTERNS) {
    box(STONE, u - 0.32, u + 0.32, 15.28, 15.92, 0, 0.2);
    post(STONE, u, 15.6, 0.2, 1.1, 0.12, 8);
    box(STONE, u - 0.28, u + 0.28, 15.32, 15.88, 1.1, 1.2);
    box(STONE, u - 0.2, u - 0.14, 15.4, 15.8, 1.2, 1.6);
    box(STONE, u + 0.14, u + 0.2, 15.4, 15.8, 1.2, 1.6);
    glow([0.36, 0.19, 0.08], u - 0.14, u + 0.14, 15.45, 15.75, 1.22, 1.55);
    box(0x7a766c, u - 0.42, u + 0.42, 15.18, 16.02, 1.6, 1.72);
    box(0x7a766c, u - 0.26, u + 0.26, 15.34, 15.86, 1.72, 1.84);
    post(0x7a766c, u, 15.6, 1.84, 1.98, 0.07, 6);
  }

  // The hall: platform and steps, vermilion posts, walls, a lattice front, the offering box.
  box(0x5a3a26, 1.5, 8.5, 17.5, 23.6, 0, 0.6);
  box(0x6a4a30, 3.5, 6.5, 16.9, 17.5, 0, 0.2);
  box(0x6a4a30, 3.5, 6.5, 17.2, 17.5, 0.2, 0.4);
  for (const [u, t] of [[1.7, 17.7], [8.3, 17.7], [1.7, 23.3], [8.3, 23.3], [1.7, 18.8], [8.3, 18.8]]) post(VERMILION, u, t, 0.6, 3.4, 0.14);
  box(0x6a4a30, 1.6, 8.4, 23.15, 23.4, 0.6, 3.3);
  for (const u of [1.6, 8.2]) box(0x6a4a30, u, u + 0.2, 18.8, 23.4, 0.6, 3.3);
  box(0x3a2618, 1.8, 8.2, 18.75, 18.85, 0.6, 3.0);
  for (let u = 2.0; u < 8.1; u += 0.3) box(0x8a6a48, u, u + 0.05, 18.7, 18.76, 0.7, 2.9);
  for (let y = 0.9; y < 3.0; y += 0.35) box(0x8a6a48, 1.9, 8.1, 18.7, 18.76, y, y + 0.04);
  box(VERMILION, 1.6, 8.4, 17.6, 17.8, 3.2, 3.5);
  box(VERMILION, 1.6, 8.4, 18.7, 18.9, 3.2, 3.5);
  box(0x5a3a26, 4.2, 5.8, 16.95, 17.45, 0, 0.8);
  for (let u = 4.3; u < 5.7; u += 0.15) box(0x3a2618, u, u + 0.06, 16.95, 17.45, 0.8, 0.84);
  // Straw rope (shimenawa) with paper streamers, the bell and its rope, paper lanterns.
  mb.kind = KIND.plain;
  mb.color = lin(0xd8c890);
  const [ra, rza] = W(2.3, 17.55);
  const [rb, rzb] = W(7.7, 17.55);
  mb.beam([ra, 3.05, rza], [rb, 3.05, rzb], 0.22);
  for (const u of [3.2, 5.0, 6.8]) box(0xf4f4f0, u - 0.08, u + 0.08, 17.5, 17.6, 2.55, 2.95);
  post(0xc8a040, MID, 17.9, 2.85, 3.1, 0.14, 10);
  post(0xd84040, MID, 17.9, 1.0, 2.85, 0.035, 6);
  for (const u of [2.0, 8.0]) {
    mb.kind = KIND.emit;
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = [0.3, 0.06, 0.03];
    const [x, z] = W(u, 17.35);
    mb.lathe(x, z, [[2.3, 0.02], [2.35, 0.2], [2.6, 0.26], [2.85, 0.2], [2.9, 0.02]], 10);
    mb.style = [0, 0, 0, 0];
    post(0x1a1a1a, u, 17.35, 2.9, 3.2, 0.02, 4);
  }

  // Roof: copper green, curving up at the eaves (two pitches per side), a ridge with katsuogi. Each slope
  // is drawn in both windings: green on the side facing up, dark wood underneath.
  type P3 = [number, number, number];
  const at = (u: number, t: number, y: number): P3 => {
    const [x, z] = W(u, t);
    return [x, y, z];
  };
  const twoSided = (a: P3, b: P3, c: P3, d: P3, top: number, under: number): void => {
    const ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
    mb.kind = KIND.plain;
    mb.color = lin(ny > 0 ? top : under);
    mb.poly4(a, b, c, d);
    mb.color = lin(ny > 0 ? under : top);
    mb.poly4(b, a, d, c);
  };
  const ridge = 20.3;
  for (const pts of [[[16.8, 3.4], [18.2, 4.25], [ridge, 5.6]], [[23.9, 3.4], [22.4, 4.25], [ridge, 5.6]]]) {
    for (let i = 0; i < 2; i++) {
      const [t0, y0] = pts[i];
      const [t1, y1] = pts[i + 1];
      twoSided(at(0.9, t0, y0), at(fw - 0.9, t0, y0), at(fw - 0.9, t1, y1), at(0.9, t1, y1), 0x4f8a78, 0x3a2618);
    }
  }
  box(0x2a4a40, 0.8, fw - 0.8, 20.15, 20.45, 5.5, 5.8);
  for (const u of [2.6, 5.0, 7.4]) {
    mb.kind = KIND.plain;
    mb.color = lin(0xc8a040);
    mb.beam(at(u, 19.6, 5.9), at(u, 21.0, 5.9), 0.18);
  }
  // Gable ends (triangles, both sides).
  for (const u of [1.2, fw - 1.2]) {
    mb.kind = KIND.plain;
    mb.color = lin(0x6a4a30);
    const a = at(u, 17.7, 3.4);
    const b = at(u, 23.3, 3.4);
    const r = at(u, ridge, 5.5);
    mb.poly4(a, b, r, r);
    mb.poly4(b, a, r, r);
  }

  // Trees: the sacred tree (with its own straw rope) and a smaller one by the gate.
  for (const [u, t, s] of TREES) {
    const [x, z] = W(u, t);
    mb.kind = KIND.plain;
    mb.color = lin(0x4a3a2a);
    mb.cylinder(x, z, 0, 3.5 * s + 1, 0.3 * s, 8);
    mb.color = lin(0x2a4a2c);
    mb.lathe(x, z, [[3.2 * s, 0.05], [3.6 * s, 1.8 * s], [4.8 * s, 2.4 * s], [6.2 * s, 2.0 * s], [7.2 * s, 1.1 * s], [7.6 * s, 0.05]], 9);
    mb.color = lin(0x34583a);
    mb.lathe(x + 0.8 * s, z - 0.6 * s, [[5.6 * s, 0.05], [6.0 * s, 1.4 * s], [7.0 * s, 1.6 * s], [8.0 * s, 0.9 * s], [8.4 * s, 0.05]], 8);
    if (s > 0.9) {
      mb.color = lin(0xd8c890);
      mb.lathe(x, z, [[1.5, 0.34], [1.62, 0.36], [1.74, 0.34]], 10);
    }
  }

  // Name pillar at the gate.
  box(STONE, 0.5, 1.0, 0.1, 0.6, 0, 2.6);
  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 480;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#9a968c';
  g.fillRect(0, 0, 96, 480);
  g.fillStyle = '#1e1c1a';
  g.font = "bold 72px 'Yu Mincho', 'MS Mincho', serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  ['稲', '荷', '神', '社'].forEach((ch, i) => g.fillText(ch, 48, 70 + i * 110));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 2.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  const [px, pz] = W(0.75, 0.09);
  plate.position.set(px, 1.35, pz);
  plate.rotation.y = Math.atan2(f.n[0], f.n[2]);
  group.add(plate);
  return group;
}

