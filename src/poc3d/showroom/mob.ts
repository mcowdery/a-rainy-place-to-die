import './nav';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EMOTE_MARKS, EMOTE_RATE, Emotes } from '../real/emotes';
import { isBare } from '../district/peopleMix';
import { CHARACTERS, registerCharacters, registerVariant } from '../real/mobCharacters';
import { Poser } from './poser';
import type { FigureShape } from '../real/mobShape';
import { setShapedHeadScale } from '../real/mobShape';
import { packFigures } from '../real/people';
import { CrowdSmoke } from '../real/smoke';
import { CITIES } from '../district/cityConfig';
import { addFigure, characterMaterial, figureMesh, holdHands, GHOST_COLORS, GhostBuilder, ghostMaterial, MOB_LOOK_NAMES, setMobLook, setMobShape, setSkinTone, type Body, type FigureSpec, type Hair, type MobLook, type MobShape, type Pose } from '../real/people';

/**
 * The mob's showroom (mob.html): the city's passers-by (real/people.ts) on their own, apart from the model
 * showroom, so they load at once. Both generations stand in the same places: the shaped one under review
 * (real/mobShape.ts) and the classic one the district draws; M switches, or shows both (the classic a row behind).
 * Rows: each body turned round, women's hair, the others' hair, the poses, the outfits front and back, and a street
 * of people walking and standing as they do in the city (fading in and out).
 * Mouse: left-drag orbit, right-drag pan, wheel zoom. Keys: WASD / Q E fly (Shift faster), M generation,
 * 1 studio / 2 day / 3 night, K the mob's look, C one colour for everyone or each their own, N skin, T still or going about their routine, L labels,
 * X wireframe, R turntable.
 */

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const query = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(window.innerWidth, window.innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' });
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.52;
// For scripted screenshots: __view(x, y, z, tx, ty, tz) puts the camera at (x, y, z) looking at (tx, ty, tz).
(window as unknown as { __view: (...v: number[]) => void }).__view = (x, y, z, tx, ty, tz) => {
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  controls.update();
};

// The floor: the pavement the mob stands on (0.15 m up, as in the city), unlit.
const FLOOR_Y = 0.15;
const floorMat = new THREE.MeshBasicMaterial();
const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), floorMat);
floor.position.y = FLOOR_Y;
scene.add(floor);

// The mob's material, with a street light of its own for the night (the district lights them from its lightmap).
const lamp = new THREE.DataTexture(new Float32Array([1, 0.78, 0.5, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
lamp.needsUpdate = true;
const light = { tLight: { value: lamp as THREE.Texture | null }, uLightRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uLightFade: { value: new THREE.Vector2(0, 0) }, uLightGain: { value: 0 } };
// (Manila's page, mob-ph.html: the crowd's deeper tan there, a shader constant set before the material is built.)
if (document.body.dataset.page === 'ph') setSkinTone(CITIES.manila.skin);
// (The characters' page: the same material with their fingers' and toes' bones posed.)
const ghost = document.body.dataset.page === 'characters' ? characterMaterial(light) : ghostMaterial(light);

// ---- Who stands where ----
type Spec = Partial<FigureSpec> & Pick<FigureSpec, 'x' | 'z' | 'body' | 'pose'>;
interface Item {
  readonly name: string;
  readonly at: THREE.Vector3;
  readonly size: number;
  readonly view: THREE.Vector3;
  /** A close-up (listed apart in the panel). */
  readonly close?: boolean;
}
const LEVEL = new THREE.Vector3(0, 0.04, 1).normalize();
const people: Spec[] = [];
const tags: [string, number, number, number][] = [];
/** Characters built another way for a stage to compare: [the figure's name, the character it's of, what differs]. */
const variants: [string, string, FigureShape][] = [];
const items: Item[] = [];
const DEFAULT_HAIR: Record<Body, Hair> = { man: 'short', woman: 'long', child: 'short', elder: 'short' };
const tone = (i: number): FigureSpec['color'] => GHOST_COLORS[i % GHOST_COLORS.length];
const DZ = 3.6;
let row = 0;
// (Rows go back from the camera, so the first stands in front.)
const rowZ = (): number => -row++ * DZ;
// A backdrop behind each row, so it's seen on its own.
const wallMat = new THREE.MeshBasicMaterial();
const walls: THREE.Mesh[] = [];
const wall = (z: number): void => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 3.4), wallMat);
  m.position.set(0, FLOOR_Y + 1.7, z - 2.3);
  scene.add(m);
  walls[stage] = m;
};
// Each row is a stage of its own: looking at one, the others are put away ('everything' brings them all back).
let stage = 0;
const stageOf = { people: [] as number[], tags: [] as number[], items: [] as number[] };
// Three pages share this file: mob.html (the crowd), characters.html (named characters built on the crowd's bodies,
// and the bare body they start from) and mob-ph.html (Manila's Filipino outfits, in Manila's skin tone). A stage belongs
// to the page set when it ends; the other pages' are not built.
type Page = 'mob' | 'characters' | 'ph';
const PAGE: Page = document.body.dataset.page === 'characters' ? 'characters' : document.body.dataset.page === 'ph' ? 'ph' : 'mob';
let stageFor: Page = 'mob';
const stagePages: Page[] = [];
const endStage = (): void => {
  stagePages[stage] = stageFor;
  while (stageOf.people.length < people.length) stageOf.people.push(stage);
  while (stageOf.tags.length < tags.length) stageOf.tags.push(stage);
  while (stageOf.items.length < items.length) stageOf.items.push(stage);
  stage++;
};

