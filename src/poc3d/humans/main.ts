import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { FightMode, type Hand } from '../fight/fightMode';
import { CensorPass } from '../models/censorPass';
import { clipPace } from '../models/characterAnims';
import { Character, setCharacterEnvironment } from '../models/characters';
import { cityMaterial, cityUniforms } from '../real/city';
import { KIND, lin, MeshBuilder } from '../real/meshBuilder';
import { addFigure, GHOST_COLORS, GhostBuilder, ghostMaterial, registerMobModel, setMobLook, type FigureSpec } from '../real/people';
import { convertedDocs, CROWD, FAMILIES, shuffled, type Human } from './figures';

/**
 * The MakeHuman test (humans.html): every figure made with MakeHuman in one place, to try them as the city's
 * passers-by and as the people you fight. Mack isn't among them: he's the player, and stays in the model showroom.
 *
 * - **The street**: the generated crowd walking both ways along a street and standing about, as the mob does.
 * - **A line-up for each family**: the cast (the salaryman, the maid, Julie), women, men, students, children.
 * - **As Mack** (V): first person on that street, among them, with the fight page's fight (fight/fightMode.ts):
 *   the people who come at you are drawn from the figures here (the panel's Enemies).
 *
 * How they're drawn (K, the panel's Look): **as built**, the default: the textured models, the look of the salaryman
 * and the maid; or converted for the mob's material (what mob.html used to show), in **the mob's colours** or
 * **all black and see-through**. Only the first loads with the page; the conversions load when asked for.
 *
 * How the textured ones move (N, the panel's Movement): **clips from the animation library** fitted to each figure
 * (models/characterAnims.ts, cast.md: under review here), or the **procedural** idle and walk. `?anims=library|procedural`.
 *
 * `?look=original|mob|black`, `?view=<a view's name>`, `?light=studio|night|day`, `?crowd=<how many on the street>` (40),
 * `?enemies=salaryman|men|women|everyone`, `?fp=1` (and the fight's `?hand=`, `?gore=`, `?killmoves=`).
 * Orbiting: left-drag orbit, right-drag pan, wheel zoom, WASD / Q E fly (Shift faster), K look, L labels,
 * 1 studio / 2 night / 3 day, V first person.
 */

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const query = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // (PCFSoftShadowMap is removed in three: it swaps this in at the first render, recompiling every shadowed shader)
// (Counted over a whole frame, shadows and all, for the HUD.)
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(window.innerWidth, window.innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' });
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
// For scripted screenshots: __view(x, y, z, tx, ty, tz) puts the camera at (x, y, z) looking at (tx, ty, tz).
(window as unknown as { __view: (...v: number[]) => void }).__view = (x, y, z, tx, ty, tz) => {
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  controls.update();
};

// Lighting, as the fight page's: a key light with soft shadows (it follows the stage looked at), sky and ground
// fill, and three street lights for night (always there, only dimmed: a light added or removed recompiles every shader).
const hemi = new THREE.HemisphereLight();
const key = new THREE.DirectionalLight();
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 120 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.02;
const KEY_FROM = new THREE.Vector3(14, 30, 22);
const street = [new THREE.PointLight(0xffc98a, 0, 34, 1.6), new THREE.PointLight(0xffc98a, 0, 34, 1.6), new THREE.PointLight(0x9ac8ff, 0, 34, 1.6)];
street[0].position.set(-11, 5.5, -3);
street[1].position.set(9, 5.5, 1);
street[2].position.set(0, 5, 6);
scene.add(hemi, key, key.target, ...street);

const cityU = cityUniforms();
cityU.uLightGain.value = 0;
// Summer: no petals or leaves on the paving, so what's on the floor is blood.
cityU.uSeason.value = 1;
const city = cityMaterial(cityU);

// The ground: one paved slab under the street and the line-ups behind it (the floor is 0 everywhere).
const slab = new MeshBuilder();
slab.kind = KIND.plain;
slab.color = lin(0x8a867e);
slab.box(0, -65, -0.2, 0, 90, 170, KIND.sidewalk);
const slabMesh = new THREE.Mesh(slab.build()!, city);
slabMesh.receiveShadow = true;
scene.add(slabMesh);
const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 });
const wall = (w: number, h: number, x: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), concrete);
  m.position.set(x, h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
};

const pmrem = new THREE.PMREMGenerator(renderer);
const charEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
setCharacterEnvironment(charEnv);

