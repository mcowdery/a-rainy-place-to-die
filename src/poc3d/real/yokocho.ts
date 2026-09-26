import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import { hash } from '../../core/hash';
import type { Building3 } from '../district/plan';
import type { Light } from './lightmap';
import { localBox, localFrame, localRect, localYaw, toWorld } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { addFigure, GHOST_COLORS, GhostBuilder, type Pose } from './people';

/**
 * Hoshikuzu Yokocho (星屑横丁, "Stardust Alley"): a Golden Gai-style block of tiny bars in the back alleys.
 * Two 2 m alleys run in from the street with a cross alley between them; both sides are lined with narrow
 * two-storey bars, each with its own lit name sign, a door with a glowing pane, lanterns or noren, and the
 * clutter of the real thing (beer crates, AC units, pot plants). Paper lanterns and wires hang across the
 * alleys, a lit gateway sign marks each entrance, and a vending machine glows at each dead end.
 * Local frame (localFrame.ts): u along the 20 m street front, t inward over 30 m.
 */
export const YOKOCHO = { fw: 20, depth: 30 } as const;

/** Alleys: u ranges (running the full depth) and the cross alley's t range. */
const ALLEYS: readonly (readonly [number, number])[] = [[4, 6], [14, 16]];
const CROSS: readonly [number, number] = [14, 16];
const END = 29.4;

/** Rows of bars: [u0, u1, which way the doors face (+1: +u, -1: -u), segments of t]. */
interface Row {
  readonly u0: number;
  readonly u1: number;
  readonly face: 1 | -1;
  readonly segments: readonly (readonly [number, number])[];
}
const ROWS: readonly Row[] = [
  { u0: 0, u1: 4, face: 1, segments: [[0, END]] },
  { u0: 6, u1: 10, face: -1, segments: [[0, CROSS[0]], [CROSS[1], END]] },
  { u0: 10, u1: 14, face: 1, segments: [[0, CROSS[0]], [CROSS[1], END]] },
  { u0: 16, u1: 20, face: -1, segments: [[0, END]] },
];
const WIDTHS = [3.2, 3.0, 3.4, 2.4, 2.8, 3.6, 2.6, 3.0, 2.2];

const NAMES = [
  'BAR 黒猫', 'スナック 夢', 'ぼたん', '酒処 ひかり', 'JAZZ 月', 'BAR ANCHOR', 'のんべえ', '小町', 'BAR 銀河', 'しずか',
  'ROCK 狂', '深夜食堂', 'CAFE LUNA', 'バー 迷子', '酒場 三日月', 'BLUES', 'ほたる', '夜想', 'BAR 灯', 'りんご',
  '文壇バー', '風鈴', 'BAR NOIR', 'はなこ', 'スナック 蘭', 'おでん 源', '赤ちょうちん', 'BAR 星屑', 'ゆめじ', 'CHANSON',
  '酒 まつ', 'BAR 69', 'こけし', 'PUNK 地獄', '一杯', 'BAR 雨', 'みちくさ', '居酒屋 ぽん', 'SAKE 蓮', 'BAR 夜舟',
];

interface Bar {
  readonly u0: number;
  readonly u1: number;
  readonly t0: number;
  readonly t1: number;
  readonly face: 1 | -1;
  /** Door face (u) and the door's centre along t. */
  readonly door: number;
  readonly tc: number;
  readonly h: number;
  readonly name: number;
}

/** Every bar, deterministic: widths cycle through WIDTHS per row, the last one takes what's left. */
function bars(seed: number): Bar[] {
  const out: Bar[] = [];
  let k = 0;
  ROWS.forEach((row, ri) => {
    for (const [s0, s1] of row.segments) {
      let t = s0;
      let i = ri * 3;
      while (s1 - t > 0.5) {
        let w = WIDTHS[i++ % WIDTHS.length];
        if (s1 - t - w < 2.0) w = s1 - t;
        const h = 5.4 + (hash(seed, ri, Math.round(t * 10)) % 21) / 10;
        out.push({ u0: row.u0, u1: row.u1, t0: t, t1: t + w, face: row.face, door: row.face > 0 ? row.u1 : row.u0, tc: t + w / 2, h, name: k++ % NAMES.length });
        t += w;
      }
    }
  });
  return out;
}

/** People hanging around the alleys: local u, t, facing (du, dt), pose. */
const LOITERERS: readonly (readonly [number, number, number, number, Pose])[] = [
  [5.3, 9.0, -0.3, -1, 'talk'],
  [4.8, 9.7, 0.3, 1, 'pockets'],
  [15.3, 6.0, 1, 0.2, 'phone'],
  [10.0, 15.0, 1, 0, 'talk'],
  [11.0, 15.2, -1, 0, 'stand'],
  [14.8, 21.5, 0, -1, 'walk'],
];

