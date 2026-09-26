import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { GF, WIN } from './buildings';
import type { Light } from './lightmap';
import { localBox, localFrame, localRect, localYaw, toLocal, toWorld } from './localFrame';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { addFigure, GHOST_COLORS, GhostBuilder, type FigureSpec, type Pose } from './people';

/**
 * LIVE HOUSE 地下室 (Chikashitsu, "the basement"): a music venue you walk down into. From the pavement a
 * stairwell plastered with gig posters drops to B1: a ticket desk at the foot of the stairs, a bar along
 * the left wall, a crowd facing the stage, and on stage a band (tonight: Julie's MIDNIGHT PLASTIC release
 * show) under a lighting truss with coloured beams. Above ground: a record shop and a few floors.
 * Local frame (localFrame.ts): u along the 10 m front, t inward over 22 m, y up (the basement floor is
 * at -4.5). Floor heights, the street-level and basement collision, the hole in the pavement for the
 * stairwell and the lights all come from this one layout.
 */
export const LIVE_HOUSE = { fw: 10, depth: 22, floor: -4.5, ceiling: -0.6 } as const;

const FL = LIVE_HOUSE.floor;
const STAIR = { u0: 0.2, u1: 3.2, t0: 0.5, t1: 6.0 } as const;
const STAGE = { t0: 17.8, y: FL + 0.6 } as const;
const AUDIENCE: readonly (readonly [number, number, Pose])[] = [
  [2.2, 13.3, 'stand'], [3.6, 13.0, 'wave'], [5.3, 13.4, 'stand'], [7.0, 13.1, 'wave'], [8.3, 13.6, 'pockets'],
  [2.8, 14.6, 'stand'], [4.5, 14.8, 'wave'], [6.2, 14.5, 'stand'], [7.8, 14.9, 'stand'],
  [3.6, 16.1, 'wave'], [5.4, 16.3, 'stand'], [7.1, 16.0, 'wave'],
];
const BAR_CUSTOMER: readonly [number, number] = [1.75, 11.2];
const BAND: readonly (readonly [number, number, Pose, 'man' | 'woman'])[] = [
  [5.0, 18.6, 'wave', 'woman'],
  [2.9, 19.2, 'hold', 'man'],
  [7.1, 19.2, 'hold', 'man'],
  [5.0, 20.7, 'stand', 'man'],
];

/** Floor height at a local point, or null outside the stairwell and basement. */
function floorLocal(u: number, t: number): number | null {
  if (u >= STAIR.u0 && u <= STAIR.u1 && t >= 0 && t < STAIR.t1) return t <= STAIR.t0 ? 0 : (FL * (t - STAIR.t0)) / (STAIR.t1 - STAIR.t0);
  if (u >= 0.2 && u <= 9.8 && t >= STAIR.t1 && t <= 21.8) return FL;
  return null;
}

/** Floor height at a world point (0 outside). */
export function liveHouseFloor(b: Building3, x: number, z: number): number | null {
  const [u, t] = toLocal(localFrame(b), x, z);
  return floorLocal(u, t);
}

/** Collision at street level (the building, the stairwell walls) or in the basement (below -2.25 m). */
export function liveHouseColliders(b: Building3, floor: number): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  const stairWalls = [R(0, STAIR.u0, 0, STAIR.t1), R(STAIR.u1, STAIR.u1 + 0.2, 0, STAIR.t1)];
  if (floor > FL / 2) return [R(STAIR.u1, 10, 0, LIVE_HOUSE.depth), R(0, STAIR.u1 + 0.2, STAIR.t1, LIVE_HOUSE.depth), ...stairWalls, R(3.7, 4.3, -1.15, -0.75)];
  return [
    ...stairWalls,
    R(0, 0.2, STAIR.t1, 22),
    R(9.8, 10, STAIR.t1, 22),
    R(0, 10, 21.8, 22),
    R(STAIR.u1, 9.8, STAIR.t1, STAIR.t1 + 0.2),
    R(0.2, 9.8, STAGE.t0, 21.8),
    R(0.2, 1.3, 16.9, STAGE.t0),
    R(8.7, 9.8, 16.9, STAGE.t0),
    R(0.2, 1.2, 9, 15),
    R(3.4, 5.5, 6.2, 6.9),
    ...[...AUDIENCE.map(([u, t]) => [u, t] as const), BAR_CUSTOMER].map(([u, t]) => R(u - 0.3, u + 0.3, t - 0.3, t + 0.3)),
  ];
}

