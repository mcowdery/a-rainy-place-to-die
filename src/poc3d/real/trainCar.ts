import * as THREE from 'three';
import { CAR, carBenches, carLayout, carPoles, type CabinLayout, type CarEnds } from '../district/cabin';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { SignBuilder } from './signs';
import { taxiAdUv } from './taxiAdLayout';
import { TAXI_ADS } from '../models/ads';

/**
 * The commuter car, second generation (review in models.html; `?transit=new` in the district): a modern
 * Japanese stainless EMU (after the E231/E235 and Tokyo Metro cars, invented), built to be ridden: four doors a
 * side whose leaves slide into the walls, long benches with a seat each, partitions at the bench ends, poles,
 * straps on their rails, luggage racks over the seats, LED ceiling strips, photo ads over the windows and hanging
 * in the aisle, screens over the doors (the next station), a gangway with its bellows to the next car, and at a
 * driving end the cab behind a partition you can look through, out of the windscreen. Elevated and subway cars
 * are the same car in their line's colours.
 *
 * The car's frame is district/cabin.ts's: x across (+x the left), z along (+z the front), y up from the rail top.
 * The walls are two skins (the stainless outside and the lining) with the door leaves sliding between them.
 */

/** How a car looks: its body, the line's colour on its bands and front, the seats, the floor. */
export interface CarLook {
  readonly body: number;
  readonly band: number;
  readonly seat: number;
  readonly priority: number;
  readonly floor: number;
}

/** A line's car look: stainless with its colour (elevated), or white aluminium (subway). */
export function carLook(lineColor: number, subway = false): CarLook {
  const mix = (a: number, b: number, k: number): number => {
    const c = (s: number): number => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
    return (c(16) << 16) | (c(8) << 8) | c(0);
  };
  return {
    body: subway ? 0xdfe2e4 : 0xb8bcc0,
    band: lineColor,
    seat: mix(lineColor, 0x34405a, 0.55),
    priority: 0xb8506e,
    floor: subway ? 0x8a8e94 : 0x8e877c,
  };
}

/** The doors of one side and one way of sliding: a group to move along z. */
export interface DoorLeaves {
  readonly side: 1 | -1;
  readonly dir: 1 | -1;
  readonly group: THREE.Group;
}

/** One car, ready to place: its frame (`obj`), the leaves to open, and the inside to hide from afar. */
export interface Car2 {
  readonly obj: THREE.Group;
  readonly ends: CarEnds;
  /** Its walkable layout (district/cabin.ts). */
  readonly layout: CabinLayout;
  readonly doors: readonly DoorLeaves[];
  readonly inside: THREE.Group;
}

/** A three-car set: the cars back to front, their screens (a canvas), doors and lamps. */
export interface TrainSet2 {
  readonly group: THREE.Group;
  readonly cars: readonly Car2[];
  /** Opens the doors on one side (+1 the cars' left, -1 right) by a fraction (0 shut, 1 open). */
  setDoors(side: number, open: number): void;
  /** Hides the insides beyond a distance (they're only seen close up). */
  cull(camera: THREE.Vector3, range?: number): void;
  /** The screens over the doors and the destination on the front: the next station and where it's going. */
  setScreens(next: { jp: string; en: string; code?: string } | null, dest: { jp: string; en: string }, state?: string): void;
}

/** The materials a set is drawn with: the city's, its glass, and the photo ads' (the taxi ad atlas), if any. */
export interface CarMaterials {
  readonly city: THREE.Material;
  readonly glass: THREE.Material;
  readonly ads: THREE.Material | null;
}

export function carGlass(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x9ab4bc, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
}

const BLACK = 0x141518;
const RUBBER = 0x1c1c1e;
const LINING = 0xeceae4;
const STEEL_IN = 0xc4c8cc;

/** Rectangles covering [z0, z1] x [y0, y1] except the holes (a wall with its openings). */
export function wallRects(z0: number, z1: number, y0: number, y1: number, holes: readonly [number, number, number, number][]): [number, number, number, number][] {
  const zs = [...new Set([z0, z1, ...holes.flatMap((h) => [h[0], h[1]])])].filter((z) => z >= z0 && z <= z1).sort((a, b) => a - b);
  const ys = [...new Set([y0, y1, ...holes.flatMap((h) => [h[2], h[3]])])].filter((y) => y >= y0 && y <= y1).sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const za = zs[i];
    const zb = zs[i + 1];
    const zm = (za + zb) / 2;
    let run: number | null = null;
    for (let j = 0; j + 1 < ys.length; j++) {
      const ym = (ys[j] + ys[j + 1]) / 2;
      const hole = holes.some((h) => zm > h[0] && zm < h[1] && ym > h[2] && ym < h[3]);
      if (!hole && run === null) run = ys[j];
      if (hole && run !== null) {
        out.push([za, zb, run, ys[j]]);
        run = null;
      }
    }
    if (run !== null) out.push([za, zb, run, ys[ys.length - 1]]);
  }
  return out;
}