// (The figures modelled with MakeHuman have a page of their own: humans.html, src/poc3d/humans/.)
// Each body turned round.
{
  const z = rowZ();
  wall(z);
  const YAWS: [string, number][] = [['front', 0], ['3/4', 0.8], ['side', Math.PI / 2], ['3/4 back', 2.35], ['back', Math.PI]];
  const step = 1.15, gap = 1.6;
  const w = YAWS.length * step;
  // The four bodies, and the teens: whoever wears the school uniform (the sculpted figures build them shorter and slighter).
  const WHO: [string, Body, Partial<FigureSpec>][] = [['man', 'man', {}], ['woman', 'woman', {}], ['schoolboy', 'man', { outfit: 'school' }], ['schoolgirl', 'woman', { outfit: 'school', hair: 'ponytail' }], ['child', 'child', {}], ['elder', 'elder', {}]];
  const x0 = -(WHO.length * w + (WHO.length - 1) * gap) / 2 + step / 2;
  WHO.forEach(([name, body, extra], b) => {
    YAWS.forEach(([, yaw], i) => people.push({ x: x0 + b * (w + gap) + i * step, z, body, pose: 'stand', yaw, color: tone(1), ...extra }));
    const cx = x0 + b * (w + gap) + (w - step) / 2;
    tags.push([name, cx, body === 'child' ? 1.55 : 2.25, z]);
    const h = body === 'child' ? 0.72 : 1.02;
    items.push({ name: `${name} turned round`, at: new THREE.Vector3(cx, h, z), size: 5.6, view: LEVEL });
    items.push({ name: `${name}: front, 3/4, side`, at: new THREE.Vector3(cx - step, h, z), size: 3.3, view: LEVEL, close: true });
    items.push({ name: `${name}: side, 3/4 back, back`, at: new THREE.Vector3(cx + step, h, z), size: 3.3, view: LEVEL, close: true });
  });
  // The adults and the teens side by side, to see the difference in height.
  items.push({ name: 'adults and teens', at: new THREE.Vector3(x0 + 1.5 * (w + gap) + (w - step) / 2 + gap / 2, 1, z), size: 4 * (w + gap), view: LEVEL });
  items.push({ name: 'all bodies', at: new THREE.Vector3(0, 1, z), size: 43, view: LEVEL });
  endStage();
}
// Hair: each kind from the front, the side and the back.
const hairRow = (name: string, kinds: [Body, Hair][]): void => {
  const z = rowZ();
  wall(z);
  const VIEWS = [0.35, Math.PI / 2, Math.PI - 0.45];
  const step = 0.66, gap = 0.9;
  const w = VIEWS.length * step;
  const x0 = -(kinds.length * w + (kinds.length - 1) * gap) / 2 + step / 2;
  kinds.forEach(([body, hair], k) => {
    VIEWS.forEach((yaw, i) => people.push({ x: x0 + k * (w + gap) + i * step, z, body, pose: 'stand', yaw, hair, color: tone(k + 2) }));
    const cx = x0 + k * (w + gap) + (w - step) / 2;
    tags.push([`${body} · ${hair}`, cx, body === 'child' ? 1.55 : 2.25, z]);
    items.push({ name: `head: ${body} · ${hair}`, at: new THREE.Vector3(cx, body === 'child' ? 1.05 : body === 'woman' ? 1.52 : 1.6, z), size: 2.0, view: LEVEL, close: true });
  });
  const span = kinds.length * (w + gap);
  items.push({ name, at: new THREE.Vector3(0, 1.1, z), size: span + 1, view: LEVEL });
  for (const half of [-1, 1]) items.push({ name: `${name} (${half < 0 ? 'left' : 'right'} half)`, at: new THREE.Vector3((half * span) / 4, 1.1, z), size: span / 2 + 0.6, view: LEVEL });
  endStage();
};
hairRow("women's hair", [['woman', 'short'], ['woman', 'bob'], ['woman', 'long'], ['woman', 'ponytail'], ['woman', 'twin'], ['woman', 'bun'], ['woman', 'hat'], ['woman', 'cap']]);
hairRow("men's, children's and elders' hair", [['man', 'short'], ['man', 'hat'], ['man', 'cap'], ['man', 'none'], ['child', 'short'], ['child', 'twin'], ['child', 'cap'], ['elder', 'short'], ['elder', 'none']]);
// Poses.
{
  const z = rowZ();
  wall(z);
  const POSES: Pose[] = ['stand', 'walk', 'talk', 'phone', 'pockets', 'wave', 'hold', 'sit', 'strap'];
  const who: [Body, Pose[]][] = [['man', POSES], ['woman', POSES], ['child', ['stand', 'walk', 'hold']], ['elder', ['stand', 'walk']]];
  const n = who.reduce((a, [, p]) => a + p.length, 0);
  const step = 1.3;
  let x = (-(n - 1) * step) / 2;
  let i = 0;
  for (const [body, poses] of who) {
    for (const pose of poses) {
      people.push({ x, z, body, pose, color: tone(i++), long: body === 'woman' && i % 2 === 0 });
      tags.push([`${body} · ${pose}`, x, body === 'child' ? 1.55 : 2.25, z]);
      x += step;
    }
  }
  items.push({ name: 'poses', at: new THREE.Vector3(0, 1, z), size: n * step + 1, view: LEVEL });
  for (const half of [-1, 1]) items.push({ name: `poses (${half < 0 ? 'left' : 'right'} half)`, at: new THREE.Vector3((half * n * step) / 4, 1, z), size: (n * step) / 2 + 0.6, view: LEVEL });
  endStage();
}
// Outfits (district/peopleMix.ts), front and back: the first ten, then the sculpted generation's new ones.
type Dressed = [string, Partial<FigureSpec> & Pick<FigureSpec, 'body' | 'pose'>];
const DRESSED_FIRST: Dressed[] = [
    ['plain', { body: 'man', pose: 'stand' }],
    ['plain', { body: 'woman', pose: 'stand', hair: 'bob' }],
    ['skirt', { body: 'woman', pose: 'stand', long: true, hair: 'long' }],
    ['long coat', { body: 'man', pose: 'pockets', long: true, hair: 'hat' }],
    ['suit', { body: 'man', pose: 'walk', outfit: 'suit', phase: 0.3 }],
    ['suit', { body: 'woman', pose: 'stand', outfit: 'suit', hair: 'bun' }],
    ['maid', { body: 'woman', pose: 'wave', outfit: 'maid', hair: 'twin' }],
    ['maid', { body: 'woman', pose: 'stand', outfit: 'maid', hair: 'bob' }],
    ['schoolgirl', { body: 'woman', pose: 'phone', outfit: 'school', hair: 'ponytail' }],
    ['schoolboy', { body: 'man', pose: 'walk', outfit: 'school', phase: 0.7 }],
    ['randoseru', { body: 'child', pose: 'walk', outfit: 'school', hair: 'cap', phase: 0.2 }],
    ['kimono', { body: 'woman', pose: 'stand', outfit: 'kimono', hair: 'bun' }],
    ['kimono', { body: 'man', pose: 'pockets', outfit: 'kimono' }],
    ['kimono', { body: 'elder', pose: 'stand', outfit: 'kimono', hair: 'none' }],
    ['yukata', { body: 'woman', pose: 'walk', outfit: 'yukata', hair: 'bun', phase: 0.4 }],
    ['yukata', { body: 'child', pose: 'stand', outfit: 'yukata', hair: 'bun' }],
    ['yukata', { body: 'man', pose: 'pockets', outfit: 'yukata' }],
    ['hard hat', { body: 'man', pose: 'stand', outfit: 'work' }],
    ['hard hat', { body: 'woman', pose: 'stand', outfit: 'work', hair: 'ponytail' }],
    ['police', { body: 'man', pose: 'stand', outfit: 'police', color: GHOST_COLORS[3] }],
    ['police', { body: 'woman', pose: 'walk', outfit: 'police', color: GHOST_COLORS[3], phase: 0.6, hair: 'short' }],
    ['otaku', { body: 'man', pose: 'stand', outfit: 'otaku' }],
    ['otaku', { body: 'man', pose: 'walk', outfit: 'otaku', phase: 0.1, hair: 'cap' }],
    ['otaku', { body: 'woman', pose: 'stand', outfit: 'otaku', hair: 'ponytail' }],
];
const DRESSED_NEW: Dressed[] = [
  ['dress', { body: 'woman', pose: 'stand', outfit: 'dress', hair: 'long' }],
  ['dress', { body: 'woman', pose: 'walk', outfit: 'dress', hair: 'bob', phase: 0.3 }],
  ['mini skirt', { body: 'woman', pose: 'stand', outfit: 'mini', hair: 'ponytail' }],
  ['mini skirt', { body: 'woman', pose: 'phone', outfit: 'mini', hair: 'long' }],
  ['evening dress', { body: 'woman', pose: 'stand', outfit: 'gown', hair: 'bun' }],
  ['evening dress', { body: 'woman', pose: 'talk', outfit: 'gown', hair: 'long' }],
  ['shorts', { body: 'man', pose: 'walk', outfit: 'shorts', phase: 0.7 }],
  ['shorts', { body: 'woman', pose: 'stand', outfit: 'shorts', hair: 'ponytail' }],
  ['shorts', { body: 'child', pose: 'stand', outfit: 'shorts', hair: 'cap' }],
  ['hoodie', { body: 'man', pose: 'pockets', outfit: 'hoodie' }],
  ['hoodie', { body: 'woman', pose: 'phone', outfit: 'hoodie', hair: 'bob' }],
  ['office', { body: 'man', pose: 'walk', outfit: 'office', phase: 0.3 }],
  ['office', { body: 'woman', pose: 'stand', outfit: 'office', hair: 'bun' }],
  ['track suit', { body: 'man', pose: 'stand', outfit: 'track' }],
  ['track suit', { body: 'woman', pose: 'walk', outfit: 'track', hair: 'ponytail', phase: 0.6 }],
  ['track suit', { body: 'child', pose: 'stand', outfit: 'track' }],
  ['gym clothes', { body: 'woman', pose: 'stand', outfit: 'gym', hair: 'ponytail' }],
  ['gym clothes', { body: 'woman', pose: 'walk', outfit: 'gym', hair: 'bob', phase: 0.3 }],
  ['gym clothes', { body: 'man', pose: 'stand', outfit: 'gym' }],
  ['gym clothes', { body: 'child', pose: 'stand', outfit: 'gym', hair: 'twin' }],
  ['nurse', { body: 'woman', pose: 'stand', outfit: 'nurse', hair: 'bun' }],
  ['nurse', { body: 'man', pose: 'stand', outfit: 'nurse' }],
  ['doctor', { body: 'man', pose: 'pockets', outfit: 'doctor' }],
  ['doctor', { body: 'woman', pose: 'stand', outfit: 'doctor', hair: 'bob' }],
  ['shop apron', { body: 'man', pose: 'stand', outfit: 'apron' }],
  ['shop apron', { body: 'woman', pose: 'stand', outfit: 'apron', hair: 'ponytail' }],
  ['down jacket', { body: 'man', pose: 'pockets', outfit: 'puffer' }],
  ['down jacket', { body: 'woman', pose: 'stand', outfit: 'puffer', hair: 'long' }],
  ['down jacket', { body: 'child', pose: 'stand', outfit: 'puffer', hair: 'twin' }],
];
// The shady ones (the sculpted generation's): the hair asked for picks each one's look (real/mobShape.ts VARIANT, cutOf).
const DRESSED_SHADY: Dressed[] = [
  ['yakuza', { body: 'man', pose: 'stand', outfit: 'yakuza' }],
  ['yakuza', { body: 'man', pose: 'pockets', outfit: 'yakuza', hair: 'none' }],
  ['yakuza', { body: 'man', pose: 'walk', outfit: 'yakuza', hair: 'cap', phase: 0.3 }],
  ['old boss', { body: 'elder', pose: 'stand', outfit: 'yakuza', hair: 'hat' }],
  ['chinpira', { body: 'man', pose: 'pockets', outfit: 'chinpira' }],
  ['chinpira', { body: 'man', pose: 'stand', outfit: 'chinpira', hair: 'none' }],
  ['chinpira', { body: 'man', pose: 'walk', outfit: 'chinpira', hair: 'cap', phase: 0.7 }],
  ['chinpira', { body: 'man', pose: 'talk', outfit: 'chinpira', hair: 'hat' }],
  ['irezumi', { body: 'man', pose: 'stand', outfit: 'irezumi' }],
  ['irezumi', { body: 'man', pose: 'pockets', outfit: 'irezumi', hair: 'none' }],
  ['bosozoku', { body: 'man', pose: 'stand', outfit: 'bosozoku' }],
  ['bosozoku', { body: 'man', pose: 'pockets', outfit: 'bosozoku', hair: 'none' }],
  ['bosozoku', { body: 'man', pose: 'walk', outfit: 'bosozoku', hair: 'cap', phase: 0.3 }],
  ['bosozoku', { body: 'woman', pose: 'stand', outfit: 'bosozoku', hair: 'long' }],
  ['bosozoku', { body: 'woman', pose: 'stand', outfit: 'bosozoku', hair: 'ponytail' }],
  ['boss', { body: 'man', pose: 'stand', outfit: 'boss' }],
  ['boss', { body: 'man', pose: 'walk', outfit: 'boss', hair: 'none', phase: 0.3 }],
  ['boss', { body: 'elder', pose: 'stand', outfit: 'boss' }],
  ['politician', { body: 'man', pose: 'wave', outfit: 'boss', hair: 'hat' }],
  ['politician', { body: 'elder', pose: 'stand', outfit: 'boss', hair: 'cap' }],
  ['hood', { body: 'man', pose: 'pockets', outfit: 'hood' }],
  ['hood', { body: 'man', pose: 'stand', outfit: 'hood', hair: 'none' }],
  ['hood', { body: 'man', pose: 'pockets', outfit: 'hood', hair: 'cap' }],
  ['hood', { body: 'woman', pose: 'pockets', outfit: 'hood', hair: 'long' }],
  ['sukeban', { body: 'woman', pose: 'stand', outfit: 'yankee', hair: 'long' }],
  ['sukeban', { body: 'woman', pose: 'walk', outfit: 'yankee', hair: 'ponytail', phase: 0.6 }],
  ['bancho', { body: 'man', pose: 'pockets', outfit: 'yankee' }],
  ['bancho', { body: 'man', pose: 'stand', outfit: 'yankee', hair: 'none' }],
  ['drunk', { body: 'man', pose: 'stand', outfit: 'drunk' }],
  ['drunk', { body: 'man', pose: 'walk', outfit: 'drunk', hair: 'none', phase: 0.3 }],
];
// Filipino outfits for Manila's crowd (2026-10-09), UNDER REVIEW: in no district's mix until the user approves them
// (content/manila/PEOPLE-REVIEW.md says how to turn them on). The hair asked for picks a look, as for the shady ones
// (vendor: 'hat' is the salakot; guard: bareheaded kinds carry the shotgun; trike driver: always a cap).
const DRESSED_FILIPINO: Dressed[] = [
  ['pinoy school', { body: 'woman', pose: 'stand', outfit: 'pinoy_school', hair: 'ponytail' }],
  ['pinoy school', { body: 'woman', pose: 'walk', outfit: 'pinoy_school', hair: 'bob', phase: 0.3 }],
  ['pinoy school', { body: 'man', pose: 'stand', outfit: 'pinoy_school' }],
  ['pinoy school', { body: 'man', pose: 'walk', outfit: 'pinoy_school', phase: 0.6 }],
  ['pinoy school', { body: 'child', pose: 'stand', outfit: 'pinoy_school', hair: 'twin' }],
  ['pinoy school', { body: 'child', pose: 'walk', outfit: 'pinoy_school', hair: 'short', phase: 0.2 }],
  ['baller', { body: 'man', pose: 'stand', outfit: 'baller' }],
  ['baller', { body: 'man', pose: 'walk', outfit: 'baller', hair: 'none', phase: 0.4 }],
  ['baller', { body: 'woman', pose: 'stand', outfit: 'baller', hair: 'ponytail' }],
  ['barong', { body: 'man', pose: 'stand', outfit: 'barong' }],
  ['barong', { body: 'man', pose: 'walk', outfit: 'barong', hair: 'none', phase: 0.3 }],
  ['barong', { body: 'elder', pose: 'stand', outfit: 'barong', hair: 'none' }],
  ['vendor', { body: 'man', pose: 'stand', outfit: 'vendor', hair: 'hat' }],
  ['vendor', { body: 'woman', pose: 'stand', outfit: 'vendor', hair: 'hat' }],
  ['vendor', { body: 'woman', pose: 'walk', outfit: 'vendor', hair: 'bun', phase: 0.5 }],
  ['vendor', { body: 'elder', pose: 'stand', outfit: 'vendor', hair: 'hat' }],
  ['jeepney crew', { body: 'man', pose: 'stand', outfit: 'jeep_crew', hair: 'none' }],
  ['jeepney crew', { body: 'man', pose: 'pockets', outfit: 'jeep_crew', hair: 'cap' }],
  ['jeepney crew', { body: 'man', pose: 'walk', outfit: 'jeep_crew', hair: 'short', phase: 0.7 }],
  ['tricycle driver', { body: 'man', pose: 'stand', outfit: 'trike_driver', hair: 'cap' }],
  ['tricycle driver', { body: 'man', pose: 'walk', outfit: 'trike_driver', hair: 'cap', phase: 0.2 }],
  ['guard (pistol)', { body: 'man', pose: 'stand', outfit: 'guard', hair: 'short' }],
  ['guard (shotgun)', { body: 'man', pose: 'stand', outfit: 'guard', hair: 'none' }],
  ['guard (shotgun)', { body: 'man', pose: 'walk', outfit: 'guard', hair: 'none', phase: 0.5 }],
  ['guard (pistol)', { body: 'woman', pose: 'stand', outfit: 'guard', hair: 'short' }],
];
function outfitStage(title: string, DRESSED: Dressed[]): void {
  const z = rowZ();
  wall(z);
  const zb = rowZ();
  const step = 1.3;
  const x0 = (-(DRESSED.length - 1) * step) / 2;
  DRESSED.forEach(([name, sp], c) => {
    const x = x0 + c * step;
    people.push({ x, z, color: tone(c * 3 + 1), ...sp });
    tags.push([name, x, sp.body === 'child' ? 1.55 : 2.3, z]);
  });
  items.push({ name: title, at: new THREE.Vector3(0, 1, z), size: DRESSED.length * step + 1, view: LEVEL });
  // Each one from the waist up, three at a time (glasses, collars, what the hands hold).
  for (let c = 0; c < DRESSED.length; c += 3) items.push({ name: `${title}: close ${c / 3 + 1}: ${DRESSED.slice(c, c + 3).map(([n]) => n).join(', ')}`, at: new THREE.Vector3(x0 + (c + 1) * step, 1.25, z), size: 3 * step - 0.6, view: new THREE.Vector3(0.3, 0.06, 1).normalize(), close: true });
  // What each wears on their feet, four at a time, from low down.
  for (let c = 0; c < DRESSED.length; c += 4) items.push({ name: `${title}: feet ${c / 4 + 1}: ${DRESSED.slice(c, c + 4).map(([n]) => n).join(', ')}`, at: new THREE.Vector3(x0 + (c + 1.5) * step, 0.22, z), size: 4 * step + 0.4, view: new THREE.Vector3(0.45, 0.22, 1).normalize(), close: true });
  for (const half of [-1, 1]) items.push({ name: `${title} (${half < 0 ? 'left' : 'right'} half)`, at: new THREE.Vector3((half * DRESSED.length * step) / 4, 1, z), size: (DRESSED.length * step) / 2 + 0.6, view: LEVEL });
  endStage();
  wall(zb);
  DRESSED.forEach(([name, sp], c) => {
    const x = x0 + c * step;
    people.push({ x, z: zb, yaw: Math.PI, color: tone(c * 3 + 1), ...sp });
    tags.push([name, x, sp.body === 'child' ? 1.55 : 2.3, zb]);
  });
  items.push({ name: `${title} (backs)`, at: new THREE.Vector3(0, 1, zb), size: DRESSED.length * step + 1, view: LEVEL });
  for (const half of [-1, 1]) items.push({ name: `${title} (backs, ${half < 0 ? 'left' : 'right'} half)`, at: new THREE.Vector3((half * DRESSED.length * step) / 4, 1, zb), size: (DRESSED.length * step) / 2 + 0.6, view: LEVEL });
  endStage();
}
outfitStage('outfits', DRESSED_FIRST);
outfitStage('new outfits', DRESSED_NEW);
outfitStage('shady', DRESSED_SHADY);
stageFor = 'ph';
outfitStage('filipino (under review)', DRESSED_FILIPINO);
// ---- characters.html: the named characters, and the bare body they are built on ----
stageFor = 'characters';
// Posing one by hand (showroom/poser.ts): a stage of its own, the figure the poser's.
let poseStage = -1;
const poseAt = new THREE.Vector3();
{
  const z = rowZ();
  wall(z);
  poseStage = stage;
  poseAt.set(0, 0, z);
  items.push({ name: 'pose', at: new THREE.Vector3(0, 0.95, z), size: 2.8, view: LEVEL });
  endStage();
}
{
  const YAWS = [0, 0.8, Math.PI / 2, 2.35, Math.PI];
  const step = 0.85, gap = 1.2;
  const w = YAWS.length * step;
  for (const c of CHARACTERS) {
    // (A body with nothing on: on the dev server only, and never in the demo.)
    if (isBare(c.outfit) && !(import.meta.env.DEV && __EDITION__ !== 'demo')) continue;
    // Each turned round; and beside it the crowd's figure it started from, in the same clothes.
    const z = rowZ();
    wall(z);
    const x0 = -(2 * w + gap) / 2 + step / 2;
    YAWS.forEach((yaw, i) => people.push({ x: x0 + i * step, z, body: c.body, pose: 'stand', yaw, hair: c.hair, outfit: c.outfit, color: c.color as FigureSpec['color'], model: c.name }));
    YAWS.forEach((yaw, i) => people.push({ x: x0 + w + gap + i * step, z, body: c.body, pose: 'stand', yaw, hair: c.hair, outfit: c.outfit, color: c.color as FigureSpec['color'] }));
    tags.push([`${c.title}: height ×${c.shape.height ?? 1}, bust ×${c.shape.bust ?? 1}, hips ×${c.shape.hips ?? 1}`, x0 + (w - step) / 2, 2.25, z]);
    tags.push(["the crowd's figure she starts from", x0 + w + gap + (w - step) / 2, 2.25, z]);
    items.push({ name: c.name, at: new THREE.Vector3(0, 1, z), size: 2 * w + gap + 0.6, view: LEVEL });
    items.push({ name: `${c.name}: front, 3/4, side`, at: new THREE.Vector3(x0 + step, 1, z), size: 3.3, view: LEVEL, close: true });
    items.push({ name: `${c.name}: side, 3/4 back, back`, at: new THREE.Vector3(x0 + 3 * step, 1, z), size: 3.3, view: LEVEL, close: true });
    items.push({ name: `${c.name}: shoulders and arms`, at: new THREE.Vector3(x0 + step * 0.4, 1.22, z), size: 1.9, view: LEVEL, close: true });
    items.push({ name: `${c.name}: hands`, at: new THREE.Vector3(x0 + step, 0.74, z), size: 1.5, view: LEVEL, close: true });
    items.push({ name: `${c.name}: feet`, at: new THREE.Vector3(x0 + step, 0.22, z), size: 1.6, view: new THREE.Vector3(0, 0.35, 1).normalize(), close: true });
    items.push({ name: `${c.name}: back`, at: new THREE.Vector3(x0 + 3.5 * step, 1.15, z), size: 1.6, view: LEVEL, close: true });
    endStage();
    // And walking, sitting and about her routine, as the material poses her.
    const zp = rowZ();
    wall(zp);
    const POSED: Omit<Spec, 'x' | 'z' | 'body'>[] = [{ pose: 'walk', phase: 0.3, yaw: 0.6 }, { pose: 'walk', phase: 0.8, yaw: Math.PI / 2 }, { pose: 'sit', yaw: 0.8 }, { pose: 'phone' }, { pose: 'talk' }, { pose: 'wave' }, { pose: 'pockets', yaw: 2.6 }];
    POSED.forEach((sp, i) => people.push({ x: (i - (POSED.length - 1) / 2) * 1.1, z: zp, body: c.body, hair: c.hair, outfit: c.outfit, color: c.color as FigureSpec['color'], model: c.name, ...sp }));
    items.push({ name: `${c.name}: posed`, at: new THREE.Vector3(0, 1, zp), size: POSED.length * 1.1 + 0.6, view: LEVEL });
    endStage();
  }
  // The woman's body with nothing on (a mannequin's: the rooms of adult scenes use it), which the characters' own
  // detail is worked out on. On the dev server only, and never in the demo.
  if (import.meta.env.DEV && __EDITION__ !== 'demo') {
    const z = rowZ();
    wall(z);
    const x0 = -(2 * w + gap) / 2 + step / 2;
    YAWS.forEach((yaw, i) => people.push({ x: x0 + i * step, z, body: 'woman', pose: 'stand', yaw, hair: 'bob', outfit: 'nude', color: tone(4) }));
    YAWS.forEach((yaw, i) => people.push({ x: x0 + w + gap + i * step, z, body: 'woman', pose: 'stand', yaw, hair: 'bob', color: tone(4) }));
    tags.push(['nothing on', x0 + (w - step) / 2, 2.25, z]);
    tags.push(['in clothes', x0 + w + gap + (w - step) / 2, 2.25, z]);
    items.push({ name: 'the bare body', at: new THREE.Vector3(0, 1, z), size: 2 * w + gap + 0.6, view: LEVEL });
    items.push({ name: 'the bare body: front, 3/4, side', at: new THREE.Vector3(x0 + step, 1, z), size: 3.3, view: LEVEL, close: true });
    items.push({ name: 'the bare body: side, 3/4 back, back', at: new THREE.Vector3(x0 + 3 * step, 1, z), size: 3.3, view: LEVEL, close: true });
    items.push({ name: 'the bare body: chest', at: new THREE.Vector3(x0 + step, 1.2, z), size: 2.4, view: LEVEL, close: true });
    items.push({ name: 'the bare body: hips, from the front', at: new THREE.Vector3(x0 + step, 0.9, z), size: 2.4, view: LEVEL, close: true });
    items.push({ name: 'the bare body: hips, from behind', at: new THREE.Vector3(x0 + 3 * step, 0.9, z), size: 2.4, view: LEVEL, close: true });
    endStage();
  }
}
stageFor = 'mob';
{
  const zb = rowZ();
  wall(zb);
  const WEAR: [string, Omit<Spec, 'x' | 'z'>][] = [
    ['walking', { body: 'woman', pose: 'walk', phase: 0.3, hair: 'bob' }],
    ['walking', { body: 'woman', pose: 'walk', phase: 0.8, hair: 'bob' }],
    ['sitting', { body: 'woman', pose: 'sit', hair: 'bob', yaw: Math.PI / 2 }],
    ['sitting', { body: 'woman', pose: 'sit', hair: 'bob', yaw: 2.5 }],
    ['shorts', { body: 'woman', pose: 'stand', outfit: 'shorts', hair: 'ponytail' }],
    ['shorts', { body: 'woman', pose: 'stand', outfit: 'shorts', hair: 'ponytail', yaw: 2.2 }],
    ['hoodie', { body: 'woman', pose: 'stand', outfit: 'hoodie', hair: 'bob' }],
    ['shop apron', { body: 'woman', pose: 'stand', outfit: 'apron', hair: 'bun' }],
    ['hard hat', { body: 'woman', pose: 'stand', outfit: 'work', hair: 'bob' }],
    ['police', { body: 'woman', pose: 'stand', outfit: 'police', hair: 'short', color: GHOST_COLORS[3] }],
    ['mini skirt', { body: 'woman', pose: 'stand', outfit: 'mini', hair: 'bob' }],
    ['evening dress', { body: 'woman', pose: 'stand', outfit: 'gown', hair: 'bun' }],
    ['suit', { body: 'woman', pose: 'stand', outfit: 'suit', hair: 'bun' }],
    ['dress', { body: 'woman', pose: 'stand', outfit: 'dress', hair: 'bob' }],
    ['track suit (teen)', { body: 'woman', pose: 'stand', outfit: 'track', hair: 'ponytail' }],
    ['gym clothes (teen)', { body: 'woman', pose: 'stand', outfit: 'gym', hair: 'ponytail' }],
  ];
  const stepB = 1.0;
  const xb = (-(WEAR.length - 1) * stepB) / 2;
  WEAR.forEach(([name, sp], c) => {
    people.push({ x: xb + c * stepB, z: zb, yaw: Math.PI, color: tone(c * 3 + 4), ...sp });
    tags.push([name, xb + c * stepB, 2.25, zb]);
  });
  items.push({ name: 'the bottom: in other clothes, walking, sitting', at: new THREE.Vector3(0, 1, zb), size: WEAR.length * stepB + 1, view: LEVEL });
  for (let c = 0; c < WEAR.length; c += 4) items.push({ name: `the bottom: clothes ${c / 4 + 1}: ${[...new Set(WEAR.slice(c, c + 4).map(([n]) => n))].join(', ')}`, at: new THREE.Vector3(xb + (c + 1.5) * stepB, 0.95, zb), size: 4 * stepB, view: LEVEL, close: true });
  endStage();
}
// Holding hands: each pair is placed by holdHands as the generation being built has them, so the hands meet.
const holding: [number, number][] = [];
const pair = (a: Spec, b: Spec): void => {
  holding.push([people.length, people.length + 1]);
  people.push(a, b);
};
{
  const z = rowZ();
  wall(z);
  const PAIRS: [string, Omit<Spec, 'x' | 'z' | 'pose'>, Omit<Spec, 'x' | 'z' | 'pose'>][] = [
    ['mother and child', { body: 'woman', hair: 'ponytail', side: 1 }, { body: 'child', hair: 'twin', look: -0.4 }],
    ['father and child', { body: 'man', side: -1 }, { body: 'child', hair: 'cap', look: 0.4 }],
    ['grandparent and child', { body: 'elder', hair: 'hat', side: 1 }, { body: 'child', hair: 'short', look: -0.3 }],
    ['a couple', { body: 'man', side: 1 }, { body: 'woman', hair: 'long', long: true }],
    ['schoolgirl and child', { body: 'woman', outfit: 'school', hair: 'bob', side: -1 }, { body: 'child', hair: 'bun' }],
  ];
  const step = 2.8;
  PAIRS.forEach(([name, a, b], i) => {
    const x = (i - (PAIRS.length - 1) / 2) * step;
    const cx = x + 0.3 * (a.side ?? 1);
    pair({ x, z, pose: 'hold', color: tone(i * 3), ...a }, { x: x + 0.6 * (a.side ?? 1), z, pose: 'hold', color: tone(i * 3 + 1), ...b });
    tags.push([name, cx, 2.3, z]);
    items.push({ name: `holding hands: ${name}`, at: new THREE.Vector3(cx, 0.85, z), size: 2.4, view: LEVEL, close: true });
  });
  items.push({ name: 'holding hands', at: new THREE.Vector3(0, 1, z), size: PAIRS.length * step + 1, view: LEVEL });
  endStage();
}
// A street: people walking past both ways and standing about, coming and going as they do in the city.
{
  const z = rowZ() - 5;
  wall(z);
  const HAIRS: Record<Body, Hair[]> = { man: ['short', 'short', 'none', 'cap', 'hat', 'long'], woman: ['long', 'bob', 'ponytail', 'bun', 'short', 'twin', 'hat'], child: ['short', 'twin', 'cap'], elder: ['short', 'none', 'hat'] };
  const WEAR: FigureSpec['outfit'][] = ['plain', 'dress', 'long', 'suit', 'hoodie', 'otaku', 'school', 'office', 'plain', 'shorts', 'track'];
  for (let i = 0; i < 26; i++) {
    const body: Body = i % 9 === 8 ? 'elder' : i % 13 === 12 ? 'child' : i % 2 ? 'woman' : 'man';
    const dir = i % 2 ? 1 : -1;
    const lane = z + (i % 4) * 0.8 + (dir > 0 ? 0 : 0.4);
    people.push({ x: -dir * 16 + (i % 5) * 0.37, z: lane, body, pose: 'walk', yaw: dir * (Math.PI / 2), hair: HAIRS[body][i % HAIRS[body].length], outfit: WEAR[(i * 5) % WEAR.length], color: tone(i * 3), phase: (i * 0.37) % 1, fade: true, seed: (i * 0.618) % 1, walk: { ex: dir * 32, ez: 0, speed: body === 'elder' ? 0.9 : 1.25 + (i % 3) * 0.12, gap: 1 + (i % 4) } });
  }
  // People who walk together (a couple, a parent and child, two friends): one seed and one walk, so they come and go as one.
  const GROUPS: [number, number, Omit<Spec, 'x' | 'z' | 'pose'>, Omit<Spec, 'x' | 'z' | 'pose'>][] = [
    [1, 3.3, { body: 'man' }, { body: 'woman', hair: 'long', outfit: 'dress', look: -0.4 }],
    [-1, 3.3, { body: 'woman', hair: 'ponytail' }, { body: 'child', hair: 'twin', look: -0.3, phase: 0.75 }],
    [1, 2.2, { body: 'woman', hair: 'bob', outfit: 'school', look: 0.35 }, { body: 'woman', hair: 'twin', outfit: 'school', look: -0.35 }],
    [-1, 1.4, { body: 'man', outfit: 'hoodie', look: 0.35 }, { body: 'man', outfit: 'shorts', hair: 'cap', look: -0.35 }],
  ];
  GROUPS.forEach(([dir, dz, a, b], g) => {
    const walk = { ex: dir * 32, ez: 0, speed: 1.15 + g * 0.05, gap: 2 + g };
    const seed = (0.21 + g * 0.37) % 1;
    for (const [who, off] of [[a, -0.31], [b, 0.31]] as const) people.push({ x: -dir * 16, z: z + dz + off, pose: 'walk', yaw: dir * (Math.PI / 2), color: tone(g * 7 + (off > 0 ? 3 : 0)), phase: 0.25, fade: true, seed, walk, ...who });
  });
  // (Those standing together come and go together too: the builder gives people within reach of one another one seed.)
  pair({ x: -3.4, z: z + 4.8, body: 'woman', pose: 'hold', side: 1, hair: 'ponytail', color: tone(7), fade: true }, { x: -2.85, z: z + 4.8, body: 'child', pose: 'hold', hair: 'twin', look: -0.4, color: tone(12), fade: true });
  // The ones you'd rather not pass: loitering as the shady do (squatting, smoking, watching), and a drunk weaving home.
  const LOITER: Omit<Spec, 'x' | 'z' | 'pose'>[] = [{ body: 'man', outfit: 'hood', hair: 'short' }, { body: 'man', outfit: 'chinpira', hair: 'cap' }, { body: 'man', outfit: 'yakuza', hair: 'short' }, { body: 'woman', outfit: 'yankee', hair: 'long' }, { body: 'man', outfit: 'bosozoku', hair: 'short' }];
  LOITER.forEach((who, i) => people.push({ x: 9.6 + (i % 3) * 1.1, z: z + 4.3 + Math.floor(i / 3) * 1.1, pose: 'stand', yaw: -0.9 + i * 0.35, color: tone(i * 2 + 1), fade: true, seed: 0.42, manner: 'shady', ...who }));
  people.push({ x: 15, z: z + 2.9, body: 'man', pose: 'walk', yaw: -Math.PI / 2, outfit: 'drunk', hair: 'short', color: tone(4), fade: true, seed: 0.77, manner: 'drunk', walk: { ex: -30, ez: 0, speed: 0.8, gap: 2 } });
  people.push({ x: -15, z: z + 1.9, body: 'man', pose: 'walk', yaw: Math.PI / 2, outfit: 'office', hair: 'short', color: tone(2), fade: true, seed: 0.13, walk: { ex: 30, ez: 0, speed: 2.9, gap: 2 } });
  const standing: Spec[] = [
    { x: -7.2, z: z + 4.4, body: 'woman', pose: 'talk', hair: 'bob', long: true },
    { x: -7.2, z: z + 5.3, body: 'man', pose: 'stand', yaw: Math.PI },
    { x: 0.6, z: z + 4.6, body: 'woman', pose: 'phone', hair: 'long', outfit: 'suit' },
    { x: 3.4, z: z + 4.5, body: 'man', pose: 'pockets', hair: 'hat', long: true },
    { x: 4.0, z: z + 5.3, body: 'woman', pose: 'phone', yaw: Math.PI, hair: 'bun' },
    { x: 7.4, z: z + 4.7, body: 'elder', pose: 'stand', hair: 'cap' },
  ];
  standing.forEach((s, i) => people.push({ color: tone(i * 5 + 2), fade: true, ...s }));
  tags.push(['walking past', 0, 2.5, z]);
  tags.push(['standing about', 0, 2.5, z + 4.8]);
  items.push({ name: 'street', at: new THREE.Vector3(0, 1, z + 2.4), size: 13, view: new THREE.Vector3(0, 0.3, 1).normalize() });
  items.push({ name: 'street: the loiterers', at: new THREE.Vector3(10.6, 0.9, z + 4.8), size: 5.5, view: new THREE.Vector3(-0.2, 0.12, 1).normalize(), close: true });
  items.push({ name: 'street (as you walk it)', at: new THREE.Vector3(0, 1.45, z + 2.4), size: 9, view: new THREE.Vector3(0.9, 0.0, 0.45).normalize() });
  endStage();
}
// Emotes (real/emotes.ts): each of the marks the crowd shows now and then, held up by someone, the three looks of
// the blush, the hearts and the stars side by side to compare (or, from the panel, coming and going as they do in the
// city, only far more often); and, from the panel, everyone's breath in the cold.
const emoteFrom = people.length;
const emoteStage = stage;
// (Where the row stands: the figures in it are the ones that emote, in the marks' order along it.)
let emoteRow = { x0: 0, step: 1, z: 0, depth: 0.6 };
{
  const z = rowZ();
  wall(z);
  // (The rows run back past the floor's edge by now: it's made to reach under this one.)
  floor.scale.setScalar(Math.max(1, (20 - z) / 60));
  // Who holds each (EMOTE_MARKS, in order): faces to the front for the ones drawn on the face, the sigh half turned.
  const WHO: Omit<Spec, 'x' | 'z'>[] = [
    { body: 'man', pose: 'stand' },
    { body: 'woman', pose: 'stand', hair: 'bob' },
    { body: 'child', pose: 'stand', hair: 'cap' },
    { body: 'elder', pose: 'stand' },
    { body: 'woman', pose: 'phone', hair: 'long' },
    { body: 'woman', pose: 'stand', outfit: 'school', hair: 'ponytail' },
    { body: 'woman', pose: 'stand', hair: 'bob', outfit: 'dress' },
    { body: 'man', pose: 'stand', outfit: 'office' },
    { body: 'woman', pose: 'stand', hair: 'long', outfit: 'dress' },
    { body: 'woman', pose: 'stand', hair: 'short', outfit: 'suit' },
    { body: 'man', pose: 'stand', outfit: 'hoodie' },
    { body: 'woman', pose: 'wave', outfit: 'school', hair: 'twin' },
    { body: 'man', pose: 'stand', outfit: 'school' },
    { body: 'child', pose: 'stand', hair: 'twin' },
    { body: 'man', pose: 'walk', outfit: 'hoodie', phase: 0.3 },
    { body: 'man', pose: 'pockets', hair: 'hat', long: true },
    { body: 'man', pose: 'stand', outfit: 'suit', yaw: 1.1 },
    { body: 'woman', pose: 'stand', outfit: 'suit', hair: 'bun' },
    { body: 'man', pose: 'stand', outfit: 'office', hair: 'none' },
    { body: 'woman', pose: 'stand', hair: 'ponytail' },
  ];
  const step = 1.15;
  const x0 = (-(EMOTE_MARKS.length - 1) * step) / 2;
  emoteRow = { x0, step, z, depth: 0.6 };
  EMOTE_MARKS.forEach(({ label }, i) => {
    people.push({ x: x0 + i * step, z, color: tone(i * 3 + 1), ...WHO[i % WHO.length] });
    tags.push([label, x0 + i * step, 2.5, z]);
  });
  items.push({ name: 'emotes', at: new THREE.Vector3(0, 1.1, z), size: EMOTE_MARKS.length * step + 1, view: LEVEL });
  // Close: the plain ones, then each set of looks side by side.
  const CLOSE: [string, number, number][] = [['sweat, anger, !, ?, !?', 0, 5], ['blush: lines, flush, both', 5, 3], ['hearts: over head, eyes, rising', 8, 3], ['stars: over head, eyes, round head', 11, 3], ['note, zzz, sigh', 14, 3], ['..., gloom, fluster', 17, 3]];
  for (const [name, from, n] of CLOSE) items.push({ name: `emotes: ${name}`, at: new THREE.Vector3(x0 + (from + (n - 1) / 2) * step, 1.45, z), size: n * step + 0.2, view: LEVEL, close: true });
  endStage();
}
// Smokers (real/smoke.ts): the street's people with something lit, as the city has them: the cigarette or cigar in the
// free hand, up to the mouth for a drag every so often, the ember, the thread of smoke off its tip and the breath of
// smoke after each drag. (From the panel: a wind for it to lean with.)
const smokeFrom = people.length;
const smokeStage = stage;
{
  const z = rowZ();
  wall(z);
  const WHO: [string, Omit<Spec, 'x' | 'z'>][] = [
    ['a man', { body: 'man', pose: 'stand', smokes: 'cigarette' }],
    ['a salaryman (case in the left)', { body: 'man', pose: 'stand', outfit: 'suit', smokes: 'cigarette' }],
    ['left-handed', { body: 'man', pose: 'pockets', outfit: 'office', hair: 'none', side: -1, smokes: 'cigarette' }],
    ['a woman', { body: 'woman', pose: 'stand', hair: 'bob', outfit: 'dress', smokes: 'cigarette' }],
    ['a hostess', { body: 'woman', pose: 'stand', hair: 'long', outfit: 'gown', side: -1, smokes: 'cigarette' }],
    ['an old man', { body: 'elder', pose: 'stand', hair: 'cap', smokes: 'cigarette' }],
    ['a labourer', { body: 'man', pose: 'stand', outfit: 'work', hair: 'short', smokes: 'cigarette' }],
    ['a chinpira (squats)', { body: 'man', pose: 'stand', outfit: 'chinpira', hair: 'cap', manner: 'shady', smokes: 'cigarette' }],
    ['yakuza', { body: 'man', pose: 'stand', outfit: 'yakuza', hair: 'short', manner: 'shady', smokes: 'cigarette' }],
    ['a drunk', { body: 'man', pose: 'stand', outfit: 'drunk', hair: 'short', manner: 'drunk', smokes: 'cigarette' }],
    ['a fat cat: a cigar', { body: 'man', pose: 'stand', outfit: 'boss', hair: 'none', smokes: 'cigar' }],
    ['a politician: a cigar', { body: 'man', pose: 'stand', outfit: 'boss', hair: 'cap', side: -1, smokes: 'cigar' }],
    ['the old boss: a cigar', { body: 'elder', pose: 'stand', outfit: 'yakuza', hair: 'hat', smokes: 'cigar' }],
  ];
  const step = 1.3;
  const x0 = (-(WHO.length - 1) * step) / 2;
  WHO.forEach(([label, who], i) => {
    people.push({ x: x0 + i * step, z, color: tone(i * 3 + 2), ...who });
    tags.push([label, x0 + i * step, 2.5, z]);
  });
  // Two walking past with one lit: the thread trails behind them.
  people.push({ x: -9, z: z + 1.5, body: 'man', pose: 'walk', yaw: Math.PI / 2, outfit: 'suit', hair: 'short', color: tone(4), phase: 0.1, fade: true, seed: 0.31, smokes: 'cigarette', walk: { ex: 18, ez: 0, speed: 1.25, gap: 1 } });
  people.push({ x: 9, z: z + 2.3, body: 'man', pose: 'walk', yaw: -Math.PI / 2, outfit: 'long', hair: 'hat', color: tone(9), phase: 0.6, fade: true, seed: 0.64, side: -1, smokes: 'cigarette', walk: { ex: -18, ez: 0, speed: 1.1, gap: 2 } });
  items.push({ name: 'smoking', at: new THREE.Vector3(0, 1.15, z + 0.6), size: WHO.length * step + 1, view: LEVEL });
  const CLOSE: [string, number, number][] = [['men', 0, 3], ['women, an old man', 3, 3], ['at work, and the shady', 6, 4], ['cigars', 10, 3]];
  for (const [name, from, n] of CLOSE) items.push({ name: `smoking: ${name}`, at: new THREE.Vector3(x0 + (from + (n - 1) / 2) * step, 1.3, z), size: n * step + 0.3, view: new THREE.Vector3(0.25, 0.06, 1).normalize(), close: true });
  endStage();
}
const smokeTo = people.length;

