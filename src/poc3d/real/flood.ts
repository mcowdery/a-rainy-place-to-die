import * as THREE from 'three';
import type { MacroMap } from '../../gen/macro';
import type { Terrain } from '../district/terrain';
import type { CityUniforms } from './city';
import { waterSurface } from './sea';

/**
 * Flooding (Manila's monsoon: the forecast's `Outlook.flood`, 0-1). One mesh over the built cells, a grid of 32 m,
 * murky rippling water (the sea's shader family, `waterSurface`, so the sun, the sky and the reflection pass treat
 * it as water) whose height is worked out per vertex: `FloodField.low` says how low-lying a spot is (beside the
 * river and the bay, on flat ground), and the water stands `MAX_DEPTH * flood * low` above the street there, so
 * the low streets flood first and deepest and higher ground stays drier. Where the surface is under the ground
 * (higher ground, a pavement the water hasn't reached) the depth test hides it; fragments under 2.5 cm are dropped
 * so the edge is a clean line. The same field gives the car and the traffic the depth under a wheel.
 */

/** The water over the street at the lowest spot with flood 1 (m; kerbs are 0.15). */
export const MAX_DEPTH = 0.36;
/** Under this a flood isn't shown at all. */
export const FLOOD_MIN = 0.05;
/** The grid's step (m). */
const STEP = 32;

const hash2 = (x: number, y: number): number => {
  let h = (Math.imul(x, 0x1f1f1f1f) ^ Math.imul(y, 0x27d4eb2d) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How low-lying the ground is, 0-1, on a grid; its depth at any point by bilinear lookup. Pure. */
export class FloodField {
  readonly nx: number;
  readonly nz: number;
  readonly low: Float32Array;
  constructor(
    readonly macro: MacroMap,
    readonly cell: number,
    terrain: Terrain,
  ) {
    const per = Math.round(cell / STEP);
    this.nx = macro.cols * per + 1;
    this.nz = macro.rows * per + 1;
    this.low = new Float32Array(this.nx * this.nz);
    const R = 6;
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = i * STEP;
        const z = j * STEP;
        // The distance (cells) to the nearest water cell.
        let d = R;
        const cx = Math.floor(x / cell);
        const cy = Math.floor(z / cell);
        for (let my = cy - R; my <= cy + R; my++) {
          for (let mx = cx - R; mx <= cx + R; mx++) {
            if (macro.kindAt(mx, my) !== 'water') continue;
            const dx = Math.max(mx * cell - x, 0, x - (mx + 1) * cell) / cell;
            const dz = Math.max(my * cell - z, 0, z - (my + 1) * cell) / cell;
            d = Math.min(d, Math.hypot(dx, dz));
          }
        }
        let low = 0.4 + 0.6 * (1 - smooth(0.8, 5, d));
        low *= 1 - smooth(0.3, 2.5, terrain.height(x, z));
        // Some streets lie lower than others.
        low *= 0.78 + 0.22 * hash2(i, j);
        this.low[j * this.nx + i] = low;
      }
    }
  }

  /** The lowness (0-1) at (x, z). */
  lowAt(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1.001, x / STEP));
    const fz = Math.max(0, Math.min(this.nz - 1.001, z / STEP));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const L = this.low;
    const a = L[j * this.nx + i];
    const b = L[j * this.nx + i + 1];
    const c = L[(j + 1) * this.nx + i];
    const d = L[(j + 1) * this.nx + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  /** The water's depth over the street at (x, z) (m) with this flood (0-1). */
  depthAt(x: number, z: number, flood: number): number {
    return flood < FLOOD_MIN ? 0 : MAX_DEPTH * flood * this.lowAt(x, z);
  }
}

export interface Flood {
  readonly group: THREE.Group;
  readonly field: FloodField;
  /** The flood now (0-1). Hidden under FLOOD_MIN. */
  set(flood: number): void;
}

export function buildFlood(macro: MacroMap, cell: number, terrain: Terrain, built: (mx: number, my: number) => boolean, sky: CityUniforms): Flood {
  const field = new FloodField(macro, cell, terrain);
  const { nx, nz } = field;
  const pos = new Float32Array(nx * nz * 3);
  const low = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos.set([i * STEP, terrain.height(i * STEP, j * STEP) + 0.01, j * STEP], k * 3);
      low[k] = field.low[k];
    }
  }
  const per = Math.round(cell / STEP);
  const idx: number[] = [];
  for (let my = 0; my < macro.rows; my++) {
    for (let mx = 0; mx < macro.cols; mx++) {
      if (!built(mx, my)) continue;
      for (let b = 0; b < per; b++) {
        for (let a = 0; a < per; a++) {
          const i = mx * per + a;
          const j = my * per + b;
          const p = j * nx + i;
          idx.push(p, p + nx, p + nx + 1, p, p + nx + 1, p + 1);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aLow', new THREE.BufferAttribute(low, 1));
  geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from({ length: nx * nz * 3 }, (_, n) => (n % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const uFlood = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ color: 0x6e5c42, roughness: 0.3, metalness: 0.12, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  waterSurface(material, sky);
  const water = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    water(shader, renderer);
    shader.uniforms.uFlood = uFlood;
    shader.uniforms.tLight = sky.tLight;
    shader.uniforms.uLightRect = sky.uLightRect;
    shader.uniforms.uLightFade = sky.uLightFade;
    shader.uniforms.uLightGain = sky.uLightGain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aLow;
        uniform float uFlood;
        varying float vDepth;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDepth = ${MAX_DEPTH.toFixed(3)} * uFlood * aLow;
        transformed.y += vDepth;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vDepth;
        uniform sampler2D tLight;
        uniform vec4 uLightRect;
        uniform vec2 uLightFade;
        uniform float uLightGain;`)
      .replace('void main() {', `void main() {
        if (vDepth < 0.025) discard;`)
      .replace('gl_FragColor.a =', `{
          // The street's lamps and signs on the water (the lightmap, as on the wet street), murky brown.
          vec3 fL = texture2D(tLight, (vSeaWorld.xz - uLightRect.xy) * uLightRect.zw).rgb * uLightGain;
          if (uLightFade.y > 0.0) {
            vec2 dc = abs(vSeaWorld.xz - cameraPosition.xz);
            fL *= 1.0 - smoothstep(uLightFade.x, uLightFade.y, max(dc.x, dc.y));
          }
          gl_FragColor.rgb += fL * vec3(0.30, 0.24, 0.17) * (1.0 - seaF * 0.6);
        }
        gl_FragColor.a =`);
  };
  material.customProgramCacheKey = () => 'water-flood';
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);
  group.visible = false;
  return {
    group,
    field,
    set(flood) {
      uFlood.value = flood;
      group.visible = flood >= FLOOD_MIN;
    },
  };
}