/** The window openings along one wall: between the doors and the ends, in panes of about 1.4 m. */
function windows(ends: CarEnds): [number, number][] {
  const { H, DOORS, DOOR_HALF } = CAR;
  const lo = ends.back === 'cab' ? -H + CAR.CAB - 0.1 : -H + 0.35;
  const hi = ends.front === 'cab' ? H - CAR.CAB + 0.1 : H - 0.35;
  const edges = [lo, ...DOORS.flatMap((d) => [d - DOOR_HALF - 0.22, d + DOOR_HALF + 0.22]), hi];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const a = edges[i];
    const b = edges[i + 1];
    const n = Math.max(1, Math.round((b - a) / 1.4));
    const w = (b - a) / n;
    for (let k = 0; k < n; k++) out.push([a + w * k + (k ? 0.06 : 0), a + w * (k + 1) - (k < n - 1 ? 0.06 : 0)]);
  }
  // The cab's side windows.
  if (ends.front === 'cab') out.push([H - CAR.CAB + 0.35, H - 0.3]);
  if (ends.back === 'cab') out.push([-H + 0.3, -H + CAR.CAB - 0.35]);
  return out;
}

/**
 * One car's geometry: body (exterior and the fixed inside), glass, the door leaves (four groups), and the
 * inside's details (its own mesh, hidden from afar). lamps: the driving end's lamps lit as head (white) or tail
 * (red) lights; pantograph on the roof.
 */