{
  const keep = items.map((_, i) => stagePages[stageOf.items[i]] === PAGE);
  const its = items.filter((_, i) => keep[i]), sts = stageOf.items.filter((_, i) => keep[i]);
  items.length = 0;
  items.push(...its);
  stageOf.items.length = 0;
  stageOf.items.push(...sts);
}
// The sculpted figures' head size (a scale on what real/mobShape.ts gives each body), for trying sizes: ?head=.
const HEADS = [1, 0.92, 0.85];
const headSize = Number(query.get('head') ?? 0.92);
setShapedHeadScale(headSize);
// (The named characters, built with that head size, each a figure of its own in the material.)
registerCharacters();
for (const [name, of, shape] of variants) registerVariant(name, of, shape);
// (The poser's figure: any character the page may show.)
const posable = CHARACTERS.filter((c) => !isBare(c.outfit) || (import.meta.env.DEV && __EDITION__ !== 'demo'));
const poser = PAGE === 'characters' && posable.length ? new Poser(posable, light, poseAt, { camera, dom: renderer.domElement, controls, floorY: FLOOR_Y, onChange: () => apply() }) : null;
if (poser) scene.add(poser.object);

// ---- Both generations, standing in the same places ----
type Gen = 'new' | 'current' | 'both';
const meshes: Record<MobShape, THREE.Object3D[]> = { classic: [], shaped: [] };
const stats = {} as Record<MobShape, { vertices: number; triangles: number; ms: number; man: number; woman: number }>;
for (const shape of ['classic', 'shaped'] as MobShape[]) {
  const t0 = performance.now();
  setMobShape(shape);
  let triangles = 0;
  let vertices = 0;
  const full = (s: Spec): FigureSpec => ({ yaw: 0, color: GHOST_COLORS[1], hair: DEFAULT_HAIR[s.body], long: false, phase: 0.25, side: 1, look: 0, fade: false, ...s });
  // (Those holding hands, placed for this generation's bodies.)
  const held = new Map<number, FigureSpec>();
  for (const [a, b] of holding) {
    const [A, B] = holdHands(full(people[a]), full(people[b]));
    held.set(a, A);
    held.set(b, B);
  }
  for (let st = 0; st < stage; st++) {
    const group = new THREE.Group();
    if (stagePages[st] === PAGE) {
      const gb = new GhostBuilder();
      people.forEach((s, i) => {
        if (stageOf.people[i] !== st) return;
        const spec = held.get(i) ?? full(s);
        addFigure(gb, spec);
        triangles += figureMesh(spec).triangles;
      });
      vertices += gb.count;
      // (A stage with nobody of the page's own: the poser's.)
      const geometry = gb.build(0, 0);
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, ghost);
        mesh.frustumCulled = false;
        group.add(mesh);
      }
    }
    scene.add(group);
    meshes[shape].push(group);
  }
  const plain = (body: Body): number => figureMesh({ body, hair: DEFAULT_HAIR[body], long: false }).triangles;
  stats[shape] = { vertices, triangles, ms: performance.now() - t0, man: plain('man'), woman: plain('woman') };
}
// The emotes' row (measured and packed for the sculpted figures, the generation still set here).
const emotes = new Emotes(ghost);
{
  const specs = people.slice(emoteFrom, emoteFrom + EMOTE_MARKS.length).map((s): FigureSpec => ({ yaw: 0, color: GHOST_COLORS[1], hair: DEFAULT_HAIR[s.body], long: false, phase: 0.25, side: 1, look: 0, fade: false, ...s }));
  emotes.fill([packFigures(specs)], specs.length);
  emotes.row = emoteRow;
  scene.add(emotes.mesh, emotes.breath);
}
// The smokers' cigarettes, embers and smoke (the sculpted figures', as the crowd's are in the city).
const smoke = new CrowdSmoke(ghost);
{
  const specs = people.slice(smokeFrom, smokeTo).map((s): FigureSpec => ({ yaw: 0, color: GHOST_COLORS[1], hair: DEFAULT_HAIR[s.body], long: false, phase: 0.25, side: 1, look: 0, fade: false, ...s }));
  smoke.fill([packFigures(specs, null, false)]);
  scene.add(smoke.mesh);
}
// (A wind for the smoke: ?wind=x,z in m/s, or the panel's.)
const WINDS: [string, number, number][] = [['still air', 0, 0], ['a breeze', 0.7, 0.2], ['windy', 2.4, 0.6]];
let windy = 0;
const smokeWind = new THREE.Vector2();
if (query.has('wind')) smokeWind.fromArray((query.get('wind') ?? '0,0').split(',').map(Number));
smoke.wind = smokeWind;
setMobShape('classic');
const tagObjects = tags.map(([text, x, y, z]) => {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.position.set(x, y, z);
  scene.add(o);
  return o;
});

