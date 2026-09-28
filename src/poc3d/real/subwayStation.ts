import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import type { SubwayLine3, SubwayStop3 } from '../district/subway';
import type { Light } from './lightmap';
import { localBox, localFrame, localRect, toLocal, toWorld, type LocalFrame } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * A subway station (landmark: subway). On the street, an entrance pavilion (14 m along the street face,
 * 12 m deep) whose stairs run back down toward the street to the concourse (B1, floor -5): ticket
 * machines, a kiosk, the fare map and a line of automatic gates. Past the gates, stairs down the middle
 * of an island platform (B2, floor -11) under the road, between the two tracks; the tunnels (real/subway.ts)
 * run on from both ends. Local frame (localFrame.ts): u along the street face, t inward from it; the line
 * runs along u at t = -10 (the stamp is placed with its face 10 m from the road's centre).
 *
 * The one layout gives the floor heights, collision per level, the stairwell's hole in the ground, the
 * covered volumes and the lights, so they always agree with the geometry.
 */
export const SUBWAY = { fw: 14, depth: 12, height: 4.5, axis: -10, b1: -5, b2: -11 } as const;

/** Stairs from the pavilion down to B1, running back toward the street (top at t1, bottom at t0). */
const S1 = { u0: 5.5, u1: 8.5, t0: 2, t1: 10.5 } as const;
/** The concourse. */
const B1 = { u0: -16, u1: 30, t0: -20, t1: 4, ceil: -1 } as const;
const GATE_T = -4;
/** Where a passage meets the concourse (t range, on the unpaid side of the gates), at its u0 or u1 end. */
export const PASSAGE_T = [-3.4, 3.6] as const;
const GATES = Array.from({ length: 13 }, (_, k) => -2 + k * 1.5);
/** Stairs from B1 (u0) down to the platform (u1), down the middle of it. */
const S2 = { u0: 8, u1: 20, t0: -11.5, t1: -8.5 } as const;
/** The island platform, the track walls either side, and the platform's ceiling. */
const PLAT = { u0: -24, u1: 36, t0: -14, t1: -6 } as const;
const WALL = { t0: -17.5, t1: -2.5 } as const;
const B2_CEIL = -6.2;
const RAIL_Y = SUBWAY.b2 - 0.9;
const BED_Y = SUBWAY.b2 - 1.4;
const PILLARS_B1 = [-10, -2, 6, 14, 22];
const PILLARS_B2 = [-20, -12, 26, 33];
const NAME_BOARDS = [6, -14, 27];
const BENCHES: readonly (readonly [number, number])[] = [[-16, -12.9], [-8, -7.1], [29.5, -12.9], [-2, -12.9]];

const inS1 = (u: number, t: number): boolean => u >= S1.u0 && u <= S1.u1 && t >= S1.t0 && t <= S1.t1;
const inS2 = (u: number, t: number): boolean => u >= S2.u0 && u <= S2.u1 && t >= S2.t0 && t <= S2.t1;

/** Which set of colliders applies at a walker's floor: street level, the concourse, or the platform. */
export type SubwayLevel = 'street' | 'b1' | 'b2';
export const subwayLevel = (floor: number): SubwayLevel => (floor > -1 ? 'street' : floor > -8 ? 'b1' : 'b2');

/** Floor height at a local point, or null (street level) outside the stairs and the levels below. */
function floorLocal(u: number, t: number, current: number): number | null {
  if (inS1(u, t)) return (SUBWAY.b1 * (S1.t1 - t)) / (S1.t1 - S1.t0);
  // The stairs down to the platform are under the road: only for walkers already below ground.
  if (inS2(u, t) && current < -2.5) return SUBWAY.b1 + ((SUBWAY.b2 - SUBWAY.b1) * (u - S2.u0)) / (S2.u1 - S2.u0);
  if (current <= -8 && u >= PLAT.u0 && u <= PLAT.u1 && t >= PLAT.t0 && t <= PLAT.t1) return SUBWAY.b2;
  if (current < -2.5 && current > -8 && u >= B1.u0 && u <= B1.u1 && t >= B1.t0 && t <= B1.t1) return SUBWAY.b1;
  return null;
}

export function subwayFloor(b: Building3, x: number, z: number, current: number): number | null {
  const [u, t] = toLocal(localFrame(b), x, z);
  return floorLocal(u, t, current);
}

type R4 = readonly [number, number, number, number];

/** Collision at each level, as local rects [u0, u1, t0, t1]. */
function collidersLocal(level: SubwayLevel, passage: 'u0' | 'u1' | null): R4[] {
  const out: R4[] = [];
  if (level === 'street') {
    // The pavilion's side and back walls (the street face is open), the rails round the stairwell (its
    // head, at the back, open), and the roundel's pole.
    out.push([0, 0.3, 0, SUBWAY.depth], [SUBWAY.fw - 0.3, SUBWAY.fw, 0, SUBWAY.depth], [0, SUBWAY.fw, SUBWAY.depth - 0.3, SUBWAY.depth]);
    out.push([S1.u0 - 0.3, S1.u0, S1.t0, S1.t1], [S1.u1, S1.u1 + 0.3, S1.t0, S1.t1], [S1.u0 - 0.3, S1.u1 + 0.3, S1.t0 - 0.3, S1.t0]);
    out.push([12.85, 13.15, -1.35, -1.05]);
    return out;
  }
  if (level === 'b1') {
    // The concourse walls (open where the stairs come down from the street), the stairwells' sides.
    // The end walls, one of them opened where a passage comes in.
    for (const [end, u0, u1] of [['u0', B1.u0 - 0.3, B1.u0], ['u1', B1.u1, B1.u1 + 0.3]] as const) {
      if (passage === end) out.push([u0, u1, B1.t0, PASSAGE_T[0]], [u0, u1, PASSAGE_T[1], B1.t1]);
      else out.push([u0, u1, B1.t0, B1.t1]);
    }
    out.push([B1.u0, B1.u1, B1.t0 - 0.3, B1.t0]);
    out.push([B1.u0, S1.u0, B1.t1, B1.t1 + 0.3], [S1.u1, B1.u1, B1.t1, B1.t1 + 0.3]);
    out.push([S1.u0 - 0.3, S1.u0, S1.t0, S1.t1], [S1.u1, S1.u1 + 0.3, S1.t0, S1.t1]);
    // The gate line: fences either side, the gate cabinets (the lanes between them are open).
    out.push([B1.u0, GATES[0] - 0.2, GATE_T - 0.3, GATE_T + 0.3], [GATES[GATES.length - 1] + 0.2, B1.u1, GATE_T - 0.3, GATE_T + 0.3]);
    for (const c of GATES) out.push([c - 0.2, c + 0.2, GATE_T - 0.3, GATE_T + 0.3]);
    // Ticket machines, the kiosk, pillars, and the rails round the stairwell down to the platform.
    out.push([-15, -9, 3.2, 4], [18, 24, 1, 4]);
    for (const u of PILLARS_B1) out.push([u - 0.4, u + 0.4, -16.4, -15.6]);
    out.push([S2.u0, S2.u1, S2.t0 - 0.3, S2.t0], [S2.u0, S2.u1, S2.t1, S2.t1 + 0.3], [S2.u1, S2.u1 + 0.3, S2.t0 - 0.3, S2.t1 + 0.3]);
    return out;
  }
  // The platform: its edges (screen doors), its ends, the walls either side of the stairs, pillars, benches.
  out.push([PLAT.u0, PLAT.u1, PLAT.t0 - 0.3, PLAT.t0], [PLAT.u0, PLAT.u1, PLAT.t1, PLAT.t1 + 0.3]);
  out.push([PLAT.u0 - 0.3, PLAT.u0, PLAT.t0, PLAT.t1], [PLAT.u1, PLAT.u1 + 0.3, PLAT.t0, PLAT.t1]);
  out.push([S2.u0, S2.u1, S2.t0 - 0.3, S2.t0], [S2.u0, S2.u1, S2.t1, S2.t1 + 0.3]);
  for (const u of PILLARS_B2) out.push([u - 0.35, u + 0.35, -10.35, -9.65]);
  for (const [u, t] of BENCHES) out.push([u - 0.9, u + 0.9, t - 0.3, t + 0.3]);
  return out;
}

const colliderCache = new Map<string, Rect[]>();

/** Collision rects at a walker's floor (world). */
export function subwayColliders(b: Building3, floor: number, passage: 'u0' | 'u1' | null = null): Rect[] {
  const level = subwayLevel(floor);
  const key = `${b.id}:${level}:${passage}`;
  let out = colliderCache.get(key);
  if (!out) {
    const f = localFrame(b);
    out = collidersLocal(level, passage).map(([u0, u1, t0, t1]) => localRect(f, u0, u1, t0, t1));
    colliderCache.set(key, out);
  }
  return out;
}

/** The stairwell's opening in the ground. */
export function subwayHoles(b: Building3): Rect[] {
  return [localRect(localFrame(b), S1.u0, S1.u1, S1.t0, S1.t1)];
}

/** Covered volumes: the pavilion (roofed, open to the street), and everything below ground (enclosed). */
export function subwayShelters(b: Building3): { rect: Rect; y0: number; y1: number; enclosed?: boolean }[] {
  const f = localFrame(b);
  return [
    { rect: localRect(f, 0, SUBWAY.fw, 0, SUBWAY.depth), y0: -6, y1: SUBWAY.height },
    { rect: localRect(f, PLAT.u0, PLAT.u1, B1.t0, B1.t1), y0: -14, y1: -0.9, enclosed: true },
  ];
}

/** Street light: the pavilion's lit front and the roundel. */
export function subwayLights(b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  return [L(7, -1.5, 7, [0.9, 0.95, 1.0], 0.7), L(13, -1.6, 3.5, [0.9, 0.9, 1.0], 0.4)];
}

// ---- Geometry ----

export interface SubwayStationView {
  readonly group: THREE.Group;
  /** Everything below the street (the concourse, the platform, their signs): shown below ground, or near. */
  readonly below: THREE.Group;
  /** Redraw the departure board (clock: the timetable's clock, seconds). */
  update(clock: number): void;
  /** After the last train: the shutter comes down over the entrance. */
  setClosed(closed: boolean): void;
}

export interface SubwayStationInfo {
  readonly stop: SubwayStop3;
  readonly line: SubwayLine3;
  /** Every line (for the fare map). */
  readonly lines: readonly SubwayLine3[];
  /** Next departures in each direction (toward the line's first / last station), seconds. */
  readonly departures: (clock: number) => { toFirst: number[]; toLast: number[] };
  /** The end of the concourse that opens onto a passage. */
  readonly passage?: 'u0' | 'u1' | null;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** A canvas-textured sign (lit): w x h metres, drawn at res px/m. */
function sign(w: number, h: number, res: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, glow = 1.15): { mesh: THREE.Mesh; redraw: (d: typeof draw) => void } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * res);
  canvas.height = Math.round(h * res);
  const g = canvas.getContext('2d')!;
  draw(g, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(glow, glow, glow), side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return {
    mesh,
    redraw: (d) => {
      d(g, canvas.width, canvas.height);
      tex.needsUpdate = true;
    },
  };
}

/** Places a sign at local (u, t, y), facing local direction (du, dt). */
function placeSign(f: LocalFrame, m: THREE.Mesh, u: number, t: number, y: number, du: number, dt: number): void {
  const [x, z] = toWorld(f, u, t);
  m.position.set(x, y, z);
  const nx = f.r[0] * du - f.n[0] * dt;
  const nz = f.r[2] * du - f.n[2] * dt;
  m.rotation.y = Math.atan2(nx, nz);
}

/** The line's roundel: a ring in its colour with the letter, and the station number under it. */
function roundel(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, line: SubwayLine3, code?: string): void {
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = hex(line.color);
  g.lineWidth = r * 0.24;
  g.beginPath();
  g.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#1a1a1a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(r * (code ? 0.62 : 1.05))}px 'Segoe UI', Arial, sans-serif`;
  if (code) {
    g.fillText(line.letter, cx, cy - r * 0.2);
    g.font = `bold ${Math.round(r * 0.5)}px 'Segoe UI', Arial, sans-serif`;
    g.fillText(code.slice(1), cx, cy + r * 0.38);
  } else g.fillText(line.letter, cx, cy + r * 0.04);
}

const JP = "'Yu Gothic', 'Meiryo', 'MS Gothic', sans-serif";
const EN = "'Segoe UI', Arial, sans-serif";

export function buildSubwayStation(b: Building3, info: SubwayStationInfo, city: THREE.Material): SubwayStationView {
  const f = localFrame(b);
  const { stop, line } = info;
  const group = new THREE.Group();
  // Two meshes: the street (the pavilion and its stairs) and below (the concourse and the platform).
  const street = new MeshBuilder(1 << 13);
  const under = new MeshBuilder(1 << 15);
  for (const m of [street, under]) {
    m.id = b.id;
    m.flags = 0;
    m.style = [0, 0, 0, 0];
  }
  let mb = street;
  const below = new THREE.Group();
  group.add(below);
  /** Surfaces lit by the station's own fluorescent light (self-lit: the street's light doesn't reach). */
  const lit = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom = false): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.interior, 0, 0, 0];
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, bottom);
    mb.style = [0, 0, 0, 0];
  };
  const glow = (rgb: [number, number, number], u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  /** Street-level parts take the street's light; below ground (no sky, no street light) they're self-lit. */
  const plain = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    if (y1 <= 0.01) return lit(hex, u0, u1, t0, t1, y0, y1);
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.plain);
  };
  /** A handrail (a thin beam), self-lit. */
  const rail = (a: [number, number, number], b: [number, number, number]): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.interior, 0, 0, 0];
    mb.color = lin(0xb0b4b8);
    mb.beam(a, b, 0.03);
    mb.style = [0, 0, 0, 0];
  };
  const LC = line.color;
  const LIGHT: [number, number, number] = [1.35, 1.4, 1.45];

  // ---- The pavilion on the street ----
  const H = SUBWAY.height;
  plain(0x4a4c50, 0, 0.3, 0, SUBWAY.depth, 0, H);
  plain(0x4a4c50, SUBWAY.fw - 0.3, SUBWAY.fw, 0, SUBWAY.depth, 0, H);
  plain(0x4a4c50, 0, SUBWAY.fw, SUBWAY.depth - 0.3, SUBWAY.depth, 0, H);
  plain(0x3a3c40, -0.2, SUBWAY.fw + 0.2, -0.4, SUBWAY.depth + 0.2, H, H + 0.3);
  // Fascia over the open front, with the line's colour band.
  plain(0x2a2c30, 0, SUBWAY.fw, -0.4, 0.2, H - 1.0, H);
  plain(LC, 0, SUBWAY.fw, -0.42, -0.4, H - 1.0, H - 0.85);
  // Floor round the stairwell, the inside walls, and the ceiling lights.
  for (const [u0, u1, t0, t1] of [[0.3, S1.u0, 0, SUBWAY.depth - 0.3], [S1.u1, SUBWAY.fw - 0.3, 0, SUBWAY.depth - 0.3], [S1.u0, S1.u1, 0, S1.t0], [S1.u0, S1.u1, S1.t1, SUBWAY.depth - 0.3]] as const) lit(0x8e8a84, u0, u1, t0, t1, 0, 0.04);
  lit(0xd4cec2, 0.3, 0.32, 0, SUBWAY.depth - 0.3, 0.04, H - 0.2);
  lit(0xd4cec2, SUBWAY.fw - 0.32, SUBWAY.fw - 0.3, 0, SUBWAY.depth - 0.3, 0.04, H - 0.2);
  lit(0xd4cec2, 0.3, SUBWAY.fw - 0.3, SUBWAY.depth - 0.32, SUBWAY.depth - 0.3, 0.04, H - 0.2);
  lit(0xc8ccd0, 0.3, SUBWAY.fw - 0.3, 0.2, SUBWAY.depth - 0.3, H - 0.2, H, true);
  for (const t of [2.5, 6, 9.5]) glow(LIGHT, 2, 12, t - 0.12, t + 0.12, H - 0.23, H - 0.2);
  // Rails round the stairwell (open at its head, at the back).
  for (const u of [S1.u0 - 0.15, S1.u1 + 0.15]) plain(0x9aa0a6, u - 0.04, u + 0.04, S1.t0, S1.t1, 0, 1.05);
  plain(0x9aa0a6, S1.u0 - 0.15, S1.u1 + 0.15, S1.t0 - 0.19, S1.t0 - 0.11, 0, 1.05);
  // The roundel on its pole by the entrance.
  plain(0x8a8c90, 12.9, 13.1, -1.3, -1.1, 0, 3.0);

  // ---- The stairs down to B1: solid steps (0.5 m) from the pavilion back toward the street ----
  const n1 = Math.round((S1.t1 - S1.t0) / 0.5);
  for (let i = 0; i < n1; i++) {
    const t0 = S1.t0 + i * 0.5;
    const top = (SUBWAY.b1 * (S1.t1 - (t0 + 0.5))) / (S1.t1 - S1.t0);
    lit(i % 2 ? 0x9a968e : 0x908c84, S1.u0, S1.u1, t0, t0 + 0.5, SUBWAY.b1, Math.max(SUBWAY.b1 + 0.01, top));
  }
  // The stairwell's lined walls, down from the street to the concourse.
  lit(0xd8d2c4, S1.u0 - 0.3, S1.u0, B1.t1, S1.t1, SUBWAY.b1, 0);
  lit(0xd8d2c4, S1.u1, S1.u1 + 0.3, B1.t1, S1.t1, SUBWAY.b1, 0);
  lit(0xd8d2c4, S1.u0 - 0.3, S1.u1 + 0.3, S1.t1, S1.t1 + 0.3, SUBWAY.b1, 0);
  for (const u of [S1.u0 + 0.1, S1.u1 - 0.1]) {
    const [ax, az] = toWorld(f, u, S1.t1);
    const [bx, bz] = toWorld(f, u, S1.t0);
    rail([ax, 0.9, az], [bx, SUBWAY.b1 + 0.9, bz]);
  }

  // ---- B1: the concourse ----
  mb = under;
  const Y1 = SUBWAY.b1;
  // Floor (with the stairwell down to the platform cut out) and ceiling.
  for (const [u0, u1, t0, t1] of [[B1.u0, B1.u1, B1.t0, S2.t0], [B1.u0, B1.u1, S2.t1, B1.t1], [B1.u0, S2.u0, S2.t0, S2.t1], [S2.u1, B1.u1, S2.t0, S2.t1]] as const) lit(0xb8b4ac, u0, u1, t0, t1, Y1 - 0.2, Y1);
  lit(0x9ea2a6, B1.u0, B1.u1, B1.t0, B1.t1, B1.ceil, B1.ceil + 0.2, true);
  for (let t = B1.t0 + 2; t < B1.t1; t += 4) glow(LIGHT, B1.u0 + 1, B1.u1 - 1, t - 0.1, t + 0.1, B1.ceil - 0.03, B1.ceil);
  // Walls: tiled, with a band in the line's colour; open where the street stairs come down.
  const wallB1 = (u0: number, u1: number, t0: number, t1: number): void => lit(0xd8d2c4, u0, u1, t0, t1, Y1, B1.ceil);
  for (const [end, u0, u1] of [['u0', B1.u0 - 0.3, B1.u0], ['u1', B1.u1, B1.u1 + 0.3]] as const) {
    if (info.passage === end) {
      wallB1(u0, u1, B1.t0, PASSAGE_T[0]);
      wallB1(u0, u1, PASSAGE_T[1], B1.t1);
    } else wallB1(u0, u1, B1.t0, B1.t1);
  }
  wallB1(B1.u0, B1.u1, B1.t0 - 0.3, B1.t0);
  wallB1(B1.u0, S1.u0 - 0.3, B1.t1, B1.t1 + 0.3);
  wallB1(S1.u1 + 0.3, B1.u1, B1.t1, B1.t1 + 0.3);
  const bandT = (end: 'u0' | 'u1'): (readonly [number, number])[] => (info.passage === end ? [[B1.t0, PASSAGE_T[0]], [PASSAGE_T[1], B1.t1]] : [[B1.t0, B1.t1]]);
  for (const [t0, t1] of bandT('u0')) lit(LC, B1.u0 + 0.01, B1.u0 + 0.02, t0, t1, Y1 + 1.4, Y1 + 1.6);
  for (const [t0, t1] of bandT('u1')) lit(LC, B1.u1 - 0.02, B1.u1 - 0.01, t0, t1, Y1 + 1.4, Y1 + 1.6);
  lit(LC, B1.u0, B1.u1, B1.t0 + 0.01, B1.t0 + 0.02, Y1 + 1.4, Y1 + 1.6);
  // Pillars.
  for (const u of PILLARS_B1) lit(0xe0dacc, u - 0.4, u + 0.4, -16.4, -15.6, Y1, B1.ceil);
  // The gate line: fences either side, gate cabinets with their card readers lit.
  plain(0x8a8e94, B1.u0, GATES[0] - 0.2, GATE_T - 0.05, GATE_T + 0.05, Y1, Y1 + 1.1);
  plain(0x8a8e94, GATES[GATES.length - 1] + 0.2, B1.u1, GATE_T - 0.05, GATE_T + 0.05, Y1, Y1 + 1.1);
  for (const c of GATES) {
    lit(0x9aa0a8, c - 0.18, c + 0.18, GATE_T - 0.3, GATE_T + 0.3, Y1, Y1 + 1.0);
    glow([0.25, 0.55, 1.2], c - 0.12, c + 0.12, GATE_T + 0.05, GATE_T + 0.25, Y1 + 1.0, Y1 + 1.02);
    glow([0.2, 1.1, 0.4], c - 0.1, c + 0.1, GATE_T - 0.3, GATE_T - 0.28, Y1 + 0.85, Y1 + 0.95);
  }
  // Ticket machines along the back wall (screens lit), and the kiosk with its bright shelves.
  for (let u = -15; u < -9; u += 1.5) {
    lit(0xc8ccd0, u + 0.05, u + 1.45, 3.2, 4, Y1, Y1 + 1.8);
    glow([0.35, 0.6, 0.95], u + 0.3, u + 1.2, 3.18, 3.2, Y1 + 1.0, Y1 + 1.5);
  }
  lit(0x2a2c30, 18, 24, 1, 4, Y1, Y1 + 2.6);
  const STOCK: [number, number, number][] = [[1.2, 0.5, 0.3], [0.4, 1.0, 0.5], [1.2, 1.0, 0.3], [0.5, 0.7, 1.3]];
  for (let y = Y1 + 0.4; y < Y1 + 2.2; y += 0.45) {
    for (let u = 18.3; u < 23.7; u += 0.6) glow(STOCK[(((Math.round(u * 3 + y * 7)) % 4) + 4) % 4], u, u + 0.45, 0.98, 1.0, y, y + 0.3);
  }
  // Rails round the stairwell down to the platform (its head, at u0, open).
  for (const t of [S2.t0 - 0.15, S2.t1 + 0.15]) plain(0x9aa0a6, S2.u0, S2.u1, t - 0.04, t + 0.04, Y1, Y1 + 1.05);
  plain(0x9aa0a6, S2.u1 + 0.11, S2.u1 + 0.19, S2.t0 - 0.15, S2.t1 + 0.15, Y1, Y1 + 1.05);

  // ---- The stairs down to the platform: 40 steps of 0.3 m along u ----
  for (let i = 0; i < 40; i++) {
    const u0 = S2.u0 + i * 0.3;
    const top = SUBWAY.b1 + ((SUBWAY.b2 - SUBWAY.b1) * (u0 + 0.3 - S2.u0)) / (S2.u1 - S2.u0);
    lit(i % 2 ? 0x9a968e : 0x908c84, u0, u0 + 0.3, S2.t0, S2.t1, SUBWAY.b2, Math.max(SUBWAY.b2 + 0.01, top));
  }
  // Its side walls down to the platform, and the handrails.
  lit(0xd8d2c4, S2.u0, S2.u1, S2.t0 - 0.3, S2.t0, SUBWAY.b2, Y1 - 0.2);
  lit(0xd8d2c4, S2.u0, S2.u1, S2.t1, S2.t1 + 0.3, SUBWAY.b2, Y1 - 0.2);
  for (const t of [S2.t0 + 0.1, S2.t1 - 0.1]) {
    const [ax, az] = toWorld(f, S2.u0, t);
    const [bx, bz] = toWorld(f, S2.u1, t);
    rail([ax, Y1 + 0.9, az], [bx, SUBWAY.b2 + 0.9, bz]);
  }

  // ---- B2: the platform ----
  const Y2 = SUBWAY.b2;
  lit(0xa8a49c, PLAT.u0, PLAT.u1, PLAT.t0, PLAT.t1, Y2 - 0.2, Y2);
  // Tactile paving (yellow) along both edges.
  for (const t of [PLAT.t0 + 0.6, PLAT.t1 - 0.9]) lit(0xd8b020, PLAT.u0, PLAT.u1, t, t + 0.3, Y2, Y2 + 0.01);
  // The track beds and rails either side, and the walls beyond them (dark tile, lit ad panels).
  for (const [t0, t1] of [[WALL.t0, PLAT.t0], [PLAT.t1, WALL.t1]] as const) {
    lit(0x3a3a3a, PLAT.u0, PLAT.u1, t0, t1, BED_Y - 0.2, BED_Y);
    const tc = (t0 + t1) / 2;
    for (const r of [-0.53, 0.53]) lit(0x9a9ca0, PLAT.u0, PLAT.u1, tc + r - 0.035, tc + r + 0.035, BED_Y, RAIL_Y);
    for (let u = PLAT.u0 + 0.3; u < PLAT.u1; u += 0.9) lit(0x4a4a48, u, u + 0.24, tc - 1.1, tc + 1.1, BED_Y, BED_Y + 0.05);
  }
  for (const t of [WALL.t0 - 0.3, WALL.t1] as const) {
    lit(0x5a5e64, PLAT.u0, PLAT.u1, t, t + 0.3, BED_Y, B2_CEIL);
    lit(LC, PLAT.u0, PLAT.u1, t === WALL.t1 ? t - 0.01 : t + 0.3, t === WALL.t1 ? t : t + 0.31, Y2 + 2.5, Y2 + 2.7);
    const face = t === WALL.t1 ? t - 0.02 : t + 0.32;
    for (let u = PLAT.u0 + 4; u < PLAT.u1 - 4; u += 9) {
      if (NAME_BOARDS.some((bu) => Math.abs(u + 1.5 - bu) < 4.2)) continue; // a station name board hangs here
      glow([[1.2, 0.9, 0.6], [0.6, 0.9, 1.2], [1.2, 0.6, 0.9], [0.9, 1.2, 0.7]][Math.abs(Math.round(u)) % 4] as [number, number, number], u, u + 3, face - 0.01, face, Y2 + 0.4, Y2 + 2.2);
    }
  }
  // Ceiling (cut open over the stairs) with light strips over the platform.
  for (const [u0, u1, t0, t1] of [[PLAT.u0, PLAT.u1, WALL.t0, S2.t0], [PLAT.u0, PLAT.u1, S2.t1, WALL.t1], [PLAT.u0, S2.u0, S2.t0, S2.t1], [S2.u1, PLAT.u1, S2.t0, S2.t1]] as const) lit(0x5a5e62, u0, u1, t0, t1, B2_CEIL, B2_CEIL + 0.2, true);
  for (const t of [-12.6, -7.4]) glow(LIGHT, PLAT.u0 + 1, PLAT.u1 - 1, t - 0.1, t + 0.1, B2_CEIL - 0.03, B2_CEIL);
  // Platform ends: walls across the platform (the tracks run on into the tunnels).
  lit(0x6a6e72, PLAT.u0 - 0.3, PLAT.u0, PLAT.t0, PLAT.t1, Y2, B2_CEIL);
  lit(0x6a6e72, PLAT.u1, PLAT.u1 + 0.3, PLAT.t0, PLAT.t1, Y2, B2_CEIL);
  // Pillars down the middle, benches.
  for (const u of PILLARS_B2) lit(0xe0dacc, u - 0.35, u + 0.35, -10.35, -9.65, Y2, B2_CEIL);
  for (const [u, t] of BENCHES) {
    lit(0x7a5a3c, u - 0.9, u + 0.9, t - 0.22, t + 0.22, Y2 + 0.42, Y2 + 0.47);
    lit(0x3a3c40, u - 0.8, u - 0.74, t - 0.2, t + 0.2, Y2, Y2 + 0.42);
    lit(0x3a3c40, u + 0.74, u + 0.8, t - 0.2, t + 0.2, Y2, Y2 + 0.42);
  }
  // Platform screen doors along both edges: posts, glass, a head rail with the line's colour.
  for (const t of [PLAT.t0 - 0.15, PLAT.t1 + 0.15]) {
    for (let u = PLAT.u0; u <= PLAT.u1; u += 2.3) lit(0xb8bcc0, u - 0.08, u + 0.08, t - 0.12, t + 0.12, Y2, Y2 + 1.5);
    lit(0xc8ccd0, PLAT.u0, PLAT.u1, t - 0.12, t + 0.12, Y2 + 1.35, Y2 + 1.5);
    lit(LC, PLAT.u0, PLAT.u1, t - 0.13, t + 0.13, Y2 + 1.25, Y2 + 1.35);
  }
  const glassMb = new MeshBuilder();
  for (const t of [PLAT.t0 - 0.15, PLAT.t1 + 0.15]) {
    const [ax, az] = toWorld(f, PLAT.u0, t);
    const [bx, bz] = toWorld(f, PLAT.u1, t);
    glassMb.quad([ax, Y2 + 0.1, az], [bx - ax, 0, bz - az], [0, 1.15, 0]);
  }
  const streetMesh = new THREE.Mesh(street.build()!, city);
  streetMesh.receiveShadow = true;
  group.add(streetMesh);
  below.add(new THREE.Mesh(under.build()!, city));
  const glass = new THREE.Mesh(glassMb.build()!, new THREE.MeshStandardMaterial({ color: 0x9ab4bc, transparent: true, opacity: 0.2, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
  glass.renderOrder = 3;
  below.add(glass);

  // ---- Signs ----
  const idx = stop.index;
  const prev = line.stops[idx - 1];
  const next = line.stops[idx + 1];
  // Street: the fascia (line, station name) and the roundel on its pole (both sides).
  const fascia = sign(12, 0.8, 64, (g, W, Hh) => {
    g.fillStyle = '#16181c';
    g.fillRect(0, 0, W, Hh);
    roundel(g, Hh * 0.55, Hh / 2, Hh * 0.38, line);
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = `bold ${Math.round(Hh * 0.46)}px ${JP}`;
    g.fillText(`${line.name}  ${stop.jp}駅`, Hh * 1.1, Hh * 0.42);
    g.font = `${Math.round(Hh * 0.24)}px ${EN}`;
    g.fillStyle = '#c8ccd4';
    g.fillText(`${line.nameEn}  ·  ${stop.en}  ${stop.code}`, Hh * 1.1, Hh * 0.8);
  });
  placeSign(f, fascia.mesh, 7, -0.43, H - 0.5, 0, -1);
  group.add(fascia.mesh);
  const pole = sign(0.9, 0.9, 128, (g, W, Hh) => {
    g.clearRect(0, 0, W, Hh);
    roundel(g, W / 2, Hh / 2, W * 0.48, line, stop.code);
  }, 1.3);
  (pole.mesh.material as THREE.MeshBasicMaterial).transparent = true;
  placeSign(f, pole.mesh, 13, -1.2, 3.3, 0, -1);
  group.add(pole.mesh);
  // B1: the exit sign at the foot of the street stairs, platforms at the stairs down, the fare map.
  const exitSign = sign(2.6, 0.5, 96, (g, W, Hh) => {
    g.fillStyle = '#f0c020';
    g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#1a1a1a';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = `bold ${Math.round(Hh * 0.62)}px ${JP}`;
    g.fillText('出口', Hh * 0.3, Hh / 2);
    g.font = `bold ${Math.round(Hh * 0.42)}px ${EN}`;
    g.fillText('Exit  ↑', Hh * 1.8, Hh / 2);
  });
  placeSign(f, exitSign.mesh, 7, 1.2, B1.ceil - 0.45, 0, -1);
  below.add(exitSign.mesh);
  const platSign = sign(3.4, 0.6, 96, (g, W, Hh) => {
    g.fillStyle = '#16181c';
    g.fillRect(0, 0, W, Hh);
    roundel(g, Hh * 0.5, Hh / 2, Hh * 0.36, line);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = `bold ${Math.round(Hh * 0.36)}px ${JP}`;
    g.fillText(`${line.name} のりば`, Hh, Hh * 0.34);
    g.font = `${Math.round(Hh * 0.22)}px ${EN}`;
    g.fillStyle = '#c8ccd4';
    g.fillText(`${line.nameEn} platforms  →  ${[line.stops[0], line.stops[line.stops.length - 1]].filter((s) => s !== stop).map((s) => s.en).join(' / ')}`, Hh, Hh * 0.74);
  });
  placeSign(f, platSign.mesh, 6.5, -10, B1.ceil - 0.5, -1, 0);
  below.add(platSign.mesh);
  // The fare map: every line as a bar in its colour, stations as dots, this one marked.
  const fareMap = sign(6, 1.6, 100, (g, W, Hh) => {
    g.fillStyle = '#f4f2ec';
    g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#1a1a1a';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.font = `bold ${Math.round(Hh * 0.1)}px ${JP}`;
    g.fillText('路線図  Route map', W * 0.02, Hh * 0.04);
    info.lines.forEach((l, li) => {
      const y = Hh * (0.36 + li * 0.32);
      const x0 = W * 0.08;
      const x1 = W * 0.95;
      g.fillStyle = hex(l.color);
      g.fillRect(x0, y - Hh * 0.025, x1 - x0, Hh * 0.05);
      l.stops.forEach((s, si) => {
        const x = x0 + ((x1 - x0) * si) / Math.max(1, l.stops.length - 1);
        const here = s.key === stop.key;
        g.fillStyle = here ? '#e03030' : '#ffffff';
        g.strokeStyle = hex(l.color);
        g.lineWidth = Hh * 0.02;
        g.beginPath();
        g.arc(x, y, Hh * (here ? 0.05 : 0.035), 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#1a1a1a';
        g.textAlign = 'center';
        g.font = `${Math.round(Hh * 0.075)}px ${JP}`;
        g.fillText(s.jp, x, y + Hh * 0.06);
        g.font = `${Math.round(Hh * 0.05)}px ${EN}`;
        g.fillText(s.code, x, y - Hh * 0.13);
      });
    });
  });
  placeSign(f, fareMap.mesh, -12, 3.18, Y1 + 2.8, 0, -1);
  below.add(fareMap.mesh);
  // B2: station name boards on the track walls, facing the platform.
  const nameBoard = (): THREE.Mesh =>
    sign(5, 1.3, 96, (g, W, Hh) => {
      g.fillStyle = '#f4f2ec';
      g.fillRect(0, 0, W, Hh);
      g.fillStyle = hex(line.color);
      g.fillRect(0, Hh * 0.62, W, Hh * 0.1);
      roundel(g, Hh * 0.36, Hh * 0.32, Hh * 0.24, line, stop.code);
      g.fillStyle = '#1a1a1a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold ${Math.round(Hh * 0.34)}px ${JP}`;
      g.fillText(stop.jp, W / 2, Hh * 0.26);
      g.font = `${Math.round(Hh * 0.13)}px ${EN}`;
      g.fillText(stop.en, W / 2, Hh * 0.52);
      g.font = `${Math.round(Hh * 0.12)}px ${JP}`;
      g.textAlign = 'left';
      if (prev) g.fillText(`← ${prev.jp}  ${prev.en}`, W * 0.03, Hh * 0.85);
      g.textAlign = 'right';
      if (next) g.fillText(`${next.jp}  ${next.en} →`, W * 0.97, Hh * 0.85);
    }).mesh;
  for (const [t, dt] of [[WALL.t0 + 0.02, -1], [WALL.t1 - 0.02, 1]] as const) {
    for (const u of NAME_BOARDS) {
      const m = nameBoard();
      placeSign(f, m, u, t, Y2 + 1.8, 0, dt === 1 ? -1 : 1);
      below.add(m);
    }
  }
  // Departure board over the platform by the foot of the stairs (redrawn by update()).
  const firstName = line.stops[0];
  const lastName = line.stops[line.stops.length - 1];
  const boardDraw = (clock: number) => (g: CanvasRenderingContext2D, W: number, Hh: number): void => {
    g.fillStyle = '#0a0a0c';
    g.fillRect(0, 0, W, Hh);
    const d = info.departures(clock);
    const rows: [string, number | undefined][] = [];
    if (stop.index > 0) rows.push([`${firstName.jp} 行  for ${firstName.en}`, d.toFirst[0]]);
    if (stop.index < line.stops.length - 1) rows.push([`${lastName.jp} 行  for ${lastName.en}`, d.toLast[0]]);
    g.textBaseline = 'middle';
    rows.forEach(([dest, s], i) => {
      const y = Hh * (0.28 + i * 0.46);
      g.fillStyle = hex(line.color);
      g.fillRect(W * 0.02, y - Hh * 0.16, Hh * 0.32, Hh * 0.32);
      g.fillStyle = '#ffffff';
      g.font = `bold ${Math.round(Hh * 0.22)}px ${EN}`;
      g.textAlign = 'center';
      g.fillText(line.letter, W * 0.02 + Hh * 0.16, y);
      g.fillStyle = '#ffb030';
      g.textAlign = 'left';
      g.font = `${Math.round(Hh * 0.2)}px ${JP}`;
      g.fillText(dest, W * 0.02 + Hh * 0.42, y);
      g.textAlign = 'right';
      const txt = s === undefined ? '' : s < 25 ? 'まもなく  now' : `${Math.ceil(s / 60)}分  ${Math.ceil(s / 60)} min`;
      g.fillText(txt, W * 0.98, y);
    });
  };
  const board = sign(3.6, 0.7, 128, boardDraw(0), 1.4);
  placeSign(f, board.mesh, 23.2, -10, B2_CEIL - 0.6, 1, 0);
  below.add(board.mesh);
  let lastDraw = -1;

  // ---- The shutter (after the last train) ----
  const shutterMb = new MeshBuilder();
  shutterMb.kind = KIND.plain;
  shutterMb.flags = 0;
  shutterMb.style = [0, 0, 0, 0];
  for (let y = 0; y < H - 1.0; y += 0.12) {
    shutterMb.color = lin(y % 0.24 < 0.12 ? 0x8a8e92 : 0x7a7e82);
    localBox(shutterMb, f, 0.3, SUBWAY.fw - 0.3, -0.05, 0.05, y, y + 0.12, KIND.plain);
  }
  const shutter = new THREE.Mesh(shutterMb.build()!, city);
  shutter.visible = false;
  group.add(shutter);

  return {
    group,
    below,
    update(clock: number): void {
      const s = Math.floor(clock);
      if (s === lastDraw) return;
      lastDraw = s;
      board.redraw(boardDraw(clock));
    },
    setClosed(closed: boolean): void {
      shutter.visible = closed;
    },
  };
}

/** Local rect of the pavilion's front (the shutter's line) in world coordinates: blocks walking in when closed. */
export function subwayShutter(b: Building3): Rect {
  return localRect(localFrame(b), 0, SUBWAY.fw, -0.2, 0.2);
}