function buildCar2(look: CarLook, ends: CarEnds, lamps: 'head' | 'tail' | null, panto: boolean, mats: CarMaterials, screen: THREE.Material): Car2 {
  const { H, W, FLOOR, SILL, HEAD, DOOR_TOP, CEIL, TOP, INNER, DOORS, DOOR_HALF, GANG_HALF, CAB, SEAT_X, SEAT_Y, BACK_X } = CAR;
  const mb = new MeshBuilder(1 << 14);
  const ib = new MeshBuilder(1 << 15);
  const gb = new MeshBuilder(1024);
  const pb = new SignBuilder();
  const sb = new MeshBuilder(256);
  for (const b of [mb, ib, gb]) {
    b.flags = 0;
    b.style = [0, 0, 0, 0];
  }
  /** A box by its extents (into a builder, a kind), its bottom drawn too. */
  const boxIn = (to: MeshBuilder, hex: number | [number, number, number], kind: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, style = 0): void => {
    to.kind = kind;
    to.color = typeof hex === 'number' ? lin(hex) : hex;
    to.style = [style, 0, 0, 0];
    to.box((x0 + x1) / 2, (z0 + z1) / 2, Math.min(y0, y1), Math.max(y0, y1), Math.abs(x1 - x0), Math.abs(z1 - z0), kind, true);
    to.style = [0, 0, 0, 0];
  };
  const box = (hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: number = KIND.plain): void => boxIn(mb, hex, kind, x0, x1, y0, y1, z0, z1);
  /** Inside: lit by the car's own lights (self-lit, so it reads the same day and night). */
  const inner = (hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, to: MeshBuilder = ib): void =>
    boxIn(to, hex, KIND.emit, x0, x1, y0, y1, z0, z1, EMIT.interior);
  const glow = (rgb: [number, number, number], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, to: MeshBuilder = mb, channel: number = EMIT.always): void =>
    boxIn(to, rgb, KIND.emit, x0, x1, y0, y1, z0, z1, channel);
  const paneX = (x: number, y0: number, y1: number, z0: number, z1: number, to = gb): void => to.quad([x, y0, z0], [0, 0, z1 - z0], [0, y1 - y0, 0]);
  const paneZ = (z: number, x0: number, x1: number, y0: number, y1: number, to = gb): void => to.quad([x0, y0, z], [x1 - x0, 0, 0], [0, y1 - y0, 0]);
  const sx = (s: number, a: number, b: number): [number, number] => [Math.min(s * a, s * b), Math.max(s * a, s * b)];

  // The screens' UVs (quad by quad, as their vertices are added): canvas v runs up from its bottom.
  const uvs: number[] = [];
  const quadUv = (u0: number, vBottom: number, u1: number, vTop: number): number[] => [u0, vBottom, u1, vBottom, u1, vTop, u0, vTop];
  const wins = windows(ends);
  const cabFront = ends.front === 'cab';
  const cabBack = ends.back === 'cab';

  // ---- Under the floor: the floor slab, equipment between the bogies, the bogies and their wheels.
  box(0x2a2c30, -W + 0.02, W - 0.02, FLOOR - 0.16, FLOOR - 0.012, -H, H);
  box(0x3a3c40, -1.2, 1.2, 0.42, FLOOR - 0.16, -4.6, 4.6);
  for (const z of [-6.4, 6.4]) {
    box(0x1e2024, -1.08, 1.08, 0.28, 0.62, z - 1.3, z + 1.3);
    mb.kind = KIND.plain;
    mb.color = lin(0x101114);
    for (const wz of [-0.95, 0.95]) for (const s of [-1, 1]) mb.beam([s * 0.68, 0.43, z + wz], [s * 0.84, 0.43, z + wz], 0.84);
  }

  // ---- Side walls: the outer skin (stainless, with door and window openings), the lining inside, reveals.
  for (const s of [-1, 1] as const) {
    const doorHoles: [number, number, number, number][] = DOORS.map((d) => [d - DOOR_HALF, d + DOOR_HALF, FLOOR, DOOR_TOP]);
    const winHoles: [number, number, number, number][] = wins.map(([a, b]) => [a, b, SILL, HEAD]);
    const holes = [...doorHoles, ...winHoles];
    const [ox0, ox1] = sx(s, W - 0.012, W);
    for (const [za, zb, ya, yb] of wallRects(-H, H, 0.75, TOP - 0.18, holes)) box(look.body, ox0, ox1, ya, yb, za, zb, KIND.gloss);
    const [ix0, ix1] = sx(s, INNER, INNER + 0.012);
    for (const [za, zb, ya, yb] of wallRects(-H, H, FLOOR, CEIL, holes)) inner(LINING, ix0, ix1, ya, yb, za, zb, mb);
    // The line's colour: a band under the windows and one along the top (across the door leaves too).
    const band = (y0: number, y1: number): void => {
      for (const [za, zb, ya, yb] of wallRects(-H, H, y0, y1, doorHoles)) box(look.band, ...sx(s, W, W + 0.004), ya, yb, za, zb, KIND.gloss);
    };
    band(SILL - 0.2, SILL - 0.07);
    band(TOP - 0.36, TOP - 0.24);
    // Window reveals (dark frames) joining the skins, and the panes in the outer skin.
    for (const [a, b] of wins) {
      box(0x3a3e44, ...sx(s, INNER, W), SILL - 0.03, SILL, a, b);
      box(0x3a3e44, ...sx(s, INNER, W), HEAD, HEAD + 0.03, a, b);
      box(0x3a3e44, ...sx(s, INNER, W), SILL, HEAD, a - 0.03, a);
      box(0x3a3e44, ...sx(s, INNER, W), SILL, HEAD, b, b + 0.03);
      paneX(s * (W - 0.006), SILL, HEAD, a, b);
      // A rolled blind at the head.
      inner(0xd8d4c8, ...sx(s, INNER - 0.05, INNER), HEAD - 0.06, HEAD, a, b);
    }
    // Door jambs inside (the frame round each opening, on the lining) and the yellow threshold strip.
    for (const d of DOORS) {
      inner(0xa8acb0, ...sx(s, INNER - 0.02, INNER + 0.012), DOOR_TOP, DOOR_TOP + 0.05, d - DOOR_HALF - 0.05, d + DOOR_HALF + 0.05, mb);
      for (const e of [-1, 1]) inner(0xa8acb0, ...sx(s, INNER - 0.02, INNER + 0.012), FLOOR, DOOR_TOP, d + e * DOOR_HALF - 0.025, d + e * DOOR_HALF + 0.025, mb);
      inner(0xe8c030, ...sx(s, INNER - 0.16, W), FLOOR + 0.005, FLOOR + 0.009, d - DOOR_HALF, d + DOOR_HALF);
      // The door-closing lamp over the door (red) on the outside.
      glow([0.3, 0.04, 0.02], ...sx(s, W, W + 0.01), DOOR_TOP + 0.08, DOOR_TOP + 0.14, d - 0.05, d + 0.05);
    }
  }

  // ---- Roof: the roof itself, AC units, the pantograph.
  box(look.body, -W + 0.02, W - 0.02, TOP - 0.18, TOP - 0.06, -H, H, KIND.gloss);
  box(0x9aa0a6, -W + 0.15, W - 0.15, TOP - 0.06, TOP, -H, H);
  for (const z of [-4.4, 4.4]) box(0xc8ccd0, -0.95, 0.95, TOP, TOP + 0.34, z - 1.25, z + 1.25);
  if (panto) {
    box(0x3a3c40, -0.7, 0.7, TOP, TOP + 0.12, -1.2, 1.2);
    mb.kind = KIND.plain;
    mb.color = lin(0x3a3c40);
    for (const s of [-1, 1]) {
      mb.beam([s * 0.55, TOP + 0.12, -0.9], [s * 0.4, TOP + 0.75, 0], 0.04);
      mb.beam([s * 0.55, TOP + 0.12, 0.9], [s * 0.4, TOP + 0.75, 0], 0.04);
    }
    box(0x8a8c90, -0.85, 0.85, TOP + 0.75, TOP + 0.8, -0.08, 0.08);
  }

  // ---- Inside: floor, ceiling with its light strips and the AC duct, benches, partitions, poles, straps, racks.
  const zLo = cabBack ? -H + CAB : -H + 0.12;
  const zHi = cabFront ? H - CAB : H - 0.12;
  inner(look.floor, -INNER, INNER, FLOOR - 0.012, FLOOR + 0.002, zLo, zHi, mb);
  // Lighter floor in the door vestibules.
  for (const d of DOORS) inner(0xa8a49c, -INNER, INNER, FLOOR + 0.002, FLOOR + 0.005, d - CAR.VESTIBULE + 0.1, d + CAR.VESTIBULE - 0.1);
  inner(0xf2f2ee, -INNER, INNER, CEIL, CEIL + 0.02, zLo, zHi, mb);
  for (const s of [-1, 1]) glow([1.7, 1.72, 1.68], ...sx(s, 0.48, 0.64), CEIL - 0.02, CEIL, zLo + 0.2, zHi - 0.2, ib);
  inner(0xdcdcd8, -0.3, 0.3, CEIL - 0.08, CEIL, zLo + 0.1, zHi - 0.1);
  for (let z = zLo + 0.6; z < zHi - 0.4; z += 0.9) inner(0x8a8c90, -0.22, 0.22, CEIL - 0.085, CEIL - 0.08, z, z + 0.4);
  const benches = carBenches(ends);
  for (const b of benches) {
    const color = b.priority ? look.priority : look.seat;
    const s = b.side;
    // Base, cushion (a seat each: a darker line between), backrest, and the window ledge over it.
    inner(0x9a9ea2, ...sx(s, SEAT_X + 0.06, INNER), FLOOR + 0.12, FLOOR + SEAT_Y - 0.06, b.z0, b.z1);
    inner(color, ...sx(s, SEAT_X, INNER), FLOOR + SEAT_Y - 0.06, FLOOR + SEAT_Y, b.z0, b.z1);
    inner(color, ...sx(s, BACK_X, INNER), FLOOR + SEAT_Y, FLOOR + SEAT_Y + 0.5, b.z0, b.z1);
    const n = Math.max(1, Math.round((b.z1 - b.z0) / CAR.SEAT_W));
    for (let k = 1; k < n; k++) {
      const z = b.z0 + ((b.z1 - b.z0) * k) / n;
      inner(0x20242c, ...sx(s, SEAT_X - 0.002, INNER), FLOOR + SEAT_Y - 0.002, FLOOR + SEAT_Y + 0.001, z - 0.012, z + 0.012);
      inner(0x20242c, ...sx(s, BACK_X - 0.004, BACK_X), FLOOR + SEAT_Y, FLOOR + SEAT_Y + 0.5, z - 0.012, z + 0.012);
    }
    // Partitions at the ends (stainless below, a frosted panel above), toward the doors.
    for (const ez of [b.z0, b.z1]) {
      const nearDoor = DOORS.some((d) => Math.abs(Math.abs(ez - d) - CAR.VESTIBULE) < 0.01);
      if (!nearDoor) continue;
      const dz = ez === b.z0 ? -1 : 1;
      inner(STEEL_IN, ...sx(s, SEAT_X - 0.08, INNER), FLOOR, FLOOR + 1.0, ez + dz * 0.0, ez + dz * 0.04);
      inner(0xdfe6ea, ...sx(s, SEAT_X - 0.02, INNER), FLOOR + 1.0, FLOOR + 1.85, ez + dz * 0.005, ez + dz * 0.035);
      inner(STEEL_IN, ...sx(s, SEAT_X - 0.1, SEAT_X - 0.02), FLOOR, FLOOR + 1.9, ez + dz * 0.0, ez + dz * 0.04);
    }
    // Luggage rack over the bench: rods on brackets.
    for (const rx of [1.08, 1.18, 1.28]) inner(0xb0b4b8, ...sx(s, rx - 0.008, rx + 0.008), FLOOR + 1.72, FLOOR + 1.736, b.z0 + 0.05, b.z1 - 0.05);
    for (let z = b.z0 + 0.1; z <= b.z1 - 0.05; z += Math.max(0.6, (b.z1 - b.z0 - 0.15) / Math.max(1, Math.round((b.z1 - b.z0) / 1.2)))) {
      inner(0x9a9ea2, ...sx(s, 1.02, INNER), FLOOR + 1.7, FLOOR + 1.74, z - 0.015, z + 0.015);
    }
    // Straps on the rail over the bench's front edge (the priority seats' yellow).
    const rail = 0.84;
    inner(0xc8ccd0, ...sx(s, rail - 0.015, rail + 0.015), CEIL - 0.24, CEIL - 0.21, b.z0 - 0.1, b.z1 + 0.1);
    const strap: [number, number, number] = b.priority ? lin(0xe8c020) : lin(0xf0f0ec);
    for (let z = b.z0 + 0.2; z < b.z1 - 0.1; z += 0.34) {
      ib.kind = KIND.emit;
      ib.style = [EMIT.interior, 0, 0, 0];
      ib.color = lin(0x6a6e74);
      ib.box(s * rail, z, CEIL - 0.52, CEIL - 0.22, 0.026, 0.006, KIND.emit, true);
      ib.color = strap;
      // A triangular grip: two sides and the bar.
      ib.beam([s * rail, CEIL - 0.52, z], [s * rail, CEIL - 0.66, z - 0.06], 0.018);
      ib.beam([s * rail, CEIL - 0.52, z], [s * rail, CEIL - 0.66, z + 0.06], 0.018);
      ib.beam([s * rail, CEIL - 0.66, z - 0.065], [s * rail, CEIL - 0.66, z + 0.065], 0.02);
      ib.style = [0, 0, 0, 0];
    }
  }
  // Poles (stanchions), from the floor to the ceiling.
  ib.kind = KIND.emit;
  ib.style = [EMIT.interior, 0, 0, 0];
  ib.color = lin(0xd8dce0);
  for (const [px, pz] of carPoles(ends)) ib.cylinder(px, pz, FLOOR, CEIL, 0.018, 8, false);
  // A rail across each door vestibule at the ceiling, with straps.
  for (const d of DOORS) {
    ib.color = lin(0xc8ccd0);
    ib.box(0, d, CEIL - 0.24, CEIL - 0.21, 1.6, 0.03, KIND.emit, true);
  }
  ib.style = [0, 0, 0, 0];
  // The wheelchair space: a handrail along the wall where there's no bench.
  if (ends.back === 'gangway') inner(0xd8dce0, -INNER, -INNER + 0.04, FLOOR + 0.78, FLOOR + 0.82, -H + 0.4, DOORS[0] - CAR.VESTIBULE);

  // ---- Over the windows and the doors: photo ads in frames, the screens over the doors; ads hanging in the aisle.
  const adFor = (k: number): number => k % TAXI_ADS.length;
  let adK = (look.band >> 3) + (ends.front === 'cab' ? 3 : ends.back === 'cab' ? 5 : 0);
  pb.sign = [0, 2];
  pb.ink = [1, 1, 1];
  pb.plate = [1, 1, 1];
  for (const s of [-1, 1]) {
    for (const b of benches) {
      if (b.side !== s) continue;
      const len = b.z1 - b.z0;
      const n = Math.max(1, Math.floor(len / 0.62));
      for (let k = 0; k < n; k++) {
        const zc = b.z0 + (len * (k + 0.5)) / n;
        const w = 0.5;
        const h = w / 1.73;
        const x = s * (INNER - 0.006);
        inner(0x8a8e94, ...sx(s, INNER - 0.004, INNER), HEAD + 0.06, HEAD + 0.08 + h + 0.02, zc - w / 2 - 0.02, zc + w / 2 + 0.02);
        // Facing in: from (zc + s*w/2) along -s.
        // Facing in, reading left to right (+z on the left wall, -z on the right).
        const c: [number, number, number] = [x, HEAD + 0.08, zc - (s * w) / 2];
        pb.quad(c, [0, 0, s * w], [0, h, 0], taxiAdUv(adFor(adK++), 'door'));
      }
    }
    // Two screens over each door: the next station (left), an ad (right).
    for (const d of DOORS) {
      inner(0x1a1c20, ...sx(s, INNER - 0.04, INNER), DOOR_TOP + 0.08, DOOR_TOP + 0.38, d - 0.58, d + 0.58);
      const x = s * (INNER - 0.042);
      for (const [k, z0] of [[0, d - 0.55], [1, d + 0.02]] as const) {
        // The left screen as you face the door from inside: the next station; the other an ad.
        const info = (s > 0) === (k === 0);
        sb.quad([x, DOOR_TOP + 0.1, s > 0 ? z0 : z0 + 0.53], [0, 0, s > 0 ? 0.53 : -0.53], [0, 0.26, 0]);
        uvs.push(...(info ? quadUv(0, 0.5, 1, 1) : quadUv(0, 0.25, 1, 0.5)));
      }
    }
  }
  // Hanging ads in the aisle (double sided), between the middle doors.
  for (const z of [-4.6, 0, 4.6]) {
    const w = 0.56;
    const h = w / 1.73;
    inner(0x8a8e94, -0.005, 0.005, CEIL - 0.05, CEIL, z - w / 2, z + w / 2);
    const ad = adFor(adK++);
    pb.quad([0.004, CEIL - 0.06 - h, z - w / 2], [0, 0, w], [0, h, 0], taxiAdUv(ad, 'door'));
    pb.quad([-0.004, CEIL - 0.06 - h, z + w / 2], [0, 0, -w], [0, h, 0], taxiAdUv(ad, 'door'));
  }

  // ---- The ends: gangways (end wall with its opening, the bellows across the gap), or the cab.
  const endWall = (z: number, dir: number): void => {
    const holes: [number, number, number, number][] = [[-GANG_HALF, GANG_HALF, FLOOR, FLOOR + 1.95]];
    for (const [xa, xb, ya, yb] of wallRects(-W, W, 0.75, TOP - 0.18, holes)) box(look.body, xa, xb, ya, yb, z - dir * 0.012, z, KIND.gloss);
    for (const [xa, xb, ya, yb] of wallRects(-INNER, INNER, FLOOR, CEIL, holes)) inner(LINING, xa, xb, ya, yb, z - dir * 0.13, z - dir * 0.118, mb);
    // The bellows: a dark tunnel to the middle of the gap, and the floor plate across it.
    const z1 = z + dir * (CAR.GAP / 2 + 0.01);
    box(RUBBER, -GANG_HALF - 0.1, -GANG_HALF, FLOOR, FLOOR + 2.05, Math.min(z, z1), Math.max(z, z1));
    box(RUBBER, GANG_HALF, GANG_HALF + 0.1, FLOOR, FLOOR + 2.05, Math.min(z, z1), Math.max(z, z1));
    box(RUBBER, -GANG_HALF - 0.1, GANG_HALF + 0.1, FLOOR + 1.95, FLOOR + 2.05, Math.min(z, z1), Math.max(z, z1));
    inner(0x6a6c70, -GANG_HALF, GANG_HALF, FLOOR - 0.02, FLOOR, Math.min(z - dir * 0.13, z1), Math.max(z - dir * 0.13, z1), mb);
    // The gangway's frame inside, and the car number.
    inner(0xa8acb0, -GANG_HALF - 0.05, GANG_HALF + 0.05, FLOOR + 1.95, FLOOR + 2.0, z - dir * 0.14, z - dir * 0.13, mb);
    inner(0x2a2c30, 0.7, 1.0, FLOOR + 2.1, FLOOR + 2.22, z - dir * 0.135, z - dir * 0.13, mb);
  };
  const cab = (z: number, dir: number): void => {
    // The partition between the cab and the car: a door (shut) on the left, a window on the right.
    const pz = z - dir * CAB;
    const holes: [number, number, number, number][] = [[-1.15, -0.15, FLOOR + 0.95, FLOOR + 1.7], [0.3, 0.9, FLOOR + 1.0, FLOOR + 1.6]];
    for (const [xa, xb, ya, yb] of wallRects(-INNER, INNER, FLOOR, CEIL, holes)) inner(LINING, xa, xb, ya, yb, pz - 0.03, pz + 0.03, mb);
    paneZ(pz, -1.15, -0.15, FLOOR + 0.95, FLOOR + 1.7);
    paneZ(pz, 0.3, 0.9, FLOOR + 1.0, FLOOR + 1.6);
    inner(0xa8acb0, 0.2, 1.0, FLOOR, FLOOR + 1.95, pz + dir * 0.031, pz + dir * 0.035, mb);
    // In the cab: the floor, the desk with its lit gauges, the driver's seat (on the left), the ceiling.
    const [c0, c1] = [Math.min(pz, z), Math.max(pz, z)];
    inner(0x3a3c40, -INNER, INNER, FLOOR - 0.012, FLOOR + 0.002, c0, c1, mb);
    inner(0xdcdcd8, -INNER, INNER, CEIL, CEIL + 0.02, c0, c1, mb);
    const dz0 = z - dir * 0.75;
    const dz1 = z - dir * 0.25;
    inner(0x2a2c30, -INNER, INNER, FLOOR, FLOOR + 0.95, Math.min(dz0, dz1), Math.max(dz0, dz1), mb);
    glow([0.15, 0.5, 0.35], 0.2, 0.9, FLOOR + 0.951, FLOOR + 0.96, Math.min(dz0, dz1) + 0.1, Math.max(dz0, dz1) - 0.15, mb);
    glow([0.6, 0.35, 0.08], -0.6, -0.1, FLOOR + 0.951, FLOOR + 0.96, Math.min(dz0, dz1) + 0.15, Math.max(dz0, dz1) - 0.2, mb);
    inner(0x2a3a5a, 0.35, 0.85, FLOOR + 0.45, FLOOR + 0.55, pz + dir * 0.4, pz + dir * 0.85, mb);
    inner(0x2a3a5a, 0.35, 0.85, FLOOR + 0.55, FLOOR + 1.15, pz + dir * 0.32, pz + dir * 0.4, mb);
    // The front: lower panel in the body colour with the line's colour, the windscreen in a black surround, the
    // destination over it, the lamps, the skirt.
    const fz = z;
    const fz1 = z + dir * 0.06;
    const [f0, f1] = [Math.min(fz, fz1), Math.max(fz, fz1)];
    box(look.body, -W, W, 0.75, FLOOR + 1.0, f0, f1, KIND.gloss);
    box(look.band, -W, W, FLOOR + 0.62, FLOOR + 0.98, f0 + (dir > 0 ? 0.004 : -0.004), f1 + (dir > 0 ? 0.004 : -0.004), KIND.gloss);
    box(BLACK, -W, W, FLOOR + 1.0, TOP - 0.18, f0, f1, KIND.gloss);
    for (const s of [-1, 1]) box(look.body, ...sx(s, 1.25, W), FLOOR + 1.0, TOP - 0.18, f0 - 0.002, f1 + 0.002, KIND.gloss);
    paneZ(z + dir * 0.065, -1.2, 1.2, FLOOR + 1.05, FLOOR + 1.98);
    // The headlights and tail lights (one pair lit, by which end leads), the skirt and coupler.
    for (const s of [-1, 1]) {
      const head = lamps === 'head';
      glow(head ? [1.8, 1.75, 1.5] : [0.25, 0.24, 0.2], ...sx(s, 0.85, 1.2), FLOOR + 0.3, FLOOR + 0.48, f1, f1 + dir * 0.012);
      glow(lamps === 'tail' ? [1.6, 0.08, 0.05] : [0.12, 0.01, 0.01], ...sx(s, 0.5, 0.75), FLOOR + 0.33, FLOOR + 0.45, f1, f1 + dir * 0.012);
    }
    box(0x1a1a1c, -1.3, 1.3, 0.25, 0.8, Math.min(z - dir * 0.2, z + dir * 0.15), Math.max(z - dir * 0.2, z + dir * 0.15));
    box(0x3a3c40, -0.18, 0.18, 0.5, 0.75, Math.min(z, z + dir * 0.35), Math.max(z, z + dir * 0.35));
    // The destination display over the windscreen (a screen: the set's canvas).
    sb.quad([dir > 0 ? -0.75 : 0.75, FLOOR + 2.06, z + dir * 0.066], [dir > 0 ? 1.5 : -1.5, 0, 0], [0, 0.2, 0]);
    uvs.push(...quadUv(0, 0, 1, 0.25));
  };
  if (cabBack) cab(-H, -1);
  else endWall(-H, -1);
  if (cabFront) cab(H, 1);
  else endWall(H, 1);

  // ---- The door leaves: per side, the leaves that slide back (-z) and forward (+z), in the wall's pocket.
  const doors: DoorLeaves[] = [];
  for (const s of [-1, 1] as const) {
    for (const dir of [-1, 1] as const) {
      const lb = new MeshBuilder(2048);
      const lg = new MeshBuilder(256);
      lb.flags = 0;
      for (const d of DOORS) {
        const z0 = dir < 0 ? d - DOOR_HALF : d;
        const z1 = dir < 0 ? d : d + DOOR_HALF;
        const holes: [number, number, number, number][] = [[z0 + 0.1, z1 - 0.1, FLOOR + 0.95, FLOOR + 1.7]];
        for (const [za, zb, ya, yb] of wallRects(z0, z1, FLOOR + 0.01, DOOR_TOP, holes)) boxIn(lb, look.body, KIND.gloss, ...sx(s, W - 0.052, W - 0.02), ya, yb, za, zb);
        // The bands carry on across the doors; the rubber edge where the leaves meet; the inside face.
        boxIn(lb, look.band, KIND.gloss, ...sx(s, W - 0.02, W - 0.016), SILL - 0.2, SILL - 0.07, z0, z1);
        boxIn(lb, RUBBER, KIND.plain, ...sx(s, W - 0.054, W - 0.018), FLOOR + 0.01, DOOR_TOP, dir < 0 ? d - 0.025 : d, dir < 0 ? d : d + 0.025);
        paneX(s * (W - 0.036), FLOOR + 0.95, FLOOR + 1.7, z0 + 0.1, z1 - 0.1, lg);
      }
      const group = new THREE.Group();
      const leaf = new THREE.Mesh(lb.build()!, mats.city);
      leaf.castShadow = true;
      const glass = new THREE.Mesh(lg.build()!, mats.glass);
      glass.renderOrder = 3;
      group.add(leaf, glass);
      doors.push({ side: s, dir, group });
    }
  }

  const obj = new THREE.Group();
  const body = new THREE.Mesh(mb.build()!, mats.city);
  body.castShadow = true;
  const glassMesh = new THREE.Mesh(gb.build()!, mats.glass);
  glassMesh.renderOrder = 3;
  obj.add(body, glassMesh, ...doors.map((d) => d.group));
  const inside = new THREE.Group();
  inside.add(new THREE.Mesh(ib.build()!, mats.city));
  const posters = pb.build(0, 0);
  if (posters && mats.ads) inside.add(new THREE.Mesh(posters, mats.ads));
  const screens = sb.build();
  if (screens) {
    screens.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    // The destination is on the outside: always shown with the body.
    obj.add(new THREE.Mesh(screens, screen));
  }
  obj.add(inside);
  return { obj, ends, layout: carLayout(ends), doors, inside };
}

