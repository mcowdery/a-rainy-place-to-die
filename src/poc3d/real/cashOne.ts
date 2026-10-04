import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { WIN } from './buildings';
import { Draw, type C3 } from './interiorDraw';
import type { Interior } from './interiors';
import { Kit, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toLocal, toWorld } from './localFrame';

/**
 * A mixed-tenant building (雑居ビル) in Kaburo's back alleys, five storeys on an 8 m front, 14 m deep:
 *
 *   1F  質 マルヨシ Maruyoshi, the pawn shop (the noir hub: things and what people know): glass cases of watches,
 *       rings and brand bags, guitars and cameras on the shelves, the pawnbroker behind his grille.
 *   2F  雀荘 東風荘, a mahjong parlour (a story door off the stair's landing; not a place you walk into).
 *   3F  キャッシュ・ワン Cash One, the loan shark ("ブラックOK 即日"), whose collectors blackmail Mack: the payment
 *       counter, the clients' sofa, the collectors' desks, the boss's desk and the safe.
 *   4F, 5F  a vacant floor and a snack bar, the city's windows.
 *
 * Two street doors: the pawn shop's, and a narrow one to the stair (a switchback: the first flight up from the
 * street door to the second floor's landing at the back, the second back toward the front to the third). The
 * interior (interiors.ts, `hides: 'shell'`) switches on in either doorway; the signs (the 質 lightbox, the tenants'
 * stack, Cash One's window film and rooftop sign) and the posters stay outside. The local frame: u along the
 * 8 m front, t inward.
 */
export const ZAKKYO = {
  w: 8,
  d: 14,
  h: 17.4,
  laneA: [0.25, 1.5] as const,
  laneB: [1.6, 2.8] as const,
  hall: [2.8, 3.0] as const,
  stairDoor: [0.35, 1.45] as const,
  pawnDoor: [4.4, 5.6] as const,
  flight: [1.6, 8.8] as const,
  landing: 10.4,
  f2: 3.6,
  f3: 7.2,
  ceil1: 3.4,
  ceil3: 10.2,
} as const;

const IN = { u0: 0.25, u1: 7.75, t0: 0.25, t1: 13.75 } as const;
type R4 = readonly [number, number, number, number];

// The pawn shop's fittings and the office's.
const CASE_L: R4 = [3.0, 3.5, 2.0, 9.0];
const CASE_R: R4 = [7.15, IN.u1, 2.0, 9.0];
const ISLAND: R4 = [4.75, 5.45, 4.0, 7.0];
const PAWN_COUNTER: R4 = [3.0, IN.u1, 10.0, 10.6];
const WIN_L: R4 = [3.0, 4.4, IN.t0, 1.0];
const WIN_R: R4 = [5.6, IN.u1, IN.t0, 1.0];
const SOFA: R4 = [6.9, 7.6, 0.6, 2.6];
const LOW_TABLE: R4 = [5.9, 6.6, 1.0, 2.2];
const PAY_COUNTER: R4 = [3.0, 6.2, 3.2, 3.8];
const DESKS: readonly R4[] = [[3.3, 4.4, 6.0, 7.2], [5.2, 6.3, 6.0, 7.2], [3.3, 4.4, 8.6, 9.8], [5.2, 6.3, 8.6, 9.8]];
const BOSS: R4 = [4.6, 6.4, 11.6, 12.6];
const SAFE: R4 = [7.05, 7.7, 12.9, 13.7];
const FILES: R4 = [3.0, 3.4, 10.4, 13.6];

function ring(front: R4[]): R4[] {
  return [[0, IN.u0, 0, ZAKKYO.d], [IN.u1, ZAKKYO.w, 0, ZAKKYO.d], [0, ZAKKYO.w, IN.t1, ZAKKYO.d], ...front];
}

/** Street level and the foot of the first flight: the two doors, the pawn shop's fittings; the second flight's lane walled off. */
function groundRects(): R4[] {
  const { stairDoor, pawnDoor, laneB, hall, flight, landing } = ZAKKYO;
  return [
    ...ring([[0, stairDoor[0], 0, IN.t0], [stairDoor[1], pawnDoor[0], 0, IN.t0], [pawnDoor[1], ZAKKYO.w, 0, IN.t0]]),
    [laneB[0] - 0.1, laneB[1], 0, flight[1]],
    [hall[0], hall[1], 0, ZAKKYO.d],
    [IN.u0, hall[0], landing, ZAKKYO.d],
    CASE_L,
    CASE_R,
    ISLAND,
    PAWN_COUNTER,
    WIN_L,
    WIN_R,
  ];
}

/** The flights between the floors and the second floor's landing. */
function midRects(): R4[] {
  const { laneA, laneB, hall, flight, landing } = ZAKKYO;
  return [...ring([[0, ZAKKYO.w, 0, IN.t0]]), [laneA[1], laneB[0], flight[0], flight[1]], [IN.u0, hall[0], IN.t0, flight[0]], [hall[0], hall[1], 0, ZAKKYO.d], [IN.u0, hall[0], landing, ZAKKYO.d]];
}

