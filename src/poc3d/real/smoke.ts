import * as THREE from 'three';
import { STICKS } from '../models/cigarette';
import { BONES } from './mobRig';
import { FIGURE_ATTRS, FIGURE_STRIDE, JOINT_EXTRA, MOB_PLACE_GLSL, MOB_POSE_GLSL, SMOKE_OUT, SMOKE_ROUND } from './people';

/**
 * Tobacco smoke: the street crowd's smokers (the city is late-Showa Japan, where most men smoked), and Mack's.
 *
 * What's drawn for a smoker, all in one draw for everyone in range (`CrowdSmoke`, on the crowd's own figure numbers,
 * as their emotes are: real/emotes.ts): the cigarette or cigar itself in the fingers, a small solid thing; its ember,
 * which glows up on each drag; the thin thread of smoke off its tip; and the breath of smoke let out after a drag.
 * Where the hand and the mouth are comes from the mob's own posing (people.ts MOB_POSE_GLSL), so they agree with the
 * figure to the millimetre.
 *
 * It's meant to read as smoke and not as breath in the cold (real/emotes.ts), which is a small white puff at the
 * mouth with every breath, gone in a second:
 *  - The thread off the tip never stops. It leaves blue-grey (fine smoke scatters blue), rises straight and
 *    hair-thin for a hand's breadth, then wavers, curls and spreads as it thins, leaning with the wind, a metre or
 *    two up before it's gone. Each bit of it stays where it was let go: the thread is the path the tip has moved
 *    along (up to the mouth and back, or trailing behind someone walking), not a shape stuck to the hand.
 *  - What's breathed out is paler and greyer (it's been through the lungs), comes once after each drag as a
 *    stream out from the mouth that slows, billows, hangs and drifts off over three or four seconds.
 *  - And there's fire in it: the ember, which you see across a street at night.
 */

export { STICKS } from '../models/cigarette';
/** How long a bit of the thread off the tip lasts (s), and a breath of smoke. */
export const WISP_LIFE = 2.8;
export const PUFF_LIFE = 3.4;
/** How far off the smoke is drawn (m); the ember shows further. */
export const SMOKE_REACH = 48;
export const EMBER_REACH = 90;
const WISP_SEGS = 26;
const PUFFS = 10;
const SIDES = 6;

/**
 * GLSL: how a bit of smoke moves once it's let go, shared by everything that draws smoke. `age` seconds after it
 * left its source at time `born`: risen (buoyant: quick, then slowing as it cools and thins), carried off by the
 * wind once it's clear of the hand, and wandering wider the older it is. The wander belongs to the bit of smoke (by
 * when it left), so curls rise with the smoke instead of standing in the air. Needs uWind (m/s, world x and z).
 */
export const SMOKE_GLSL = /* glsl */ `
      uniform vec2 uWind;
      // (uStir: how fast its source is moving through the air, m/s: its wake breaks the smoke up sooner.)
      float smokeStir;
      vec3 smokeDrift(float age, float born, float seed) {
        float wl = length(uWind) + smokeStir;
        float rise = (0.34 * age + 0.07 * age * age) / (1.0 + 0.35 * length(uWind));
        float carry = age - (1.0 - exp(-2.2 * age)) / 2.2;
        vec2 blown = uWind * carry * 0.8;
        // (Still for the first hand's breadth, then a slow waver that widens; a breeze shreds it sooner.)
        float amp = smoothstep(0.25, 1.3, age) * 0.045 * age * sqrt(age) * (1.0 + 0.8 * wl);
        float ph = born * 2.1 + seed * 40.0;
        vec3 curl = vec3(sin(ph) + 0.45 * sin(ph * 2.3 + age * 1.1 + 1.7), 0.3 * sin(ph * 1.7 + 0.5), cos(ph * 0.9 + 2.1) + 0.45 * sin(ph * 2.7 + age * 0.8));
        return vec3(blown.x, rise, blown.y) + amp * curl;
      }
      // How wide the thread off a tip is at that age (m), from a width of w0 where it leaves; and how much of it is left.
      float wispWidth(float age, float w0) { return w0 + (0.012 + 0.05 * smokeStir) * age + 0.02 * age * age; }
      float wispAlpha(float age, float w0) {
        // (Spread over more width, there's less of it at any one place.)
        float thin = pow(w0 / wispWidth(age, w0), 0.62);
        return smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.45 * ${WISP_LIFE.toFixed(2)}, ${WISP_LIFE.toFixed(2)}, age * (1.0 + 0.7 * smokeStir))) * thin / (1.0 + 0.5 * (length(uWind) + smokeStir));
      }
`;

/** GLSL (fragment): smoke's own shapes. Needs tSmoke (smokeNoise). */
export const SMOKE_FRAG_GLSL = /* glsl */ `
      uniform sampler2D tSmoke;
      // A thread: soft across (x 0-1); even where it leaves the tip, torn into strands and gaps as it ages (y: when
      // that bit of it left, so the pattern rises with the smoke).
      float wispShape(vec2 uv, float age) {
        // (Held to 0-1: an edge sample can fall just outside, and pow of a negative is not a number.)
        float x = clamp(1.0 - abs(uv.x * 2.0 - 1.0), 0.0, 1.0);
        float n = texture2D(tSmoke, vec2(uv.x * 0.4 + 0.1, uv.y * 1.3)).r;
        float m = texture2D(tSmoke, vec2(uv.x * 0.9 + 0.6, uv.y * 3.1)).r;
        float torn = smoothstep(0.3, 0.7, n) * (0.35 + 1.3 * m);
        return pow(x, 1.4) * mix(1.0, 1.7 * torn, smoothstep(0.2, 1.3, age));
      }
      // A puff: round and soft, eaten into by the noise so no two are the same shape.
      float puffShape(vec2 uv, float seed) {
        float d = length(uv - 0.5) * 2.0;
        float n = texture2D(tSmoke, uv * 0.55 + vec2(seed * 7.3, seed * 3.1)).r;
        float n2 = texture2D(tSmoke, uv * 1.3 + vec2(seed * 1.7, seed * 9.2)).r;
        return (1.0 - smoothstep(0.0, 1.0, d + 0.5 * (n - 0.5))) * (0.5 + 0.7 * n2);
      }
`;

