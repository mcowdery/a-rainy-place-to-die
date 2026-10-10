import { filipino } from '../district/cityConfig';
import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { portalOffset, type RoadUnder } from '../district/rail';
import { WIN } from './buildings';
import type { Light } from './lightmap';
import { localBox, localFrame, localRect, localYaw, toLocal, toWorld } from './localFrame';
import { passengerMesh, type PassengerSpot } from './people';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * A Toto Line station: a two-storey station building beside the elevated line, with side platforms on the
 * viaduct. From the street you walk in under the tracks into the ground-floor concourse (ticket machines,
 * automatic gates, the departure board), up the stairs behind the gates to the upper concourse, and out
 * over a short walkway onto the near platform (platform screen doors, a canopy, benches, the station name
 * boards). The far platform, across the tracks, serves the other direction and is scenery.
 * Local frame (localFrame.ts): u along the 60 m street face (parallel to the line), t inward from it; the
 * line's centre is at t -10, so the station's stamp must be placed with its face 10 m from the line.
 */
export const STATION = { fw: 60, depth: 24, line: -10 } as const;

/** Platform (and upper concourse) floor, rail top and deck top, in metres. */
export const PLATFORM_Y = 9.1;
export const RAIL_Y = 8.2;
const DECK_Y = 8.0;
const NEAR = STATION.line + 2.2;
const FAR = STATION.line - 2.2;
const EDGE = NEAR + 1.55;
const FAR_EDGE = FAR - 1.55;
const STAIR = { t0: 14, t1: 17, u0: 34, u1: 49 } as const;
const UPPER = { u0: 30, u1: 58 } as const;
const GATES = [14, 16, 18, 20, 22, 24, 26, 28, 30, 32];

const onStair = (u: number, t: number): boolean => t >= STAIR.t0 && t <= STAIR.t1 && u >= STAIR.u0 && u <= STAIR.u1;
const onRaised = (u: number, t: number): boolean =>
  (t >= EDGE && t <= -1 && u >= 1 && u <= 59) || (t >= -1 && t <= STATION.depth && u >= UPPER.u0 && u <= UPPER.u1 && !onStair(u, t));

/**
 * How far a station's portal-frame columns stand from its line (a road without a median under it: portalOffset),
 * else null (one column on the line: in the median, or no road under it).
 */
export function stationKerb(b: Building3, under: RoadUnder): number | null {
  const f = localFrame(b);
  const [x, z] = toWorld(f, STATION.fw / 2, STATION.line);
  const road = under(x, z, Math.abs(f.r[2]) > Math.abs(f.r[0]));
  return road && !road.median ? portalOffset(road) : null;
}

/**
 * Where a station's piers stand: along it (u), single columns every 12 m; portal frames fewer, in the middle
 * stretch (the street's bus stops stand at an edge's middle, which a station's end can reach); across (t), one on
 * the line or a portal frame's two at the back of the pavements.
 */
const piersU = (off: number | null): number[] => (off === null ? [6, 18, 30, 42, 54] : [12, 24, 36, 48]);
const pierTs = (off: number | null): number[] => (off === null ? [STATION.line] : [STATION.line - off, STATION.line + off]);

/** Floor at a world point: the stair ramp, or the platform level where it overlaps the street (by level). */
export function stationFloor(b: Building3, x: number, z: number, current: number): number | null {
  const [u, t] = toLocal(localFrame(b), x, z);
  if (onStair(u, t)) return (PLATFORM_Y * (u - STAIR.u0)) / (STAIR.u1 - STAIR.u0);
  if (onRaised(u, t)) return current > PLATFORM_Y / 2 ? PLATFORM_Y : null;
  return null;
}

