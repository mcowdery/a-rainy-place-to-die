import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { cityMaterial, cityUniforms } from '../real/city';
import { KIND, lin, MeshBuilder } from '../real/meshBuilder';
import { setCharacterEnvironment } from '../models/characters';
import { CensorPass } from '../models/censorPass';
import { installSnap } from '../../debug/snap';
import { GORE_LEVELS, STANCES } from '../models/melee';
import { FightMode, KILL_CHANCES, type Hand } from './fightMode';
import { buildWeaponRack } from './weaponRack';

/**
 * The fight test (fight.html): a yard for trying the melee (models/brawl.ts) as Mack in first person, apart from
 * the model showroom it began in. A paved floor with a wall on three sides (for wall slams and blood on walls;
 * nothing collides with them, you or the thugs), open to the south, and the weapon rack (fight/weaponRack.ts) by
 * where he starts. The page starts in first person
 * (fight/fightMode.ts has the keys); V orbits the yard from outside, the fight paused, and V again goes back in.
 * The panel sets what's in hand, who you're up against, the gore and the lighting.
 * Shelved, and back only by the URL: swings picked by the mouse's way (`?swings=mouse`) and kill moves (`?killmoves=0.8`).
 * `?hand=fists|katana|bat|gun`, `?duel=1`, `?light=studio|night|day`, and the fight's own `?gore=`, `?killmoves=`.
 */

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const query = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // (PCFSoftShadowMap is removed in three: it swaps this in at the first render, recompiling every shadowed shader)
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 500);
camera.position.set(0, 9, 24);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.update();
// For scripted screenshots: __view(x, y, z, tx, ty, tz) puts the camera at (x, y, z) looking at (tx, ty, tz).
(window as unknown as { __view: (...v: number[]) => void }).__view = (x, y, z, tx, ty, tz) => {
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  controls.update();
};

// Lighting, as the showroom's: a key light with soft shadows, sky/ground fill, and three "street" point lights
// for night (always there, only dimmed: a light added or removed recompiles every shader).
const hemi = new THREE.HemisphereLight();
const key = new THREE.DirectionalLight();
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 120 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.02;
key.position.set(14, 30, 22);
const street = [new THREE.PointLight(0xffc98a, 0, 30, 1.6), new THREE.PointLight(0xffc98a, 0, 30, 1.6), new THREE.PointLight(0x9ac8ff, 0, 30, 1.6)];
street[0].position.set(-6, 5.5, -5);
street[1].position.set(6, 5.5, 2);
street[2].position.set(0, 5, 9);
scene.add(hemi, key, ...street);

const cityU = cityUniforms();
cityU.uLightGain.value = 0;
// Summer: no petals or leaves on the paving, so what's on the floor is blood.
cityU.uSeason.value = 1;
const city = cityMaterial(cityU);

// The yard: one paved slab (the floor is 0 everywhere), and a wall along its north, east and west sides.
const YARD = 20;
const WALL_H = 3.2;
const WALL_T = 0.4;
const slab = new MeshBuilder();
slab.kind = KIND.plain;
slab.color = lin(0x8a867e);
slab.box(0, 4, -0.2, 0, YARD * 2, YARD * 2 + 8, KIND.sidewalk);
const slabMesh = new THREE.Mesh(slab.build()!, city);
slabMesh.receiveShadow = true;
scene.add(slabMesh);
const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 });
const wall = (w: number, d: number, x: number, z: number): void => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), concrete);
  m.position.set(x, WALL_H / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
};
wall(YARD + WALL_T * 2, WALL_T, 0, -(YARD + WALL_T) / 2);
wall(WALL_T, YARD, -(YARD + WALL_T) / 2, 0);
wall(WALL_T, YARD, (YARD + WALL_T) / 2, 0);

const pmrem = new THREE.PMREMGenerator(renderer);
const charEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
setCharacterEnvironment(charEnv);

// The weapon rack (the katana, its saya and the bat), to the left of where he starts, turned toward him.
const weaponRack = buildWeaponRack(charEnv);
weaponRack.position.set(-2.4, 0, 0.6);
weaponRack.rotation.y = 0.75;
scene.add(weaponRack);

