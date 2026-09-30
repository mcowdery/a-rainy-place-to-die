import * as THREE from 'three';
import type { CityUniforms } from './city';
import { screenLightGlsl } from './screenLight';

/**
 * Weather and night lighting close to the camera, in the HDR scene (so bloom and the grade see it):
 * - rain: streaks falling in a box that wraps round the camera, lit by the street's lightmap, so rain
 *   shows where there is light (under lamps, in front of neon and shopfronts) and vanishes in the dark.
 *   Strength (drizzle to downpour) and wind (up to near-horizontal, with gusts) are free; covered
 *   volumes (shops, canopies, the station) are skipped per drop, so rain still falls outside the window;
 * - splashes: flecks of spray on the ground round you, lit the same way;
 * - lightning: occasional double flashes in a storm;
 * - lamp cones: a faint cone of light under each street lamp near you when the air is wet;
 * - lamp shadows: the few lamps nearest you become shadow-casting spot lights (optional; each is a
 *   shadow-map render per frame).
 */

const BOX = new THREE.Vector3(46, 26, 46);

const lightmapGlsl = /* glsl */ `
  uniform sampler2D tLight;
  uniform vec4 uLightRect;
  uniform float uLightGain;
  vec3 lightAt(vec2 p) { return texture2D(tLight, (p - uLightRect.xy) * uLightRect.zw).rgb * uLightGain; }
`;

/** A covered volume the rain skips: the rect in x/z and the heights it covers. */
export interface RainShelter {
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly y0: number;
  readonly y1: number;
}

const SHELTERS = 12;

const shelterGlsl = /* glsl */ `
  uniform vec4 uShelter[${SHELTERS}];
  uniform vec2 uShelterY[${SHELTERS}];
  uniform int uShelters;
  bool sheltered(vec3 p) {
    for (int i = 0; i < ${SHELTERS}; i++) {
      if (i >= uShelters) break;
      vec4 r = uShelter[i];
      if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w && p.y > uShelterY[i].x && p.y < uShelterY[i].y) return true;
    }
    return false;
  }
`;

