import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash, rng, type Rng } from '../core/hash';

/**
 * 3D proof-of-concept scene: one residential-style street with six buildings, a few distant towers
 * for the skyline, and an optional procedural grid of extra buildings for scaling benchmarks.
 * Units are metres; +y up; the street runs along z.
 */

/** Collision footprint on the ground plane. */
export interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

interface BuildingSpec {
  /** Stable id: seeds the building's hue and which windows are lit, so it looks the same every visit. */
  id: number;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

const BAY = 1.5; // metres between window columns (tower curtain-wall module)
const FLOOR = 3; // metres per storey
/** Minimum on-screen pitch in character cells: columns need a 1-cell gap; rows may be adjacent. */
const MIN_PITCH_X = 2;
const MIN_PITCH_Y = 1;

/** Building hues (reference: warm yellow / teal / blue skylines). Picked per building by hashing its id. */
const HUES = [0xe6d34a, 0x3cc9a8, 0x4a9fe0, 0xe89a3c, 0x8fd14f, 0x58d6e8, 0xd9e070, 0xb48cff];
export const hueFor = (id: number): number => HUES[hash(id, 0x4e7) % HUES.length];

/**
 * Integer codes (stored as code / 255 in the scene target's alpha) telling the ASCII pass what a
 * building texel is.
 * - Windows are UNLIT or LIT plus a shape: POINT (single glyph), or, for windows big enough on screen,
 *   an outline made of H (top/bottom edge), V (side edge) and CORNER cells.
 * - Walls are WALL (near) or WALL_FAR (bays/floors merged by LOD) + round(light * WALL_STEPS): a smooth
 *   0-1 "wall light" the ASCII pass maps onto a density ramp.
 * - DETAIL_LIT: at distance, a wall cell inside a merged bay/floor standing in for one of the real windows
 *   the LOD merged away. Drawn as a small dim point: apparent detail, not per-window geometry.
 * - Anything that isn't a building writes 255 (opaque default).
 */
export const FACADE_CODE = {
  roof: 2, unlit: 10, lit: 20, point: 0, h: 1, v: 2, corner: 3,
  detailLit: 30, wall: 32, wallFar: 140, wallSteps: 100, other: 255,
} as const;

export interface FacadeUniforms {
  /** Fraction of windows lit: stand-in for the atmosphere table's per-(district, time) value. */
  uWindowLit: { value: number };
  /** 0: every window is a single glyph at any distance (default). 1: large windows become thin outlines. */
  uWindowOutline: { value: number };
}

/**
 * Building material: Lambert shading plus an explicit window grid computed in the fragment shader from
 * facade coordinates in metres, measured in character cells (the scene target has 2 texels per cell).
 * - Density: bays/floors merge in whole multiples only until the pitch reaches MIN_PITCH cells, so a
 *   facade at normal distance is packed with windows (every row, every other column).
 * - Size: a window is always a single glyph however close you get (optionally, uWindowOutline draws
 *   windows >= 3x2 cells on screen as a thin outline with an empty interior). Never a filled block.
 */
export function buildingMaterial(uniforms: FacadeUniforms): THREE.MeshLambertMaterial {
  const C = FACADE_CODE;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWindowLit = uniforms.uWindowLit;
    shader.uniforms.uWindowOutline = uniforms.uWindowOutline;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aBuilding;
        attribute vec3 aFacade;
        varying float vBid;
        varying vec3 vFacade;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBid = aBuilding;
        vFacade = aFacade;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWindowLit;
        uniform float uWindowOutline;
        varying float vBid;
        varying vec3 vFacade;`)
      .replace('#include <opaque_fragment>', `
        float facadeCode = ${C.other}.0;
        if (vBid > 0.5) {
          // Smooth wall light in 0-1, independent of the building's hue. Every term varies smoothly across
          // a face, so the density ramp shades it in gradients rather than noise:
          // - Lambert result / base colour: directional angle + sky/ground ambient + street-lamp falloff
          //   (with these lights: ~0.02 facing away from the moon, ~0.07 / ~0.14 on the two lit faces, 0.3+ by lamps);
          // - ambient occlusion toward the ground over the first 15 m;
          // - distance fade: near walls get denser, brighter glyphs; far ones thin out.
          vec3 luma = vec3(0.299, 0.587, 0.114);
          float shade = dot(outgoingLight, luma) / max(dot(vColor.rgb, luma), 1e-3);
          float wallLight = 1.0 - exp(-shade * 6.0);
          wallLight *= mix(0.55, 1.0, smoothstep(0.0, 15.0, vFacade.y));
          wallLight *= mix(1.0, 0.35, smoothstep(20.0, 450.0, length(vViewPosition)));
          if (vFacade.z > 1.5) {
            facadeCode = ${C.roof}.0;
          } else {
            vec2 m = vFacade.xy;
            // Character cells per metre along this face (the scene target has 2 texels per cell).
            vec2 cellsPerM = 1.0 / (2.0 * max(fwidth(m), vec2(1e-5)));
            vec2 base = vec2(${BAY.toFixed(2)}, ${FLOOR.toFixed(2)});
            // LOD: merge whole bays/floors only until the pitch reaches the minimum; whole multiples keep
            // the grid anchored to the building so it doesn't crawl as you walk.
            vec2 unit = base * max(vec2(1.0), ceil(vec2(${MIN_PITCH_X.toFixed(1)}, ${MIN_PITCH_Y.toFixed(1)}) / (base * cellsPerM)));
            vec2 cellsPerUnit = unit * cellsPerM;
            vec2 idx = floor(m / unit);
            vec2 pos = fract(m / unit) * cellsPerUnit; // position inside this bay/floor, in cells
            // Window footprint in whole cells; an integer span of k cells always holds exactly k cell
            // centres, so windows render as a consistent number of glyphs.
            vec2 full = floor(cellsPerUnit * vec2(0.5, 0.55));
            bool outline = uWindowOutline > 0.5 && full.x >= 3.0 && full.y >= 2.0;
            vec2 win = outline ? full : vec2(1.0);
            vec2 q = floor(pos - floor((cellsPerUnit - win) * 0.5)); // cell within the window
            // Merged = LOD has combined several real bays/floors into this unit (medium-far distance).
            bool merged = any(greaterThan(unit, base * 1.5));
            facadeCode = (merged ? ${C.wallFar}.0 : ${C.wall}.0) + floor(clamp(wallLight, 0.0, 1.0) * ${C.wallSteps}.0 + 0.5);
            if (merged) {
              // Suggest the windows the merge removed: each other cell in the unit gets a stable lit/unlit
              // hash of (building, unit, cell in unit), at the same lit fraction as real windows.
              vec2 sub = floor(pos);
              float hd = fract(sin(dot(vec3(vBid, idx.x * 17.0 + sub.x, idx.y * 17.0 + sub.y), vec3(39.346, 11.135, 83.155))) * 43758.5453);
              if (hd < uWindowLit) facadeCode = ${C.detailLit}.0;
            }
            if (all(greaterThanEqual(q, vec2(0.0))) && all(lessThan(q, win))) {
              float h = fract(sin(dot(vec3(vBid, idx), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
              float state = h < uWindowLit ? ${C.lit}.0 : ${C.unlit}.0;
              if (!outline) {
                facadeCode = state + ${C.point}.0;
              } else {
                bool ex = q.x == 0.0 || q.x == win.x - 1.0;
                bool ey = q.y == 0.0 || q.y == win.y - 1.0;
                if (ex && ey) facadeCode = state + ${C.corner}.0;
                else if (ey) facadeCode = state + ${C.h}.0;
                else if (ex) facadeCode = state + ${C.v}.0;
                // interior stays wall: outlines are never filled in
              }
            }
          }
          if (facadeCode >= ${C.lit}.0 && facadeCode < ${C.lit + 10}.0) outgoingLight = vColor.rgb * 1.5;
          else if (facadeCode == ${C.detailLit}.0) outgoingLight = vColor.rgb * 0.8;
          else if (facadeCode >= ${C.unlit}.0 && facadeCode < ${C.unlit + 10}.0) outgoingLight *= 0.3;
          else if (facadeCode >= ${C.wall}.0) outgoingLight *= 0.55;
        }
        #include <opaque_fragment>`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.a = facadeCode / 255.0;`);
  };
  return m;
}

/**
 * One building as a box. Per-vertex attributes carry what the shader needs, so any number of buildings
 * can be merged into one draw call: aBuilding (id), aFacade (u, v in metres along the face; z = 1 wall,
 * 2 roof), and colour (the building's hue).
 */
function buildingGeometry(b: BuildingSpec, rnd: Rng): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.w, b.h, b.d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = uv.count;
  const facade = new Float32Array(n * 3);
  const ids = new Float32Array(n).fill(b.id);
  const offU = rnd.int(0, 3) * 0.5; // shift the column grid so neighbours don't line up exactly
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z; 4 vertices each.
  for (let i = 0; i < n; i++) {
    const face = Math.floor(i / 4);
    const roof = face === 2 || face === 3;
    const span = face < 2 ? b.d : b.w;
    facade[i * 3] = roof ? 0 : offU + uv.getX(i) * span;
    facade[i * 3 + 1] = roof ? 0 : uv.getY(i) * b.h;
    facade[i * 3 + 2] = roof ? 2 : 1;
  }
  const hue = new THREE.Color(hueFor(b.id));
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) hue.toArray(colors, i * 3);
  g.setAttribute('aFacade', new THREE.BufferAttribute(facade, 3));
  g.setAttribute('aBuilding', new THREE.BufferAttribute(ids, 1));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.translate(b.x, b.h / 2, b.z);
  return g;
}

const footprint = (b: BuildingSpec): Box => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });

