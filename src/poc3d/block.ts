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

const FLOOR = 3; // metres per storey (pane rows + slab row)
/** Minimum on-screen size of a bay/floor in cells, so pane + mullion (or pane + slab) always both fit. */
const MIN_PITCH = 2;
/** Height of the street-level storefront band (signs, shop frames, glass). */
const SHOP_H = 5.5;
/** Shop frontage width in metres. */
const SHOP_W = 4.5;

/** Building hues (reference: warm yellow / teal / blue / orange skylines). Picked per building by hashing its id. */
const HUES = [0xe6d34a, 0x3cc9a8, 0x4a9fe0, 0xe89a3c, 0x8fd14f, 0x58d6e8, 0xd9e070, 0xb48cff];
export const hueFor = (id: number): number => HUES[hash(id, 0x4e7) % HUES.length];

/** Facade surface types. Panes are the windows (most of the face); mullions and slabs frame them. */
export const SURFACE = { mullion: 0, slab: 1, pane: 2, paneLit: 3 } as const;

/** Storefront sign letters (see FACADE.shop). */
export const SIGN_LETTERS = 'ABCDEFGHIKLMNOPRSTUY';

/**
 * Integer code (stored as code / 255 in the scene target's alpha) for each building texel:
 * - facade: BASE + ((surface * VARIANTS + variant) * LEVELS + level)
 *   level: smooth 0-11 intensity (light, street glow, distance); variant: 0-2 ramp offset by floor band.
 * - storefront band: SHOP + 0 frame, + 1 glass, + 2.. sign letter index into SIGN_LETTERS.
 * Roofs write ROOF; anything that isn't a building writes OTHER (opaque default).
 */
export const FACADE = { roof: 2, base: 32, levels: 12, variants: 3, shop: 212, other: 255 } as const;

export interface FacadeUniforms {
  /** Fraction of windows lit: stand-in for the atmosphere table's per-(district, time) value. */
  uWindowLit: { value: number };
}

/**
 * Building material: Lambert shading plus, in the fragment shader, a dense facade pattern in the style
 * of image-to-ASCII conversion (after GrowNow's ASCII city):
 * - Each building has its own style from a hash of its id: bay width, gap (mullion) ratio, glyph
 *   family (lighter / normal / heavier) and whether it has floor-slab rows.
 * - Every facade texel is a pane, mullion or slab on a grid in metres, sized in character cells with
 *   whole-multiple LOD merging at distance so it never aliases.
 * - One smooth intensity picks the glyph from that surface's ramp: light angle, a glow from the street
 *   (denser low down, thinning with height) and distance fade. Variety comes per floor band and
 *   occasional odd windows, never per pixel.
 * - The bottom SHOP_H metres are a storefront band: a row of sign letters, shop frames and glass.
 */
