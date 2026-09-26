import * as THREE from 'three';
import type { CityUniforms } from './city';

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
    const shared = { ...this.u, tLight: city.tLight, uLightRect: city.uLightRect, uLightGain: city.uLightGain, uLamps: city.uLamps };
    // Streaks: two vertices each (top and bottom), with a random seed; uAmount picks the share that fall.
    const N = 32000;
    const seed = new Float32Array(N * 2 * 4);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let e = 0; e < 2; e++) seed.set([s[0], s[1], s[2], e === 0 ? s[3] : -1 - s[3]], (i * 2 + e) * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
    this.streaks = new THREE.LineSegments(
      g,
      new THREE.ShaderMaterial({
        uniforms: shared,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform vec3 uCam;
          uniform vec3 uBox;
          uniform float uAmount;
          uniform vec3 uOffset;
          uniform vec2 uSlant;
          uniform float uLamps;
          ${lightmapGlsl}
          ${shelterGlsl}
          varying vec3 vCol;
          varying float vA;
          void main() {
            float bottom = aSeed.w < 0.0 ? 1.0 : 0.0;
            float r = bottom > 0.5 ? -1.0 - aSeed.w : aSeed.w;
            float live = step(r, uAmount);
            // Each drop falls a little faster or slower than the rest.
            vec3 p = aSeed.xyz * uBox + uOffset * (0.85 + r * 0.3);
            p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
            // The streak runs along the fall direction; wind stretches it.
            vec3 dir = normalize(vec3(uSlant.x, -1.0, uSlant.y));
            float len = (0.5 + r * 0.35) * (1.0 + length(uSlant) * 0.5);
            vec3 top = p;
            p += dir * bottom * len;
            float dist = length(p - uCam);
            vA = live * smoothstep(1.2, 3.0, dist) * (1.0 - smoothstep(12.0, 23.0, dist)) * step(0.0, p.y);
            if (sheltered(top) || sheltered(p)) vA = 0.0;
            // Lit by the street below it (stronger low down), plus a faint sky-lit base.
            vec3 L = lightAt(p.xz) * mix(1.0, 0.35, clamp(p.y / 14.0, 0.0, 1.0));
            vCol = vec3(0.10, 0.12, 0.15) * (0.4 + 0.6 * (1.0 - uLamps)) + L * 0.55;
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
            gl_PointSize = live * step(vPhase, 0.18) * 0.06 * 900.0 / max(-mv.z, 0.5);
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

/** Lightning: occasional double flashes, more often the stronger the storm. update() returns 0-1. */
export class Lightning {
  private next = 5;
  private t = -1;
  private time = 0;

  update(dt: number, storm: number): number {
    this.time += dt;
    if (storm <= 0) return 0;
    if (this.t < 0 && this.time > this.next) {
      this.t = 0;
      this.next = this.time + 4 + Math.random() * (22 - storm * 16);
    }
    if (this.t < 0) return 0;
    this.t += dt;
    const f = this.t < 0.07 ? 1 : this.t < 0.15 ? 0.12 : this.t < 0.22 ? 0.85 : Math.max(0, 1 - (this.t - 0.22) * 3.5) * 0.45;
    if (this.t > 0.6) this.t = -1;
    return f;
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
            float a = uStrength * pow(1.0 - vH, 1.6) * smoothstep(0.0, 0.08, vH) * smoothstep(0.0, 0.7, vEdge);
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
 * size is a setting (changing it recompiles the city's shaders once); each light renders a shadow map.
 */
export class LampShadows {
  readonly group = new THREE.Group();
  private lights: THREE.SpotLight[] = [];
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
    this.lights.forEach((l, i) => {
      const h = heads[i];
      l.intensity = h ? intensity : 0;
      if (!h || !moved) return;
      l.position.set(h.x, h.y - 0.1, h.z);
      l.target.position.set(h.x, 0, h.z);
      l.target.updateMatrixWorld();
    });
  }
}
