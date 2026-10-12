import * as THREE from 'three';
import { FAUNA_KINDS, NO_FAUNA, habitatWeight, type FaunaKind, type FaunaTargets, type Habitat } from '../district/faunaMix';
import { geometryOf, SHAPES, type FaunaShape } from './faunaModels';
import { ModelSet, type Slot } from './faunaCity';
import type { Row } from './faunaRows';

type Rgb = readonly [number, number, number];

/**
 * The city's animals: birds on the pavement and overhead, cats and dogs and hens in the lanes, bats at dusk, and the
 * insects (butterflies, dragonflies, fireflies, moths round the lamps). Which and how many is district/faunaMix.ts
 * (pure); this keeps that many of each in range of the viewer, a small simulation of a few dozen animals on the CPU,
 * one instanced draw a kind, each kind a little model of boxes and blobs built here.
 *
 * Animals are never stored in the world: they appear out of sight round you, live where they're put (a pigeon beside a
 * bench, a crow on the rubbish, a moth at a lamp, a firefly by a tree), and are gone when you've left them behind or the
 * hour has moved on. Walk up to one and it startles: birds take off, a cat runs, a dog trots off, hens scatter.
 * A step is planned once, when it's chosen (the target and the way to it are checked then), never probed per frame.
 *
 * The models are posed in the vertex shader from a few numbers an instance (`iAnim`: phase, rate, amplitude, peck;
 * `iFold`: wing spread, glow): wings flap about the body (`aPart.x` is a vertex's distance out along a wing), legs
 * swing (`aPart.y`: +-1), the head dips to peck (`aPart.z`).
 */

/** What the simulation asks of the city (district/main.ts gives it). */
export interface FaunaWorld {
  /** The ground's height at (x, z). */
  groundY(x: number, z: number): number;
  /** The height of a place an animal may stand (open pavement, lawn, earth, clear of walls and props), or null. */
  standY(x: number, z: number): number | null;
  /** 0-1: open water near (x, z). */
  water(x: number, z: number): number;
  /** 0-1: how built-up (x, z) is: 0 a park or the edge of a suburb, 1 the downtown core. */
  density(x: number, z: number): number;
  /** The parks and the ponds (rects in the world: x, y = z, w, h) within about 130 m of (x, z). */
  areas(x: number, z: number): { readonly parks: readonly Rc[]; readonly ponds: readonly Rc[] };
  /** The props within about 80 m of (x, z): what animals gather by. */
  props(x: number, z: number): Iterable<{ readonly kind: string; readonly x: number; readonly z: number }>;
}

