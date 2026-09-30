import type * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { Kit, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toWorld } from './localFrame';
import { EMIT } from './meshBuilder';

/**
 * The buildings round the cast's homes (their flats are real/homesCast.ts), registered with the kit landmarks
 * (asagiri.ts). In the building's local frame (u along the street face, t inward):
 * - mansion: a seven-storey tiled マンション (GF lobby 3.5 m, then 3 m floors), recessed balconies across the front,
 *   the lit entrance with its auto-lock and mailboxes, named by placement (`MANSIONS`).
 * - dorm: a plain white four-storey block with frosted windows behind a low wall and gate, a row of bicycles, and a
 *   discreet plate (Stella Production's idols live here; nothing says so).
 * - net_cafe: a two-storey 24-hour manga café, its vertical sign, lit fascia, posters of the night pack.
 * Nothing of the exterior stands inside a flat's box (the flats keep the exterior, whose faces are one-sided).
 */
export const RESIDENCE_KINDS = ['mansion', 'dorm', 'net_cafe'] as const;
export type ResidenceKind = (typeof RESIDENCE_KINDS)[number];

/** The mansion's storeys: ground floor 3.5 m, then 3 m. */
export const MANSION = { w: 20, d: 16, gf: 3.5, floor: 3, floors: 7 } as const;
export const mansionFloorY = (n: number): number => (n <= 1 ? 0 : MANSION.gf + (n - 2) * MANSION.floor);

/** Names by placement id. */
const MANSIONS: Readonly<Record<string, readonly [string, string]>> = {
  manager_flat: ['メゾン電光', 'MAISON DENKŌ'],
};

export function residenceColliders(kind: ResidenceKind, b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  switch (kind) {
    case 'mansion':
      return [R(0, MANSION.w, 0, MANSION.d)];
    case 'dorm':
      return [R(0, 24, 0, 16), R(0, 9.4, -2.6, -2.3), R(11.6, 24, -2.6, -2.3)];
    case 'net_cafe':
      return [R(0, 16, 0, 20)];
  }
}

export function residenceLights(kind: ResidenceKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  switch (kind) {
    case 'mansion':
      return [L(15.5, -1.5, 7, [1.0, 0.9, 0.75], 0.7)];
    case 'dorm':
      return [L(10.5, -1.5, 6, [1.0, 0.92, 0.8], 0.5)];
    case 'net_cafe':
      return [L(8, -1.5, 9, [1.0, 0.85, 0.5], 0.9), L(14.5, -1, 8, [0.6, 0.8, 1.0], 0.6)];
  }
}

function plate(k: Kit, w: number, h: number, u: number, t: number, y: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, neon = false): void {
  const W = Math.round(w * 64);
  const H = Math.round(h * 64);
  k.plane(k.canvas(W, H, (g) => draw(g, W, H)), w, h, u, t, y, 'out', neon ? 1.4 : 1.0, neon);
}

