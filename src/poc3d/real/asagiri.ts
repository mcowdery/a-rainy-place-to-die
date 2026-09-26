import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { WIN } from './buildings';
import { addCar } from './cars';
import type { CityUniforms } from './city';
import { Kit, neonText, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toLocal, toWorld } from './localFrame';
import { EMIT } from './meshBuilder';
import { averageColour } from './screenLight';
import type { ScreenLight } from './screenLight';

/**
 * Asagiri's set pieces, all in the building's local frame (u along the street face, t inward; see
 * localFrame.ts). Story anchors: Stella Production (the idol agency: glamour out front, a staff entrance
 * and a car-park ramp round the side), the Toto Metropolitan Police HQ, and THE PEAK (a CEO's penthouse
 * tower). Flavour: Toto Bank, a law firm, the Hakkodo ad agency, two business hotels, the Shirasagi
 * members' club, and Toto City Hall (twin towers; an elevator to the observatory on tower A).
 * Each kind has a builder, collision rects and lightmap lights; city hall also has a raised floor.
 */
export const ASAGIRI_KINDS = ['idol_agency', 'police_hq', 'residence', 'bank', 'law_firm', 'ad_agency', 'biz_hotel', 'members_club', 'city_hall'] as const;
export type AsagiriKind = (typeof ASAGIRI_KINDS)[number];

const art = import.meta.glob(
  [
    '../../../assets/ads/kaburo/44_midnight_sisters.jpg',
    '../../../assets/ads/kaburo/25_julie_album.jpg',
    '../../../assets/ads/kaburo/26_julie_album.jpg',
    '../../../assets/ads/kaburo/mega/*.jpg',
  ],
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;
const artUrl = (name: string): string => Object.entries(art).find(([k]) => k.includes(name))![1];

// ---- Toto City Hall: the observatory ----
export const DECK_Y = 172;
/** Tower A (the east tower, looking out over Kaburo) carries the observatory; tower B is the west one. */
const TA = { u0: 48, u1: 70, t0: 20, t1: 44 } as const;
const CORE = { u0: 56, u1: 62, t0: 29, t1: 35 } as const;

/** Floor at a world point: the observatory floor inside tower A, for a walker already up there. */
export function asagiriFloor(kind: AsagiriKind, b: Building3, x: number, z: number, current: number): number | null {
  if (kind !== 'city_hall' || current < DECK_Y / 2) return null;
  const [u, t] = toLocal(localFrame(b), x, z);
  return u > TA.u0 && u < TA.u1 && t > TA.t0 && t < TA.t1 ? DECK_Y : null;
}

/** Colliders on the walker's level: the ground plan, or the observatory's walls and core up top. */
export function asagiriColliders(kind: AsagiriKind, b: Building3, floor: number): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  if (floor > 1) {
    if (kind !== 'city_hall' || floor < DECK_Y / 2) return [];
    return [
      R(TA.u0, TA.u1, TA.t0, TA.t0 + 0.4),
      R(TA.u0, TA.u1, TA.t1 - 0.4, TA.t1),
      R(TA.u0, TA.u0 + 0.4, TA.t0, TA.t1),
      R(TA.u1 - 0.4, TA.u1, TA.t0, TA.t1),
      R(CORE.u0, CORE.u1, CORE.t0, CORE.t1),
      R(50, 54, 38, 42),
    ];
  }
  switch (kind) {
    case 'idol_agency':
      return [R(8, 46, 8, 36), R(1.8, 6.2, 12, 17.2), R(10, 10.3, 2, 6.5), R(15.7, 16, 2, 6.5), R(10, 16, 6.2, 6.5)];
    case 'police_hq':
      return [R(4, 46, 10, 42), R(36, 38.5, 1.5, 4.5), ...[12, 16, 20].map((u) => R(u - 0.2, u + 0.2, 2.8, 3.2)), R(24, 29, 4, 8.6), R(30, 35, 4, 8.6)];
    case 'residence':
      return [R(4, 30, 10, 32), R(9, 9.4, 3, 3.4), R(24.6, 25, 3, 3.4), R(15, 20.6, 3.2, 8)];
    case 'bank':
      return [R(2, 28, 5, 26), ...[4, 9, 14, 19, 24].map((u) => R(u - 0.5, u + 0.5, 2.5, 3.5))];
    case 'law_firm':
      return [R(2, 22, 4, 24)];
    case 'ad_agency':
      return [R(2, 34, 6, 30)];
    case 'biz_hotel':
      return [R(1, 15, 2, 18)];
    case 'members_club':
      return [R(0, 12, 0, 0.6), R(18, 30, 0, 0.6), R(0, 0.6, 0, 26), R(29.4, 30, 0, 26), R(3, 27, 9, 25), R(3.5, 8.8, 3.5, 5.7), R(21, 22, 3, 4), R(8, 9, 3, 4)];
    case 'city_hall':
      return [R(4, 76, 14, 56), ...[8, 20, 56, 68].map((u) => R(u - 1, u + 1, 6, 8))];
  }
}

/** Covered volumes (no rain inside): the observatory tower, and the canopies you can stand under. */
export function asagiriShelters(kind: AsagiriKind, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, enclosed = false): { rect: Rect; y0: number; y1: number; enclosed: boolean } => ({ rect: localRect(f, u0, u1, t0, t1), y0, y1, enclosed });
  switch (kind) {
    case 'city_hall':
      return [R(TA.u0, TA.u1, TA.t0, TA.t1, 0, 200, true), R(55, 63, 10, 14, 0, 3.8)];
    case 'idol_agency':
      return [R(20, 34, 3, 8, 0, 4.6)];
    case 'residence':
      return [R(9, 25, 3, 10, 0, 5.2)];
    case 'police_hq':
      return [R(18, 32, 7, 10, 0, 8)];
    default:
      return [];
  }
}

