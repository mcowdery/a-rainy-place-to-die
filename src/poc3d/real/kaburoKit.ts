import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { addDressing } from './dressing';
import { Draw, type C3 } from './interiorDraw';
import { Kit, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toWorld } from './localFrame';
import { EMIT } from './meshBuilder';
import { buildZakkyo, zakkyoColliders, zakkyoLights, zakkyoShelters } from './cashOne';

/**
 * Kaburo's kit set pieces (registered with the kit landmarks in asagiri.ts), in the building's local frame (u
 * along the street face from its left end as seen from the street, t inward):
 * - koban: 歌舞路交番, Kaburo's police box on the corner of the square across the crossing from the mega-sign (the
 *   kōban of spring's chapter 3, "Papers"). A two-storey box in dark granite and white tile with a round clock
 *   tower on its corner, the red lamp over the door, the 交番 KOBAN fascia and the police emblem; the wanted
 *   posters (指名手配) and the traffic accident tally on its side wall, the area map on a stand, two police
 *   bicycles. You walk straight in (no interior switch: the room is part of the landmark, lit, and its walls and
 *   counter are its collision): the front room with the counter and its bell, a bench and the crime-prevention
 *   posters; behind the counter the desks (an officer at one), the steel cabinets, lost property, the duty board.
 * - zakkyo: the back alleys' mixed-tenant building with 質 マルヨシ (the pawn shop) at street level and キャッシュ・ワン
 *   (Cash One, the loan shark) on the third floor, walk-in (cashOne.ts).
 */
export const KABURO_KIT_KINDS = ['koban', 'zakkyo'] as const;
export type KaburoKitKind = (typeof KABURO_KIT_KINDS)[number];

/** The kōban's plan (local metres): 8 m along the front, 7 deep; the tower's corner; the room; the door. */
export const KOBAN = {
  w: 8,
  d: 7,
  tower: 2.4,
  room: { u0: 2.4, u1: 7.75, t0: 0.25, t1: 6.75 },
  door: [3.0, 4.8] as const,
  window: [5.2, 7.5] as const,
  counter: [3.4, 4.0] as const,
  bench: [6.9, 7.7, 1.0, 2.6] as const,
  ceil: 3.0,
  top: 6.0,
} as const;

type R4 = readonly [number, number, number, number];

/** Street-level collision: the tower and the store behind it, the walls (the door open), the counter, the bench, the bicycles and the map stand outside. */
function kobanRects(): R4[] {
  const { w, d, tower, room, door, counter, bench } = KOBAN;
  return [
    [0, tower, 0, tower],
    [0, room.u0, tower, d],
    [room.u0, door[0], 0, room.t0],
    [door[1], w, 0, room.t0],
    [room.u1, w, 0, d],
    [room.u0, w, room.t1, d],
    [room.u0, room.u1, counter[0], counter[1]],
    bench,
    [w + 0.05, w + 1.0, 0.5, 2.3],
    [9.6, 10.6, -1.3, -0.8],
  ];
}

export function kaburoKitColliders(kind: KaburoKitKind, b: Building3): Rect[] {
  const f = localFrame(b);
  switch (kind) {
    case 'koban':
      return kobanRects().map((r) => localRect(f, r[0], r[1], r[2], r[3]));
    case 'zakkyo':
      return zakkyoColliders(b);
  }
}

export function kaburoKitShelters(kind: KaburoKitKind, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  switch (kind) {
    case 'koban': {
      const { room, ceil } = KOBAN;
      return [
        { rect: localRect(f, room.u0, room.u1, room.t0, room.t1), y0: 0, y1: ceil, enclosed: true },
        { rect: localRect(f, room.u0, 6.0, -1.2, room.t0), y0: 0, y1: 2.8, enclosed: false },
      ];
    }
    case 'zakkyo':
      return zakkyoShelters(b);
  }
}

