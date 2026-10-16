import * as THREE from 'three';
import type { Building3 } from '../district/plan';
import { localBox, localFrame, toWorld, type LocalFrame } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * What stood on three landmarks' plots before them (the city in another year, district/era.ts `stands`; the user,
 * 2026-10-14: "continue"), each laid out in its plot's own frame (real/localFrame.ts: u along the street face from its
 * left end, t inward, y up), so it fits the plot it stands on:
 * - `pachinko70`, Yasuichi's plot in the 1970s: パーラー銀河 (Parlour Ginga, the hall the 1992 billboards advertise),
 *   cream tile, a chrome-and-glass front with rows of chasing bulbs over the doors, a red neon パチンコ blade, the name
 *   across the front, the opening day's flower wreaths on their stands.
 * - `inn64`, Hotel Rouge's plot in 1964: a tsurekomi inn (rooms by the hour, before love hotels), two storeys of dark
 *   timber under a grey tiled hipped roof, set back behind a board fence with a small gate, a noren and a lantern, a
 *   wooden sign: 旅館 and 御休憩.
 * - `liquor64`, Yoru Mart's plot in 1964: a corner rice-and-liquor shop, two storeys of wood, the shopfront open under
 *   a tiled eave, sake barrels and crates out front, a hanging 酒 sign, a 米 sign, the red たばこ window.
 *
 * **Candidates for review** (`models-buildings.html?era=1977` and `?era=1964`); not yet in the city.
 */

type V3 = [number, number, number];

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

/** A canvas as a flat sign facing the street (or along it, `side`), centred at (u, t, y), w x h metres. */
function sign(group: THREE.Group, f: LocalFrame, c: HTMLCanvasElement, u: number, t: number, y: number, w: number, h: number, bright = 1, side = 0): void {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(bright, bright, bright), fog: true, side: side ? THREE.DoubleSide : THREE.FrontSide }));
  const [x, z] = toWorld(f, u, t);
  m.position.set(x, y, z);
  // Facing out of the face (n), or along it (r) for a blade.
  const d = side ? f.r : f.n;
  m.rotation.y = Math.atan2(d[0], d[2]);
  group.add(m);
}

/** A quad of four local points (u, y, t), turned to face `hint` (a local direction: [du, dy, dt]). */
function quadLocal(mb: MeshBuilder, f: LocalFrame, pts: [number, number, number][], hint: V3): void {
  const w = pts.map(([u, y, t]) => {
    const [x, z] = toWorld(f, u, t);
    return [x, y, z] as V3;
  });
  const hw: V3 = [f.r[0] * hint[0] - f.n[0] * hint[2], hint[1], f.r[2] * hint[0] - f.n[2] * hint[2]];
  const a: V3 = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]];
  const b: V3 = [w[3][0] - w[0][0], w[3][1] - w[0][1], w[3][2] - w[0][2]];
  const n: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  if (n[0] * hw[0] + n[1] * hw[1] + n[2] * hw[2] >= 0) mb.poly4(w[0], w[1], w[2], w[3]);
  else mb.poly4(w[0], w[3], w[2], w[1]);
}

/** A hipped roof over a local rect from eave height y to a ridge `rise` above it, eaves out by `over`. */
function hipRoof(mb: MeshBuilder, f: LocalFrame, u0: number, u1: number, t0: number, t1: number, y: number, rise: number, over: number): void {
  const [a, b, c, d] = [u0 - over, u1 + over, t0 - over, t1 + over];
  const inset = Math.min(b - a, d - c) / 2;
  const [ru0, ru1, rt] = [a + inset, b - inset, (c + d) / 2];
  const top = y + rise;
  // Front and back slopes (trapezoids), the two hips (triangles as degenerate quads).
  quadLocal(mb, f, [[a, y, c], [b, y, c], [ru1, top, rt], [ru0, top, rt]], [0, 1, -1]);
  quadLocal(mb, f, [[a, y, d], [ru0, top, rt], [ru1, top, rt], [b, y, d]], [0, 1, 1]);
  quadLocal(mb, f, [[a, y, c], [ru0, top, rt], [ru0, top, rt], [a, y, d]], [-1, 1, 0]);
  quadLocal(mb, f, [[b, y, c], [b, y, d], [ru1, top, rt], [ru1, top, rt]], [1, 1, 0]);
}