/** Collision: the rows of bars, gateway posts, the dead-end walls and vending machines, the loiterers. */
export function yokochoColliders(b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  const out: Rect[] = [];
  for (const row of ROWS) for (const [s0, s1] of row.segments) out.push(R(row.u0, row.u1, s0, s1));
  for (const [a0, a1] of ALLEYS) {
    out.push(R(a0, a1, END, YOKOCHO.depth));
    out.push(R(a0 + 0.3, a1 - 0.3, END - 0.75, END));
    out.push(R(a0, a0 + 0.12, 0.1, 0.35), R(a1 - 0.12, a1, 0.1, 0.35));
  }
  for (const [u, t] of LOITERERS) out.push(R(u - 0.25, u + 0.25, t - 0.25, t + 0.25));
  return out;
}

/** Lightmap lights: warm pools down the alleys and the cross alley, the gateways' glow on the street. */
export function yokochoLights(b: Building3): Light[] {
  const f = localFrame(b);
  const out: Light[] = [];
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): void => {
    const [x, z] = toWorld(f, u, t);
    out.push({ x, z, r, color, i });
  };
  const warm: [number, number, number][] = [[1.0, 0.55, 0.3], [1.0, 0.4, 0.35], [1.0, 0.7, 0.45]];
  for (const [a0, a1] of ALLEYS) {
    for (let t = 1.5; t < END; t += 3) L((a0 + a1) / 2, t, 3.2, warm[Math.round(t) % 3], 0.75);
    L((a0 + a1) / 2, -1.5, 4, [1.0, 0.5, 0.3], 0.5);
  }
  for (let u = 7.5; u < 14; u += 3) L(u, (CROSS[0] + CROSS[1]) / 2, 3, warm[1], 0.6);
  return out;
}

const WALLS = [0x4a3020, 0x7a7470, 0xcfc4ae, 0x6a7078, 0x5a4a3a, 0x8a6a52, 0x3a3a3e, 0xa89878];
const DOORS = [0x5a3a24, 0x2a2a2e, 0x7a2a22, 0x3a4a3a];
const NOREN = [0x1a2a5a, 0x8a1a1a, 0x2a2a2a, 0xd8d0c0];

