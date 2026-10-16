import * as THREE from 'three';

/**
 * Fixture lights: the lights of a baked interior (the bake's own lights, written out by scripts/blender/rouge_xl.py
 * `--lights`), handed to the game so the lamps are real in two small ways without a single scene light (a light added,
 * removed or hidden recompiles every city shader, debug-performance.md):
 *  - a soft additive halo at each fixture (`FixtureHalos`: one Points object, so one draw), which the bloom takes up, so a
 *    lamp reads as a source and not a painted shape; fire, torches and candles flicker;
 *  - `FIXTURES`, a few uniforms the body's materials read (`streetLit.ts`): the eight nearest lights to the camera, so
 *    Mack standing by a lamp is lit by it, from its side.
 */
export interface Fixture {
  /** World position. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rgb: readonly [number, number, number];
  /** How strong (the bake's watts). */
  readonly w: number;
  readonly flicker: number;
}

const FLICKERS = /torch|fire|candle|flame|lantern|chandelier|orb/;
/** The lights the shader takes at once. */
export const FIXTURE_LIGHTS = 8;

/** The uniforms the body's materials share (zero lights unless an interior with fixtures is active). */
export const FIXTURES = {
  uFx: { value: Array.from({ length: FIXTURE_LIGHTS }, () => new THREE.Vector4()) },
  uFxCol: { value: Array.from({ length: FIXTURE_LIGHTS }, () => new THREE.Vector3()) },
  uFxCount: { value: 0 },
};

/** Parse the bake's list: [u, t, z, r, g, b, watts, name], in the building's local frame, to fixtures in the world. */
export function fixturesFrom(list: readonly (readonly (number | string)[])[], toWorld: (u: number, t: number) => [number, number], minWatts = 5): Fixture[] {
  const out: Fixture[] = [];
  for (const l of list) {
    const w = Number(l[6]);
    if (w < minWatts) continue;
    const [x, z] = toWorld(Number(l[0]), Number(l[1]));
    out.push({ x, y: Number(l[2]), z, rgb: [Number(l[3]), Number(l[4]), Number(l[5])], w, flicker: FLICKERS.test(String(l[7])) ? 1 : 0 });
  }
  return out;
}

/** Strength of a light on a body: its watts, eased (a 13 W lamp is dim, a 300 W chandelier not twenty times as bright). */
export const fixtureStrength = (w: number): number => Math.min(5, Math.pow(w, 0.62) / 3.2);

/** Hand the eight nearest to (x, y, z) to the shared uniforms (every frame while an interior with fixtures is shown). */
export function nearestFixtures(all: readonly Fixture[], x: number, y: number, z: number, time: number): void {
  const near = all
    .map((f) => ({ f, d: (f.x - x) ** 2 + ((f.y - y) * 1.5) ** 2 + (f.z - z) ** 2 }))
    .filter((e) => e.d < 400)
    .sort((a, b) => a.d - b.d)
    .slice(0, FIXTURE_LIGHTS);
  FIXTURES.uFxCount.value = near.length;
  near.forEach(({ f }, i) => {
    const fl = f.flicker ? 1 + 0.12 * Math.sin(time * 9 + f.x * 3.1 + f.z * 1.7) + 0.08 * Math.sin(time * 23 + f.z * 5.3) : 1;
    FIXTURES.uFx.value[i].set(f.x, f.y, f.z, fixtureStrength(f.w) * fl);
    FIXTURES.uFxCol.value[i].set(f.rgb[0], f.rgb[1], f.rgb[2]);
  });
}

export function noFixtures(): void {
  FIXTURES.uFxCount.value = 0;
}

const HALO_VERT = /* glsl */ `
  attribute vec4 aLight; // rgb, flicker
  attribute float aSize;
  uniform float uTime;
  uniform float uScale;
  varying vec3 vCol;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float fl = aLight.w > 0.5 ? 1.0 + 0.16 * sin(uTime * 9.0 + position.x * 3.1 + position.z * 1.7) + 0.1 * sin(uTime * 23.0 + position.z * 5.3) : 1.0;
    vCol = aLight.rgb * fl;
    gl_Position = projectionMatrix * mv;
    // (Capped, and faded up close: a halo seen from beside its lamp is a hint of glow, not a white sheet.)
    gl_PointSize = min(aSize * uScale * fl / max(-mv.z, 0.4), 160.0);
    vCol *= smoothstep(0.3, 2.5, -mv.z);
  }
`;
const HALO_FRAG = /* glsl */ `
  varying vec3 vCol;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    // A hot small core and a long soft skirt.
    float a = exp(-r2 * 7.0) * 0.95 + exp(-r2 * 1.8) * 0.18;
    gl_FragColor = vec4(vCol * a, a);
  }
`;

/** One additive Points object with a halo at each fixture. `scale` converts a halo's metres to pixels (the viewport's height over the lens's tangent). */
export class FixtureHalos {
  readonly object: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  constructor(fixtures: readonly Fixture[]) {
    const n = fixtures.length;
    const pos = new Float32Array(n * 3);
    const light = new Float32Array(n * 4);
    const size = new Float32Array(n);
    fixtures.forEach((f, i) => {
      pos.set([f.x, f.y, f.z], i * 3);
      // Dim: the halo is a hint of glow round the source, not a flare (the rooms are dimly lit).
      const k = Math.min(0.6, 0.2 + f.w / 400) * 0.5;
      light.set([f.rgb[0] * k, f.rgb[1] * k, f.rgb[2] * k, f.flicker], i * 4);
      size[i] = 0.5 + Math.min(1.6, Math.sqrt(f.w) / 8);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aLight', new THREE.BufferAttribute(light, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 700 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object = new THREE.Points(g, this.mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;
  }
  update(time: number, fovDeg: number, viewportH: number): void {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uScale.value = viewportH / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }
}