// ---- Who stands where ----
/** Someone on a stage: where they stand (`yaw` 0 faces +z, the camera's side), or the loop they walk. */
interface Person {
  readonly human: Human;
  x: number;
  z: number;
  yaw: number;
  /** A walker: which of LOOPS, and how far round it (m). */
  readonly loop?: { readonly lane: number; s: number };
  /** The textured model, once it has loaded. */
  c: Character | null;
}
interface Stage {
  readonly name: string;
  readonly people: Person[];
  /** The textured figures. */
  readonly group: THREE.Group;
  /** What's behind them, and their labels: shown only when the stage is. */
  readonly backdrop: THREE.Group;
  readonly tags: CSS2DObject[];
  /** Where the key light looks. */
  readonly centre: THREE.Vector3;
  /** Its textured models have been asked for. */
  asked: boolean;
  /** The converted figures in the mob's material, once built. */
  mob: THREE.Mesh | null;
  triangles: number;
}
interface Item {
  readonly name: string;
  readonly stage: Stage;
  readonly at: THREE.Vector3;
  readonly size: number;
  readonly view: THREE.Vector3;
  readonly close?: boolean;
}
const stages: Stage[] = [];
const items: Item[] = [];
const newStage = (name: string, centre: THREE.Vector3): Stage => {
  const st: Stage = { name, people: [], group: new THREE.Group(), backdrop: new THREE.Group(), tags: [], centre, asked: false, mob: null, triangles: 0 };
  scene.add(st.group, st.backdrop);
  stages.push(st);
  return st;
};
const tag = (st: Stage, text: string, x: number, y: number, z: number): void => {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.position.set(x, y, z);
  st.backdrop.add(o);
  st.tags.push(o);
};

