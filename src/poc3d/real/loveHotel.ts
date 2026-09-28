import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { WIN } from './buildings';
import type { CityUniforms } from './city';
import type { Light } from './lightmap';
import { localBox, localFrame, localRect, localYaw, toWorld } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { addFigure, GhostBuilder } from './people';

/**
 * Hotel Rouge (ホテル ルージュ): the Love District's flagship, a castle love hotel in the Japanese way. A
 * pastel keep with round corner towers under red conical roofs, battlements outlined in pink neon, a tall
 * central donjon with a flag, a big HOTEL ROUGE neon sign, and at street level a discreet entrance: a
 * canopy over tinted doors hidden behind a screen wall, a lit rate board with the vacancy light, and a
 * car entrance behind a strip curtain. A plain side door on the west wall is the hidden way in.
 * Local frame (localFrame.ts): u along the 24 m front, t inward over 21 m. You can walk into the front
 * court and on through the doors (the interior, rougeInterior.ts); E at the side door lets you into the back.
 */
export const LOVE_HOTEL = { fw: 24, depth: 21 } as const;

const KEEP = { u0: 3, u1: 21, t0: 4, t1: 18, h: 15 } as const;
const TOWERS: readonly (readonly [number, number])[] = [[3, 4], [21, 4], [3, 18], [21, 18]];
const TOWER_R = 2.2;
const TOWER_H = 19;
const DONJON = { u: 12, t: 11, r: 3.0, h: 23 } as const;
const COUPLE: readonly (readonly [number, number])[] = [[8.1, 2.2], [8.1, 2.85]];

/** Collision: the keep, the towers, the screen wall and planters, porch columns, rate board, the couple. */
export function loveHotelColliders(b: Building3): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  return [
    // The keep, but for a pocket at the front doors: you walk in (the interior takes over, rougeInterior.ts).
    R(KEEP.u0, 10.5, KEEP.t0, KEEP.t1),
    R(13.5, KEEP.u1, KEEP.t0, KEEP.t1),
    R(10.5, 13.5, KEEP.t0 + 1.0, KEEP.t1),
    ...TOWERS.map(([u, t]) => R(u - TOWER_R, u + TOWER_R, t - TOWER_R, t + TOWER_R)),
    R(9.0, 15.0, 0.9, 1.4),
    R(9.05, 9.35, 1.65, 1.95),
    R(14.65, 14.95, 1.65, 1.95),
    R(6.0, 8.0, 3.6, 4.0),
    ...COUPLE.map(([u, t]) => R(u - 0.3, u + 0.3, t - 0.3, t + 0.3)),
  ];
}

/** Lightmap lights: the porch, the neon sign's glow on the street, tower uplights, garage, side door. */
export function loveHotelLights(b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  return [
    L(12, 2.5, 6, [1.0, 0.55, 0.62], 0.9),
    L(12, -4, 14, [1.0, 0.35, 0.7], 0.55),
    L(3, 0.8, 5, [1.0, 0.4, 0.7], 0.45),
    L(21, 0.8, 5, [1.0, 0.4, 0.7], 0.45),
    L(17.5, 2.5, 4, [0.6, 0.5, 1.0], 0.4),
    L(1.8, 12, 3, [1.0, 0.75, 0.5], 0.35),
  ];
}

const PINK_WALL = 0xf2d8e0;
const CREAM = 0xf6eee2;
const ROOF = 0xb02838;
const TRIM = 0xffffff;
const GOLD = 0xd8b060;
const NEON: [number, number, number] = [1.0, 0.22, 0.62];

export interface LoveHotel {
  readonly group: THREE.Group;
  /** Neon signs dim by day (they follow the city's neon level). */
  update(camera: THREE.Vector3, dt: number): void;
}