/** Collision on the walker's level: the street and concourse, the stairs, or the platform level. */
export function stationColliders(b: Building3, floor: number, kerb: number | null = null): Rect[] {
  const f = localFrame(b);
  const R = (u0: number, u1: number, t0: number, t1: number): Rect => localRect(f, u0, u1, t0, t1);
  const { fw, depth } = STATION;
  if (floor <= 1) {
    return [
      R(0, 18, 0, 0.3),
      R(28, fw, 0, 0.3),
      R(0, fw, depth - 0.3, depth),
      R(0, 0.3, 0, depth),
      R(fw - 0.3, fw, 0, depth),
      R(4, 14, 0.3, 1.0),
      ...GATES.map((u) => R(u - 0.15, u + 0.15, 5.2, 6.8)),
      R(0.3, 13.85, 5.9, 6.1),
      R(33, 40, 0.3, 6.8),
      R(40, fw - 0.3, 5.9, 6.1),
      R(STAIR.u0, STAIR.u1, STAIR.t0 - 0.2, STAIR.t0),
      R(STAIR.u0, STAIR.u1, STAIR.t1, STAIR.t1 + 0.2),
      R(STAIR.u1 - 0.2, STAIR.u1, STAIR.t0, STAIR.t1),
      ...piersU(kerb).flatMap((u) => (kerb === null ? [R(u - 1.2, u + 1.2, STATION.line - 0.8, STATION.line + 0.8)] : pierTs(kerb).map((t) => R(u - 0.5, u + 0.5, t - 0.5, t + 0.5)))),
    ];
  }
  if (floor < 8) return [R(STAIR.u0 - 1, STAIR.u1 + 1, STAIR.t0 - 0.3, STAIR.t0), R(STAIR.u0 - 1, STAIR.u1 + 1, STAIR.t1, STAIR.t1 + 0.3)];
  return [
    R(0, fw, EDGE - 0.35, EDGE),
    R(0.5, 1, EDGE, 0),
    R(59, 59.5, EDGE, 0),
    R(1, UPPER.u0, -1, 0),
    R(UPPER.u1, 59, -1, 0),
    R(UPPER.u0, UPPER.u1, depth - 0.3, depth),
    R(UPPER.u0 - 0.3, UPPER.u0, 0, depth),
    R(UPPER.u1, UPPER.u1 + 0.3, 0, depth),
    R(STAIR.u0 - 0.3, STAIR.u1, STAIR.t0 - 0.3, STAIR.t0),
    R(STAIR.u0 - 0.3, STAIR.u1, STAIR.t1, STAIR.t1 + 0.3),
    R(STAIR.u0 - 0.3, STAIR.u0, STAIR.t0, STAIR.t1),
  ];
}

/** Lightmap lights: the entrance under the tracks, the sidewalk under the platforms, the concourse. */
export function stationLights(b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: [number, number, number], i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  return [
    L(23, -2, 7, [0.9, 0.95, 1.0], 0.9),
    ...[8, 40, 52].map((u) => L(u, -2, 5, [0.85, 0.9, 1.0], 0.55)),
    ...[10, 25, 45].map((u) => L(u, 4, 6, [0.9, 0.95, 1.0], 0.6)),
  ];
}

export interface StationNames {
  readonly jp: string;
  readonly en: string;
}

