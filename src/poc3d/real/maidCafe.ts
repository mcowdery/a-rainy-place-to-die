import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { WIN } from './buildings';
import { Draw, type C3 } from './interiorDraw';
import type { Interior } from './interiors';
import { Kit, neonText, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toLocal, toWorld } from './localFrame';
import { EMIT } from './meshBuilder';
import { shopFlags, TRADE } from './shops';

/**
 * めいどかふぇ ♡ぴゅあ♡ (Maid Café Pure), in Denkō-chō's maid café lanes on Denkō-dōri: a narrow pastel building
 * (10 m along the street, 16 m deep), an anime goods shop at street level, the café up a straight stair on the
 * second floor, offices above. A maid hands out flyers by the A-board on the pavement.
 *
 *   1F  the street door into the stair hall (posters, the menu by the door), the flight up; the goods shop
 *       beside it is the city's storefront (trade `hobby`), not a place you go in.
 *   2F  the café: a maid greets you at the door ("おかえりなさいませ、ご主人様♡"), six tables on a pink and white
 *       checkered floor under heart lamps, the small stage at the back with its live backdrop, the counter and
 *       kitchen, the menu board, the cheki board, a shelf of plushies. Maids serve, one sings, the regulars sit.
 *
 * You walk in through the street door (the interior switches on in the doorway) or E at it (straight up to the
 * café), and out by walking down and out, or E at the café's door. The local frame: u along the 10 m front, t
 * inward 16 m. While you're inside only the building (`shell`) is hidden: the signs, the A-board and the people on
 * the pavement stay.
 */

/** The plan (local metres): the stair hall's lane (u), the flight (t), the café floor and ceiling, its doorway. */
export const CAFE = {
  w: 10,
  d: 16,
  h: 19.4,
  door: [0.6, 2.4] as const,
  lane: [0.25, 2.6] as const,
  hall: [2.6, 2.8] as const,
  flight: [3, 11.4] as const,
  f2: 4.35,
  ceil: 7.6,
  entry: [11.6, 15] as const,
} as const;

const IN = { u0: 0.25, u1: 9.75, t0: 0.25, t1: 15.75 } as const;
type R4 = readonly [number, number, number, number];

/** The café's tables (centres; chairs either side along t). */
const TABLES: readonly (readonly [number, number])[] = [[4.3, 1.9], [7.3, 1.9], [4.3, 4.8], [7.3, 4.8], [4.3, 7.7], [7.3, 7.7]];
const STAGE: R4 = [7.6, IN.u1, 9.6, 12.6];
const PODIUM: R4 = [4.5, 5.1, 12.0, 12.6];
const COUNTER: R4 = [5.4, IN.u1, 13.7, 14.3];
const KITCHEN_END: R4 = [5.2, 5.4, 13.7, IN.t1];
const SHELF: R4 = [9.45, IN.u1, 1.2, 6.2];

/** Street level (and the lower flight): the outer walls round the stair hall, the door open. */
function groundRects(): R4[] {
  return [
    [0, IN.u0, 0, CAFE.d],
    [0, CAFE.door[0], 0, IN.t0],
    [CAFE.door[1], CAFE.hall[1], 0, IN.t0],
    [CAFE.hall[0], CAFE.hall[1], 0, CAFE.d],
    [0, CAFE.hall[1], IN.t1, CAFE.d],
  ];
}

/** The café floor (and the upper flight): its walls, the doorway from the landing, the furniture. */
function upperRects(): R4[] {
  return [
    [0, CAFE.w, 0, IN.t0],
    [0, IN.u0, 0, CAFE.d],
    [IN.u1, CAFE.w, 0, CAFE.d],
    [0, CAFE.w, IN.t1, CAFE.d],
    [CAFE.hall[0], CAFE.hall[1], 0, CAFE.entry[0]],
    [CAFE.hall[0], CAFE.hall[1], CAFE.entry[1], CAFE.d],
    STAGE,
    PODIUM,
    COUNTER,
    KITCHEN_END,
    SHELF,
    ...TABLES.map(([u, t]) => [u - 0.5, u + 0.5, t - 1.0, t + 1.0] as R4),
  ];
}

/** The floor in the stair hall's lane at t: the street, the flight, the landing. */
function laneFloor(t: number): number {
  const [a, b] = CAFE.flight;
  if (t <= a) return 0;
  if (t >= b) return CAFE.f2;
  return ((t - a) / (b - a)) * CAFE.f2;
}

/** The building from the street (collision): solid, but for a pocket at the street door you walk in through. */
export function maidCafeColliders(b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  return [R(0, CAFE.door[0], 0, CAFE.d), R(CAFE.door[1], CAFE.w, 0, CAFE.d), R(CAFE.door[0], CAFE.door[1], 1.0, CAFE.d)];
}

export function maidCafeShelters(b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  return [{ rect: localRect(f, 0, CAFE.w, 0.3, CAFE.d), y0: 0, y1: CAFE.h, enclosed: true }];
}