export interface EraLandmark {
  readonly group: THREE.Group;
}

const finish = (group: THREE.Group, mb: MeshBuilder, city: THREE.Material): EraLandmark => {
  const body = new THREE.Mesh(mb.build()!, city);
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  return { group };
};

const newBuilder = (id: number): MeshBuilder => {
  const mb = new MeshBuilder();
  mb.id = id;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  return mb;
};

/** パーラー銀河: a late-1970s pachinko hall. */
export function buildPachinko70(b: Building3, city: THREE.Material): EraLandmark {
  const f = localFrame(b);
  const group = new THREE.Group();
  const mb = newBuilder(90031);
  const W = f.fw;
  const D = f.depth;
  const H = 13.5;
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, kind: number = KIND.plain): void => {
    mb.kind = kind;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
  };
  const glow = (rgb: [number, number, number], ch: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [ch, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  // The block: cream tile over a dark plinth, a parapet, a row of small windows on the upper floors (the office and staff).
  box(0xd8d0bc, 0, W, 0.4, D, 4.6, H);
  box(0x3a3632, 0, W, 0, D, 0, 0.4);
  box(0xb8b0a0, -0.1, W + 0.1, -0.1, D + 0.1, H, H + 0.8);
  for (let u = 2; u < W - 2; u += 2.6) glow(lin(0x5a5040), EMIT.lit, u, u + 1.4, -0.03, 0, 9.6, 10.8);
  // The ground floor: a chrome-framed glass front, the hall lit white inside, its doors in the middle.
  box(0x1a1c1e, 0, W, 0, D, 0.4, 4.6);
  // (Warm white and not too bright: at full strength the glass blew out to a white sheet.)
  glow([0.85, 0.78, 0.62], EMIT.always, 0.3, W - 0.3, -0.02, 0.02, 0.5, 3.6);
  for (let u = 0; u <= W + 0.01; u += W / 8) box(0xc8ccd0, u - 0.06, u + 0.06, -0.1, 0.02, 0.4, 3.8, KIND.chrome);
  box(0xc8ccd0, 0, W, -0.1, 0.02, 3.6, 3.8, KIND.chrome);
  // The fascia over it: chrome, with three rows of bulbs (chasing at night: the neon channel flickers).
  box(0xc8ccd0, -0.2, W + 0.2, -0.6, 0.02, 3.8, 5.6, KIND.chrome);
  for (const y of [4.1, 4.7, 5.3]) for (let u = 0.3; u < W - 0.2; u += 0.42) glow([1.9, 1.5, 0.8], EMIT.neon, u, u + 0.12, -0.66, -0.6, y - 0.06, y + 0.06);
  // The name across the front, white on red neon.
  sign(group, f, canvas(1400, 220, (g) => {
    g.fillStyle = '#9a0e14';
    g.fillRect(0, 0, 1400, 220);
    g.font = "900 150px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ffd0a0';
    g.shadowBlur = 16;
    g.fillStyle = '#fff4e0';
    g.fillText('パーラー銀河', 700, 118);
  }), W / 2, -0.25, 7.4, Math.min(W - 2, 14), 2.2, 1.3);
  // The blade: パチンコ down a red neon sign standing out from the left end, to over the roof.
  const blade = canvas(180, 900, (g) => {
    g.fillStyle = '#1a0606';
    g.fillRect(0, 0, 180, 900);
    g.strokeStyle = '#ff3020';
    g.lineWidth = 10;
    g.strokeRect(10, 10, 160, 880);
    g.font = "900 150px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff2a10';
    g.shadowBlur = 20;
    g.fillStyle = '#ffe0d0';
    ['パ', 'チ', 'ン', 'コ'].forEach((ch, i) => g.fillText(ch, 90, 125 + i * 215));
  });
  sign(group, f, blade, 1.2, -1.2, 11.5, 1.6, 8, 1.5, 1);
  box(0x3a3c40, 1.15, 1.25, -0.1, 0, 7.3, 15.7);
  box(0x3a3c40, 1.15, 1.25, -1.2, 0, 15.5, 15.6);
  box(0x3a3c40, 1.15, 1.25, -1.2, 0, 7.4, 7.5);
  // The opening day's wreaths: round flower boards on tripod stands either side of the doors.
  const wreath = canvas(256, 256, (g) => {
    const rings = ['#e83a5a', '#f4e8d0', '#e8b020', '#f4e8d0', '#c8303a'];
    rings.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(128, 128, 124 - i * 20, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#ffffff';
    g.font = "bold 40px 'Yu Mincho', serif";
    g.textAlign = 'center';
    g.fillText('祝', 128, 142);
  });
  for (const u of [2.5, 4.5, W - 4.5, W - 2.5]) {
    box(0x2a3a28, u - 0.04, u + 0.04, -1.8, -1.7, 0, 1.9);
    sign(group, f, wreath, u, -1.9, 2.2, 1.3, 1.3, 0.9);
  }
  return finish(group, mb, city);
}

/** A 1964 tsurekomi inn: rooms by the hour, behind a fence. */
export function buildInn64(b: Building3, city: THREE.Material): EraLandmark {
  const f = localFrame(b);
  const group = new THREE.Group();
  const mb = newBuilder(90032);
  const W = f.fw;
  const D = f.depth;
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, kind: number = KIND.plain): void => {
    mb.kind = kind;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
  };
  const glow = (rgb: [number, number, number], ch: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [ch, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  // The garden's ground (gravel) inside the fence, the inn standing back in it.
  box(0x8a8478, 0.3, W - 0.3, 0.3, D - 0.3, 0, 0.05, KIND.gravel);
  const [i0, i1, j0, j1] = [3, W - 3, 6, D - 3];
  // Two storeys of dark timber: posts, plaster panels a pale ochre, a rail between the floors; a hipped roof over each.
  box(0x3a2a1e, i0, i1, j0, j1, 0, 0.5);
  box(0xc8b890, i0, i1, j0, j1, 0.5, 6.2);
  for (let u = i0; u <= i1 + 0.01; u += (i1 - i0) / 9) box(0x2a1e16, u - 0.1, u + 0.1, j0 - 0.06, j0 + 0.2, 0.5, 6.2);
  box(0x2a1e16, i0 - 0.05, i1 + 0.05, j0 - 0.08, j0 + 0.2, 2.9, 3.2);
  // The lower roof's skirt (a pent eave round the first floor), the upper storey's windows with paper screens lit warm.
  mb.kind = KIND.roof;
  mb.color = lin(0x4a4c50);
  hipRoof(mb, f, i0, i1, j0, j1, 3.1, 0.5, 0.9);
  for (let u = i0 + 1; u < i1 - 1.5; u += (i1 - i0) / 9) {
    glow(lin(0xd8b880), EMIT.lit, u + 0.25, u + 1.6, j0 - 0.03, j0, 4.0, 5.4);
    glow(lin(0xc8a870), EMIT.lit, u + 0.25, u + 1.6, j0 - 0.03, j0, 1.0, 2.3);
  }
  mb.kind = KIND.roof;
  mb.color = lin(0x3a3c40);
  hipRoof(mb, f, i0, i1, j0, j1, 6.2, 3.0, 1.0);
  // The board fence along the front with a small roofed gate in it.
  const g0 = W / 2 - 1.4;
  const g1 = W / 2 + 1.4;
  for (const [a, c] of [[0.3, g0], [g1, W - 0.3]] as const) {
    box(0x3a2c22, a, c, 0.2, 0.35, 0, 2.1);
    box(0x2a201a, a, c, 0.15, 0.4, 2.1, 2.2);
  }
  for (const u of [g0, g1]) box(0x2a1e16, u - 0.12, u + 0.12, 0.1, 0.45, 0, 2.6);
  mb.kind = KIND.roof;
  mb.color = lin(0x3a3c40);
  quadLocal(mb, f, [[g0 - 0.5, 2.6, -0.4], [g1 + 0.5, 2.6, -0.4], [g1 + 0.5, 3.1, 0.3], [g0 - 0.5, 3.1, 0.3]], [0, 1, -1]);
  quadLocal(mb, f, [[g0 - 0.5, 3.1, 0.3], [g1 + 0.5, 3.1, 0.3], [g1 + 0.5, 2.6, 1.0], [g0 - 0.5, 2.6, 1.0]], [0, 1, 1]);
  // The noren in the gate (dark indigo, the inn's crest), a paper lantern lit beside it, the wooden sign on its post.
  sign(group, f, canvas(256, 192, (g) => {
    g.fillStyle = '#1c2438';
    g.fillRect(0, 0, 256, 192);
    g.fillStyle = '#0c1220';
    for (const x of [85, 171]) g.fillRect(x - 2, 0, 4, 192);
    g.strokeStyle = '#e8e0cc';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(128, 80, 34, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#e8e0cc';
    g.font = "bold 44px 'Yu Mincho', serif";
    g.textAlign = 'center';
    g.fillText('月', 128, 96);
  }), W / 2, 0.1, 1.95, 2.4, 1.1, 0.8);
  glow([1.4, 0.9, 0.5], EMIT.lamp, g1 + 0.3, g1 + 0.7, -0.2, 0.2, 1.7, 2.3);
  sign(group, f, canvas(128, 512, (g) => {
    g.fillStyle = '#d8c8a0';
    g.fillRect(0, 0, 128, 512);
    g.fillStyle = '#1a1208';
    g.font = "bold 84px 'Yu Mincho', serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ['旅', '館', '月', '乃'].forEach((ch, i) => g.fillText(ch, 64, 64 + i * 100));
    g.font = "bold 40px 'Yu Mincho', serif";
    g.fillStyle = '#7a1a10';
    g.fillText('御休憩', 64, 470);
  }), g0 - 1.2, -0.2, 1.6, 0.5, 2.0, 0.85);
  box(0x2a1e16, g0 - 1.25, g0 - 1.15, -0.15, -0.05, 0, 2.7);
  return finish(group, mb, city);
}

/** A 1964 corner rice-and-liquor shop. */
export function buildLiquor64(b: Building3, city: THREE.Material): EraLandmark {
  const f = localFrame(b);
  const group = new THREE.Group();
  const mb = newBuilder(90033);
  const W = f.fw;
  const D = Math.min(f.depth, 12);
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, kind: number = KIND.plain): void => {
    mb.kind = kind;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
  };
  const glow = (rgb: [number, number, number], ch: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [ch, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  // Two storeys of weathered wood (the upper with a lattice window and a plaster wall), a tiled eave over the shopfront.
  box(0x5a4632, 0, W, 0, D, 0, 6.6);
  box(0xc8bca0, 0.2, W - 0.2, -0.02, D, 3.6, 6.4);
  for (let u = 0.8; u < W - 1.5; u += 2.2) {
    box(0x3a2a1c, u, u + 1.6, -0.06, 0, 4.2, 5.6);
    for (let k = 1; k < 6; k++) box(0x2a1e14, u + (k * 1.6) / 6 - 0.02, u + (k * 1.6) / 6 + 0.02, -0.08, -0.05, 4.2, 5.6);
  }
  mb.kind = KIND.roof;
  mb.color = lin(0x3a3c40);
  quadLocal(mb, f, [[-0.3, 3.4, -1.4], [W + 0.3, 3.4, -1.4], [W + 0.3, 3.9, 0], [-0.3, 3.9, 0]], [0, 1, -1]);
  hipRoof(mb, f, 0, W, 0, D, 6.6, 2.2, 0.6);
  // The shopfront open: the shop lit inside, its shelves of bottles, sake barrels and beer crates stacked out front.
  box(0x1a1610, 0.4, W - 0.4, 0.05, 0.4, 0, 3.3);
  glow([1.3, 1.1, 0.8], EMIT.always, 0.6, W - 3.2, 0.3, 0.35, 0.3, 3.1);
  for (let u = 0.8; u < W - 3.4; u += 0.45) for (const y of [1.1, 1.7, 2.3]) box(u % 0.9 < 0.45 ? 0x2a4a2a : 0x5a2a18, u, u + 0.1, 0.36, 0.42, y, y + 0.32);
  const barrel = (u: number, t: number, y: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(0xd8cca8);
    const [x, z] = toWorld(f, u, t);
    mb.cylinder(x, z, y, y + 0.7, 0.32, 10);
    mb.color = lin(0x2a2a2a);
    mb.cylinder(x, z, y + 0.08, y + 0.14, 0.33, 10, false);
    mb.cylinder(x, z, y + 0.56, y + 0.62, 0.33, 10, false);
  };
  for (const u of [1.0, 1.7, 2.4]) barrel(u, -0.5, 0);
  barrel(1.35, -0.5, 0.7);
  barrel(2.05, -0.5, 0.7);
  for (const [u, n] of [[3.4, 3], [4.2, 2]] as const) for (let k = 0; k < n; k++) box(0xb8a038, u, u + 0.6, -0.9, -0.5, k * 0.32, k * 0.32 + 0.3);
  // The tobacco window at the corner: a red たばこ sign over a small lit counter.
  glow([1.2, 1.1, 0.9], EMIT.always, W - 2.9, W - 0.6, -0.05, 0.02, 1.0, 1.8);
  box(0x8a1a14, W - 3.0, W - 0.5, -0.3, 0, 0.8, 1.0);
  sign(group, f, canvas(320, 110, (g) => {
    g.fillStyle = '#c81e1e';
    g.fillRect(0, 0, 320, 110);
    g.fillStyle = '#ffffff';
    g.font = "900 76px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('たばこ', 160, 58);
  }), W - 1.75, -0.08, 2.15, 2.2, 0.76, 1.2);
  // The name over the eave: 米穀 酒 and the family's name on a long board; a hanging 酒 sign; a 米 lantern sign.
  sign(group, f, canvas(1024, 160, (g) => {
    g.fillStyle = '#2a1e14';
    g.fillRect(0, 0, 1024, 160);
    g.fillStyle = '#e8dcc0';
    g.font = "bold 110px 'Yu Mincho', serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('米穀 酒 大野屋', 512, 86);
  }), W / 2, -0.05, 3.1, Math.min(W - 1, 7), 0.6, 0.85);
  sign(group, f, canvas(160, 300, (g) => {
    g.fillStyle = '#e8dcc0';
    g.fillRect(0, 0, 160, 300);
    g.strokeStyle = '#2a1e14';
    g.lineWidth = 12;
    g.strokeRect(6, 6, 148, 288);
    g.fillStyle = '#1a1208';
    g.font = "900 130px 'Yu Mincho', serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('酒', 80, 150);
  }), 0.6, -0.9, 2.6, 0.5, 0.95, 0.85, 1);
  box(0x2a1e14, 0.55, 0.65, -1.0, 0, 3.15, 3.25);
  sign(group, f, canvas(200, 200, (g) => {
    g.fillStyle = '#f0e8d0';
    g.beginPath();
    g.arc(100, 100, 96, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a1208';
    g.font = "900 130px 'Yu Mincho', serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('米', 100, 108);
  }), W - 3.6, -0.06, 2.6, 0.7, 0.7, 0.9);
  return finish(group, mb, city);
}
