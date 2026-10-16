import * as THREE from 'three';
import { clipPace } from '../models/characterAnims';
import { Character, prepareCharacter, registerCharacters } from '../models/characters';
import type { Thug, ThugOpts } from '../models/thug';
import { FAMILIES, shuffled, texturedUrl, type Human } from './figures';

/**
 * The fallen things of the dead hours that start from a MakeHuman body, for review on the MakeHuman test page (its
 * "dead hours" stage; story/mythos.md, The dead hours: 02:00 to 06:00, when the city stays in). Not in the city.
 *
 * - **The possessed**: the crowd's own figures (assets/humans/), loaded again under `possessed:<name>` with their
 *   colour drained, the skin ashen and the eyes black (`possessedLook`). Who's caught out after two becomes one (the
 *   user, 2026-10-16). They move wrong: the clip stutters (held, then jumped on, like a bad tape: `Stutter`), the head
 *   hangs to one side, an elbow bends the wrong way, a shoulder or the head twitches, and every head near you turns
 *   to you in jerks, further round than a neck goes. Some stand with their faces to the wall; one crawls.
 * - **Shades**: tall, too thin, faceless (scripts/blender/fallen_figures.py builds the shapes), drawn as a shadow
 *   whose edges come apart into smoke (`shadeMaterial`), casting no shadow. In first person they **stalk**: looked at
 *   for a moment, one is gone, and comes back somewhere you aren't looking, nearer each time; if one reaches you,
 *   the screen goes black for a moment.
 * - **A giant** (the bones at the Kasumi-chō site): built as tall as MakeHuman goes and scaled up again here.
 *
 * Demons proper (horns, wrong anatomy) are past MakeHuman, and wait for concept art.
 *
 * **They come for you** in first person (the page's fight, models/brawl.ts): a possessed you come near stops, stares,
 * and a moment later turns on you, the ones near it with it; it's the fight's fighter from then (`join`), still
 * stuttering (`Lurch`: held, then rushed on) with its head hung over and its twitches. The giant, near enough, is an
 * elite you duel. A shade can't be fought: its touch hurts (`hurt`), and looking at it is what keeps it off.
 */

/** The shades and the giant, as fallen_figures.py names them. */
export const SHADES = ['shade_bare', 'shade_hatman', 'shade_woman'] as const;
export const GIANT = 'giant_bare';
/** How much bigger than MakeHuman's tallest the giant is drawn (2.25 m built: some 3.4 m). */
const GIANT_SCALE = 1.5;

const ADULTS: readonly Human[] = FAMILIES.filter((f) => f.key === 'mm' || f.key === 'mw')
  .flatMap((f) => f.humans)
  .filter((h) => h.textured);
export const possessedName = (name: string): string => `possessed:${name}`;
/** The crowd's adults as the possessed: what the fight's Enemies can deal from. */
export const POSSESSED: readonly Human[] = ADULTS.filter((h) => texturedUrl(h.name)).map((h) => ({ ...h, name: possessedName(h.name), label: `possessed ${h.label}` }));
/** The shades that have been built, as fighters. */
export const SHADE_FIGHTERS: readonly Human[] = SHADES.filter((n) => texturedUrl(n)).map((name) => ({ name, label: name.slice('shade_'.length), male: name !== 'shade_woman', years: 30, body: name === 'shade_woman' ? 'woman' : 'man', textured: true, converted: false }));
export const giantBuilt = (): boolean => !!texturedUrl(GIANT);

// ---- How they look ----
const mats = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