export function buildYokocho(b: Building3, city: THREE.Material, ghost: THREE.Material): THREE.Group {
  const f = localFrame(b);
  const group = new THREE.Group();
  const mb = new MeshBuilder();
  mb.id = b.id;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  mb.frontNormal = null;
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    localBox(mb, f, Math.min(u0, u1), Math.max(u0, u1), Math.min(t0, t1), Math.max(t0, t1), y0, y1);
  };
  const glow = (ch: number, rgb: [number, number, number], u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [ch, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, Math.min(u0, u1), Math.max(u0, u1), Math.min(t0, t1), Math.max(t0, t1), y0, y1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  const lantern = (u: number, t: number, y: number, rgb: [number, number, number], s = 1): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = rgb;
    const [x, z] = toWorld(f, u, t);
    mb.lathe(x, z, [[y - 0.32 * s, 0.02], [y - 0.28 * s, 0.13 * s], [y - 0.14 * s, 0.17 * s], [y, 0.13 * s], [y + 0.04 * s, 0.02]], 8);
    mb.style = [0, 0, 0, 0];
  };
  const rnd = (...k: number[]): number => hash(b.id, 0x90d, ...k.map((v) => Math.round(v * 10))) / 4294967296;
  const pick = <T>(list: readonly T[], ...k: number[]): T => list[hash(b.id, 0x91c, ...k.map((v) => Math.round(v * 10))) % list.length];
  const all = bars(b.id);

  // Paving down the alleys and across.
  for (const [a0, a1] of ALLEYS) box(0x3c3a38, a0, a1, 0, YOKOCHO.depth, 0, 0.03);
  box(0x3c3a38, ALLEYS[0][1], ALLEYS[1][0], CROSS[0], CROSS[1], 0, 0.03);

  // The bars.
  const signs: { bar: Bar; u: number }[] = [];
  for (const bar of all) {
    const s = bar.face;
    const wall = pick(WALLS, bar.u0, bar.t0);
    box(wall, bar.u0, bar.u1, bar.t0 + 0.03, bar.t1 - 0.03, 0, bar.h);
    box(0x2a2826, bar.u0 - 0.05, bar.u1 + 0.05, bar.t0, bar.t1, bar.h, bar.h + 0.2);
    const d = bar.door;
    const o = (x: number): number => d + s * x;
    // A door with a glowing pane, a small lit window beside it, and the name sign above.
    const dt0 = bar.tc - 0.4;
    box(pick(DOORS, bar.t0, 1), o(0), o(0.06), dt0, dt0 + 0.8, 0, 2.0);
    glow(EMIT.lamp, [0.13, 0.06, 0.025], o(0.06), o(0.07), dt0 + 0.25, dt0 + 0.55, 1.1, 1.6);
    if (bar.t1 - bar.t0 > 2.5) glow(EMIT.lamp, [0.1, 0.05, 0.022], o(0), o(0.02), bar.tc + 0.55, bar.tc + 1.05, 1.1, 1.7);
    box(0x1a1a1a, o(0), o(0.16), bar.tc - 0.62, bar.tc + 0.62, 2.18, 2.72);
    signs.push({ bar, u: o(0.17) });
    // Upper floor: a window (sometimes lit), sometimes an AC unit.
    if (rnd(bar.t0, 2) < 0.55) glow(EMIT.lamp, [0.08, 0.045, 0.025], o(0), o(0.02), bar.tc - 0.5, bar.tc + 0.5, 3.4, 4.3);
    else box(0x2a3038, o(0), o(0.02), bar.tc - 0.5, bar.tc + 0.5, 3.4, 4.3);
    if (rnd(bar.t0, 3) < 0.45) box(0xc8c8c4, o(0), o(0.3), bar.t0 + 0.2, bar.t0 + 0.9, 4.6, 5.1);
    // Noren or a red lantern at the door; crates or a plant on the step.
    const deco = rnd(bar.t0, 4);
    if (deco < 0.4) {
      const c = pick(NOREN, bar.t0, 5);
      for (let k = 0; k < 3; k++) box(c, o(0.08), o(0.1), dt0 + k * 0.27, dt0 + k * 0.27 + 0.25, 1.45, 2.05);
    } else if (deco < 0.75) {
      lantern(o(0.3), bar.tc + 0.55, 2.1, [0.3, 0.05, 0.03]);
    }
    const clutter = rnd(bar.t0, 6);
    if (clutter < 0.3) {
      for (let k = 0; k < 2 + Math.floor(clutter * 10) % 2; k++) box(k % 2 ? 0xd8a020 : 0xc03020, o(0.05), o(0.45), bar.t0 + 0.15, bar.t0 + 0.55, k * 0.3, k * 0.3 + 0.28);
    } else if (clutter < 0.5) {
      box(0x6a4a30, o(0.05), o(0.4), bar.t1 - 0.5, bar.t1 - 0.15, 0, 0.4);
      mb.kind = KIND.plain;
      mb.color = lin(0x2e5a34);
      const [x, z] = toWorld(f, o(0.22), bar.t1 - 0.33);
      mb.lathe(x, z, [[0.35, 0.05], [0.55, 0.28], [0.95, 0.24], [1.15, 0.04]], 7);
    }
  }

  // Across the alleys: strings of paper lanterns and a tangle of wires.
  for (const [a0, a1] of ALLEYS) {
    for (let t = 2.5; t < END - 1; t += 3.5) {
      mb.kind = KIND.plain;
      mb.color = lin(0x1a1a1a);
      const [ax, az] = toWorld(f, a0, t);
      const [bx, bz] = toWorld(f, a1, t + 0.4);
      mb.beam([ax, 3.6, az], [bx, 3.6, bz], 0.02);
      for (let k = 0; k < 2; k++) lantern(a0 + 0.6 + k * 0.8, t + 0.1 + k * 0.2, 3.5, k % 2 ? [0.32, 0.28, 0.22] : [0.3, 0.05, 0.03], 0.8);
    }
    for (let t = 1; t < END; t += 2.2) {
      mb.kind = KIND.plain;
      mb.color = lin(0x141414);
      const [ax, az] = toWorld(f, a0, t);
      const [bx, bz] = toWorld(f, a1, t + 1.5 + rnd(t, a0) * 2);
      mb.beam([ax, 4.8 + rnd(a0, t) * 1.2, az], [bx, 4.6 + rnd(t, a1) * 1.2, bz], 0.025);
    }
    // Dead end: a wall and a glowing vending machine.
    box(0x5a5550, a0, a1, END, YOKOCHO.depth, 0, 6);
    box(0xd8d8d4, a0 + 0.3, a1 - 0.3, END - 0.75, END, 0, 1.85);
    glow(EMIT.always, [0.9, 0.95, 1.0], a0 + 0.4, a1 - 0.4, END - 0.77, END - 0.75, 0.95, 1.7);
    // Gateway: two posts at the street and a lit board between them.
    box(0x2a2826, a0, a0 + 0.12, 0.1, 0.35, 0, 3.9);
    box(0x2a2826, a1 - 0.12, a1, 0.1, 0.35, 0, 3.9);
  }

  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.receiveShadow = true;
  group.add(mesh);

  // Name signs: one texture with every name, one mesh of quads.
  const W = 1024;
  const SLOT_W = 256;
  const SLOT_H = 96;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 1024;
  const g = canvas.getContext('2d')!;
  const palettes: [string, string][] = [['#f4ecd8', '#1a1a1a'], ['#1a1a1a', '#ffd070'], ['#8a1a1a', '#ffffff'], ['#f4f4f0', '#a01818'], ['#1a2a5a', '#f0f0f0'], ['#2a1a2a', '#ff8ad8']];
  NAMES.forEach((name, i) => {
    const x = (i % 4) * SLOT_W;
    const y = Math.floor(i / 4) * SLOT_H;
    const [bg, ink] = palettes[i % palettes.length];
    g.fillStyle = bg;
    g.fillRect(x + 2, y + 2, SLOT_W - 4, SLOT_H - 4);
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 52;
    g.font = `bold ${size}px 'Yu Mincho', 'MS Mincho', serif`;
    while (g.measureText(name).width > SLOT_W - 24 && size > 20) g.font = `bold ${(size -= 2)}px 'Yu Mincho', 'MS Mincho', serif`;
    g.fillText(name, x + SLOT_W / 2, y + SLOT_H / 2 + 2);
  });
  // Gateway boards.
  const gate = (i: number, text: string, sub: string): void => {
    const y = 10 * SLOT_H + i * SLOT_H;
    g.fillStyle = '#1a0c0a';
    g.fillRect(0, y + 2, 512, SLOT_H - 4);
    g.fillStyle = '#ffcf70';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "bold 50px 'Yu Mincho', 'MS Mincho', serif";
    g.fillText(text, 256, y + 38);
    g.font = "bold 20px 'Arial', sans-serif";
    g.fillText(sub, 256, y + 78);
  };
  gate(0, '星屑横丁', 'HOSHIKUZU YOKOCHO');
  gate(1, '星屑横丁', 'BARS · SNACKS · 40 SHOPS');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (u: number, t: number, y: number, w: number, h: number, facing: [number, number], slot: [number, number, number, number]): void => {
    const [cx, cz] = toWorld(f, u, t);
    const [nx, nz] = facing;
    const rx = nz;
    const rz = -nx;
    const P = (a: number, c: number): number[] => [cx + rx * a * w / 2, y + c * h / 2, cz + rz * a * w / 2];
    const [su0, sv0, su1, sv1] = slot;
    const corners = [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)];
    const uvs = [[su0, sv1], [su1, sv1], [su1, sv0], [su0, sv0]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...corners[k]);
      uv.push(...uvs[k]);
    }
  };
  const slotUv = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x / W, 1 - y / 1024, (x + w) / W, 1 - (y + h) / 1024];
  for (const { bar, u } of signs) {
    const n = bar.face > 0 ? f.r : [-f.r[0], 0, -f.r[2]];
    const i = bar.name;
    quad(u, bar.tc, 2.45, 1.2, 0.45, [n[0], n[2]], slotUv((i % 4) * SLOT_W, Math.floor(i / 4) * SLOT_H, SLOT_W, SLOT_H));
  }
  ALLEYS.forEach(([a0, a1], i) => {
    const n = f.n;
    quad((a0 + a1) / 2, 0.08, 3.5, 2.0, 0.55, [n[0], n[2]], slotUv(0, (10 + i) * SLOT_H, 512, SLOT_H));
    quad((a0 + a1) / 2, 0.37, 3.5, 2.0, 0.55, [-n[0], -n[2]], slotUv(0, (10 + i) * SLOT_H, 512, SLOT_H));
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.35, 1.3, 1.25) })));

  // The regulars.
  const people = new GhostBuilder();
  LOITERERS.forEach(([u, t, du, dt, pose], i) => {
    const [x, z] = toWorld(f, u, t);
    addFigure(people, {
      x,
      z,
      yaw: localYaw(f, du, dt),
      body: i % 3 === 2 ? 'woman' : i === 5 ? 'elder' : 'man',
      pose,
      color: GHOST_COLORS[(i * 3) % GHOST_COLORS.length],
      hair: i % 3 === 2 ? 'long' : i === 1 ? 'hat' : 'short',
      long: i === 1,
      phase: 0.3,
      side: 1,
      look: 0,
    });
  });
  const crowd = people.build(0, 0);
  if (crowd) {
    const m = new THREE.Mesh(crowd, ghost);
    m.renderOrder = 2;
    group.add(m);
  }
  return group;
}