export function kaburoKitLights(kind: KaburoKitKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  switch (kind) {
    case 'koban':
      return [L(4.6, -1.6, 7, [0.95, 0.97, 1.0], 0.85), L(1.2, -0.8, 3.5, [1.0, 0.15, 0.1], 0.6), L(6.3, -1.2, 4, [0.95, 0.97, 1.0], 0.45)];
    case 'zakkyo':
      return zakkyoLights(b);
  }
}

/** The police emblem: a gold sunburst star (the HQ's, asagiri.ts) on a canvas of `size`, transparent round it. */
export function policeEmblem(g: CanvasRenderingContext2D, size: number): void {
  const s = size / 400;
  g.save();
  g.translate(size / 2, size / 2);
  g.scale(s, s);
  g.fillStyle = '#b89030';
  for (let i = 0; i < 20; i++) {
    g.rotate(Math.PI / 10);
    g.beginPath();
    g.moveTo(0, -30);
    g.lineTo(i % 2 ? 22 : 30, i % 2 ? -150 : -190);
    g.lineTo(-(i % 2 ? 22 : 30), i % 2 ? -150 : -190);
    g.fill();
  }
  g.fillStyle = '#e8c860';
  g.beginPath();
  g.arc(0, 0, 70, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f4f0e0';
  g.beginPath();
  g.arc(0, 0, 36, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Kaburo's streets, drawn small: the area map on the stand outside and on the wall inside. */
function areaMap(g: CanvasRenderingContext2D, W: number, H: number): void {
  g.fillStyle = '#f2efe4';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1a3a6a';
  g.fillRect(0, 0, W, H * 0.12);
  text(g, '地域案内図  AREA MAP  歌舞路', W / 2, H * 0.06, `bold ${Math.round(H * 0.07)}px 'Yu Gothic', sans-serif`, '#ffffff');
  const x = (v: number): number => W * (0.06 + v * 0.88);
  const y = (v: number): number => H * (0.17 + v * 0.78);
  // Blocks, then the streets over them: the avenue (夜霧通り) across, the crossing's boulevard down, side streets.
  g.fillStyle = '#d8d2c0';
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) g.fillRect(x(i * 0.2 + 0.015), y(j * 0.25 + 0.02), W * 0.88 * 0.17, H * 0.78 * 0.21);
  g.fillStyle = '#ffffff';
  for (let i = 0; i <= 5; i++) g.fillRect(x(i * 0.2) - 3, y(0), 6, H * 0.78);
  for (let j = 0; j <= 4; j++) g.fillRect(x(0), y(j * 0.25) - 3, W * 0.88, 6);
  g.fillStyle = '#f4c860';
  g.fillRect(x(0), y(0.5) - 9, W * 0.88, 18);
  g.fillRect(x(0.6) - 7, y(0), 14, H * 0.78);
  const label = (s: string, u: number, v: number, c = '#2a2a2a'): void => text(g, s, x(u), y(v), `bold ${Math.round(H * 0.045)}px 'Yu Gothic', sans-serif`, c);
  label('夜霧通り Yogiri-dōri', 0.25, 0.46);
  label('歌舞路交差点', 0.72, 0.43);
  label('ヤスイチ', 0.5, 0.36);
  label('ヨルマート', 0.72, 0.62);
  label('歌舞路稲荷', 0.25, 0.12);
  label('ホテル ルージュ', 0.85, 0.12);
  label('歌舞路駅 →', 0.12, 0.88);
  // You are here (現在地), on the square's corner.
  g.fillStyle = '#d82020';
  g.beginPath();
  g.arc(x(0.585), y(0.56), H * 0.03, 0, Math.PI * 2);
  g.fill();
  label('現在地', 0.5, 0.66, '#d82020');
}

/** A poster on canvas: a headline, a picture block and a line under it. */
function poster(k: Kit, title: string, sub: string, bg: string, fg: string, draw?: (g: CanvasRenderingContext2D, W: number, H: number) => void): THREE.Texture {
  return k.canvas(300, 420, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 300, 420);
    text(g, title, 150, 60, "900 44px 'Yu Gothic', sans-serif", fg);
    draw?.(g, 300, 420);
    text(g, sub, 150, 380, "bold 24px 'Yu Gothic', sans-serif", fg);
  });
}