export interface Rc {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** How far from the viewer an animal is kept (m); beyond it, it fades and goes. */
export const FAUNA_REACH = 72;
const SPAWN_MIN = 9;
const SPAWN_MAX = 58;

const VERT = /* glsl */ `
  attribute vec3 aCol;
  attribute vec3 aPart;
  attribute vec4 iAnim;
  attribute vec4 iFold;
  attribute vec3 iTint;
  uniform float uTime;
  varying vec3 vCol;
  varying float vBlink;
  varying vec3 vN;
  void main() {
    vec3 p = position;
    float ph = iAnim.x + uTime * iAnim.y * 6.2831853;
    float s = sin(ph);
    float spread = iFold.x;
    // Wings: out and flapping, or folded in against the body.
    float flap = s * iAnim.z * spread;
    float ax = aPart.x;
    // (The tip lags the root: a wing bends as it beats.)
    p.y += ax * flap + ax * ax * 0.9 * sin(ph - 0.9) * iAnim.z * spread;
    if (ax > 0.0) {
      // Folded, a wing lies along the flank with its tip towards the tail.
      float side = sign(p.x);
      vec3 folded = vec3(side * (0.04 + ax * 0.07), p.y - ax * 0.12, p.z - ax * 0.55);
      p = mix(folded, vec3(p.x * (1.0 - 0.22 * abs(flap)), p.y, p.z), spread);
    }
    // Legs swing as it walks; the head dips as it pecks.
    p.z += aPart.y * s * iAnim.z * 0.5 * (1.0 - spread);
    p.y += abs(aPart.y) * max(0.0, cos(ph)) * iAnim.z * 0.12 * (1.0 - spread);
    float peck = 0.5 + 0.5 * sin(uTime * 9.0 + iAnim.x * 3.0);
    p.z += aPart.z * iAnim.w * 0.06 * peck;
    p.y -= aPart.z * iAnim.w * 0.1 * peck;
    vCol = aCol * iTint;
    vN = normalize(mat3(instanceMatrix) * normal);
    // Fireflies: a slow blink (iFold.y is its rate, 0 for everything else).
    vBlink = iFold.y > 0.0 ? pow(max(0.0, sin(uTime * iFold.y + iAnim.x * 7.0)), 3.0) : 1.0;
    #ifdef GLOW
      p *= 0.3 + vBlink * 1.2;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float uLight;
  uniform vec3 uSunDir;
  varying vec3 vCol;
  varying float vBlink;
  varying vec3 vN;
  void main() {
    #ifdef GLOW
      gl_FragColor = vec4(vCol * vBlink * 1.6, 1.0);
    #else
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      // The sun (or the moon) from the side it's on, the sky from above, and a floor so the shadow side isn't black.
      float l = 0.38 + 0.5 * smoothstep(-0.5, 1.0, dot(n, uSunDir)) + 0.12 * (n.y * 0.5 + 0.5);
      gl_FragColor = vec4(vCol * l * uLight, 1.0);
    #endif
  }
`;

// ---- Simulation ----

type Mode = 'idle' | 'walk' | 'run' | 'orbit' | 'flee' | 'flit';

interface Agent {
  kind: FaunaKind;
  mode: Mode;
  x: number;
  y: number;
  z: number;
  /** Where it faces (rad; forward is +z at 0). */
  hd: number;
  pitch: number;
  roll: number;
  /** Seconds in this mode, and how long it lasts. */
  t: number;
  dur: number;
  /** Goal (a walk's end, a flit's next point). */
  gx: number;
  gy: number;
  gz: number;
  /** Orbit centre, radius, direction, altitude. */
  ox: number;
  oz: number;
  r: number;
  dir: number;
  h: number;
  /** Height above the ground it stands at (a step, a kerb). */
  lift: number;
  speed: number;
  size: number;
  phase: number;
  /** Fades in (0 to 1) when it's made and out when it's retired. */
  fade: number;
  retire: boolean;
  /** How a cat or a dog rests: standing, sitting up, or lying as a loaf. */
  pose: 'stand' | 'sit' | 'loaf';
  /** Which of its kind's tints. */
  variant: number;
  /** The model-file animal's place in its pool (real/faunaCity.ts), and whether it is the air kind of it. */
  slot: Slot | null;
  slotAir: boolean;
  /** The pond it lives on (a duck, a turtle): it stays inside it. */
  pond: Rc | null;
  /** Whether it is one that startles at all (a city's animals mostly don't: they are used to people). */
  shy: boolean;
  /** A showroom's: held where it is in a pose, never retired or counted (Fauna.display). */
  fixed: boolean;
  /** Wing spread 0-1 (0 folded). */
  spread: number;
  tint: Rgb;
  seed: number;
}

interface Spec {
  size: [number, number];
  /** Walking speed, running speed (m/s). */
  walk: number;
  run: number;
  /** The distance at which it startles. */
  startle: number;
  /** Can it fly (a bird)? */
  flies: boolean;
  /** Flap rate (Hz) in the air. */
  flapHz: number;
  tints: Rgb[];
}

/** A walker with no sizes of its own (a model file gives its size): speeds and how near you can come. */
const W = (walk: number, run: number, startle: number, flies = false): Spec => ({ size: [0.92, 1.08], walk, run, startle, flies, flapHz: 0, tints: [[1, 1, 1]] });

const SPEC: Record<FaunaKind, Spec> = {
  fox: W(0.9, 6, 9), tanuki: W(0.7, 4, 7), squirrel: W(0.6, 6, 6), rat: W(0.5, 4.5, 4), duck: W(0.4, 2.5, 6), turtle: W(0.08, 0.3, 3),
  frog: W(0.3, 1.5, 3), beetle: W(0.1, 0.4, 2), snail: W(0.01, 0.03, 1.5), goat: W(0.7, 5, 4), gecko: W(0.3, 1.8, 2.5), lizard: W(0.3, 2.5, 3.5),
  parrot: W(0.3, 2, 5), cockroach: W(0.2, 1.2, 2), crab: W(0.3, 1.4, 3), monkey: W(0.8, 4.5, 6),
  crow: { size: [0.95, 1.1], walk: 0.9, run: 5, startle: 7, flies: true, flapHz: 3.4, tints: [[1, 1, 1], [1.2, 1.2, 1.25]] },
  pigeon: { size: [0.9, 1.05], walk: 0.55, run: 5, startle: 4.5, flies: true, flapHz: 6, tints: [[1, 1, 1], [0.8, 0.8, 0.82], [1.15, 1.12, 1.1], [0.7, 0.62, 0.6]] },
  sparrow: { size: [0.9, 1.1], walk: 0.5, run: 5, startle: 5, flies: true, flapHz: 12, tints: [[1, 1, 1], [1.12, 1.05, 0.95], [0.9, 0.88, 0.85]] },
  gull: { size: [0.95, 1.1], walk: 0.5, run: 5, startle: 8, flies: true, flapHz: 2.4, tints: [[1, 1, 1]] },
  egret: { size: [0.95, 1.05], walk: 0.3, run: 4, startle: 10, flies: true, flapHz: 2.6, tints: [[1, 1, 1]] },
  cat: { size: [0.85, 1.1], walk: 0.6, run: 5.5, startle: 5, flies: false, flapHz: 0, tints: [[1, 1, 1], [0.28, 0.27, 0.3], [0.9, 0.6, 0.32], [1.3, 1.28, 1.25], [0.72, 0.66, 0.58]] },
  dog: { size: [0.75, 1.15], walk: 0.9, run: 4.6, startle: 3.5, flies: false, flapHz: 0, tints: [[1, 1, 1], [0.55, 0.45, 0.35], [0.3, 0.28, 0.28], [1.25, 1.2, 1.1], [0.85, 0.7, 0.55]] },
  chicken: { size: [0.9, 1.2], walk: 0.5, run: 3.6, startle: 3.5, flies: false, flapHz: 8, tints: [[1, 1, 1], [1.5, 1.45, 1.4], [0.6, 0.45, 0.35], [1.25, 0.8, 0.5]] },
  butterfly: { size: [1.6, 2.2], walk: 0, run: 0, startle: 0, flies: true, flapHz: 7, tints: [[1.1, 1.1, 1.1], [1.4, 1.1, 0.35], [0.9, 0.55, 0.15], [0.4, 0.55, 1.2], [1.1, 0.75, 0.2]] },
  dragonfly: { size: [1.5, 1.8], walk: 0, run: 0, startle: 0, flies: true, flapHz: 30, tints: [[1.1, 0.25, 0.1], [0.3, 0.7, 0.8], [1.1, 0.5, 0.15]] },
  firefly: { size: [2, 3], walk: 0, run: 0, startle: 0, flies: true, flapHz: 0, tints: [[1, 1, 1]] },
  moth: { size: [2.2, 3], walk: 0, run: 0, startle: 0, flies: true, flapHz: 22, tints: [[1, 1, 1], [0.85, 0.8, 0.7]] },
};

/**
 * The share of a kind's animals that ever startle at someone near (the user, 2026-10-10: the city's animals are used to people; the
 * occasional one is fine), and for those, how near you must come as a share of `startle`: the tame ones hardly mind, the wild ones do.
 */
const SHY: Partial<Record<FaunaKind, number>> = {
  pigeon: 0.2, sparrow: 0.35, crow: 0.3, gull: 0.3, cat: 0.08, dog: 0.03, chicken: 0.25, goat: 0.05, parrot: 0.15, monkey: 0.25, duck: 0.25, egret: 0.5, rat: 0.6,
};
const TAME: ReadonlySet<FaunaKind> = new Set<FaunaKind>(['pigeon', 'sparrow', 'crow', 'gull', 'cat', 'dog', 'chicken', 'goat', 'parrot', 'monkey', 'duck']);
/** Kinds that live on a park's ground, and on a pond. */
const PARKISH: ReadonlySet<FaunaKind> = new Set<FaunaKind>(['fox', 'tanuki', 'squirrel', 'beetle', 'snail', 'lizard', 'monkey', 'parrot', 'frog']);
const PONDED: ReadonlySet<FaunaKind> = new Set<FaunaKind>(['duck', 'turtle']);

/** The ground animals (walk and stand about) and the air's. */
const GROUND: ReadonlySet<FaunaKind> = new Set<FaunaKind>([
  'pigeon', 'sparrow', 'egret', 'cat', 'dog', 'chicken', 'fox', 'tanuki', 'squirrel', 'rat', 'duck', 'turtle', 'frog', 'beetle', 'snail', 'goat', 'gecko', 'lizard', 'parrot', 'cockroach', 'crab', 'monkey',
]);
/** Those that stay by open water. */
const WATERSIDE: ReadonlySet<FaunaKind> = new Set<FaunaKind>(['egret', 'duck', 'crab', 'turtle', 'frog', 'gull']);
/** Birds that also fly (when the city has an air model for them). */
const FLYERS_SET: ReadonlySet<FaunaKind> = new Set<FaunaKind>(['crow', 'pigeon', 'sparrow', 'gull', 'egret']);
/** With model files in use, the shapes built in code may still stand in for these kinds only (the others were rejected by the user). */
const BUILT_OK: ReadonlySet<FaunaKind> = new Set<FaunaKind>(['chicken', 'egret', 'butterfly', 'dragonfly', 'moth', 'firefly']);
const FLITTERS: ReadonlySet<FaunaKind> = new Set<FaunaKind>(['butterfly', 'dragonfly', 'firefly', 'moth']);
const CAP = 40;

/** A mulberry32 stream: the animals' choices (the same seed, the same animals). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Layer {
  readonly shape: FaunaShape;
  readonly mesh: THREE.InstancedMesh;
  readonly anim: THREE.InstancedBufferAttribute;
  readonly fold: THREE.InstancedBufferAttribute;
  readonly tint: THREE.InstancedBufferAttribute;
}

interface Anchor {
  readonly x: number;
  readonly z: number;
}

export class Fauna {
  readonly group = new THREE.Group();
  /** How bright the animals are drawn (0-1: the light on them; set each frame). */
  light = 1;
  /** The light and the sun's direction as uniforms, for models drawn beside the animals (the showroom's candidates). */
  get sharedUniforms(): { readonly uLight: { value: number }; readonly uSunDir: { value: THREE.Vector3 } } {
    return { uLight: this.uniforms.uLight, uSunDir: this.uniforms.uSunDir };
  }
  /** Where the light comes from (the sun's or the moon's direction, unit). */
  readonly sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
  /** Whether any are kept at all. */
  on = true;
  /** A tropical city (Manila): its habitats differ. */
  tropical = false;
  /** How readily they startle (1: as set; 0: never, for looking at them close up). */
  startleScale = 1;
  private targets: FaunaTargets = NO_FAUNA;
  private readonly agents: Agent[] = [];
  private readonly layers = new Map<FaunaShape, Layer>();
  /** The approved model files, when the city gave rows (`useModels`). */
  models: ModelSet | null = null;
  private readonly rnd: () => number;
  private readonly uniforms = { uTime: { value: 0 }, uLight: { value: 1 }, uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() } };
  private readonly trees: Anchor[] = [];
  private readonly lamps: Anchor[] = [];
  private readonly spots: Anchor[] = [];
  private readonly rubbish: Anchor[] = [];
  private parks: readonly Rc[] = [];
  private ponds: readonly Rc[] = [];
  private anchorAt = new THREE.Vector2(1e9, 1e9);
  private anchorT = 0;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private spawnTurn = 0;
  private waterNearT = 99;

  constructor(private readonly world: FaunaWorld, seed = 1) {
    this.group.name = 'fauna';
    this.rnd = rng(seed * 7919 + 13);
    for (const kind of SHAPES) {
      const { geo, glow } = geometryOf(kind);
      const cap = kind === 'firefly' ? CAP * 2 : CAP;
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const fold = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      anim.setUsage(THREE.DynamicDrawUsage);
      fold.setUsage(THREE.DynamicDrawUsage);
      tint.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iAnim', anim);
      geo.setAttribute('iFold', fold);
      geo.setAttribute('iTint', tint);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        defines: glow ? { GLOW: '' } : {},
        side: THREE.DoubleSide,
        transparent: glow,
        depthWrite: !glow,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
        fog: false,
      });
      if (glow) mat.forceSinglePass = true;
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      // One unseen (zero-size) instance to begin with, so the first render, the boot's warm-up, compiles the program.
      mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));
      mesh.count = 1;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.name = `fauna:${kind}`;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.layers.set(kind, { shape: kind, mesh, anim, fold, tint });
    }
    this.group.matrixAutoUpdate = false;
  }

  /** How many animals there are now, by kind. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.agents) if (!a.retire && !a.fixed) out[a.kind] = (out[a.kind] ?? 0) + 1;
    return out;
  }

  /** Trees and lamps in range, for the mix: green (0-1) and lamps (0-1). */
  get green(): number {
    return Math.min(1, this.treesNear / 10);
  }
  get lampy(): number {
    return Math.min(1, this.lampsNear / 6);
  }
  private treesNear = 0;
  private lampsNear = 0;
  /** 0-1: open water near the viewer (set by update from the world). */
  waterNear = 0;

  /** The kinds' targets (district/faunaMix.ts), set as the hour, weather or place changes. */
  setTargets(t: FaunaTargets): void {
    this.targets = this.on ? t : NO_FAUNA;
  }

  /**
   * Holds one animal where it is in a pose, for the showroom (it doesn't move, startle or go): 'stand' (wings folded),
   * 'peck', 'walk' or 'run' (legs going on the spot), 'fly' (wings out and flapping; insects flit in place). `variant`
   * picks its tint.
   */
  display(kind: FaunaKind, x: number, y: number, z: number, hd: number, pose: 'stand' | 'peck' | 'walk' | 'run' | 'fly' | 'sit' | 'loaf', variant = 0, size = 1): void {
    const a = this.base(kind);
    const spec = SPEC[kind];
    a.fixed = true;
    a.fade = 1;
    a.x = x;
    a.y = y;
    a.z = z;
    a.hd = hd;
    a.size = size * (spec.size[0] + spec.size[1]) / 2;
    a.variant = variant;
    a.tint = spec.tints[variant % spec.tints.length];
    a.dur = pose === 'peck' ? 1 : 0;
    a.pose = pose === 'sit' ? 'sit' : pose === 'loaf' ? 'loaf' : 'stand';
    a.mode = pose === 'walk' ? 'walk' : pose === 'run' ? 'run' : pose === 'fly' ? (FLITTERS.has(kind) ? 'flit' : 'flee') : 'idle';
    a.spread = pose === 'fly' ? 1 : 0;
    if (pose === 'fly' && !FLITTERS.has(kind)) a.pitch = -0.1;
    this.agents.push(a);
  }

  /** Draws the animals from the model files of these rows (a city's: real/faunaRows.ts) instead of the shapes built in code. */
  useModels(rows: readonly Row[]): void {
    this.models = new ModelSet(rows, this.uniforms, this.group);
  }

  /** Whether a kind can be drawn at all now (a model of it, or a shape built in code that was not rejected). */
  private renders(kind: FaunaKind): boolean {
    if (!this.models) return (SHAPES as readonly string[]).includes(kind);
    return this.models.has(kind) || (BUILT_OK.has(kind) && (SHAPES as readonly string[]).includes(kind));
  }

  private dropSlot(a: Agent): void {
    if (!a.slot) return;
    this.models?.release(a.slot);
    a.slot = null;
  }

  /** Remove every animal (a teleport, a scene change). */
  clear(): void {
    for (const a of this.agents) this.dropSlot(a);
    this.agents.length = 0;
    for (const l of this.layers.values()) l.mesh.count = 0;
  }

  update(dt: number, cam: THREE.Vector3, time: number): void {
    dt = Math.min(dt, 0.1);
    this.uniforms.uTime.value = time;
    this.uniforms.uLight.value = this.light;
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.refreshAnchors(dt, cam);
    this.waterNearT += dt;
    if (this.waterNearT > 1) {
      this.waterNearT = 0;
      this.waterNear = Math.max(this.world.water(cam.x, cam.z), this.world.water(cam.x + 40, cam.z), this.world.water(cam.x - 40, cam.z), this.world.water(cam.x, cam.z + 40), this.world.water(cam.x, cam.z - 40));
    }
    this.balance(cam);
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      this.step(a, dt, cam);
      if (a.fixed) continue;
      const d = Math.hypot(a.x - cam.x, a.z - cam.z);
      if (d > FAUNA_REACH) a.retire = true;
      a.fade += ((a.retire ? -1 : 1) * dt) / 0.8;
      if (a.fade >= 1) a.fade = 1;
      if (a.fade <= 0 && a.retire) {
        this.dropSlot(a);
        this.agents.splice(i, 1);
      }
    }
    this.models?.update(dt);
    this.write();
  }

  // ---- anchors ----

  private refreshAnchors(dt: number, cam: THREE.Vector3): void {
    this.anchorT += dt;
    if (this.anchorT < 1.5 && Math.hypot(cam.x - this.anchorAt.x, cam.z - this.anchorAt.y) < 20) return;
    this.anchorT = 0;
    this.anchorAt.set(cam.x, cam.z);
    this.trees.length = this.lamps.length = this.spots.length = this.rubbish.length = 0;
    const ar = this.world.areas(cam.x, cam.z);
    this.parks = ar.parks;
    this.ponds = ar.ponds;
    let trees = 0;
    let lamps = 0;
    for (const p of this.world.props(cam.x, cam.z)) {
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d > 90) continue;
      switch (p.kind) {
        case 'tree':
          this.trees.push(p);
          if (d < 45) trees++;
          break;
        case 'lamp':
        case 'postlamp':
          this.lamps.push(p);
          if (d < 45) lamps++;
          break;
        case 'garbage':
          this.rubbish.push(p);
          this.spots.push(p);
          break;
        case 'bench':
        case 'vending':
        case 'cart':
        case 'sarisari':
        case 'paymachine':
        case 'jeepstop':
        case 'shrine':
          this.spots.push(p);
          break;
      }
    }
    this.treesNear = trees;
    this.lampsNear = lamps;
  }

  /** Where a spot is, for the animals' rules (district/faunaMix.ts `habitatWeight`). */
  habitatAt(x: number, z: number): Habitat {
    const inRc = (r: Rc, pad: number): boolean => x > r.x - pad && x < r.x + r.w + pad && z > r.y - pad && z < r.y + r.h + pad;
    const park = this.parks.some((r) => inRc(r, 0));
    return {
      urban: park ? 0 : this.world.density(x, z),
      park,
      pond: this.ponds.some((r) => inRc(r, 6)),
      coast: this.world.water(x, z),
      tropical: this.tropical,
    };
  }

  /** Whether a kind may be at a spot now: a chance by `habitatWeight`. */
  private welcome(kind: FaunaKind, x: number, z: number): boolean {
    return this.rnd() < habitatWeight(kind, this.habitatAt(x, z));
  }

  private rect(list: readonly Rc[], cam: THREE.Vector3, lo: number, hi: number): Rc | null {
    const ok = list.filter((r) => {
      const d = Math.hypot(r.x + r.w / 2 - cam.x, r.y + r.h / 2 - cam.z);
      return d > lo && d < hi + Math.max(r.w, r.h) / 2;
    });
    return ok.length ? ok[Math.floor(this.rnd() * ok.length)] : null;
  }

  private pick<T>(list: readonly T[], cam: THREE.Vector3, lo: number, hi: number, pos: (t: T) => Anchor): T | null {
    // A few tries for one at a good distance from the viewer.
    for (let k = 0; k < 8 && list.length; k++) {
      const t = list[Math.floor(this.rnd() * list.length)];
      const p = pos(t);
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d >= lo && d <= hi) return t;
    }
    return null;
  }

  // ---- keeping the numbers ----

  /** How many of a kind to keep: the mix's count, cut by how well the place suits it (downtown keeps almost no cats). */
  private limit(kind: FaunaKind, hab: Habitat): number {
    return Math.floor(this.targets[kind] * habitatWeight(kind, hab) + 0.35);
  }

  private balance(cam: THREE.Vector3): void {
    const hab: Habitat = { urban: this.world.density(cam.x, cam.z), park: this.parks.length > 0, pond: this.ponds.length > 0, coast: this.waterNear, tropical: this.tropical };
    const have = new Map<FaunaKind, number>();
    for (const a of this.agents) if (!a.retire && !a.fixed) have.set(a.kind, (have.get(a.kind) ?? 0) + 1);
    // Too many of a kind (the hour or the weather moved on): let the farthest go.
    for (const kind of FAUNA_KINDS) {
      const over = (have.get(kind) ?? 0) - this.limit(kind, hab);
      if (over <= 0) continue;
      let far: Agent | null = null;
      let fd = -1;
      for (const a of this.agents) {
        if (a.kind !== kind || a.retire || a.fixed) continue;
        const d = Math.hypot(a.x - cam.x, a.z - cam.z);
        if (d > fd) {
          fd = d;
          far = a;
        }
      }
      if (far) far.retire = true;
    }
    // Too few: make some (up to three a frame), a kind in turn.
    let made = 0;
    for (let k = 0; k < FAUNA_KINDS.length; k++) {
      this.spawnTurn = (this.spawnTurn + 1) % FAUNA_KINDS.length;
      const kind = FAUNA_KINDS[this.spawnTurn];
      if ((have.get(kind) ?? 0) >= this.limit(kind, hab) || !this.renders(kind)) continue;
      if (this.agents.length >= 120) return;
      if (this.spawn(kind, cam) && ++made >= 3) return;
    }
  }

  private base(kind: FaunaKind): Agent {
    const s = SPEC[kind];
    const r = this.rnd;
    const variant = Math.floor(r() * 100);
    return {
      kind,
      mode: 'idle',
      x: 0, y: 0, z: 0,
      hd: r() * Math.PI * 2,
      pitch: 0, roll: 0,
      t: 0, dur: 1 + r() * 4,
      gx: 0, gy: 0, gz: 0,
      ox: 0, oz: 0, r: 0, dir: r() < 0.5 ? -1 : 1, h: 0,
      lift: 0,
      speed: 0,
      size: s.size[0] + (s.size[1] - s.size[0]) * r(),
      phase: r() * 100,
      fade: 0,
      retire: false,
      fixed: false,
      pose: 'stand',
      variant,
      slot: null,
      slotAir: false,
      pond: null,
      shy: r() < (SHY[kind] ?? 1),
      spread: 0,
      tint: s.tints[variant % s.tints.length],
      seed: r(),
    };
  }

  private spawn(kind: FaunaKind, cam: THREE.Vector3): boolean {
    const r = this.rnd;
    const a = this.base(kind);
    const m = this.models;
    if (m) {
      // With model files: a flier needs an air model (a flying gull, a dragonfly); a bird that has both takes to the air some of the time.
      if (FLITTERS.has(kind)) return (m.has(kind) ? m.hasAir(kind) : BUILT_OK.has(kind)) && this.spawnFlitter(a, cam);
      const canAir = FLYERS_SET.has(kind) && m.hasAir(kind);
      const canGround = m.hasGround(kind) || (!m.has(kind) && BUILT_OK.has(kind));
      if (!canGround && !canAir) return false;
      // (The sea's gulls are mostly in the air: the user, 2026-10-10.)
      if (canGround && (!canAir || r() < (kind === 'gull' ? 0.2 : 0.55))) return this.spawnGround(a, cam);
    } else {
      if (GROUND.has(kind) || (kind === 'crow' && this.rubbish.length > 0 && r() < 0.5)) return this.spawnGround(a, cam);
      if (FLITTERS.has(kind)) return this.spawnFlitter(a, cam);
    }
    // Birds overhead and bats: out at a bearing round the viewer.
    const ang = r() * Math.PI * 2;
    const d = SPAWN_MIN + 12 + r() * (SPAWN_MAX - SPAWN_MIN - 12);
    a.ox = cam.x + Math.cos(ang) * d;
    a.oz = cam.z + Math.sin(ang) * d;
    if (kind !== 'gull' && !this.welcome(kind, a.ox, a.oz)) return false;
    if (kind === 'gull') {
      // Over the water, or along it.
      let found = false;
      for (let k = 0; k < 12 && !found; k++) {
        const aa = r() * Math.PI * 2;
        const dd = 15 + r() * 55;
        const x = cam.x + Math.cos(aa) * dd;
        const z = cam.z + Math.sin(aa) * dd;
        if (this.world.water(x, z) > 0.4) {
          a.ox = x;
          a.oz = z;
          found = true;
        }
      }
      if (!found) return false;
    }
    const ground = this.world.groundY(a.ox, a.oz);
    a.mode = 'orbit';
    a.r = 12 + r() * 26;
    a.h = ground + (kind === 'gull' ? 16 + r() * 22 : kind === 'sparrow' ? 6 + r() * 6 : 14 + r() * 22);
    a.speed = kind === 'gull' ? 6 + r() * 2 : kind === 'sparrow' ? 9 : 8 + r() * 2.5;
    const ph = r() * Math.PI * 2;
    a.x = a.ox + Math.cos(ph) * a.r;
    a.z = a.oz + Math.sin(ph) * a.r;
    a.y = a.h;
    a.t = ph;
    a.spread = 1;
    a.hd = ph;
    this.agents.push(a);
    return true;
  }

  private spawnGround(a: Agent, cam: THREE.Vector3): boolean {
    const r = this.rnd;
    const kind = a.kind;
    let x: number;
    let z: number;
    if (PONDED.has(kind)) {
      // On a pond: a duck or a turtle, anywhere on the water; none where there is no pond.
      const pond = this.rect(this.ponds, cam, 3, SPAWN_MAX + 20);
      if (!pond) return false;
      x = pond.x + (0.15 + r() * 0.7) * pond.w;
      z = pond.y + (0.15 + r() * 0.7) * pond.h;
      if (Math.hypot(x - cam.x, z - cam.z) < 3) return false;
      a.x = x;
      a.z = z;
      a.y = this.world.groundY(x, z) + 0.05;
      a.lift = 0.05;
      a.pond = pond;
      a.mode = 'idle';
      a.dur = 0.5 + r() * 3;
      this.agents.push(a);
      return true;
    }
    if (PARKISH.has(kind) && this.parks.length) {
      // In a park (or by its pond, a frog).
      const area = kind === 'frog' && this.ponds.length ? this.rect(this.ponds, cam, 3, SPAWN_MAX + 20) : this.rect(this.parks, cam, SPAWN_MIN, SPAWN_MAX + 20);
      if (!area) return false;
      const pad = kind === 'frog' && this.ponds.includes(area) ? 2 : 0;
      x = area.x - pad + r() * (area.w + 2 * pad);
      z = area.y - pad + r() * (area.h + 2 * pad);
    } else if (WATERSIDE.has(kind)) {
      const aa = r() * Math.PI * 2;
      const dd = SPAWN_MIN + r() * (SPAWN_MAX - SPAWN_MIN);
      x = cam.x + Math.cos(aa) * dd;
      z = cam.z + Math.sin(aa) * dd;
      if (this.world.water(x, z) < 0.25) return false;
    } else {
      // By a bench, a bin, a cart, a lamp or a tree where there is one, else anywhere clear in range.
      const list = kind === 'crow' ? this.rubbish : kind === 'cat' || kind === 'dog' || kind === 'chicken' ? (r() < 0.6 && this.spots.length ? this.spots : this.lamps) : this.spots.length && r() < 0.7 ? this.spots : this.trees;
      const at = list.length ? this.pick(list, cam, SPAWN_MIN, SPAWN_MAX, (p) => p) : null;
      if (at) {
        const aa = r() * Math.PI * 2;
        const dd = 0.8 + r() * 1.6;
        x = at.x + Math.cos(aa) * dd;
        z = at.z + Math.sin(aa) * dd;
      } else {
        const aa = r() * Math.PI * 2;
        const dd = SPAWN_MIN + r() * (SPAWN_MAX - SPAWN_MIN);
        x = cam.x + Math.cos(aa) * dd;
        z = cam.z + Math.sin(aa) * dd;
      }
    }
    if (Math.hypot(x - cam.x, z - cam.z) < SPAWN_MIN) return false;
    if (!this.welcome(kind, x, z)) return false;
    const y = this.world.standY(x, z);
    if (y === null) return false;
    a.x = x;
    a.z = z;
    a.y = y;
    a.lift = y - this.world.groundY(x, z);
    a.mode = 'idle';
    a.dur = 0.5 + r() * 3;
    if (kind === 'cat' || kind === 'dog') a.dur += r() * 6;
    this.rest(a);
    a.spread = 0;
    this.agents.push(a);
    // Pigeons, sparrows and hens come in twos and threes.
    if ((kind === 'pigeon' || kind === 'sparrow' || kind === 'chicken') && r() < 0.6 && this.agents.length < 118) {
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const b = this.base(kind);
        const bx = x + (r() - 0.5) * 3;
        const bz = z + (r() - 0.5) * 3;
        const by = this.world.standY(bx, bz);
        if (by === null) continue;
        b.x = bx;
        b.z = bz;
        b.y = by;
        b.lift = by - this.world.groundY(bx, bz);
        b.dur = 0.3 + r() * 2.5;
        this.agents.push(b);
      }
    }
    return true;
  }

  private spawnFlitter(a: Agent, cam: THREE.Vector3): boolean {
    const r = this.rnd;
    const kind = a.kind;
    const list = kind === 'moth' ? this.lamps : this.trees;
    let at = this.pick(list, cam, 6, SPAWN_MAX, (p) => p);
    if (!at && (kind === 'dragonfly' || kind === 'butterfly')) {
      // Over open ground and by water.
      const aa = r() * Math.PI * 2;
      const dd = 10 + r() * 45;
      const x = cam.x + Math.cos(aa) * dd;
      const z = cam.z + Math.sin(aa) * dd;
      if (this.world.standY(x, z) !== null) at = { x, z };
    }
    if (!at || !this.welcome(kind, at.x, at.z)) return false;
    const g = this.world.groundY(at.x, at.z);
    a.mode = 'flit';
    a.ox = at.x;
    a.oz = at.z;
    a.r = kind === 'moth' ? 0.7 : kind === 'firefly' ? 3 + r() * 3 : 3 + r() * 5;
    a.h = g + (kind === 'moth' ? 4.2 : 0.5 + r() * 2.2);
    a.x = at.x + (r() - 0.5) * a.r;
    a.z = at.z + (r() - 0.5) * a.r;
    a.y = a.h;
    a.gx = a.x;
    a.gy = a.y;
    a.gz = a.z;
    a.speed = kind === 'dragonfly' ? 3.5 : kind === 'butterfly' ? 1.2 : kind === 'moth' ? 1.4 : 0.5;
    a.spread = 1;
    a.dur = 0;
    this.agents.push(a);
    return true;
  }

  // ---- movement ----

  private step(a: Agent, dt: number, cam: THREE.Vector3): void {
    if (a.fixed) {
      a.t += dt;
      return;
    }
    const spec = SPEC[a.kind];
    const r = this.rnd;
    a.t += dt;
    const dcam = Math.hypot(a.x - cam.x, a.z - cam.z);
    switch (a.mode) {
      case 'idle':
      case 'walk':
      case 'run': {
        // Startled: by the viewer coming close.
        if (a.shy && dcam < spec.startle * (TAME.has(a.kind) ? 0.35 : 0.7) * this.startleScale && a.mode !== 'run') {
          this.startle(a, cam);
          return;
        }
        if (a.mode === 'idle') {
          if (a.t >= a.dur) this.plan(a, cam);
          break;
        }
        const sp = a.mode === 'run' ? spec.run : spec.walk * (a.kind === 'cat' ? 1.4 : 1);
        const dx = a.gx - a.x;
        const dz = a.gz - a.z;
        const dist = Math.hypot(dx, dz);
        const mv = Math.min(dist, sp * dt);
        if (dist > 0.001) {
          const want = Math.atan2(dx, dz);
          let da = want - a.hd;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          a.hd += da * Math.min(1, dt * 9);
          a.x += (dx / dist) * mv;
          a.z += (dz / dist) * mv;
          a.y = this.world.groundY(a.x, a.z) + a.lift;
        }
        if (dist < 0.05 || a.t > a.dur) {
          a.mode = 'idle';
          a.t = 0;
          a.dur = (a.kind === 'cat' ? 4 + r() * 18 : a.kind === 'egret' ? 3 + r() * 9 : 0.6 + r() * 4);
          if (a.kind === 'dog') a.dur = 1 + r() * 5;
          this.rest(a);
        }
        break;
      }
      case 'flee': {
        // A bird that took off: climbing away from where it was startled, then gone.
        const sp = spec.run + 3.5;
        a.x += Math.sin(a.hd) * sp * dt;
        a.z += Math.cos(a.hd) * sp * dt;
        a.y += Math.min(3.5, 1.6 + a.t * 2.2) * dt;
        a.pitch = -0.35;
        a.spread += (1 - a.spread) * Math.min(1, dt * 8);
        if (a.t > 7) a.retire = true;
        break;
      }
      case 'orbit': {
        const w = (a.speed / a.r) * a.dir;
        a.t += w * dt - dt; // (a.t holds the angle; undo the time added above)
        const ang = a.t;
        // The centre drifts and the circle breathes a little.
        a.ox += Math.cos(a.seed * 6.28) * 0.6 * dt;
        a.oz += Math.sin(a.seed * 6.28) * 0.6 * dt;
        const rr = a.r * (1 + 0.15 * Math.sin(a.phase + ang * 0.7));
        const nx = a.ox + Math.cos(ang) * rr;
        const nz = a.oz + Math.sin(ang) * rr;
        a.hd = Math.atan2(nx - a.x, nz - a.z);
        a.x = nx;
        a.z = nz;
        a.y = a.h + Math.sin(a.phase + ang * 1.3) * 1.8;
        a.roll = -a.dir * 0.4;
        a.pitch = 0;
        a.spread = 1;
        break;
      }
      case 'flit': {
        const dx = a.gx - a.x;
        const dy = a.gy - a.y;
        const dz = a.gz - a.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.25 || a.t > a.dur) {
          // Choose another point near its anchor.
          const aa = r() * Math.PI * 2;
          const rr = a.r * Math.sqrt(r());
          a.gx = a.ox + Math.cos(aa) * rr;
          a.gz = a.oz + Math.sin(aa) * rr;
          const g = this.world.groundY(a.gx, a.gz);
          a.gy = a.kind === 'moth' ? a.h + (r() - 0.5) * 1.1 : g + 0.4 + r() * (a.kind === 'butterfly' ? 2.2 : a.kind === 'firefly' ? 2.2 : 1.8);
          a.t = 0;
          a.dur = a.kind === 'dragonfly' ? 0.5 + r() * 1.2 : 1.5 + r() * 3;
          if (a.kind === 'moth') {
            a.gx = a.ox + (r() - 0.5) * 1.6;
            a.gz = a.oz + (r() - 0.5) * 1.6;
            a.dur = 0.25 + r() * 0.6;
          }
        }
        // A dragonfly darts and hangs; the others drift, a butterfly bobbing and a firefly rising slowly.
        let sp = a.speed;
        if (a.kind === 'dragonfly') sp *= Math.min(1, dist) * (a.t < 0.15 ? 0.3 : 1);
        else if (a.kind === 'butterfly') sp *= 0.6 + 0.4 * Math.sin(a.t * 6 + a.phase);
        const k = Math.min(1, (sp * dt) / Math.max(dist, 0.001));
        const bob = a.kind === 'butterfly' ? Math.sin(a.t * 14 + a.phase) * 0.35 : 0;
        a.hd = Math.atan2(dx, dz);
        a.x += dx * k;
        a.z += dz * k;
        a.y += dy * k + bob * dt;
        a.roll = a.kind === 'butterfly' ? Math.sin(a.t * 7 + a.phase) * 0.4 : 0;
        break;
      }
    }
  }

  /** A cat or a dog that has stopped for a while sits or lies down; otherwise it stands. */
  private rest(a: Agent): void {
    const r = this.rnd();
    if (a.kind === 'cat') a.pose = a.dur > 3 ? (r < 0.5 ? 'sit' : r < 0.8 ? 'loaf' : 'stand') : 'stand';
    else if (a.kind === 'dog') a.pose = a.dur > 2.5 && r < 0.55 ? 'sit' : 'stand';
    else a.pose = 'stand';
  }

  /** Walk somewhere near, or stay; the way is checked once, here. */
  private plan(a: Agent, cam: THREE.Vector3): void {
    const r = this.rnd;
    const spec = SPEC[a.kind];
    a.t = 0;
    const stay = a.kind === 'cat' ? 0.35 : a.kind === 'egret' ? 0.3 : 0.25;
    if (r() < stay) {
      a.dur = (a.kind === 'cat' ? 4 + r() * 16 : 0.8 + r() * 4);
      this.rest(a);
      return;
    }
    if (a.pond) {
      // Paddling about the pond.
      a.gx = a.pond.x + (0.1 + r() * 0.8) * a.pond.w;
      a.gz = a.pond.y + (0.1 + r() * 0.8) * a.pond.h;
      a.mode = 'walk';
      a.pose = 'stand';
      a.dur = Math.hypot(a.gx - a.x, a.gz - a.z) / Math.max(0.1, spec.walk) * 1.5 + 2;
      return;
    }
    const reach = a.kind === 'dog' ? 5 + r() * 12 : a.kind === 'cat' ? 2 + r() * 7 : a.kind === 'egret' ? 1 + r() * 3 : 0.8 + r() * 3.5;
    for (let k = 0; k < 3; k++) {
      const aa = r() * Math.PI * 2;
      const gx = a.x + Math.sin(aa) * reach;
      const gz = a.z + Math.cos(aa) * reach;
      const mx = (a.x + gx) / 2;
      const mz = (a.z + gz) / 2;
      if (this.world.standY(gx, gz) === null || this.world.standY(mx, mz) === null) continue;
      // Not towards the viewer's feet.
      if (Math.hypot(gx - cam.x, gz - cam.z) < spec.startle * 0.9) continue;
      a.gx = gx;
      a.gz = gz;
      a.mode = 'walk';
      a.pose = 'stand';
      a.dur = reach / Math.max(0.1, spec.walk) * 2 + 1;
      if (a.kind === 'dog' && r() < 0.5) a.dur = Math.min(a.dur, 4);
      return;
    }
    a.dur = 1 + r() * 3;
    this.rest(a);
  }

  private startle(a: Agent, cam: THREE.Vector3): void {
    const spec = SPEC[a.kind];
    const away = Math.atan2(a.x - cam.x, a.z - cam.z);
    a.t = 0;
    if (a.pond) return;
    if (spec.flies && (!this.models || this.models.hasAir(a.kind))) {
      a.mode = 'flee';
      a.hd = away + (this.rnd() - 0.5) * 0.9;
      a.dur = 7;
      // The others about it go too.
      for (const b of this.agents) {
        if (b !== a && b.kind === a.kind && b.mode !== 'flee' && (b.mode === 'idle' || b.mode === 'walk') && Math.hypot(b.x - a.x, b.z - a.z) < 7) {
          b.mode = 'flee';
          b.t = 0;
          b.hd = away + (this.rnd() - 0.5) * 1.2;
        }
      }
      return;
    }
    // A cat, a dog, a hen: run off from you and settle once clear.
    a.mode = 'run';
    a.pose = 'stand';
    const far = 9 + this.rnd() * 8;
    const swing = (this.rnd() - 0.5) * 1.2;
    for (let k = 0; k < 4; k++) {
      const hd = away + swing * (k + 1) * (k % 2 ? 1 : -1) * 0.6;
      const gx = a.x + Math.sin(hd) * far;
      const gz = a.z + Math.cos(hd) * far;
      if (this.world.standY(gx, gz) !== null && this.world.standY((a.x + gx) / 2, (a.z + gz) / 2) !== null) {
        a.gx = gx;
        a.gz = gz;
        a.dur = far / spec.run + 1;
        return;
      }
    }
    // Nowhere clear to run: stay put, wary.
    a.mode = 'idle';
    a.dur = 2;
  }

  // ---- drawing ----

  /** An animal that is a model file: the clip it is doing calls for, placed where it is. */
  private writeModel(a: Agent): void {
    const m = this.models!;
    const air = a.mode === 'orbit' || a.mode === 'flee' || a.mode === 'flit';
    if (a.slot && a.slotAir !== air) this.dropSlot(a);
    if (!a.slot) {
      if (air ? !m.hasAir(a.kind) : !m.hasGround(a.kind)) return;
      a.slot = m.acquire(a.kind, air, Math.floor(a.seed * 997) + a.variant);
      a.slotAir = air;
      if (!a.slot) return;
    }
    const g = a.fade * a.fade * (3 - 2 * a.fade);
    const grp = a.slot.inst.group;
    grp.visible = g > 0.02;
    grp.position.set(a.x, a.y, a.z);
    grp.rotation.set(a.pitch, a.hd, a.roll, 'YXZ');
    grp.scale.setScalar(a.size * g);
    let clips: readonly string[];
    let ts = 1;
    if (air) {
      const glide = a.mode === 'orbit' && (a.kind === 'gull' || a.kind === 'egret' || a.kind === 'crow') && Math.sin(a.phase + a.t * 0.5) > -0.1;
      clips = a.kind === 'dragonfly' && a.mode === 'flit' && a.t < 0.3 ? ['Hover', 'Flap'] : glide ? ['Glide', 'Flap'] : ['Flap', 'Hover'];
    } else if (a.mode === 'run') {
      clips = ['Run', 'Walk'];
    } else if (a.mode === 'walk') {
      clips = ['Walk', 'Run'];
    } else if (a.pose !== 'stand') {
      clips = ['Sit', 'Idle'];
    } else {
      // Standing about: birds peck, dogs and the like sniff, in bursts; else the idle.
      const busy = Math.sin(a.phase + a.t * 0.9) > 0.1;
      clips = busy ? ['Peck', 'Sniff', 'Idle'] : ['Idle'];
    }
    a.slot.inst.play(clips, ts, a.phase);
  }

  private write(): void {
    const per = new Map<FaunaShape, number>();
    for (const a of this.agents) {
      if (this.models && this.models.has(a.kind)) {
        this.writeModel(a);
        continue;
      }
      const shape = (a.mode === 'idle' && a.pose !== 'stand' ? (a.kind === 'cat' ? (a.pose === 'loaf' ? 'catLoaf' : 'catSit') : a.kind === 'dog' ? 'dogSit' : a.kind) : a.kind) as FaunaShape;
      const l = this.layers.get(shape);
      if (!l) continue;
      const i = per.get(shape) ?? 0;
      if (i >= l.mesh.instanceMatrix.count) continue;
      per.set(shape, i + 1);
      const spec = SPEC[a.kind];
      this.tmpE.set(a.pitch, a.hd, a.roll, 'YXZ');
      this.tmpQ.setFromEuler(this.tmpE);
      const grow = a.fade * a.fade * (3 - 2 * a.fade);
      this.tmpS.setScalar(a.size * grow);
      this.tmpP.set(a.x, a.y, a.z);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      l.mesh.setMatrixAt(i, this.tmpM);
      // Animation: flapping in the air, walking and pecking on the ground.
      let rate = 0;
      let amp = 0;
      let peck = 0;
      let spread = a.spread;
      let blink = 0;
      const air = a.mode === 'orbit' || a.mode === 'flee' || a.mode === 'flit';
      if (a.kind === 'firefly') {
        blink = 2.2 + a.seed * 1.2;
        spread = 1;
      } else if (air) {
        rate = spec.flapHz * (a.mode === 'flee' ? 1.4 : 1);
        amp = a.kind === 'butterfly' ? 1.1 : a.kind === 'dragonfly' ? 0.25 : a.kind === 'moth' ? 0.9 : 0.55;
        // Crows, gulls and the egret glide between bursts, pigeons clap, bats flutter.
        if (a.mode === 'orbit' && (a.kind === 'crow' || a.kind === 'gull' || a.kind === 'egret')) {
          const glide = Math.sin(a.phase + a.t * (a.kind === 'gull' ? 0.5 : 0.8)) > (a.kind === 'gull' ? -0.3 : 0.2);
          if (glide) {
            amp = 0.05;
            rate = 0.5;
          }
        }
      } else if (a.mode === 'walk' || a.mode === 'run') {
        rate = a.mode === 'run' ? 3.2 : a.kind === 'dog' ? 1.5 : a.kind === 'egret' ? 0.6 : 1.6;
        if (a.kind === 'cat') rate = a.mode === 'run' ? 3.6 : 1.5;
        amp = a.mode === 'run' ? 0.22 : a.kind === 'dog' || a.kind === 'cat' ? 0.1 : 0.06;
        if (a.kind === 'chicken' && a.mode === 'run') spread = 0.5;
      } else if (a.fixed && a.mode === 'idle') {
        peck = a.dur;
      } else if (a.mode === 'idle' && (a.kind === 'pigeon' || a.kind === 'sparrow' || a.kind === 'chicken' || a.kind === 'crow' || a.kind === 'gull')) {
        // Pecking, in bursts.
        peck = Math.sin(a.phase + a.t * 0.9) > 0.1 ? 1 : 0;
      } else if (a.mode === 'idle' && a.kind === 'dog') {
        peck = Math.sin(a.phase + a.t * 1.3) > 0.4 ? 0.6 : 0;
      }
      l.anim.setXYZW(i, a.phase, rate, amp, peck);
      l.fold.setXYZW(i, spread, blink, 0, 0);
      l.tint.setXYZ(i, a.tint[0], a.tint[1], a.tint[2]);
    }
    for (const l of this.layers.values()) {
      const n = per.get(l.shape) ?? 0;
      l.mesh.count = n;
      if (n > 0) {
        l.mesh.instanceMatrix.needsUpdate = true;
        l.anim.needsUpdate = true;
        l.fold.needsUpdate = true;
        l.tint.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const l of this.layers.values()) {
      l.mesh.geometry.dispose();
      (l.mesh.material as THREE.Material).dispose();
    }
  }
}