export function asagiriLights(kind: AsagiriKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  const warm: [number, number, number] = [1.0, 0.82, 0.6];
  const cool: [number, number, number] = [0.85, 0.92, 1.0];
  switch (kind) {
    case 'idol_agency':
      return [L(27, 4, 9, [1.0, 0.6, 0.8], 0.9), L(13, 3, 5, [1.0, 0.8, 0.9], 0.5), L(4, 20, 4, [0.6, 0.7, 1.0], 0.3)];
    case 'police_hq':
      return [L(25, 6, 8, cool, 0.7), L(37, 3, 4, cool, 0.5), L(30, 6, 6, [0.4, 0.5, 1.0], 0.3)];
    case 'residence':
      return [L(17, 4, 8, warm, 0.8)];
    case 'bank':
      return [L(15, 2, 8, warm, 0.6), L(27, 2, 4, cool, 0.6)];
    case 'law_firm':
      return [L(12, 2, 5, warm, 0.55)];
    case 'ad_agency':
      return [L(18, 3, 10, [0.9, 0.7, 1.0], 0.8)];
    case 'biz_hotel':
      return [L(8, 1.5, 5, cool, 0.7)];
    case 'members_club':
      return [L(15, 2, 6, [1.0, 0.7, 0.4], 0.6), L(6, 4.6, 3, [1.0, 0.7, 0.4], 0.4), L(24, 4.6, 3, [1.0, 0.7, 0.4], 0.4)];
    case 'city_hall':
      return [L(40, 8, 12, cool, 0.6), L(59, 11, 5, warm, 0.6), L(21, 11, 5, warm, 0.6)];
  }
}

export interface AsagiriBuilt {
  readonly group: THREE.Group;
  /** Screens that light their surroundings. */
  readonly lights: ScreenLight[];
  update(camera: THREE.Vector3, dt: number): void;
}

/** Builds one set piece. id: the stamp id (business hotels come in two brands). */
export function buildAsagiri(kind: AsagiriKind, b: Building3, id: string, city: THREE.Material, ghost: THREE.Material, u: CityUniforms): AsagiriBuilt {
  const k = new Kit(b);
  const extra = BUILDERS[kind](k, id);
  const group = k.finish(city, ghost);
  return {
    group,
    lights: k.lights,
    update(camera, dt) {
      k.update(u);
      extra?.(camera, dt);
    },
  };
}

type Builder = (k: Kit, id: string) => ((camera: THREE.Vector3, dt: number) => void) | void;

/** A car parked in local coordinates, nose along local (du, dt). */
function car(k: Kit, u: number, t: number, du: number, dt: number, type: 'sedan' | 'minivan' | 'kei' | 'taxi', paint: number, variant: number): void {
  const [x, z] = toWorld(k.f, u, t);
  const fx = k.f.r[0] * du - k.f.n[0] * dt;
  const fz = k.f.r[2] * du - k.f.n[2] * dt;
  addCar(k.mb, { x, z, fx, fz, variant, type, paint });
}

/** A rotating image screen (LED-ish, bright) on a plane. */
function screen(k: Kit, urls: readonly string[], w: number, h: number, u: number, t: number, y: number, period = 7): (c: THREE.Vector3, dt: number) => void {
  const texes = urls.map((url) => k.image(url));
  const m = k.plane(texes[0], w, h, u, t, y, 'out', 1.15);
  let time = 0;
  // The screen as a light: the average colour of the image showing (measured once each has loaded).
  const avg: (THREE.Color | null)[] = texes.map(() => null);
  const [cx, cz] = toWorld(k.f, u, t);
  k.lights.push({
    centre: new THREE.Vector3(cx, y, cz),
    normal: new THREE.Vector3(k.f.n[0], 0, k.f.n[2]),
    halfW: w / 2,
    halfH: h / 2,
    colour(_t, _neon, out) {
      const i = Math.floor(time / period) % texes.length;
      const img = texes[i].image as HTMLImageElement | undefined;
      if (!avg[i] && img?.complete && img.naturalWidth) avg[i] = averageColour(img, 0, 0, img.naturalWidth, img.naturalHeight);
      return avg[i] ? out.copy(avg[i]!).multiplyScalar(1.15) : out.setRGB(0, 0, 0);
    },
  });
  return (_c, dt) => {
    time += dt;
    (m.material as THREE.MeshBasicMaterial).map = texes[Math.floor(time / period) % texes.length];
  };
}