/** The hand-made test street. Returns collision boxes. */
export function buildTestBlock(scene: THREE.Scene, material: THREE.Material): Box[] {
  const rnd = rng(11);
  const boxes: Box[] = [];

  // Ground, road, sidewalks, lane dashes.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x1e2226 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 400), new THREE.MeshLambertMaterial({ color: 0x2b2e34 }));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  scene.add(road);
  const walkMat = new THREE.MeshLambertMaterial({ color: 0x5a5d64 });
  for (const x of [-6.5, 6.5]) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 400), walkMat);
    walk.position.set(x, 0.075, 0);
    scene.add(walk);
  }
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xb8b070 });
  for (let z = -198; z < 200; z += 6) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.02, z);
    scene.add(dash);
  }

  // Six buildings of varying height either side of the street (residential district palette).
  const specs: BuildingSpec[] = [
    { id: 1, x: -15, z: -30, w: 12, d: 14, h: 7 },
    { id: 2, x: -14, z: -11, w: 10, d: 16, h: 10 },
    { id: 3, x: -16, z: 12, w: 14, d: 20, h: 22 },
    { id: 4, x: 16, z: -26, w: 14, d: 18, h: 35 },
    { id: 5, x: 15, z: -2, w: 12, d: 14, h: 14 },
    { id: 6, x: 14, z: 18, w: 10, d: 12, h: 6 },
  ];
  for (const s of specs) {
    scene.add(new THREE.Mesh(buildingGeometry(s, rnd), material));
    boxes.push(footprint(s));
  }

  // Distant towers: the skyline the tower district should read as from across the city.
  const towers: BuildingSpec[] = [
    { id: 7, x: -60, z: -320, w: 30, d: 30, h: 150 },
    { id: 8, x: 10, z: -380, w: 36, d: 36, h: 210 },
    { id: 9, x: 80, z: -300, w: 26, d: 26, h: 120 },
    { id: 10, x: 140, z: -420, w: 32, d: 32, h: 170 },
  ];
  for (const s of towers) scene.add(new THREE.Mesh(buildingGeometry(s, rnd), material));

  // Street lamps (a few real point lights) and a payphone booth.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3d44 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
  for (const [x, z] of [[-5.4, -32], [5.4, -14], [-5.4, 4], [5.4, 22]] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 8), poleMat);
    pole.position.set(x, 2.5, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), lampMat);
    head.position.set(x, 5.1, z);
    const light = new THREE.PointLight(0xffd9a0, 40, 22, 1.6);
    light.position.set(x, 4.9, z);
    scene.add(pole, head, light);
    boxes.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2 });
  }
  const booth = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 1), new THREE.MeshLambertMaterial({ color: 0x3c8a5a, emissive: 0x0c2a18 }));
  booth.position.set(6.8, 1.1, 8);
  const boothSign = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.25, 1.05), new THREE.MeshBasicMaterial({ color: 0x6bff8a }));
  boothSign.position.set(6.8, 2.3, 8);
  scene.add(booth, boothSign);
  boxes.push({ minX: 6.3, maxX: 7.3, minZ: 7.5, maxZ: 8.5 });

  return boxes;
}

