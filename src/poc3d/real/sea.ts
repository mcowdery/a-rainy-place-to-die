import * as THREE from 'three';
import type { MacroMap } from '../../gen/macro';
import type { Bridge3 } from '../district/roads';
import type { Terrain } from '../district/terrain';
import { poolTexture } from './expressway';
import { WATER_ALPHA, WATER_GLSL } from './waterGlsl';

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
  /** Snow lying on the land round the city (0-1, as the city's uSnow). */
  setSnow(amount: number): void;
  /** The street lamps (0-1, as the city's uLamps): the bridges' lamps and their light on the deck. */
  setLamps(on: number): void;
}

/** What the water's shader takes from the city's (real/city.ts' uniforms): the sky's colours, the clock, the wind. */
export interface WaterSky {
  readonly uHorizon: { value: THREE.Color };
  readonly uZenith: { value: THREE.Color };
  readonly uTime: { value: number };
  readonly uWind: { value: THREE.Vector3 };
}

/**
 * The water's surface (waterGlsl.ts): rippled by the wind, so the sun and moon glitter on it; the sky in the
 * ripples by Fresnel (what stands by the water is put in them by the reflection pass, ssr.ts, which finds water
 * by the alpha written here); and all the sky's horizon colour between these distances from the camera (m), so
 * the open sea meets the sky's horizon without a seam.
 */
function waterSurface(m: THREE.Material, sky: WaterSky, from = 700, to = 1120): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHorizon = sky.uHorizon;
    shader.uniforms.uZenith = sky.uZenith;
    shader.uniforms.uTime = sky.uTime;
    shader.uniforms.uWind = sky.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSeaWorld;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSeaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSeaWorld;
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform float uTime;
        uniform vec3 uWind;
        ${WATER_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 seaN = waterNormal(waterSlope(vSeaWorld.xz, uTime, uWind, waterFoot(vSeaWorld, cameraPosition)));
        normal = normalize((viewMatrix * vec4(seaN, 0.0)).xyz);`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>
        // The sky in the ripples: more the lower you look across them (Fresnel), and all the horizon's colour at
        // the edge of the view, where the water meets the sky.
        vec3 toSea = normalize(vSeaWorld - cameraPosition);
        float seaF = waterFresnel(clamp(-dot(toSea, seaN), 0.0, 1.0));
        gl_FragColor.rgb = gl_FragColor.rgb * (1.0 - seaF) + waterSky(reflect(toSea, seaN), uHorizon, uZenith) * seaF;
        float edge = smoothstep(${from.toFixed(1)}, ${to.toFixed(1)}, distance(vSeaWorld.xz, cameraPosition.xz));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizon, edge);
        gl_FragColor.a = ${WATER_ALPHA.toFixed(1)};`);
  };
  m.customProgramCacheKey = () => `water-${from}-${to}`;
}

