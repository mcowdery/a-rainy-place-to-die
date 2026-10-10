import * as THREE from 'three';
import type { MacroMap } from '../../gen/macro';
import type { Terrain } from '../district/terrain';

/**
 * The city's edges (docs/city-plan.md): what covers the hills round it (district/terrain.ts `hills`). Forest over
 * the slopes (clumps of canopy, instanced, darker greens), and along their foot, the cells just outside the city, a
 * fringe of low houses in rows on the rising ground, a few of their windows lit at night, fading into the haze.
 * The mountains beyond, on the horizon, are in the sky (real/sky.ts). Instanced in blocks of cells, each shown only
 * within reach of the camera.
 */

const BLOCK = 6;
const SHOW = 1700;
/** A tropical city's jungle blobs are 20-face beyond this distance from a block (80 within): its 40 a cell is ~1.1M triangles in view. */
const BLOB_LOD = 450;

/** A deterministic hash in [0, 1). */
function rnd(a: number, b: number, c: number): number {
  let h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** A unit house: walls to 0.7, a gable roof to 1 (its ridge along x), darker by vertex colour. */
function houseGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: number[], b: number[], c: number[], shade: number): void => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(shade, shade, shade);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], shade: number): void => {
    tri(a, b, c, shade);
    tri(a, c, d, shade);
  };
  const h = 0.7;
  const x0 = -0.5, x1 = 0.5, z0 = -0.5, z1 = 0.5;
  // Walls (outward winding).
  quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], 1);
  quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], 1);
  quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], 0.9);
  quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], 0.9);
  // Gable ends and the two roof slopes (overhanging a little).
  tri([x1, h, z1], [x1, h, z0], [x1, 1, 0], 0.9);
  tri([x0, h, z0], [x0, h, z1], [x0, 1, 0], 0.9);
  const o = 0.06;
  quad([x0 - o, h - 0.03, z1 + o], [x1 + o, h - 0.03, z1 + o], [x1 + o, 1, 0], [x0 - o, 1, 0], 0.32);
  quad([x1 + o, h - 0.03, z0 - o], [x0 - o, h - 0.03, z0 - o], [x0 - o, 1, 0], [x1 + o, 1, 0], 0.28);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A unit palm or banana clump for the tropical hills: a tapered trunk (height `trunk`) and `n` fronds drooping out
 * from its top to a tip `reach` away, `droop` below the crown; vertex colours (trunk brown, fronds green by their
 * distance out), two-sided strips. Scaled per instance (x/z by the crown width, y by the height).
 */