/** The screens' canvas: the next station (top half), an ad (third quarter), the destination (bottom quarter). */
class Screens {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private key = '';

  constructor(private readonly color: number) {
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, color: new THREE.Color(1.15, 1.15, 1.15) });
  }

  draw(next: { jp: string; en: string; code?: string } | null, dest: { jp: string; en: string }, state = ''): void {
    const key = `${next?.jp}|${dest.jp}|${state}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.canvas.getContext('2d')!;
    const hex = `#${this.color.toString(16).padStart(6, '0')}`;
    // Info (top half): the line's colour down the side, "次は" / "Next", the station big in both scripts.
    g.fillStyle = '#0c0e12';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = hex;
    g.fillRect(0, 0, 16, 256);
    g.fillStyle = '#f4f4f0';
    g.font = "bold 30px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textBaseline = 'top';
    g.fillText(next ? (state === 'stopped' ? 'ただいま' : '次は') : '', 34, 18);
    g.font = "24px 'Arial', sans-serif";
    g.fillStyle = '#9aa0a8';
    g.fillText(next ? (state === 'stopped' ? 'Now stopping at' : 'Next') : `For ${dest.en}`, 34, 54);
    g.fillStyle = '#ffffff';
    g.font = "bold 84px 'Yu Gothic', 'Meiryo', sans-serif";
    g.fillText(next ? next.jp : dest.jp, 34, 92, 460);
    g.font = "bold 34px 'Arial', sans-serif";
    g.fillStyle = '#e8c030';
    g.fillText(next ? `${next.en}${next.code ? `  ${next.code}` : ''}` : dest.en, 34, 196, 460);
    // The ad (third quarter): an invented one.
    g.fillStyle = '#f2ede0';
    g.fillRect(0, 256, 512, 128);
    g.fillStyle = '#d83a2a';
    g.font = "bold 46px 'Yu Gothic', 'Meiryo', sans-serif";
    g.fillText('夜光 YAKOU', 24, 270);
    g.fillStyle = '#20242c';
    g.font = "26px 'Yu Gothic', 'Meiryo', sans-serif";
    g.fillText('今夜も、光れ。  ENERGY DRINK', 24, 330);
    // The destination (bottom quarter): amber on black, the way it's going.
    g.fillStyle = '#060606';
    g.fillRect(0, 384, 512, 128);
    g.fillStyle = '#ffb040';
    g.font = "bold 64px 'Yu Gothic', 'Meiryo', sans-serif";
    g.textAlign = 'center';
    g.fillText(dest.jp, 256, 392, 480);
    g.font = "bold 34px 'Arial', sans-serif";
    g.fillText(dest.en.toUpperCase(), 256, 462, 480);
    g.textAlign = 'left';
    this.texture.needsUpdate = true;
  }
}