const BUILDERS: Record<AsagiriKind, Builder> = {
  // ---- STELLA PRODUCTION: glossy tower, idol banners, red carpet; round the side, the staff entrance ----
  idol_agency(k) {
    const PINK: [number, number, number] = [1.3, 0.35, 0.8];
    // Podium: lit glass lobby on the front, white stone above; tower of pale glass.
    k.lit(0xf4ecf0, 8.2, 45.8, 8.2, 35.8, -0.01, 0.02, true);
    k.lit(0xfff4f8, 8.2, 45.8, 8.5, 35.8, 7.4, 7.6, true);
    k.glow([1.4, 1.2, 1.3], 10, 44, 9, 9.3, 7.3, 7.4);
    k.box(0x2a2228, 8, 46, 34, 36, 0, 7.6);
    k.box(0xe8e4e8, 8, 46, 8, 36, 7.6, 16);
    k.box(0xe8e4e8, 8, 8.3, 8, 36, 0, 7.6);
    k.box(0xe8e4e8, 45.7, 46, 8, 36, 0, 7.6);
    k.pane(8.3, 45.7, 0, 7.4, 8.1);
    for (let u = 8; u <= 46; u += 3.8) k.box(0xd8c890, u - 0.06, u + 0.06, 7.9, 8.1, 0, 7.6);
    // Lobby: reception desk, a gold logo wall, a white grand stair, sofas.
    k.lit(0xf8f4f0, 22, 32, 20, 22, 0, 1.1, true);
    k.glow([1.3, 1.0, 0.45], 20, 34, 30, 30.2, 2, 6);
    k.lit(0xffffff, 36, 44, 24, 34, 0, 0.4, true);
    for (let s = 0; s < 8; s++) k.lit(0xffffff, 36, 44, 24 + s * 1.2, 34, s * 0.45, s * 0.45 + 0.45, true);
    for (const u of [13, 17]) k.lit(0xd04a80, u - 1, u + 1, 14, 15.2, 0, 0.8, true);
    k.facade(0x6a8aa0, [1.6, 0.8, 2.2, WIN.curtain], 8 + 6 * 16, 12, 42, 12, 32, 16, 146);
    k.box(0xe8e4e8, 11, 43, 11, 33, 146, 150);
    k.glow(PINK, 11, 43, 10.9, 11, 146.4, 146.9, EMIT.neon);
    // The crown: a lit fin and a star.
    k.box(0xe8e4e8, 26.5, 27.5, 20, 24, 150, 164);
    k.glow([1.6, 1.4, 0.8], 26.6, 27.4, 19.9, 20, 158, 163, EMIT.neon);
    // Entrance: a gold canopy, the red carpet to the kerb, stanchions, the fans behind the rope.
    k.box(0xd8b060, 20, 34, 3, 8, 4.6, 4.9);
    k.glow([1.4, 1.2, 0.9], 20.3, 33.7, 3.3, 7.8, 4.57, 4.6);
    k.post(0xd8b060, 20.3, 3.3, 0, 4.6, 0.1);
    k.post(0xd8b060, 33.7, 3.3, 0, 4.6, 0.1);
    k.box(0xa01830, 24.5, 29.5, -2, 8, 0, 0.03);
    for (let t = -1.5; t < 7.6; t += 1.8) for (const u of [24, 30]) {
      k.post(0xd8b060, u, t, 0, 1.0, 0.04, 6);
    }
    k.box(0x8a1020, 24, 24.05, -1.5, 7.6, 0.8, 0.86);
    k.box(0x8a1020, 29.95, 30, -1.5, 7.6, 0.8, 0.86);
    const fanColors: [number, number, number][] = [[1.0, 0.42, 0.72], [0.68, 0.52, 1.0], [0.35, 0.85, 1.0], [1.0, 0.72, 0.32]];
    [[11, 3], [12.2, 4.6], [13.6, 2.8], [14.8, 4.2], [11.6, 5.6]].forEach(([fu, ft], i) =>
      k.person(fu, ft, 1, 0.2, { body: i % 2 ? 'woman' : 'man', pose: i % 3 === 0 ? 'wave' : 'phone', color: fanColors[i % 4], hair: i % 2 ? 'long' : 'cap' }),
    );
    k.box(0x2a2a2e, 10, 16, 6.2, 6.5, 0, 1.0);
    // Banners and the LED screen: Julie on the tower's corners, the idol ads on the podium screen.
    k.plane(k.image(artUrl('25_julie_album')), 7, 10.5, 15, 11.95, 34, 'out', 1.05);
    k.plane(k.image(artUrl('26_julie_album')), 7, 10.5, 39, 11.95, 34, 'out', 1.05);
    k.box(0x141418, 17, 37, 7.7, 8, 8.4, 15.4);
    const tick = screen(k, [artUrl('65_mega_idol'), artUrl('44_midnight_sisters')], 19.4, 6.6, 27, 7.68, 11.9);
    k.plane(k.canvas(1600, 260, (g) => {
      g.clearRect(0, 0, 1600, 260);
      neonText(g, 'STELLA PRODUCTION', 800, 110, "italic bold 150px 'Georgia', serif", '#ff6fc0');
      neonText(g, 'ステラプロダクション', 800, 225, "bold 64px 'Yu Gothic', 'Meiryo', sans-serif", '#ffd0ea');
    }), 20, 3.25, 27, 10.95, 142.5, 'out', 1.6, true);
    k.plane(k.canvas(900, 150, (g) => {
      g.fillStyle = '#1a1418';
      g.fillRect(0, 0, 900, 150);
      text(g, '✦ STELLA PRODUCTION', 450, 78, "italic bold 72px 'Georgia', serif", '#e8c878');
    }), 12, 2, 27, 2.95, 5.6, 'out', 1.2);
    // Round the west side: the staff entrance under a bare lamp, a black van, the ramp down to the car park.
    k.box(0x3a3a3e, 7.9, 8, 21, 22.4, 0, 2.3);
    k.glow([0.9, 0.95, 1.0], 7.7, 7.9, 21.5, 21.9, 2.6, 2.75, EMIT.lamp);
    k.plane(k.canvas(300, 90, (g) => {
      g.fillStyle = '#e8e8e4';
      g.fillRect(0, 0, 300, 90);
      text(g, '関係者以外立入禁止', 150, 45, "bold 34px 'Yu Gothic', sans-serif", '#a01818');
    }), 1.3, 0.4, 7.95, 21.7, 2.2, '-u');
    k.box(0x0a0a0c, 7.95, 8, 26, 33, 0, 3.2);
    k.box(0x2a2a2c, 2, 8, 26, 33, -0.02, 0.02);
    k.box(0xe8c020, 7.94, 7.96, 25.8, 33.2, 3.2, 3.4);
    car(k, 4, 14.6, 0, -1, 'minivan', 0x0c0c0e, 31);
    return tick;
  },

  // ---- TOTO METROPOLITAN POLICE HQ: solid, blocky stone; flags, a guard post, patrol cars, the mast ----
  police_hq(k) {
    const STONE = 0xbdb29c;
    k.box(0x8a8478, 4, 46, 10, 42, 0, 12);
    k.box(0x0e0e10, 20, 30, 9.6, 10, 0, 8);
    k.lit(0xd8d8d0, 20.2, 29.8, 9.8, 10, 0, 7.8);
    k.box(0x6a665e, 18, 32, 7, 10, 8, 9);
    for (const u of [20, 30]) k.box(0x8a8478, u - 0.5, u + 0.5, 7, 10, 0, 8);
    // The tower: stone with small, deep windows; heavy fins; a setback crown.
    k.facade(STONE, [2.4, 0.38, 1.3, WIN.punched], 1 * 16, 8, 42, 14, 40, 12, 96);
    for (let u = 8; u <= 42; u += 4.25) k.box(0xa89e88, u - 0.3, u + 0.3, 13.4, 14, 12, 96);
    k.box(0x8a8478, 7.5, 42.5, 13.5, 40.5, 96, 98);
    k.facade(STONE, [2.4, 0.3, 1.2, WIN.punched], 0, 14, 36, 20, 34, 98, 110);
    k.box(0x8a8478, 13.5, 36.5, 19.5, 34.5, 110, 111);
    // The communications mast: a lattice tower with dishes and red aviation lights.
    for (const [a, c] of [[21, 25], [29, 25], [21, 31], [29, 31]]) k.box(0x9a9ea2, a - 0.2, a + 0.2, c - 0.2, c + 0.2, 111, 140);
    for (let y = 114; y < 140; y += 4) {
      k.box(0x9a9ea2, 21, 29, 24.9, 25.1, y, y + 0.2);
      k.box(0x9a9ea2, 21, 29, 30.9, 31.1, y, y + 0.2);
      k.box(0x9a9ea2, 20.9, 21.1, 25, 31, y, y + 0.2);
      k.box(0x9a9ea2, 28.9, 29.1, 25, 31, y, y + 0.2);
    }
    k.box(0x9a9ea2, 24.8, 25.2, 27.8, 28.2, 140, 158);
    for (const y of [124, 132]) k.lathe(0xe8e8e4, 21, 25, [[y - 1.2, 0.02], [y - 0.6, 1.1], [y, 1.25]], 12);
    for (const [a, c, y] of [[21, 25, 140.3], [29, 31, 140.3], [25, 28, 158.2]]) k.glow([1.6, 0.1, 0.1], a - 0.2, a + 0.2, c - 0.2, c + 0.2, y, y + 0.3);
    // The emblem over the entrance: a gold sunburst star.
    k.plane(k.canvas(400, 400, (g) => {
      g.fillStyle = '#b89030';
      g.translate(200, 200);
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
    }), 3.2, 3.2, 25, 6.98, 10.6, 'out', 1.1);
    k.plane(k.canvas(1200, 160, (g) => {
      g.fillStyle = '#8a8478';
      g.fillRect(0, 0, 1200, 160);
      text(g, '東都警視庁', 600, 62, "bold 84px 'Yu Mincho', 'MS Mincho', serif", '#2a2620');
      text(g, 'TOTO METROPOLITAN POLICE DEPARTMENT', 600, 132, "bold 38px 'Times New Roman', serif", '#2a2620');
    }), 14, 1.87, 25, 6.98, 8.5, 'out', 1.0);
    // Forecourt: flagpoles, a guard post and a barrier on the drive, patrol cars.
    for (const [fu, color] of [[12, '#ffffff'], [16, '#1a3a8a'], [20, '#ffffff']] as const) {
      k.post(0xc8c8cc, fu, 3, 0, 12, 0.07, 8);
      k.plane(k.canvas(90, 60, (g) => {
        g.fillStyle = color;
        g.fillRect(0, 0, 90, 60);
        g.fillStyle = color === '#ffffff' ? '#c02020' : '#e8c860';
        g.beginPath();
        g.arc(45, 30, 16, 0, Math.PI * 2);
        g.fill();
      }), 1.8, 1.2, fu + 0.95, 3, 11.2, 'out', 1.0);
    }
    k.box(0xe8e4dc, 36, 38.5, 1.5, 4.5, 0, 2.6);
    k.lit(0xf4f4f0, 36.1, 38.4, 1.4, 1.5, 1.0, 2.2);
    k.box(0x3a3a3e, 35.8, 38.7, 1.3, 4.7, 2.6, 2.8);
    k.glow([1.5, 0.1, 0.1], 36.9, 37.6, 1.35, 1.45, 2.3, 2.5, EMIT.lamp);
    k.box(0xd8d8d0, 39, 46, 0.9, 1.1, 0.9, 1.05);
    for (let u = 39.5; u < 46; u += 1.4) k.box(0xc02020, u, u + 0.7, 0.88, 1.12, 0.9, 1.05);
    k.person(37.2, 5.2, 0, -1, { pose: 'stand', color: [0.4, 0.55, 1.0], hair: 'cap', long: true });
    for (const [pu, i] of [[26.5, 0], [32.5, 1]] as const) {
      car(k, pu, 6.3, 0, -1, 'sedan', 0xf0f0ee, 400 + i);
      k.box(0x1a1a1c, pu - 0.55, pu + 0.55, 6.1, 6.5, 1.46, 1.56);
      k.glow([1.6, 0.08, 0.08], pu - 0.5, pu - 0.05, 6.05, 6.55, 1.56, 1.68, EMIT.lamp);
      k.glow([0.9, 0.9, 1.0], pu + 0.05, pu + 0.5, 6.05, 6.55, 1.56, 1.68, EMIT.lamp);
    }
  },

  // ---- THE PEAK: stone and glass residences, a lit penthouse crown with a roof terrace; the private drive ----
  residence(k) {
    const STONE = 0xd8d0c0;
    k.box(0x8a8070, 4, 30, 18, 32, 0, 6);
    k.box(0x8a8070, 4, 10, 10, 18, 0, 6);
    k.box(0x8a8070, 24, 30, 10, 18, 0, 6);
    k.box(0x8a8070, 10, 24, 10, 18, 5.4, 6);
    k.lit(0xf0e4d0, 10, 24, 10.2, 18, -0.01, 0.02, true);
    k.lit(0xf6ecdc, 10, 24, 10.5, 18, 5.2, 5.4, true);
    k.pane(10, 24, 0, 5.2, 10.1);
    k.glow([1.3, 1.0, 0.6], 12, 22, 17.8, 18, 1.5, 4.5);
    k.lit(0x3a2a1e, 15, 19, 14, 15, 0, 1.1, true);
    k.person(17, 15.6, 0, -1, { pose: 'stand', color: [0.9, 0.82, 0.62], long: true });
    k.facade(STONE, [3.4, 0.62, 2.1, WIN.balcony], 8 + 5 * 16, 6, 28, 12, 30, 6, 136);
    for (let y = 9; y < 136; y += 3) k.box(0xe8e2d8, 5.6, 28.4, 11.6, 12, y, y + 0.18);
    // Penthouse: a double-height glass pavilion, lit warm, and the terrace round it.
    k.box(STONE, 5, 29, 11, 31, 136, 136.6);
    k.lit(0xe8dccc, 10, 24, 16, 26, 136.6, 136.7, true);
    k.glow([0.34, 0.24, 0.13], 10.2, 23.8, 16, 16.1, 137, 142.6, EMIT.lamp);
    k.glow([0.34, 0.24, 0.13], 10, 10.1, 16.2, 25.8, 137, 142.6, EMIT.lamp);
    k.glow([0.34, 0.24, 0.13], 23.9, 24, 16.2, 25.8, 137, 142.6, EMIT.lamp);
    k.box(0x2a2a2e, 9.6, 24.4, 15.6, 26.4, 142.6, 143.4);
    for (let u = 10; u <= 24; u += 2) k.box(0x2a2a2e, u - 0.05, u + 0.05, 15.95, 16.05, 136.6, 142.6);
    k.glow([0.1, 0.55, 0.7], 12, 22, 12, 15, 136.6, 136.72, EMIT.lamp);
    for (const [pu, pt] of [[7, 13], [27, 13], [7, 28], [27, 28]]) {
      k.box(0x5a4a3a, pu - 0.7, pu + 0.7, pt - 0.7, pt + 0.7, 136.6, 137.4);
      k.lathe(0x2e5a34, pu, pt, [[137.4, 0.1], [138.4, 1.1], [139.8, 0.9], [140.6, 0.1]], 8);
    }
    k.box(0x9ab0b8, 5, 29, 11, 11.1, 136.6, 137.8);
    // Porte-cochère over the drive, with the car waiting.
    k.box(0x2a2a2e, 9, 25, 3, 10, 5.2, 5.6);
    k.glow([1.2, 0.95, 0.65], 9.4, 24.6, 3.4, 9.6, 5.17, 5.2);
    for (const u of [9.2, 24.8]) k.post(0x2a2a2e, u, 3.2, 0, 5.2, 0.2);
    k.box(0x7a7468, 4, 30, -1, 10, -0.01, 0.025);
    car(k, 17.8, 5.6, 1, 0, 'sedan', 0x0a0a0c, 77);
    k.plane(k.canvas(700, 150, (g) => {
      g.fillStyle = '#2a2a2e';
      g.fillRect(0, 0, 700, 150);
      text(g, 'THE PEAK', 350, 62, "300 76px 'Georgia', serif", '#e8d8b0');
      text(g, 'ASAGIRI · ザ・ピーク朝霧', 350, 118, "28px 'Yu Gothic', 'Meiryo', sans-serif", '#c8b890');
    }), 5.6, 1.2, 17, 2.97, 6.1, 'out', 1.1);
  },

  // ---- TOTO BANK: a stone colonnade and a green-signed block ----
  bank(k) {
    k.box(0xcfc6b4, 2, 28, 5, 26, 0, 1.0);
    k.lit(0xe8dcc0, 3, 27, 6, 25, 1.0, 1.02, true);
    k.box(0x2a2a2e, 3, 27, 6.8, 7, 1, 8.4);
    k.lit(0xfff4dc, 12, 18, 6.7, 6.8, 1, 5);
    for (const cu of [4, 9, 14, 19, 24]) {
      k.lathe(0xe0d8c8, cu, 3, [[1, 0.5], [1.2, 0.42], [8.2, 0.38], [8.4, 0.5]], 14);
    }
    k.box(0xcfc6b4, 2, 28, 2, 7, 8.4, 10);
    k.box(0xcfc6b4, 2, 28, 5, 26, 10, 11);
    k.facade(0xc8bca4, [2.2, 0.55, 1.4, WIN.ribbon], 3 * 16, 3, 27, 7, 25, 11, 44);
    k.plane(k.canvas(1000, 150, (g) => {
      g.fillStyle = '#0e5a3a';
      g.fillRect(0, 0, 1000, 150);
      g.fillStyle = '#e8c860';
      g.beginPath();
      g.arc(80, 75, 46, 0, Math.PI * 2);
      g.fill();
      text(g, '東', 80, 78, "bold 58px 'Yu Mincho', serif", '#0e5a3a');
      text(g, '東都銀行', 400, 72, "bold 84px 'Yu Mincho', 'MS Mincho', serif", '#ffffff');
      text(g, 'TOTO BANK', 800, 76, "bold 58px 'Times New Roman', serif", '#e8c860');
    }), 13, 1.95, 15, 1.97, 9.2, 'out', 1.1);
    k.lit(0xe8e8e4, 26.6, 28, 3, 5, 0, 2.6);
    k.plane(k.canvas(200, 90, (g) => {
      g.fillStyle = '#0e5a3a';
      g.fillRect(0, 0, 200, 90);
      text(g, 'ATM 24H', 100, 48, "bold 44px 'Arial', sans-serif", '#ffffff');
    }), 1.3, 0.6, 27.3, 2.97, 2.95, 'out', 1.2);
  },

  // ---- TODO & KIRYU: dark granite, a brass plate, a lamp at the door ----
  law_firm(k) {
    k.facade(0x3e3e44, [2.0, 0.4, 1.6, WIN.punched], 8 + 4 * 16, 2, 22, 4, 24, 0, 48, true);
    k.box(0x2a2a2e, 1.8, 22.2, 3.8, 24.2, 48, 49);
    for (let u = 2; u <= 22; u += 2.5) k.box(0x4a4a50, u - 0.15, u + 0.15, 3.7, 4, 4.2, 48);
    k.box(0x2a2a2e, 9, 15, 1.2, 4, 3.4, 3.7);
    k.glow([1.2, 1.0, 0.7], 9.4, 14.6, 1.5, 3.8, 3.37, 3.4);
    k.plane(k.canvas(600, 300, (g) => {
      g.fillStyle = '#a8883a';
      g.fillRect(0, 0, 600, 300);
      g.strokeStyle = '#6a5420';
      g.lineWidth = 6;
      g.strokeRect(10, 10, 580, 280);
      text(g, '藤堂・桐生', 300, 80, "bold 64px 'Yu Mincho', 'MS Mincho', serif", '#2a1e08');
      text(g, '法律事務所', 300, 160, "bold 64px 'Yu Mincho', 'MS Mincho', serif", '#2a1e08');
      text(g, 'TODO & KIRYU  ATTORNEYS AT LAW', 300, 240, "bold 26px 'Times New Roman', serif", '#2a1e08');
    }), 1.2, 0.6, 16.2, 3.97, 1.6, 'out', 1.0);
  },

  // ---- HAKKODO: a dark glass tower, a big LED screen, a coloured crown ----
  ad_agency(k) {
    k.facade(0x2e3b45, [1.5, 0.85, 2.4, WIN.curtain], 8 + 6 * 16, 2, 34, 6, 30, 16, 112);
    k.box(0x1a1a1e, 2, 34, 6, 30, 0, 16);
    k.lit(0xe8e8f0, 3, 33, 5.9, 6, 0, 4.4);
    k.box(0x0c0c0e, 7, 29, 5.7, 6, 5, 15.4);
    const tick = screen(k, [artUrl('49_mega_cosmetics'), artUrl('64_mega_soda'), artUrl('51_mega_whisky'), artUrl('80_mega_kaburo')], 21, 11.8, 18, 5.68, 10.2, 6);
    const crown = k.canvas(1200, 160, (g) => {
      g.clearRect(0, 0, 1200, 160);
      const colors = ['#ff4fa8', '#ffb040', '#4fe3ff', '#6bff8a', '#b48cff', '#ff4f4f', '#ffe45f'];
      [...'HAKKODO'].forEach((ch, i) => neonText(g, ch, 110 + i * 164, 90, "900 140px 'Arial Black', 'Arial', sans-serif", colors[i]));
    });
    k.box(0x1a1a1e, 2, 34, 6, 30, 112, 116);
    k.plane(crown, 24, 3.2, 18, 5.97, 114, 'out', 1.5, true);
    k.plane(k.canvas(700, 120, (g) => {
      g.fillStyle = '#0e0e10';
      g.fillRect(0, 0, 700, 120);
      text(g, '博光堂  HAKKODO INC.', 350, 62, "bold 58px 'Yu Gothic', 'Arial', sans-serif", '#f4f4f4');
    }), 7, 1.2, 18, 5.66, 4.4, 'out', 1.1);
    return tick;
  },

  // ---- Business hotels: narrow slabs of small windows, a vertical sign, a rate board ----
  biz_hotel(k, id) {
    const tabiji = id.includes('tabiji');
    const [bg, ink, name, en] = tabiji ? ['#1a4a8a', '#ffffff', 'ホテル旅路', 'HOTEL TABIJI'] : ['#e8e8e4', '#d02020', '東都イン', 'TOTO INN'];
    k.facade(tabiji ? 0xd8d4cc : 0xb8b4ac, [1.8, 0.45, 1.3, WIN.small], 5 * 16 + (tabiji ? 128 : 0), 1, 15, 2, 18, 4.2, 48);
    k.box(0x3a3a3e, 1, 15, 2, 18, 48, 48.8);
    k.box(0x2a2a2e, 1, 15, 2, 18, 0, 4.2);
    k.lit(0xf0f0ea, 3, 13, 1.9, 2, 0, 3.6);
    k.pane(3, 13, 0, 3.6, 1.95);
    k.box(0x1a1a1c, 14.6, 15.4, 0.4, 1.2, 8, 30);
    k.plane(k.canvas(140, 900, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, 140, 900);
      [...name].forEach((ch, i) => text(g, ch, 70, 90 + i * 150, "900 110px 'Yu Gothic', 'Meiryo', sans-serif", ink));
    }), 1.8, 11.6, 15.41, 0.8, 19, '+u', 1.2, true);
    k.plane(k.canvas(800, 140, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, 800, 140);
      text(g, `${name}  ${en}`, 400, 72, "bold 64px 'Yu Gothic', 'Arial', sans-serif", ink);
    }), 10, 1.75, 8, 1.97, 4.1, 'out', 1.2, true);
    k.plane(k.canvas(300, 400, (g) => {
      g.fillStyle = '#f4f4f0';
      g.fillRect(0, 0, 300, 400);
      text(g, en, 150, 50, "bold 36px 'Arial', sans-serif", tabiji ? '#1a4a8a' : '#d02020');
      text(g, 'シングル ¥6,800', 150, 150, "bold 36px 'Yu Gothic', sans-serif", '#1a1a1a');
      text(g, 'ツイン ¥11,000', 150, 210, "bold 36px 'Yu Gothic', sans-serif", '#1a1a1a');
      text(g, '朝食無料 · 大浴場', 150, 290, "30px 'Yu Gothic', sans-serif", '#1a1a1a');
      text(g, '空室あり', 150, 355, "bold 40px 'Yu Gothic', sans-serif", '#20a050');
    }), 0.75, 1.0, 13.9, 1.97, 1.2, 'out', 1.1);
  },

  // ---- SHIRASAGI: a members' club behind a garden wall; timber lattice, lanterns, a doorman ----
  members_club(k) {
    const WALL = 0x3a3632;
    k.box(WALL, 0, 12, 0, 0.6, 0, 2.2);
    k.box(WALL, 18, 30, 0, 0.6, 0, 2.2);
    k.box(WALL, 0, 0.6, 0, 26, 0, 2.2);
    k.box(WALL, 29.4, 30, 0, 26, 0, 2.2);
    k.box(0x5a5650, -0.1, 30.1, -0.1, 0.7, 2.2, 2.35);
    for (const u of [12, 18]) k.box(0x2a1e16, u - 0.3, u + 0.3, -0.1, 0.7, 0, 3.0);
    k.box(0x2a1e16, 11.5, 18.5, -0.3, 0.9, 3.0, 3.3);
    // Gravel, a stone path, the pavilion: stone plinth, timber lattice, deep eaves.
    k.box(0xb8b0a0, 0.6, 29.4, 0.6, 26, -0.01, 0.02);
    for (let t = 0.8; t < 9; t += 1.1) k.box(0x8a867c, 13.6, 16.4, t, t + 0.9, 0, 0.06);
    k.box(0x5a5650, 3, 27, 9, 25, 0, 0.6);
    k.box(0x2a1e16, 3.2, 26.8, 9.2, 24.8, 0.6, 7.6);
    k.lit(0xd8b080, 4, 26, 9.1, 9.2, 1.2, 3.4);
    for (let u = 4; u < 26; u += 0.35) k.box(0x3a2a1c, u, u + 0.08, 8.95, 9.1, 0.6, 7.2);
    k.lit(0xe8c890, 13.6, 16.4, 9, 9.15, 0.6, 3.2);
    k.box(0x1e1e20, 1.5, 28.5, 7.4, 26.5, 7.6, 8.1);
    k.box(0x1e1e20, 2.5, 27.5, 9, 25, 8.1, 9.4);
    // Stone lanterns, bamboo, a pine; the car at the gate; the doorman.
    for (const lu of [6, 24]) {
      k.lathe(0x8a867c, lu, 4.6, [[0, 0.3], [0.2, 0.25], [0.2, 0.1], [1.0, 0.1]], 8);
      k.box(0x8a867c, lu - 0.3, lu + 0.3, 4.3, 4.9, 1.0, 1.1);
      k.glow([0.34, 0.2, 0.08], lu - 0.18, lu + 0.18, 4.42, 4.78, 1.1, 1.45, EMIT.lamp);
      k.box(0x7a766c, lu - 0.4, lu + 0.4, 4.2, 5.0, 1.45, 1.6);
    }
    for (let i = 0; i < 12; i++) k.post(0x5a8a3a, 1.2 + (i % 4) * 0.5, 2 + Math.floor(i / 4) * 0.6, 0, 4 + (i % 3) * 0.6, 0.04, 5);
    k.lathe(0x3a2a1c, 26, 5, [[0, 0.2], [3.4, 0.14]], 7);
    k.lathe(0x2a4a2c, 26, 5, [[2.6, 0.1], [3.0, 1.5], [3.6, 1.2], [4.0, 0.1]], 9);
    car(k, 8.9, -2.6, 1, 0, 'sedan', 0x0a0a0c, 91);
    k.person(19.2, -0.9, 0, -1, { pose: 'stand', color: [0.9, 0.82, 0.62], long: true, hair: 'short' });
    k.plane(k.canvas(160, 420, (g) => {
      g.fillStyle = '#e8e4d8';
      g.fillRect(0, 0, 160, 420);
      ['白', '鷺'].forEach((ch, i) => text(g, ch, 80, 90 + i * 140, "bold 110px 'Yu Mincho', 'MS Mincho', serif", '#1a1a1a'));
      text(g, '会員制', 80, 370, "bold 40px 'Yu Mincho', serif", '#6a1a1a');
    }), 0.45, 1.2, 18.6, -0.12, 1.7, 'out', 1.0);
  },

  // ---- TOTO CITY HALL: twin stone towers on a civic podium; the observatory on tower A ----
  city_hall(k) {
    const STONE = 0xcac2b2;
    // Plaza: paving, planters, lamp posts; the podium.
    k.box(0xb8b2a6, 0, 80, 0, 14, -0.01, 0.025);
    for (const pu of [8, 20, 56, 68]) {
      k.box(0x8a867c, pu - 1, pu + 1, 6, 8, 0, 0.6);
      k.lathe(0x2e5a34, pu, 7, [[0.6, 0.1], [1.4, 1.0], [2.2, 0.8], [2.8, 0.1]], 9);
    }
    k.facade(STONE, [2.4, 0.4, 1.8, WIN.ribbon], 3 * 16, 4, 76, 14, 56, 0, 24);
    k.box(0x8a867c, 3.5, 76.5, 13.5, 56.5, 24, 25);
    // The twin towers: stone grids with dark bands; tower A carries the observatory.
    for (const [u0, u1, top] of [[TA.u0, TA.u1, DECK_Y], [10, 32, 178]] as const) {
      k.facade(STONE, [2.2, 0.5, 1.6, WIN.punched], 2 * 16, u0, u1, TA.t0, TA.t1, 25, top);
      for (let y = 36; y < top; y += 24) k.box(0x6a665e, u0 - 0.2, u1 + 0.2, TA.t0 - 0.2, TA.t1 + 0.2, y, y + 1.2);
      for (const [a, c] of [[u0, TA.t0], [u1, TA.t0], [u0, TA.t1], [u1, TA.t1]]) k.box(0xb0a898, a - 1.2, a + 1.2, c - 1.2, c + 1.2, 25, top + 12);
    }
    k.box(0x9a9488, 10, 32, TA.t0, TA.t1, 178, 186);
    // Observatory: glass all round with mullions, floor and ceiling lit, the lift core, benches, a café.
    const Y = DECK_Y;
    k.lit(0x8a8680, TA.u0, TA.u1, TA.t0, TA.t1, Y - 0.3, Y, true);
    k.lit(0xf0eeea, TA.u0, TA.u1, TA.t0, TA.t1, Y + 5.6, Y + 6.0, true);
    for (const t of [24, 32, 40]) k.glow([1.3, 1.3, 1.25], TA.u0 + 1, TA.u1 - 1, t - 0.08, t + 0.08, Y + 5.55, Y + 5.6);
    k.pane(TA.u0, TA.u1, Y, Y + 5.6, TA.t0);
    k.pane(TA.u0, TA.u1, Y, Y + 5.6, TA.t1);
    k.paneT(TA.u0, TA.t0, TA.t1, Y, Y + 5.6);
    k.paneT(TA.u1, TA.t0, TA.t1, Y, Y + 5.6);
    for (let u = TA.u0; u <= TA.u1; u += 2.2) for (const t of [TA.t0, TA.t1]) k.box(0x3a3a3e, u - 0.05, u + 0.05, t - 0.05, t + 0.05, Y, Y + 5.6);
    for (let t = TA.t0; t <= TA.t1; t += 2.4) for (const u of [TA.u0, TA.u1]) k.box(0x3a3a3e, u - 0.05, u + 0.05, t - 0.05, t + 0.05, Y, Y + 5.6);
    k.box(0x3a3a3e, TA.u0, TA.u1, TA.t0 - 0.1, TA.t0 + 0.1, Y, Y + 0.9);
    k.lit(0xc8c4bc, CORE.u0, CORE.u1, CORE.t0, CORE.t1, Y, Y + 5.6, true);
    k.lit(0x9aa0a8, 57.6, 60.4, CORE.t0 - 0.02, CORE.t0, Y, Y + 2.4, true);
    k.box(0x3a3a3e, 58.97, 59.03, CORE.t0 - 0.03, CORE.t0, Y, Y + 2.4);
    for (const [bu, bt] of [[52, 23], [66, 23], [66, 41]]) k.lit(0x6a5a4a, bu - 1.2, bu + 1.2, bt - 0.3, bt + 0.3, Y, Y + 0.45, true);
    k.lit(0xe8e0d0, 50, 54, 38, 42, Y, Y + 1.05, true);
    // Signs: the name on the podium, the observatory's sign at the lift door and outside it.
    k.plane(k.canvas(1400, 160, (g) => {
      g.fillStyle = '#8a867c';
      g.fillRect(0, 0, 1400, 160);
      text(g, '東都市庁舎  TOTO CITY HALL', 700, 84, "bold 86px 'Yu Mincho', 'Times New Roman', serif", '#2a2620');
    }), 20, 2.3, 40, 13.97, 20, 'out', 1.0);
    k.box(0x2a2a2e, 55, 63, 10, 14, 3.4, 3.8);
    k.glow([1.2, 1.1, 0.9], 55.3, 62.7, 10.3, 13.8, 3.37, 3.4);
    k.lit(0xe8e8e4, 57, 61, 13.9, 14, 0, 3.0, true);
    k.plane(k.canvas(700, 200, (g) => {
      g.fillStyle = '#1a2a4a';
      g.fillRect(0, 0, 700, 200);
      text(g, '展望室 OBSERVATORY', 350, 72, "bold 64px 'Yu Gothic', 'Arial', sans-serif", '#ffffff');
      text(g, '172 m · 入場無料 FREE ENTRY', 350, 150, "bold 40px 'Yu Gothic', 'Arial', sans-serif", '#e8c860');
    }), 4.2, 1.2, 59, 13.95, 4.5, 'out', 1.1);
    k.plane(k.canvas(700, 200, (g) => {
      g.fillStyle = '#1a2a4a';
      g.fillRect(0, 0, 700, 200);
      text(g, '展望室 · 172 m', 350, 80, "bold 70px 'Yu Gothic', 'Arial', sans-serif", '#ffffff');
      text(g, '▼ 1F  エレベーター', 350, 155, "bold 40px 'Yu Gothic', sans-serif", '#e8c860');
    }), 2.8, 0.8, 59, CORE.t0 - 0.03, Y + 3.2, 'out', 1.1);
  },
};