/** The third floor: the stairwell fenced off, the office's door, its furniture. */
function topRects(): R4[] {
  const { laneA, hall, flight, landing } = ZAKKYO;
  return [
    ...ring([[0, ZAKKYO.w, 0, IN.t0]]),
    [IN.u0, laneA[1], flight[0], landing],
    [hall[0], hall[1], 1.45, ZAKKYO.d],
    SOFA,
    LOW_TABLE,
    PAY_COUNTER,
    ...DESKS,
    BOSS,
    SAFE,
    FILES,
  ];
}

/** The floor at local (u, t) for a walker on `current`: the street, the flights, the landing, the third floor. */
function zakkyoFloor(u: number, t: number, current: number): number {
  const { laneA, hall, flight, f2, f3 } = ZAKKYO;
  const run = flight[1] - flight[0];
  if (u < laneA[1]) {
    if (t < flight[0]) return current > 5 ? f3 : 0;
    if (t <= flight[1]) return ((t - flight[0]) / run) * f2;
    return f2;
  }
  if (u < hall[0]) {
    if (t > flight[1]) return f2;
    if (t >= flight[0]) return f2 + ((flight[1] - t) / run) * (f3 - f2);
    return f3;
  }
  return current > 5 ? f3 : 0;
}

export function zakkyoLayout(b: Building3): Omit<Interior, 'group'> {
  const f = localFrame(b);
  const W = (rs: readonly R4[]): Rect[] => rs.map((r) => localRect(f, r[0], r[1], r[2], r[3]));
  const g = W(groundRects());
  const mid = W(midRects());
  const top = W(topRects());
  return {
    colliders: (floor) => (floor < 2 ? g : floor < 5.4 ? mid : top),
    floorAt(x, z, current) {
      const [u, t] = toLocal(f, x, z);
      if (u < IN.u0 || u > IN.u1 || t < IN.t0 || t > IN.t1) return null;
      return zakkyoFloor(u, t, current);
    },
    contains(x, z, y) {
      const [u, t] = toLocal(f, x, z);
      return y > -1 && y < 11.5 && u > 0.3 && u < IN.u1 && t > 0.15 && t < IN.t1;
    },
  };
}

/** From the street: solid, with a pocket at each door. */
export function zakkyoColliders(b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  const { stairDoor, pawnDoor, w, d } = ZAKKYO;
  return [R(0, stairDoor[0], 0, d), R(stairDoor[1], pawnDoor[0], 0, d), R(pawnDoor[1], w, 0, d), R(stairDoor[0], stairDoor[1], 1.0, d), R(pawnDoor[0], pawnDoor[1], 1.0, d)];
}

export function zakkyoShelters(b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  return [{ rect: localRect(f, 0, ZAKKYO.w, 0.3, ZAKKYO.d), y0: 0, y1: ZAKKYO.h, enclosed: true }];
}

export function zakkyoLights(b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  return [L(5.2, -1.5, 6, [1.0, 0.92, 0.75], 0.75), L(0.9, -1.0, 3, [0.8, 0.9, 1.0], 0.35), L(7.8, -1.2, 5, [1.0, 0.95, 0.6], 0.4)];
}

const SANS = "'Yu Gothic', 'Meiryo', sans-serif";
const GRIME = 0xb3a894;
const DINGY = 0xc9c0ac;