export function maidCafeLights(b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  return [L(1.5, -1.5, 6, [1.0, 0.55, 0.8], 0.85), L(6.4, -1.8, 7, [0.85, 0.8, 1.0], 0.6), L(5, -2.5, 8, [1.0, 0.7, 0.85], 0.4)];
}

/** The café's layout alone (collision per level, floors, the stair, what counts as inside). */
export function maidCafeLayout(b: Building3): Omit<Interior, 'group'> {
  const f = localFrame(b);
  const W = (rs: readonly R4[]): Rect[] => rs.map((r) => localRect(f, r[0], r[1], r[2], r[3]));
  const g = W(groundRects());
  const up = W(upperRects());
  return {
    // The flight passes from one set to the other at 2 m; both wall the lane in.
    colliders: (floor) => (floor < 2 ? g : up),
    floorAt(x, z, current) {
      const [u, t] = toLocal(f, x, z);
      if (u < IN.u0 || u > IN.u1 || t < IN.t0 || t > IN.t1) return null;
      if (u < CAFE.hall[0]) return laneFloor(t);
      return current > 2 ? CAFE.f2 : 0;
    },
    contains(x, z, y) {
      const [u, t] = toLocal(f, x, z);
      return y > -1 && y < 12 && u > 0.3 && u < IN.u1 && t > 0.15 && t < IN.t1;
    },
  };
}

// ---- Colours ----
const PINK_WALL = 0xf7c6d9;
const WHITE = 0xfdfbfb;
const PINK = 0xf08ab4;
const DEEP = 0xd84a8a;
const MINT = 0xa8e6d4;
const LAMP: C3 = [1.7, 1.15, 1.35];
const FACADE = 0xf3e3ea;
const FRAME = 0xf2b4cc;

/** A canvas plane with see-through background (lettering on glass). */
function decal(k: Kit, tex: THREE.Texture, w: number, h: number, u: number, t: number, y: number, facing: Parameters<Kit['plane']>[6] = 'out', bright = 1): THREE.Mesh {
  const m = k.plane(tex, w, h, u, t, y, facing, bright);
  const mat = m.material as THREE.MeshBasicMaterial;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.alphaTest = 0.02;
  return m;
}

/** A heart path centred at (x, y), size s. */
function heart(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x, y + s * 0.35);
  g.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.45, y - s * 0.9, x, y - s * 0.38);
  g.bezierCurveTo(x + s * 0.45, y - s * 0.9, x + s * 0.9, y - s * 0.25, x, y + s * 0.35);
  g.closePath();
}

const ROUND = "'Yu Gothic', 'Meiryo', 'Hiragino Maru Gothic ProN', sans-serif";