export function buildSea(macro: MacroMap, cell: number, built: (mx: number, my: number) => boolean, sky: WaterSky, bridges: readonly Bridge3[] = [], terrain?: Terrain): Sea {
  const group = new THREE.Group();
  // (Rough enough that the sun's glitter on a ripple doesn't overflow the scene's half floats.)
  const material = new THREE.MeshStandardMaterial({ color: 0x0c1c26, roughness: 0.24, metalness: 0.35 });
  waterSurface(material, sky);
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
  // With hills round the city, the river runs on north past the map between them.
  const hills = terrain?.hills;
  const kindOut = (mx: number, my: number) => macro.kindAt(Math.max(0, Math.min(macro.cols - 1, mx)), Math.max(0, Math.min(macro.rows - 1, my)));
  if (hills) for (let my = -hills.pad; my < 0; my++) for (let mx = 0; mx < macro.cols; mx++) if (kindOut(mx, my) === 'water') quad(mx * cell, my * cell, (mx + 1) * cell, (my + 1) * cell);
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
  const onTerrain = (mx: number, my: number): void => {
    const [x0, z0, x1, z1] = [mx * cell, my * cell, (mx + 1) * cell, (my + 1) * cell];
    const h = (gx: number, gy: number): number => terrain!.junction(gx, gy) - 0.03;
    land.push(x0, h(mx, my), z0, x0, h(mx, my + 1), z1, x1, h(mx + 1, my + 1), z1, x0, h(mx, my), z0, x1, h(mx + 1, my + 1), z1, x1, h(mx + 1, my), z0);
  };
  if (hills) {
    // The hills: every unbuilt cell on the terrain, in the map and on past it, then level ground at the hills' top
    // out to the horizon (the mountains beyond are in the sky, real/sky.ts).
    const pad = hills.pad;
    for (let my = -pad; my < macro.rows + pad; my++) {
      for (let mx = -pad; mx < macro.cols + pad; mx++) {
        const inMap = mx >= 0 && my >= 0 && mx < macro.cols && my < macro.rows;
        if (inMap ? !unbuilt(mx, my) : kindOut(mx, my) === 'water' || my >= macro.rows) continue;
        onTerrain(mx, my);
      }
    }
    const top = hills.max - 0.03;
    const at = (x0: number, z0: number, x1: number, z1: number): void => void land.push(x0, top, z0, x0, top, z1, x1, top, z1, x0, top, z0, x1, top, z1, x1, top, z0);
    at(-BEYOND, -BEYOND, W + BEYOND, -pad * cell);
    for (let my = -pad; my < macro.rows; my++) {
      if (kindOut(-1, my) !== 'water') at(-BEYOND, my * cell, -pad * cell, (my + 1) * cell);
      if (kindOut(macro.cols, my) !== 'water') at(W + pad * cell, my * cell, W + BEYOND, (my + 1) * cell);
    }
  } else for (let my = 0; my < macro.rows; my++) {
    for (let mx = 0; mx < macro.cols; ) {
      if (!unbuilt(mx, my)) {
        mx++;
        continue;
      }
      // Next to the hills: a cell of its own, its corners at the terrain's heights.
      if (terrain && terrain.raised(mx, my)) {
        const [x0, z0, x1, z1] = [mx * cell, my * cell, (mx + 1) * cell, (my + 1) * cell];
        const h = (gx: number, gy: number): number => terrain.junction(gx, gy) - 0.03;
        land.push(x0, h(mx, my), z0, x0, h(mx, my + 1), z1, x1, h(mx + 1, my + 1), z1, x0, h(mx, my), z0, x1, h(mx + 1, my + 1), z1, x1, h(mx + 1, my), z0);
        mx++;
        continue;
      }
      const start = mx;
      while (mx < macro.cols && unbuilt(mx, my) && !terrain?.raised(mx, my)) mx++;
      flat(start === 0 ? -BEYOND : start * cell, my * cell, mx === macro.cols ? W + BEYOND : mx * cell, (my + 1) * cell);
    }
  }
  if (!hills) flat(-BEYOND, -BEYOND, W + BEYOND, 0);
  const landGeo = new THREE.BufferGeometry();
  landGeo.setAttribute('position', new THREE.Float32BufferAttribute(land, 3));
  landGeo.computeVertexNormals();
  // (Land stays dark against the sky, like distant hills.)
  const landMat = new THREE.MeshStandardMaterial({ color: 0x2e3228, roughness: 1 });
  const ground = new THREE.Mesh(landGeo, landMat);
  ground.receiveShadow = true;
  ground.frustumCulled = false;
  group.add(ground);
  // The bridges' decks take snow on what faces up, as the city's streets do. They're outside the lightmap, so
  // their lamps light the deck with pools of light (additive decals, as the expressway's), on with the lamps.
  const deckSnow = { value: 0 };
  const heads = new THREE.MeshStandardMaterial({ color: 0xffe2b0, roughness: 0.85, emissive: 0xffe2b0, emissiveIntensity: 1.4 });
  const pools: [number, number][] = [];
  for (const b of bridges) group.add(bridgeDeck(b, deckSnow, heads, pools));
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), color: new THREE.Color(0.24, 0.19, 0.12), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const lit = new THREE.InstancedMesh(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2), poolMat, pools.length);
  const m4 = new THREE.Matrix4();
  pools.forEach(([x, z], i) => lit.setMatrixAt(i, m4.makeTranslation(x, 0.03, z)));
  lit.frustumCulled = false;
  group.add(lit);
  let lamps = -1;
  const bare = new THREE.Color(0x2e3228);
  const white = new THREE.Color(0xa4a8b0);
  let snow = -1;
  return {
    group,
    material,
    setSnow(amount) {
      if (Math.abs(amount - snow) < 0.01) return;
      snow = amount;
      landMat.color.copy(bare).lerp(white, amount);
      deckSnow.value = amount;
    },
    setLamps(on) {
      if (Math.abs(on - lamps) < 0.01) return;
      lamps = on;
      heads.emissiveIntensity = 0.05 + 1.35 * on;
      poolMat.opacity = on;
      lit.visible = pools.length > 0 && on > 0.05;
    },
  };
}