// ---- Settings ----
let gen: Gen = (['new', 'current', 'both'] as const).find((g) => g === query.get('gen')) ?? 'new';
type Mode = 'studio' | 'day' | 'night';
let mode: Mode = (['studio', 'day', 'night'] as const).find((m) => m === query.get('light')) ?? 'studio';
// (It opens as the user means to use the mob: the see-through ghost, every figure one black-like colour.)
// Coloured and solid to start; the old look (see-through: O; the body all one black: C) is a toggle.
let look: MobLook = MOB_LOOK_NAMES.find((l) => l === query.get('look')) ?? 'solid';
let oneColor = query.get('one') === '1';
// The mob as it first was: everything black, clothes and all, and see-through (B; ?black=1).
let allBlack = query.get('black') === '1';
if (allBlack) look = 'ghost';
// How much denser a figure is at its edges and creases (the district's 0.2 draws every fold of a modelled figure as a line).
const EDGES = [0, 0.06, 0.2];
let edge = Number(query.get('edge') ?? 0);
const SKINS = [1, 1.5, 2.2];
let skin = Number(query.get('skin') ?? 1);
let still = query.get('still') !== '0';
let labelsOn = query.get('labels') !== '0';
// The emotes' row: each held up to look at, or coming and going by the clock as in the city (far more often: ?emotes=clock).
let emotesHeld = query.get('emotes') !== 'clock';
// The same row's breath in the cold (?cold=1).
let cold = query.get('cold') === '1';
/** The stage looked at alone (null: everything). */
let solo: number | null = null;
let wire = false;
let turntable = false;