export function buildingMaterial(uniforms: FacadeUniforms): THREE.MeshLambertMaterial {
  const F = FACADE;
  const S = SURFACE;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWindowLit = uniforms.uWindowLit;
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
        varying float vBid;
        varying vec3 vFacade;
        float h1(float a) { return fract(sin(a * 91.345) * 47453.5453); }
        float h3(vec3 v) { return fract(sin(dot(v, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <opaque_fragment>', `
        float facadeCode = ${F.other}.0;
        if (vBid > 0.5) {
          // Per-building style.
          float bay = mix(2.4, 4.6, h1(vBid));                       // metres per window column
          float mullionFrac = mix(0.18, 0.42, h1(vBid + 17.0));      // share of each bay left as a gap
          float family = floor(h1(vBid + 31.0) * 3.0) - 1.0;         // -1 lighter, 0, +1 heavier glyphs
          bool slabRows = h1(vBid + 47.0) > 0.3;
          float slabEvery = 2.0 + floor(h1(vBid + 59.0) * 4.0);     // floor-slab row every 2-5 floors

          // Smooth intensity 0-1, independent of the building's hue.
          vec3 luma = vec3(0.299, 0.587, 0.114);
          float shade = dot(outgoingLight, luma) / max(dot(vColor.rgb, luma), 1e-3);
          float lightTerm = 1.0 - exp(-shade * 6.0);
          float streetGlow = mix(1.0, 0.45, smoothstep(0.0, 140.0, vFacade.y)); // dense low, sparse high
          float fade = mix(1.0, 0.15, smoothstep(15.0, 500.0, length(vViewPosition)));
          float intensity = clamp((0.3 + 0.55 * lightTerm) * streetGlow * fade + family * 0.09, 0.0, 1.0);

          if (vFacade.z > 1.5) {
            facadeCode = ${F.roof}.0;
          } else {
            vec2 m = vFacade.xy;
            // Character cells per metre along this face (the scene target has 2 texels per cell).
            vec2 cellsPerM = 1.0 / (2.0 * max(fwidth(m), vec2(1e-5)));
            if (m.y < ${SHOP_H.toFixed(1)}) {
              // Storefront band: one row of sign letters on top, a frame row, then glass between frames.
              float shopW = ${SHOP_W.toFixed(1)} * max(1.0, ceil(3.0 / (${SHOP_W.toFixed(1)} * cellsPerM.x)));
              float shop = floor(m.x / shopW);
              float cx = fract(m.x / shopW) * shopW * cellsPerM.x;   // cell column within this shop
              float fromTop = (${SHOP_H.toFixed(1)} - m.y) * cellsPerM.y; // cell rows below the band's top
              float hs = h3(vec3(vBid, shop, 7.0));
              vec3 signCol = hs < 0.25 ? vec3(1.0, 0.8, 0.25) : hs < 0.5 ? vec3(1.0, 0.35, 0.8) : hs < 0.75 ? vec3(0.4, 1.0, 0.5) : vec3(0.95);
              if (fromTop < 1.0) {
                // Letters come in pairs ("LLAANNGG") like the reference's shop signs.
                float letter = floor(h3(vec3(vBid, shop, floor(cx / 2.0))) * ${SIGN_LETTERS.length}.0);
                facadeCode = ${F.shop + 2}.0 + letter;
                outgoingLight = signCol;
              } else if (fromTop < 2.0 || cx < 1.0 || cx >= shopW * cellsPerM.x - 1.0
                         || fract(m.x / 1.5) * 1.5 * cellsPerM.x < 1.0) {
                // Frames: the row under the sign, both shop edges, and a column every 1.5 m splitting the glass.
                facadeCode = ${F.shop}.0;
                outgoingLight = hs < 0.5 ? vec3(0.85, 0.25, 0.15) : vec3(0.9, 0.5, 0.15);
              } else {
                facadeCode = ${F.shop + 1}.0;
                outgoingLight = h3(vec3(vBid, shop, 3.0)) < 0.6 ? vec3(0.15, 0.35, 0.9) : vec3(0.1, 0.6, 0.7);
              }
            } else {
              vec2 base = vec2(bay, ${FLOOR.toFixed(1)});
              // LOD: merge whole bays/floors until each is >= MIN_PITCH cells; whole multiples keep the grid
              // anchored to the building so it doesn't crawl as you walk.
              vec2 unit = base * max(vec2(1.0), ceil(${MIN_PITCH.toFixed(1)} / (base * cellsPerM)));
              vec2 cellsPerUnit = unit * cellsPerM;
              vec2 idx = floor(m / unit);
              vec2 pos = fract(m / unit) * cellsPerUnit; // position inside this bay/floor, in cells
              // Mullion: a blank gap column at the end of each bay (>= 1 cell). Slab: the bottom row(s) of each
              // floor; in slab rows the gap and the pane cells beside it become slab glyphs, so rows read
              // "XXXXXX  XXXXXX" then "0XXXX0000XXXX0" like the reference.
              float mullion = max(1.0, floor(cellsPerUnit.x * mullionFrac));
              float slab = max(1.0, floor(cellsPerUnit.y * 0.25));
              bool inMullion = pos.x >= cellsPerUnit.x - mullion;
              // Slab rows only when a floor is >= 4 cells tall: on shorter floors a slab row would be every
              // other row and read as heavy horizontal stripes (the reference's distant towers have none).
              bool inSlab = slabRows && cellsPerUnit.y >= 4.0 && mod(idx.y, slabEvery) == 0.0 && pos.y < slab;
              bool besideMullion = pos.x < 1.0 || pos.x >= cellsPerUnit.x - mullion - 1.0;
              float h = h3(vec3(vBid, idx));
              // Glyph variety by floor band (whole rows of blocks share a glyph), with ~20% odd windows out.
              float hFloor = h3(vec3(vBid, 0.5, idx.y));
              float variant = floor((fract(h * 3.7) < 0.2 ? fract(h * 7.31) : hFloor) * ${F.variants}.0);
              float surf;
              if (inSlab && (inMullion || besideMullion)) surf = ${S.slab}.0;
              else if (inMullion) surf = ${S.mullion}.0;
              else surf = h < uWindowLit ? ${S.paneLit}.0 : ${S.pane}.0;
              float level = floor(intensity * ${F.levels - 1}.0 + 0.5);
              facadeCode = ${F.base}.0 + (surf * ${F.variants}.0 + variant) * ${F.levels}.0 + level;
              // Colour = the building's pure hue scaled by intensity (never the lit colour, whose moon/lamp
              // tints would desaturate it): one strong colour band per building. Also drives the WebGL view.
              float surfBright = surf == ${S.pane}.0 ? 0.8 : surf == ${S.mullion}.0 ? 0.3 : 0.55;
              outgoingLight = surf == ${S.paneLit}.0 ? vColor.rgb * 1.4 : vColor.rgb * surfBright * (0.35 + 0.65 * intensity);
            }
          }
        }
        #include <opaque_fragment>`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.a = facadeCode / 255.0;`);
  };
  return m;
}

/**
 * One box of a building, from height y0 to y1. Per-vertex attributes carry what the shader needs, so any
 * number of buildings can be merged into one draw call: aBuilding (id), aFacade (u, v in metres along the
 * face, v measured from the ground so the window grid runs on across tiers; z = 1 wall, 2 roof/plain),
 * and colour (the building's hue).
 */
function boxPart(b: BuildingSpec, w: number, d: number, y0: number, y1: number, offU: number, plain = false): THREE.BufferGeometry {
  const h = y1 - y0;
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = uv.count;
  const facade = new Float32Array(n * 3);
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z; 4 vertices each.
  for (let i = 0; i < n; i++) {
    const face = Math.floor(i / 4);
    const roof = plain || face === 2 || face === 3;
    const span = face < 2 ? d : w;
    facade[i * 3] = roof ? 0 : offU + uv.getX(i) * span;
    facade[i * 3 + 1] = roof ? 0 : y0 + uv.getY(i) * h;
    facade[i * 3 + 2] = roof ? 2 : 1;
  }
  const hue = new THREE.Color(hueFor(b.id));
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) hue.toArray(colors, i * 3);
  g.setAttribute('aFacade', new THREE.BufferAttribute(facade, 3));
  g.setAttribute('aBuilding', new THREE.BufferAttribute(new Float32Array(n).fill(b.id), 1));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.translate(b.x, y0 + h / 2, b.z);
  return g;
}

/**
 * A building: one box, or for towers over 45 m a stepped silhouette (1-2 setbacks) and sometimes an
 * antenna, for skylines like the reference's crowns and spires. The footprint (collision) is the base box.
 */
function buildingGeometry(b: BuildingSpec, rnd: Rng): THREE.BufferGeometry {
  const offU = rnd.int(0, 3) * 0.5; // shift the column grid so neighbours don't line up exactly
  if (b.h <= 45) return boxPart(b, b.w, b.d, 0, b.h, offU);
  const parts: THREE.BufferGeometry[] = [];
  const setbacks = rnd.int(1, 2);
  let y = 0;
  let scale = 1;
  for (let t = 0; t <= setbacks; t++) {
    const top = t === setbacks ? b.h : y + (b.h - y) * (0.55 + rnd.float() * 0.25);
    parts.push(boxPart(b, b.w * scale, b.d * scale, y, top, offU));
    y = top;
    scale *= 0.62 + rnd.float() * 0.18;
  }
  if (rnd.chance(0.5)) parts.push(boxPart(b, 0.6, 0.6, b.h, b.h + rnd.int(8, 22), 0, true));
  return mergeGeometries(parts);
}

const footprint = (b: BuildingSpec): Box => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });

