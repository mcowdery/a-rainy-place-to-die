import * as THREE from 'three';
import type { Terrain } from '../district/terrain';
import { addTree, type TreeSpecies } from '../models/trees';
import { inPark, PONDS } from '../district/parkLand';
import { poolTexture } from './expressway';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { splitByTile } from './tiles';

/**
 * 夕凪リバーサイドパーク, Yūnagi Riverside Park: the land between the river and the Yūnagi headland, which the first
 * minutes of the game look out over (you come out of the tunnel onto the Wangan above it). It was a bare dark slab
 * of unbuilt land; it is built here from the city's own pieces so it has the city's quality: the city shader's lawns
 * (seasonal, lit by the lightmap), its gravel paths and still water, its tree species with their own leaves
 * (`models/trees.ts`: sakura, black pine, camphor), a stone embankment where it meets the river and the sea, a sand
 * shore, sodium lamps and benches. One mesh on the city material, cut into tiles so it's culled as it goes by.
 *
 * Land is decided by `land(x, z)` (unbuilt, dry cells of the macro map), everything is placed in world metres, and
 * nothing stands within the roads' margins (`clear`).
 */
type V3 = [number, number, number];

/** Is (x, z) in the park's land (the parkLand.ts rect)? */
export const parkLand = inPark;

export interface ParkSpec {
  readonly terrain: Terrain;
  /** What is at (x, z): a built district, open land (the park's), water, or hills beyond. */
  readonly what: (x: number, z: number) => 'land' | 'water' | 'built' | 'hills';
  /** Is a footprint of radius r at (x, z) in the way of a road (the tunnel's bank, the viaduct)? */
  readonly clear: (x: number, z: number, r: number) => boolean;
  /** The Wangan's centre line (z) where it crosses the park, from `x0` to `x1`: trees keep off it. */
  readonly viaduct: { readonly z: number; readonly x0: number; readonly x1: number };
  /** The headland's mound (real/expressway.ts `hillOf`): its height at a point, null where it isn't. */
  readonly hill: { readonly cx: number; readonly cz: number; readonly at: (x: number, z: number) => number | null } | null;
  /** The area to cover (m). */
  readonly area: { readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number };
}

const rnd = (a: number, b: number, c: number): number => {
  let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};
const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

const CELL = 8;
const LAWN = [0x4a6e36, 0x42683a, 0x507438, 0x3e6234];
const SAND = 0xd6c79e;
const WALL = 0x8e8c86;

/** The loop path and the riverside promenade: world points (m), smoothed. */
const LOOP: [number, number][] = [
  [4884, 2480], [4930, 2452], [4990, 2440], [5050, 2432], [5125, 2446], [5185, 2490], [5205, 2550], [5185, 2610], [5125, 2640], [5050, 2636], [4975, 2628], [4915, 2600], [4884, 2570],
];
const PROMENADE: [number, number][] = [[4884, 2330], [4884, 2660]];
const SHORE_WALK: [number, number][] = [[4884, 2716], [4884, 2780]];
/** Lamps and benches stand along these (spacing m). */
const LAMP_STEP = 38;

function pondE(x: number, z: number, p: (typeof PONDS)[number]): number {
  return ((x - p.cx) / p.a) ** 2 + ((z - p.cz) / p.b) ** 2;
}

/** A polyline smoothed by Chaikin's corner cutting, then sampled about every `step` m. */
function smoothLine(pts: [number, number][], closed: boolean, step: number): [number, number][] {
  let p = pts;
  for (let it = 0; it < 3; it++) {
    const out: [number, number][] = [];
    const n = p.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i];
      const b = p[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = closed ? out : [p[0], ...out, p[n - 1]];
  }
  const res: [number, number][] = [p[0]];
  let carry = 0;
  const m = p.length;
  for (let i = 1; i < (closed ? m + 1 : m); i++) {
    const a = p[i - 1];
    const b = p[i % m];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let at = step - carry;
    while (at <= len) {
      res.push([a[0] + ((b[0] - a[0]) * at) / len, a[1] + ((b[1] - a[1]) * at) / len]);
      at += step;
    }
    carry = len - (at - step);
  }
  return res;
}