export function buildStation(b: Building3, city: THREE.Material, names: StationNames, other: StationNames | null, line: { name: string; nameEn: string; color: number; kind?: 'train' | 'monorail'; letter?: string }, kerb: number | null = null): THREE.Group {
  const f = localFrame(b);
  const group = new THREE.Group();
  const mb = new MeshBuilder();
  mb.id = b.id;
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  const box = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number, bottom = y0 > 0.3): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.plain, bottom);
  };
  const glow = (rgb: [number, number, number], u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = rgb;
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  /** A surface under the station's own lights. */
  const lit = (hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.lit, 0, 0, 0];
    mb.color = lin(hex);
    localBox(mb, f, u0, u1, t0, t1, y0, y1, KIND.emit, y0 > 0.3);
    mb.style = [0, 0, 0, 0];
  };
  const post = (hex: number, u: number, t: number, y0: number, y1: number, r: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    const [x, z] = toWorld(f, u, t);
    mb.cylinder(x, z, y0, y1, r, 10);
  };
  const { fw, depth } = STATION;
  const lineColor = new THREE.Color(line.color);
  const CLAD = 0xc8ccd0;

  // The building: light cladding, ribbon windows on the upper storey (the city shader draws them).
  mb.kind = KIND.wall;
  mb.color = lin(CLAD);
  mb.flags = 8 + 3 * 16;
  mb.style = [2.4, 0.55, 1.4, WIN.ribbon + 8 * 3];
  mb.frontNormal = null;
  localBox(mb, f, 0, UPPER.u0 - 0.3, 0.3, depth, 8.3, 16, KIND.roof);
  localBox(mb, f, UPPER.u1 + 0.3, fw, 0.3, depth, 8.3, 16, KIND.roof);
  mb.style = [0, 0, 0, 0];
  mb.flags = 0;
  // Over the upper concourse: the roof, the back wall and a band above the opening onto the platform.
  box(CLAD, UPPER.u0 - 0.3, UPPER.u1 + 0.3, 0.3, depth, 15.7, 16, true);
  lit(CLAD, UPPER.u0, UPPER.u1, depth - 0.3, depth, PLATFORM_Y, 16);
  box(CLAD, UPPER.u0 - 0.3, UPPER.u1 + 0.3, 0, 0.3, 12.65, 16, true);
  box(0x3a3c40, 0, fw, 0, depth, 16, 16.6);
  // Ground floor: glass front (mullions) with the open entrance, solid sides and back, a bright concourse.
  lit(0xd8dadc, 0, fw, 0, depth, -0.01, 0.03);
  box(CLAD, 0, 0.3, 0, depth, 0, 8.3);
  box(CLAD, fw - 0.3, fw, 0, depth, 0, 8.3);
  box(CLAD, 0, fw, depth - 0.3, depth, 0, 8.3);
  for (let u = 0; u <= fw; u += 3) if (u < 18 || u > 28) box(0x3a3c40, u - 0.06, u + 0.06, 0, 0.3, 0, 8.3);
  box(0x3a3c40, 0, fw, 0, 0.3, 3.4, 3.6);
  // The ceiling, open over the stair like the upper concourse's floor above it (the light strip over it stops too);
  // it stops at the outside of the stair's side walls, which rise through it.
  box(0xf0f0ee, 0.3, STAIR.u0, 0.3, depth - 0.3, 7.9, 8.3, true);
  box(0xf0f0ee, STAIR.u0, fw - 0.3, 0.3, STAIR.t0 - 0.2, 7.9, 8.3, true);
  box(0xf0f0ee, STAIR.u0, fw - 0.3, STAIR.t1 + 0.2, depth - 0.3, 7.9, 8.3, true);
  box(0xf0f0ee, STAIR.u1, fw - 0.3, STAIR.t0 - 0.2, STAIR.t1 + 0.2, 7.9, 8.3, true);
  for (const t of [3, 9, 15, 21]) {
    const over = t > STAIR.t0 - 0.2 && t < STAIR.t1 + 0.2;
    for (const [u0, u1] of over ? [[1, STAIR.u0], [STAIR.u1, fw - 1]] : [[1, fw - 1]]) glow([1.3, 1.35, 1.4], u0, u1, t - 0.1, t + 0.1, 7.86, 7.9);
  }
  // Ticket machines with lit screens, the fare map above them.
  for (let u = 4.4; u < 14; u += 2) {
    lit(0xe8e8e4, u - 0.8, u + 0.8, 0.3, 1.0, 0, 1.6);
    glow([0.35, 0.6, 0.9], u - 0.5, u + 0.5, 1.0, 1.01, 0.95, 1.45);
  }
  glow([0.95, 0.95, 0.9], 4, 14, 0.3, 0.32, 2.2, 3.2);
  // Automatic gates: cabinets with blue/green lamps, a fence either side, the staff office.
  for (const u of GATES) {
    lit(0xd0d4d8, u - 0.15, u + 0.15, 5.2, 6.8, 0, 1.0);
    box(0x2a2c30, u - 0.16, u + 0.16, 5.2, 6.8, 1.0, 1.05);
    glow([0.2, 0.9, 0.5], u - 0.1, u + 0.1, 5.25, 5.35, 1.05, 1.1);
    glow([0.2, 0.5, 1.0], u - 0.1, u + 0.1, 6.65, 6.75, 1.05, 1.1);
  }
  box(0x9aa0a6, 0.3, 13.85, 5.9, 6.1, 0, 1.1);
  box(0x9aa0a6, 40, fw - 0.3, 5.9, 6.1, 0, 1.1);
  box(0xb8bcc0, 33, 40, 0.3, 6.8, 0, 2.8);
  glow([0.9, 0.85, 0.7], 33.5, 39.5, 6.8, 6.82, 1.0, 2.2);
  // The departure board over the gates (lines of amber text as lit strips).
  box(0x101012, 15, 31, 5.85, 6.15, 3.0, 4.2);
  for (let k = 0; k < 3; k++) {
    glow([1.3, 0.6, 0.1], 15.4, 21, 5.84, 5.85, 3.2 + k * 0.33, 3.38 + k * 0.33);
    glow([0.2, 1.1, 0.4], 21.4, 24, 5.84, 5.85, 3.2 + k * 0.33, 3.38 + k * 0.33);
    glow([1.2, 1.2, 1.1], 24.4, 30.6, 5.84, 5.85, 3.2 + k * 0.33, 3.38 + k * 0.33);
  }
  // Stairs up from the paid area: steps with light nosings, side walls, a handrail.
  const steps = 26;
  const run = (STAIR.u1 - STAIR.u0) / steps;
  for (let i = 0; i < steps; i++) {
    const u0 = STAIR.u0 + i * run;
    const top = (PLATFORM_Y * (i + 1)) / steps;
    lit(0xb0b0ac, u0, u0 + run, STAIR.t0, STAIR.t1, 0, top);
    box(0xe0c040, u0, u0 + 0.05, STAIR.t0, STAIR.t1, top, top + 0.01);
  }
  lit(CLAD, STAIR.u0, STAIR.u1, STAIR.t0 - 0.2, STAIR.t0, 0, PLATFORM_Y + 1.1);
  lit(CLAD, STAIR.u0, STAIR.u1, STAIR.t1, STAIR.t1 + 0.2, 0, PLATFORM_Y + 1.1);
  // Upper concourse: the floor slab (with the stair opening), benches, a kiosk, a big window on the street.
  lit(0xc8c4bc, UPPER.u0, STAIR.u0, 0, depth, 8.3, PLATFORM_Y);
  lit(0xc8c4bc, STAIR.u0, UPPER.u1, 0, STAIR.t0 - 0.2, 8.3, PLATFORM_Y);
  lit(0xc8c4bc, STAIR.u0, UPPER.u1, STAIR.t1 + 0.2, depth, 8.3, PLATFORM_Y);
  lit(0xc8c4bc, STAIR.u1, UPPER.u1, STAIR.t0 - 0.2, STAIR.t1 + 0.2, 8.3, PLATFORM_Y);
  // The rail round the opening: a skin outside the stair's side walls (which rise through it), and across its low end.
  box(0x9aa0a6, STAIR.u0, STAIR.u1, STAIR.t0 - 0.3, STAIR.t0 - 0.2, PLATFORM_Y, PLATFORM_Y + 1.1);
  box(0x9aa0a6, STAIR.u0, STAIR.u1, STAIR.t1 + 0.2, STAIR.t1 + 0.3, PLATFORM_Y, PLATFORM_Y + 1.1);
  box(0x9aa0a6, STAIR.u0 - 0.3, STAIR.u0, STAIR.t0 - 0.3, STAIR.t1 + 0.3, PLATFORM_Y, PLATFORM_Y + 1.1);
  lit(CLAD, UPPER.u0 - 0.3, UPPER.u0, 0, depth, PLATFORM_Y, 16);
  lit(CLAD, UPPER.u1, UPPER.u1 + 0.3, 0, depth, PLATFORM_Y, 16);
  for (const t of [4, 10, 20]) glow([1.3, 1.35, 1.4], UPPER.u0 + 1, UPPER.u1 - 1, t - 0.1, t + 0.1, 15.5, 15.55);
  box(0xf0f0ee, UPPER.u0, UPPER.u1, 0.3, depth, 15.55, 15.7, true);
  for (const u of [38, 44, 52]) box(0x5a6a7a, u - 1.2, u + 1.2, 20, 20.6, PLATFORM_Y, PLATFORM_Y + 0.45);
  box(0x2a7a50, 52, 57, 8, 11, PLATFORM_Y, PLATFORM_Y + 1.1);
  glow([1.0, 0.9, 0.7], 52, 57, 7.98, 8, PLATFORM_Y + 0.4, PLATFORM_Y + 1.0);

  // The viaduct deck under the station, its piers, and the track beds for both tracks (a monorail: the deck only
  // under the platforms, the two beams running through the open trench between them).
  const mono = line.kind === 'monorail';
  if (mono) {
    box(0x8a8a86, 0, fw, FAR_EDGE - 1.5, FAR_EDGE, 6.8, DECK_Y, true);
    box(0x8a8a86, 0, fw, EDGE, 0, 6.8, DECK_Y, true);
    for (const tc of [NEAR, FAR]) box(0xc8c4bc, 0, fw, tc - 0.43, tc + 0.43, 6.2, RAIL_Y, true);
  } else box(0x8a8a86, 0, fw, FAR_EDGE - 1.5, 0, 6.8, DECK_Y, true);
  for (const u of piersU(kerb)) {
    if (kerb === null) {
      box(0x9a9894, u - 1.2, u + 1.2, STATION.line - 0.8, STATION.line + 0.8, 0, 6.2);
      box(0x9a9894, u - 1.4, u + 1.4, FAR_EDGE - 1.2, 0, 6.2, 6.8, true);
      continue;
    }
    // A portal frame: a column on each pavement, the beam across under the deck (reaching past it to the far one).
    const [t0, t1] = pierTs(kerb);
    for (const t of [t0, t1]) box(0x9a9894, u - 0.5, u + 0.5, t - 0.5, t + 0.5, 0, 5.8);
    box(0x9a9894, u - 0.7, u + 0.7, Math.min(t0 - 0.5, FAR_EDGE - 1.2), Math.max(t1 + 0.5, 0), 5.8, 6.8, true);
  }
  for (const tc of mono ? [] : [NEAR, FAR]) {
    box(0x3a3a3c, 0, fw, tc - 1.3, tc + 1.3, DECK_Y, DECK_Y + 0.08);
    for (const s of [-0.53, 0.53]) box(0xb0b0b4, 0, fw, tc + s - 0.035, tc + s + 0.035, DECK_Y + 0.08, RAIL_Y);
    for (let u = 0.3; u < fw; u += 0.6) box(0x5a5a58, u, u + 0.24, tc - 1.1, tc + 1.1, DECK_Y + 0.08, DECK_Y + 0.12);
  }
  // Platforms: slabs, tactile strips, platform screen doors, benches, a vending machine, the canopy.
  const platform = (t0: number, t1: number, edge: number, doorSide: number): void => {
    lit(0xb4b0a8, 1, 59, t0, t1, DECK_Y, PLATFORM_Y);
    box(0xe8c030, 1, 59, edge - doorSide * 0.9, edge - doorSide * 0.6, PLATFORM_Y, PLATFORM_Y + 0.01);
    for (let u = 1; u < 59; u += 4.6) {
      lit(0xe8e8e4, u, u + 3.2, Math.min(edge - 0.2 * doorSide, edge), Math.max(edge - 0.2 * doorSide, edge), PLATFORM_Y, PLATFORM_Y + 1.3);
      box(line.color, u, u + 3.2, edge - 0.22 * doorSide, edge + 0.02 * doorSide, PLATFORM_Y + 1.15, PLATFORM_Y + 1.3);
    }
    for (const u of [12, 36]) box(0x5a6a7a, u - 1.2, u + 1.2, (t0 + t1) / 2 - 0.3, (t0 + t1) / 2 + 0.3, PLATFORM_Y, PLATFORM_Y + 0.45);
  };
  platform(EDGE, -1, EDGE, -1);
  platform(FAR_EDGE - 3.2, FAR_EDGE, FAR_EDGE, 1);
  lit(0xb4b0a8, UPPER.u0, UPPER.u1, -1, 0, 8.3, PLATFORM_Y);
  box(0xd02a2a, 24, 25, -2.2, -1.4, PLATFORM_Y, PLATFORM_Y + 1.8);
  glow([0.9, 0.9, 0.85], 24.05, 24.95, -1.39, -1.38, PLATFORM_Y + 0.9, PLATFORM_Y + 1.7);
  box(0x9aa0a6, 1, 59, FAR_EDGE - 4.6, FAR_EDGE - 3.2, 6.8, PLATFORM_Y + 1.1);
  box(0x9aa0a6, 1, UPPER.u0, -0.9, -0.7, PLATFORM_Y, PLATFORM_Y + 1.1);
  const CANOPY = 12.4;
  lit(0xd8dadc, 0, fw, FAR_EDGE - 4, 0, CANOPY, CANOPY + 0.25);
  box(line.color, 0, fw, FAR_EDGE - 4.02, FAR_EDGE - 3.98, CANOPY - 0.3, CANOPY + 0.25);
  for (let u = 5; u < 58; u += 10) {
    post(0x8a8e92, u, -3.4, PLATFORM_Y, CANOPY, 0.12);
    post(0x8a8e92, u, FAR_EDGE - 1.6, PLATFORM_Y, CANOPY, 0.12);
  }
  for (const t of [-3.4, FAR_EDGE - 1.6]) glow([1.3, 1.35, 1.4], 1, 59, t - 0.08, t + 0.08, CANOPY - 0.04, CANOPY);

  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  // Glass: the ground-floor front.
  const glass = new MeshBuilder();
  const pane = (u0: number, u1: number, y0: number, y1: number, t: number): void => {
    const [ax, az] = toWorld(f, u0, t);
    const [bx, bz] = toWorld(f, u1, t);
    glass.quad([ax, y0, az], [bx - ax, 0, bz - az], [0, y1 - y0, 0]);
  };
  pane(0.3, 18, 0, 8.3, 0.15);
  pane(28, fw - 0.3, 0, 8.3, 0.15);
  const glassMesh = new THREE.Mesh(glass.build()!, new THREE.MeshStandardMaterial({ color: 0xa8c4cc, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }));
  glassMesh.renderOrder = 3;
  group.add(glassMesh);

  // Signs: the big name on the building, the entrance sign under the tracks, the station name boards.
  const canvas = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  const plane = (tex: THREE.Texture, w: number, h: number, u: number, t: number, y: number, facing: 'out' | 'in', bright = 1.1): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(bright, bright, bright) }));
    const [x, z] = toWorld(f, u, t);
    m.position.set(x, y, z);
    const n = facing === 'out' ? f.n : [-f.n[0], 0, -f.n[2]];
    m.rotation.y = Math.atan2(n[0], n[2]);
    group.add(m);
  };
  const lineHex = `#${lineColor.getHexString()}`;
  const text = (g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = 'center'): void => {
    g.font = font;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = fill;
    g.fillText(s, x, y);
  };
  const logo = (g: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
    g.fillStyle = lineHex;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x, y, r * 0.62, 0, Math.PI * 2);
    g.fill();
    text(g, line.letter ?? 'T', x, y + r * 0.05, `900 ${Math.round(r)}px 'Arial Black', 'Arial', sans-serif`, lineHex);
  };
  /** Text at up to size px, shrunk to fit maxW (long names, long line names). */
  const fit = (g: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, family: string, fill: string, maxW: number, align: CanvasTextAlign = 'center'): void => {
    g.font = family.replace('{px}', `${size}px`);
    const k = Math.min(1, maxW / Math.max(1, g.measureText(str).width));
    text(g, str, x, y, family.replace('{px}', `${Math.floor(size * k)}px`), fill, align);
  };
  // On the building above the canopy.
  plane(canvas(1600, 260, (g) => {
    g.fillStyle = '#f4f4f2';
    g.fillRect(0, 0, 1600, 260);
    g.fillStyle = lineHex;
    g.fillRect(0, 220, 1600, 40);
    logo(g, 130, 110, 80);
    fit(g, `${names.jp}${filipino() ? '' : '駅'}`, 540, 110, 150, "900 {px} 'Yu Gothic', 'Meiryo', sans-serif", '#1a1a1a', 560);
    fit(g, `${names.en} STATION`, 1210, 115, 86, "bold {px} 'Arial', sans-serif", '#2a2a2a', 700);
  }), 20, 3.25, 30, -0.02, 14.4, 'out');
  // The entrance, under the tracks.
  plane(canvas(1000, 160, (g) => {
    g.fillStyle = '#1a1a1c';
    g.fillRect(0, 0, 1000, 160);
    logo(g, 80, 80, 56);
    fit(g, `${names.jp}${filipino() ? '' : '駅'}`, 160, 80, 90, "900 {px} 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff', 360, 'left');
    fit(g, `${line.nameEn} · ${line.name}`, 960, 80, 50, "bold {px} 'Arial', 'Yu Gothic', sans-serif", '#ffffff', 400, 'right');
  }), 10, 1.6, 23, -0.02, 4.4, 'out', 1.3);
  // Station name boards (駅名標) on both platforms, facing the tracks.
  const board = canvas(900, 400, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 900, 400);
    text(g, names.jp, 450, 120, "900 140px 'Yu Gothic', 'Meiryo', sans-serif", '#1a1a1a');
    text(g, names.en, 450, 225, "bold 60px 'Arial', sans-serif", '#3a3a3a');
    g.fillStyle = lineHex;
    g.fillRect(0, 290, 900, 110);
    logo(g, 450, 345, 44);
    if (other) fit(g, `← ${other.jp} ${other.en}`, 40, 345, 44, "bold {px} 'Yu Gothic', 'Meiryo', sans-serif", '#ffffff', 340, 'left');
  });
  for (const u of [18, 44]) {
    box(0x6a6e72, u - 1.6, u + 1.6, -1.6, -1.5, PLATFORM_Y + 1.6, PLATFORM_Y + 3.4);
    plane(board, 3.0, 1.33, u, -1.62, PLATFORM_Y + 2.5, 'out');
    box(0x6a6e72, u - 1.6, u + 1.6, FAR_EDGE - 3.1, FAR_EDGE - 3.0, PLATFORM_Y + 1.6, PLATFORM_Y + 3.4);
    plane(board, 3.0, 1.33, u, FAR_EDGE - 2.98, PLATFORM_Y + 2.5, 'in');
  }
  // People waiting on both platforms, a step back from the edge, facing the track.
  const waiting: PassengerSpot[] = [];
  for (let u = 4; u < 56; u += 2.3) {
    for (const [t, dt] of [[EDGE + 1.2, -1], [FAR_EDGE - 1.2, 1]] as const) {
      const [x, z] = toWorld(f, u + ((u * 7) % 1.4) - 0.7, t + (((u * 13) % 1) - 0.5) * 0.8);
      waiting.push({ x, z, y: PLATFORM_Y, yaw: localYaw(f, 0, dt) });
    }
  }
  const people = passengerMesh([], waiting, b.id * 31 + 7, { seat: 0, stand: 0.35 }, undefined, ['stand', 'stand', 'phone', 'phone', 'pockets']);
  if (people) group.add(people);
  return group;
}