/** The opening in the pavement over the stairwell. */
export function liveHouseHoles(b: Building3): Rect[] {
  return [localRect(localFrame(b), STAIR.u0, STAIR.u1, 0, STAIR.t1)];
}

/** Lightmap lights: the red glow of the stairwell and its sign, and the venue's stage colours. */
export function liveHouseLights(b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  return [
    L(1.7, 2.5, 3.5, [1.0, 0.35, 0.25], 0.7),
    L(1.7, -2, 5, [1.0, 0.3, 0.3], 0.45),
    L(5, 15, 5, [1.0, 0.35, 0.7], 0.8),
    L(5, 9.5, 4.5, [1.0, 0.7, 0.4], 0.6),
    L(5, 19.5, 4.5, [0.6, 0.4, 1.0], 0.9),
    L(1.5, 12, 3, [1.0, 0.6, 0.3], 0.5),
  ];
}

const posterArt = import.meta.glob(
  [
    '../../../assets/ads/kaburo/34_live_singer_poster.jpg',
    '../../../assets/ads/kaburo/35_live_singer_poster.jpg',
    '../../../assets/ads/kaburo/25_julie_album.jpg',
    '../../../assets/ads/kaburo/26_julie_album.jpg',
    '../../../assets/ads/kaburo/37_live_nightdrive.jpg',
  ],
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

export interface LiveHouse {
  readonly group: THREE.Group;
  /** Sways the stage beams. */
  update(camera: THREE.Vector3, dt: number): void;
}

export function buildLiveHouse(b: Building3, city: THREE.Material, ghost: THREE.Material): LiveHouse {
  const f = localFrame(b);
  const group = new THREE.Group();
  const mb = new MeshBuilder();
  mb.id = b.id;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  mb.frontNormal = null;
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom = false): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.plain, bottom || y0 > 0.3);
  };
  const glow = (rgb: [number, number, number], u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  const post = (hex: number, u: number, t: number, y0: number, y1: number, r: number, n = 10): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    const [x, z] = toWorld(f, u, t);
    mb.cylinder(x, z, y0, y1, r, n);
  };
  const { fw, depth, ceiling } = LIVE_HOUSE;

  // Above ground: a record shop behind a storefront, the block behind the stairwell, offices above.
  mb.kind = KIND.wall;
  mb.color = lin(0x6c5242);
  mb.flags = 1 + 2 * 2 + 8 + 16 * 4 + 128;
  mb.frontNormal = f.n;
  mb.style = [2.8, 0.45, 1.3, WIN.punched + 8 * Math.floor((b.h - GF - 0.5) / 3)];
  localBox(mb, f, STAIR.u1 + 0.2, fw, 0, depth, 0, GF, KIND.roof);
  mb.frontNormal = null;
  localBox(mb, f, 0, STAIR.u1 + 0.2, STAIR.t1, depth, 0, GF, KIND.roof);
  mb.frontNormal = f.n;
  localBox(mb, f, 0, fw, 0, depth, GF, b.h, KIND.roof);
  mb.frontNormal = null;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  box(0x4a3a30, 0, fw, 0, depth, b.h, b.h + 0.6);

  // The stairwell: walls from the basement up to its low ceiling, a landing, steps with bright nosings.
  box(0x2a1e1c, 0, STAIR.u0, 0, STAIR.t1, FL, 2.8);
  box(0x2a1e1c, STAIR.u1, STAIR.u1 + 0.2, 0, STAIR.t1, FL, 2.8);
  box(0x1a1616, 0, STAIR.u1 + 0.2, 0, STAIR.t1, 2.8, 3.0, true);
  box(0x3a3634, STAIR.u0, STAIR.u1, 0, STAIR.t0, -0.2, 0);
  const steps = 14;
  const run = (STAIR.t1 - STAIR.t0) / steps;
  for (let i = 0; i < steps; i++) {
    const t0 = STAIR.t0 + i * run;
    const top = (FL * (i + 1)) / steps;
    box(0x3a3634, STAIR.u0, STAIR.u1, t0, t0 + run, FL, top);
    box(0xb8a060, STAIR.u0, STAIR.u1, t0, t0 + 0.05, top, top + 0.01);
  }
  // Red bulbs down the stairwell ceiling and walls.
  for (let t = 0.8; t < STAIR.t1; t += 1.6) glow([1.4, 0.25, 0.15], 1.5, 1.9, t, t + 0.3, 2.75, 2.8);
  // Flyers: a patchwork of colour on both walls, following the stairs down.
  const flyer = [0xe8e0d0, 0xd83a2a, 0xf0c020, 0x2a6ad0, 0x202020, 0xd060a0, 0x60c0e0, 0xf08030];
  for (let t = 0.3; t < STAIR.t1 - 0.3; t += 0.42) {
    const base = floorLocal(1.5, t) ?? 0;
    for (const [u0, u1] of [[STAIR.u0, STAIR.u0 + 0.01], [STAIR.u1 - 0.01, STAIR.u1]] as const) {
      for (let k = 0; k < 3; k++) {
        const y = base + 0.9 + k * 0.5 + (((t * 7 + k) % 1) - 0.5) * 0.15;
        box(flyer[Math.floor(t * 13 + k * 3 + u0) % flyer.length], u0, u1, t, t + 0.3, y, y + 0.42);
      }
    }
  }

  // B1: floor, black walls and ceiling.
  box(0x4a4648, 0.2, 9.8, STAIR.t1, 21.8, FL - 0.1, FL);
  box(0x141416, 0, 0.2, STAIR.t1, depth, FL, ceiling + 0.4);
  box(0x141416, 9.8, fw, STAIR.t1, depth, FL, ceiling + 0.4);
  box(0x141416, 0, fw, 21.8, depth, FL, ceiling + 0.4);
  box(0x141416, STAIR.u1, 9.8, STAIR.t1, STAIR.t1 + 0.2, FL, ceiling + 0.4);
  box(0x101012, 0, fw, STAIR.t1, depth, ceiling, ceiling + 0.4, true);
  // Ticket desk at the foot of the stairs, with a lamp.
  box(0x3a2a22, 3.4, 5.5, 6.2, 6.9, FL, FL + 1.0);
  glow([1.2, 0.8, 0.4], 4.2, 4.5, 6.3, 6.6, FL + 1.0, FL + 1.25);
  // Bar along the left wall: counter, backlit shelves of bottles.
  box(0x2a1e18, 0.2, 1.2, 9, 15, FL, FL + 1.05);
  box(0x8a6a48, 0.2, 1.25, 9, 15, FL + 1.05, FL + 1.1);
  glow([0.9, 0.55, 0.25], 0.2, 0.24, 9.2, 14.8, FL + 1.4, FL + 2.6);
  const bottles = [0x2a9a4a, 0x8a4a1a, 0xd8d0b0, 0x6a2a1a, 0x3a6a9a, 0xc89030];
  for (const y of [FL + 1.45, FL + 2.0]) {
    box(0x3a2a22, 0.2, 0.5, 9.2, 14.8, y - 0.03, y);
    for (let t = 9.3; t < 14.7; t += 0.16) box(bottles[Math.floor(t * 7) % bottles.length], 0.26, 0.36, t, t + 0.08, y, y + 0.3);
  }
  // The stage: riser, amps, drum kit, mic stands, monitors, PA stacks, the truss with lights.
  box(0x0e0e10, 0.2, 9.8, STAGE.t0, 21.8, FL, STAGE.y);
  box(0x2a2a2c, 0.2, 9.8, STAGE.t0, STAGE.t0 + 0.06, STAGE.y - 0.02, STAGE.y);
  for (const [u0, u1] of [[1.2, 2.4], [7.6, 8.8]]) {
    box(0x1a1a1a, u0, u1, 20.6, 21.4, STAGE.y, STAGE.y + 1.3);
    box(0x3a3a3c, u0 + 0.06, u1 - 0.06, 20.58, 20.6, STAGE.y + 0.1, STAGE.y + 0.9);
  }
  post(0xb0b0b8, 4.4, 21.1, STAGE.y, STAGE.y + 0.55, 0.28, 14);
  post(0xd83040, 5.0, 21.2, STAGE.y, STAGE.y + 0.6, 0.35, 14);
  post(0xb0b0b8, 5.6, 21.1, STAGE.y, STAGE.y + 0.55, 0.28, 14);
  for (const [u, t] of [[4.2, 20.6], [5.9, 20.5]]) {
    post(0x8a8a8a, u, t, STAGE.y, STAGE.y + 1.35, 0.02, 4);
    post(0xc8a040, u, t, STAGE.y + 1.35, STAGE.y + 1.37, 0.32, 14);
  }
  for (const u of [2.9, 5.0, 7.1]) {
    post(0x8a8a8a, u, 18.3, STAGE.y, STAGE.y + 1.5, 0.02, 4);
    box(0x1a1a1a, u - 0.35, u + 0.35, STAGE.t0 + 0.1, STAGE.t0 + 0.5, STAGE.y, STAGE.y + 0.35);
  }
  for (const [u0, u1] of [[0.2, 1.3], [8.7, 9.8]]) {
    box(0x161616, u0, u1, 16.9, STAGE.t0, FL, FL + 2.3);
    for (const y of [FL + 0.5, FL + 1.3, FL + 1.9]) post(0x2a2a2a, (u0 + u1) / 2, 16.88, y, y + 0.02, 0.3, 12);
  }
  const trussY = ceiling - 0.6;
  for (const t of [12.0, 17.4]) box(0x3a3a3c, 0.2, 9.8, t, t + 0.25, trussY, trussY + 0.25, true);
  const beams: THREE.Mesh[] = [];
  const beamColors = [0xff4fa8, 0x4fe3ff, 0xffb040, 0xb48cff, 0xff4fa8, 0x4fe3ff];
  [1.8, 3.4, 5.0, 6.6, 8.2].forEach((u, i) => {
    const c = new THREE.Color(beamColors[i]);
    glow([c.r * 2, c.g * 2, c.b * 2], u - 0.14, u + 0.14, 17.45, 17.7, trussY - 0.25, trussY);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 3.0, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    const [x, z] = toWorld(f, u, 18.2);
    cone.geometry.translate(0, -1.5, 0);
    cone.position.set(x, trussY - 0.25, z);
    cone.renderOrder = 4;
    group.add(cone);
    beams.push(cone);
  });
  for (const u of [2.5, 5, 7.5]) glow([1.0, 0.8, 0.6], u - 0.12, u + 0.12, 12.05, 12.2, trussY - 0.2, trussY);

  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.receiveShadow = true;
  group.add(mesh);

  // Signs and posters.
  const plane = (tex: THREE.Texture, w: number, h: number, u: number, t: number, y: number, normal: 'out' | 'in' | '+u' | '-u', bright = 1): void => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(bright, bright, bright), transparent: true });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const [x, z] = toWorld(f, u, t);
    m.position.set(x, y, z);
    const n = normal === 'out' ? f.n : normal === 'in' ? [-f.n[0], 0, -f.n[2]] : normal === '+u' ? f.r : [-f.r[0], 0, -f.r[2]];
    m.rotation.y = Math.atan2(n[0], n[2]);
    group.add(m);
  };
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  const neon = (g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string): void => {
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    for (const blur of [24, 10]) {
      g.shadowBlur = blur;
      g.fillStyle = color;
      g.fillText(text, x, y);
    }
    g.shadowBlur = 0;
    g.fillStyle = '#fff4f0';
    g.fillText(text, x, y);
  };
  // Over the stairwell: LIVE HOUSE 地下室 B1 in red neon.
  plane(canvasTex(600, 200, (g) => {
    g.fillStyle = '#0c0808';
    g.fillRect(0, 0, 600, 200);
    neon(g, '地下室', 300, 80, "bold 104px 'Yu Mincho', 'MS Mincho', serif", '#ff3a30');
    neon(g, 'LIVE HOUSE  B1', 300, 165, "bold 44px 'Arial', sans-serif", '#ffb040');
  }), 3.0, 1.0, 1.7, -0.02, 3.4, 'out', 1.8);
  // A blade sign sticking out over the pavement.
  const blade = canvasTex(130, 520, (g) => {
    g.fillStyle = '#0c0808';
    g.fillRect(0, 0, 130, 520);
    ['地', '下', '室'].forEach((ch, i) => neon(g, ch, 65, 90 + i * 130, "bold 100px 'Yu Mincho', 'MS Mincho', serif", '#ff3a30'));
    neon(g, 'LIVE', 65, 470, "bold 40px 'Arial', sans-serif", '#ffb040');
  });
  box(0x1a1414, 3.28, 3.32, -0.9, -0.05, 4.4, 8.6);
  plane(blade, 0.8, 3.2, 3.33, -0.5, 6.5, '+u', 1.8);
  plane(blade, 0.8, 3.2, 3.27, -0.5, 6.5, '-u', 1.8);
  // Tonight's board at the top of the stairs.
  box(0x2a2a2a, 3.8, 4.2, -1.1, -0.8, 0, 1.2);
  plane(canvasTex(300, 420, (g) => {
    g.fillStyle = '#141414';
    g.fillRect(0, 0, 300, 420);
    g.fillStyle = '#f4f0e8';
    g.textAlign = 'center';
    g.font = "bold 34px 'Arial', sans-serif";
    g.fillText('TONIGHT', 150, 55);
    g.fillStyle = '#ff6fb0';
    g.font = "bold 44px 'Arial', sans-serif";
    g.fillText('JULIE', 150, 125);
    g.font = "bold 24px 'Yu Gothic', 'Meiryo', sans-serif";
    g.fillText('『MIDNIGHT PLASTIC』', 150, 165);
    g.fillText('RELEASE LIVE', 150, 195);
    g.fillStyle = '#f4f0e8';
    g.font = "22px 'Yu Gothic', 'Meiryo', sans-serif";
    g.fillText('guest: 夜光虫 / NEON GHOST', 150, 250);
    g.fillText('OPEN 19:00  START 19:30', 150, 300);
    g.fillText('ADV ¥3,000  DOOR ¥3,500', 150, 335);
    g.fillStyle = '#ffb040';
    g.fillText('B1 ↓', 150, 385);
  }), 0.62, 0.87, 4.0, -1.12, 0.75, 'out');
  // Gig posters (the approved art) down the stairwell, and the big one at the foot of the stairs.
  const loader = new THREE.TextureLoader();
  const arts = Object.values(posterArt).map((url) => {
    const tex = loader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
  const wide = arts.pop()!;
  arts.forEach((tex, i) => {
    const t = 1.2 + i * 1.2;
    const y = (floorLocal(1.5, t) ?? 0) + 1.55;
    plane(tex, 0.62, 0.8, i % 2 === 0 ? STAIR.u0 + 0.02 : STAIR.u1 - 0.02, t, y, i % 2 === 0 ? '+u' : '-u', 0.95);
  });
  plane(wide, 2.4, 1.2, 6.8, STAIR.t1 + 0.22, FL + 2.0, 'in', 1.0);
  // The backdrop on stage.
  plane(canvasTex(1000, 360, (g) => {
    g.fillStyle = '#08060c';
    g.fillRect(0, 0, 1000, 360);
    neon(g, '地下室', 500, 130, "bold 160px 'Yu Mincho', 'MS Mincho', serif", '#ff3a30');
    neon(g, "JULIE『MIDNIGHT PLASTIC』RELEASE LIVE", 500, 285, "bold 46px 'Yu Gothic', 'Meiryo', sans-serif", '#ff6fb0');
  }), 8.0, 2.9, 5.0, 21.78, STAGE.y + 1.9, 'out', 1.6);

  // People: the crowd and a drinker at the bar on the floor, the band on the stage.
  const crowd = new GhostBuilder();
  const person = (gb: GhostBuilder, u: number, t: number, du: number, dt: number, pose: Pose, i: number, body?: 'man' | 'woman'): void => {
    const [x, z] = toWorld(f, u, t);
    const spec: FigureSpec = {
      x,
      z,
      yaw: localYaw(f, du, dt),
      body: body ?? (i % 3 === 1 ? 'woman' : 'man'),
      pose,
      color: GHOST_COLORS[i % GHOST_COLORS.length],
      hair: body === 'woman' || i % 3 === 1 ? 'long' : i % 4 === 0 ? 'cap' : 'short',
      long: false,
      phase: 0,
      side: i % 2 === 0 ? 1 : -1,
      look: 0,
    };
    addFigure(gb, spec);
  };
  AUDIENCE.forEach(([u, t, pose], i) => person(crowd, u, t, (5 - u) * 0.1, 1, pose, i));
  person(crowd, BAR_CUSTOMER[0], BAR_CUSTOMER[1], -1, 0.2, 'talk', 20);
  const band = new GhostBuilder();
  BAND.forEach(([u, t, pose, body], i) => person(band, u, t, 0, -1, pose, i + 3, body));
  for (const [gb, y] of [[crowd, FL], [band, STAGE.y]] as const) {
    const geo = gb.build(0, 0);
    if (!geo) continue;
    const m = new THREE.Mesh(geo, ghost);
    m.position.y = y;
    m.renderOrder = 2;
    group.add(m);
  }

  let time = 0;
  return {
    group,
    update(camera, dt) {
      if (camera.y > 1.0 && Math.hypot(camera.x - f.p[0], camera.z - f.p[2]) > 40) return;
      time += dt;
      beams.forEach((c, i) => {
        c.rotation.x = Math.sin(time * 0.8 + i * 1.3) * 0.28;
        c.rotation.z = Math.cos(time * 0.6 + i * 0.9) * 0.28;
      });
    },
  };
}