function plantGeometry(trunk: number, n: number, reach: number, droop: number, halfW: number, trunkR: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: number[], b: number[], c: number[], rgb: number[]): void => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(...rgb);
  };
  const bark = [0.36, 0.3, 0.22];
  const sides = 4;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const b0 = [Math.cos(a0) * trunkR, 0, Math.sin(a0) * trunkR];
    const b1 = [Math.cos(a1) * trunkR, 0, Math.sin(a1) * trunkR];
    const t0 = [Math.cos(a0) * trunkR * 0.5, trunk, Math.sin(a0) * trunkR * 0.5];
    const t1 = [Math.cos(a1) * trunkR * 0.5, trunk, Math.sin(a1) * trunkR * 0.5];
    tri(b0, b1, t1, bark);
    tri(b0, t1, t0, bark);
  }
  for (let f = 0; f < n; f++) {
    const a = (f / n) * Math.PI * 2 + (f % 2) * 0.2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz * halfW;
    const pz = dx * halfW;
    const up = f % 3 === 0 ? 0.12 : 0.04;
    const p = (r: number, y: number, w: number): [number[], number[]] => [[dx * r + px * w, trunk + y, dz * r + pz * w], [dx * r - px * w, trunk + y, dz * r - pz * w]];
    const [bl, br] = p(0.01, 0, 0.5);
    const [ml, mr] = p(reach * 0.5, up, 1);
    const [nl, nr] = p(reach * 0.85, up - droop * 0.45, 0.6);
    const tip = [dx * reach, trunk - droop, dz * reach];
    const lo = [0.2, 0.46, 0.14];
    const hi = [0.34, 0.62, 0.2];
    for (const flip of [false, true]) {
      const q = (a1: number[], b1: number[], c1: number[], rgb: number[]): void => (flip ? tri(a1, c1, b1, rgb) : tri(a1, b1, c1, rgb));
      q(bl, br, mr, lo);
      q(bl, mr, ml, lo);
      q(ml, mr, nr, hi);
      q(ml, nr, nl, hi);
      q(nl, nr, tip, hi);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export interface Edges {
  readonly group: THREE.Group;
  /** Show the blocks near the camera; windows lit when the lamps are (0-1). */
  update(camera: THREE.Vector3, lamps: number): void;
  /** The forest by the season (0 spring, 1 summer, 2 autumn, 3 winter): some of it deciduous. */
  setSeason(season: number): void;
  /** Snow lying on the forest's crowns and the houses' roofs (0-1, as the city's uSnow). */
  setSnow(amount: number): void;
}

/** Snow on what faces up, for the edges' own materials (flat-shaded crowns, the houses' roofs). */
function snowy(m: THREE.MeshStandardMaterial, snow: { value: number }): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = snow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uSnow > 0.0) {
          float upF = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.64, 0.68), smoothstep(0.15, 0.6, upF) * uSnow);
        }`);
  };
}

export function buildEdges(
  macro: MacroMap,
  cell: number,
  terrain: Terrain,
  built: (mx: number, my: number) => boolean,
  tropical = false,
  /** Whether a footprint of this radius at (x, z) would stand on a road the woods must keep off (a tunnel's). */
  blocked: (x: number, z: number, r: number) => boolean = () => false,
  /**
   * A view to keep pretty (the way out of the Yūnagi tunnel, where the game starts): within `radius` of (x, z) no house
   * stands among the trees. (The park there, real/park.ts, is built on top.)
   */
  scenic?: { readonly x: number; readonly z: number; readonly radius: number },
): Edges {
  const group = new THREE.Group();
  group.name = 'edges';
  const hills = terrain.hills;
  if (!hills) return { group, update: () => undefined, setSeason: () => undefined, setSnow: () => undefined };
  const pad = hills.pad;
  const kind = (mx: number, my: number) => macro.kindAt(Math.max(0, Math.min(macro.cols - 1, mx)), Math.max(0, Math.min(macro.rows - 1, my)));
  const treeGeo = new THREE.IcosahedronGeometry(1, 1);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const houseGeo = houseGeometry();
  const houseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, vertexColors: true });
  const snow = { value: 0 };
  snowy(treeMat, snow);
  snowy(houseMat, snow);
  const windowGeo = new THREE.PlaneGeometry(1.3, 0.9);
  const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.15, 0.65), fog: true });
  const blocks: { g: THREE.Group; x: number; z: number; windows: THREE.InstancedMesh | null; lod: { hi: THREE.InstancedMesh; lo: THREE.InstancedMesh; x0: number; z0: number; x1: number; z1: number } | null }[] = [];
  const treeLo = tropical ? new THREE.IcosahedronGeometry(1, 0) : null;
  const forests: { im: THREE.InstancedMesh; base: number[]; x: number[] }[] = [];
  // (A tropical city's hills are jungle: bright mixed greens, palms and banana clumps among the canopy.)
  const TREES = tropical ? [0x2f6a22, 0x3e8a2c, 0x4a9a34, 0x357a28, 0x5aa83a, 0x2a5a1e] : [0x28361f, 0x2f4024, 0x243020, 0x34452a, 0x2c3a1e];
  const palmGeo = tropical ? plantGeometry(0.82, 9, 0.9, 0.55, 0.11, 0.05) : null;
  const bananaGeo = tropical ? plantGeometry(0.25, 7, 1.0, 0.35, 0.2, 0.08) : null;
  const plantMat = tropical ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true, flatShading: true, side: THREE.DoubleSide }) : null;
  if (plantMat) snowy(plantMat, snow);
  const WALLS = [0xc8c0b0, 0xb8b0a0, 0xd8d0c0, 0xa8a49a, 0x9aa0a8, 0xc0b49c];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();

  for (let by = -pad; by < macro.rows + pad; by += BLOCK) {
    for (let bx = -pad; bx < macro.cols + pad; bx += BLOCK) {
      const trees: { x: number; y: number; z: number; r: number; h: number; col: number }[] = [];
      const plants: { palm: boolean; x: number; y: number; z: number; h: number; k: number }[] = [];
      const houses: { x: number; y: number; z: number; w: number; d: number; h: number; rot: number; col: number; lit: boolean }[] = [];
      for (let my = by; my < by + BLOCK; my++) {
        for (let mx = bx; mx < bx + BLOCK; mx++) {
          const inMap = mx >= 0 && my >= 0 && mx < macro.cols && my < macro.rows;
          // The hills past the city, and land in the map no district builds (unzoned residential cells round
          // the edge): the woods and the fringe of houses carry on over it rather than bare ground.
          const unzoned = inMap && macro.kindAt(mx, my) === 'residential' && !built(mx, my);
          if (inMap ? (macro.kindAt(mx, my) !== 'void' && !unzoned) || built(mx, my) : kind(mx, my) === 'water' || my >= macro.rows || mx >= macro.cols + pad) continue;
          const level = terrain.level(mx, my);
          if (level <= 0 && !unzoned) continue;
          const x0 = mx * cell;
          const z0 = my * cell;
          // The foot of the hills (the first cells out): rows of houses on the rising ground, trees between.
          const fringe = level < hills.rise * 1.7;
          if (fringe) {
            for (let r = 0; r < 5; r++) {
              for (let k = 0; k < 6; k++) {
                if (rnd(mx, my, r * 16 + k) < 0.18) continue;
                const x = x0 + 12 + k * 20 + (rnd(mx, my, r * 16 + k + 100) - 0.5) * 5;
                const z = z0 + 14 + r * 24 + (rnd(mx, my, r * 16 + k + 200) - 0.5) * 4;
                const w = 7 + rnd(mx, my, r * 16 + k + 300) * 4;
                const d = 6 + rnd(mx, my, r * 16 + k + 400) * 3;
                const h = 7 + rnd(mx, my, r * 16 + k + 500) * 3;
                houses.push({ x, z, y: terrain.height(x, z) - 0.3, w, d, h, rot: rnd(mx, my, r * 16 + k + 600) < 0.5 ? 0 : Math.PI / 2, col: WALLS[Math.floor(rnd(mx, my, r * 16 + k + 700) * WALLS.length)], lit: rnd(mx, my, r * 16 + k + 800) < 0.45 });
              }
            }
            if (tropical) {
              for (let k = 0; k < 4; k++) {
                const x = x0 + rnd(mx, my, k + 3000) * cell;
                const z = z0 + rnd(mx, my, k + 3100) * cell;
                plants.push({ palm: true, x, z, y: terrain.height(x, z) - 0.5, h: 12 + rnd(mx, my, k + 3200) * 6, k: rnd(mx, my, k + 3400) });
              }
            }
            for (let k = 0; k < 8; k++) {
              const x = x0 + rnd(mx, my, k + 900) * cell;
              const z = z0 + rnd(mx, my, k + 950) * cell;
              trees.push({ x, z, y: terrain.height(x, z), r: 3 + rnd(mx, my, k + 990) * 2, h: 5 + rnd(mx, my, k + 999) * 3, col: TREES[k % TREES.length] });
            }
          } else {
            // Forest: clumps of canopy, denser further up (jungle: denser, taller, with palms and banana clumps).
            const n = tropical ? 40 : 26;
            if (tropical) {
              for (let k = 0; k < 9; k++) {
                const x = x0 + rnd(mx, my, k + 3000) * cell;
                const z = z0 + rnd(mx, my, k + 3100) * cell;
                const palm = k < 6;
                plants.push({ palm, x, z, y: terrain.height(x, z) - 0.5, h: palm ? 15 + rnd(mx, my, k + 3200) * 9 : 4 + rnd(mx, my, k + 3300) * 2.5, k: rnd(mx, my, k + 3400) });
              }
            }
            for (let k = 0; k < n; k++) {
              const x = x0 + rnd(mx, my, k) * cell;
              const z = z0 + rnd(mx, my, k + 500) * cell;
              trees.push({ x, z, y: terrain.height(x, z), r: (tropical ? 7 : 6) + rnd(mx, my, k + 1000) * 5, h: (tropical ? 11 : 8) + rnd(mx, my, k + 1500) * (tropical ? 11 : 7), col: TREES[Math.floor(rnd(mx, my, k + 2000) * TREES.length)] });
            }
          }
        }
      }
      // (Nothing stands in a tunnel road's way: a tree in the middle of the carriageway, a house against its wall.)
      const keep = <T extends { x: number; z: number }>(list: T[], r: (t: T) => number): void => void list.splice(0, list.length, ...list.filter((t) => !blocked(t.x, t.z, r(t))));
      keep(trees, (t) => t.r + 3);
      keep(plants, () => 5);
      keep(houses, (h) => Math.max(h.w, h.d) / 2 + 4);
      if (scenic) houses.splice(0, houses.length, ...houses.filter((h) => Math.hypot(h.x - scenic.x, h.z - scenic.z) > scenic.radius));
      if (!trees.length && !houses.length) continue;
      const g = new THREE.Group();
      let windows: THREE.InstancedMesh | null = null;
      let lod: (typeof blocks)[number]['lod'] = null;
      if (trees.length) {
        const im = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
        trees.forEach((t, i) => {
          e.set(0, rnd(i, t.x | 0, t.z | 0) * Math.PI, 0);
          q.setFromEuler(e);
          m4.compose(v.set(t.x, t.y + t.h * 0.45, t.z), q, s.set(t.r, t.h * 0.6, t.r));
          im.setMatrixAt(i, m4);
          im.setColorAt(i, c.setHex(t.col));
        });
        im.computeBoundingSphere();
        im.receiveShadow = true;
        g.add(im);
        forests.push({ im, base: trees.map((t) => t.col), x: trees.map((t) => t.x * 31 + t.z) });
        if (treeLo) {
          // The far version shares the matrices and colours (so the seasons colour both).
          const lo = new THREE.InstancedMesh(treeLo, treeMat, trees.length);
          lo.instanceMatrix = im.instanceMatrix;
          lo.instanceColor = im.instanceColor;
          lo.boundingSphere = im.boundingSphere;
          lo.receiveShadow = true;
          lo.visible = false;
          g.add(lo);
          lod = { hi: im, lo, x0: bx * cell, z0: by * cell, x1: (bx + BLOCK) * cell, z1: (by + BLOCK) * cell };
        }
      }
      for (const palm of [true, false]) {
        const list = plants.filter((p) => p.palm === palm);
        if (!list.length || !palmGeo || !bananaGeo || !plantMat) continue;
        const im = new THREE.InstancedMesh(palm ? palmGeo : bananaGeo, plantMat, list.length);
        list.forEach((p, i) => {
          e.set(0, p.k * Math.PI * 2, 0);
          q.setFromEuler(e);
          const w = palm ? p.h * 0.38 : p.h;
          m4.compose(v.set(p.x, p.y, p.z), q, s.set(w, p.h, w));
          im.setMatrixAt(i, m4);
          im.setColorAt(i, c.setHex(p.k < 0.5 ? 0xffffff : 0xdce8c8));
        });
        im.computeBoundingSphere();
        im.receiveShadow = true;
        g.add(im);
      }
      if (houses.length) {
        const im = new THREE.InstancedMesh(houseGeo, houseMat, houses.length);
        const lit = houses.filter((h) => h.lit);
        windows = lit.length ? new THREE.InstancedMesh(windowGeo, windowMat, lit.length * 2) : null;
        let wi = 0;
        houses.forEach((h, i) => {
          e.set(0, h.rot, 0);
          q.setFromEuler(e);
          m4.compose(v.set(h.x, h.y, h.z), q, s.set(h.w, h.h, h.d));
          im.setMatrixAt(i, m4);
          im.setColorAt(i, c.setHex(h.col));
          if (h.lit && windows) {
            // Two windows on the long side facing +z (in the house's frame), just proud of the wall.
            for (const off of [-0.22, 0.22]) {
              const lx = off * h.w;
              const lz = h.d / 2 + 0.05;
              const cos = Math.cos(h.rot);
              const sin = Math.sin(h.rot);
              m4.compose(v.set(h.x + lx * cos + lz * sin, h.y + h.h * 0.38, h.z - lx * sin + lz * cos), q, s.set(1, 1, 1));
              windows.setMatrixAt(wi++, m4);
            }
          }
        });
        im.computeBoundingSphere();
        im.castShadow = false;
        im.receiveShadow = true;
        g.add(im);
        if (windows) {
          windows.computeBoundingSphere();
          g.add(windows);
        }
      }
      group.add(g);
      blocks.push({ g, x: (bx + BLOCK / 2) * cell, z: (by + BLOCK / 2) * cell, windows, lod });
    }
  }
  const reach = SHOW + (BLOCK * cell) / 2;
  const AUTUMN = [0xa8561e, 0xc88a1a, 0x8a2a1a, 0xb8741e];
  return {
    group,
    setSeason(season) {
      for (const f of forests) {
        f.base.forEach((col, i) => {
          const r = rnd(f.x[i] | 0, i, 0x5ea5);
          const deciduous = r < 0.45;
          let hex = col;
          if (season === 0) hex = deciduous ? (r < 0.07 ? 0xe8c0d0 : 0x5a7a34) : col;
          else if (season === 2) hex = deciduous ? AUTUMN[Math.floor(r * 97) % AUTUMN.length] : col;
          else if (season === 3) hex = deciduous ? 0x4a4038 : 0x22301e;
          f.im.setColorAt(i, c.setHex(hex));
        });
        if (f.im.instanceColor) f.im.instanceColor.needsUpdate = true;
      }
    },
    setSnow(amount) {
      snow.value = amount;
    },
    update(camera, lamps) {
      const far = reach + Math.max(0, camera.y) * 4;
      for (const b of blocks) {
        b.g.visible = Math.hypot(b.x - camera.x, b.z - camera.z) < far;
        if (b.windows) b.windows.visible = lamps > 0.3;
        if (b.lod && b.g.visible) {
          const dx = Math.max(b.lod.x0 - camera.x, 0, camera.x - b.lod.x1);
          const dz = Math.max(b.lod.z0 - camera.z, 0, camera.z - b.lod.z1);
          const near = Math.hypot(dx, dz) < BLOB_LOD;
          b.lod.hi.visible = near;
          b.lod.lo.visible = !near;
        }
      }
    },
  };
}