const apply = (): void => {
  for (let st = 0; st < stage; st++) {
    const on = solo === null || solo === st;
    meshes.shaped[st].visible = on && gen !== 'current';
    meshes.classic[st].visible = on && gen !== 'new';
    // Both: the district's figures a row behind the new ones.
    meshes.classic[st].position.z = gen === 'both' ? -1.4 : 0;
    walls[st].visible = solo === st;
  }
  const L = {
    studio: { bg: 0x34363b, wall: 0x5f5d59, floor: 0x77746e, exp: 1.0, lamp: 0 },
    day: { bg: 0x9cc0e6, wall: 0x8f8c85, floor: 0xa9a59c, exp: 0.9, lamp: 0 },
    night: { bg: 0x05060a, wall: 0x0e0e12, floor: 0x16161a, exp: 1.2, lamp: 1.1 },
  }[mode];
  (scene.background as THREE.Color).setHex(L.bg);
  floorMat.color.setHex(L.floor);
  wallMat.color.setHex(L.wall);
  renderer.toneMappingExposure = L.exp;
  light.uLightGain.value = L.lamp;
  setMobLook(ghost, look);
  // (For judging shapes in scripted shots: ?lift= brightens the figures without making them see-through.)
  if (query.has('lift')) ghost.uniforms.uLift.value = Number(query.get('lift'));
  ghost.uniforms.uSkin.value = skin;
  (ghost.uniforms.uFlat.value as THREE.Vector4).set(0.02, 0.02, 0.022, oneColor ? 1 : 0);
  ghost.uniforms.uBlack.value = allBlack ? 1 : 0;
  // (Coloured, they aren't ghosts: nobody comes and goes. See-through or all black, they do.)
  ghost.uniforms.uStay.value = allBlack || look === 'ghost' ? 0 : 1;
  ghost.uniforms.uEdge.value = edge;
  ghost.uniforms.uStill.value = still ? 1 : 0;
  ghost.wireframe = wire;
  emotes.on = PAGE === 'mob' && (solo === null || solo === emoteStage) && gen !== 'current';
  emotes.cold = cold && emotes.on ? 1 : 0;
  emotes.force = emotesHeld ? 'each' : null;
  emotes.rate = emotesHeld ? EMOTE_RATE : 1;
  smoke.mesh.visible = smoke.count > 0 && (solo === null || solo === smokeStage) && gen !== 'current';
  if (poser) {
    poser.object.visible = solo === null || solo === poseStage;
    poser.active = solo === poseStage;
    poser.sync(ghost, look);
  }
  tagObjects.forEach((o, i) => (o.visible = labelsOn && stagePages[stageOf.tags[i]] === PAGE && (solo === null || solo === stageOf.tags[i])));
  renderPanel();
};