// Mack in first person, in the yard facing its north wall.
const fp = new FightMode(scene, camera, renderer.domElement, controls, charEnv, () => 0);
const enterFp = (): Promise<void> => fp.enter(0, 3, 0);
(window as unknown as { __fp: unknown }).__fp = fp.script();
// For scripted shots that add to the scene (a wall of their own).
(window as unknown as { __lab: unknown }).__lab = { THREE, scene, env: charEnv };
/** Into first person if it isn't (the fight is around him, not the orbiting camera), then `fn`. */
const inFight = (fn: () => void): void => {
  if (fp.active) fn();
  else void enterFp().then(fn);
};

// Lighting modes.
type Mode = 'studio' | 'night' | 'day';
const MODES: readonly Mode[] = ['studio', 'night', 'day'];
let mode: Mode = 'studio';
const applyMode = (m: Mode): void => {
  mode = m;
  const L = {
    studio: { bg: 0x2a2c30, hs: 0xdde4ee, hg: 0x4a4640, hi: 1.4, kc: 0xfff4e8, ki: 2.4, exp: 1.0, pts: 0, zen: 0x9aa4b4, hor: 0xc8ccd4, lamps: 0 },
    night: { bg: 0x05060a, hs: 0x3a4668, hg: 0x2a2018, hi: 0.25, kc: 0x9fb0ff, ki: 0.3, exp: 1.2, pts: 60, zen: 0x03050c, hor: 0x2c1e2a, lamps: 1 },
    day: { bg: 0x7aa4d4, hs: 0xbcd4f0, hg: 0x5a4e40, hi: 1.3, kc: 0xfff1dc, ki: 3.2, exp: 0.85, pts: 0, zen: 0x3f78c0, hor: 0xb8cfe0, lamps: 0 },
  }[m];
  (scene.background as THREE.Color).setHex(L.bg);
  hemi.color.setHex(L.hs);
  hemi.groundColor.setHex(L.hg);
  hemi.intensity = L.hi;
  key.color.setHex(L.kc);
  key.intensity = L.ki;
  for (const p of street) p.intensity = L.pts;
  renderer.toneMappingExposure = L.exp;
  cityU.uZenith.value.setHex(L.zen);
  cityU.uHorizon.value.setHex(L.hor);
  cityU.uRoomAmbient.value.setHex(L.hs).multiplyScalar(L.hi * 0.12);
  cityU.uLamps.value = L.lamps;
  cityU.uLightGain.value = 1.4 * L.lamps;
  cityU.uNeon.value = m === 'day' ? 0 : 1;
  cityU.uSunDir.value.copy(key.position).normalize();
  cityU.uSunCol.value.copy(key.color).multiplyScalar(key.intensity);
};

// Post: HDR + MSAA -> bloom -> ACES, like the district (no ASCII overlay here).
const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.45, 1.6));
composer.addPass(new OutputPass());
// Mack's face censored on the finished image when the style asks (models/censorPass.ts): a kill move's
// cinematic angle and third person show his head.
const censor = new CensorPass();
composer.addPass(censor);