/**
 * Makes three-car sets for a line (the car geometry built once and shared; each set its own screens and doors):
 * the cars back to front as the group's children, each with its origin at its middle, along +z.
 */
export function carSet2(lineColor: number, mats: CarMaterials, opts: { subway?: boolean; dest?: { jp: string; en: string } } = {}): () => TrainSet2 {
  const look = carLook(lineColor, opts.subway);
  const shared = new Screens(lineColor);
  shared.draw(null, opts.dest ?? { jp: '各駅停車', en: 'Local' });
  // Built per set (the doors move per set); the geometry is shared by building once per role.
  const roles = [
    { ends: { back: 'cab', front: 'gangway' } as CarEnds, lamps: 'tail' as const, panto: false },
    { ends: { back: 'gangway', front: 'gangway' } as CarEnds, lamps: null, panto: true },
    { ends: { back: 'gangway', front: 'cab' } as CarEnds, lamps: 'head' as const, panto: false },
  ];
  const proto = roles.map((r) => buildCar2(look, r.ends, r.lamps, r.panto, mats, shared.material));
  return () => {
    const group = new THREE.Group();
    let screens: Screens | null = null;
    const cars: Car2[] = proto.map((p) => {
      const obj = new THREE.Group();
      const inside = new THREE.Group();
      const doors: DoorLeaves[] = [];
      for (const child of p.obj.children) {
        if (child === p.inside) {
          for (const c of p.inside.children) inside.add(new THREE.Mesh((c as THREE.Mesh).geometry, (c as THREE.Mesh).material));
          obj.add(inside);
          continue;
        }
        const door = p.doors.find((d) => d.group === child);
        if (door) {
          const g = new THREE.Group();
          for (const c of door.group.children) {
            const m = new THREE.Mesh((c as THREE.Mesh).geometry, (c as THREE.Mesh).material);
            m.renderOrder = c.renderOrder;
            m.castShadow = c.castShadow;
            g.add(m);
          }
          obj.add(g);
          doors.push({ side: door.side, dir: door.dir, group: g });
          continue;
        }
        const m = new THREE.Mesh((child as THREE.Mesh).geometry, (child as THREE.Mesh).material);
        m.renderOrder = child.renderOrder;
        m.castShadow = child.castShadow;
        obj.add(m);
      }
      group.add(obj);
      return { obj, ends: p.ends, layout: p.layout, doors, inside };
    });
    const screenMeshes = cars.flatMap((c) => c.obj.children.filter((m) => (m as THREE.Mesh).material === shared.material) as THREE.Mesh[]);
    return {
      group,
      cars,
      setDoors(side: number, open: number): void {
        const k = Math.max(0, Math.min(1, open));
        for (const c of cars) for (const d of c.doors) d.group.position.z = d.side === side ? d.dir * k * (CAR.DOOR_HALF - 0.06) : 0;
      },
      cull(camera: THREE.Vector3, range = 140): void {
        const p = new THREE.Vector3();
        for (const c of cars) {
          c.obj.getWorldPosition(p);
          c.inside.visible = p.distanceToSquared(camera) < range * range;
        }
      },
      setScreens(next, dest, state): void {
        if (!screens) {
          // This set's own screens from now on (a ride's train).
          screens = new Screens(lineColor);
          for (const m of screenMeshes) m.material = screens.material;
        }
        screens.draw(next, dest, state);
      },
    };
  };
}