// Post: HDR + MSAA -> ACES, as the district draws them (alpha to coverage needs the multisampled target).
const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());

// Focus: glide the orbit target and camera to a row.
let glide: { t0: number; from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3 } | null = null;
const place = (it: Item): { target: THREE.Vector3; cam: THREE.Vector3 } => {
  // Far enough to take in `size` metres across.
  const dist = (it.size / 2 / Math.tan((camera.fov * Math.PI) / 360) / Math.max(1, camera.aspect)) * 1.05 + 1;
  return { target: it.at.clone(), cam: it.at.clone().addScaledVector(it.view, dist) };
};
const EVERYTHING: Item = { name: 'everything', at: new THREE.Vector3(0, 1, -11), size: 34, view: new THREE.Vector3(0, 0.75, 1).normalize() };
const focus = (it: Item, now = false): void => {
  const st = items.indexOf(it);
  solo = st < 0 ? null : stageOf.items[st];
  apply();
  const p = place(it);
  if (now) {
    controls.target.copy(p.target);
    camera.position.copy(p.cam);
    controls.update();
    glide = null;
  } else glide = { t0: performance.now(), from: controls.target.clone(), to: p.target, camFrom: camera.position.clone(), camTo: p.cam };
};
(window as unknown as { __focus: (name: string) => boolean }).__focus = (name) => {
  const it = items.find((i) => i.name === name);
  if (it) focus(it, true);
  else if (name === 'everything') focus(EVERYTHING, true);
  return !!it;
};
(window as unknown as { __mob: unknown }).__mob = { scene, camera, controls, poser, ghost, emotes, smoke, meshes, stats, items: items.map((i) => i.name) };