/** Drains a material's colour toward grey (`amount`) and tints what's left, in its shader (the texture is shared). */
function drain(mat: THREE.MeshStandardMaterial, amount: number, tint: readonly [number, number, number], key: string): void {
  const t = tint.map((v) => v.toFixed(3)).join(', ');
  mat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), ${amount.toFixed(3)}) * vec3(${t});`,
    );
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
}

/** The possessed: the skin ashen and cold, the clothes gone grey, the eyes black. */
function possessedLook(model: THREE.Group): void {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.name.includes('high-poly')) {
      // The eyes black all over and wet (their own cut-out kept: the eye mesh is bigger than what shows of it).
      for (const mat of mats(m)) {
        drain(mat as THREE.MeshStandardMaterial, 1, [0.015, 0.015, 0.015], 'possessed-eyes');
        (mat as THREE.MeshStandardMaterial).roughness = 0.06;
      }
      return;
    }
    // (The loader drops the dot from the file's node names: "mw_001.body" is "mw_001body".)
    const skin = m.name.endsWith('body');
    for (const mat of mats(m)) drain(mat as THREE.MeshStandardMaterial, skin ? 0.85 : 0.72, skin ? [0.74, 0.8, 0.84] : [0.78, 0.8, 0.82], skin ? 'possessed-skin' : 'possessed-cloth');
  });
}

/** Time for the shades' smoke, shared by every shade. */
const SHADE_TIME = { value: 0 };
/** The fade of the shades that aren't on this stage (the fight's): never faded. */
const NO_FADE = { value: 0 };

/**
 * A shade's material, in place of `from`: near black, unlit by the environment, its edges (where the surface turns
 * away from you) eaten by a noise that drifts upward, so the outline smokes; `fade` 0 to 1 eats it all. Cut out, not
 * blended (no sorting); `from`'s alpha cards (the woman's hair) are kept as cards.
 */
function shadeMaterial(from: THREE.Material, fade: { value: number }): THREE.MeshStandardMaterial {
  const src = from as THREE.MeshStandardMaterial;
  const m = new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 1, metalness: 0 });
  m.envMapIntensity = 0;
  if (src.alphaTest > 0) {
    m.map = src.map;
    m.alphaTest = src.alphaTest;
    m.side = THREE.DoubleSide;
    m.alphaToCoverage = src.alphaToCoverage;
  }
  m.onBeforeCompile = (s) => {
    s.uniforms.uShadeFade = fade;
    s.uniforms.uShadeTime = SHADE_TIME;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShadePos;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n  vShadePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vShadePos;
uniform float uShadeFade;
uniform float uShadeTime;
float shadeHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float shadeNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(shadeHash(i), shadeHash(i + vec3(1, 0, 0)), f.x), mix(shadeHash(i + vec3(0, 1, 0)), shadeHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(shadeHash(i + vec3(0, 0, 1)), shadeHash(i + vec3(1, 0, 1)), f.x), mix(shadeHash(i + vec3(0, 1, 1)), shadeHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`,
      )
      .replace(
        '#include <alphatest_fragment>',
        `#include <alphatest_fragment>
  {
    vec3 p = vShadePos * 7.0 + vec3(0.0, -uShadeTime * 1.4, 0.0);
    float n = 0.6 * shadeNoise(p) + 0.4 * shadeNoise(p * 2.7 + 3.1);
    float edge = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
    if (n < pow(edge, 1.5) * 0.9 + uShadeFade * 1.15 - 0.08) discard;
  }`,
      )
      // A faint cold edge where it smokes, so it shows against the dark at all.
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  // (Faded out close by, where it would pick out a face: near, a shade is a hole in the dark.)
  totalEmissiveRadiance += vec3(0.07, 0.085, 0.11) * pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.5) * (1.0 - uShadeFade) * smoothstep(2.5, 9.0, length(vViewPosition));`,
      );
  };
  m.customProgramCacheKey = () => (m.map ? 'fallen-shade-card' : 'fallen-shade');
  return m;
}

/** Dresses a shade's model as a shade (each mesh its own material, all sharing `fade`); it casts no shadow. */
function dressShade(model: THREE.Object3D, fade: { value: number }): void {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map((x) => shadeMaterial(x, fade)) : shadeMaterial(m.material, fade);
    m.castShadow = false;
  });
}

// Registered as the module loads, before anything of them is loaded: the possessed as other names for the crowd's
// files, the shades' look on their own.
for (const h of ADULTS) {
  const url = texturedUrl(h.name);
  if (!url) continue;
  registerCharacters({ [possessedName(h.name)]: url });
  prepareCharacter(possessedName(h.name), possessedLook);
}
for (const n of SHADES) prepareCharacter(n, (m) => dressShade(m, NO_FADE));

// ---- How they move ----
const _p = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _a = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** Turns a bone by `angle` about `axis` (world), on top of its pose this frame. */
function turnWorld(bone: THREE.Bone | undefined, axis: THREE.Vector3, angle: number): void {
  if (!bone || angle === 0) return;
  bone.parent!.getWorldQuaternion(_p);
  _r.setFromAxisAngle(axis, angle);
  bone.quaternion.premultiply(_p.clone().invert().multiply(_r).multiply(_p));
}
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** The bones `pose` turns. */
const LAID = ['neck_01', 'head', 'clavicle_l', 'clavicle_r', 'lowerarm_l', 'lowerarm_r'] as const;

/**
 * A possessed figure's time: it runs, then holds still for a moment, then jumps on (the clip and the walk both),
 * like a tape with a fault. `step(dt)` is the time to move it by this frame.
 */
/**
 * A possessed's time in a fight: now and then it holds (its blow or its step stopped dead), then rushes on at two and
 * a half times the pace until it has caught up, so you can't read when the blow lands.
 */
class Lurch {
  private t: number;
  private held = 0;
  private owed = 0;
  constructor(private readonly rand: () => number) {
    this.t = 0.6 + rand() * 2;
  }
  step = (dt: number): number => {
    if (this.held > 0) {
      this.held -= dt;
      this.owed += dt;
      return 0;
    }
    if (this.owed > 0) {
      const extra = Math.min(this.owed, dt * 1.5);
      this.owed -= extra;
      return dt + extra;
    }
    this.t -= dt;
    if (this.t <= 0) {
      this.held = 0.1 + this.rand() * 0.45;
      this.t = 1 + this.rand() * 2.5;
    }
    return dt;
  };
}

/** How near you come before the possessed and the giant notice you (m), and how long they stare before they come. */
const NOTICE = { possessed: 6.5, giant: 9, stare: 0.8, spread: 7 } as const;
/** What a shade's touch takes of your health (Brawl's 100). */
const SHADE_TOUCH = 34;

class Stutter {
  private t: number;
  private held = 0;
  constructor(private readonly rand: () => number) {
    this.t = 0.4 + rand() * 2.5;
  }
  step(dt: number): number {
    if (this.held > 0) {
      this.held -= dt;
      // (Let go: on by what it should have done meanwhile, and a little more.)
      return this.held <= 0 ? 0.12 + this.rand() * 0.35 : 0;
    }
    this.t -= dt;
    if (this.t <= 0) {
      this.held = 0.12 + this.rand() * 0.7;
      this.t = 0.6 + this.rand() * 2.8;
    }
    return dt;
  }
}

type Act = 'wall' | 'stand' | 'walk' | 'crawl' | 'shade' | 'giant';
interface Fallen {
  readonly name: string;
  readonly act: Act;
  /** Where it belongs on the stage (local), and the way it faces there (0 faces +z, the viewer's side). */
  readonly home: { readonly x: number; readonly z: number; readonly yaw: number };
  x: number;
  z: number;
  yaw: number;
  /** A walker's way along its line (+1 east, -1 west), the line's ends, and its speed over the ground. */
  dir: number;
  readonly span: readonly [number, number];
  speed: number;
  c: Character | null;
  bones: Map<string, THREE.Bone>;
  /** The bones laid over (`pose`) as they were before any clip: put back each frame, since a clip may not set them. */
  readonly rest: Map<THREE.Bone, THREE.Quaternion>;
  readonly rand: () => number;
  readonly stutter: Stutter;
  /** The head's turn toward you now (radians), when it next jerks on toward where you are. */
  gaze: number;
  gazeIn: number;
  /** How far the head hangs over (radians); an elbow bent the wrong way (which, how far). */
  readonly tilt: number;
  readonly elbow: { readonly side: 'l' | 'r'; readonly angle: number } | null;
  /** A twitch: which part, how strong, how long ago it began; when the next comes. */
  twitch: { part: 'head' | 'clavicle_l' | 'clavicle_r'; amount: number; t: number } | null;
  twitchIn: number;
  /** A shade's own fade, and what it's doing in the stalk. */
  readonly fade: { value: number };
  stalk: 'there' | 'going' | 'gone' | 'coming';
  seenFor: number;
  /** How long it has stood unseen, and how long it waits so before it comes nearer anyway. */
  unseenFor: number;
  patience: number;
  goneFor: number;
  /** Seconds left of the stare before it comes for you (Infinity: it hasn't noticed you); the fighter it became. */
  wakeIn: number;
  joined: boolean;
  thug: Thug | null;
}

/** The night lamps of the dead hours' street, on the stage (the page's three street lights are moved onto them). */
export const DEAD_LAMPS: readonly THREE.Vector3[] = [new THREE.Vector3(-11, 5.5, -3), new THREE.Vector3(9, 5.5, 1), new THREE.Vector3(0, 5, 6)];
/** The street: x from -W to W, the buildings' face on the north side at z = NORTH, an alley going off it at x = ALLEY. */
const W = 22;
const NORTH = -5.6;
const ALLEY = -6;

/** The dead hours' street with its fallen on it: a stage of the MakeHuman test page. */
export class DeadHours {
  readonly people: Fallen[] = [];
  triangles = 0;
  loaded = 0;
  /** Shades stalk you in first person (looked at, gone; back where you aren't looking, nearer). */
  stalk = true;
  touched = 0;
  private asked = false;
  /** The page's fight: a fighter of `name` standing at (x, z) facing `yaw` (Brawl.join); you hurt (Brawl.hurt). */
  join: ((name: string, x: number, z: number, yaw: number, opts: ThugOpts) => Promise<Thug | null>) | null = null;
  hurt: ((damage: number, what: string) => void) | null = null;
  private readonly flash: HTMLDivElement;
  private flashT = 9;
  private readonly fwd = new THREE.Vector3();

  constructor(
    private readonly group: THREE.Group,
    backdrop: THREE.Group,
    readonly centre: THREE.Vector3,
    overlay: HTMLElement,
  ) {
    this.buildSet(backdrop);
    this.flash = document.createElement('div');
    Object.assign(this.flash.style, { position: 'fixed', inset: '0', pointerEvents: 'none', opacity: '0', zIndex: '7', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.92) 20%, rgba(0,0,0,1) 75%)' });
    overlay.appendChild(this.flash);
    const add = (name: string, act: Act, x: number, z: number, yaw: number, span: readonly [number, number] = [x, x]): void => {
      let r = (this.people.length + 1) * 7919;
      const own = (): number => {
        r = (r * 9301 + 49297) % 233280;
        return r / 233280;
      };
      const possessed = act !== 'shade' && act !== 'giant';
      const side = own() < 0.5 ? 'l' : 'r';
      this.people.push({
        name,
        act,
        home: { x, z, yaw },
        x,
        z,
        yaw,
        dir: Math.sin(yaw) >= 0 ? 1 : -1,
        span,
        speed: 0,
        c: null,
        bones: new Map(),
        rest: new Map(),
        rand: own,
        stutter: new Stutter(own),
        gaze: 0,
        gazeIn: own(),
        tilt: possessed ? (own() < 0.5 ? -1 : 1) * (0.3 + own() * 0.4) : act === 'shade' ? 0.12 : 0,
        // (One in three of the possessed has an elbow bent backwards.)
        elbow: possessed && own() < 0.34 ? { side, angle: 0.45 + own() * 0.35 } : null,
        twitch: null,
        twitchIn: 1 + own() * 3,
        fade: { value: 0 },
        stalk: 'there',
        seenFor: 0,
        unseenFor: 0,
        patience: 3 + own() * 3,
        goneFor: 0,
        wakeIn: Infinity,
        joined: false,
        thug: null,
      });
    };
    const cast = shuffled(POSSESSED, 11).map((h) => h.name);
    let k = 0;
    const next = (): string => cast[k++ % cast.length];
    if (cast.length > 0) {
      // Faces to the wall, under the buildings.
      for (const x of [-15, -10.5, 13]) add(next(), 'wall', x, NORTH + 0.55, Math.PI);
      // Standing in the road.
      add(next(), 'stand', -3, 0.6, 0.35);
      add(next(), 'stand', 6, -1.4, -0.5);
      // Walking, each its own line back and forth.
      add(next(), 'walk', -12, -3, Math.PI / 2, [-16, 15]);
      add(next(), 'walk', 10, -1.6, -Math.PI / 2, [-14, 16]);
      add(next(), 'walk', -4, 2, Math.PI / 2, [-17, 12]);
      add(next(), 'walk', 4, 3.4, -Math.PI / 2, [-12, 17]);
      // Crawling along the kerb.
      add(next(), 'crawl', -8, 5, Math.PI / 2, [-18, 18]);
    }
    const shades = SHADE_FIGHTERS.map((h) => h.name);
    if (shades.includes('shade_bare')) add('shade_bare', 'shade', 19.5, -1, -Math.PI / 2);
    if (shades.includes('shade_hatman')) add('shade_hatman', 'shade', ALLEY, NORTH - 1.4, 0);
    if (shades.includes('shade_woman')) add('shade_woman', 'shade', 9, 2.4, 0.15);
    if (giantBuilt()) add(GIANT, 'giant', -18.5, -2.4, Math.PI / 2, [-20, -9]);
  }

  /** The street: wet asphalt, the buildings' faces on the north side with an alley between, kerbs, lamp posts. */
  private buildSet(backdrop: THREE.Group): void {
    const at = (o: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => {
      o.position.set(this.centre.x + x, y, this.centre.z + z);
      return o;
    };
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = m.receiveShadow = true;
      backdrop.add(at(m, x, y, z));
    };
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.32, metalness: 0 });
    const pavement = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.55 });
    const building = new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.9 });
    const shutter = new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.3 });
    const post = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.5, metalness: 0.4 });
    const bulb = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * W + 10, 26), asphalt);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    backdrop.add(at(ground, 0, 0, 2));
    // The pavement under the buildings, and the kerb opposite.
    box(2 * W + 10, 0.15, 1.6, pavement, 0, 0.075, NORTH + 0.8);
    box(2 * W + 10, 0.15, 1.6, pavement, 0, 0.075, 7.2);
    // The buildings, the alley between them going off north.
    const left = ALLEY - 1.2 - (-W - 5);
    const right = W + 5 - (ALLEY + 1.2);
    box(left, 9, 0.6, building, -W - 5 + left / 2, 4.5, NORTH - 0.3);
    box(right, 9, 0.6, building, ALLEY + 1.2 + right / 2, 4.5, NORTH - 0.3);
    box(0.6, 9, 10, building, ALLEY - 1.5, 4.5, NORTH - 5.3);
    box(0.6, 9, 10, building, ALLEY + 1.5, 4.5, NORTH - 5.3);
    // Shutters down on the shops.
    for (const x of [-18, -13, -1.5, 3.5, 12, 17]) box(3.4, 2.6, 0.05, shutter, x, 1.3, NORTH + 0.03);
    // Lamp posts under the night's lights.
    for (const l of DEAD_LAMPS) {
      box(0.14, l.y, 0.14, post, l.x, l.y / 2, l.z);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), bulb);
      backdrop.add(at(b, l.x, l.y + 0.1, l.z));
    }
  }

  /** Loads everyone (once). */
  load(): void {
    if (this.asked) return;
    this.asked = true;
    for (const f of this.people) void this.loadOne(f).catch((e: unknown) => console.warn('dead hours:', f.name, e));
  }

  get waiting(): number {
    return this.asked ? this.people.length - this.loaded : 0;
  }

  private async loadOne(f: Fallen): Promise<void> {
    const c = await Character.load(f.name, this.people.indexOf(f) + 1);
    f.c = c;
    c.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) f.bones.set(o.name, o as THREE.Bone);
    });
    for (const n of LAID) {
      const b = f.bones.get(n);
      if (b) f.rest.set(b, b.quaternion.clone());
    }
    if (f.act === 'shade') dressShade(c.root, f.fade);
    if (f.act === 'giant') c.root.scale.setScalar(GIANT_SCALE);
    this.place(f);
    this.group.add(c.root);
    c.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) this.triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    });
    this.loaded++;
    // What each does: the possessed idle slowly or walk (the captured walks, slowed), or crawl; the shades keep the
    // procedural idle, run slow; the giant walks the library's heavy walk (fists closed, stamping: turned down for
    // people as angry, cast.md, and right for him), slowly.
    const clip = { wall: 'Idle_Loop', stand: 'Idle_Loop', walk: ['Walk_35_Loop', 'Walk_16_Loop', 'Walk_69_Loop', 'Walk_12_Loop'][this.people.indexOf(f) % 4], crawl: 'Crawl_Fwd_Loop', shade: null, giant: 'Walk_Loop' }[f.act];
    const action = clip ? await c.play(clip, 0, true) : null;
    if (!action) return;
    action.time = f.rand() * action.getClip().duration;
    action.timeScale = f.act === 'walk' ? 0.8 : f.act === 'crawl' ? 0.7 : f.act === 'giant' ? 0.55 : 0.5;
    // (The pace is the model's own: the giant's is scaled up with him.)
    const pace = clipPace(action.getClip()) * (f.act === 'giant' ? GIANT_SCALE : 1);
    f.speed = f.act === 'walk' || f.act === 'crawl' || f.act === 'giant' ? (pace > 0 ? pace * action.timeScale : f.act === 'crawl' ? 0.35 : 0.9) : 0;
  }

  private place(f: Fallen): void {
    if (!f.c) return;
    f.c.root.position.set(this.centre.x + f.x, 0, this.centre.z + f.z);
    f.c.root.rotation.y = f.yaw;
  }

  /** Back where they belong (the stalk undone). */
  reset(): void {
    for (const f of this.people) {
      f.x = f.home.x;
      f.z = f.home.z;
      f.yaw = f.home.yaw;
      f.fade.value = 0;
      f.stalk = 'there';
      f.seenFor = 0;
      f.wakeIn = Infinity;
      f.joined = false;
      f.thug = null;
      if (f.c) f.c.root.visible = true;
      this.place(f);
    }
  }

  /** Whether a point is in the camera's view (near enough: within its cone). */
  private inView(camera: THREE.PerspectiveCamera, p: THREE.Vector3): boolean {
    camera.getWorldDirection(this.fwd);
    _a.copy(p).sub(camera.position);
    const d = _a.length();
    if (d < 1e-3) return true;
    const half = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    return Math.acos(THREE.MathUtils.clamp(_a.dot(this.fwd) / d, -1, 1)) < half * 0.9;
  }

  /** Moves them on by dt: the possessed by their stutter, the shades by the stalk when `hunting` (first person). */
  update(dt: number, camera: THREE.PerspectiveCamera, hunting: boolean): void {
    SHADE_TIME.value += dt;
    this.flashT += dt;
    this.flash.style.opacity = String(Math.max(0, 1 - this.flashT / 1.4));
    const stalking = hunting && this.stalk;
    for (const f of this.people) {
      const c = f.c;
      if (!c || f.joined) continue;
      const possessed = f.act !== 'shade' && f.act !== 'giant';
      if (hunting && f.act !== 'shade') this.notice(f, dt, camera);
      if (f.joined) continue;
      const staring = f.wakeIn < Infinity;
      const step = possessed ? f.stutter.step(dt) : f.act === 'shade' ? dt * 0.35 : dt;
      if (!staring && (f.act === 'walk' || f.act === 'crawl' || f.act === 'giant')) {
        f.x += f.dir * f.speed * step;
        if (f.x > f.span[1] || f.x < f.span[0]) {
          f.dir = -f.dir;
          f.x = THREE.MathUtils.clamp(f.x, f.span[0], f.span[1]);
          f.yaw = f.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
      }
      if (f.act === 'shade') this.stalkStep(f, dt, camera, stalking);
      this.place(f);
      for (const [b, q] of f.rest) b.quaternion.copy(q);
      c.update(step);
      this.pose(f, dt, camera, possessed);
    }
  }

  /** What's laid over the clip: the head hung over, the wrong elbow, twitches, and the head turned toward you. */
  private pose(f: Fallen, dt: number, camera: THREE.PerspectiveCamera, possessed: boolean): void {
    const b = f.bones;
    const fwd = new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    const right = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
    // Toward you: how far round from the way it faces (the head of a possessed goes further than a neck can).
    const root = f.c!.root.position;
    const dx = camera.position.x - root.x;
    const dz = camera.position.z - root.z;
    const range = possessed ? 16 : 30;
    const want = Math.hypot(dx, dz) < range ? THREE.MathUtils.clamp(wrap(Math.atan2(dx, dz) - f.yaw), possessed ? -2.1 : -1.3, possessed ? 2.1 : 1.3) : 0;
    if (possessed && f.wakeIn < Infinity) f.gaze = want;
    else if (possessed) {
      // In jerks: held, then most of the way at once.
      f.gazeIn -= dt;
      if (f.gazeIn <= 0) {
        f.gaze += (want - f.gaze) * 0.7;
        f.gazeIn = 0.12 + f.rand() * 0.3;
      }
    } else f.gaze += (want - f.gaze) * Math.min(1, dt * (f.act === 'giant' ? 0.8 : 1.5));
    turnWorld(b.get('neck_01'), fwd, f.tilt * 0.6);
    turnWorld(b.get('head'), fwd, f.tilt * 0.4);
    if (f.act === 'shade') turnWorld(b.get('head'), right, 0.25);
    turnWorld(b.get('neck_01'), UP, f.gaze * 0.35);
    turnWorld(b.get('head'), UP, f.gaze * 0.65);
    if (f.elbow) turnWorld(b.get(`lowerarm_${f.elbow.side}`), right, f.elbow.angle);
    if (!possessed) return;
    f.twitchIn -= dt;
    if (f.twitchIn <= 0) {
      const parts = ['head', 'clavicle_l', 'clavicle_r'] as const;
      f.twitch = { part: parts[Math.floor(f.rand() * 3)], amount: (f.rand() < 0.5 ? -1 : 1) * (0.25 + f.rand() * 0.3), t: 0 };
      f.twitchIn = 1.5 + f.rand() * 4;
    }
    if (f.twitch) {
      f.twitch.t += dt;
      const k = f.twitch.t < 0.05 ? f.twitch.t / 0.05 : Math.max(0, 1 - (f.twitch.t - 0.05) / 0.25);
      turnWorld(b.get(f.twitch.part), fwd, f.twitch.amount * k);
      if (k <= 0 && f.twitch.t > 0.05) f.twitch = null;
    }
  }

  /** A shade in the stalk: looked at for a moment it goes; back where you aren't looking, nearer; at arm's length, the dark. */
  private stalkStep(f: Fallen, dt: number, camera: THREE.PerspectiveCamera, stalking: boolean): void {
    const c = f.c!;
    if (!stalking) {
      if (f.stalk !== 'there' || f.x !== f.home.x || f.z !== f.home.z) {
        f.stalk = 'there';
        f.x = f.home.x;
        f.z = f.home.z;
        f.yaw = f.home.yaw;
        f.fade.value = 0;
        c.root.visible = true;
      }
      return;
    }
    const head = c.root.position.clone();
    head.y = 1.9;
    const dist = Math.hypot(camera.position.x - head.x, camera.position.z - head.z);
    if (f.stalk === 'there') {
      const seen = this.inView(camera, head);
      f.seenFor = seen ? f.seenFor + dt : Math.max(0, f.seenFor - dt);
      f.unseenFor = seen ? 0 : f.unseenFor + dt;
      // Looked at, it goes; left unseen long enough, it goes too, and comes back nearer.
      if (f.seenFor > 0.35 || (f.unseenFor > f.patience && dist > 3)) {
        f.stalk = 'going';
        f.unseenFor = 0;
      } else if (dist < 1.3) {
        // It reached you.
        this.touched++;
        this.flashT = 0;
        this.hurt?.(SHADE_TOUCH, 'a shade reached you');
        f.stalk = 'going';
      }
    } else if (f.stalk === 'going') {
      f.fade.value = Math.min(1, f.fade.value + dt / 0.3);
      if (f.fade.value >= 1) {
        f.stalk = 'gone';
        f.goneFor = 1.5 + f.rand() * 2.5;
        c.root.visible = false;
      }
    } else if (f.stalk === 'gone') {
      f.goneFor -= dt;
      if (f.goneFor <= 0) {
        this.reappear(f, camera, dist);
        f.stalk = 'coming';
        f.seenFor = 0;
        c.root.visible = true;
      }
    } else {
      f.fade.value = Math.max(0, f.fade.value - dt / 0.8);
      if (f.fade.value <= 0) f.stalk = 'there';
    }
  }

  /** Somewhere on the street you aren't looking, nearer than it was (never nearer than 2.5 m), facing you. */
  private reappear(f: Fallen, camera: THREE.PerspectiveCamera, was: number): void {
    const want = THREE.MathUtils.clamp(was * 0.7, 2.5, 18);
    const cx = camera.position.x - this.centre.x;
    const cz = camera.position.z - this.centre.z;
    const spots: { x: number; z: number; score: number }[] = [];
    const p = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      for (const r of [want, want * 1.3]) {
        const a = (i / 16) * Math.PI * 2 + f.rand() * 0.3;
        const x = cx + Math.sin(a) * r;
        const z = cz + Math.cos(a) * r;
        if (Math.abs(x) > W - 1 || z < NORTH + 0.5 || z > 6.6) continue;
        p.set(this.centre.x + x, 1.9, this.centre.z + z);
        if (this.inView(camera, p)) continue;
        spots.push({ x, z, score: Math.abs(r - want) + f.rand() });
      }
    }
    spots.sort((a, b) => a.score - b.score);
    const s = spots[0] ?? { x: f.home.x, z: f.home.z };
    f.x = s.x;
    f.z = s.z;
    f.yaw = Math.atan2(cx - s.x, cz - s.z);
  }

  /**
   * In first person: near enough, it notices you and stares (the ones near it notice with it, a moment apart); the
   * stare over, it comes for you: the street's figure is put away and the fight's fighter takes its place.
   */
  private notice(f: Fallen, dt: number, camera: THREE.PerspectiveCamera): void {
    if (!this.join) return;
    const giant = f.act === 'giant';
    if (f.wakeIn === Infinity) {
      const d = Math.hypot(camera.position.x - (this.centre.x + f.x), camera.position.z - (this.centre.z + f.z));
      if (d > (giant ? NOTICE.giant : NOTICE.possessed)) return;
      f.wakeIn = NOTICE.stare;
      if (!giant)
        for (const o of this.people)
          if (o !== f && o.act !== 'shade' && o.act !== 'giant' && o.wakeIn === Infinity && Math.hypot(o.x - f.x, o.z - f.z) < NOTICE.spread) o.wakeIn = NOTICE.stare + 0.2 + o.rand() * 0.9;
      return;
    }
    f.wakeIn -= dt;
    if (f.wakeIn > 0) return;
    f.joined = true;
    f.c!.root.visible = false;
    const x = this.centre.x + f.x;
    const z = this.centre.z + f.z;
    const yaw = Math.atan2(camera.position.x - x, camera.position.z - z);
    const opts: ThugOpts = giant ? { tier: 'elite', weapon: 'fists', name: '巨人 Giant', scale: GIANT_SCALE } : { name: 'the possessed' };
    void this.join(f.name, x, z, yaw, opts).then((t) => {
      if (!t) return;
      f.thug = t;
      if (giant) return;
      t.warp = new Lurch(f.rand).step;
      t.afterPose = () => this.possess(f, t);
    });
  }

  /** Over a possessed fighter's pose: the head hung over, and its twitches. */
  private possess(f: Fallen, t: Thug): void {
    const fwd = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw));
    turnWorld(t.bone('neck_01'), fwd, f.tilt * 0.6);
    turnWorld(t.bone('head'), fwd, f.tilt * 0.4);
    f.twitchIn -= 1 / 60;
    if (f.twitchIn <= 0) {
      const parts = ['head', 'clavicle_l', 'clavicle_r'] as const;
      f.twitch = { part: parts[Math.floor(f.rand() * 3)], amount: (f.rand() < 0.5 ? -1 : 1) * (0.25 + f.rand() * 0.3), t: 0 };
      f.twitchIn = 1.5 + f.rand() * 4;
    }
    if (f.twitch) {
      f.twitch.t += 1 / 60;
      const k = f.twitch.t < 0.05 ? f.twitch.t / 0.05 : Math.max(0, 1 - (f.twitch.t - 0.05) / 0.25);
      turnWorld(t.bone(f.twitch.part), fwd, f.twitch.amount * k);
      if (k <= 0 && f.twitch.t > 0.05) f.twitch = null;
    }
  }

  /** One line for the HUD. */
  status(): string {
    const n = (act: Act[]): number => this.people.filter((f) => act.includes(f.act)).length;
    const coming = this.people.filter((f) => f.joined).length;
    return `${n(['wall', 'stand', 'walk', 'crawl'])} possessed, ${n(['shade'])} shades${n(['giant']) ? ', a giant' : ''}${coming ? ` · ${coming} came for you` : ''} · shades ${this.stalk ? 'stalk you in first person' : 'stand still'}${this.touched ? ` · reached you ${this.touched}×` : ''}`;
  }
}