export function buildPark(spec: ParkSpec, city: THREE.Material): THREE.Group {
  const { terrain, what, clear, viaduct, hill, area } = spec;
  const group = new THREE.Group();
  group.name = 'park';
  const mb = new MeshBuilder(1 << 20);
  mb.style = [0, 0, 0, 0];
  mb.id = 0;
  mb.flags = 0;

  const isLand = (x: number, z: number): boolean => what(x, z) === 'land';
  // The lawn's height: the ground's, a little over it, hollowed round the ponds (their banks).
  // The lawn lies on the ground (the dark plate of unbuilt land, real/sea.ts, is left out under the park: main.ts counts its
  // cells as built for the sea), so a walker's eyes, set from the terrain, are the right height over it.
  const baseY = (x: number, z: number): number => terrain.height(x, z) + 0.04;
  const pondDepth = (x: number, z: number): number => {
    let d = 0;
    for (const p of PONDS) {
      const e = Math.sqrt(pondE(x, z, p));
      d = Math.min(d, -0.3 * (1 - smooth((e - 1) / 0.6)));
    }
    return d;
  };
  const lawnY = (x: number, z: number): number => baseY(x, z) + pondDepth(x, z);
  const waterY = (p: (typeof PONDS)[number]): number => baseY(p.cx, p.cz) - 0.2;

  const face = (a: V3, b: V3, c: V3, d: V3, n: V3): void => {
    const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const dot = (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2];
    if (dot >= 0) mb.quadN(a, b, c, d, n, n, n, n);
    else mb.quadN(a, d, c, b, n, n, n, n);
  };
  const UP: V3 = [0, 1, 0];

  // ---- The lawn, the sand shore, the stone embankment where land meets water ----
  const x0 = Math.floor(area.x0 / CELL) * CELL;
  const z0 = Math.floor(area.z0 / CELL) * CELL;
  for (let z = z0; z < area.z1; z += CELL) {
    for (let x = x0; x < area.x1; x += CELL) {
      const mx = x + CELL / 2;
      const mz = z + CELL / 2;
      if (!isLand(mx, mz)) continue;
      // (The sea's side gets a sand shore; the river's keeps its lawn and promenade.)
      const shore = what(mx, mz + 22) === 'water' || what(mx, mz - 22) === 'water';
      const hex = shore ? SAND : LAWN[Math.floor(rnd(Math.floor(x / 24), Math.floor(z / 24), 0x1a) * LAWN.length)];
      mb.kind = shore ? KIND.gravel : KIND.grass;
      mb.color = lin(hex);
      face([x, lawnY(x, z), z], [x + CELL, lawnY(x + CELL, z), z], [x + CELL, lawnY(x + CELL, z + CELL), z + CELL], [x, lawnY(x, z + CELL), z + CELL], UP);
      // The wall: a face down to below the water on each side that meets it.
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        if (what(mx + dx * CELL, mz + dz * CELL) !== 'water') continue;
        mb.kind = KIND.plain;
        mb.color = lin(WALL);
        const ex = dx > 0 ? x + CELL : x;
        const ez = dz > 0 ? z + CELL : z;
        const a: V3 = dx !== 0 ? [ex, lawnY(ex, z), z] : [x, lawnY(x, ez), ez];
        const b: V3 = dx !== 0 ? [ex, lawnY(ex, z + CELL), z + CELL] : [x + CELL, lawnY(x + CELL, ez), ez];
        face(a, b, [b[0], -3, b[2]], [a[0], -3, a[2]], [dx, 0, dz]);
      }
    }
  }

  // ---- Ponds: still water a little below the lawn, which dips to meet it (a fan, so the edge is round) ----
  for (const p of PONDS) {
    const wy = waterY(p);
    mb.kind = KIND.water;
    mb.color = lin(0x3a6a78);
    const E = 1.24;
    const N = 56;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2;
      const a1 = ((k + 1) / N) * Math.PI * 2;
      const P = (a: number): V3 => [p.cx + Math.cos(a) * p.a * E, wy, p.cz + Math.sin(a) * p.b * E];
      face([p.cx, wy, p.cz], P(a0), P(a1), P(a1), UP);
    }
  }

  // Solid things (the trunks, the lamp posts): rects for the walker's and the car's collision.
  const colliders: { x: number; y: number; w: number; h: number }[] = [];
  // ---- Paths (gravel ribbons), the promenade, lamps and benches ----
  const lamps: { x: number; y: number; z: number }[] = [];
  const ribbon = (pts: [number, number][], width: number, hex: number, lampSide: number, benches: boolean): void => {
    mb.kind = KIND.gravel;
    mb.color = lin(hex);
    const nrm = (i: number): [number, number] => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const [nax, naz] = nrm(i);
      const [nbx, nbz] = nrm(i + 1);
      const w = width / 2;
      const p = (px: number, pz: number, nx: number, nz: number, s: number): V3 => [px + nx * w * s, lawnY(px + nx * w * s, pz + nz * w * s) + 0.07, pz + nz * w * s];
      face(p(ax, az, nax, naz, -1), p(ax, az, nax, naz, 1), p(bx, bz, nbx, nbz, 1), p(bx, bz, nbx, nbz, -1), UP);
    }
    // Lamps (and benches facing the path) along it.
    let run = 0;
    let n = 0;
    for (let i = 1; i < pts.length; i++) {
      run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (run < LAMP_STEP) continue;
      run = 0;
      n++;
      const [nx, nz] = nrm(i);
      const [px, pz] = pts[i];
      const lx = px + nx * (width / 2 + 1.1) * lampSide;
      const lz = pz + nz * (width / 2 + 1.1) * lampSide;
      if (!clear(lx, lz, 8)) {
        lamps.push({ x: lx, y: lawnY(lx, lz), z: lz });
        colliders.push({ x: lx - 0.25, y: lz - 0.25, w: 0.5, h: 0.5 });
      }
      if (benches && n % 2 === 0) {
        const bx = px - nx * (width / 2 + 1.3) * lampSide;
        const bz = pz - nz * (width / 2 + 1.3) * lampSide;
        const by = lawnY(bx, bz);
        if (clear(bx, bz, 6) || pondDepth(bx, bz) < -0.1) continue;
        // A bench: slatted seat and back, along the path (axis-aligned: the paths here run mostly north-south or are short).
        const along = Math.abs(nx) > Math.abs(nz);
        mb.kind = KIND.plain;
        mb.color = lin(0x6e4e30);
        mb.box(bx, bz, by + 0.42, by + 0.5, along ? 0.5 : 1.7, along ? 1.7 : 0.5, KIND.plain, true);
        mb.box(bx - (along ? nx * 0.3 * lampSide : 0), bz - (along ? 0 : nz * 0.3 * lampSide), by + 0.5, by + 1.05, along ? 0.12 : 1.7, along ? 1.7 : 0.12, KIND.plain, true);
        mb.color = lin(0x2a2a2e);
        for (const s of [-0.7, 0.7]) mb.box(bx + (along ? 0 : s), bz + (along ? s : 0), by, by + 0.42, 0.08, 0.4, KIND.plain, true);
      }
    }
  };
  const loop = smoothLine(LOOP, true, 3);
  ribbon(loop, 3.2, 0xb8aa88, 1, true);
  ribbon(smoothLine(PROMENADE, false, 3), 5, 0xc4b894, 1, true);
  ribbon(smoothLine(SHORE_WALK, false, 3), 4, 0xc4b894, 1, false);
  // A link from the promenade to the loop's far side, past the northern pond.
  ribbon(smoothLine([[4884, 2400], [4925, 2395], [4985, 2410]], false, 3), 2.6, 0xb8aa88, 1, false);
  // Lamp posts: a slim pole and a hooded head, an emissive sodium lamp (on at night with the others).
  for (const l of lamps) {
    mb.kind = KIND.plain;
    mb.color = lin(0x24262a);
    mb.cylinder(l.x, l.z, l.y, l.y + 4.6, 0.07, 6);
    mb.box(l.x, l.z, l.y + 4.6, l.y + 4.72, 0.5, 0.5, KIND.plain, true);
    mb.kind = KIND.emit;
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = [2.4, 1.5, 0.6];
    mb.box(l.x, l.z, l.y + 4.5, l.y + 4.6, 0.42, 0.42, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  }

  // ---- Trees ----
  const placed: { x: number; z: number; r: number }[] = [];
  let trees = 0;
  const near = (x: number, z: number, r: number): boolean => placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r);
  const pathDist = (x: number, z: number): number => {
    let d = Infinity;
    for (const pts of [loop, PROMENADE]) for (const q of pts) d = Math.min(d, Math.hypot(q[0] - x, q[1] - z));
    return d;
  };
  const plant = (x: number, z: number, species: TreeSpecies, size: number, onHill = false): boolean => {
    const reach = 7 * size;
    if (clear(x, z, reach + 4)) return false;
    if (Math.abs(z - viaduct.z) < 24 && x > viaduct.x0 - 10 && x < viaduct.x1 + 10) return false;
    if (near(x, z, reach * 0.8)) return false;
    let y = terrain.height(x, z);
    if (onHill) {
      const hy = hill?.at(x, z) ?? null;
      if (hy === null || hy < y + 1) return false;
      y = hy;
    } else {
      if (!isLand(x, z) || !isLand(x + 7, z) || !isLand(x - 7, z) || !isLand(x, z + 7) || !isLand(x, z - 7)) return false;
      if (pondDepth(x, z) < -0.05) return false;
      y = lawnY(x, z);
      if (pathDist(x, z) < 4 + reach * 0.35) return false;
    }
    // (Trees are built at the origin's height: lifted to the ground after.)
    const from = mb.vertexCount;
    addTree(mb, { x, z, species, size, seed: Math.round(x * 7 + z * 13) });
    mb.lift(from, y);
    placed.push({ x, z, r: reach });
    // The trunk is solid (a rect round it, a little over its girth).
    const t = 0.5 + 0.2 * size;
    colliders.push({ x: x - t, y: z - t, w: 2 * t, h: 2 * t });
    trees++;
    return true;
  };

  // A blossom avenue either side of the Wangan, set back from it: the first thing you see leaving the tunnel is a row of
  // sakura along the road, with the river and the city at the end of it.
  for (const side of [-1, 1]) {
    for (let x = viaduct.x0 + 14; x < viaduct.x1 - 4; x += 10.5) {
      const z = viaduct.z + side * (28 + (rnd(x, side, 0x21) - 0.5) * 3);
      plant(x + (rnd(x, side, 0x22) - 0.5) * 3, z, 'sakura', 1.05 + rnd(x, side, 0x23) * 0.3);
    }
  }
  // Groves round the ponds and along the paths: sakura mostly, a few pines at the water's edge.
  for (const pts of [loop]) {
    for (let i = 0; i < pts.length; i += 5) {
      for (const side of [-1, 1]) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / l;
        const nz = (b[0] - a[0]) / l;
        const off = 8 + rnd(i, side, 0x31) * 13;
        const x = pts[i][0] + nx * off * side;
        const z = pts[i][1] + nz * off * side;
        const roll = rnd(i, side, 0x32);
        plant(x, z, roll < 0.78 ? 'sakura' : roll < 0.93 ? 'pine' : 'camphor', roll < 0.78 ? 0.9 + rnd(i, side, 0x33) * 0.45 : 0.9 + rnd(i, side, 0x34) * 0.3);
      }
    }
  }
  for (const p of PONDS) {
    for (let k = 0; k < 14; k++) {
      const ang = (k / 14) * Math.PI * 2 + rnd(k, p.cx, 0x41) * 0.4;
      const e = 1.75 + rnd(k, p.cx, 0x42) * 0.5;
      plant(p.cx + Math.cos(ang) * p.a * e, p.cz + Math.sin(ang) * p.b * e, k % 4 === 3 ? 'pine' : 'sakura', 0.95 + rnd(k, p.cz, 0x43) * 0.35);
    }
  }
  // Open meadow groves: scattered, thinning away from the paths.
  for (let z = area.z0; z < area.z1; z += 26) {
    for (let x = area.x0; x < area.x1; x += 26) {
      const jx = x + (rnd(x, z, 0x51) - 0.5) * 22;
      const jz = z + (rnd(x, z, 0x52) - 0.5) * 22;
      if (rnd(x, z, 0x53) > 0.4) continue;
      const roll = rnd(x, z, 0x54);
      plant(jx, jz, roll < 0.7 ? 'sakura' : roll < 0.9 ? 'pine' : 'camphor', 0.9 + rnd(x, z, 0x55) * 0.5);
    }
  }
  // The headland: black pines and a few camphors on the slopes.
  if (hill) {
    for (let k = 0; k < 140; k++) {
      const ang = rnd(k, 1, 0x61) * Math.PI * 2;
      const r = 40 + Math.sqrt(rnd(k, 2, 0x62)) * 150;
      plant(hill.cx + Math.cos(ang) * r, hill.cz + Math.sin(ang) * r, rnd(k, 3, 0x63) < 0.82 ? 'pine' : 'camphor', 0.9 + rnd(k, 4, 0x64) * 0.7, true);
    }
  }

  const geo = mb.build();
  if (geo) {
    for (const g of splitByTile(geo, 128)) {
      const mesh = new THREE.Mesh(g, city);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  // Pools of lamplight on the paths, shown at night with the lamps (as the expressway's).
  if (lamps.length) {
    const pm = new THREE.MeshBasicMaterial({ map: poolTexture(), color: new THREE.Color(0.22, 0.1, 0.03), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2), pm, lamps.length);
    const m4 = new THREE.Matrix4();
    lamps.forEach((l, i) => pools.setMatrixAt(i, m4.makeTranslation(l.x, l.y + 0.1, l.z)));
    pools.frustumCulled = false;
    pools.name = 'parkpools';
    group.add(pools);
  }
  group.userData.stats = { trees, lamps: lamps.length, triangles: mb.triangles };
  group.userData.colliders = colliders;
  return group;
}