function renderPanel(): void {
  const panel = $('panel');
  panel.innerHTML = '';
  const section = (title: string): void => {
    const h = document.createElement('h3');
    h.textContent = title;
    panel.appendChild(h);
  };
  const button = (text: string, on: boolean, fn: () => void): void => {
    const b = document.createElement('button');
    b.textContent = text;
    if (on) b.className = 'on';
    b.onclick = fn;
    panel.appendChild(b);
  };
  const set = (fn: () => void) => (): void => {
    fn();
    apply();
  };
  if (poser) {
    // Two tabs: the showroom, and posing, which has the panel to itself.
    const posing = solo === poseStage;
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-bottom:6px';
    for (const [name, on, go] of [['Showroom', !posing, () => focus(items.find((it) => it.name !== 'pose' && !it.close) ?? EVERYTHING)], ['Pose', posing, () => focus(items.find((it) => it.name === 'pose')!)]] as const) {
      const b = document.createElement('button');
      b.textContent = name;
      b.style.cssText = 'text-align:center;padding:5px 6px;text-transform:uppercase;letter-spacing:1px';
      if (on) b.className = 'on';
      else b.onclick = go;
      tabs.appendChild(b);
    }
    panel.appendChild(tabs);
    if (posing) {
      poser.panel(panel, apply);
      section('Backdrop');
      for (const m of ['studio', 'day', 'night'] as const) button(m, mode === m, set(() => (mode = m)));
      section('Look (K)');
      for (const l of MOB_LOOK_NAMES) button(l, look === l, set(() => (look = l)));
      return;
    }
  }
  section('Figures (M)');
  button('new (under review)', gen === 'new', set(() => (gen = 'new')));
  button('current (in the district)', gen === 'current', set(() => (gen = 'current')));
  button('both (current behind)', gen === 'both', set(() => (gen = 'both')));
  section('Backdrop');
  for (const m of ['studio', 'day', 'night'] as const) button(m, mode === m, set(() => (mode = m)));
  section('The old look');
  button('all black and see-through, as it first was (B)', allBlack, set(original));
  button('see-through (O)', look === 'ghost', set(() => (look = look === 'ghost' ? 'solid' : 'ghost')));
  button('black skin, hair and shoes (C)', oneColor, set(() => (oneColor = !oneColor)));
  section('Look (K)');
  for (const l of MOB_LOOK_NAMES) button(l, look === l, set(() => (look = l)));
  section('Head size · sculpted figures');
  for (const k of HEADS) {
    button(k === 1 ? 'as it was (100%)' : `smaller (${Math.round(k * 100)}%)`, headSize === k, () => {
      const q = new URLSearchParams(location.search);
      q.set('head', String(k));
      location.search = q.toString();
    });
  }
  section('Edges (G)');
  for (const k of EDGES) button(k === 0 ? 'even all over' : k === 0.2 ? 'denser at edges and folds (the district)' : 'a little denser at edges', edge === k, set(() => (edge = k)));
  section('Skin (N) · new figures');
  for (const k of SKINS) button(k === 1 ? 'as dark as the clothes' : `lighter ×${k}`, skin === k, set(() => (skin = k)));
  section('Motion');
  button(still ? 'standing still (T)' : 'going about their routine (T)', !still, set(() => (still = !still)));
  button(labelsOn ? 'labels on (L)' : 'labels off (L)', labelsOn, set(() => (labelsOn = !labelsOn)));
  button(emotesHeld ? 'emotes held up' : 'emotes come and go', !emotesHeld, set(() => (emotesHeld = !emotesHeld)));
  button(cold ? 'cold: breath shows (emotes row)' : 'warm: no breath', cold, set(() => (cold = !cold)));
  button(`smoke: ${WINDS[windy][0]}`, windy > 0, set(() => {
    windy = (windy + 1) % WINDS.length;
    smokeWind.set(WINDS[windy][1], WINDS[windy][2]);
    smoke.wind = smokeWind;
  }));
  if (PAGE === 'characters') {
    // Their fingers' and toes' bones, to see them work.
    section('Hands and toes');
    const curl = ghost.uniforms.uCurl, toes = ghost.uniforms.uToes;
    for (const [name, k] of [['hands relaxed', 0], ['half closed', 0.5], ['fists', 1]] as const) button(name, curl.value === k, set(() => (curl.value = k)));
    button(toes.value ? 'toes up' : 'toes flat', toes.value > 0, set(() => (toes.value = toes.value ? 0 : 0.6)));
  }
  section('Views');
  button('everything', solo === null, () => focus(EVERYTHING));
  for (const it of items) if (!it.close && it.name !== 'pose') button(it.name, false, () => focus(it));
  section('Close-ups');
  for (const it of items) if (it.close) button(it.name, false, () => focus(it));
  const a = document.createElement('a');
  a.href = 'models.html';
  a.textContent = '→ the showrooms (cars, plants, buildings, ...)';
  panel.appendChild(a);
  const other = document.createElement('a');
  other.href = PAGE === 'mob' ? 'characters.html' : 'mob.html';
  other.textContent = PAGE === 'mob' ? '→ characters (named, built on these bodies)' : "→ mob showroom (the crowd's bodies and outfits)";
  if (PAGE === 'mob') {
    const ph = document.createElement('a');
    ph.href = 'mob-ph.html';
    ph.textContent = "→ Manila's people (the Filipino outfits)";
    panel.appendChild(ph);
  }
  panel.appendChild(other);
  // The figures modelled with MakeHuman (they used to stand here) have a page of their own.
  const humans = document.createElement('a');
  humans.href = 'humans.html';
  humans.textContent = '→ MakeHuman test (modelled figures)';
  humans.style.display = 'block';
  panel.appendChild(humans);
  // The scene editor poses these same figures in the rooms behind the city's windows.
  const scenes = document.createElement('a');
  scenes.href = 'scenes.html';
  scenes.textContent = '→ scene editor (the rooms behind the windows)';
  scenes.style.display = 'block';
  panel.appendChild(scenes);
}