/**
 * A street bridge's deck (roads.ts Bridge3): the carriageway at street level on a deep girder, raised pavements
 * either side, a planted median if it has one, lane paint, parapets with a rail, and lamps along the pavements.
 */
/** Snow on what faces up (a deck's carriageway, pavements, parapet tops), the amount shared. */
function snowy(m: THREE.MeshStandardMaterial, snow: { value: number }, keep: number): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = snow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uSnow > 0.0) {
          float upF = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.64, 0.68), smoothstep(0.55, 0.9, upF) * uSnow * ${keep.toFixed(2)});
        }`);
  };
}

function bridgeDeck(b: Bridge3, snow: { value: number }, heads: THREE.MeshStandardMaterial, pools: [number, number][]): THREE.Group {
  const g = new THREE.Group();
  const r = b.road;
  const q = r.rect;
  const v = r.vertical;
  const W = v ? q.w : q.h;
  const L = v ? q.h : q.w;
  const world = (a: number, c: number): [number, number] => (v ? [q.x + W / 2 + c, q.y + a] : [q.x + a, q.y + W / 2 + c]);
  // Local frame: along (a, 0..L) and across (c, -W/2..W/2) to world boxes. A lamp head takes the shared material.
  const box = (a0: number, a1: number, c0: number, c1: number, y0: number, y1: number, color: number, head = false): void => {
    const [cx, cz] = world((a0 + a1) / 2, (c0 + c1) / 2);
    const sx = v ? c1 - c0 : a1 - a0;
    const sz = v ? a1 - a0 : c1 - c0;
    const mat = head ? heads : new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    // (The carriageway keeps a little less, as the streets do: city.ts.)
    if (!head) snowy(mat, snow, color === 0x26262a ? 0.8 : 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, y1 - y0, sz), mat);
    m.position.set(cx, (y0 + y1) / 2, cz);
    m.receiveShadow = true;
    g.add(m);
  };
  const sw = r.sidewalk;
  box(0, L, -W / 2, W / 2, -2.4, -0.02, 0x2a2c2e);
  box(0, L, -W / 2 + sw, W / 2 - sw, -0.1, 0.0, 0x26262a);
  box(0, L, -W / 2, -W / 2 + sw, -0.1, 0.15, 0x8a8a86);
  box(0, L, W / 2 - sw, W / 2, -0.1, 0.15, 0x8a8a86);
  if (r.median) box(0, L, -r.median / 2, r.median / 2, -0.1, 0.2, 0x4a5a3a);
  // Lane paint: a dashed line down each carriageway, the edge lines.
  const half = r.median ? r.median / 2 : 0;
  const lane = half + (W / 2 - sw - half) / 2;
  for (let a = 2; a < L - 2; a += 10) for (const c of r.median ? [-lane, lane] : [0]) box(a, a + 5, c - 0.08, c + 0.08, 0.0, 0.012, 0xd8d8d0);
  for (const c of [-W / 2 + sw + 0.5, W / 2 - sw - 0.5]) box(0, L, c - 0.08, c + 0.08, 0.0, 0.012, 0xd8d8d0);
  // Parapets and their rail.
  for (const s of [-1, 1]) {
    const c = s * (W / 2 - 0.2);
    box(0, L, c - 0.2, c + 0.2, 0.15, 0.95, 0x9a9a96);
    box(0, L, c - 0.06, c + 0.06, 0.95, 1.25, 0x6a6e72);
  }
  // Lamps along the pavements, their heads glowing at night.
  for (let a = 8; a < L - 4; a += 24) {
    for (const s of [-1, 1]) {
      const c = s * (W / 2 - sw + 0.5);
      box(a - 0.1, a + 0.1, c - 0.1, c + 0.1, 0.15, 8, 0x5a5e62);
      box(a - 0.4, a + 0.4, c - 0.25, c + 0.25, 7.8, 8.05, 0xffe2b0, true);
      // The pool centred a little out over the carriageway, under the head's reach.
      pools.push(world(a, s * (W / 2 - sw - 2.5)));
    }
  }
  return g;
}