export class RainSystem {
  readonly group = new THREE.Group();
  private readonly streaks: THREE.LineSegments;
  private readonly splashes: THREE.Points;
  private readonly u = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: BOX.clone() },
    uAmount: { value: 0 },
    /** Accumulated fall and drift, so gusts change the direction smoothly. */
    uOffset: { value: new THREE.Vector3() },
    /** Horizontal drift per metre of fall (x, z). */
    uSlant: { value: new THREE.Vector2() },
    uShelter: { value: Array.from({ length: SHELTERS }, () => new THREE.Vector4()) },
    uShelterY: { value: Array.from({ length: SHELTERS }, () => new THREE.Vector2()) },
    uShelters: { value: 0 },
  };
  private static readonly FALL = 11;

  constructor(city: CityUniforms) {
    const shared = { ...this.u, tLight: city.tLight, uLightRect: city.uLightRect, uLightGain: city.uLightGain, uLamps: city.uLamps, uScreenP: city.uScreenP, uScreenA: city.uScreenA, uScreenC: city.uScreenC, uScreenCount: city.uScreenCount };
    // Streaks: two vertices each (top and bottom), with a random seed; uAmount picks the share that fall.
    // Streaks: polylines of SEG segments (a drop's trail over the last instant), each segment two vertices.
    // aSeed: position seed (xyz) and size (w); aK: the vertex's point index along the trail, 0 at the head.
    const N = 26000;
    const SEG = 3;
    const V = N * SEG * 2;
    const seed = new Float32Array(V * 4);
    const kk = new Float32Array(V);
    for (let i = 0; i < N; i++) {
      const sd = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < SEG; k++) {
        for (let e = 0; e < 2; e++) {
          const v = (i * SEG + k) * 2 + e;
          seed.set(sd, v * 4);
          kk[v] = k + e;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(V * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 1));
    this.streaks = new THREE.LineSegments(
      g,
      new THREE.ShaderMaterial({
        uniforms: shared,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          attribute float aK;
          uniform vec3 uCam;
          uniform vec3 uBox;
          uniform float uAmount;
          uniform vec3 uOffset;
          uniform vec2 uSlant;
          uniform float uTime;
          uniform float uLamps;
          ${lightmapGlsl}
          ${shelterGlsl}
          ${screenLightGlsl}
          varying vec3 vCol;
          varying float vA;
          // The wind where a drop is: the mean wind (uSlant: drift per metre of fall) varied by gust fronts
          // travelling downwind and by height (stronger aloft), so the rain bends and sweeps in curtains.
          vec2 windAt(vec3 p) {
            float w = length(uSlant);
            if (w < 1e-3) return vec2(0.0);
            vec2 dir = uSlant / w;
            float along = dot(p.xz, dir);
            float across = dot(p.xz, vec2(-dir.y, dir.x));
            float gust = 0.72 + 0.32 * sin(along * 0.05 - uTime * 1.4 + across * 0.02) + 0.18 * sin(along * 0.13 + p.y * 0.1 - uTime * 2.3);
            float shear = 0.75 + 0.5 * clamp((p.y - uCam.y + 8.0) / 24.0, 0.0, 1.0);
            return dir * w * gust * shear;
          }
          void main() {
            float r = aSeed.w;
            // Heavier rain comes in sheets: bands of more and fewer drops sweeping downwind.
            float band = uAmount > 0.4 ? 0.85 + 0.3 * sin(dot(aSeed.xz * uBox.xz, normalize(uSlant + vec2(1e-3, 0.0))) * 0.08 - uTime * 0.9) : 1.0;
            float live = step(r, uAmount * band);
            vec3 p = aSeed.xyz * uBox + uOffset * (0.85 + r * 0.3);
            p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
            // Gusts push drops sideways as well as slanting them: curtains, not a uniform grid.
            p.xz += (windAt(p) - uSlant) * 1.4;
            vec3 head = p;
            // Walk up the trail against the local wind: each segment bends a little more.
            float seg = (0.5 + r * 0.35) * (1.0 + length(uSlant) * 0.5) / 3.0;
            for (int i = 0; i < 3; i++) {
              if (float(i) >= aK) break;
              vec2 w = windAt(p);
              p -= normalize(vec3(w.x, -1.0, w.y)) * seg;
            }
            float dist = length(p - uCam);
            vA = live * smoothstep(1.2, 3.0, dist) * (1.0 - smoothstep(12.0, 23.0, dist)) * step(0.0, p.y);
            if (sheltered(head) || sheltered(p)) vA = 0.0;
            // The head is brightest; the trail fades.
            vA *= 1.0 - aK * 0.22;
            vec3 L = lightAt(p.xz) * mix(1.0, 0.35, clamp(p.y / 14.0, 0.0, 1.0));
            // Drops in front of a screen glitter in its colour.
            vCol = vec3(0.10, 0.12, 0.15) * (0.4 + 0.6 * (1.0 - uLamps)) + L * 0.55 + screenLight(p, vec3(0.0), 0.0) * 0.07;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vCol;
          varying float vA;
          void main() { if (vA < 0.01) discard; gl_FragColor = vec4(vCol * vA, 1.0); }`,
      }),
    );
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 5;
    // Splashes: flecks of spray on the ground round the camera, each on its own short cycle.
    const M = 3600;
    const sp = new Float32Array(M * 4);
    for (let i = 0; i < M; i++) sp.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(M * 3), 3));
    sg.setAttribute('aSeed', new THREE.Float32BufferAttribute(sp, 4));
    this.splashes = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        uniforms: shared,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform float uTime;
          uniform vec3 uCam;
          uniform float uAmount;
          uniform float uLamps;
          ${lightmapGlsl}
          ${shelterGlsl}
          varying vec3 vCol;
          varying float vPhase;
          void main() {
            float cycle = 0.35 + aSeed.w * 0.4;
            float t = uTime / cycle + aSeed.z * 10.0;
            float k = floor(t);
            vPhase = fract(t);
            // A new spot each cycle, in a 30 m square round the camera.
            vec2 o = fract(aSeed.xy + vec2(k * 0.618, k * 0.382)) * 30.0 - 15.0;
            vec3 p = vec3(uCam.x + o.x, 0.17, uCam.z + o.y);
            float live = step(aSeed.w, uAmount) * (sheltered(p) ? 0.0 : 1.0);
            vCol = (vec3(0.05, 0.055, 0.065) * (1.0 - uLamps * 0.7) + lightAt(p.xz) * 0.3) * live * (1.0 - vPhase);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            // A fleck of spray about 6 cm across, gone in a fraction of its cycle.
            // Capped: close to the camera a 6 cm fleck would otherwise fill dozens of pixels.
            gl_PointSize = min(live * step(vPhase, 0.18) * (0.045 + 0.02 * uAmount) * 900.0 / max(-mv.z, 0.5), 5.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vCol;
          varying float vPhase;
          void main() {
            float r = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.1, r);
            if (a < 0.01) discard;
            gl_FragColor = vec4(vCol * a * 2.0, 1.0);
          }`,
      }),
    );
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 5;
    this.group.add(this.streaks, this.splashes);
  }

  /**
   * amount: 0-1, drizzle to downpour (the share of streaks that fall). wind: horizontal drift per metre of
   * fall (x, z); (3, 0) is a hurricane blowing east. shelters: covered volumes near the camera.
   */
  update(time: number, dt: number, camera: THREE.Vector3, amount: number, wind: THREE.Vector2, shelters: readonly RainShelter[]): void {
    this.u.uTime.value = time;
    this.u.uCam.value.copy(camera);
    this.u.uAmount.value = amount;
    this.u.uSlant.value.copy(wind);
    // Heavier rain falls a little faster; the wind carries it sideways.
    const fall = RainSystem.FALL * (0.9 + amount * 0.4) * dt;
    const o = this.u.uOffset.value;
    o.x = (o.x + wind.x * fall) % (BOX.x * 64);
    o.y = (o.y - fall) % (BOX.y * 64);
    o.z = (o.z + wind.y * fall) % (BOX.z * 64);
    const n = Math.min(SHELTERS, shelters.length);
    for (let i = 0; i < n; i++) {
      const s = shelters[i];
      this.u.uShelter.value[i].set(s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h);
      this.u.uShelterY.value[i].set(s.y0, s.y1);
    }
    this.u.uShelters.value = n;
    this.group.visible = amount > 0;
  }
}

/**
 * Rain's depth layers round the main streaks (RainSystem, a few to 23 m):
 * - near: a few long, soft, thick streaks within ~3.5 m (camera-facing ribbons), the drops you'd see
 *   whip past your face;
 * - far: rain curtains, open cylinders round the camera at 30, 70 and 140 m with streaks drawn on them,
 *   slanted by the wind and swaying in bands, lit by the street below (the lightmap), fading with distance
 *   and height. Buildings in front hide them; distant streets look veiled;
 * - spray: water thrown up behind the moving cars' wheels (the city shader's headlight list, uCars).
 */
export class RainLayers {
  readonly group = new THREE.Group();
  private readonly u = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uAmount: { value: 0 },
    uSlant: { value: new THREE.Vector2() },
    uWet: { value: 0 },
    uFogFar: { value: 400 },
    uHorizon: { value: new THREE.Color() },
    uShelter: { value: Array.from({ length: SHELTERS }, () => new THREE.Vector4()) },
    uShelterY: { value: Array.from({ length: SHELTERS }, () => new THREE.Vector2()) },
    uShelters: { value: 0 },
  };

  constructor(city: CityUniforms) {
    const shared = { ...this.u, tLight: city.tLight, uLightRect: city.uLightRect, uLightGain: city.uLightGain, uLamps: city.uLamps, uCars: city.uCars, uCarCount: city.uCarCount };
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;

    // Near: ribbons (instanced quads), each a drop's streak close to the camera.
    const NEAR = 260;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const nearGeo = new THREE.InstancedBufferGeometry();
    nearGeo.index = quad.index;
    nearGeo.setAttribute('position', quad.getAttribute('position'));
    nearGeo.setAttribute('uv', quad.getAttribute('uv'));
    const ns = new Float32Array(NEAR * 4);
    for (let i = 0; i < NEAR; i++) ns.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    nearGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ns, 4));
    nearGeo.instanceCount = NEAR;
    const near = new THREE.Mesh(
      nearGeo,
      new THREE.ShaderMaterial({
        uniforms: shared,
        ...additive,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform float uTime;
          uniform vec3 uCam;
          uniform float uAmount;
          uniform vec2 uSlant;
          uniform float uLamps;
          ${lightmapGlsl}
          ${shelterGlsl}
          varying vec2 vUv;
          varying vec3 vCol;
          void main() {
            vUv = uv;
            // A box of 7 x 6 x 7 m round the camera; each drop falls at 12 m/s on its own offset.
            vec3 box = vec3(7.0, 6.0, 7.0);
            vec3 p = aSeed.xyz * box;
            p.y -= uTime * 12.0 + aSeed.w * 40.0;
            p.xz += uSlant * uTime * 12.0;
            p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
            vec3 dir = normalize(vec3(uSlant.x, -1.0, uSlant.y));
            vec3 toCam = normalize(uCam - p);
            vec3 side = normalize(cross(dir, toCam));
            float len = 1.4 + aSeed.w * 0.8;
            vec3 wp = p - dir * position.y * len + side * position.x * 0.012;
            float d = length(p - uCam);
            float a = step(aSeed.w, uAmount * 0.9) * smoothstep(0.35, 0.9, d) * (1.0 - smoothstep(2.5, 3.6, d));
            if (sheltered(p)) a = 0.0;
            vCol = (vec3(0.12, 0.13, 0.16) * (1.0 - 0.6 * uLamps) + lightAt(p.xz) * 0.35) * a;
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vCol;
          void main() {
            // Soft across, tapered at both ends: an out-of-focus streak.
            float x = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float y = sin(vUv.y * 3.14159);
            float a = x * x * y;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vCol * a * 0.6, 1.0);
          }`,
      }),
    );
    near.frustumCulled = false;
    near.renderOrder = 6;

    // Far: curtains on cylinders round the camera.
    const curtain = new THREE.ShaderMaterial({
      uniforms: { ...shared, uRadius: { value: 30 } },
      ...additive,
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        uniform vec3 uCam;
        uniform float uRadius;
        varying vec3 vWorld;
        varying float vAng;
        void main() {
          vec3 wp = vec3(uCam.x + position.x * uRadius, position.y, uCam.z + position.z * uRadius);
          vWorld = wp;
          vAng = atan(position.z, position.x);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCam;
        uniform float uAmount;
        uniform vec2 uSlant;
        uniform float uRadius;
        uniform float uFogFar;
        uniform vec3 uHorizon;
        uniform float uLamps;
        ${lightmapGlsl}
        varying vec3 vWorld;
        varying float vAng;
        float hh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main() {
          // Streak coordinates on the cylinder: u round it (metres), v up; slanted by the wind across it.
          float u = vAng * uRadius;
          float v = vWorld.y;
          vec2 tang = vec2(-sin(vAng), cos(vAng));
          u -= dot(uSlant, tang) * v;
          float cols = 3.0;
          float c = floor(u * cols);
          float r = hh(vec2(c, uRadius));
          float line = 1.0 - smoothstep(0.08, 0.3, abs(fract(u * cols) - 0.5));
          float seg = smoothstep(0.55, 1.0, fract(v * (0.12 + 0.05 * r) + uTime * (1.1 + 0.6 * r) + r * 7.0));
          // Heavier bands sweeping along the curtain.
          float band = 0.55 + 0.45 * sin(u * 0.04 + v * 0.03 - uTime * 0.7 + uRadius);
          float live = step(r, uAmount * 1.1);
          float fade = (1.0 - smoothstep(0.35, 1.0, uRadius / uFogFar)) * (1.0 - smoothstep(18.0, 60.0, v)) * smoothstep(0.0, 1.5, v);
          vec3 L = lightAt(vWorld.xz) * mix(1.0, 0.3, clamp(v / 25.0, 0.0, 1.0));
          vec3 col = (L * 0.3 + uHorizon * 0.25 + vec3(0.03) * (1.0 - uLamps)) * line * seg * band * live * fade;
          // A faint lit veil between the streaks.
          col += (L * 0.05 + uHorizon * 0.04) * uAmount * band * fade;
          gl_FragColor = vec4(col * 0.55, 1.0);
        }`,
    });
    const cyl = new THREE.CylinderGeometry(1, 1, 60, 96, 1, true);
    cyl.translate(0, 30, 0);
    for (const R of [30, 70, 140]) {
      const m = new THREE.Mesh(cyl, curtain.clone());
      (m.material as THREE.ShaderMaterial).uniforms = { ...shared, uRadius: { value: R } };
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.group.add(m);
    }

    // Spray behind the moving cars' wheels.
    const SPRAY = 2000;
    const sp = new Float32Array(SPRAY * 4);
    for (let i = 0; i < SPRAY; i++) sp.set([Math.random(), Math.random(), Math.random(), Math.floor(Math.random() * 16)], i * 4);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SPRAY * 3), 3));
    sg.setAttribute('aSeed', new THREE.Float32BufferAttribute(sp, 4));
    const spray = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        uniforms: shared,
        ...additive,
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform float uTime;
          uniform float uWet;
          uniform vec4 uCars[16];
          uniform int uCarCount;
          uniform float uLamps;
          ${lightmapGlsl}
          varying vec3 vCol;
          void main() {
            int i = int(aSeed.w);
            vec4 car = vec4(0.0);
            for (int k = 0; k < 16; k++) if (k == i) car = uCars[k];
            float on = float(i < uCarCount) * uWet;
            // Each droplet: thrown back and up from a rear wheel, over half a second.
            float t = fract(uTime * 2.2 + aSeed.z * 9.0);
            vec2 d = car.zw;
            vec2 s = vec2(-d.y, d.x);
            float wheel = aSeed.x < 0.5 ? -0.75 : 0.75;
            vec2 xz = car.xy - d * (1.6 + t * (2.0 + aSeed.y * 2.5)) + s * (wheel + (aSeed.y - 0.5) * 0.9 * t);
            float y = 0.12 + t * (1.0 - t) * (1.6 + aSeed.x);
            vec3 p = vec3(xz.x, y, xz.y);
            vCol = (vec3(0.05, 0.055, 0.065) * (1.0 - 0.6 * uLamps) + lightAt(xz) * 0.35) * on * (1.0 - t);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = on > 0.01 ? min(0.05 * 900.0 / max(-mv.z, 0.5), 4.0) : 0.0;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vCol;
          void main() {
            float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
            if (a < 0.01) discard;
            gl_FragColor = vec4(vCol * a * 1.5, 1.0);
          }`,
      }),
    );
    spray.frustumCulled = false;
    spray.renderOrder = 5;
    this.group.add(near, spray);
  }

  update(time: number, camera: THREE.Vector3, amount: number, wind: THREE.Vector2, wet: number, fogFar: number, horizon: THREE.Color, shelters: readonly RainShelter[]): void {
    this.u.uTime.value = time;
    this.u.uCam.value.copy(camera);
    this.u.uAmount.value = amount;
    this.u.uSlant.value.copy(wind);
    this.u.uWet.value = wet;
    this.u.uFogFar.value = fogFar;
    this.u.uHorizon.value.copy(horizon);
    const n = Math.min(SHELTERS, shelters.length);
    for (let i = 0; i < n; i++) {
      const s = shelters[i];
      this.u.uShelter.value[i].set(s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h);
      this.u.uShelterY.value[i].set(s.y0, s.y1);
    }
    this.u.uShelters.value = n;
    // The curtains and near streaks need rain; the spray only needs a wet road.
    for (const c of this.group.children) c.visible = c instanceof THREE.Points ? wet > 0.05 : amount > 0;
  }
}

/**
 * Water off the buildings and litter in the wind, near the camera:
 * - drips: streaks falling from the edges of the canopies, awnings and viaduct nearby (the covered
 *   volumes that aren't enclosed), steady while wet, lit by the street;
 * - debris: scraps of paper and a plastic bag or two tumbling along the ground downwind in strong wind.
 */
export class StreetWater {
  readonly group = new THREE.Group();
  private readonly u = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uWet: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uShelter: { value: Array.from({ length: SHELTERS }, () => new THREE.Vector4()) },
    uShelterY: { value: Array.from({ length: SHELTERS }, () => new THREE.Vector2()) },
    uShelters: { value: 0 },
  };

  constructor(city: CityUniforms) {
    const shared = { ...this.u, tLight: city.tLight, uLightRect: city.uLightRect, uLightGain: city.uLightGain, uLamps: city.uLamps };
    // Drips: each a short streak on its own cycle, from a random point on a random nearby edge.
    const N = 900;
    const seed = new Float32Array(N * 2 * 4);
    for (let i = 0; i < N; i++) {
      const sd = [Math.random(), Math.random(), Math.random(), Math.floor(Math.random() * SHELTERS)];
      for (let e = 0; e < 2; e++) seed.set([sd[0], sd[1], sd[2], sd[3] + e * 0.5], (i * 2 + e) * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
    const drips = new THREE.LineSegments(
      g,
      new THREE.ShaderMaterial({
        uniforms: shared,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform float uTime;
          uniform vec3 uCam;
          uniform float uWet;
          uniform vec4 uShelter[${SHELTERS}];
          uniform vec2 uShelterY[${SHELTERS}];
          uniform int uShelters;
          uniform float uLamps;
          ${lightmapGlsl}
          varying vec3 vCol;
          void main() {
            int i = int(aSeed.w);
            float end = fract(aSeed.w);
            vec4 r = vec4(0.0);
            vec2 hy = vec2(0.0);
            for (int k = 0; k < ${SHELTERS}; k++) if (k == i) { r = uShelter[k]; hy = uShelterY[k]; }
            float on = float(i < uShelters) * step(0.15, uWet) * step(hy.y, 25.0);
            // A point on the rect's perimeter.
            float w = r.z - r.x;
            float d = r.w - r.y;
            float per = aSeed.x * 2.0 * (w + d);
            vec2 xz = per < w ? vec2(r.x + per, r.y) : per < w + d ? vec2(r.z, r.y + per - w) : per < 2.0 * w + d ? vec2(r.z - (per - w - d), r.w) : vec2(r.x, r.w - (per - 2.0 * w - d));
            // Falling under gravity from the edge (y1) on a cycle; the streak is the last few centimetres.
            float cycle = 0.6 + aSeed.y * 1.4;
            float t = fract(uTime / cycle + aSeed.z) * cycle;
            float fall = 4.9 * t * t;
            float speed = 9.8 * t;
            float y = hy.y - fall + end * min(speed * 0.03, 0.35);
            vec3 p = vec3(xz.x, max(y, 0.0), xz.y);
            float near = 1.0 - smoothstep(18.0, 30.0, length(p - uCam));
            float a = on * near * step(0.0, y) * uWet;
            vCol = (vec3(0.1, 0.11, 0.13) * (1.0 - 0.6 * uLamps) + lightAt(xz) * 0.5) * a * (0.6 + end * 0.4);
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vCol;
          void main() { if (dot(vCol, vCol) < 1e-6) discard; gl_FragColor = vec4(vCol, 1.0); }`,
      }),
    );
    drips.frustumCulled = false;
    drips.renderOrder = 5;
    // Debris: small quads tumbling along the ground downwind, in a 50 m box round the camera.
    const D = 36;
    const quad = new THREE.PlaneGeometry(1, 1);
    const dg = new THREE.InstancedBufferGeometry();
    dg.index = quad.index;
    dg.setAttribute('position', quad.getAttribute('position'));
    const ds = new Float32Array(D * 4);
    for (let i = 0; i < D; i++) ds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    dg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ds, 4));
    dg.instanceCount = D;
    const debris = new THREE.Mesh(
      dg,
      new THREE.ShaderMaterial({
        uniforms: shared,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform float uTime;
          uniform vec3 uCam;
          uniform vec2 uWind;
          uniform float uLamps;
          ${lightmapGlsl}
          varying vec3 vCol;
          void main() {
            float w = length(uWind);
            vec2 dir = w > 1e-3 ? uWind / w : vec2(1.0, 0.0);
            vec3 box = vec3(50.0, 1.0, 50.0);
            vec3 c = aSeed.xyz * box;
            float travel = uTime * w * (2.5 + aSeed.w * 2.0);
            c.xz += dir * travel;
            c = mod(c - uCam + box * 0.5, box) + uCam - box * 0.5;
            // Skipping along: hops, and a sideways wander.
            float hop = abs(sin(uTime * (3.0 + aSeed.w * 4.0) + aSeed.x * 20.0)) * (0.2 + 0.8 * w);
            c.y = 0.05 + hop * 0.8;
            c.xz += vec2(-dir.y, dir.x) * sin(uTime * 1.3 + aSeed.z * 30.0) * 0.6;
            // Tumbling.
            float a1 = uTime * (4.0 + aSeed.w * 6.0) + aSeed.y * 6.28;
            float a2 = uTime * (3.0 + aSeed.x * 5.0);
            vec3 q = position * (aSeed.w < 0.12 ? 0.55 : 0.3);
            q = vec3(q.x, q.y * cos(a1), q.y * sin(a1));
            q = vec3(q.x * cos(a2) - q.z * sin(a2), q.y, q.x * sin(a2) + q.z * cos(a2));
            // Mostly lying flat, lifting as it hops.
            q.y *= 0.25 + 0.75 * hop;
            vec3 p = c + q;
            float show = step(0.2, w) * (1.0 - smoothstep(18.0, 25.0, length(p - uCam)));
            // Paper (white), newsprint (grey) or a plastic bag (the bigger ones, pale), lit by the street.
            vec3 alb = aSeed.w < 0.12 ? vec3(0.8, 0.82, 0.78) : aSeed.z < 0.5 ? vec3(0.9, 0.88, 0.82) : vec3(0.55, 0.55, 0.52);
            vCol = alb * (lightAt(p.xz) * 0.45 + vec3(0.03) + vec3(0.3) * (1.0 - uLamps));
            gl_Position = projectionMatrix * viewMatrix * vec4(p * show + uCam * (1.0 - show) - vec3(0.0, 100.0, 0.0) * (1.0 - show), 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vCol;
          void main() { gl_FragColor = vec4(vCol, 1.0); }`,
      }),
    );
    debris.frustumCulled = false;
    this.group.add(drips, debris);
  }

  /** shelters: covered volumes near the camera (the open ones drip from their edges). */
  update(time: number, camera: THREE.Vector3, wet: number, wind: THREE.Vector2, shelters: readonly (RainShelter & { readonly enclosed?: boolean })[]): void {
    this.u.uTime.value = time;
    this.u.uCam.value.copy(camera);
    this.u.uWet.value = wet;
    this.u.uWind.value.copy(wind).multiplyScalar(1 / 3.2);
    const open = shelters.filter((s) => !s.enclosed);
    const n = Math.min(SHELTERS, open.length);
    for (let i = 0; i < n; i++) {
      const s = open[i];
      this.u.uShelter.value[i].set(s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h);
      this.u.uShelterY.value[i].set(s.y0, s.y1);
    }
    this.u.uShelters.value = n;
    this.group.children[0].visible = wet > 0.15 && n > 0;
    this.group.children[1].visible = wind.length() > 0.6;
  }
}

/** A lightning strike: where it is (unit direction from the camera, flat) and how far. */
export interface Strike {
  readonly dirX: number;
  readonly dirZ: number;
  readonly distance: number;
  /** Cloud-to-cloud: a flash in the clouds, no bolt to the ground. */
  readonly cloudOnly: boolean;
}

/**
 * Lightning: strikes at a rate (per minute), each a double-flicker flash. A strike draws a branching bolt
 * in the sky behind the city (a camera-facing ribbon at 1 km, HDR white-violet so bloom catches it; the
 * buildings hide its foot), lights the clouds round its bearing (the sky reads flash / flashDir), and
 * throws a brief hard light from its direction with a shadow map rendered once per strike, so the city
 * casts shadows for an instant. onStrike fires at the start (for the thunder).
 */
export class Lightning {
  readonly bolt: THREE.Mesh;
  /** The strike's light: always cast-shadow (so shaders never change), intensity 0 between strikes. */
  readonly light: THREE.DirectionalLight;
  onStrike: ((s: Strike) => void) | null = null;
  /** Current flash 0-1 and the direction toward the strike (world, from the camera). */
  flash = 0;
  readonly dir = new THREE.Vector3(1, 0, 0);
  private next = 3;
  private t = -1;
  private time = 0;
  private strike: Strike | null = null;
  private readonly boltMat: THREE.MeshBasicMaterial;

  constructor() {
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = 1001;
    this.bolt.visible = false;
    this.light = new THREE.DirectionalLight(0xc8d4ff, 0);
    this.light.castShadow = true;
    this.light.shadow.autoUpdate = false;
    this.light.shadow.mapSize.set(2048, 2048);
    const c = this.light.shadow.camera;
    c.left = -120;
    c.right = 120;
    c.top = 120;
    c.bottom = -120;
    c.near = 1;
    c.far = 800;
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 0.05;
    // Render the shadow map once up front: materials that sample a never-rendered shadow map fail to draw.
    this.light.shadow.needsUpdate = true;
  }

  /** perMinute: the strike rate (0 stops them). Returns the flash 0-1. */
  update(dt: number, perMinute: number, camera: THREE.Vector3): number {
    this.time += dt;
    if (this.t < 0 && perMinute > 0 && this.time > this.next) this.begin(camera, perMinute);
    if (this.t < 0) {
      this.flash = 0;
      this.bolt.visible = false;
      this.light.intensity = 0;
      return 0;
    }
    this.t += dt;
    const t = this.t;
    // Leader, a gap, the return stroke, then a fading flicker.
    const f = t < 0.06 ? 1 : t < 0.13 ? 0.1 : t < 0.2 ? 0.9 : t < 0.26 ? 0.25 : t < 0.32 ? 0.6 : Math.max(0, 1 - (t - 0.32) * 3) * 0.35;
    if (t > 0.7) this.t = -1;
    this.flash = f;
    const cloud = this.strike?.cloudOnly ?? true;
    this.bolt.visible = !cloud && f > 0.05;
    this.boltMat.color.setRGB(9, 9, 14).multiplyScalar(f);
    // Near strikes light the city harder.
    const near = this.strike ? Math.max(0.25, 1 - this.strike.distance / 6000) : 0;
    this.light.intensity = f * (cloud ? 0.6 : 2.4) * near;
    return f;
  }

  /** Strike now (debug and scripted scenes), optionally toward a world direction (x, z) and always a bolt. */
  strikeNow(camera: THREE.Vector3, toward?: { x: number; z: number }): void {
    this.begin(camera, 1, toward);
  }

  private begin(camera: THREE.Vector3, perMinute: number, toward?: { x: number; z: number }): void {
    this.t = 0;
    // Poisson-ish gaps, never closer than 2.5 s.
    this.next = this.time + 2.5 + (-Math.log(1 - Math.random() * 0.98) * 60) / perMinute;
    const a = toward ? Math.atan2(toward.z, toward.x) + (Math.random() - 0.5) * 0.5 : Math.random() * Math.PI * 2;
    const s: Strike = { dirX: Math.cos(a), dirZ: Math.sin(a), distance: 700 + Math.random() * 5500, cloudOnly: !toward && Math.random() < 0.3 };
    this.strike = s;
    this.dir.set(s.dirX, 0.35, s.dirZ).normalize();
    // The light comes from the strike, high up; one shadow map per strike, round the camera.
    this.light.position.set(camera.x + s.dirX * 300, camera.y + 260, camera.z + s.dirZ * 300);
    this.light.target.position.copy(camera);
    this.light.target.updateMatrixWorld();
    this.light.shadow.needsUpdate = true;
    if (!s.cloudOnly) this.buildBolt(camera, s);
    this.onStrike?.(s);
  }

  /** A jagged main channel from the cloud base to the ground, with a few forks, as camera-facing ribbons. */
  private buildBolt(camera: THREE.Vector3, s: Strike): void {
    const R = 1000;
    const cx = camera.x + s.dirX * R;
    const cz = camera.z + s.dirZ * R;
    const top = R * Math.tan(((16 + Math.random() * 12) * Math.PI) / 180);
    const side = new THREE.Vector3(-s.dirZ, 0, s.dirX);
    const pos: number[] = [];
    const ribbon = (pts: THREE.Vector3[], width: number): void => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const seg = b.clone().sub(a);
        const view = a.clone().sub(camera).normalize();
        const w = seg.clone().cross(view).normalize().multiplyScalar((width * (1 - (i / pts.length) * 0.5)) / 2);
        const q = [a.clone().add(w), a.clone().sub(w), b.clone().sub(w), b.clone().add(w)];
        for (const k of [0, 1, 2, 0, 2, 3]) pos.push(q[k].x, q[k].y, q[k].z);
      }
    };
    // Midpoint displacement down the channel, drifting sideways.
    const channel = (from: THREE.Vector3, to: THREE.Vector3, rough: number, depth: number): THREE.Vector3[] => {
      let pts = [from, to];
      for (let d = 0; d < depth; d++) {
        const next: THREE.Vector3[] = [pts[0]];
        for (let i = 0; i + 1 < pts.length; i++) {
          const m = pts[i].clone().add(pts[i + 1]).multiplyScalar(0.5);
          const len = pts[i].distanceTo(pts[i + 1]);
          m.addScaledVector(side, (Math.random() - 0.5) * len * rough);
          m.y += (Math.random() - 0.5) * len * rough * 0.3;
          next.push(m, pts[i + 1]);
        }
        pts = next;
      }
      return pts;
    };
    const drift = (Math.random() - 0.5) * 160;
    const main = channel(new THREE.Vector3(cx, top, cz), new THREE.Vector3(cx + side.x * drift, -20, cz + side.z * drift), 0.55, 7);
    ribbon(main, 5);
    // Forks off the upper two thirds, shorter and thinner, reaching down and out.
    const forks = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < forks; k++) {
      const from = main[Math.floor(Math.random() * main.length * 0.66)];
      const len = 60 + Math.random() * 180;
      const out = (Math.random() < 0.5 ? -1 : 1) * len * (0.5 + Math.random() * 0.6);
      const to = from.clone().addScaledVector(side, out);
      to.y -= len;
      ribbon(channel(from, to, 0.6, 5), 2.2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.bolt.geometry.dispose();
    this.bolt.geometry = g;
  }
}

/** A lamp head: where its light starts (world). */
export interface LampHead {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class LampCones {
  readonly mesh: THREE.InstancedMesh;
  private readonly u = { uStrength: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.72, 0.42) } };
  private last = new THREE.Vector3(1e9, 0, 0);
  private static readonly MAX = 160;

  constructor() {
    // An open cone from the lamp (top, y 0) down to the ground (y -1), radius 1 at the bottom; scaled per lamp.
    const geo = new THREE.CylinderGeometry(0.06, 1, 1, 20, 1, true);
    geo.translate(0, -0.5, 0);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.u,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying float vH;
          varying float vEdge;
          void main() {
            vH = -position.y;
            vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
            vec3 v = normalize(cameraPosition - wp.xyz);
            vEdge = abs(dot(n, v));
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uStrength;
          uniform vec3 uColor;
          varying float vH;
          varying float vEdge;
          void main() {
            // Brightest near the lamp, soft at the silhouette, gone before it reaches the ground.
            // Clamp before pow: at the rim 1 - vH can dip below 0, and pow of a negative is NaN (bright specks).
            float h = clamp(vH, 0.0, 1.0);
            float a = uStrength * pow(1.0 - h, 1.6) * smoothstep(0.0, 0.08, h) * smoothstep(0.0, 0.7, vEdge);
            gl_FragColor = vec4(uColor * a, 1.0);
          }`,
      }),
      LampCones.MAX,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Re-picks the lamps near the camera when it has moved; strength from the air (rain, fog) and night. */
  update(camera: THREE.Vector3, lamps: (x: number, z: number, r: number) => readonly LampHead[], strength: number): void {
    this.u.uStrength.value = strength;
    this.mesh.visible = strength > 0.001;
    if (!this.mesh.visible || camera.distanceToSquared(this.last) < 64) return;
    this.last.copy(camera);
    const heads = lamps(camera.x, camera.z, 110).slice(0, LampCones.MAX);
    const m = new THREE.Matrix4();
    heads.forEach((h, i) => {
      m.makeScale(3.2, h.y, 3.2).setPosition(h.x, h.y, h.z);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.count = heads.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Shadow-casting street lamps: a fixed pool of spot lights moved to the lamps nearest the camera. The pool
 * size is a setting (changing it recompiles the city's shaders once); each light renders a shadow map, but only
 * when it has to: when it's moved to a new lamp, and otherwise a quarter of them each frame in turn (the lamps and
 * the buildings stand still; the cars and people under them update at a quarter of the frame rate), and none while
 * the lamps are off.
 */
export class LampShadows {
  readonly group = new THREE.Group();
  private lights: THREE.SpotLight[] = [];
  private tick = 0;
  private last = new THREE.Vector3(1e9, 0, 0);
  private heads: readonly LampHead[] = [];

  get count(): number {
    return this.lights.length;
  }

  setCount(n: number): void {
    if (n === this.lights.length) return;
    for (const l of this.lights) {
      this.group.remove(l, l.target);
      l.dispose();
    }
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.SpotLight(0xffc890, 0, 22, 1.05, 0.55, 1.6);
      l.castShadow = true;
      l.shadow.mapSize.set(512, 512);
      l.shadow.bias = -0.0008;
      l.shadow.normalBias = 0.05;
      l.shadow.camera.near = 0.5;
      l.shadow.camera.far = 22;
      l.shadow.autoUpdate = false;
      l.shadow.needsUpdate = true;
      this.group.add(l, l.target);
      this.lights.push(l);
    }
    this.last.set(1e9, 0, 0);
  }

  /**
   * intensity: the lights' strength (0 by day); lamps nearest the camera get a light each. Spare lights
   * are switched off, never hidden: a change in the number of visible lights recompiles every shader.
   */
  update(camera: THREE.Vector3, lamps: (x: number, z: number, r: number) => readonly LampHead[], intensity: number): void {
    if (this.lights.length === 0) return;
    const moved = camera.distanceToSquared(this.last) >= 9;
    if (moved) this.last.copy(camera);
    const heads = moved ? (this.heads = lamps(camera.x, camera.z, 60)) : this.heads;
    const on = intensity > 0.01;
    this.tick++;
    this.lights.forEach((l, i) => {
      const h = heads[i];
      l.intensity = h ? intensity : 0;
      if (on && h && (i + this.tick) % 4 === 0) l.shadow.needsUpdate = true;
      if (!h || !moved) return;
      if (l.position.x !== h.x || l.position.z !== h.z) l.shadow.needsUpdate = on;
      l.position.set(h.x, h.y - 0.1, h.z);
      l.target.position.set(h.x, 0, h.z);
      l.target.updateMatrixWorld();
    });
  }
}

/**
 * Things drifting down round the camera: snow in winter weather, cherry petals in spring, leaves in autumn (main.ts
 * picks by the season and the weather). Points in a box that follows the camera, each falling at its own pace and
 * swaying, lit by the street light (the lightmap) and the sky. Petals and leaves are drawn as their shapes, turning
 * and tumbling (thin when edge-on), and ride the wind: carried downwind (the offset is integrated here, so a change
 * of wind doesn't jump them), hanging longer and spinning faster as it rises; when it's up, a share of them skitter
 * along the ground in hops instead of falling.
 */
export class Drift {
  readonly points: THREE.Points;
  private readonly u = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uAmount: { value: 0 },
    /** 0 snow, 1 petals, 2 leaves. */
    uKind: { value: 0 },
    /** Fall speed (m/s), sway (m), size (m). */
    uFall: { value: 1 },
    uSway: { value: 0.4 },
    uSize: { value: 0.03 },
    uAmbient: { value: 0.3 },
    /** The wind now (m/s), and how far it has carried things so far (m), aloft and along the ground. */
    uWind: { value: new THREE.Vector2() },
    uCarry: { value: new THREE.Vector2() },
    uSkid: { value: new THREE.Vector2() },
    /** The ground's height under the camera (for the skittering ones). */
    uGround: { value: 0 },
  };

  constructor(city: CityUniforms) {
    const N = 9000;
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { ...this.u, tLight: city.tLight, uLightRect: city.uLightRect, uLightGain: city.uLightGain },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCam;
        uniform float uAmount;
        uniform float uKind;
        uniform float uFall;
        uniform float uSway;
        uniform float uSize;
        uniform float uAmbient;
        uniform vec2 uWind;
        uniform vec2 uCarry;
        uniform vec2 uSkid;
        uniform float uGround;
        ${lightmapGlsl}
        varying vec3 vCol;
        varying float vA;
        varying vec2 vRot;
        varying float vFlip;
        void main() {
          bool snow = uKind < 0.5;
          float windS = length(uWind);
          vec3 box = snow ? vec3(44.0, 24.0, 44.0) : vec3(52.0, 20.0, 52.0);
          // Leaves and petals hang longer in a wind; each rides it a little differently.
          float speed = uFall * (0.7 + aSeed.w * 0.6) / (snow ? 1.0 : 1.0 + windS * 0.3);
          float ride = snow ? 0.35 : 0.75 + 0.5 * fract(aSeed.x * 31.0);
          vec3 p = aSeed.xyz * box;
          p.y -= uTime * speed;
          p.xz += uCarry * ride;
          float sway = uSway * (1.0 + windS * 0.35);
          p.x += sin(uTime * (0.6 + aSeed.w) + aSeed.z * 20.0) * sway;
          p.z += cos(uTime * (0.5 + aSeed.x) + aSeed.y * 20.0) * sway;
          // A share skitter along the ground when the wind's up: carried in bursts, hopping.
          bool skit = !snow && fract(aSeed.w * 53.0) < 0.3;
          float skitA = 1.0;
          if (skit) {
            p = vec3(aSeed.x * box.x, 0.0, aSeed.z * box.z);
            p.xz += uSkid * (0.6 + 0.8 * fract(aSeed.y * 17.0));
            float hop = abs(sin(uTime * (3.0 + 4.0 * aSeed.y) + aSeed.z * 40.0));
            p.y = 0.0;
            p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
            p.y = uGround + 0.12 + hop * hop * 0.35 * min(1.0, windS / 3.0);
            skitA = smoothstep(0.6, 1.8, windS);
          } else {
            p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          }
          float live = step(fract(aSeed.w * 7.31), uAmount);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          float reach = snow ? 21.0 : 30.0;
          vA = live * skitA * smoothstep(0.4, 1.5, d) * (1.0 - smoothstep(reach * 0.65, reach, length(p - uCam))) * step(uGround - 0.5, p.y);
          // Turning (faster in a wind) and tumbling (thin when edge-on).
          float spin = (aSeed.z - 0.5) * 5.0 * (1.0 + windS * 0.4);
          float a = aSeed.y * 6.2832 + uTime * spin;
          vRot = vec2(cos(a), sin(a));
          vFlip = cos(uTime * (1.2 + aSeed.x * 2.5) * (1.0 + windS * 0.3) + aSeed.w * 20.0);
          vec3 c;
          float pick = fract(aSeed.z * 13.7);
          if (snow) c = mix(vec3(0.95, 0.96, 1.0), vec3(0.88, 0.9, 0.96), step(0.5, pick));
          else if (uKind < 1.5) c = pick < 0.75 ? vec3(1.0, 0.76, 0.86) : vec3(1.0, 0.92, 0.94);
          else c = pick < 0.22 ? vec3(0.95, 0.72, 0.16) : pick < 0.44 ? vec3(0.9, 0.45, 0.12) : pick < 0.62 ? vec3(0.7, 0.18, 0.1) : pick < 0.84 ? vec3(0.52, 0.3, 0.12) : vec3(0.7, 0.56, 0.32);
          vCol = c * (uAmbient + lightAt(p.xz) * 0.8);
          gl_Position = projectionMatrix * mv;
          float px = uSize * (0.8 + 0.4 * fract(aSeed.y * 5.3)) * 900.0 / max(d, 0.3);
          gl_PointSize = min(px, snow ? 6.0 : 26.0) * step(0.01, vA);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uKind;
        varying vec3 vCol;
        varying float vA;
        varying vec2 vRot;
        varying float vFlip;
        void main() {
          vec2 q = (gl_PointCoord - 0.5) * 2.0;
          if (uKind < 0.5) {
            float r = dot(q, q) * 0.25;
            if (r > 0.25 || vA < 0.01) discard;
            gl_FragColor = vec4(vCol, vA * (1.0 - r * 3.0));
            return;
          }
          // A leaf (long, pointed, a midrib) or a petal (rounder, a notch at the tip), turned, tumbling.
          vec2 r = vec2(vRot.x * q.x + vRot.y * q.y, -vRot.y * q.x + vRot.x * q.y);
          bool petal = uKind < 1.5;
          float L = petal ? 0.75 : 0.95;
          float t = r.x / L;
          float flat_ = 0.12 + 0.88 * abs(vFlip);
          float w = (petal ? 0.55 : 0.45) * sqrt(max(0.0, 1.0 - t * t)) * (1.0 - 0.3 * t) * flat_ + 1e-3;
          if (abs(t) > 1.0 || abs(r.y) > w || vA < 0.01) discard;
          if (petal && length(vec2(r.x - L, r.y)) < 0.22) discard;
          // The side toward the sky is lighter; the midrib darker.
          vec3 c = vCol * (vFlip > 0.0 ? 1.0 : 0.75);
          if (!petal) c *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.1 * flat_, abs(r.y)));
          gl_FragColor = vec4(c, vA);
        }`,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** kind: what's drifting (or none); amount 0-1. */
  set(kind: 'none' | 'snow' | 'petals' | 'leaves', amount: number): void {
    const u = this.u;
    u.uAmount.value = kind === 'none' ? 0 : amount;
    this.points.visible = kind !== 'none' && amount > 0;
    u.uKind.value = kind === 'petals' ? 1 : kind === 'leaves' ? 2 : 0;
    if (kind === 'snow') {
      u.uFall.value = 1.1;
      u.uSway.value = 0.5;
      u.uSize.value = 0.028;
    } else if (kind === 'petals') {
      u.uFall.value = 0.55;
      u.uSway.value = 1.1;
      u.uSize.value = 0.03;
    } else if (kind === 'leaves') {
      u.uFall.value = 1.0;
      u.uSway.value = 1.0;
      u.uSize.value = 0.075;
    }
  }

  /** Each frame: the camera, the ambient light, the wind (m/s) and the ground's height under the camera. */
  update(dt: number, camera: THREE.Vector3, ambient: number, wind: THREE.Vector2, ground: number): void {
    const u = this.u;
    u.uTime.value += dt;
    u.uWind.value.copy(wind);
    u.uCarry.value.addScaledVector(wind, dt);
    // Along the ground only the stronger gusts move them, in bursts.
    const s = wind.length();
    const burst = Math.max(0, s - 0.8) * (0.6 + 0.4 * Math.sin(u.uTime.value * 1.3) * Math.sin(u.uTime.value * 0.37 + 1));
    if (s > 1e-3) u.uSkid.value.addScaledVector(wind, (dt * burst) / s);
    u.uCam.value.copy(camera);
    u.uAmbient.value = ambient;
    u.uGround.value = ground;
  }
}

/**
 * Water thrown up by tyres through puddles (main.ts emits it for your car and the traffic near you): drops flung out
 * to the side and up from the wheel, carried a little with the car, falling back to the road, lit by the street
 * light (the lightmap) and the sky. A small pool of points simulated here.
 */
export class Splashes {
  readonly points: THREE.Points;
  private static readonly N = 2400;
  private readonly pos = new Float32Array(Splashes.N * 3);
  private readonly vel = new Float32Array(Splashes.N * 3);
  private readonly life = new Float32Array(Splashes.N);
  private readonly max = new Float32Array(Splashes.N);
  private readonly floor = new Float32Array(Splashes.N);
  private next = 0;
  private live = 0;
  private readonly u = { uAmbient: { value: 0.3 } };

  constructor(city: CityUniforms) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(Splashes.N), 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { ...this.u, tLight: city.tLight, uLightRect: city.uLightRect, uLightGain: city.uLightGain },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aLife;
        uniform float uAmbient;
        ${lightmapGlsl}
        varying vec3 vCol;
        varying float vA;
        void main() {
          vec4 mv = viewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          vA = aLife * smoothstep(0.3, 1.2, d) * (1.0 - smoothstep(45.0, 60.0, d));
          vCol = vec3(0.72, 0.78, 0.84) * (uAmbient + lightAt(position.xz) * 0.9);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(0.07 * 900.0 / max(d, 0.3), 12.0) * step(0.01, vA);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        varying float vA;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float r = dot(q, q);
          if (r > 0.25 || vA < 0.01) discard;
          gl_FragColor = vec4(vCol, vA * 0.85 * (1.0 - r * 3.0));
        }`,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /**
   * Water from a wheel at (x, y, z) through a puddle: the car's heading (fx, fz), the side of the car it's on (+1
   * left, -1 right), its speed (m/s), how deep the water (0-1) and the time step (s).
   */
  emit(x: number, y: number, z: number, fx: number, fz: number, side: number, speed: number, depth: number, dt: number): void {
    const s = Math.min(Math.abs(speed), 30);
    let n = depth * s * 55 * dt;
    // (A fraction left over: sometimes one more.)
    n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    const lx = fz * side;
    const lz = -fx * side;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % Splashes.N;
      const out = (1.2 + s * 0.13) * (0.4 + Math.random());
      const up = (0.8 + s * 0.12) * (0.3 + Math.random());
      const carry = Math.sign(speed) * s * (0.25 + 0.5 * Math.random());
      this.pos[i * 3] = x + lx * 0.1 + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = y + 0.05;
      this.pos[i * 3 + 2] = z + lz * 0.1 + (Math.random() - 0.5) * 0.3;
      this.vel[i * 3] = lx * out + fx * carry;
      this.vel[i * 3 + 1] = up;
      this.vel[i * 3 + 2] = lz * out + fz * carry;
      this.max[i] = this.life[i] = 0.45 + 0.5 * Math.random();
      this.floor[i] = y;
    }
    this.live = Math.max(this.live, 1);
  }

  update(dt: number, ambient: number): void {
    this.u.uAmbient.value = ambient;
    if (!this.live) return;
    const life = (this.points.geometry.getAttribute('aLife') as THREE.BufferAttribute).array as Float32Array;
    let any = 0;
    const drag = Math.exp(-1.8 * dt);
    for (let i = 0; i < Splashes.N; i++) {
      if (this.life[i] <= 0) {
        life[i] = 0;
        continue;
      }
      any++;
      this.life[i] -= dt;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < this.floor[i]) this.life[i] = 0;
      life[i] = Math.max(0, this.life[i] / this.max[i]);
    }
    this.live = any;
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('aLife').needsUpdate = true;
  }
}