/** The original look, on or off: everything black and see-through; off, back to solid and coloured. */
function original(): void {
  allBlack = !allBlack;
  look = allBlack ? 'ghost' : 'solid';
}

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  const cycle = <T,>(list: readonly T[], v: T): T => list[(list.indexOf(v) + 1) % list.length];
  if (e.code === 'KeyM') gen = cycle(['new', 'current', 'both'] as const, gen);
  else if (e.code === 'Digit1') mode = 'studio';
  else if (e.code === 'Digit2') mode = 'day';
  else if (e.code === 'Digit3') mode = 'night';
  else if (e.code === 'KeyK') look = cycle(MOB_LOOK_NAMES, look);
  else if (e.code === 'KeyC') oneColor = !oneColor;
  else if (e.code === 'KeyB') original();
  else if (e.code === 'KeyO') look = look === 'ghost' ? 'solid' : 'ghost';
  else if (e.code === 'KeyG') edge = cycle(EDGES, EDGES.includes(edge) ? edge : 0);
  else if (e.code === 'KeyN') skin = cycle(SKINS, SKINS.includes(skin) ? skin : 1);
  else if (e.code === 'KeyT') still = !still;
  else if (e.code === 'KeyL') labelsOn = !labelsOn;
  else if (e.code === 'KeyX') wire = !wire;
  else if (e.code === 'KeyR') turntable = !turntable;
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

focus(items.find((i) => i.name === query.get('view')) ?? items.find((i) => i.name === (PAGE === 'characters' ? CHARACTERS[0]?.name : PAGE === 'ph' ? 'filipino (under review)' : 'woman turned round')) ?? (items.find((i) => i.name === 'all bodies') ?? items[0]), true);

const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
// (A fixed time for scripted shots: ?t=seconds.)
const fixedTime = query.has('t') ? Number(query.get('t')) : null;
// (And a script sets it shot by shot: __mob.fixedTime.)
const hooks = (window as unknown as { __mob: { fixedTime?: number } }).__mob;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
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
  controls.autoRotate = turntable;
  controls.update();
  ghost.uniforms.uTime.value = hooks.fixedTime ?? fixedTime ?? performance.now() / 1000;
  if (poser) {
    poser.material.uniforms.uTime.value = ghost.uniforms.uTime.value;
    // (Its dots keep their size on the screen as the camera moves.)
    poser.sync(ghost, look);
  }
  composer.render(dt);
  labels.render(scene, camera);
  const S = stats.shaped, C = stats.classic;
  $('hud').textContent = [
    `${PAGE === 'characters' ? 'CHARACTERS' : PAGE === 'ph' ? 'MOB SHOWROOM (MANILA)' : 'MOB SHOWROOM'} · ${gen === 'new' ? 'NEW figures (under review)' : gen === 'current' ? 'current figures (the district)' : 'both: new in front, current behind'} · ${mode} · look ${look}`,
    `triangles a figure (plain man / woman): new ${S.man} / ${S.woman}, current ${C.man} / ${C.woman} · built in ${S.ms.toFixed(0)} ms / ${C.ms.toFixed(0)} ms`,
    'left-drag orbit · right-drag pan · wheel zoom · WASD / Q E fly (Shift faster)',
    `M figures · 1 studio · 2 day · 3 night · K look · C one colour · G edges · N skin · T ${still ? 'still' : 'routine'} · L labels · X wireframe${wire ? ' (on)' : ''} · R turntable${turntable ? ' (on)' : ''}`,
  ].join('\n');
});