/**
 * Scaling test: `count` extra buildings on a block grid around the test street.
 * merged=false: one mesh (draw call) per building, the naive approach.
 * merged=true: buildings merged per 200 m chunk (one draw call per chunk, still frustum-culled per chunk).
 */
export function buildGrid(scene: THREE.Scene, material: THREE.Material, count: number, merged: boolean): number {
  const rnd = rng(23);
  const specs: BuildingSpec[] = [];
  const blocksPerSide = Math.ceil(Math.sqrt(count / 4)) + 2;
  const spacing = 40;
  outer: for (let gz = -blocksPerSide; gz <= blocksPerSide; gz++) {
    for (let gx = -blocksPerSide; gx <= blocksPerSide; gx++) {
      const cx = gx * spacing;
      const cz = gz * spacing;
      if (Math.abs(cx) < 40 && Math.abs(cz) < 80) continue; // keep the test street clear
      for (const [ox, oz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
        if (specs.length >= count) break outer;
        const tall = rnd.chance(0.08);
        specs.push({
          id: 1000 + specs.length, x: cx + ox, z: cz + oz, w: rnd.int(9, 14), d: rnd.int(9, 14),
          h: tall ? rnd.int(40, 140) : rnd.int(6, 28),
        });
      }
    }
  }
  if (!merged) {
    for (const s of specs) scene.add(new THREE.Mesh(buildingGeometry(s, rnd), material));
    return specs.length;
  }
  const chunks = new Map<string, THREE.BufferGeometry[]>();
  for (const s of specs) {
    const k = `${Math.floor(s.x / 200)},${Math.floor(s.z / 200)}`;
    chunks.set(k, [...(chunks.get(k) ?? []), buildingGeometry(s, rnd)]);
  }
  for (const geoms of chunks.values()) {
    const m = mergeGeometries(geoms);
    m.computeBoundingSphere();
    scene.add(new THREE.Mesh(m, material));
  }
  return specs.length;
}