/** The building and its signs (a kit landmark's builder): the building in part `shell`, hidden while you're inside. */
export function buildZakkyo(k: Kit, _id: string, part: (name: string) => Kit): void {
  const s = part('shell');
  const { w, d, h, stairDoor, pawnDoor, hall, f2, f3 } = ZAKKYO;
  const CONC = 0x8a847a;
  // ---- 1F: the pawn shop's front (dark frames, two display windows, the doors), the stair's narrow door ----
  s.box(0x2a2622, 0, stairDoor[0], 0, 0.3, 0, f2);
  s.box(CONC, stairDoor[1], 3.0, 0, 0.3, 0, f2);
  s.box(CONC, stairDoor[0], stairDoor[1], 0, 0.3, 2.2, f2);
  s.box(0x2a2622, 3.0, w, 0, 0.3, 0, 0.6);
  s.box(0x2a2622, 3.0, w, 0, 0.3, 2.6, f2);
  for (const u of [3.0, pawnDoor[0], pawnDoor[1], w - 0.25]) s.box(0x2a2622, u - 0.05, u + 0.25, 0, 0.3, 0.6, 2.6);
  // Behind the glass, from the street: lit cases of watches and rings, shelves of guitars and bags.
  s.lit(0xe8e0cc, 3.0, w - 0.25, 2.4, 2.5, 0, f2 - 0.2, true);
  s.lit(0x6a6458, 3.0, w - 0.25, 0.3, 2.5, 0, 0.02, true);
  s.lit(0xf0ead8, 3.0, w - 0.25, 0.3, 2.5, f2 - 0.25, f2 - 0.2, true, true);
  for (const [a, b2] of [[3.25, 4.35], [5.65, 7.5]] as const) {
    s.lit(0x3a3028, a, b2, 0.4, 1.0, 0, 0.9, true);
    s.glow([0.42, 0.4, 0.34], a + 0.05, b2 - 0.05, 0.45, 0.95, 0.9, 0.92);
    for (let u = a + 0.12, i = 0; u < b2 - 0.1; u += 0.22, i++) s.glow(i % 3 ? [1.4, 1.2, 0.6] : [1.1, 1.1, 1.15], u, u + 0.08, 0.6, 0.68, 0.93, 0.97);
  }
  // Two shelves along the back of the window: bags, cameras, boxed watches.
  for (const y of [1.25, 1.95, 2.6]) {
    s.lit(0x8a8478, 3.2, w - 0.45, 2.25, 2.4, y, y + 0.04, true);
    for (let u = 3.3, i = Math.round(y * 4); u < w - 0.7; u += 0.42, i++) s.lit([0x8a4a2a, 0x2a2a2e, 0xc8a060, 0x6a2a2a, 0xd8d4cc][i % 5], u, u + 0.22 + (i % 3) * 0.05, 2.28, 2.4, y + 0.04, y + 0.2 + (i % 2) * 0.12, true);
  }
  s.lit(0x5a4a3a, 0.4, 1.4, 0.3, 1.6, 0, 0.02, true);
  s.lit(0x8a8272, 0.35, 0.4, 0.3, 1.6, 0, 2.2, true);
  s.lit(0x8a8272, 1.4, 1.45, 0.3, 1.6, 0, 2.2, true);
  s.lit(0x9a9080, 0.35, 1.45, 1.55, 1.6, 0, 2.2, true);
  s.lit(0xe8e8f0, 0.35, 1.45, 0.3, 1.6, 2.15, 2.2, true, true);
  s.box(CONC, 0, hall[1], 1.6, d, 0, f2);
  s.box(CONC, 3.0, w, 2.5, d, 0, f2);
  // ---- 2F: the mahjong parlour's windows (green film, white letters); 3F: Cash One's (yellow film) ----
  s.box(CONC, 0, w, 0.25, d, f2, f2 + 3.6);
  s.box(CONC, 0, w, 0, 0.25, f2, f2 + 0.9);
  s.box(CONC, 0, w, 0, 0.25, f2 + 2.7, f3 + 0.9);
  s.box(CONC, 0, 0.6, 0, 0.25, f2 + 0.9, f2 + 2.7);
  s.box(CONC, w - 0.6, w, 0, 0.25, f2 + 0.9, f2 + 2.7);
  s.lit(0x1e5a3a, 0.6, w - 0.6, 0.12, 0.2, f2 + 0.9, f2 + 2.7);
  s.box(CONC, 0, w, 0.25, d, f3, h);
  s.box(CONC, 0, 0.6, 0, 0.25, f3 + 0.9, f3 + 2.7);
  s.box(CONC, w - 0.6, w, 0, 0.25, f3 + 0.9, f3 + 2.7);
  s.box(CONC, 0, w, 0, 0.25, f3 + 2.7, 10.8);
  s.lit(0xe8c820, 0.6, w - 0.6, 0.12, 0.2, f3 + 0.9, f3 + 2.7);
  // ---- 4F, 5F: the city's windows; a stained parapet, water tank and AC units on the roof ----
  s.facade(0x9a948a, [2.6, 0.42, 1.4, WIN.punched], 1 * 16, 0, w, 0, d, 10.8, h, false);
  s.box(0x5a5650, 0, w, 0, d, h, h + 0.5);
  s.lathe(0x8a9098, 5.5, 10.5, [[h + 0.5, 0.7], [h + 1.9, 0.7], [h + 2.1, 0.001]], 12);
  for (const [u, t] of [[2, 9], [3.2, 9]] as const) s.box(0xc8c8c4, u - 0.45, u + 0.45, t - 0.3, t + 0.3, h + 0.5, h + 1.2);
  // AC units hung on the face, their pipes down it.
  for (const [u, y] of [[1.2, 12.2], [5.8, 15.1], [2.0, 9.9]] as const) {
    s.box(0xd8d4cc, u - 0.4, u + 0.4, -0.3, 0, y, y + 0.6);
    s.box(0x7a7670, u + 0.42, u + 0.46, -0.05, 0, y - 1.6, y + 0.3);
  }

  // ---- Signs (they stay while you're inside) ----
  // The pawn shop's fascia, and the round 質 lightbox off the corner.
  k.plane(k.canvas(640, 112, (g) => {
    g.fillStyle = '#123a2a';
    g.fillRect(0, 0, 640, 112);
    text(g, '質', 60, 58, "bold 84px 'Yu Mincho', 'MS Mincho', serif", '#ffffff');
    text(g, 'マルヨシ', 230, 58, `bold 64px ${SANS}`, '#ffffff');
    text(g, '買取・質入・販売', 500, 38, `bold 30px ${SANS}`, '#f4d880');
    text(g, '時計 ブランド 貴金属', 500, 80, `bold 26px ${SANS}`, '#f4d880');
  }), 4.8, 0.84, 5.4, -0.03, 3.05, 'out', 1.2);
  const shichi = k.canvas(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#f8f4ea';
    g.strokeStyle = '#123a2a';
    g.lineWidth = 16;
    g.beginPath();
    g.arc(128, 128, 116, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    text(g, '質', 128, 134, "bold 160px 'Yu Mincho', 'MS Mincho', serif", '#123a2a');
  });
  k.box(0x2a2622, w - 0.05, w + 0.02, -1.2, 0, 4.0, 4.06);
  for (const [u, facing] of [[w - 0.03, '+u'], [w - 0.11, '-u']] as const) {
    const m = k.plane(shichi, 1.0, 1.0, u, -0.75, 3.45, facing, 1.25);
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.transparent = true;
    mat.alphaTest = 0.5;
  }
  k.lathe(0x2a2622, w - 0.07, -0.75, [[3.94, 0.53], [4.0, 0.53]], 20);
  // On the glass: the mahjong parlour's letters, Cash One's.
  const glassText = (draw: (g: CanvasRenderingContext2D) => void, y: number): void => {
    const m = k.plane(k.canvas(1024, 256, (g) => {
      g.clearRect(0, 0, 1024, 256);
      draw(g);
    }), w - 1.2, 1.8, w / 2, 0.08, y, 'out', 1.0);
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.alphaTest = 0.05;
  };
  glassText((g) => {
    text(g, '麻雀 東風荘', 512, 100, `900 120px ${SANS}`, '#ffffff');
    text(g, 'フリー・セット  禁煙席あり  2F', 512, 210, `bold 54px ${SANS}`, '#e8ffe8');
  }, f2 + 1.8);
  glassText((g) => {
    text(g, 'キャッシュ・ワン', 512, 80, `900 116px ${SANS}`, '#1a1a1a');
    g.fillStyle = '#d81818';
    g.fillRect(40, 150, 944, 92);
    text(g, 'ブラックOK 即日融資 0120-55-1111', 512, 198, `900 60px ${SANS}`, '#ffffff');
  }, f3 + 1.8);
  // The tenants' sign stack down the corner by the stair door, lit both ways along the alley.
  const tenants = k.canvas(160, 900, (g) => {
    const rows: [string, string, string, string][] = [
      ['5F', 'スナック 蘭', '#3a1a3a', '#ff9ad8'],
      ['4F', 'テナント募集', '#e8e8e8', '#3a3a3a'],
      ['3F', 'キャッシュ・ワン', '#e8c820', '#1a1a1a'],
      ['2F', '雀荘 東風荘', '#1e5a3a', '#ffffff'],
      ['1F', '質 マルヨシ', '#123a2a', '#f4d880'],
    ];
    rows.forEach(([fl, name, bg, fg], i) => {
      const y0 = i * 180;
      g.fillStyle = bg;
      g.fillRect(4, y0 + 4, 152, 172);
      text(g, fl, 80, y0 + 34, "bold 34px Arial, sans-serif", fg);
      const chars = [...name].filter((c) => c !== ' ');
      const size = Math.min(34, 130 / chars.length * 1.6);
      g.save();
      g.translate(80, y0 + 110);
      text(g, name, 0, 0, `bold ${Math.round(size)}px ${SANS}`, fg);
      g.restore();
    });
  });
  k.box(0x2a2622, 0.08, 0.32, -1.1, -0.05, 4.2, 14.6);
  for (const [u, facing] of [[0.34, '+u'], [0.06, '-u']] as const) k.plane(tenants, 0.95, 10.2, u, -0.58, 9.4, facing, 1.15, true);
  // Cash One on the roof: a billboard on a steel frame, lit at night.
  for (const u of [1.0, 7.0]) k.post(0x4a4a4e, u, 2.0, h + 0.5, h + 5.6, 0.07, 6);
  k.plane(k.canvas(1024, 384, (g) => {
    g.fillStyle = '#e8c820';
    g.fillRect(0, 0, 1024, 384);
    text(g, 'キャッシュ・ワン', 512, 120, `900 150px ${SANS}`, '#1a1a1a');
    g.fillStyle = '#d81818';
    g.fillRect(0, 230, 1024, 154);
    text(g, 'ブラックOK 即日  0120-55-1111', 512, 308, `900 76px ${SANS}`, '#ffffff');
  }), 7.6, 2.85, w / 2, 1.9, h + 3.6, 'out', 1.15, true);
  // Posters by the stair door: a missing person, the loan stickers, the area's notices.
  const flyer = (title: string, sub: string, bg: string, fg: string, u: number, y: number, face = true): void => {
    k.plane(k.canvas(240, 340, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, 240, 340);
      text(g, title, 120, 44, `900 40px ${SANS}`, fg);
      if (face) {
        g.fillStyle = '#8a8478';
        g.fillRect(50, 80, 140, 160);
        g.fillStyle = '#4a4640';
        g.beginPath();
        g.arc(120, 140, 36, 0, Math.PI * 2);
        g.fill();
        g.fillRect(76, 180, 88, 60);
      }
      text(g, sub, 120, 300, `bold 22px ${SANS}`, fg);
    }), 0.42, 0.6, u, -0.02, y, 'out', 1.0);
  };
  flyer('探しています', '情報をお寄せください', '#ffffff', '#1a1a1a', 1.85, 1.6);
  flyer('ブラックOK', '即日 0120-55-1111', '#e8c820', '#d81818', 2.4, 1.75, false);
  flyer('行方不明', '19歳 女性 最後に歌舞路で', '#fff8e8', '#c81818', 2.0, 0.95);
}