export function buildLoveHotel(b: Building3, city: THREE.Material, ghost: THREE.Material, u: CityUniforms): LoveHotel {
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
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
  };
  const glow = (ch: number, rgb: [number, number, number], u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [ch, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1);
    mb.style = [0, 0, 0, 0];
  };
  const W = (uu: number, t: number): [number, number] => toWorld(f, uu, t);
  const round = (hex: number, uu: number, t: number, rings: readonly (readonly [number, number])[], n = 18, ch = -1): void => {
    const [x, z] = W(uu, t);
    if (ch >= 0) {
      mb.kind = KIND.emit;
      mb.style = [ch, 0, 0, 0];
      mb.color = NEON;
    } else {
      mb.kind = KIND.plain;
      mb.color = lin(hex);
    }
    mb.lathe(x, z, rings, n);
    mb.style = [0, 0, 0, 0];
  };

  // The keep: pastel walls with small windows (the city shader draws them), cornice bands, battlements.
  const floors = Math.max(0, Math.floor((KEEP.h - 4.2 - 0.5) / 3));
  mb.kind = KIND.wall;
  mb.color = lin(PINK_WALL);
  mb.flags = 8 + 3 * 16;
  mb.style = [3.2, 0.35, 1.1, WIN.small + 8 * floors];
  localBox(mb, f, KEEP.u0, KEEP.u1, KEEP.t0, KEEP.t1, 0, KEEP.h);
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  for (const y of [4.2, 9.6]) box(TRIM, KEEP.u0 - 0.15, KEEP.u1 + 0.15, KEEP.t0 - 0.15, KEEP.t1 + 0.15, y, y + 0.25);
  const wallRing = (y0: number, y1: number, th: number): void => {
    box(TRIM, KEEP.u0, KEEP.u1, KEEP.t0, KEEP.t0 + th, y0, y1);
    box(TRIM, KEEP.u0, KEEP.u1, KEEP.t1 - th, KEEP.t1, y0, y1);
    box(TRIM, KEEP.u0, KEEP.u0 + th, KEEP.t0, KEEP.t1, y0, y1);
    box(TRIM, KEEP.u1 - th, KEEP.u1, KEEP.t0, KEEP.t1, y0, y1);
  };
  wallRing(KEEP.h, KEEP.h + 0.5, 0.4);
  for (let x = KEEP.u0 + 0.3; x < KEEP.u1 - 0.5; x += 1.2) {
    box(TRIM, x, x + 0.6, KEEP.t0, KEEP.t0 + 0.4, KEEP.h + 0.5, KEEP.h + 1.3);
    box(TRIM, x, x + 0.6, KEEP.t1 - 0.4, KEEP.t1, KEEP.h + 0.5, KEEP.h + 1.3);
  }
  for (let t = KEEP.t0 + 0.3; t < KEEP.t1 - 0.5; t += 1.2) {
    box(TRIM, KEEP.u0, KEEP.u0 + 0.4, t, t + 0.6, KEEP.h + 0.5, KEEP.h + 1.3);
    box(TRIM, KEEP.u1 - 0.4, KEEP.u1, t, t + 0.6, KEEP.h + 0.5, KEEP.h + 1.3);
  }
  // Pink neon along the parapet (front and sides).
  glow(EMIT.neon, NEON, KEEP.u0, KEEP.u1, KEEP.t0 - 0.08, KEEP.t0, KEEP.h + 0.4, KEEP.h + 0.5);
  glow(EMIT.neon, NEON, KEEP.u0 - 0.08, KEEP.u0, KEEP.t0, KEEP.t1, KEEP.h + 0.4, KEEP.h + 0.5);
  glow(EMIT.neon, NEON, KEEP.u1, KEEP.u1 + 0.08, KEEP.t0, KEEP.t1, KEEP.h + 0.4, KEEP.h + 0.5);

  // Corner towers: cream drums with window slits (some lit pink), a trim ring, a neon ring, a red cone.
  for (const [tu, tt] of TOWERS) {
    round(CREAM, tu, tt, [[0, TOWER_R], [TOWER_H, TOWER_R]]);
    round(TRIM, tu, tt, [[TOWER_H - 0.3, TOWER_R + 0.12], [TOWER_H, TOWER_R + 0.12]]);
    round(0, tu, tt, [[TOWER_H - 0.62, TOWER_R + 0.06], [TOWER_H - 0.5, TOWER_R + 0.06]], 20, EMIT.neon);
    round(ROOF, tu, tt, [[TOWER_H, TOWER_R + 0.5], [TOWER_H + 0.4, TOWER_R + 0.3], [TOWER_H + 5.5, 0.03]], 18);
    round(ROOF, tu, tt, [[TOWER_H, TOWER_R], [TOWER_H, TOWER_R + 0.5]], 18);
    round(ROOF, tu, tt, [[TOWER_H, TOWER_R + 0.5], [TOWER_H, TOWER_R]], 18);
    for (const y of [6, 10, 14]) {
      for (const [du, dt] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const cu = tu + du * TOWER_R;
        const ct = tt + dt * TOWER_R;
        const lit = (Math.round(tu + tt * 3 + y) + du + dt) % 3 === 0;
        const hu = du === 0 ? 0.2 : 0.06;
        const ht = dt === 0 ? 0.2 : 0.06;
        if (lit) glow(EMIT.always, [0.9, 0.4, 0.55], cu - hu, cu + hu, ct - ht, ct + ht, y, y + 1.1);
        else box(0x2a2226, cu - hu, cu + hu, ct - ht, ct + ht, y, y + 1.1);
      }
    }
  }
  // The donjon rising from the middle of the keep, with a flag.
  round(CREAM, DONJON.u, DONJON.t, [[KEEP.h, DONJON.r], [DONJON.h, DONJON.r]]);
  round(TRIM, DONJON.u, DONJON.t, [[DONJON.h - 0.35, DONJON.r + 0.15], [DONJON.h, DONJON.r + 0.15]]);
  round(0, DONJON.u, DONJON.t, [[DONJON.h - 0.7, DONJON.r + 0.07], [DONJON.h - 0.56, DONJON.r + 0.07]], 24, EMIT.neon);
  round(ROOF, DONJON.u, DONJON.t, [[DONJON.h, DONJON.r + 0.6], [DONJON.h + 0.5, DONJON.r + 0.35], [DONJON.h + 7, 0.04]], 22);
  round(ROOF, DONJON.u, DONJON.t, [[DONJON.h, DONJON.r], [DONJON.h, DONJON.r + 0.6]], 22);
  round(ROOF, DONJON.u, DONJON.t, [[DONJON.h, DONJON.r + 0.6], [DONJON.h, DONJON.r]], 22);
  for (const y of [17, 20]) {
    for (const [du, dt] of [[1, 0], [-1, 0], [0, -1]] as const) {
      const cu = DONJON.u + du * DONJON.r;
      const ct = DONJON.t + dt * DONJON.r;
      glow(EMIT.always, [0.9, 0.4, 0.55], cu - (du === 0 ? 0.22 : 0.06), cu + (du === 0 ? 0.22 : 0.06), ct - (dt === 0 ? 0.22 : 0.06), ct + (dt === 0 ? 0.22 : 0.06), y, y + 1.3);
    }
  }
  mb.kind = KIND.plain;
  mb.color = lin(0x9a9a9a);
  const [fx, fz] = W(DONJON.u, DONJON.t);
  mb.beam([fx, DONJON.h + 6.8, fz], [fx, DONJON.h + 9.5, fz], 0.08);
  box(0xff5fa8, DONJON.u + 0.05, DONJON.u + 1.6, DONJON.t - 0.02, DONJON.t + 0.02, DONJON.h + 8.4, DONJON.h + 9.4);

  // Street level: the porch (canopy on two columns, tinted doors in a lit frame), the screen wall with
  // planters, the rate board, the car entrance behind its strip curtain, and the side door.
  box(TRIM, 9.0, 15.0, 1.6, KEEP.t0, 3.3, 3.6);
  glow(EMIT.always, [1.2, 0.7, 0.75], 9.4, 14.6, 1.8, 3.8, 3.27, 3.3);
  for (const cu of [9.2, 14.8]) {
    mb.kind = KIND.plain;
    mb.color = lin(GOLD);
    const [x, z] = W(cu, 1.8);
    mb.cylinder(x, z, 0, 3.3, 0.15, 10);
  }
  box(0x1a1418, 10.5, 13.5, KEEP.t0 - 0.06, KEEP.t0, 0, 2.8);
  glow(EMIT.always, [1.3, 0.85, 0.45], 10.35, 10.5, KEEP.t0 - 0.08, KEEP.t0, 0, 2.95);
  glow(EMIT.always, [1.3, 0.85, 0.45], 13.5, 13.65, KEEP.t0 - 0.08, KEEP.t0, 0, 2.95);
  glow(EMIT.always, [1.3, 0.85, 0.45], 10.35, 13.65, KEEP.t0 - 0.08, KEEP.t0, 2.8, 2.95);
  box(0xd8a0b0, 9.6, 14.4, 1.0, 1.3, 0, 2.1);
  box(TRIM, 9.5, 14.5, 0.95, 1.35, 2.1, 2.22);
  for (const pu of [9.0, 14.4]) {
    box(0xb88a96, pu, pu + 0.6, 0.9, 1.4, 0, 0.6);
    round(0x2e5a34, pu + 0.3, 1.15, [[0.55, 0.05], [0.8, 0.42], [1.3, 0.38], [1.6, 0.05]], 8);
  }
  box(0x2a1a22, 6.0, 8.0, 3.6, KEEP.t0, 0.3, 3.1);
  box(0x141016, 16.3, 18.8, KEEP.t0 - 0.05, KEEP.t0, 0, 2.8);
  for (let s = 16.4; s < 18.7; s += 0.2) box(0xe06090, s, s + 0.14, KEEP.t0 - 0.12, KEEP.t0 - 0.08, 0.35, 2.7);
  box(TRIM, 16.1, 19.0, KEEP.t0 - 0.12, KEEP.t0, 2.8, 3.0);
  glow(EMIT.always, [0.3, 0.45, 1.3], 17.2, 17.9, KEEP.t0 - 0.1, KEEP.t0, 3.1, 3.8);
  box(0x3a3236, KEEP.u0 - 0.06, KEEP.u0, 11.5, 12.5, 0, 2.2);
  glow(EMIT.lamp, [0.25, 0.16, 0.08], KEEP.u0 - 0.25, KEEP.u0, 11.9, 12.1, 2.4, 2.6);

  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  // Signs: the big neon name on the keep, a vertical ホテル on the left front tower, the rate board and
  // the plaque on the screen wall. Neon planes brighten at night with the rest of the city's neon.
  const neonMats: THREE.MeshBasicMaterial[] = [];
  const plane = (canvas: HTMLCanvasElement, w: number, h: number, cu: number, t: number, y: number, neon: boolean): void => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: neon, depthWrite: !neon, color: new THREE.Color(1.2, 1.2, 1.2) });
    if (neon) neonMats.push(mat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const [x, z] = W(cu, t);
    m.position.set(x, y, z);
    m.rotation.y = Math.atan2(f.n[0], f.n[2]);
    group.add(m);
  };
  const canvas = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    return c;
  };
  const neonText = (g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string): void => {
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    for (const blur of [28, 12]) {
      g.shadowBlur = blur;
      g.fillStyle = color;
      g.fillText(text, x, y);
    }
    g.shadowBlur = 0;
    g.fillStyle = '#fff0f8';
    g.fillText(text, x, y);
  };
  plane(canvas(1320, 340, (g) => {
    neonText(g, 'HOTEL ROUGE', 660, 150, "italic bold 170px 'Georgia', 'Times New Roman', serif", '#ff4fa8');
    neonText(g, 'ホテル ルージュ', 660, 290, "bold 64px 'Yu Gothic', 'Meiryo', sans-serif", '#ffb0dc');
  }), 13.2, 3.4, 12, KEEP.t0 - 0.06, 11.9, true);
  plane(canvas(130, 700, (g) => {
    ['ホ', 'テ', 'ル'].forEach((ch, i) => neonText(g, ch, 65, 130 + i * 220, "bold 120px 'Yu Gothic', 'Meiryo', sans-serif", '#ff4fa8'));
  }), 1.3, 7, 3, 4 - TOWER_R - 0.1, 12.5, true);
  plane(canvas(300, 420, (g) => {
    g.fillStyle = '#1c0c16';
    g.fillRect(0, 0, 300, 420);
    g.strokeStyle = '#d8b060';
    g.lineWidth = 8;
    g.strokeRect(10, 10, 280, 400);
    g.fillStyle = '#ffd8ec';
    g.textAlign = 'center';
    g.font = "italic bold 44px 'Georgia', serif";
    g.fillText('ROUGE', 150, 70);
    g.font = "bold 34px 'Yu Gothic', 'Meiryo', sans-serif";
    g.fillText('休憩  ¥4,800〜', 150, 150);
    g.fillText('宿泊  ¥8,800〜', 150, 205);
    g.font = "26px 'Yu Gothic', 'Meiryo', sans-serif";
    g.fillText('フリータイム ¥6,800', 150, 255);
    g.fillStyle = '#20c060';
    g.fillRect(60, 300, 180, 80);
    g.fillStyle = '#ffffff';
    g.font = "bold 52px 'Yu Gothic', 'Meiryo', sans-serif";
    g.fillText('空室', 150, 360);
  }), 1.9, 2.66, 7, 3.58, 1.7, false);
  plane(canvas(480, 90, (g) => {
    g.fillStyle = '#2a1a22';
    g.fillRect(0, 0, 480, 90);
    g.fillStyle = '#e8c878';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "italic bold 54px 'Georgia', serif";
    g.fillText('Hotel Rouge', 240, 48);
  }), 2.4, 0.45, 12, 0.98, 1.55, false);

  // A couple slipping in behind the screen wall.
  const people = new GhostBuilder();
  COUPLE.forEach(([cu, ct], i) => {
    const [x, z] = W(cu, ct);
    addFigure(people, {
      x,
      z,
      yaw: localYaw(f, 1, 0.25),
      body: i === 0 ? 'man' : 'woman',
      pose: 'walk',
      color: i === 0 ? [0.68, 0.52, 1.0] : [1.0, 0.42, 0.72],
      hair: i === 0 ? 'short' : 'long',
      long: i === 1,
      phase: i * 0.5,
      side: 1,
      look: i === 0 ? 0.3 : -0.3,
    });
  });
  const crowd = people.build(0, 0);
  if (crowd) {
    const m = new THREE.Mesh(crowd, ghost);
    m.renderOrder = 2;
    group.add(m);
  }

  return {
    group,
    update() {
      const k = 0.55 + 1.75 * u.uNeon.value;
      for (const m of neonMats) m.color.setScalar(k);
    },
  };
}