let noise: THREE.DataTexture | null = null;
/** A small tiling noise for smoke's shapes (soft, cloudy; made once, without a canvas). */
export function smokeNoise(): THREE.DataTexture {
  if (noise) return noise;
  const N = 64;
  const rnd = (x: number, y: number, s: number): number => {
    const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  // Value noise on a lattice of `cells` that wraps, summed over octaves.
  const layer = (u: number, v: number, cells: number, s: number): number => {
    const x = u * cells, y = v * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number): number => rnd(((x0 + i) % cells + cells) % cells, ((y0 + j) % cells + cells) % cells, s);
    return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy;
  };
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      const n = 0.5 * layer(u, v, 4, 1) + 0.27 * layer(u, v, 8, 2) + 0.15 * layer(u, v, 16, 3) + 0.08 * layer(u, v, 32, 4);
      const c = Math.max(0, Math.min(255, Math.round(n * 255)));
      data.set([c, c, c, 255], (j * N + i) * 4);
    }
  }
  noise = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.needsUpdate = true;
  return noise;
}

/** Smoke's blending: over what's behind it, the scene's alpha left as it is (water marks its pixels there: real/ssr.ts). */
export const SMOKE_BLEND = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

/** What a smoker is made of: the stick, the ember's glow, the thread off the tip, the breaths of smoke. */
const STICK = 0, EMBER = 1, WISP = 2, PUFF = 3;