/** The exterior (a kit landmark's builder): the building in part `shell` (hidden while you're inside), the signs, the A-board and the pavement's people in the main kit. */
export function buildMaidCafe(k: Kit, _id: string, part: (name: string) => Kit): void {
  const s = part('shell');
  const { ceil, h } = CAFE;
  // ---- Street level: the goods shop's storefront (the city's shop shader), the door into the stair hall ----
  s.facade(FACADE, [2.4, 0.5, 1.4, WIN.punched], 1 + 4 * 16 + shopFlags(TRADE.hobby, 5), CAFE.hall[1], CAFE.w, 0, CAFE.d, 0, 4.1, true);
  s.box(FACADE, 0, CAFE.door[0], 0, 0.3, 0, 4.1);
  s.box(FACADE, CAFE.door[1], CAFE.hall[1], 0, 0.3, 0, 4.1);
  s.box(FACADE, CAFE.door[0], CAFE.door[1], 0, 0.3, 2.5, 4.1);
  // The lit recess inside the door: pink walls, a tiled floor, the poster pointing upstairs.
  s.lit(0x6a5a64, CAFE.door[0], CAFE.door[1], 0.3, 2.6, 0, 0.02, true);
  s.lit(PINK_WALL, 0.25, 0.3, 0.3, 2.6, 0, 2.5, true);
  s.lit(PINK_WALL, 2.55, 2.6, 0.3, 2.6, 0, 2.5, true);
  s.lit(0xfff0f6, 0.25, 2.6, 0.3, 2.6, 2.5, 2.55, true, true);
  s.lit(PINK_WALL, 0.25, 2.6, 2.6, 2.65, 0, 2.5, true);
  s.plane(s.canvas(360, 360, (g) => {
    g.fillStyle = '#ffe4ef';
    g.fillRect(0, 0, 360, 360);
    g.fillStyle = '#ff6fae';
    heart(g, 180, 140, 150);
    g.fill();
    text(g, '2F', 180, 120, `900 84px ${ROUND}`, '#ffffff');
    text(g, '↑ めいどかふぇ ↑', 180, 270, `bold 34px ${ROUND}`, '#d8306f');
    text(g, 'おかえりなさいませ♡', 180, 320, `bold 28px ${ROUND}`, '#a8285e');
  }), 1.5, 1.5, 1.42, 2.58, 1.4, 'out', 1.0);
  s.box(FACADE, 0, CAFE.hall[1], 2.65, CAFE.d, 0, 4.1);
  // ---- Second floor: the café's windows (pink light, lace curtains, heart lamps behind the glass) ----
  s.box(FACADE, 0, CAFE.w, 1.6, CAFE.d, 4.1, ceil);
  s.box(FRAME, 0, CAFE.w, 0, 1.6, 4.1, 5.0);
  s.box(FRAME, 0, CAFE.w, 0, 1.6, 6.9, ceil);
  s.box(FRAME, 0, 0.4, 0, 1.6, 5.0, 6.9);
  s.box(FRAME, 9.6, CAFE.w, 0, 1.6, 5.0, 6.9);
  for (const u of [3.4, 6.5]) s.box(0xffffff, u - 0.06, u + 0.06, 0.05, 0.2, 5.0, 6.9);
  s.lit(0xffd6e8, 0.4, 9.6, 1.5, 1.6, 5.0, 6.9, true);
  s.lit(0xf7c0d6, 0.4, 9.6, 0.2, 1.5, 6.85, 6.9, true, true);
  s.lit(0xfff4f8, 0.4, 9.6, 0.2, 1.5, 5.0, 5.05, true);
  for (const [a, b2] of [[0.4, 3.34], [3.46, 6.44], [6.56, 9.6]] as const) {
    s.lit(0xfff8fb, a, a + 0.35, 0.35, 0.45, 5.05, 6.85, true);
    s.lit(0xfff8fb, b2 - 0.35, b2, 0.35, 0.45, 5.05, 6.85, true);
    s.glow(LAMP, (a + b2) / 2 - 0.12, (a + b2) / 2 + 0.12, 1.0, 1.24, 6.35, 6.6, EMIT.always);
  }
  s.pane(0.4, 9.6, 5.0, 6.9, 0.12);
  // ---- Above: offices, the city shader's windows; a parapet and the rooftop units ----
  s.facade(0xe8d8e2, [2.5, 0.45, 1.4, WIN.punched], 2 * 16, 0, CAFE.w, 0, CAFE.d, ceil, h, false);
  s.box(0x5a4a56, 0, CAFE.w, 0, 0.3, h, h + 0.6);
  s.box(0x5a4a56, 0, CAFE.w, CAFE.d - 0.3, CAFE.d, h, h + 0.6);
  s.box(0x8a8a90, 6.5, 8.5, 10, 12.5, h, h + 1.3);
  s.box(0x9a9aa0, 2, 3.2, 12, 14, h, h + 0.9);

  // ---- Signs (they stay while you're inside: you can't see them from there) ----
  // The band over the café's windows.
  k.plane(k.canvas(1024, 72, (g) => {
    g.fillStyle = '#2a0e1e';
    g.fillRect(0, 0, 1024, 72);
    neonText(g, '♡ めいどかふぇ ぴゅあ ♡   MAID CAFÉ PURE   2F', 512, 38, `bold 44px ${ROUND}`, '#ff6fb8');
  }), 9.2, 0.65, 5, -0.03, 7.25, 'out', 1.3, true);
  // On the glass: おかえりなさいませ.
  decal(k, k.canvas(1024, 128, (g) => {
    g.clearRect(0, 0, 1024, 128);
    g.lineWidth = 10;
    g.strokeStyle = '#ff5fa8';
    g.font = `900 64px ${ROUND}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeText('おかえりなさいませ ご主人様♡', 512, 64);
    g.fillStyle = '#ffffff';
    g.fillText('おかえりなさいませ ご主人様♡', 512, 64);
  }), 6.0, 0.75, 5, 0.04, 5.45, 'out', 1.0);
  // The blade sign at the corner, lit both ways along the street.
  k.box(0x2a0e1e, 0.32, 0.58, -1.45, -0.08, 8.2, 16.6);
  const blade = k.canvas(160, 840, (g) => {
    g.fillStyle = '#ffe9f2';
    g.fillRect(0, 0, 160, 840);
    g.strokeStyle = '#ff5fa8';
    g.lineWidth = 12;
    g.strokeRect(8, 8, 144, 824);
    ['め', 'い', 'ど', 'か', 'ふ', 'ぇ'].forEach((c, i) => text(g, c, 80, 70 + i * 82, `900 76px ${ROUND}`, '#e8307a'));
    g.fillStyle = '#ff5fa8';
    heart(g, 80, 610, 90);
    g.fill();
    text(g, 'ぴゅあ', 80, 600, `900 34px ${ROUND}`, '#ffffff');
    text(g, '2F', 80, 760, `900 72px Arial, ${ROUND}`, '#8a3cc8');
  });
  for (const [u, facing] of [[0.6, '+u'], [0.3, '-u']] as const) k.plane(blade, 1.3, 8.2, u, -0.77, 12.4, facing, 1.25, true);
  // Over the street door: a neon heart and the way up.
  k.plane(k.canvas(256, 220, (g) => {
    g.fillStyle = '#12060c';
    g.fillRect(0, 0, 256, 220);
    g.shadowColor = '#ff4fa0';
    g.lineWidth = 12;
    g.strokeStyle = '#ff7fbf';
    for (const blur of [24, 8]) {
      g.shadowBlur = blur;
      heart(g, 128, 110, 170);
      g.stroke();
    }
    g.shadowBlur = 0;
    text(g, '2F', 128, 98, `900 56px Arial, ${ROUND}`, '#fff2f8');
  }), 1.1, 0.95, 1.5, -0.04, 3.25, 'out', 1.4, true);
  // ---- The pavement: the A-board with its balloons, a maid with flyers along from the tout ----
  k.box(0xfaf2f6, 3.0, 3.9, -1.32, -1.2, 0, 1.1);
  const board = k.canvas(300, 380, (g) => {
    g.fillStyle = '#fff4f9';
    g.fillRect(0, 0, 300, 380);
    g.strokeStyle = '#ff7fb8';
    g.lineWidth = 10;
    g.strokeRect(6, 6, 288, 368);
    text(g, '♡ぴゅあ♡', 150, 48, `900 46px ${ROUND}`, '#e8307a');
    text(g, 'めいどかふぇ 2F', 150, 96, `bold 28px ${ROUND}`, '#8a3cc8');
    const lines = ['萌え萌えオムライス ¥1,380', 'ラブ注入ドリンク ¥780', 'チェキ撮影 ¥800', 'ライブ 毎時00分♪', 'チャージ ¥660/h'];
    lines.forEach((l, i) => text(g, l, 150, 150 + i * 42, `bold 22px ${ROUND}`, '#5a2a44'));
    text(g, 'おかえりなさいませ♡', 150, 352, `bold 24px ${ROUND}`, '#e8307a');
  });
  k.plane(board, 0.86, 1.05, 3.45, -1.34, 0.56, 'out', 1.0);
  k.plane(board, 0.86, 1.05, 3.45, -1.18, 0.56, 'in', 1.0);
  for (const [du, hex] of [[-0.3, 0xff8ac0], [0.05, 0xffffff], [0.35, 0xc8a0ff]] as const) {
    k.post(0xdddddd, 3.45 + du * 0.4, -1.26, 1.1, 1.9 + du * 0.3, 0.006, 4);
    k.lathe(hex, 3.45 + du, -1.3, [[1.85, 0.001], [1.9, 0.12], [2.05, 0.17], [2.2, 0.15], [2.32, 0.001]], 10);
  }
  k.person(7.6, -1.7, -0.4, -1, { body: 'woman', pose: 'hold', outfit: 'maid', hair: 'bun', long: true, color: [0.15, 0.12, 0.2] });
}

/** The interior, built a slice at a time. */
export function* maidCafeInterior(b: Building3, city: THREE.Material, ghost: THREE.Material): Generator<void, Interior> {
  const k = new Kit(b);
  const d = new Draw(k);
  const { f2, ceil } = CAFE;
  const [la, lb] = CAFE.lane;

  // ---- The stair hall: walls, the vestibule, the flight with its lit nosings, the landing, posters ----
  d.W(0x6a5a64, la, lb, IN.t0, CAFE.flight[0], 0, 0.02);
  d.W(0xfff0f6, la, lb, IN.t0, CAFE.flight[0], 4.05, 4.1, true);
  d.W(0xf4e0e8, la, lb, IN.t0, CAFE.flight[0], 4.1, f2);
  d.W(PINK_WALL, 0.2, la, IN.t0, IN.t1, 0, ceil);
  d.W(PINK_WALL, CAFE.hall[0], CAFE.hall[1], IN.t0, IN.t1, 0, f2);
  d.W(PINK_WALL, CAFE.hall[0], CAFE.hall[1], IN.t0, CAFE.entry[0], f2, ceil);
  d.W(PINK_WALL, CAFE.hall[0], CAFE.hall[1], CAFE.entry[1], IN.t1, f2, ceil);
  d.W(PINK_WALL, CAFE.hall[0], CAFE.hall[1], CAFE.entry[0], CAFE.entry[1], f2 + 2.3, ceil);
  d.W(PINK_WALL, la, CAFE.door[0], 0, IN.t0, 0, 4.1);
  d.W(PINK_WALL, CAFE.door[1], lb, 0, IN.t0, 0, 4.1);
  d.W(PINK_WALL, CAFE.door[0], CAFE.door[1], 0, IN.t0, 2.5, 4.1);
  d.W(PINK_WALL, 0, CAFE.w, IN.t1, CAFE.d, 0, ceil);
  const n = 24;
  const tread = (CAFE.flight[1] - CAFE.flight[0]) / n;
  const rise = f2 / n;
  for (let i = 0; i < n; i++) {
    const t = CAFE.flight[0] + i * tread;
    d.W(i % 2 ? 0xe8c8d6 : 0xf0d2de, la, lb, t, t + tread, 0, (i + 1) * rise);
    d.glow([1.4, 0.7, 1.0], la, lb, t - 0.005, t + 0.02, (i + 1) * rise - 0.03, (i + 1) * rise - 0.005, EMIT.always);
  }
  d.W(0xe8c8d6, la, CAFE.hall[1], CAFE.flight[1], IN.t1, f2 - 0.25, f2);
  // A handrail on the hall wall, step by step.
  for (let i = 0; i < n; i += 2) {
    const t = CAFE.flight[0] + i * tread;
    d.W(0xffffff, lb - 0.08, lb - 0.02, t, t + tread * 2, (i + 1) * rise + 0.85, (i + 1) * rise + 0.9);
  }
  d.glow(LAMP, 1.3, 1.55, 7.0, 7.25, ceil - 0.7, ceil - 0.45);
  d.W(0xfff6fa, la, CAFE.hall[1], IN.t0, IN.t1, ceil, ceil + 0.1, true);
  const poster = (title: string, sub: string, bg: string, u: number, t: number, y: number, facing: '+u' | '-u'): void => {
    k.plane(k.canvas(300, 420, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, 300, 420);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      heart(g, 150, 180, 200);
      g.fill();
      text(g, title, 150, 160, `900 40px ${ROUND}`, '#d8306f');
      text(g, sub, 150, 340, `bold 26px ${ROUND}`, '#5a2a44');
    }), 0.6, 0.84, u, t, y, facing, 1.0);
  };
  poster('猫耳デー', '毎週金曜♡', '#ffd8ea', la + 0.01, 1.6, 1.6, '+u');
  poster('2F ↑', 'おかえりなさいませ', '#ffe9f3', lb - 0.01, 1.8, 1.6, '-u');
  poster('LIVE♪', '毎時00分', '#e8d8ff', la + 0.01, 6.5, 3.6, '+u');
  poster('チェキ', '¥800', '#d8f4ec', la + 0.01, 10.2, 5.4, '+u');
  yield;

  // ---- The café: floor (pink and white checks), walls with a white wainscot, the windows, the ceiling ----
  const u0 = CAFE.hall[1];
  d.W(WHITE, u0, IN.u1, IN.t0, IN.t1, f2 - 0.25, f2 - 0.01);
  d.W(WHITE, CAFE.hall[0], u0, CAFE.entry[0], CAFE.entry[1], f2 - 0.25, f2 - 0.01);
  for (let u = u0, i = 0; u < IN.u1 - 0.01; u += 0.5, i++)
    for (let t = IN.t0, j = 0; t < IN.t1 - 0.01; t += 0.5, j++) if ((i + j) % 2 === 0) d.W(0xf6b2cc, u, Math.min(u + 0.5, IN.u1), t, Math.min(t + 0.5, IN.t1), f2 - 0.01, f2);
  d.W(PINK_WALL, IN.u1, CAFE.w, IN.t0, IN.t1, f2, ceil);
  d.W(WHITE, IN.u1 - 0.06, IN.u1, IN.t0, IN.t1, f2, f2 + 1.0);
  d.W(WHITE, u0, u0 + 0.06, IN.t0, CAFE.entry[0], f2, f2 + 1.0);
  d.W(0xfff6fa, u0, IN.u1, IN.t0, IN.t1, ceil, ceil + 0.1, true);
  // The street wall: under and over the windows, the piers, mullions, the glass; lace curtains tied back, a valance.
  d.W(PINK_WALL, u0, IN.u1, 0, IN.t0, f2, 5.0);
  d.W(PINK_WALL, u0, IN.u1, 0, IN.t0, 6.9, ceil);
  d.W(PINK_WALL, u0, 3.2, 0, IN.t0, 5.0, 6.9);
  d.W(PINK_WALL, 9.4, IN.u1, 0, IN.t0, 5.0, 6.9);
  for (const u of [5.27, 7.33]) d.W(0xffffff, u - 0.05, u + 0.05, 0.05, 0.22, 5.0, 6.9);
  k.pane(3.2, 9.4, 5.0, 6.9, 0.12);
  for (const [a, b2] of [[3.2, 5.22], [5.32, 7.28], [7.38, 9.4]] as const) {
    d.W(0xfffafc, a, a + 0.32, 0.26, 0.34, 5.0, 6.85);
    d.W(0xfffafc, b2 - 0.32, b2, 0.26, 0.34, 5.0, 6.85);
  }
  d.W(0xf7b8d0, 3.1, 9.5, 0.26, 0.36, 6.7, 6.95);
  yield;

  // ---- Tables and chairs (pink and mint), food on the occupied ones; heart lamps over them ----
  const seated: { u: number; t: number; dt: number; who: Parameters<Draw['person']>[4] }[] = [];
  const guest = (body: 'man' | 'woman', outfit: 'plain' | 'otaku' | 'suit' | 'long', color: C3, hair: 'short' | 'long' | 'bun' | 'cap' = body === 'woman' ? 'long' : 'short'): Parameters<Draw['person']>[4] => ({ body, pose: 'sit', outfit, color, hair, long: outfit === 'long' });
  // Who sits where: [table, side (-1 the street side, facing in; 1 the back, facing the street), who].
  const sitting: [number, -1 | 1, Parameters<Draw['person']>[4]][] = [
    [0, -1, guest('man', 'otaku', [0.2, 0.22, 0.3])],
    [1, -1, guest('man', 'plain', [0.25, 0.2, 0.18])],
    [1, 1, guest('woman', 'plain', [0.3, 0.18, 0.22])],
    [2, 1, guest('man', 'otaku', [0.18, 0.2, 0.16], 'cap')],
    [4, -1, guest('woman', 'long', [0.22, 0.2, 0.28], 'bun')],
    [4, 1, guest('woman', 'plain', [0.28, 0.24, 0.2])],
    [5, -1, guest('man', 'suit', [0.15, 0.16, 0.2])],
  ];
  TABLES.forEach(([u, t], ti) => {
    d.lathe(0xd8c8d0, u, t, [[f2, 0.24], [f2 + 0.03, 0.22], [f2 + 0.05, 0.04], [f2 + 0.7, 0.04]], 10);
    d.W(WHITE, u - 0.4, u + 0.4, t - 0.4, t + 0.4, f2 + 0.7, f2 + 0.75);
    d.W(PINK, u - 0.41, u + 0.41, t - 0.41, t + 0.41, f2 + 0.68, f2 + 0.7);
    for (const side of [-1, 1] as const) {
      const tc = t + side * 0.75;
      const hex = (ti + (side > 0 ? 1 : 0)) % 2 ? MINT : 0xf7b3cf;
      d.W(0xd0c0c8, u - 0.03, u + 0.03, tc - 0.03, tc + 0.03, f2, f2 + 0.42);
      d.W(hex, u - 0.21, u + 0.21, tc - 0.21, tc + 0.21, f2 + 0.42, f2 + 0.46);
      const back = tc + side * 0.19;
      d.W(hex, u - 0.21, u + 0.21, Math.min(back, back + side * 0.04), Math.max(back, back + side * 0.04), f2 + 0.46, f2 + 0.95);
    }
    const here = sitting.filter((s) => s[0] === ti);
    for (const [, side, who] of here) {
      seated.push({ u, t: t + side * 0.75, dt: -side, who });
      // Their plate: omurice with a ketchup heart, and a pastel drink.
      const pt = t + side * 0.18;
      d.lathe(0xffffff, u - 0.08, pt, [[f2 + 0.75, 0.13], [f2 + 0.77, 0.14], [f2 + 0.775, 0.001]], 12);
      d.lathe(0xf2c040, u - 0.08, pt, [[f2 + 0.77, 0.001], [f2 + 0.79, 0.07], [f2 + 0.83, 0.075], [f2 + 0.85, 0.001]], 10);
      d.glow([0.9, 0.06, 0.08], u - 0.1, u - 0.06, pt - 0.02, pt + 0.02, f2 + 0.85, f2 + 0.86);
      d.lathe(ti % 2 ? 0xffb8d8 : 0xb8f0e0, u + 0.22, pt, [[f2 + 0.75, 0.035], [f2 + 0.9, 0.045], [f2 + 0.9, 0.001]], 8);
    }
    d.W(0xe8e0e4, u - 0.005, u + 0.005, t - 0.005, t + 0.005, ceil - 0.8, ceil);
    d.lathe(0, u, t, [[ceil - 1.0, 0.001], [ceil - 0.92, 0.12], [ceil - 0.82, 0.13], [ceil - 0.8, 0.001]], 10, EMIT.always, LAMP);
  });
  yield;

  // ---- The stage at the back: a step up, a lit edge, the live backdrop, a microphone, two spots ----
  d.W(DEEP, STAGE[0], STAGE[1], STAGE[2], STAGE[3], f2, f2 + 0.25);
  d.glow([1.8, 0.6, 1.2], STAGE[0] - 0.01, STAGE[0] + 0.02, STAGE[2], STAGE[3], f2 + 0.2, f2 + 0.24);
  d.glow([1.8, 0.6, 1.2], STAGE[0], STAGE[1], STAGE[2] - 0.01, STAGE[2] + 0.02, f2 + 0.2, f2 + 0.24);
  k.plane(k.canvas(640, 500, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 500);
    sky.addColorStop(0, '#ff9ecf');
    sky.addColorStop(1, '#b48cff');
    g.fillStyle = sky;
    g.fillRect(0, 0, 640, 500);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, r] of [[90, 90, 60], [560, 120, 70], [140, 400, 50], [520, 400, 56], [320, 70, 34]] as const) {
      heart(g, x, y, r * 1.6);
      g.fill();
    }
    g.fillStyle = '#ffe45f';
    for (let i = 0; i < 26; i++) {
      const x = (i * 197) % 640;
      const y = (i * 113) % 500;
      g.beginPath();
      for (let p = 0; p < 10; p++) {
        const a = (p / 10) * Math.PI * 2 - Math.PI / 2;
        const r = p % 2 ? 4 : 10;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.fill();
    }
    neonText(g, '♡ LIVE STAGE ♡', 320, 210, `900 76px ${ROUND}`, '#ff3f9a');
    text(g, 'ぴゅあ☆らいぶ', 320, 300, `900 52px ${ROUND}`, '#ffffff');
  }), 2.9, 2.25, IN.u1 - 0.02, (STAGE[2] + STAGE[3]) / 2, f2 + 1.75, '-u', 1.15);
  d.W(0x2a2a2e, 8.4, 8.44, 10.9, 10.94, f2 + 0.25, f2 + 1.5);
  d.ball(0x2a2a2e, 8.42, 10.92, f2 + 1.5, 0.04);
  for (const t of [STAGE[2] + 0.4, STAGE[3] - 0.4]) {
    d.W(0x2a2a2e, STAGE[0] + 0.2, STAGE[0] + 0.4, t - 0.1, t + 0.1, ceil - 0.3, ceil);
    d.glow([2.2, 1.6, 2.0], STAGE[0] + 0.22, STAGE[0] + 0.38, t - 0.08, t + 0.08, ceil - 0.33, ceil - 0.3);
  }

  // ---- The counter and the kitchen behind it; the menu board; the register ----
  d.W(WHITE, COUNTER[0], COUNTER[1], COUNTER[2], COUNTER[3], f2, f2 + 1.05);
  d.W(PINK, COUNTER[0] - 0.05, COUNTER[1], COUNTER[2] - 0.05, COUNTER[3] + 0.05, f2 + 1.05, f2 + 1.1);
  for (let u = COUNTER[0] + 0.3; u < COUNTER[1] - 0.3; u += 0.9) d.W(0xf6b2cc, u, u + 0.6, COUNTER[2] - 0.01, COUNTER[2], f2 + 0.2, f2 + 0.85);
  d.W(WHITE, KITCHEN_END[0], KITCHEN_END[1], KITCHEN_END[2], KITCHEN_END[3], f2, f2 + 1.05);
  d.W(PINK, KITCHEN_END[0] - 0.05, KITCHEN_END[1] + 0.05, KITCHEN_END[2] - 0.05, KITCHEN_END[3], f2 + 1.05, f2 + 1.1);
  d.W(0x3a3a40, 5.7, 6.2, 13.75, 14.15, f2 + 1.1, f2 + 1.35);
  d.glow([0.6, 1.4, 1.0], 5.75, 6.15, 13.74, 13.76, f2 + 1.2, f2 + 1.32);
  // The back wall: shelves of syrups and glasses, the drinks machine.
  for (const y of [f2 + 1.2, f2 + 1.7]) {
    d.W(WHITE, 5.5, IN.u1, IN.t1 - 0.3, IN.t1, y, y + 0.04);
    for (let u = 5.7, i = 0; u < IN.u1 - 0.2; u += 0.22, i++)
      d.lathe(0, u, IN.t1 - 0.15, [[y + 0.04, 0.04], [y + 0.24, 0.04], [y + 0.3, 0.015]], 6, EMIT.always, (i % 3 === 0 ? [1.2, 0.4, 0.7] : i % 3 === 1 ? [0.5, 1.1, 0.9] : [1.2, 1.0, 0.4]) as C3);
  }
  d.W(0xc8c8cc, 8.6, 9.5, IN.t1 - 0.6, IN.t1, f2, f2 + 1.1);
  d.glow([1.4, 1.4, 1.5], 8.7, 9.4, IN.t1 - 0.61, IN.t1 - 0.6, f2 + 0.7, f2 + 1.0);
  k.plane(k.canvas(720, 340, (g) => {
    g.fillStyle = '#fff6fa';
    g.fillRect(0, 0, 720, 340);
    g.strokeStyle = '#ff7fb8';
    g.lineWidth = 10;
    g.strokeRect(6, 6, 708, 328);
    text(g, '♡ めにゅー ♡', 360, 44, `900 40px ${ROUND}`, '#e8307a');
    const items: [string, string][] = [['萌え萌えオムライス', '¥1,380'], ['ふわふわパンケーキ', '¥1,180'], ['ラブ注入ドリンク', '¥780'], ['チェキ撮影 (1枚)', '¥800'], ['ライブ鑑賞', '¥500'], ['チャージ料 (1時間)', '¥660']];
    items.forEach(([a, p], i) => {
      text(g, a, 60, 100 + i * 40, `bold 28px ${ROUND}`, '#5a2a44', 'left');
      text(g, p, 660, 100 + i * 40, `bold 28px ${ROUND}`, '#8a3cc8', 'right');
    });
  }), 3.4, 1.6, 7.55, IN.t1 - 0.02, f2 + 2.45, 'out', 1.05);
  // The podium by the door, its little sign facing whoever comes in.
  d.W(WHITE, PODIUM[0], PODIUM[1], PODIUM[2], PODIUM[3], f2, f2 + 1.1);
  d.W(PINK, PODIUM[0] - 0.03, PODIUM[1] + 0.03, PODIUM[2] - 0.03, PODIUM[3] + 0.03, f2 + 1.1, f2 + 1.14);
  k.plane(k.canvas(256, 160, (g) => {
    g.fillStyle = '#ffe4ef';
    g.fillRect(0, 0, 256, 160);
    text(g, 'おかえりなさいませ', 128, 60, `bold 26px ${ROUND}`, '#d8306f');
    text(g, 'ご主人様♡', 128, 108, `900 34px ${ROUND}`, '#d8306f');
  }), 0.55, 0.34, PODIUM[0] - 0.01, (PODIUM[2] + PODIUM[3]) / 2, f2 + 0.75, '-u', 1.0);
  // Hearts strung over the doorway from the landing.
  for (let t = CAFE.entry[0] + 0.2; t < CAFE.entry[1]; t += 0.35) d.glow([1.8, 0.5, 1.0], u0 + 0.01, u0 + 0.05, t, t + 0.12, f2 + 2.38 + 0.08 * Math.sin(t * 6), f2 + 2.48 + 0.08 * Math.sin(t * 6));
  yield;

  // ---- The walls' decoration: the neon name, the cheki board, the plush shelf, string lights ----
  k.plane(k.canvas(600, 180, (g) => {
    g.fillStyle = '#1a0812';
    g.fillRect(0, 0, 600, 180);
    neonText(g, '♡ぴゅあ♡', 300, 92, `900 110px ${ROUND}`, '#ff5fa8');
  }), 2.6, 0.78, u0 + 0.01, 5.2, f2 + 2.1, '+u', 1.4);
  k.plane(k.canvas(420, 300, (g) => {
    g.fillStyle = '#c89a6a';
    g.fillRect(0, 0, 420, 300);
    text(g, '今日のチェキ♡', 210, 26, `bold 26px ${ROUND}`, '#ffffff');
    for (let i = 0; i < 12; i++) {
      const x = 20 + (i % 4) * 100 + ((i * 7) % 9);
      const y = 52 + Math.floor(i / 4) * 80 + ((i * 5) % 7);
      g.fillStyle = '#ffffff';
      g.fillRect(x, y, 78, 72);
      g.fillStyle = ['#ffb8d8', '#b8e0ff', '#ffe8a8', '#d8c8ff'][i % 4];
      g.fillRect(x + 6, y + 6, 66, 48);
      g.fillStyle = '#2a1a24';
      g.beginPath();
      g.arc(x + 39, y + 30, 11, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x + 25, y + 40, 28, 14);
      g.fillStyle = '#ff5fa8';
      heart(g, x + 62, y + 63, 14);
      g.fill();
    }
  }), 1.6, 1.15, u0 + 0.01, 9.9, f2 + 1.65, '+u', 1.0);
  d.W(WHITE, SHELF[0], SHELF[1], SHELF[2], SHELF[3], f2 + 1.3, f2 + 1.34);
  d.W(WHITE, SHELF[0], SHELF[1], SHELF[2], SHELF[3], f2, f2 + 0.9);
  const PLUSH = [0xffc8e0, 0xc8e8ff, 0xfff0b0, 0xe0d0ff, 0xffffff, 0xb8f0d8];
  for (let t = SHELF[2] + 0.25, i = 0; t < SHELF[3]; t += 0.42, i++) {
    d.ball(PLUSH[i % PLUSH.length], 9.6, t, f2 + 1.34, 0.11);
    d.ball(PLUSH[i % PLUSH.length], 9.6, t, f2 + 1.52, 0.08);
    d.ball(PLUSH[(i + 2) % PLUSH.length], 9.6, t + 0.05, f2 + 0.9, 0.12);
  }
  for (let u = u0 + 0.4; u < IN.u1; u += 0.45)
    for (const t of [3.35, 6.25, 9.15]) d.glow(u % 0.9 < 0.45 ? [1.9, 0.9, 1.3] : [1.6, 1.5, 1.0], u, u + 0.06, t, t + 0.06, ceil - 0.12 - 0.06 * Math.sin(u * 3), ceil - 0.06 - 0.06 * Math.sin(u * 3));
  yield;

  // ---- People: the maids (one sings, one serves, one does the spell at a table, one at the counter) and the
  // masters at their tables. (The one greeting at the door is the story's: the npc `maid`.) ----
  d.level = f2 - 0.15;
  const maid = (u: number, t: number, du: number, dt: number, pose: 'stand' | 'wave' | 'hold' | 'talk', hair: 'long' | 'bun', up = 0): void =>
    k.person(u, t, du, dt, { y: f2 - 0.15 + up, body: 'woman', pose, outfit: 'maid', hair, long: true, color: [0.12, 0.1, 0.16] });
  maid(8.7, 11.1, -0.6, -1, 'wave', 'long', 0.25);
  maid(5.9, 6.3, 1, -0.5, 'hold', 'bun');
  maid(5.0, 1.9, -1, 0, 'wave', 'long');
  maid(7.6, 15.0, 0, -1, 'stand', 'bun');
  for (const p of seated) d.person(p.u, p.t, 0, p.dt, p.who);

  const group = k.finish(city, ghost);
  group.visible = false;
  return { group, ...maidCafeLayout(b) };
}