// The street: it runs east and west, a wall along its north side (a backdrop, and something to be slammed against).
// The walkers go round loops, each a lane east and the lane beside it back west with a turn at either end; a loop
// has one pace, so nobody walks through the one ahead.
const STREET = { half: 17, turn: 0.4, wallZ: -5.6 };
const LOOPS: readonly { z: number; speed: number }[] = [
  { z: -3.5, speed: 0.85 },
  { z: -2.1, speed: 1.2 },
  { z: -0.7, speed: 1.32 },
  { z: 0.7, speed: 1.25 },
  { z: 2.1, speed: 1.4 },
];
const LOOP_LENGTH = 2 * (2 * STREET.half + Math.PI * STREET.turn);
/** Where `s` metres round a loop is, and which way it's going there. */
function loopAt(z0: number, s: number): { x: number; z: number; yaw: number } {
  const { half, turn } = STREET;
  const straight = 2 * half;
  const arc = Math.PI * turn;
  s = ((s % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
  if (s < straight) return { x: -half + s, z: z0, yaw: Math.PI / 2 };
  s -= straight;
  if (s < arc) {
    const a = -Math.PI / 2 + s / turn;
    return { x: half + turn * Math.cos(a), z: z0 + turn + turn * Math.sin(a), yaw: Math.atan2(-Math.sin(a), Math.cos(a)) };
  }
  s -= arc;
  if (s < straight) return { x: half - s, z: z0 + 2 * turn, yaw: -Math.PI / 2 };
  const a = Math.PI / 2 + (s - straight) / turn;
  return { x: -half + turn * Math.cos(a), z: z0 + turn + turn * Math.sin(a), yaw: Math.atan2(-Math.sin(a), Math.cos(a)) };
}
// How many are on it: 40 to start (each textured figure is seven meshes of its own with a skeleton to pose, where the
// mob's whole crowd is one mesh: the HUD counts what a frame costs), `?crowd=` for more or fewer.
const CROWDS: readonly number[] = [20, 40, CROWD.length];
const crowdSize = Math.min(CROWD.length, Number(query.get('crowd')) > 0 ? Number(query.get('crowd')) : 40);
const streetStage = newStage('the street', new THREE.Vector3(0, 0, 0));
{
  const st = streetStage;
  st.backdrop.add(wall(2 * STREET.half + 8, 3.2, 0, STREET.wallZ));
  const crowd = shuffled(CROWD, 3).slice(0, crowdSize);
  // Every sixth stands about (by the wall, facing the street, or at the kerb opposite); the rest walk: the old and
  // the small in the slow loop, the others spread over the rest.
  const standing = crowd.filter((_, i) => i % 6 === 5);
  const walking = crowd.filter((_, i) => i % 6 !== 5);
  standing.forEach((human, i) => {
    const far = i % 3 === 2;
    const x = standing.length > 1 ? -14 + (28 * i) / (standing.length - 1) : 0;
    st.people.push({ human, x, z: far ? 4.4 : -4.6, yaw: (far ? Math.PI : 0) + (((i * 7) % 5) - 2) * 0.22, c: null });
  });
  const lanes: Human[][] = LOOPS.map(() => []);
  let next = 0;
  for (const human of walking) {
    if (human.body === 'elder' || human.body === 'child') lanes[0].push(human);
    else lanes[1 + (next++ % (LOOPS.length - 1))].push(human);
  }
  lanes.forEach((list, lane) => list.forEach((human, i) => st.people.push({ human, x: 0, z: 0, yaw: 0, loop: { lane, s: (i + ((lane * 0.37) % 1)) * (LOOP_LENGTH / list.length) }, c: null })));
  items.push({ name: 'the street', stage: st, at: new THREE.Vector3(0, 1, -0.5), size: 24, view: new THREE.Vector3(0, 0.34, 1).normalize() });
  items.push({ name: 'the street, as you walk it', stage: st, at: new THREE.Vector3(0, 1.4, -0.5), size: 8, view: new THREE.Vector3(0.9, 0.02, 0.42).normalize() });
  items.push({ name: 'the street, close', stage: st, at: new THREE.Vector3(-2, 1.1, -1.5), size: 7, view: new THREE.Vector3(0.15, 0.1, 1).normalize(), close: true });
}
// A line-up for each family, in rows facing you (orbit round for their backs), on ground of their own behind the street.
const UP = new THREE.Vector3(0, 0.3, 1).normalize();
const ABOVE = new THREE.Vector3(0, 0.62, 1).normalize();
const ROW = new THREE.Vector3(0, 0.2, 1).normalize();
FAMILIES.forEach((family, f) => {
  const z = -24 - f * 20;
  const PER = 10;
  const step = 1.0;
  const deep = 2.4;
  const rows = Math.ceil(family.humans.length / PER);
  const st = newStage(`${family.title} (${family.humans.length})`, new THREE.Vector3(0, 0, z - ((rows - 1) * deep) / 2));
  st.backdrop.add(wall(Math.min(family.humans.length, PER) * step + 6, 3.4, 0, z - (rows - 1) * deep - 2.2));
  family.humans.forEach((human, m) => {
    const r = Math.floor(m / PER);
    const n = Math.min(PER, family.humans.length - r * PER);
    const x = ((m % PER) - (n - 1) / 2) * step + (r % 2 ? step / 2 : 0);
    st.people.push({ human, x, z: z - r * deep, yaw: 0, c: null });
    tag(st, human.label, x, human.body === 'child' ? 1.6 : 2.05, z - r * deep);
  });
  items.push({ name: st.name, stage: st, at: new THREE.Vector3(0.6, 1, st.centre.z), size: Math.min(family.humans.length, PER) * step + 3.4 + (rows - 1) * 1.2, view: rows > 1 ? ABOVE : UP });
  for (let r = 0; r < rows && rows > 1; r++) items.push({ name: `${family.title}: row ${r + 1}`, stage: st, at: new THREE.Vector3(0.4, 1.0, z - r * deep), size: PER * step + 1.2, view: ROW, close: true });
  if (family.key === 'cast' || family.key === 'bijin') family.humans.forEach((human, m) => items.push({ name: `${human.label}: face`, stage: st, at: new THREE.Vector3(st.people[m].x, human.height ? human.height - 0.11 : human.male ? 1.6 : 1.47, z), size: 0.5, view: new THREE.Vector3(0.2, 0.05, 1).normalize(), close: true }));
});

// ---- The textured models: asked for a stage at a time, a few at once, standing where they belong as they arrive ----
const jobs: (() => Promise<void>)[] = [];
let running = 0;
let waiting = 0;
const pump = (): void => {
  while (running < 6 && jobs.length > 0) {
    running++;
    void jobs
      .shift()!()
      .catch((e: unknown) => console.warn('humans:', e))
      .finally(() => {
        running--;
        waiting--;
        pump();
      });
  }
};
const trianglesOf = (o: THREE.Object3D): number => {
  let n = 0;
  o.traverse((m) => {
    const g = (m as THREE.Mesh).geometry;
    if ((m as THREE.Mesh).isMesh && g) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return n;
};
// How the textured figures move: clips from the animation library, each fitted to the figure's own skeleton, or the
// procedural idle and walk they had before. Under review: the library is the one shown unless asked otherwise.
type Motion = 'library' | 'procedural';
const MOTIONS: readonly (readonly [Motion, string])[] = [['library', 'library clips'], ['procedural', 'procedural']];
let motion: Motion = query.get('anims') === 'procedural' ? 'procedural' : 'library';
// Who gets which: by their place in the stage's list, so the same figure keeps the same clip. The walks are real
// people's (Carnegie Mellon's motion capture: scripts/anims/cmu.mjs), each with the pace it was walked at: a walker
// gets one that suits its lane, so no clip is run far off the rate it was captured at. (The library's own two walks,
// Walk_Loop and Walk_Formal_Loop, were here first: the user found them angry, "stomping the ground with closed fists".)
// (105 is a woman, by her files' own header; the database doesn't say who the others are.)
const WALKS: readonly { clip: string; male?: boolean }[] = [
  { clip: 'Walk_12_Loop' },
  { clip: 'Walk_16_Loop' },
  { clip: 'Walk_35_Loop' },
  { clip: 'Walk_38_Loop' },
  { clip: 'Walk_69_Loop' },
  { clip: 'Walk_Normal_105_Loop', male: false },
  { clip: 'Walk_CasualQuick_105_Loop', male: false },
  { clip: 'Walk_Slow_105_Loop', male: false },
];
/** How far off its captured rate a walk may be run to keep a lane's pace before another is looked for. */
const RATES = [0.85, 1.2];
/** The walk for someone in a lane going at `speed`: one whose own pace on that figure is near it, of their own sex if there is one. */
async function walkFor(p: Person, i: number, speed: number): Promise<string> {
  const paces = await Promise.all(WALKS.map((w) => p.c!.pace(w.clip)));
  const rated = WALKS.map((w, k) => ({ ...w, rate: paces[k] > 0 ? speed / paces[k] : Infinity }));
  const near = rated.filter((w) => w.rate >= RATES[0] && w.rate <= RATES[1]);
  const own = near.filter((w) => w.male === undefined || w.male === p.human.male);
  const from = own.length > 0 ? own : near;
  if (from.length > 0) return from[i % from.length].clip;
  return rated.reduce((a, b) => (Math.abs(Math.log(b.rate)) < Math.abs(Math.log(a.rate)) ? b : a)).clip;
}
const STANDS: readonly string[] = ['Idle_TalkingPhone_Loop', 'Idle_FoldArms_Loop', 'Idle_Loop', 'Idle_Talking_Loop'];
/** Sets a figure moving the way `motion` says. A walker's clip runs at the rate that puts its feet at its lane's pace. */
async function setMoving(p: Person, i: number): Promise<void> {
  const c = p.c;
  if (!c) return;
  if (motion === 'procedural') {
    void c.play(null);
    return;
  }
  const clip = p.loop ? await walkFor(p, i, LOOPS[p.loop.lane].speed) : STANDS[i % STANDS.length];
  // (The library's idle is made with closed fists, which reads as angry: it plays with the hands open.)
  const action = await c.play(clip, 0, clip === 'Idle_Loop');
  // (The library takes a moment to arrive the first time: the setting may have changed meanwhile.)
  if (motion !== 'library') {
    void c.play(null);
    return;
  }
  if (!action) return;
  // Not all in step.
  action.time = ((i * 0.618) % 1) * action.getClip().duration;
  const pace = clipPace(action.getClip());
  if (p.loop && pace > 0) action.timeScale = LOOPS[p.loop.lane].speed / pace;
}
/** What the faces are doing, on the figures that have faces that move (the women made by hand). */
type Face = 'rest' | 'smile' | 'talk' | 'worry';
const FACES: readonly (readonly [Face, string])[] = [['rest', 'at rest'], ['smile', 'smiling'], ['talk', 'talking'], ['worry', 'worried']];
const FACE_MIX: Record<Face, Readonly<Record<string, number>> | null> = { rest: null, smile: { smile: 1 }, talk: { smile: 0.25 }, worry: { brow_sad: 0.9, squint: 0.2 } };
let face: Face = (FACES.find(([f]) => f === query.get('face'))?.[0] ?? 'rest') as Face;
function wearFace(c: Character): void {
  c.express(FACE_MIX[face]);
  c.talking = face === 'talk';
}
function setFace(f: Face): void {
  face = f;
  for (const st of stages) for (const p of st.people) if (p.c) wearFace(p.c);
}

function setMotion(m: Motion): void {
  motion = m;
  for (const st of stages) st.people.forEach((p, i) => void setMoving(p, i));
}

function askFor(st: Stage): void {
  if (st.asked) return;
  st.asked = true;
  st.people.forEach((p, i) => {
    if (!p.human.textured) return;
    waiting++;
    jobs.push(async () => {
      const c = await Character.load(p.human.name, i + 1);
      if (p.loop) {
        const L = LOOPS[p.loop.lane];
        c.walk = 1;
        c.cadence = L.speed / c.strideLength;
      }
      c.root.position.set(p.x, 0, p.z);
      c.root.rotation.y = p.yaw;
      st.group.add(c.root);
      st.triangles += trianglesOf(c.root);
      p.c = c;
      wearFace(c);
      void setMoving(p, i);
    });
  });
  pump();
}

// ---- The same figures converted for the mob's material (real/people.ts), built when first asked for ----
type Look = 'original' | 'mob' | 'black';
const LOOKS: readonly (readonly [Look, string])[] = [['original', 'as built (textured)'], ['mob', "the mob's colours"], ['black', 'all black, see-through']];
const lamp = new THREE.DataTexture(new Float32Array([1, 0.78, 0.5, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
lamp.needsUpdate = true;
const mobLight = { tLight: { value: lamp as THREE.Texture | null }, uLightRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uLightFade: { value: new THREE.Vector2(0, 0) }, uLightGain: { value: 0 } };
let ghost: THREE.ShaderMaterial | null = null;
let converting: Promise<void> | null = null;
/** The converted figures registered, the mob's material made (it takes their joints then), every stage's mesh built. */
function convert(): Promise<void> {
  converting ??= convertedDocs().then((docs) => {
    for (const doc of docs) registerMobModel(doc);
    ghost = ghostMaterial(mobLight);
    for (const st of stages) {
      const gb = new GhostBuilder();
      let n = 0;
      st.people.forEach((p, i) => {
        if (!p.human.converted) return;
        const base = { body: p.human.body, color: GHOST_COLORS[(i * 3 + 1) % GHOST_COLORS.length], hair: 'short', long: false, side: 1, look: 0, model: p.human.name } as const;
        let spec: FigureSpec;
        if (p.loop) {
          // (The material walks its own: out along the lane, a pause, and back.)
          const L = LOOPS[p.loop.lane];
          const dir = i % 2 ? 1 : -1;
          spec = { ...base, x: -dir * STREET.half + ((i * 1.9) % 5), z: L.z + (dir > 0 ? 0 : 2 * STREET.turn), pose: 'walk', yaw: dir * (Math.PI / 2), phase: (i * 0.37) % 1, fade: true, seed: (i * 0.618) % 1, walk: { ex: dir * 2 * STREET.half, ez: 0, speed: L.speed, gap: 0.5 + (i % 3) } };
        } else spec = { ...base, x: p.x, z: p.z, pose: st === streetStage && i % 2 ? 'phone' : 'stand', yaw: p.yaw, phase: 0.25, fade: st === streetStage, seed: (i * 0.37) % 1 };
        addFigure(gb, spec);
        n++;
      });
      if (n === 0) continue;
      st.mob = new THREE.Mesh(gb.build(0, 0)!, ghost);
      st.mob.frustumCulled = false;
      // (The mob stands on the city's pavements, 0.15 m up; the floor here is 0.)
      st.mob.position.y = -0.15;
      st.mob.visible = false;
      scene.add(st.mob);
    }
  });
  return converting;
}

// ---- Mack in first person on the street, with the fight ----
class StreetFight extends FightMode {
  /** The passers-by: not walls (a wall slam wants a wall). */
  protected override notWalls(): THREE.Object3D[] {
    return [...super.notWalls(), streetStage.group];
  }
}
const fp = new StreetFight(scene, camera, renderer.domElement, controls, charEnv, () => 0);
(window as unknown as { __fp: unknown }).__fp = fp.script();
(window as unknown as { __lab: unknown }).__lab = { THREE, scene, env: charEnv };

/** Who comes at you: the fight page's salaryman, or the men, the women or both from the crowd here (adults only). */
type Enemies = 'salaryman' | 'men' | 'women' | 'everyone';
const ENEMIES: readonly (readonly [Enemies, string])[] = [['salaryman', 'the salaryman'], ['men', 'men'], ['women', 'women'], ['everyone', 'men and women']];
const fighters = (who: Enemies): Human[] => {
  if (who === 'salaryman') return FAMILIES.flatMap((f) => f.humans).filter((h) => h.name === 'salaryman');
  const adults = FAMILIES.filter((f) => f.key === 'mm' || f.key === 'mw').flatMap((f) => f.humans).filter((h) => h.textured);
  return adults.filter((h) => who === 'everyone' || h.male === (who === 'men'));
};
let enemies: Enemies = 'salaryman';
let deals = 0;
/** Sets who you fight (picked again, other faces from the same set); a group there already is replaced. */
function setEnemies(who: Enemies): void {
  const pool = shuffled(fighters(who), ++deals);
  if (pool.length === 0) return;
  enemies = who;
  const had = fp.brawl.thugs.filter((t) => t.root.visible && t.tier === 'mook').length;
  fp.brawl.setCast(pool.map((h) => h.name), (pool.find((h) => h.male) ?? pool[0]).name);
  if (had > 0 && fp.active) fp.spawn(had);
}

// ---- Settings ----
type Mode = 'studio' | 'night' | 'day';
const MODES: readonly Mode[] = ['studio', 'night', 'day'];
let mode: Mode = MODES.find((m) => m === query.get('light')) ?? 'studio';
let look: Look = LOOKS.find(([l]) => l === query.get('look'))?.[0] ?? 'original';
let labelsOn = query.get('labels') !== '0';
let current: Stage = streetStage;

const apply = (): void => {
  const L = {
    studio: { bg: 0x2a2c30, hs: 0xdde4ee, hg: 0x4a4640, hi: 1.4, kc: 0xfff4e8, ki: 2.4, exp: 1.0, pts: 0, zen: 0x9aa4b4, hor: 0xc8ccd4, lamps: 0 },
    night: { bg: 0x05060a, hs: 0x3a4668, hg: 0x2a2018, hi: 0.25, kc: 0x9fb0ff, ki: 0.3, exp: 1.2, pts: 60, zen: 0x03050c, hor: 0x2c1e2a, lamps: 1 },
    day: { bg: 0x7aa4d4, hs: 0xbcd4f0, hg: 0x5a4e40, hi: 1.3, kc: 0xfff1dc, ki: 3.2, exp: 0.85, pts: 0, zen: 0x3f78c0, hor: 0xb8cfe0, lamps: 0 },
  }[mode];
  (scene.background as THREE.Color).setHex(L.bg);
  hemi.color.setHex(L.hs);
  hemi.groundColor.setHex(L.hg);
  hemi.intensity = L.hi;
  key.color.setHex(L.kc);
  key.intensity = L.ki;
  for (const p of street) p.intensity = L.pts;
  renderer.toneMappingExposure = L.exp;
  key.target.position.copy(current.centre);
  key.position.copy(current.centre).add(KEY_FROM);
  cityU.uZenith.value.setHex(L.zen);
  cityU.uHorizon.value.setHex(L.hor);
  cityU.uRoomAmbient.value.setHex(L.hs).multiplyScalar(L.hi * 0.12);
  cityU.uLamps.value = L.lamps;
  cityU.uLightGain.value = 1.4 * L.lamps;
  cityU.uNeon.value = mode === 'day' ? 0 : 1;
  cityU.uSunDir.value.copy(KEY_FROM).normalize();
  cityU.uSunCol.value.copy(key.color).multiplyScalar(key.intensity);
  mobLight.uLightGain.value = mode === 'night' ? 1.1 : 0;
  if (look === 'original') askFor(current);
  else if (!ghost) void convert().then(apply);
  if (ghost) {
    setMobLook(ghost, look === 'black' ? 'ghost' : 'color');
    // (A modelled figure's every fold would be a dark line with the district's denser edges: even all over.)
    ghost.uniforms.uEdge.value = 0;
  }
  for (const st of stages) {
    const on = st === current;
    st.backdrop.visible = on;
    st.group.visible = on && look === 'original';
    if (st.mob) st.mob.visible = on && look !== 'original';
    for (const t of st.tags) t.visible = on && labelsOn;
  }
  renderPanel();
};

// Post: HDR + MSAA -> bloom -> ACES, like the district; Mack's face censored on the finished image when his style
// asks (models/censorPass.ts): third person and a kill move's angle show his head.
const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.45, 1.6));
composer.addPass(new OutputPass());
const censor = new CensorPass();
composer.addPass(censor);

// Focus: glide the orbit target and camera to a view; its stage is the one shown.
let glide: { t0: number; from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3 } | null = null;
let viewed: Item = items[0];
const focus = (it: Item, now = false): void => {
  viewed = it;
  current = it.stage;
  apply();
  // Far enough to take in `size` metres across.
  const dist = (it.size / 2 / Math.tan((camera.fov * Math.PI) / 360) / Math.max(1, camera.aspect)) * 1.05 + 1;
  const cam = it.at.clone().addScaledVector(it.view, dist);
  if (now) {
    controls.target.copy(it.at);
    camera.position.copy(cam);
    controls.update();
    glide = null;
  } else glide = { t0: performance.now(), from: controls.target.clone(), to: it.at.clone(), camFrom: camera.position.clone(), camTo: cam };
};
(window as unknown as { __focus: (name: string) => boolean }).__focus = (name) => {
  const it = items.find((i) => i.name === name);
  if (it) focus(it, true);
  return !!it;
};

/** Into first person on the street (its south side, facing the wall), or back out to the view you had. */
const enterFp = async (): Promise<void> => {
  current = streetStage;
  apply();
  await fp.enter(0, 5.2, 0);
};
const leaveFp = (): void => {
  fp.exit();
  focus(viewed.stage === streetStage ? viewed : items[0], true);
};
const inFight = (fn: () => void): void => {
  if (fp.active) fn();
  else void enterFp().then(fn);
};

const HANDS: readonly (readonly [Hand, string])[] = [['gun', 'guns (1)'], ['fists', 'fists (2)'], ['katana', 'katana (3)']];
function renderPanel(): void {
  const panel = $('panel');
  panel.innerHTML = '';
  // A section's buttons share a row (in first person the panel can't be scrolled: the mouse is captured).
  let row: HTMLElement = panel;
  const section = (title: string): void => {
    const h = document.createElement('h3');
    h.textContent = title;
    panel.appendChild(h);
    row = document.createElement('div');
    row.className = 'row';
    panel.appendChild(row);
  };
  const button = (text: string, on: boolean, fn: () => void): void => {
    const b = document.createElement('button');
    b.textContent = text;
    if (on) b.className = 'on';
    b.onclick = fn;
    row.appendChild(b);
  };
  section('Look (K)');
  for (const [l, text] of LOOKS) {
    button(text, look === l, () => {
      look = l;
      apply();
    });
  }
  section('Movement (N)');
  for (const [m, text] of MOTIONS) button(text, motion === m, () => setMotion(m));
  section('Faces (the women made by hand)');
  for (const [f, text] of FACES) button(text, face === f, () => setFace(f));
  section('On the street');
  for (const n of CROWDS) {
    button(n === CROWD.length ? `all ${n}` : String(n), crowdSize === n, () => {
      const q = new URLSearchParams(location.search);
      q.set('crowd', String(n));
      location.search = q.toString();
    });
  }
  section('As Mack (V)');
  button(fp.active ? 'back to orbiting (V)' : 'walk the street, first person (V)', fp.active, () => (fp.active ? leaveFp() : void enterFp()));
  if (fp.active) button(fp.third ? 'third person (Q)' : 'first person (Q)', fp.third, () => (fp.third = !fp.third));
  section('Enemies');
  for (const [who, text] of ENEMIES) if (fighters(who).length > 0) button(text, enemies === who, () => setEnemies(who));
  section('In hand');
  for (const [h, text] of HANDS) button(text, fp.hand === h, () => inFight(() => fp.pick(h)));
  section('Against');
  for (const n of [1, 2, 4, 6]) button(n === 1 ? 'one' : `${n}${n === 4 ? ' (T)' : ''}`, false, () => inFight(() => fp.spawn(n)));
  button('a duel (B)', false, () => inFight(() => fp.duel()));
  button('nobody', false, () => inFight(() => fp.spawn(0)));
  section('Lighting');
  for (const m of MODES) {
    button(m, mode === m, () => {
      mode = m;
      apply();
    });
  }
  if (fp.active) {
    section('Keys');
    for (const line of fp.keyHelp()) {
      const p = document.createElement('p');
      p.textContent = line;
      row.appendChild(p);
    }
  } else {
    section('Views');
    for (const it of items) if (!it.close) button(it.name, viewed === it, () => focus(it));
    section('Close-ups');
    for (const it of items) if (it.close) button(it.name, viewed === it, () => focus(it));
    section('Labels (L)');
    button(labelsOn ? 'on' : 'off', labelsOn, () => {
      labelsOn = !labelsOn;
      apply();
    });
  }
  section('Elsewhere');
  button('→ the model showroom', false, () => (location.href = 'models.html'));
  button('→ the mob', false, () => (location.href = 'mob.html'));
  button('→ the fight test', false, () => (location.href = 'fight.html'));
}
/** What the panel shows that keys change, to redraw it when one does. */
const panelState = (): string => [fp.active, fp.third, fp.hand, enemies, look, motion, face, mode, labelsOn, viewed.name].join('|');
let panelShown = '';

const keys = new Set<string>();
// V from the orbiting view goes in (in first person the mode's own V comes out; `wasActive` is last frame's, so the
// V that came out isn't also read as going in).
let wasActive = false;
window.addEventListener('keydown', (e) => {
  if (fp.active || wasActive) return;
  keys.add(e.code);
  if (e.code === 'KeyV') void enterFp();
  else if (e.code === 'KeyK') look = LOOKS[(LOOKS.findIndex(([l]) => l === look) + 1) % LOOKS.length][0];
  else if (e.code === 'KeyL') labelsOn = !labelsOn;
  else if (e.code === 'KeyN') setMotion(motion === 'library' ? 'procedural' : 'library');
  else if (e.code === 'Digit1') mode = 'studio';
  else if (e.code === 'Digit2') mode = 'night';
  else if (e.code === 'Digit3') mode = 'day';
  else return;
  apply();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  labels.setSize(window.innerWidth, window.innerHeight);
});

{
  const who = ENEMIES.find(([w]) => w === query.get('enemies'))?.[0];
  if (who && who !== 'salaryman') setEnemies(who);
}
focus(items.find((i) => i.name === query.get('view')) ?? items[0], true);
if (query.get('fp') === '1') {
  void enterFp().then(() => {
    const hand = HANDS.find(([h]) => h === query.get('hand'))?.[0];
    if (hand) fp.pick(hand);
  });
}
// For scripts: what there is to look at, and how far along the loading is.
(window as unknown as { __humans: unknown }).__humans = {
  items: items.map((i) => i.name),
  stages,
  waiting: () => waiting,
  converted: () => !!ghost,
  look: (l: Look) => {
    look = l;
    apply();
  },
  enemies: setEnemies,
  motion: setMotion,
  face: setFace,
};

const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
let frameMs = 16;
let drawn = { calls: 0, triangles: 0 };
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  frameMs += (dt * 1000 - frameMs) * 0.05;
  // The stage shown goes about its business: the walkers round their loops, the rest idling.
  if (look === 'original') {
    for (const p of current.people) {
      if (!p.c) continue;
      if (p.loop) {
        const L = LOOPS[p.loop.lane];
        p.loop.s += L.speed * dt;
        const at = loopAt(L.z, p.loop.s);
        p.c.root.position.set(at.x, 0, at.z);
        p.c.root.rotation.y = at.yaw;
      }
      p.c.update(dt);
    }
  }
  wasActive = fp.active;
  if (fp.active) {
    // (First person is always the street's.)
    if (current !== streetStage) {
      current = streetStage;
      apply();
    }
    fp.update(dt);
  } else {
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 12 : 3.5) * dt;
    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, camera.up).normalize();
    const move = new THREE.Vector3();
    if (keys.has('KeyW')) move.add(fwd);
    if (keys.has('KeyS')) move.sub(fwd);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
    if (keys.has('KeyE')) move.y += 1;
    if (keys.has('KeyQ')) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      camera.position.add(move);
      controls.target.add(move);
      glide = null;
    }
    if (glide) {
      const t = Math.min(1, (performance.now() - glide.t0) / 500);
      const k = t * t * (3 - 2 * t);
      controls.target.lerpVectors(glide.from, glide.to, k);
      camera.position.lerpVectors(glide.camFrom, glide.camTo, k);
      if (t >= 1) glide = null;
    }
    controls.update();
  }
  const now = performance.now() / 1000;
  cityU.uTime.value = now;
  if (ghost) ghost.uniforms.uTime.value = now;
  censor.track(fp.body, camera);
  renderer.info.reset();
  composer.render(dt);
  drawn = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  labels.render(scene, camera);
  if (panelState() !== panelShown) {
    panelShown = panelState();
    renderPanel();
  }
  const there = current.people.filter((p) => (look === 'original' ? p.c : p.human.converted)).length;
  // (The nude body types were never built textured, and the cast never converted.)
  const missing = current.people.some((p) => (look === 'original' ? p.human.textured : p.human.converted)) ? '' : look === 'original' ? " · these exist only converted: K for the mob's looks" : ' · these exist only as built: K';
  const status = [
    `MAKEHUMAN TEST · ${current.name} · ${LOOKS.find(([l]) => l === look)![1]}${look === 'original' ? ` · moving by ${MOTIONS.find(([m]) => m === motion)![1]}` : ''} · ${mode}`,
    `${there} figures${missing}${look === 'original' ? ` · ${Math.round(current.triangles / 1000)}k triangles in them` : ''}${waiting > 0 ? ` · loading ${waiting} more` : ''}${look !== 'original' && !ghost ? ' · converting…' : ''} · a frame: ${drawn.calls} draw calls, ${(drawn.triangles / 1e6).toFixed(2)}M triangles (shadows too), ${frameMs.toFixed(1)} ms`,
  ];
  $('hud').textContent = fp.active
    ? `${status.join('\n')}\n${fp.hud()}`
    : `${status.join('\n')}\nleft-drag orbit · right-drag pan · wheel zoom · WASD / Q E fly (Shift faster) · K look · N movement · L labels · 1 studio · 2 night · 3 day · V walk the street as Mack`;
});