/** One smoker's geometry (every smoker is an instance of it): position, and aPart = [which part, its number, two more]. */
function smokerGeometry(): { position: Float32Array; part: Float32Array; index: number[] } {
  const pos: number[] = [];
  const part: number[] = [];
  const index: number[] = [];
  const vert = (p: readonly [number, number, number], q: readonly [number, number, number, number]): number => {
    pos.push(...p);
    part.push(...q);
    return pos.length / 3 - 1;
  };
  // The stick: four stretches along it (their ends are set per kind in the shader: a cigarette's filter, nothing,
  // its paper, its ash; a cigar's foot, its band, its body, its ash), six-sided, and the lit end's cap.
  // position: [corner, stretch, which end of it]; aPart: [STICK, stretch, the corner's angle, 0].
  for (let seg = 0; seg < 4; seg++) {
    const ring = [0, 1].map((end) => Array.from({ length: SIDES }, (_, c) => vert([c, seg, end], [STICK, seg, (c / SIDES) * Math.PI * 2, 0])));
    for (let c = 0; c < SIDES; c++) {
      const d = (c + 1) % SIDES;
      index.push(ring[0][c], ring[0][d], ring[1][d], ring[0][c], ring[1][d], ring[1][c]);
    }
  }
  const cap = Array.from({ length: SIDES }, (_, c) => vert([c, 3, 1], [STICK, 4, (c / SIDES) * Math.PI * 2, 0]));
  for (let c = 1; c + 1 < SIDES; c++) index.push(cap[0], cap[c], cap[c + 1]);
  const quad = (kind: number, n: number): void => {
    const v = ([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const).map(([x, y]) => vert([x, y, 0], [kind, n, 0, 0]));
    index.push(v[0], v[1], v[2], v[0], v[2], v[3]);
  };
  // The thread, before the ember so the glow sits over its start: a strip, two vertices a step.
  let last: [number, number] | null = null;
  for (let i = 0; i <= WISP_SEGS; i++) {
    const a = vert([-1, i / WISP_SEGS, 0], [WISP, i, 0, 0]);
    const b = vert([1, i / WISP_SEGS, 0], [WISP, i, 0, 0]);
    if (last) index.push(last[0], last[1], b, last[0], b, a);
    last = [a, b];
  }
  for (let j = 0; j < PUFFS; j++) quad(PUFF, j);
  quad(EMBER, 0);
  return { position: new Float32Array(pos), part: new Float32Array(part), index };
}

/** The mob material's uniforms this runs on (shared objects: one clock, one set of joints, one street light). */
const SHARED = ['uTime', 'uStay', 'uHour', 'uRain', 'uSeason', 'uUmbrella', 'uStill', 'uSmoking', 'tJoints', 'uHemiSky', 'tLight', 'uLightRect', 'uLightFade', 'uLightGain'] as const;

const f = (v: number): string => v.toFixed(4);

/** The street crowd's smokers: their cigarettes and cigars, the embers and the smoke, in one instanced draw. */
export class CrowdSmoke {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private cap = 0;
  /** How many smokers it's drawing. */
  count = 0;

  /** `mob`: the mob's material (people.ts ghostMaterial), whose clock, joints and settings this follows. */
  constructor(mob: THREE.ShaderMaterial) {
    const joints = mob.uniforms.tJoints.value as THREE.DataTexture;
    const shared: Record<string, THREE.IUniform> = {};
    const own: Record<(typeof SHARED)[number], unknown> = { uTime: 0, uStay: 0, uHour: 12, uRain: 0, uSeason: 0, uUmbrella: 0, uStill: 0, uSmoking: 1, tJoints: joints, uHemiSky: new THREE.Color(1, 1, 1), tLight: null, uLightRect: new THREE.Vector4(0, 0, 1, 1), uLightFade: new THREE.Vector2(0, 0), uLightGain: 0 };
    for (const name of SHARED) shared[name] = mob.uniforms[name] ?? { value: own[name] };
    const C = STICKS.cigarette, G = STICKS.cigar;
    const out0 = SMOKE_OUT;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        tSmoke: { value: smokeNoise() },
        uWind: { value: new THREE.Vector2() },
      },
      fog: true,
      ...SMOKE_BLEND,
      // (The thread's strip turns either way to the viewer.)
      side: THREE.DoubleSide,
      forceSinglePass: true,
      vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform float uStay;
      uniform float uHour;
      uniform float uRain;
      uniform float uSeason;
      uniform float uUmbrella;
      uniform float uStill;
      uniform float uSmoking;
      uniform sampler2D tJoints;
      uniform vec3 uHemiSky;
      uniform sampler2D tLight;
      uniform vec4 uLightRect;
      uniform vec2 uLightFade;
      uniform float uLightGain;
      attribute vec4 aPart;
      attribute vec4 aFig;
      attribute vec4 aPose;
      attribute vec4 aWalk;
      attribute vec3 aGround;
      attribute vec4 aWhen;
      // rgb and how much of it; uv, which part, a seed.
      varying vec4 vColor;
      varying vec4 vUv;
      float jointRow;
      vec3 pv(int i) { return texture2D(tJoints, vec2((float(i) + 0.5) / ${joints.image.width}.0, (jointRow + 0.5) / ${joints.image.height}.0)).xyz; }
      ${MOB_PLACE_GLSL}
      ${MOB_POSE_GLSL}
      ${SMOKE_GLSL}

      float sm;
      MobPlace place;
      vec2 org;
      // A point of the figure's frame in the world, with the figure where it was 'ago' seconds back along its walk.
      vec2 walked;
      vec3 inWorld(vec3 p, float ago) {
        float a = aFig.z + place.turn;
        float fx = sin(a), fz = cos(a);
        vec2 o = org - walked * ago;
        return (modelMatrix * vec4(o.x + fz * p.x + fx * p.z, place.ground + p.y, o.y - fx * p.x + fz * p.z, 1.0)).xyz;
      }
      // Where the fingers hold it, with the hand that far up (the figure's frame).
      vec3 gripAt(float up) {
        Limb l = mixL(smokeLow, smokeHigh, up);
        if (smokeHand > 0.0) armR = l;
        else armL = l;
        mat3 M;
        vec3 T;
        bone(smokeHand > 0.0 ? 10 : 8, M, T);
        vec3 g = pw(${JOINT_EXTRA.grip}).xyz;
        g.x *= smokeHand;
        return M * g + T;
      }
      vec3 mouthF;
      vec3 faceF;
      // Which way it points from its mouth end: out past the fingers, forward and a little up with the hand down;
      // out of the mouth through the fingers with the hand up.
      vec3 stickDir(vec3 g, float up) {
        vec3 low = normalize(vec3(0.5 * smokeHand, 0.1, 0.85));
        vec3 high = normalize(g - mouthF);
        return normalize(mix(low, high, smoothstep(0.5, 1.0, up)));
      }
      float stickLen() { return sm > 1.5 ? ${f(G.len)} : ${f(C.len)}; }
      float stickGrip() { return sm > 1.5 ? ${f(G.grip)} : ${f(C.grip)}; }
      // The lit end, 'ago' seconds back (the figure's frame).
      vec3 tipAt(float ago) {
        float c = smokeAt - ago;
        if (c < 0.0) c += smokeEvery;
        float up = smokeLift(c);
        vec3 g = gripAt(up);
        return g + stickDir(g, up) * (stickLen() - stickGrip());
      }
      // The street's light on something small in the air: the sky's, and at night the lamps' (the lightmap).
      vec3 lightAt(vec3 wp) {
        vec3 lamp = texture2D(tLight, (wp.xz - uLightRect.xy) * uLightRect.zw).rgb * uLightGain;
        if (uLightFade.y > 0.0) {
          vec2 dc = abs(wp.xz - cameraPosition.xz);
          lamp *= 1.0 - smoothstep(uLightFade.x, uLightFade.y, max(dc.x, dc.y));
        }
        return uHemiSky + lamp * 1.6;
      }

      void main() {
        // (Nothing to show: every corner at one point outside the view.)
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vColor = vec4(0.0);
        vUv = vec4(0.0);
        float t = uTime;
        int body = int(aPose.x + 0.5);
        jointRow = float(body);
        base = body * ${BONES};
        armOut = pv(${BONES}).x;
        float side = sign(aPose.z);
        float carry = floor(abs(aPose.z) + 0.5);
        sm = floor((carry - 1.0) / 8.0 + 0.01);
        if (sm < 0.5) return;
        carry -= sm * 8.0;
        bool straps = carry > 4.5;
        if (straps) carry -= 4.0;
        bool umb = carry > 2.5 && uUmbrella > 0.5;
        bool bag = carry - (carry > 2.5 ? 2.0 : 0.0) > 1.5;
        float seed = aFig.w;
        float r = fract(sin(dot(aFig.xy, vec2(12.9898, 78.233))) * 43758.5453);
        place = mobPlace(t, body, seed);
        if (place.fade < 0.02) return;
        int manner = int(aWhen.y + 0.5);
        org = place.org;
        // (As the mob's shader: a drunk weaves along.)
        if (manner == 2 && place.moving) org += normalize(vec2(aWalk.y, -aWalk.x) + 1e-5) * 0.32 * sin(t * 0.8 + r * 9.0);
        int P = int(aPose.y + 0.5);
        if (place.crosser && !place.moving) P = 0;
        if (P == 1 && !place.moving && seed >= 0.0) P = 0;
        mobPose(t, body, r, P, place.moving, place.phase, side, bag, umb, straps, manner, sm);
        if (smokeHand == 0.0) return;
        // (How fast it's walking, and which way: smoke stays where it was let go.)
        walked = place.moving ? normalize(aWalk.xy + 1e-5) * aWalk.z * cos(place.turn) : vec2(0.0);
        smokeStir = length(walked);

        mat3 HM;
        vec3 HT;
        bone(2, HM, HT);
        vec4 mouth = pw(${JOINT_EXTRA.mouth});
        mouthF = HM * mouth.xyz + HT;
        faceF = HM * vec3(0.0, 0.0, 1.0);
        float H = mouth.w;
        vec3 headW = inWorld(mouthF, 0.0);
        float d = distance(headW, cameraPosition);
        // Gone as you walk into someone, as they are; and with distance.
        float nearK = seed < -1.5 ? 1.0 : smoothstep(0.5, 1.2, d);
        float farK = 1.0 - smoothstep(0.7 * ${f(SMOKE_REACH)}, ${f(SMOKE_REACH)}, d);
        float there = place.fade * nearK;
        bool cigar = sm > 1.5;
        int kind = int(aPart.x + 0.5);
        // How hard it's being drawn on (the ember flares, and stays hot a moment after).
        float drag = smoothstep(${f(SMOKE_ROUND.rise - 0.15)}, ${f(SMOKE_ROUND.rise + 0.35)}, smokeAt) * (1.0 - smoothstep(${f(SMOKE_ROUND.rise + SMOKE_ROUND.drag - 0.2)}, ${f(SMOKE_ROUND.rise + SMOKE_ROUND.drag + 0.9)}, smokeAt));
        // (An ember hardly shows in daylight.)
        float dark = 1.0 - 0.75 * smoothstep(0.25, 1.6, dot(uHemiSky, vec3(0.3, 0.6, 0.1)));
        vec3 ember = vec3(3.2, 0.95, 0.16) * (0.4 + 1.5 * drag) * dark;
        vec4 mvPosition;

        if (kind == ${STICK}) {
          if (d > 30.0) return;
          vec3 g = gripAt(smokeUp);
          vec3 dir = stickDir(g, smokeUp);
          vec3 foot = g - dir * stickGrip();
          int seg = int(position.y + 0.5);
          // (The ends of its four stretches, by kind: a cigarette's filter, nothing, its paper, its ash.)
          float s0 = seg == 0 ? 0.0 : seg == 1 ? (cigar ? 0.2 : 0.27) : seg == 2 ? 0.27 : (cigar ? 0.86 : 0.9);
          float s1 = seg == 0 ? (cigar ? 0.2 : 0.27) : seg == 1 ? 0.27 : seg == 2 ? (cigar ? 0.86 : 0.9) : 1.0;
          float s = position.z < 0.5 ? s0 : s1;
          vec3 u = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
          vec3 v = cross(u, dir);
          float ang = aPart.z;
          vec3 nrm = u * cos(ang) + v * sin(ang);
          int zone = int(aPart.y + 0.5);
          // (A cigar is fatter in the middle; the ash a little thinner than what's burning.)
          float rad = (cigar ? ${f(G.r)} * (0.82 + 0.18 * sin(s * 3.14159)) : ${f(C.r)}) * (zone >= 3 ? 0.92 : 1.0);
          vec3 wp = inWorld(foot + dir * (s * stickLen()) + nrm * rad, 0.0);
          vec3 wn = normalize(inWorld(foot + nrm, 0.0) - inWorld(foot, 0.0));
          vec3 col = zone == 0 ? (cigar ? vec3(0.2, 0.11, 0.055) : vec3(0.62, 0.43, 0.25))
            : zone == 1 ? vec3(0.5, 0.09, 0.06)
            : zone == 2 ? (cigar ? vec3(0.22, 0.12, 0.06) : vec3(0.8, 0.78, 0.74))
            : zone == 3 ? (cigar ? vec3(0.46, 0.46, 0.45) : vec3(0.34, 0.33, 0.33)) : vec3(0.0);
          vec3 lit = col * lightAt(wp) * (0.32 + 0.14 * wn.y);
          // (The ash is hot where it meets what's burning; the cap is the ember itself.)
          if (zone == 3) lit += ember * 0.25 * (1.0 - (s - s0) / max(s1 - s0, 1e-4));
          if (zone == 4) lit = ember;
          vColor = vec4(lit, there);
          vUv = vec4(0.0, 0.0, ${STICK}.0, 0.0);
          mvPosition = viewMatrix * vec4(wp, 1.0);
        } else if (kind == ${EMBER}) {
          float seen = 1.0 - smoothstep(0.7 * ${f(EMBER_REACH)}, ${f(EMBER_REACH)}, d);
          if (seen <= 0.0) return;
          vec3 wp = inWorld(tipAt(0.0), 0.0);
          mvPosition = viewMatrix * vec4(wp, 1.0);
          // A glow round the lit end: small, and never smaller than a pixel or so across a street.
          float size = max((cigar ? 0.05 : 0.034) * (0.75 + 0.6 * drag), 0.0028 * -mvPosition.z);
          mvPosition.xy += position.xy * size;
          vColor = vec4(ember, there * seen * (0.45 + 0.5 * drag));
          vUv = vec4(position.xy + 0.5, ${EMBER}.0, 0.0);
        } else if (kind == ${WISP}) {
          if (farK <= 0.0) return;
          float k = aPart.y / ${WISP_SEGS}.0;
          // (Someone walking leaves it behind in their wake: shorter, wider, sooner gone.)
          float age = ${f(WISP_LIFE)} / (1.0 + 0.7 * smokeStir) * pow(k, 1.25);
          float dA = 0.02 + 0.03 * age;
          vec3 p0 = inWorld(tipAt(age), age) + smokeDrift(age, t - age, r);
          vec3 p1 = inWorld(tipAt(age + dA), age + dA) + smokeDrift(age + dA, t - age - dA, r);
          vec4 v0 = viewMatrix * vec4(p0, 1.0);
          vec4 v1 = viewMatrix * vec4(p1, 1.0);
          vec2 along = v1.xy - v0.xy;
          vec2 across = normalize(vec2(-along.y, along.x) + 1e-6);
          float w0 = cigar ? 0.011 : 0.0045;
          float wide = wispWidth(age, w0);
          // (Thinner than a pixel, it's drawn a pixel wide and that much fainter.)
          float px = 0.0011 * -v0.z;
          float drawn = max(wide, px);
          mvPosition = v0;
          mvPosition.xy += across * position.x * drawn * 0.5;
          // (Where the tip was moving, the same smoke is spread along more of its path: fainter.)
          float sped = length(inWorld(tipAt(age), age) - inWorld(tipAt(age + dA), age + dA)) / dA;
          float a = wispAlpha(age, w0) * (cigar ? 0.75 : 0.62) * (wide / drawn) / (1.0 + 1.2 * max(sped - smokeStir, 0.0));
          // Off the tip it's blue; older, greyer.
          vec3 tint = mix(vec3(0.6, 0.7, 0.95), vec3(0.74, 0.77, 0.86), smoothstep(0.3, 2.0, age));
          vColor = vec4(tint * min(lightAt(p0) * 0.9 + 0.03, vec3(1.6)), a * there * farK);
          vUv = vec4(position.x * 0.5 + 0.5, (t - age) * 0.9 + r * 7.0, ${WISP}.0, age);
        } else {
          if (farK <= 0.0) return;
          // A breath of smoke: several puffs let out one after another, each from the mouth as it was then.
          float j = aPart.y;
          float hj = hh1(j, r + floor((t + r * 97.0) / smokeEvery) * 0.37);
          float born = ${f(out0)} + (j + 0.6 * hj) / ${PUFFS}.0 * ${f(SMOKE_ROUND.out)};
          float age = smokeAt - born;
          if (age < 0.0) age += smokeEvery;
          if (age >= ${f(PUFF_LIFE)}) return;
          // Out of the mouth and a little down, in a narrow cone; fast at first, then it only drifts.
          float hk = hh1(j + 11.0, r);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), faceF));
          vec3 way = normalize(faceF + vec3(0.0, -0.16, 0.0) + right * (hj - 0.5) * 0.3 + vec3(0.0, (hk - 0.5) * 0.22, 0.0));
          float reach = (cigar ? 0.62 : 0.5) * (0.75 + 0.5 * hk) * (1.0 - exp(-2.6 * age));
          vec3 wp = inWorld(mouthF + faceF * (0.04 * H) + way * reach, age) + smokeDrift(age * 0.8, t - born, r + j * 0.13) * vec3(1.0, 0.75, 1.0);
          mvPosition = viewMatrix * vec4(wp, 1.0);
          float size = (0.07 + (cigar ? 0.62 : 0.52) * (1.0 - exp(-0.9 * age))) * (0.8 + 0.4 * hj);
          float rot = hj * 6.2832 + 0.25 * age * (hk - 0.5);
          float cr = cos(rot), sr = sin(rot);
          vec2 corner = position.xy * size;
          mvPosition.xy += vec2(cr * corner.x - sr * corner.y, sr * corner.x + cr * corner.y);
          float a = (cigar ? 0.23 : 0.18) * smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.3 * ${f(PUFF_LIFE)}, ${f(PUFF_LIFE)}, age)) / (1.0 + 0.9 * age) / (1.0 + 0.4 * length(uWind));
          vColor = vec4(vec3(0.8, 0.81, 0.84) * min(lightAt(wp) * 0.9 + 0.03, vec3(1.7)), a * there * farK);
          vUv = vec4(position.xy + 0.5, ${PUFF}.0, hj + j * 0.31);
        }
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying vec4 vColor;
      varying vec4 vUv;
      ${SMOKE_FRAG_GLSL}
      void main() {
        float a = vColor.a;
        vec3 c = vColor.rgb;
        if (vUv.z < 0.5) {
          // (The stick: solid.)
        } else if (vUv.z < 1.5) {
          float d = length(vUv.xy - 0.5) * 2.0;
          a *= exp(-d * d * 7.0) + 0.22 * (1.0 - smoothstep(0.0, 1.0, d));
        } else if (vUv.z < 2.5) a *= wispShape(vUv.xy, vUv.w);
        else a *= puffShape(vUv.xy, vUv.w);
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
        #include <fog_fragment>
      }`,
    });
    const base = smokerGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(base.position, 3));
    this.geo.setAttribute('aPart', new THREE.BufferAttribute(base.part, 4));
    this.geo.setIndex(base.index);
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.name = 'crowd.smoke';
    // The figures are everywhere in range (the vertex shader places them): never culled as one box.
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** The wind (m/s, world x and z: main.ts windVec). */
  set wind(w: THREE.Vector2) {
    (this.material.uniforms.uWind.value as THREE.Vector2).copy(w);
  }

  /** The figures to draw it for: arrays of figures' numbers (FIGURE_STRIDE each); those who smoke are picked out. */
  fill(chunks: Iterable<Float32Array>): void {
    const all = [...chunks];
    const smokes = (f: Float32Array, k: number): boolean => Math.round(Math.abs(f[k + 7])) - 1 >= 8;
    let count = 0;
    for (const f of all) for (let k = 0; k < f.length; k += FIGURE_STRIDE) if (smokes(f, k)) count++;
    this.count = count;
    this.geo.instanceCount = count;
    this.mesh.visible = count > 0;
    if (count === 0) return;
    if (count > this.cap) {
      this.cap = Math.max(32, Math.ceil(count * 1.5));
      this.attrs = FIGURE_ATTRS.map((spec) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * spec.at.length), spec.at.length);
        a.setUsage(THREE.DynamicDrawUsage);
        this.geo.setAttribute(spec.name, a);
        return a;
      });
    }
    let i = 0;
    for (const f of all) {
      for (let k = 0; k < f.length; k += FIGURE_STRIDE) {
        if (!smokes(f, k)) continue;
        FIGURE_ATTRS.forEach((spec, j) => {
          const arr = this.attrs[j].array as Float32Array;
          const m = spec.at.length;
          for (let c = 0; c < m; c++) arr[i * m + c] = f[k + spec.at[c]];
        });
        i++;
      }
    }
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

// ---- One smoker moved by the game (Mack) ----

/** What a smoker moved by the game says of itself each frame (models/smoking.ts SmokeOut). */
export interface SmokeSource {
  readonly lit: boolean;
  readonly kind: keyof typeof STICKS;
  readonly tip: THREE.Vector3;
  readonly heat: number;
  readonly mouth: THREE.Vector3;
  readonly way: THREE.Vector3;
  readonly breath: number;
  readonly flame: number;
  readonly flameAt: THREE.Vector3;
}

const TRAIL = 48;
const TRAIL_STEP = WISP_LIFE / (TRAIL - 2);
const BREATHS = 18;
const GONE = -1e6;
const FLAME = 4;

/**
 * The smoke of one smoker the game moves (Mack: models/smoking.ts): the same thread, breath and ember as the
 * crowd's, but from where his cigarette's end and his mouth really were. The thread is the path the lit end has
 * taken over the last few seconds (a sample every few hundredths of a second, each bit drifting on from where it
 * was let go), so it follows his hand up to his mouth, trails behind him as he walks, and stays behind where he
 * flicked the stub. Also the lighter's flame. One draw.
 */
export class MackSmoke {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly emit: THREE.BufferAttribute;
  private readonly next: THREE.BufferAttribute;
  private readonly sped: THREE.BufferAttribute;
  private readonly speeds = new Float32Array(TRAIL);
  /** The thread's samples, newest first: where the lit end was (x, y, z) and when. */
  private readonly trail = new Float32Array(TRAIL * 4).fill(GONE);
  private readonly puffs = new Float32Array(BREATHS * 8).fill(GONE);
  private puff = 0;
  private now = 0;
  private since = 0;
  private sincePuff = 0;
  private readonly was = new THREE.Vector3();
  private moved = false;
  private stir = 0;
  private readonly wispAt: number;
  private readonly puffAt: number;
  private readonly emberAt: number;
  private readonly flameAt: number;

  /** `mob`: the mob's material, for the street's light on the smoke (its sky and lamp uniforms); null: an even light. */
  constructor(mob: THREE.ShaderMaterial | null = null) {
    const LIGHT = ['uHemiSky', 'tLight', 'uLightRect', 'uLightFade', 'uLightGain'] as const;
    const own: Record<(typeof LIGHT)[number], unknown> = { uHemiSky: new THREE.Color(1.6, 1.6, 1.6), tLight: null, uLightRect: new THREE.Vector4(0, 0, 1, 1), uLightFade: new THREE.Vector2(0, 0), uLightGain: 0 };
    const shared: Record<string, THREE.IUniform> = {};
    for (const name of LIGHT) shared[name] = mob?.uniforms[name] ?? { value: own[name] };
    // The geometry: the thread's strip, the breaths' quads, the ember's and the flame's.
    const pos: number[] = [];
    const part: number[] = [];
    const index: number[] = [];
    this.wispAt = 0;
    for (let i = 0; i < TRAIL; i++) {
      pos.push(-1, 0, 0, 1, 0, 0);
      part.push(WISP, i, WISP, i);
      if (i > 0) index.push(2 * i - 2, 2 * i - 1, 2 * i + 1, 2 * i - 2, 2 * i + 1, 2 * i);
    }
    const quad = (kind: number, n: number): number => {
      const v = pos.length / 3;
      for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        pos.push(x, y, 0);
        part.push(kind, n);
      }
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
      return v;
    };
    this.puffAt = pos.length / 3;
    for (let j = 0; j < BREATHS; j++) quad(PUFF, j);
    this.emberAt = quad(EMBER, 0);
    this.flameAt = quad(FLAME, 0);
    const count = pos.length / 3;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(part), 2));
    this.emit = new THREE.BufferAttribute(new Float32Array(count * 4).fill(GONE), 4);
    this.next = new THREE.BufferAttribute(new Float32Array(count * 4).fill(GONE), 4);
    this.emit.setUsage(THREE.DynamicDrawUsage);
    this.next.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aEmit', this.emit);
    geo.setAttribute('aNext', this.next);
    this.sped = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.sped.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSped', this.sped);
    geo.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        tSmoke: { value: smokeNoise() },
        uWind: { value: new THREE.Vector2() },
        uNow: { value: 0 },
        uStir: { value: 0 },
        uCigar: { value: 0 },
      },
      fog: true,
      ...SMOKE_BLEND,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uNow;
      uniform float uStir;
      uniform float uCigar;
      uniform vec3 uHemiSky;
      uniform sampler2D tLight;
      uniform vec4 uLightRect;
      uniform vec2 uLightFade;
      uniform float uLightGain;
      attribute vec2 aPart;
      // Where it was let go and when; the thread's next sample (or a breath's way and its seed; an ember's heat).
      attribute vec4 aEmit;
      attribute vec4 aNext;
      // (The thread: how fast the lit end was moving when that bit left, m/s.)
      attribute float aSped;
      varying vec4 vColor;
      varying vec4 vUv;
      ${SMOKE_GLSL}
      float hh1(float k, float r) { return fract(sin(k * 12.9898 + r * 78.233) * 43758.5453); }
      vec3 lightAt(vec3 wp) {
        vec3 lamp = texture2D(tLight, (wp.xz - uLightRect.xy) * uLightRect.zw).rgb * uLightGain;
        if (uLightFade.y > 0.0) {
          vec2 dc = abs(wp.xz - cameraPosition.xz);
          lamp *= 1.0 - smoothstep(uLightFade.x, uLightFade.y, max(dc.x, dc.y));
        }
        return uHemiSky + lamp * 1.6;
      }
      void main() {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vColor = vec4(0.0);
        vUv = vec4(0.0);
        if (aEmit.w < -1e5) return;
        smokeStir = uStir;
        bool cigar = uCigar > 0.5;
        int kind = int(aPart.x + 0.5);
        float dark = 1.0 - 0.75 * smoothstep(0.25, 1.6, dot(uHemiSky, vec3(0.3, 0.6, 0.1)));
        vec4 mvPosition;
        if (kind == ${WISP}) {
          float age = uNow - aEmit.w;
          vec3 p0 = aEmit.xyz + smokeDrift(age, aEmit.w, 0.37);
          // (The last sample has none after it: it runs on a little the way it rose.)
          vec3 p1 = aNext.w < -1e5 ? p0 + vec3(0.0, 0.02, 0.0) : aNext.xyz + smokeDrift(uNow - aNext.w, aNext.w, 0.37);
          vec4 v0 = viewMatrix * vec4(p0, 1.0);
          vec4 v1 = viewMatrix * vec4(p1, 1.0);
          vec2 along = v1.xy - v0.xy;
          vec2 across = normalize(vec2(-along.y, along.x) + 1e-6);
          float w0 = cigar ? 0.011 : 0.0045;
          float wide = wispWidth(age, w0);
          float px = 0.0011 * -v0.z;
          // (Right under his eyes it's out of focus: drawn wide and faint there, never a hard line up the view.)
          float drawn = max(max(wide, px), 0.05 * (1.0 - smoothstep(0.15, 0.7, -v0.z)));
          mvPosition = v0;
          mvPosition.xy += across * position.x * drawn * 0.5;
          float a = wispAlpha(age, w0) * (cigar ? 0.75 : 0.62) * (wide / drawn) * smoothstep(0.06, 0.4, -v0.z) / (1.0 + 1.2 * aSped);
          vec3 tint = mix(vec3(0.6, 0.7, 0.95), vec3(0.74, 0.77, 0.86), smoothstep(0.3, 2.0, age));
          vColor = vec4(tint * min(lightAt(p0) * 0.9 + 0.03, vec3(1.6)), a);
          vUv = vec4(position.x * 0.5 + 0.5, aEmit.w * 0.9, ${WISP}.0, age);
        } else if (kind == ${PUFF}) {
          float age = uNow - aEmit.w;
          if (age >= ${f(PUFF_LIFE)}) return;
          float j = aPart.y;
          float hj = hh1(j, aNext.w);
          float hk = hh1(j + 11.0, aNext.w);
          float reach = (cigar ? 0.62 : 0.5) * (0.75 + 0.5 * hk) * (1.0 - exp(-2.6 * age));
          vec3 wp = aEmit.xyz + aNext.xyz * reach + smokeDrift(age * 0.8, aEmit.w, aNext.w) * vec3(1.0, 0.75, 1.0);
          mvPosition = viewMatrix * vec4(wp, 1.0);
          float size = (0.07 + (cigar ? 0.62 : 0.52) * (1.0 - exp(-0.9 * age))) * (0.8 + 0.4 * hj);
          float rot = hj * 6.2832 + 0.25 * age * (hk - 0.5);
          float cr = cos(rot), sr = sin(rot);
          vec2 corner = position.xy * size;
          mvPosition.xy += vec2(cr * corner.x - sr * corner.y, sr * corner.x + cr * corner.y);
          float a = (cigar ? 0.3 : 0.24) * smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.3 * ${f(PUFF_LIFE)}, ${f(PUFF_LIFE)}, age)) / (1.0 + 0.9 * age) / (1.0 + 0.4 * length(uWind));
          a *= smoothstep(0.12, 0.7, -mvPosition.z);
          vColor = vec4(vec3(0.8, 0.81, 0.84) * min(lightAt(wp) * 0.9 + 0.03, vec3(1.7)), a);
          vUv = vec4(position.xy + 0.5, ${PUFF}.0, hj + j * 0.31);
        } else if (kind == ${EMBER}) {
          float heat = aNext.x;
          mvPosition = viewMatrix * vec4(aEmit.xyz, 1.0);
          float size = max((cigar ? 0.05 : 0.034) * (0.6 + 0.8 * heat), 0.0028 * -mvPosition.z);
          mvPosition.xy += position.xy * size;
          vColor = vec4(vec3(3.2, 0.95, 0.16) * (0.3 + 1.6 * heat) * dark, (0.3 + 0.65 * heat) * smoothstep(0.03, 0.12, heat));
          vUv = vec4(position.xy + 0.5, ${EMBER}.0, 0.0);
        } else {
          // The lighter's flame: a small teardrop standing on the wick, wavering.
          float on = aNext.x;
          mvPosition = viewMatrix * vec4(aEmit.xyz, 1.0);
          float lean = 0.004 * sin(uNow * 23.0) + 0.003 * sin(uNow * 37.0 + 1.0);
          mvPosition.xy += vec2(position.x * 0.016 + lean * (position.y + 0.5), (position.y + 0.5) * 0.034 * (0.85 + 0.15 * sin(uNow * 31.0)));
          vColor = vec4(vec3(3.4, 2.3, 0.9), on);
          vUv = vec4(position.xy + 0.5, ${FLAME}.0, 0.0);
        }
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying vec4 vColor;
      varying vec4 vUv;
      ${SMOKE_FRAG_GLSL}
      void main() {
        float a = vColor.a;
        vec3 c = vColor.rgb;
        if (vUv.z < 1.5) {
          float d = length(vUv.xy - 0.5) * 2.0;
          a *= exp(-d * d * 7.0) + 0.22 * (1.0 - smoothstep(0.0, 1.0, d));
        } else if (vUv.z < 2.5) a *= wispShape(vUv.xy, vUv.w);
        else if (vUv.z < 3.5) a *= puffShape(vUv.xy, vUv.w);
        else {
          // Wide and blue at the wick, drawn up to a point.
          float y = vUv.y;
          float w = (1.0 - y) * (0.35 + 0.65 * smoothstep(0.0, 0.25, y));
          float x = abs(vUv.x - 0.5) * 2.0;
          a *= 1.0 - smoothstep(w * 0.55, w, x);
          c = mix(vec3(0.5, 0.9, 3.0), c, smoothstep(0.02, 0.22, y));
        }
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
        #include <fog_fragment>
      }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'mack.smoke';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 3;
  }

  /**
   * A frame: where the smoker's cigarette and mouth are now (null: he isn't there to see, or has nothing; what's in
   * the air already drifts on), the wind (m/s, world x and z).
   */
  update(dt: number, src: SmokeSource | null, wind: THREE.Vector2): void {
    this.now += dt;
    const now = this.now;
    const u = this.material.uniforms;
    u.uNow.value = now;
    (u.uWind.value as THREE.Vector2).copy(wind);
    const lit = !!src && src.lit;
    if (src) u.uCigar.value = src.kind === 'cigar' ? 1 : 0;
    // How fast he's moving through the air (his mouth's speed, eased): his wake breaks the smoke up.
    if (src && dt > 0) {
      const v = this.moved ? src.mouth.distanceTo(this.was) / dt : 0;
      this.stir += (Math.min(v, 8) - this.stir) * Math.min(1, dt * 3);
      this.was.copy(src.mouth);
      this.moved = true;
    } else this.moved = false;
    u.uStir.value = this.stir;
    // The thread: the newest sample is the lit end now; every step it's left behind and a new one begun.
    const T = this.trail;
    this.since += dt;
    while (this.since >= TRAIL_STEP) {
      this.since -= TRAIL_STEP;
      T.copyWithin(4, 0, (TRAIL - 1) * 4);
      this.speeds.copyWithin(1, 0, TRAIL - 1);
    }
    if (lit) {
      // (How fast the lit end is moving: from the sample before, less his own walking, which the wake accounts for.)
      const was = T[7] > -1e5 && now > T[7] ? Math.hypot(src!.tip.x - T[4], src!.tip.y - T[5], src!.tip.z - T[6]) / (now - T[7]) : 0;
      this.speeds[0] = Math.max(0, Math.min(was, 6) - this.stir);
      T.set([src!.tip.x, src!.tip.y, src!.tip.z, now], 0);
    } else T.fill(GONE, 0, 4);
    const Sp = this.sped.array as Float32Array;
    const E = this.emit.array as Float32Array;
    const N = this.next.array as Float32Array;
    // (A sample that's gone is drawn on top of the nearest one that isn't, so the strip closes up there instead of
    // running off to nowhere; with none left, nothing's drawn.)
    const live = (i: number): boolean => T[i * 4 + 3] > -1e5 && now - T[i * 4 + 3] <= WISP_LIFE;
    let before = -1;
    const use = new Int32Array(TRAIL).fill(-1);
    for (let i = 0; i < TRAIL; i++) {
      if (live(i)) before = i;
      use[i] = before;
    }
    let after = -1;
    for (let i = TRAIL - 1; i >= 0; i--) {
      if (live(i)) after = i;
      if (use[i] < 0) use[i] = after;
    }
    for (let i = 0; i < TRAIL; i++) {
      const k = use[i];
      for (let v = 0; v < 2; v++) {
        const o = (this.wispAt + i * 2 + v) * 4;
        if (k < 0) {
          E[o + 3] = GONE;
          continue;
        }
        E.set(T.subarray(k * 4, k * 4 + 4), o);
        if (k + 1 < TRAIL && live(k + 1)) N.set(T.subarray(k * 4 + 4, k * 4 + 8), o);
        else N[o + 3] = GONE;
        Sp[this.wispAt + i * 2 + v] = this.speeds[Math.min(TRAIL - 1, k + 1)];
      }
    }
    // His breath: a puff every so often while smoke is coming out, each from his mouth as it was, the way he faced.
    this.sincePuff += dt;
    if (src && src.breath > 0.25 && this.sincePuff >= 0.13) {
      this.sincePuff = 0;
      const j = this.puff++ % BREATHS;
      const seed = (j * 0.618 + now * 0.37) % 1;
      this.puffs.set([src.mouth.x, src.mouth.y, src.mouth.z, now, src.way.x + (seed - 0.5) * 0.3, src.way.y + (((seed * 7.3) % 1) - 0.5) * 0.22, src.way.z + (((seed * 3.1) % 1) - 0.5) * 0.3, seed], j * 8);
    }
    for (let j = 0; j < BREATHS; j++) {
      for (let v = 0; v < 4; v++) {
        const o = (this.puffAt + j * 4 + v) * 4;
        E.set(this.puffs.subarray(j * 8, j * 8 + 4), o);
        N.set(this.puffs.subarray(j * 8 + 4, j * 8 + 8), o);
      }
    }
    for (let v = 0; v < 4; v++) {
      const e = (this.emberAt + v) * 4;
      if (lit) {
        E.set([src!.tip.x, src!.tip.y, src!.tip.z, 0], e);
        N[e] = src!.heat;
      } else E[e + 3] = GONE;
      const fl = (this.flameAt + v) * 4;
      if (src && src.flame > 0.01) {
        E.set([src.flameAt.x, src.flameAt.y, src.flameAt.z, 0], fl);
        N[fl] = src.flame;
      } else E[fl + 3] = GONE;
    }
    this.emit.needsUpdate = true;
    this.next.needsUpdate = true;
    this.sped.needsUpdate = true;
  }
}
