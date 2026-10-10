import '../showroom/nav';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Character, registerCharacters, setCharacterEnvironment } from '../models/characters';

/**
 * The figures test area (figures.html; dev server only, nothing in a build): the generated, rigged figures of
 * debug-shots/props/ (every *rigged*.glb there, found when the page opens; re-save this file for a new one on a
 * running server) on a floor of their own, away from the showrooms and the district. Pick a figure, a clip, a light
 * (studio, day, dusk, night: the night glow is trialFigure.ts's) and a distance (the game's own 68 degree lens, from
 * eye height, at the distances a player stands: the point of the page is to see them as they'll be seen).
 * `?figure=<path under debug-shots/props/>` opens one; `?light=night&dist=3&clip=Walk_Normal_105_Loop` set the rest.
 * Space pauses, left-drag orbits. Nothing here is a verdict: a figure goes into the game by the user's word.
 */
const found = import.meta.glob('/debug-shots/props/**/*rigged*.glb', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
const names = Object.keys(found).sort();
const query = new URLSearchParams(location.search);

const CLIPS = ['Idle_Loop', 'Walk_Normal_105_Loop', 'Walk_Slow_105_Loop', 'Walk_12_Loop', 'Jog_Fwd_Loop', 'Sitting_Idle_Loop', 'Idle_Talking_Loop'];
const LIGHTS = ['studio', 'day', 'dusk', 'night'] as const;
type Light = (typeof LIGHTS)[number];
const DISTANCES = [1.2, 2, 3, 5, 10];
const LOOKS: Record<Light, { bg: number; hemi: [number, number, number]; sun: [number, number]; pos: [number, number, number]; glow: number }> = {
  studio: { bg: 0x2a2c31, hemi: [0xdfe6f0, 0x3a3630, 1.1], sun: [0xfff2e0, 2.6], pos: [3, 6, 4], glow: 0 },
  day: { bg: 0x9ec4ea, hemi: [0xcfe0f5, 0x6b6a60, 1.5], sun: [0xfff4e2, 3.4], pos: [4, 7, 3], glow: 0 },
  dusk: { bg: 0x4a3a52, hemi: [0x8a7aa8, 0x2a2430, 0.7], sun: [0xff9a68, 1.5], pos: [6, 1.6, 3], glow: 0.12 },
  night: { bg: 0x07080d, hemi: [0x2a3050, 0x0a0a10, 0.25], sun: [0xffc890, 0.5], pos: [2, 4, 3], glow: 0.3 },
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
(window as unknown as { __view: (...v: number[]) => void }).__view = (x, y, z, tx, ty, tz) => {
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  controls.update();
};
const hemi = new THREE.HemisphereLight();
const sun = new THREE.DirectionalLight();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 40 });
sun.shadow.normalBias = 0.02;
scene.add(hemi, sun, sun.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x6a6862, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
const grid = new THREE.GridHelper(60, 60, 0x8a8f9c, 0x3f424a);
grid.position.y = 0.002;
scene.add(floor, grid);
setCharacterEnvironment(new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture);

let light: Light = LIGHTS.find((l) => l === query.get('light')) ?? 'studio';
let glow = 0;
let character: Character | null = null;
let glowing: THREE.MeshStandardMaterial[] = [];
let current = '';
let clip = query.get('clip') ?? 'Idle_Loop';
let dist = Number(query.get('dist')) || 3;
let paused = false;

function setLight(l: Light): void {
  light = l;
  const k = LOOKS[l];
  scene.background = new THREE.Color(k.bg);
  hemi.color.set(k.hemi[0]);
  hemi.groundColor.set(k.hemi[1]);
  hemi.intensity = k.hemi[2];
  sun.color.set(k.sun[0]);
  sun.intensity = k.sun[1];
  sun.position.set(...k.pos);
  glow = k.glow;
  for (const m of glowing) m.emissiveIntensity = glow;
  panel();
}

async function show(path: string): Promise<void> {
  current = path;
  if (character) scene.remove(character.root);
  // (A name of its own for each: the loader remembers a model by its name, so one shared name showed the first figure every time.)
  // (And the time in the name and in the address, so a file rebuilt in place isn't served from the browser's cache or the loader's.)
  const stamp = Date.now();
  const id = `figure:${path}:${stamp}`;
  registerCharacters({ [id]: `${await found[path]()}?t=${stamp}` });
  character = await Character.load(id);
  glowing = [];
  character.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mat as THREE.MeshStandardMaterial;
      if (!s.map || s.alphaTest > 0) continue;
      s.emissiveMap = s.map;
      s.emissive.set(0xffffff);
      s.emissiveIntensity = glow;
      glowing.push(s);
    }
  });
  scene.add(character.root);
  await character.play(clip, 0, true);
  look();
  panel();
}

/** The camera `dist` metres in front of the figure, at eye height, looking at the chest: as a player standing there. */
function look(): void {
  camera.position.set(0, 1.6, dist);
  controls.target.set(0, 1.0, 0);
  controls.update();
}

async function setClip(c: string): Promise<void> {
  clip = c;
  if (character) await character.play(c, 0.2, true);
  panel();
}

const panelEl = document.getElementById('panel')!;
function button(label: string, on: boolean, f: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (on) b.className = 'on';
  b.onclick = f;
  return b;
}
function panel(): void {
  panelEl.replaceChildren();
  const add = (title: string, items: HTMLElement[], row = false): void => {
    const h = document.createElement('h3');
    h.textContent = title;
    panelEl.appendChild(h);
    const box = document.createElement('div');
    if (row) box.className = 'row';
    box.append(...items);
    panelEl.appendChild(box);
  };
  const none = document.createElement('div');
  none.textContent = 'No *rigged*.glb under debug-shots/props/ yet.';
  add('Figure', names.length ? names.map((n) => button(n.replace('/debug-shots/props/', ''), n === current, () => void show(n))) : [none]);
  add('Clip', CLIPS.map((c) => button(c, c === clip, () => void setClip(c))));
  add('Light', LIGHTS.map((l) => button(l, l === light, () => setLight(l))), true);
  add('From (m)', DISTANCES.map((d) => button(String(d), d === dist, () => { dist = d; look(); panel(); })), true);
}

const hud = document.getElementById('hud')!;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (character && !paused) character.update(dt);
  controls.update();
  renderer.render(scene, camera);
  hud.textContent = `${current.replace('/debug-shots/props/', '') || '(none)'}\n${clip} · ${light} · ${dist} m from her · ${camera.fov} degree lens`;
});
addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code === 'Space') {
    paused = !paused;
    e.preventDefault();
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
(window as unknown as { __figures: unknown }).__figures = { show, setClip, setLight, look: (d: number) => { dist = d; look(); }, names: () => names, ready: () => !!character };
setLight(light);
const wanted = query.get('figure');
const first = names.find((n) => (wanted ? n.endsWith(wanted) : n.endsWith('tpose/tpose_rigged.glb'))) ?? names[0];
if (first) void show(first);
