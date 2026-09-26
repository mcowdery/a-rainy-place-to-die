import * as THREE from 'three';
import type { CityUniforms } from './city';

/**
 * Weather close to the camera, in the HDR scene (so bloom and the grade see it):
 * - rain: streaks falling in a box that wraps round the camera, lit by the street's lightmap, so rain
 *   shows where there is light (under lamps, in front of neon and shopfronts) and vanishes in the dark;
 * - splashes: small rings flicking up on the ground round you, lit the same way;
 * - lamp cones: a faint cone of light under each street lamp near you, visible when the air is wet
 *   (rain, fog) at night.
 */

const BOX = new THREE.Vector3(46, 26, 46);

const lightmapGlsl = /* glsl */ `
  uniform sampler2D tLight;
  uniform vec4 uLightRect;
  uniform float uLightGain;
  vec3 lightAt(vec2 p) { return texture2D(tLight, (p - uLightRect.xy) * uLightRect.zw).rgb * uLightGain; }
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
    uWind: { value: new THREE.Vector2(0.9, 0.35) },
  };

  constructor(city: CityUniforms) {
    const shared = { ...this.u, tLight: city.tLight, uLightRect: city.uLightRect, uLightGain: city.uLightGain, uLamps: city.uLamps };
    // Streaks: two vertices each (top and bottom), with a random seed.
    const N = 14000;
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
          uniform float uTime;
          uniform vec3 uCam;
          uniform vec3 uBox;
          uniform float uAmount;
          uniform vec2 uWind;
          uniform float uLamps;
          ${lightmapGlsl}
          varying vec3 vCol;
          varying float vA;
          void main() {
            float bottom = aSeed.w < 0.0 ? 1.0 : 0.0;
            float r = bottom > 0.5 ? -1.0 - aSeed.w : aSeed.w;
            // Only a share of the streaks fall, by the rain's strength.
            float live = step(r, uAmount);
            float speed = 11.0 + r * 4.0;
            vec3 p = aSeed.xyz * uBox;
            p.y -= uTime * speed;
            p.xz += uWind * uTime * speed * 0.08;
            p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
            // The streak runs along the fall direction; length from speed and a camera-shutter feel.
            vec3 dir = normalize(vec3(uWind.x * 0.08, -1.0, uWind.y * 0.08));
            p += dir * bottom * (0.5 + r * 0.35);
            float dist = length(p - uCam);
            vA = live * smoothstep(1.2, 3.0, dist) * (1.0 - smoothstep(12.0, 23.0, dist)) * step(0.0, p.y);
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
    // Splashes: points on the ground round the camera, each flicking up briefly on its own cycle.
    const M = 1800;
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
            float live = step(aSeed.w, uAmount);
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
            // A soft fleck of spray.
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

  /** amount: 0-1 (share of the streaks that fall). */
  update(time: number, camera: THREE.Vector3, amount: number): void {
    this.u.uTime.value = time;
    this.u.uCam.value.copy(camera);
    this.u.uAmount.value = amount;
    this.group.visible = amount > 0;
  }
}

/** A lamp head: where its light starts (world), and how warm it is. */
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