export const KABURO_KIT_BUILDERS: Record<KaburoKitKind, (k: Kit, id: string, part: (name: string) => Kit) => void> = {
  zakkyo: buildZakkyo,
  koban(k) {
    const d = new Draw(k);
    const { w, d: depth, tower, room, door, window: win, counter, bench, ceil, top } = KOBAN;
    const GRANITE = 0x4e4e54;
    const TILE = 0xe6e2d8;
    const CREAM = 0xe8e4d6;
    // ---- The block: dark granite below, white tile above, a parapet; the store behind the tower ----
    k.box(GRANITE, 0, room.u0, tower, depth, 0, ceil + 0.1);
    k.box(GRANITE, room.u0, door[0], 0, room.t0, 0, ceil + 0.1);
    k.box(GRANITE, door[1], win[0], 0, room.t0, 0, ceil + 0.1);
    k.box(GRANITE, win[0], win[1], 0, room.t0, 0, 0.9);
    k.box(GRANITE, win[0], win[1], 0, room.t0, 2.6, ceil + 0.1);
    k.box(GRANITE, win[1], w, 0, room.t0, 0, ceil + 0.1);
    k.box(GRANITE, door[0], door[1], 0, room.t0, 2.45, ceil + 0.1);
    k.box(GRANITE, room.u1, w, room.t0, depth, 0, ceil + 0.1);
    k.box(GRANITE, room.u0, room.u1, room.t1, depth, 0, ceil + 0.1);
    k.box(TILE, room.u0, w, 0, depth, ceil + 0.1, top);
    k.box(TILE, tower * 0.5, room.u0, tower, depth, ceil + 0.1, top);
    k.box(0x3a3a40, room.u0 - 0.05, w + 0.05, -0.05, depth + 0.05, top, top + 0.3);
    k.box(0x8a8a90, 6.2, 7.2, 4.5, 5.6, top, top + 0.8);
    k.post(0x9a9ea2, 3.2, 5.8, top, top + 3.2, 0.03, 6);
    // Second-floor windows (the rest room upstairs), blinds lit at night, on the front and the side.
    for (const [a, b2] of [[3.0, 4.5], [5.4, 7.4]] as const) {
      k.box(0x2a2a2e, a - 0.06, b2 + 0.06, -0.06, 0.02, 3.95, 5.25);
      k.lit(0xa89c88, a, b2, -0.07, -0.05, 4.0, 5.2);
      for (let y = 4.12; y < 5.2; y += 0.12) k.box(0x5a544c, a, b2, -0.085, -0.07, y, y + 0.025);
    }
    for (const [a, b2] of [[1.2, 3.0], [4.0, 5.8]] as const) {
      k.box(0x2a2a2e, w - 0.02, w + 0.06, a - 0.06, b2 + 0.06, 3.95, 5.25);
      k.lit(0xa89c88, w + 0.05, w + 0.07, a, b2, 4.0, 5.2);
      for (let y = 4.12; y < 5.2; y += 0.12) k.box(0x5a544c, w + 0.07, w + 0.085, a, b2, y, y + 0.025);
    }
    // ---- The tower: brick below, white above, a cornice, a slate cone; the clocks; slit windows ----
    const tc = tower / 2;
    k.lathe(0x6e3226, tc, tc, [[0, tc], [3.3, tc]], 24);
    k.lathe(0xc4beb2, tc, tc, [[3.3, tc], [3.3, tc + 0.06], [3.42, tc + 0.06], [3.42, tc - 0.04], [7.0, tc - 0.04]], 24);
    k.lathe(0x3a3a40, tc, tc, [[7.0, tc - 0.04], [7.0, tc + 0.12], [7.22, tc + 0.12], [7.22, tc + 0.06], [8.9, 0.04]], 24);
    for (const y of [4.3, 5.2]) k.glow([0.75, 0.68, 0.55], tc - 0.08, tc + 0.08, -0.02, 0.06, y, y + 0.45, EMIT.lamp);
    const clock = k.canvas(256, 256, (g) => {
      g.clearRect(0, 0, 256, 256);
      g.fillStyle = '#f8f6ee';
      g.strokeStyle = '#2a2a2e';
      g.lineWidth = 14;
      g.beginPath();
      g.arc(128, 128, 118, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#2a2a2e';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.fillRect(128 + Math.sin(a) * 92 - 4, 128 - Math.cos(a) * 92 - 4, 8, 8);
      }
      g.lineCap = 'round';
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.sin(-0.5) * 55, 128 - Math.cos(-0.5) * 55);
      g.moveTo(128, 128);
      g.lineTo(128 + Math.sin(1.4) * 85, 128 - Math.cos(1.4) * 85);
      g.stroke();
    });
    for (const m of [k.plane(clock, 0.95, 0.95, tc, -0.05, 6.2, 'out', 1.1), k.plane(clock, 0.95, 0.95, -0.05, tc, 6.2, '-u', 1.1)]) {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.transparent = true;
      mat.alphaTest = 0.5;
    }
    // ---- The front: the canopy over the door with its downlights, the fascia, the emblem, the red lamp ----
    k.box(0x2a2a30, room.u0, 6.0, -1.2, 0, 2.8, 2.95);
    for (const u of [3.3, 4.5, 5.6]) k.glow([1.8, 1.8, 1.7], u - 0.12, u + 0.12, -0.75, -0.5, 2.78, 2.8, EMIT.lamp);
    k.plane(k.canvas(640, 96, (g) => {
      g.fillStyle = '#1a2a5a';
      g.fillRect(0, 0, 640, 96);
      text(g, '歌舞路交番', 220, 50, "bold 60px 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff');
      text(g, 'KOBAN', 500, 52, "900 54px Arial, sans-serif", '#ffffff');
    }), 4.4, 0.66, 5.2, -0.04, 3.45, 'out', 1.25);
    (k.plane(k.canvas(200, 200, (g) => policeEmblem(g, 200)), 0.8, 0.8, 4.95, -0.04, 4.6, 'out', 1.1).material as THREE.MeshBasicMaterial).transparent = true;
    // The red lamp (赤色灯) on its bracket from the tower, over the door's corner, lit day and night.
    k.box(0x2a2a30, tc - 0.05, tc + 0.05, -0.45, 0.1, 3.55, 3.62);
    d.lathe(0, tc, -0.45, [[3.62, 0.001], [3.66, 0.12], [3.82, 0.16], [4.0, 0.12], [4.06, 0.001]], 14, EMIT.always, [1.1, 0.02, 0.01]);
    // The door (its glass leaves slid aside) and the window, framed in steel.
    for (const u of [door[0], door[1]]) k.box(0x8a8e94, u - 0.05, u + 0.05, 0.05, room.t0, 0, 2.45);
    k.pane(door[1], door[1] + 0.9, 0, 2.4, 0.09);
    k.pane(door[1] + 0.05, door[1] + 0.95, 0, 2.4, 0.17);
    k.pane(win[0], win[1], 0.9, 2.6, 0.13);
    k.box(0x8a8e94, win[0], win[1], 0.0, room.t0, 0.86, 0.9);
    // ---- The side wall on the square: the wanted posters, the accident tally; the bicycles below ----
    k.plane(k.canvas(640, 400, (g) => {
      g.fillStyle = '#f4f0e4';
      g.fillRect(0, 0, 640, 400);
      g.fillStyle = '#c81818';
      g.fillRect(0, 0, 640, 64);
      text(g, '指名手配  WANTED', 320, 34, "900 44px 'Yu Gothic', sans-serif", '#ffffff');
      for (let i = 0; i < 8; i++) {
        const cx = 20 + (i % 4) * 152;
        const cy = 78 + Math.floor(i / 4) * 152;
        g.fillStyle = '#d8d4c8';
        g.fillRect(cx, cy, 140, 140);
        g.fillStyle = '#3a3a3e';
        g.beginPath();
        g.arc(cx + 70, cy + 52, 28, 0, Math.PI * 2);
        g.fill();
        g.fillRect(cx + 30, cy + 82, 80, 40);
        text(g, ['強盗致傷', '殺人', '詐欺', '放火', '強盗', '殺人未遂', '誘拐', '傷害'][i], cx + 70, cy + 130, "bold 20px 'Yu Gothic', sans-serif", '#1a1a1a');
      }
      text(g, '情報提供は110番へ  懸賞金 上限300万円', 320, 388, "bold 22px 'Yu Gothic', sans-serif", '#c81818');
    }), 2.4, 1.5, w + 0.03, 3.6, 1.65, '+u', 1.0);
    k.plane(k.canvas(300, 300, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 300, 300);
      g.strokeStyle = '#1a3a8a';
      g.lineWidth = 10;
      g.strokeRect(5, 5, 290, 290);
      text(g, '交通事故発生状況', 150, 40, "bold 30px 'Yu Gothic', sans-serif", '#1a3a8a');
      text(g, '昨日', 70, 110, "bold 30px 'Yu Gothic', sans-serif", '#1a1a1a');
      text(g, '死者 0人', 190, 95, "bold 28px 'Yu Gothic', sans-serif", '#c81818');
      text(g, '負傷者 14人', 190, 135, "bold 28px 'Yu Gothic', sans-serif", '#1a1a1a');
      text(g, '本年', 70, 210, "bold 30px 'Yu Gothic', sans-serif", '#1a1a1a');
      text(g, '死者 37人', 190, 195, "bold 28px 'Yu Gothic', sans-serif", '#c81818');
      text(g, '負傷者 9,812人', 190, 235, "bold 26px 'Yu Gothic', sans-serif", '#1a1a1a');
      text(g, '東都警視庁', 150, 278, "bold 22px 'Yu Gothic', sans-serif", '#1a3a8a');
    }), 1.0, 1.0, w + 0.03, 5.6, 1.7, '+u', 1.0);
    for (const t of [0.95, 1.85]) {
      const [x, z] = toWorld(k.f, w + 0.55, t);
      addDressing(k.mb, { kind: 'bike', x, z, nx: k.f.r[0], nz: k.f.r[2], radius: 0.35, variant: 4 });
    }
    // The area map on its stand by the square.
    k.post(0x5a5e64, 9.75, -1.05, 0, 1.0, 0.04, 6);
    k.post(0x5a5e64, 10.45, -1.05, 0, 1.0, 0.04, 6);
    k.box(0x3a3e44, 9.6, 10.6, -1.12, -0.98, 0.95, 2.05);
    k.plane(k.canvas(512, 480, (g) => areaMap(g, 512, 480)), 0.94, 0.88, 10.1, -1.13, 1.5, 'out', 1.0);

    // ---- The front room, lit: floor, walls, ceiling and its tubes ----
    k.lit(0x8a8c88, room.u0, room.u1, room.t0, room.t1, 0, 0.02, true);
    k.lit(CREAM, room.u0, room.u0 + 0.05, room.t0, room.t1, 0.02, ceil, true);
    k.lit(CREAM, room.u1 - 0.05, room.u1, room.t0, room.t1, 0.02, ceil, true);
    k.lit(CREAM, room.u0, room.u1, room.t1 - 0.05, room.t1, 0.02, ceil, true);
    k.lit(CREAM, room.u0, door[0], room.t0, room.t0 + 0.05, 0.02, ceil, true);
    k.lit(CREAM, door[1], win[0], room.t0, room.t0 + 0.05, 0.02, ceil, true);
    k.lit(CREAM, win[0], room.u1, room.t0, room.t0 + 0.05, 0.02, 0.9, true);
    k.lit(CREAM, win[1], room.u1, room.t0, room.t0 + 0.05, 0.9, ceil, true);
    k.lit(CREAM, door[0], win[1], room.t0, room.t0 + 0.05, 2.6, ceil, true);
    k.lit(0xf4f4f0, room.u0, room.u1, room.t0, room.t1, ceil - 0.05, ceil, true, true);
    for (const t of [1.6, 5.0]) k.glow([1.7, 1.75, 1.8], 3.2, 6.8, t - 0.08, t + 0.08, ceil - 0.08, ceil - 0.05);
    // The counter: its bell and the sign by it, a pen on a chain, the forms tray.
    k.lit(0xd8d4c8, room.u0, room.u1, counter[0], counter[1], 0.02, 1.0, true);
    k.lit(0x6a5a48, room.u0, room.u1, counter[0] - 0.05, counter[1] + 0.05, 1.0, 1.05, true);
    d.lathe(0xc8a040, 5.0, 3.6, [[1.05, 0.06], [1.08, 0.06], [1.12, 0.045], [1.16, 0.001]], 10);
    k.plane(k.canvas(320, 160, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 320, 160);
      text(g, 'ご用の方は', 160, 42, "bold 30px 'Yu Gothic', sans-serif", '#1a1a1a');
      text(g, 'ベルを押してください', 160, 88, "bold 30px 'Yu Gothic', sans-serif", '#1a1a1a');
      text(g, 'PLEASE RING THE BELL', 160, 132, "bold 22px Arial, sans-serif", '#1a3a8a');
    }), 0.42, 0.21, 5.6, counter[0] + 0.12, 1.18, 'out', 1.0);
    k.lit(0xe8e8e0, 3.4, 3.9, 3.5, 3.85, 1.05, 1.09, true);
    // The visitors' side: the bench, the leaflet rack, the posters (fraud calls, gropers, the police mascot).
    k.lit(0x8a6a4a, bench[0], bench[1], bench[2], bench[3], 0.42, 0.47, true);
    k.lit(0x5a5a60, bench[0] + 0.1, bench[1] - 0.1, bench[2] + 0.1, bench[3] - 0.1, 0.02, 0.42, true);
    k.lit(0xc8c8c4, room.u0 + 0.05, room.u0 + 0.3, 0.6, 1.5, 0.7, 1.6, true);
    for (let y = 0.8; y < 1.55; y += 0.25) for (const [t, hex] of [[0.7, 0xe86a6a], [1.0, 0x6a9ae8], [1.3, 0xe8c86a]] as const) k.lit(hex, room.u0 + 0.28, room.u0 + 0.31, t, t + 0.2, y, y + 0.2, true);
    const posterAt = (tex: THREE.Texture, t: number): void => void k.plane(tex, 0.55, 0.77, room.u1 - 0.06, t, 1.75, '-u', 1.0);
    posterAt(poster(k, '詐欺に注意!', '「オレだよ」電話は詐欺!', '#fff04a', '#c81818', (g) => {
      g.fillStyle = '#1a1a1a';
      g.fillRect(100, 120, 100, 180);
      g.fillStyle = '#c81818';
      g.font = "900 120px 'Yu Gothic', sans-serif";
      g.textAlign = 'center';
      g.fillText('✕', 150, 260);
    }), 1.4);
    posterAt(poster(k, 'STOP 痴漢', '見たら・あったら すぐ110番', '#ffe4f0', '#d82a6a', (g) => {
      g.fillStyle = '#d82a6a';
      g.beginPath();
      g.arc(150, 210, 90, 0, Math.PI * 2);
      g.fill();
      text(g, 'STOP', 150, 212, "900 54px Arial, sans-serif", '#ffffff');
    }), 2.2);
    posterAt(poster(k, 'トートくん', '東都の安全を守ります', '#d8ecff', '#1a3a8a', (g) => {
      g.fillStyle = '#f8c040';
      g.beginPath();
      g.arc(150, 200, 80, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1a3a8a';
      g.fillRect(85, 120, 130, 40);
      g.fillStyle = '#1a1a1a';
      for (const ex of [122, 178]) {
        g.beginPath();
        g.arc(ex, 200, 10, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#1a1a1a';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(150, 225, 26, 0.2, Math.PI - 0.2);
      g.stroke();
    }), 3.0);
    // The area map on the inner wall, over the leaflets.
    k.plane(k.canvas(512, 480, (g) => areaMap(g, 512, 480)), 1.5, 1.4, room.u0 + 0.06, 2.3, 1.9, '+u', 1.0);
    // ---- Behind the counter: two desks with a monitor, a phone and the radio; the cabinets, lost property, the
    // duty board, a clock ----
    for (const [a, b2] of [[3.0, 4.6], [5.2, 6.8]] as const) {
      k.lit(0xb8b4a8, a, b2, 4.9, 5.7, 0.72, 0.76, true);
      k.lit(0x9a968a, a + 0.05, b2 - 0.05, 5.45, 5.7, 0.02, 0.72, true);
      k.lit(0x2a2a2e, a + 0.3, a + 0.75, 5.35, 5.45, 0.76, 1.12, true);
      k.glow([0.45, 0.6, 0.75], a + 0.32, a + 0.73, 5.34, 5.35, 0.8, 1.1);
      k.lit(0xe8e8e0, b2 - 0.5, b2 - 0.25, 5.1, 5.35, 0.76, 0.84, true);
      k.lit(0x2a2a2e, (a + b2) / 2 - 0.25, (a + b2) / 2 + 0.25, 6.0, 6.45, 0.45, 0.5, true);
      k.lit(0x2a2a2e, (a + b2) / 2 - 0.25, (a + b2) / 2 + 0.25, 6.4, 6.45, 0.5, 1.0, true);
    }
    k.lit(0x2a2a2e, 6.2, 6.6, 5.0, 5.3, 0.76, 0.98, true);
    k.glow([0.3, 1.4, 0.4], 6.25, 6.32, 4.99, 5.0, 0.9, 0.94);
    for (let u = 5.3; u < 7.5; u += 0.55) {
      k.lit(0x8a9098, u, u + 0.5, 6.35, room.t1 - 0.05, 0.02, 1.9, true);
      k.lit(0x6a7078, u + 0.22, u + 0.28, 6.34, 6.35, 0.8, 1.1, true);
    }
    for (let u = 2.6, i = 0; u < 4.6; u += 0.16, i++) d.lathe([0x2a2a2e, 0x6a2a2a, 0x1a3a6a, 0xc8c8c4][i % 4], u, 6.5, [[0.02, 0.025], [0.85, 0.02], [0.9, 0.001]], 5);
    k.plane(k.canvas(420, 300, (g) => {
      g.fillStyle = '#fbfbf8';
      g.fillRect(0, 0, 420, 300);
      g.strokeStyle = '#8a8e94';
      g.lineWidth = 8;
      g.strokeRect(4, 4, 412, 292);
      text(g, '本日の当番', 210, 42, "bold 34px 'Yu Gothic', sans-serif", '#1a1a1a');
      const lines = ['在所  2名', '巡回  22:00 / 01:00', '落とし物  傘 3・財布 1', '歌舞路一丁目 注意喚起'];
      lines.forEach((l, i) => text(g, l, 30, 100 + i * 50, "26px 'Yu Gothic', sans-serif", '#1a3a8a', 'left'));
    }), 1.2, 0.86, 4.6, room.t1 - 0.06, 1.85, 'out', 1.0);
    k.lit(0xf8f6ee, 6.3, 6.7, room.t1 - 0.07, room.t1 - 0.05, 2.35, 2.75, true);
    // ---- People: the officer at the desk and a visitor at the counter asking the way (the officer standing
    // guard at the door is the story's: the npc `officer`) ----
    k.person(3.8, 6.25, 0, -1, { y: -0.13, body: 'man', pose: 'sit', outfit: 'police', hair: 'short', color: [0.12, 0.14, 0.24] });
    k.person(6.1, 3.0, 0, 1, { y: -0.13, body: 'elder', pose: 'talk', outfit: 'plain', hair: 'short', color: [0.3, 0.28, 0.22] });
  },
};
