import * as THREE from 'three';
import type { MacroMap } from '../../gen/macro';

/**
 * The sea and the land round the city. Water over every L0 water cell (the bay, the river down to it), a little
 * below the streets, and on past the map's edge to the horizon where the bay opens; a concrete seawall wherever
 * built land meets the water (the quays, the river's embankments). Plain ground over the land that isn't built
 * yet (the districts to come, the hills outside the city) and on to the horizon, so the world has no holes.
 * The water fades into the sky's horizon colour with distance, so the open sea meets the sky cleanly.
 * Water and unbuilt cells are outside the district, so nothing walks or drives onto them.
 */

export const SEA_LEVEL = -1.6;
/** How far the open sea runs on past the map (m): out to the fog. */
const BEYOND = 12000;

export interface Sea {
  readonly group: THREE.Group;
  readonly material: THREE.MeshStandardMaterial;
}

/**
 * Water reflecting the sky's horizon colour, more the lower you look across it, and fully between these
 * distances from the camera (m), so the open sea meets the sky's horizon without a seam.
 */
function horizonFade(m: THREE.Material, horizon: { value: THREE.Color }, from = 700, to = 1120): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHorizon = horizon;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSeaWorld;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSeaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSeaWorld;
        uniform vec3 uHorizon;`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>
        // The sky's horizon in the water: more the lower you look across it (Fresnel), and all of it at the
        // edge of the view, where it meets the sky.
        vec3 toSea = normalize(vSeaWorld - cameraPosition);
        float grazing = pow(1.0 - clamp(abs(toSea.y), 0.0, 1.0), 4.0) * 0.85;
        float edge = smoothstep(${from.toFixed(1)}, ${to.toFixed(1)}, distance(vSeaWorld.xz, cameraPosition.xz));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizon, max(grazing, edge));`);
  };
  m.customProgramCacheKey = () => `horizon-${from}-${to}`;
}

export function buildSea(macro: MacroMap, cell: number, built: (mx: number, my: number) => boolean, horizon: { value: THREE.Color }): Sea {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x0c1c26, roughness: 0.12, metalness: 0.35 });
  horizonFade(material, horizon);
  const pos: number[] = [];
  const quad = (x0: number, z0: number, x1: number, z1: number): void => {
    pos.push(x0, SEA_LEVEL, z0, x0, SEA_LEVEL, z1, x1, SEA_LEVEL, z1, x0, SEA_LEVEL, z0, x1, SEA_LEVEL, z1, x1, SEA_LEVEL, z0);
  };
  const water = (mx: number, my: number): boolean => macro.kindAt(mx, my) === 'water';
  // The map's water cells, a row's runs merged into strips.
  for (let my = 0; my < macro.rows; my++) {
    for (let mx = 0; mx < macro.cols; ) {
      if (!water(mx, my)) {
        mx++;
        continue;
      }
      const start = mx;
      while (mx < macro.cols && water(mx, my)) mx++;
      // A run that reaches the map's side carries on to the horizon.
      const x0 = start === 0 ? -BEYOND : start * cell;
      const x1 = mx === macro.cols ? macro.cols * cell + BEYOND : mx * cell;
      quad(x0, my * cell, x1, (my + 1) * cell);
    }
  }
  // Past the map's bottom edge (the bay opens to the sea there): open water to the horizon.
  const W = macro.cols * cell;
  const H = macro.rows * cell;
  if (Array.from({ length: macro.cols }, (_, mx) => water(mx, macro.rows - 1)).some(Boolean)) quad(-BEYOND, H, W + BEYOND, H + BEYOND);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const sea = new THREE.Mesh(geo, material);
  sea.receiveShadow = true;
  sea.frustumCulled = false;
  group.add(sea);

  // Seawalls: a concrete face down from the street to below the water, on every side of built land that meets
  // a water cell, with a darker tide line.
  const wall: number[] = [];
  const tide: number[] = [];
  const face = (out: number[], ax: number, az: number, bx: number, bz: number, y0: number, y1: number): void => {
    out.push(ax, y1, az, ax, y0, az, bx, y0, bz, ax, y1, az, bx, y0, bz, bx, y1, bz);
  };
  for (let my = 0; my < macro.rows; my++) {
    for (let mx = 0; mx < macro.cols; mx++) {
      if (!water(mx, my)) continue;
      const x0 = mx * cell;
      const z0 = my * cell;
      const x1 = x0 + cell;
      const z1 = z0 + cell;
      // Each side facing built land: the face looks out over the water (wound to face the water cell).
      const sides: [boolean, number, number, number, number][] = [
        [built(mx, my - 1), x1, z0, x0, z0],
        [built(mx, my + 1), x0, z1, x1, z1],
        [built(mx - 1, my), x0, z0, x0, z1],
        [built(mx + 1, my), x1, z1, x1, z0],
      ];
      for (const [b, ax, az, bx, bz] of sides) {
        if (!b) continue;
        face(wall, ax, az, bx, bz, SEA_LEVEL - 2, 0);
        face(tide, ax, az, bx, bz, SEA_LEVEL - 0.05, SEA_LEVEL + 0.45);
      }
    }
  }
  const mesh = (arr: number[], color: number, offset: number): THREE.Mesh => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.9, polygonOffset: offset !== 0, polygonOffsetFactor: offset, polygonOffsetUnits: offset }));
    m.receiveShadow = true;
    return m;
  };
  if (wall.length) group.add(mesh(wall, 0x8a8a84, 0), mesh(tide, 0x3a3e38, -1));

  // Plain ground on the land not built yet, and on past the map's land sides to the horizon.
  const land: number[] = [];
  const flat = (x0: number, z0: number, x1: number, z1: number): void => {
    land.push(x0, -0.03, z0, x0, -0.03, z1, x1, -0.03, z1, x0, -0.03, z0, x1, -0.03, z1, x1, -0.03, z0);
  };
  const unbuilt = (mx: number, my: number): boolean => !water(mx, my) && !built(mx, my);
  for (let my = 0; my < macro.rows; my++) {
    for (let mx = 0; mx < macro.cols; ) {
      if (!unbuilt(mx, my)) {
        mx++;
        continue;
      }
      const start = mx;
      while (mx < macro.cols && unbuilt(mx, my)) mx++;
      flat(start === 0 ? -BEYOND : start * cell, my * cell, mx === macro.cols ? W + BEYOND : mx * cell, (my + 1) * cell);
    }
  }
  flat(-BEYOND, -BEYOND, W + BEYOND, 0);
  const landGeo = new THREE.BufferGeometry();
  landGeo.setAttribute('position', new THREE.Float32BufferAttribute(land, 3));
  landGeo.computeVertexNormals();
  // (Land stays dark against the sky, like distant hills.)
  const landMat = new THREE.MeshStandardMaterial({ color: 0x2e3228, roughness: 1 });
  const ground = new THREE.Mesh(landGeo, landMat);
  ground.receiveShadow = true;
  ground.frustumCulled = false;
  group.add(ground);
  return { group, material };
}