/**
 * The hand-made test street. Returns collision boxes.
 * downtown=true swaps the six low buildings for a canyon of 60-160 m towers, for comparing against
 * street-level reference shots of tall facades.
 */
export function buildTestBlock(scene: THREE.Scene, material: THREE.Material, downtown = false): Box[] {
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

  // Six buildings of varying height either side of the street (residential district palette),
  // or the downtown canyon: facades on the building line at |x| = 9, mid-distance towers down the street.
  const specs: BuildingSpec[] = downtown
    ? [
        { id: 21, x: -21, z: 20, w: 24, d: 26, h: 140 },
        { id: 22, x: -20, z: -12, w: 22, d: 30, h: 95 },
        { id: 23, x: -22, z: -48, w: 26, d: 34, h: 160 },
        { id: 24, x: 21, z: 22, w: 24, d: 22, h: 120 },
        { id: 25, x: 20, z: -8, w: 22, d: 30, h: 70 },
        { id: 26, x: 22, z: -44, w: 26, d: 32, h: 150 },
        { id: 27, x: -30, z: -130, w: 22, d: 22, h: 85 },
        { id: 28, x: 28, z: -150, w: 20, d: 20, h: 110 },
        { id: 29, x: -6, z: -200, w: 18, d: 18, h: 65 },
      ]
    : [
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