/** The interior, built a slice at a time: the stair hall and its flights, the pawn shop, Cash One's office. */
export function* zakkyoInterior(b: Building3, city: THREE.Material, ghost: THREE.Material): Generator<void, Interior> {
  const k = new Kit(b);
  const d = new Draw(k);
  const { laneA, laneB, hall, flight, landing, f2, f3, ceil1, ceil3, stairDoor, pawnDoor, w } = ZAKKYO;
  const run = flight[1] - flight[0];

  // ---- The stair hall: grimy walls, a worn floor, the mailboxes and directory, two flights, the landing ----
  d.W(0x5a4a3a, IN.u0, hall[0], IN.t0, flight[0], 0, 0.02);
  d.W(DINGY, 0.2, IN.u0, IN.t0, IN.t1, 0, ceil3);
  d.W(DINGY, hall[0], hall[1], IN.t0, IN.t1, 0, f3);
  d.W(DINGY, hall[0], hall[1], 1.45, IN.t1, f3, ceil3);
  d.W(DINGY, hall[0], hall[1], IN.t0, 1.45, f3 + 2.2, ceil3);
  d.W(DINGY, IN.u0, hall[0], landing, landing + 0.1, 0, ceil3);
  d.W(DINGY, IN.u0, stairDoor[0], 0, IN.t0, 0, f2);
  d.W(DINGY, stairDoor[1], hall[0], 0, IN.t0, 0, f2);
  d.W(DINGY, stairDoor[0], stairDoor[1], 0, IN.t0, 2.2, f2);
  d.W(DINGY, IN.u0, hall[0], 0, IN.t0, f2, ceil3);
  // The second flight's lane is walled at street level (under the flight, the front corner).
  d.W(GRIME, laneB[0] - 0.1, laneB[1], IN.t0, flight[0], 0, f3 - 0.2);
  d.W(GRIME, laneA[1], laneB[0], flight[0], flight[1], 0, f3 + 1.0);
  const n = 20;
  const tread = run / n;
  for (let i = 0; i < n; i++) {
    const t = flight[0] + i * tread;
    const y1 = ((i + 1) / n) * f2;
    d.W(i % 2 ? 0x7a7268 : 0x857c70, laneA[0], laneA[1], t, t + tread, 0, y1);
    d.W(0x3a3630, laneA[0], laneA[1], t - 0.005, t + 0.03, y1 - 0.02, y1 + 0.003);
    // The second flight: up from the landing toward the front.
    const t2 = flight[1] - (i + 1) * tread;
    const y2 = f2 + ((i + 1) / n) * (f3 - f2);
    d.W(i % 2 ? 0x7a7268 : 0x857c70, laneB[0], laneB[1], t2, t2 + tread, y2 - 0.25, y2);
    d.W(0x3a3630, laneB[0], laneB[1], t2 + tread - 0.03, t2 + tread + 0.005, y2 - 0.02, y2 + 0.003);
  }
  d.W(0x6a6258, IN.u0, hall[0], flight[1], landing, f2 - 0.25, f2);
  d.W(0x6a6258, IN.u0, hall[0], IN.t0, flight[0], f3 - 0.25, f3);
  d.W(0xe8e8e0, IN.u0, hall[0], IN.t0, flight[0], f2 - 0.25, f2 - 0.2, true);
  d.W(0xe0dcd0, IN.u0, hall[0], IN.t0, landing, ceil3, ceil3 + 0.1, true);
  // A rail along the third floor's edge over the well.
  d.W(0x5a5a5e, IN.u0, laneA[1], flight[0], flight[0] + 0.05, f3 + 0.95, f3 + 1.0);
  for (let u = IN.u0 + 0.1; u < laneA[1]; u += 0.3) d.W(0x5a5a5e, u, u + 0.03, flight[0], flight[0] + 0.03, f3, f3 + 0.95);
  // Fluorescent tubes, one by each floor; one flickers in its fitting (only a dimmer tube here).
  const tubes: [number, number, C3][] = [[f2 - 0.3, 1.0, [1.4, 1.5, 1.5]], [ceil3 - 0.05, 6.0, [0.8, 0.9, 0.9]], [ceil3 - 0.05, 2.0, [1.4, 1.5, 1.5]]];
  for (const [y, t, rgb] of tubes) d.glow(rgb, 0.6, 1.2, t, t + 0.08, y - 0.04, y);
  // The mailboxes and the directory in the entrance.
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 2; col++) d.W(0x8a9098, IN.u0 + 0.02, IN.u0 + 0.3, 0.5 + col * 0.42, 0.88 + col * 0.42, 1.0 + row * 0.3, 1.26 + row * 0.3);
  k.plane(k.canvas(220, 320, (g) => {
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, 220, 320);
    const rows = ['5F スナック 蘭', '4F 空室', '3F キャッシュ・ワン', '2F 雀荘 東風荘', '1F 質 マルヨシ'];
    rows.forEach((r, i) => text(g, r, 20, 40 + i * 60, `bold 22px ${SANS}`, '#f0f0e8', 'left'));
  }), 0.44, 0.64, hall[0] - 0.01, 1.0, 1.6, '-u', 1.0);
  // On the landing: the mahjong parlour's steel door, its sign, the clatter (a lit gap under the door).
  d.W(0x3a5a4a, 0.6, 1.9, landing - 0.04, landing, f2, f2 + 2.1);
  d.glow([1.0, 1.1, 0.8], 0.65, 1.85, landing - 0.05, landing - 0.04, f2 + 0.01, f2 + 0.04);
  k.plane(k.canvas(300, 120, (g) => {
    g.fillStyle = '#1e5a3a';
    g.fillRect(0, 0, 300, 120);
    text(g, '雀荘 東風荘', 150, 50, `bold 46px ${SANS}`, '#ffffff');
    text(g, '営業中', 150, 100, `bold 26px ${SANS}`, '#e8ffe8');
  }), 0.75, 0.3, 1.25, landing - 0.05, f2 + 2.35, 'out', 1.0);
  yield;

  // ---- 質 マルヨシ: the shop floor (old linoleum, a low ceiling), the glass cases, the shelves, the grille ----
  const s0 = hall[1];
  d.W(0x6a6458, s0, IN.u1, IN.t0, IN.t1, 0, 0.02);
  d.W(0xe8e0cc, s0, IN.u1, IN.t0, IN.t1, ceil1, ceil1 + 0.1, true);
  d.W(0xd8ceb8, IN.u1 - 0.05, IN.u1, IN.t0, IN.t1, 0, ceil1);
  d.W(0xd8ceb8, s0, IN.u1, IN.t1 - 0.05, IN.t1, 0, ceil1);
  d.W(0xd8ceb8, s0, s0 + 0.05, IN.t0, IN.t1, 0, ceil1);
  // The front: the windows' frames inside, the glass, the doors.
  d.W(0x2a2622, s0, IN.u1, 0, IN.t0, 0, 0.6);
  d.W(0x2a2622, s0, IN.u1, 0, IN.t0, 2.6, ceil1);
  for (const u of [s0, pawnDoor[0], pawnDoor[1], IN.u1 - 0.2]) d.W(0x2a2622, u, u + 0.2, 0, IN.t0, 0.6, 2.6);
  k.pane(3.2, pawnDoor[0], 0.6, 2.6, 0.12);
  k.pane(pawnDoor[1] + 0.2, IN.u1 - 0.2, 0.6, 2.6, 0.12);
  for (const t of [3.0, 6.0, 9.0]) d.glow([1.5, 1.5, 1.4], 4.2, 6.4, t, t + 0.1, ceil1 - 0.04, ceil1);
  // Glass cases along both walls and an island: a lit top, a dark body, watches and rings inside.
  const glassCase = (r: R4): void => {
    d.W(0x3a3028, r[0], r[1], r[2], r[3], 0, 0.85);
    d.glow([0.4, 0.38, 0.32], r[0] + 0.04, r[1] - 0.04, r[2] + 0.04, r[3] - 0.04, 0.85, 0.87);
    for (let t = r[2] + 0.15, i = 0; t < r[3] - 0.1; t += 0.2, i++)
      for (let u = r[0] + 0.12; u < r[1] - 0.08; u += 0.22) d.glow(i % 4 === 0 ? [1.1, 1.1, 1.2] : [1.4, 1.15, 0.55], u, u + 0.07, t, t + 0.07, 0.88, 0.92);
    k.pane(r[0], r[1], 0.92, 1.1, r[2]);
    k.pane(r[0], r[1], 0.92, 1.1, r[3]);
    d.W(0x2a2622, r[0], r[1], r[2], r[3], 1.1, 1.12);
  };
  glassCase(CASE_L);
  glassCase(CASE_R);
  glassCase(ISLAND);
  for (const r of [WIN_L, WIN_R]) {
    d.W(0x3a3028, r[0], r[1], r[2], r[3], 0, 0.6);
    for (let u = r[0] + 0.15, i = 0; u < r[1] - 0.15; u += 0.3, i++) d.lathe([0x8a4a2a, 0x2a2a2e, 0xc89a40][i % 3], u, (r[2] + r[3]) / 2, [[0.6, 0.12], [0.85, 0.13], [0.9, 0.001]], 8);
  }
  // The shelves over the cases: guitars, cameras, bags, a row of game consoles.
  for (const u of [s0 + 0.05, IN.u1 - 0.35]) {
    for (let t = 2.2, i = 0; t < 8.8; t += 0.6, i++) {
      if (i % 3 === 0) {
        const uu = u + (u < 4 ? 0.12 : 0.1);
        d.lathe(0x8a4a22, uu, t + 0.2, [[1.6, 0.001], [1.62, 0.16], [1.75, 0.18], [1.9, 0.12], [2.02, 0.15], [2.15, 0.12], [2.18, 0.001]], 10);
        d.W(0x3a2a1a, uu - 0.02, uu + 0.02, t + 0.18, t + 0.22, 2.18, 2.75);
      } else {
        d.W(0x8a8478, u, u + 0.3, t, t + 0.55, 1.75, 1.78);
        d.W([0x2a2a2e, 0x6a3a2a, 0xc8a070, 0x1a1a1a][i % 4], u + 0.04, u + 0.26, t + 0.08, t + 0.42, 1.78, 2.05);
        d.W(0x8a8478, u, u + 0.3, t, t + 0.55, 2.4, 2.43);
        d.W([0xd8d4cc, 0x2a2a2e, 0x8a2a3a][i % 3], u + 0.05, u + 0.25, t + 0.1, t + 0.4, 2.43, 2.62);
      }
    }
  }
  // The counter at the back with its steel grille, the scale, the ledger; the back room's door behind.
  d.W(0x4a3a2a, PAWN_COUNTER[0], PAWN_COUNTER[1], PAWN_COUNTER[2], PAWN_COUNTER[3], 0, 1.0);
  d.W(0x6a5a44, PAWN_COUNTER[0], PAWN_COUNTER[1], PAWN_COUNTER[2] - 0.05, PAWN_COUNTER[3] + 0.05, 1.0, 1.05);
  for (let u = PAWN_COUNTER[0] + 0.1; u < PAWN_COUNTER[1]; u += 0.12) if (u < 4.9 || u > 5.9) d.W(0x6a6e72, u, u + 0.02, 10.28, 10.32, 1.05, 2.4);
  d.W(0x6a6e72, PAWN_COUNTER[0], PAWN_COUNTER[1], 10.27, 10.33, 2.38, 2.42);
  d.W(0xc8c4b8, 5.1, 5.6, 10.1, 10.45, 1.05, 1.1);
  d.lathe(0xc8a040, 6.6, 10.3, [[1.05, 0.12], [1.1, 0.12], [1.12, 0.001]], 10);
  d.W(0x3a2a1a, 5.0, 6.0, IN.t1 - 0.06, IN.t1, 0, 2.1);
  k.plane(k.canvas(300, 160, (g) => {
    g.fillStyle = '#f8f4ea';
    g.fillRect(0, 0, 300, 160);
    text(g, '質入れ 期限 3ヶ月', 150, 40, `bold 30px ${SANS}`, '#123a2a');
    text(g, '利息 月 9%', 150, 88, `bold 30px ${SANS}`, '#c81818');
    text(g, '身分証明書をご提示ください', 150, 134, `bold 20px ${SANS}`, '#1a1a1a');
  }), 0.9, 0.48, 4.0, PAWN_COUNTER[3] + 0.1, 2.0, 'out', 1.0);
  // People: a customer at the island, a woman at the counter selling a bag. (The pawnbroker is the story's npc.)
  k.person(4.1, 5.6, 1, 0, { y: -0.13, body: 'man', pose: 'pockets', outfit: 'long', hair: 'short', color: [0.2, 0.18, 0.16] });
  k.person(6.4, 9.4, 0, 1, { y: -0.13, body: 'woman', pose: 'hold', outfit: 'plain', hair: 'long', color: [0.3, 0.2, 0.24] });
  yield;

  // ---- キャッシュ・ワン: the office on the third floor. Grey carpet, blinds over the yellow film, the counter where
  // you pay, the clients' sofa by the window, the collectors' desks, the boss's desk, the safe, the files ----
  const o0 = hall[1];
  d.W(0x5a5c60, o0, IN.u1, IN.t0, IN.t1, f3 - 0.2, f3);
  d.W(0xd8d4c8, o0, IN.u1, IN.t0, IN.t1, ceil3, ceil3 + 0.1, true);
  d.W(0xcfc8b6, IN.u1 - 0.05, IN.u1, IN.t0, IN.t1, f3, ceil3);
  d.W(0xcfc8b6, o0, IN.u1, IN.t1 - 0.05, IN.t1, f3, ceil3);
  d.W(0xcfc8b6, o0, o0 + 0.05, 1.45, IN.t1, f3, ceil3);
  d.W(0xcfc8b6, o0, IN.u1, 0, IN.t0, f3, f3 + 0.9);
  d.W(0xcfc8b6, o0, IN.u1, 0, IN.t0, f3 + 2.7, ceil3);
  d.W(0xcfc8b6, w - 0.6, IN.u1, 0, IN.t0, f3 + 0.9, f3 + 2.7);
  // The window: yellow film seen from inside (the letters backwards), blinds half down.
  d.glow([1.1, 0.95, 0.25], 3.0, w - 0.6, 0.12, 0.14, f3 + 0.9, f3 + 2.7);
  for (let y = f3 + 2.0; y < f3 + 2.7; y += 0.08) d.W(0xe8e4d8, 3.0, w - 0.6, 0.26, 0.3, y, y + 0.05);
  for (const t of [2.5, 6.6, 10.6]) d.glow([1.5, 1.55, 1.5], 4.0, 6.6, t, t + 0.1, ceil3 - 0.04, ceil3);
  // The door from the stair: steel, frosted glass with the name.
  k.plane(k.canvas(260, 120, (g) => {
    g.fillStyle = '#e8c820';
    g.fillRect(0, 0, 260, 120);
    text(g, 'キャッシュ・ワン', 130, 46, `900 34px ${SANS}`, '#1a1a1a');
    text(g, '受付 RECEPTION', 130, 92, `bold 22px ${SANS}`, '#1a1a1a');
  }), 0.6, 0.28, hall[0] - 0.01, 0.9, f3 + 2.45, '-u', 1.0);
  // The clients' corner: a black vinyl sofa, a low glass table, an ashtray, a TV on a bracket.
  d.W(0x1a1a1c, SOFA[0], SOFA[1], SOFA[2], SOFA[3], f3, f3 + 0.42);
  d.W(0x1a1a1c, SOFA[1] - 0.2, SOFA[1], SOFA[2], SOFA[3], f3 + 0.42, f3 + 0.9);
  d.W(0x2a2a2e, LOW_TABLE[0], LOW_TABLE[1], LOW_TABLE[2], LOW_TABLE[3], f3, f3 + 0.38);
  d.lathe(0xb8b8bc, 6.25, 1.6, [[f3 + 0.38, 0.08], [f3 + 0.42, 0.08], [f3 + 0.43, 0.001]], 8);
  d.W(0x1a1a1c, 3.1, 3.3, 1.6, 2.6, f3 + 1.8, f3 + 2.4);
  d.glow([0.5, 0.6, 0.8], 3.3, 3.31, 1.65, 2.55, f3 + 1.85, f3 + 2.35);
  // The counter: a wood top over a laminate front, a tray for the money, the sign about the payment day.
  d.W(0x8a8478, PAY_COUNTER[0], PAY_COUNTER[1], PAY_COUNTER[2], PAY_COUNTER[3], f3, f3 + 1.0);
  d.W(0x5a4a38, PAY_COUNTER[0], PAY_COUNTER[1] + 0.05, PAY_COUNTER[2] - 0.05, PAY_COUNTER[3] + 0.05, f3 + 1.0, f3 + 1.05);
  d.W(0x2a2a2e, 4.3, 4.7, 3.3, 3.6, f3 + 1.05, f3 + 1.08);
  k.plane(k.canvas(300, 200, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 300, 200);
    text(g, 'ご返済日', 150, 40, `900 40px ${SANS}`, '#c81818');
    text(g, '毎週月曜日', 150, 100, `900 46px ${SANS}`, '#1a1a1a');
    text(g, '遅延損害金 年20%', 150, 160, `bold 26px ${SANS}`, '#1a1a1a');
  }), 0.6, 0.4, 3.6, PAY_COUNTER[2] - 0.01, f3 + 1.35, 'out', 1.0);
  // The desks: grey steel, a monitor, a phone, files; the boss's desk in dark wood under a framed 金.
  for (const r of DESKS) {
    d.W(0x8a8e94, r[0], r[1], r[2], r[3], f3, f3 + 0.72);
    d.W(0x9a9ea2, r[0] - 0.02, r[1] + 0.02, r[2] - 0.02, r[3] + 0.02, f3 + 0.72, f3 + 0.75);
    d.W(0x1a1a1c, r[0] + 0.3, r[0] + 0.8, r[2] + 0.1, r[2] + 0.18, f3 + 0.75, f3 + 1.15);
    d.glow([0.45, 0.6, 0.7], r[0] + 0.32, r[0] + 0.78, r[2] + 0.19, r[2] + 0.2, f3 + 0.78, f3 + 1.12);
    d.W(0xe8e4d8, r[1] - 0.45, r[1] - 0.15, r[2] + 0.4, r[2] + 0.75, f3 + 0.75, f3 + 0.85);
  }
  d.W(0x3a2418, BOSS[0], BOSS[1], BOSS[2], BOSS[3], f3, f3 + 0.76);
  d.W(0x4a2e1e, BOSS[0] - 0.03, BOSS[1] + 0.03, BOSS[2] - 0.03, BOSS[3] + 0.03, f3 + 0.76, f3 + 0.8);
  d.W(0x1a1a1c, 5.1, 5.9, 12.9, 13.5, f3, f3 + 1.3);
  k.plane(k.canvas(256, 360, (g) => {
    g.fillStyle = '#f4ecd8';
    g.fillRect(0, 0, 256, 360);
    g.strokeStyle = '#3a2418';
    g.lineWidth = 16;
    g.strokeRect(8, 8, 240, 344);
    text(g, '金', 128, 170, "bold 200px 'Yu Mincho', 'MS Mincho', serif", '#1a1a1a');
  }), 0.7, 1.0, 5.5, IN.t1 - 0.06, f3 + 1.9, 'out', 1.0);
  d.W(0x4a4e52, SAFE[0], SAFE[1], SAFE[2], SAFE[3], f3, f3 + 1.1);
  d.lathe(0xb8b8bc, SAFE[0] - 0.01, 13.3, [[f3 + 0.6, 0.07], [f3 + 0.62, 0.07]], 10);
  for (let t = FILES[2] + 0.05; t < FILES[3]; t += 0.5) {
    d.W(0x9aa0a4, FILES[0], FILES[1], t, t + 0.46, f3, f3 + 1.8);
    for (let y = f3 + 0.3; y < f3 + 1.8; y += 0.45) d.W(0x6a7074, FILES[1], FILES[1] + 0.01, t + 0.18, t + 0.28, y, y + 0.04);
  }
  // People: a client on the sofa, two collectors at their desks, the boss; one at the counter is the story's npc.
  const P = (u: number, t: number, du: number, dt: number, spec: Parameters<Kit['person']>[4]): void => k.person(u, t, du, dt, { y: f3 - 0.15, ...spec });
  P(7.25, 1.6, -1, 0, { body: 'elder', pose: 'sit', outfit: 'plain', hair: 'none', color: [0.28, 0.26, 0.22] });
  P(3.85, 7.75, 0, -1, { body: 'man', pose: 'sit', outfit: 'suit', hair: 'short', color: [0.12, 0.12, 0.14] });
  P(5.75, 10.35, 0, -1, { body: 'man', pose: 'phone', outfit: 'suit', hair: 'short', color: [0.14, 0.12, 0.12] });
  P(5.5, 12.95, 0, -1, { body: 'man', pose: 'sit', outfit: 'suit', hair: 'short', color: [0.1, 0.1, 0.1] });

  const group = k.finish(city, ghost);
  group.visible = false;
  return { group, ...zakkyoLayout(b) };
}