const HANDS: readonly (readonly [Hand, string])[] = [['gun', 'guns (1)'], ['fists', 'fists (2)'], ['katana', 'katana (3)'], ['bat', 'bat (4)']];
function renderPanel(): void {
  const panel = $('panel');
  panel.innerHTML = '';
  // A section's buttons share a row (the whole panel has to fit: with the mouse captured it can't be scrolled).
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
  const b = fp.brawl;
  section('In hand');
  for (const [h, text] of HANDS) button(text, fp.hand === h, () => inFight(() => fp.pick(h)));
  if (fp.hand === 'katana' || fp.hand === 'bat') {
    section('Stance (R up, C down)');
    button('follows aim', fp.autoStance, () => (fp.autoStance = !fp.autoStance));
    for (const s of STANCES) button(s, b.melee.stance === s, () => fp.setStance(s));
    section('Grip (H)');
    button('two hands', !b.melee.oneHand, () => (b.melee.oneHand = false));
    button('one hand', b.melee.oneHand, () => (b.melee.oneHand = true));
  }
  if (fp.hand !== 'gun') {
    section('Moves (L)');
    button('keyed', b.melee.style === 'keys', () => void fp.setStyle('keys'));
    button('library clips', b.melee.style === 'clips', () => void fp.setStyle('clips'));
  }
  section('Against');
  for (const n of [1, 2, 4, 6]) button(n === 1 ? 'one man' : `${n}${n === 4 ? ' (T)' : ''}`, false, () => inFight(() => fp.spawn(n)));
  button('a duel (B)', false, () => inFight(() => fp.duel()));
  button('nobody', false, () => inFight(() => fp.spawn(0)));
  section('Gore (Y)');
  for (const g of GORE_LEVELS) button(g, b.gore.level === g, () => fp.setGore(g));
  // (Kill moves are shelved: their row shows only when the URL has them on, `?killmoves=0.8`.)
  if (b.killMoves) {
    section('Kill-move chance (U)');
    for (const k of KILL_CHANCES) button(`${Math.round(k * 100)}%`, Math.abs(b.killChance - k) < 1e-3, () => (b.killChance = k));
  }
  section('Lighting');
  for (const m of MODES) button(m, mode === m, () => applyMode(m));
  section('View');
  button(fp.active ? 'orbit the yard (V)' : 'Mack, first person (V)', fp.active, () => (fp.active ? fp.exit() : void enterFp()));
  button(fp.third ? 'third person (Q)' : 'first person (Q)', fp.third, () => (fp.third = !fp.third));
  section('Keys');
  for (const line of fp.keyHelp()) {
    const p = document.createElement('p');
    p.textContent = line;
    row.appendChild(p);
  }
  section('Models');
  button('→ the model showroom', false, () => (location.href = 'models.html'));
}
/** What the panel shows, to redraw it when a key changes any of it. */
const panelState = (): string => [fp.active, fp.third, fp.hand, fp.autoStance, fp.brawl.melee.stance, fp.brawl.melee.oneHand, fp.brawl.melee.style, fp.brawl.gore.level, fp.brawl.killChance, mode].join('|');
let panelShown = '';

applyMode(MODES.find((m) => m === query.get('light')) ?? 'studio');
void enterFp().then(() => {
  const hand = HANDS.find(([h]) => h === query.get('hand'))?.[0];
  if (hand) fp.pick(hand);
  if (query.get('duel') === '1') fp.duel();
});

// V from the orbiting view goes back in (in first person the mode's own V comes out; `wasActive` is last frame's,
// so the V that came out isn't also read as going in).
let wasActive = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyV' && !fp.active && !wasActive) void enterFp();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// F9: a snapshot and a note for reporting an issue (debug/snap.ts, saved to debug-shots/).
const snap = installSnap(renderer.domElement, 'fight', () => ({
  hand: fp.hand,
  third: fp.third,
  stance: fp.brawl.melee.stance,
  oneHand: fp.brawl.melee.oneHand,
  moves: fp.brawl.melee.style,
  move: fp.brawl.melee.move?.id ?? null,
  phase: Number(fp.brawl.melee.phase.toFixed(2)),
  eyes: camera.position.toArray().map((x) => Number(x.toFixed(2))),
  fight: fp.brawl.state(),
  lighting: mode,
}));

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  wasActive = fp.active;
  if (fp.active) fp.update(dt);
  else controls.update();
  cityU.uTime.value = performance.now() / 1000;
  censor.track(fp.body, camera);
  composer.render(dt);
  snap.afterRender();
  if (panelState() !== panelShown) {
    panelShown = panelState();
    renderPanel();
  }
  $('hud').textContent = fp.active
    ? fp.hud()
    : `FIGHT TEST · orbiting, the fight paused · ${mode} lighting\nleft-drag orbit · right-drag pan · wheel zoom · V back into first person`;
});