export const RESIDENCE_BUILDERS: Record<ResidenceKind, (k: Kit, id: string) => ((camera: THREE.Vector3, dt: number) => void) | void> = {
  mansion(k, id) {
    const { w, d, gf, floor, floors } = MANSION;
    const top = mansionFloorY(floors) + floor;
    const TILE = 0xb8a890;
    // The body, its windows (balcony doors on the front, set back behind the balconies), a dark parapet.
    k.facade(TILE, [3.8, 0.55, 2.0, 3], 128 + 64, 0, w, 0, d, 0, top, true);
    k.box(0x5a5048, -0.2, w + 0.2, -0.2, d + 0.2, top, top + 0.9);
    // Each floor's balcony: the slab's edge, a frosted glass front, the dividers between flats.
    for (let n = 2; n <= floors; n++) {
      const y = mansionFloorY(n);
      k.box(0xd8d0c0, 0, w, -0.35, 0, y - 0.2, y - 0.02);
      k.lit(0xc8d4dc, 0.6, 9.4, -0.36, -0.3, y, y + 1.05);
      k.lit(0xc8d4dc, 10.6, w - 0.6, -0.36, -0.3, y, y + 1.05);
      k.box(0x8a8e92, 0, w, -0.4, -0.3, y + 1.05, y + 1.12);
      k.box(0xd8d0c0, 9.8, 10.2, -0.35, 0, y, y + 2.6);
    }
    // The entrance: a lit glass lobby box set into the ground floor, the canopy, the mailboxes seen through.
    k.box(0x3a3a3e, 12.5, 18.5, -1.8, 0, gf - 0.3, gf - 0.1);
    k.glow([1.3, 1.15, 0.9], 13.5, 17.5, -1.6, -1.4, gf - 0.32, gf - 0.3, EMIT.lamp);
    k.lit(0xe8e0d0, 13, 18, -0.04, 0, 0.1, 2.6, false);
    k.pane(13, 18, 0.1, 2.6, -0.06);
    k.box(0x7a7a78, 15.4, 15.6, -0.08, -0.04, 0.1, 2.6);
    k.box(0x2a2a2e, 12.4, 12.9, -0.5, -0.1, 0, 1.3); // the auto-lock panel
    k.glow([0.5, 0.8, 1.2], 12.45, 12.85, -0.52, -0.5, 0.9, 1.2, EMIT.always);
    const [jp, en] = MANSIONS[id] ?? ['メゾン', 'MAISON'];
    plate(k, 3.2, 0.7, 15.5, -0.1, 3.0, (g, W, H) => {
      g.fillStyle = '#2a2a2e';
      g.fillRect(0, 0, W, H);
      text(g, jp, W / 2, H * 0.42, `bold ${Math.round(H * 0.42)}px 'Yu Mincho', serif`, '#e8d8b0');
      text(g, en, W / 2, H * 0.82, `${Math.round(H * 0.22)}px 'Times New Roman', serif`, '#c8b890');
    });
    // Plants either side of the door, the bicycle rack along the side.
    for (const u of [12, 19]) {
      k.box(0x5a5048, u - 0.4, u + 0.4, -1.2, -0.4, 0, 0.5);
      k.box(0x3a6a2a, u - 0.35, u + 0.35, -1.15, -0.45, 0.5, 1.1);
    }
  },

  dorm(k) {
    const WHITE = 0xe8e6e0;
    k.facade(WHITE, [3.0, 0.35, 1.3, 1], 64, 0, 24, 0, 16, 0, 12.2, true);
    k.box(0xc8c6c0, -0.2, 24.2, -0.2, 16.2, 12.2, 12.7);
    // The low wall and the gate, the canopy over the door, bicycles, a discreet plate.
    for (const [u0, u1] of [[0, 9.4], [11.6, 24]] as const) {
      k.box(0xd8d4cc, u0, u1, -2.6, -2.3, 0, 1.2);
      k.box(0x9a968e, u0, u1, -2.65, -2.25, 1.2, 1.26);
    }
    k.box(0x5a5e62, 9.4, 11.6, -2.5, -2.45, 0, 1.1);
    k.box(0xd8d4cc, 9.2, 11.8, -1.4, 0, 2.7, 2.85);
    k.glow([1.2, 1.1, 0.95], 10.2, 10.8, -0.9, -0.7, 2.68, 2.7, EMIT.lamp);
    k.box(0x6a5a48, 9.9, 11.3, -0.06, 0, 0, 2.2);
    for (let u = 14; u < 22; u += 0.7) {
      k.box([0xe8a0b8, 0xa8c8e8, 0xf0f0f0, 0xe8d0a0][Math.round(u * 3) % 4], u, u + 0.06, -1.9, -0.3, 0.35, 0.95);
      k.lathe(0x1a1a1a, u + 0.03, -1.7, [[0, 0.3], [0.02, 0.3]], 10);
    }
    plate(k, 0.8, 0.3, 8.8, -2.7, 1.0, (g, W, H) => {
      g.fillStyle = '#f0ece4';
      g.fillRect(0, 0, W, H);
      text(g, 'S 寮', W / 2, H * 0.62, `bold ${Math.round(H * 0.55)}px 'Yu Gothic', sans-serif`, '#3a3a3a');
    });
  },

  net_cafe(k) {
    k.facade(0x3a3a40, [4, 0.2, 0.9, 5], 0, 0, 16, 0, 20, 0, 7.2, true);
    k.box(0x2a2a2e, -0.2, 16.2, -0.2, 20.2, 7.2, 7.6);
    // The lit fascia, the entrance (glass doors, a warm glow), the vertical sign, the posters, the frosted windows.
    plate(k, 10, 1.3, 8, -0.1, 4.0, (g, W, H) => {
      const grd = g.createLinearGradient(0, 0, W, 0);
      grd.addColorStop(0, '#1a1030');
      grd.addColorStop(1, '#301050');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      text(g, '漫画喫茶 月夜 TSUKIYO', W * 0.42, H * 0.56, `bold ${Math.round(H * 0.5)}px 'Yu Gothic', sans-serif`, '#ffe45f');
      g.fillStyle = '#ff4f8a';
      g.fillRect(W * 0.84, H * 0.15, W * 0.13, H * 0.7);
      text(g, '24H', W * 0.905, H * 0.56, `900 ${Math.round(H * 0.5)}px Arial, sans-serif`, '#ffffff');
    }, true);
    k.lit(0xf0d8a0, 6, 10, -0.04, 0, 0.1, 2.5, false);
    k.pane(6, 10, 0.1, 2.5, -0.06);
    k.box(0x9a9a9a, 7.98, 8.02, -0.1, -0.04, 0.1, 2.5);
    k.lit(0xd8e0e8, 11, 15.5, -0.03, 0, 0.8, 2.6, false);
    k.lit(0xd8e0e8, 0.5, 5.5, -0.03, 0, 0.8, 2.6, false);
    k.box(0x2a2a2e, 15.2, 15.6, -1.4, -0.2, 3.2, 11);
    for (let i = 0; i < 6; i++) {
      plate(k, 1.0, 1.1, 15.4, -1.45, 10.3 - i * 1.25, (g, W, H) => {
        g.fillStyle = i % 2 ? '#ff4f8a' : '#4fe3ff';
        g.fillRect(0, 0, W, H);
        text(g, '月夜ネット'[i] ?? '', W / 2, H * 0.55, `bold ${Math.round(H * 0.7)}px 'Yu Gothic', sans-serif`, '#1a1030');
      }, true);
    }
    plate(k, 1.5, 2.0, 3.0, -0.08, 1.7, (g, W, H) => {
      g.fillStyle = '#ffe45f';
      g.fillRect(0, 0, W, H);
      text(g, 'ナイトパック', W / 2, H * 0.2, `bold ${Math.round(H * 0.1)}px 'Yu Gothic', sans-serif`, '#c81a1a');
      text(g, '8時間', W / 2, H * 0.45, `bold ${Math.round(H * 0.15)}px 'Yu Gothic', sans-serif`, '#1a1a1a');
      text(g, '¥1,480', W / 2, H * 0.7, `900 ${Math.round(H * 0.17)}px Arial, sans-serif`, '#c81a1a');
      text(g, 'シャワー完備', W / 2, H * 0.9, `bold ${Math.round(H * 0.08)}px 'Yu Gothic', sans-serif`, '#1a1a1a');
    });
    k.box(0x3a3a3e, 5.5, 10.5, -1.6, 0, 2.9, 3.05);
    k.glow([1.4, 1.1, 0.7], 6.5, 9.5, -1.4, -1.2, 2.88, 2.9, EMIT.lamp);
  },
};
