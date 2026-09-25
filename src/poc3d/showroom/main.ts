import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { addCar, CAR_TYPES } from '../real/cars';
import { cityMaterial, cityUniforms } from '../real/city';
import { KIND, lin, MeshBuilder } from '../real/meshBuilder';
import { addFigure, GHOST_COLORS, GhostBuilder, ghostMaterial, type Body, type FigureSpec, type Hair, type Pose } from '../real/people';

/**
 * Model showroom: every car type and every person body type x pose, laid out in a clean space with studio
 * lighting, for reviewing the designs before they go into the world. Uses the same builders and
 * materials as the district (city material for cars, ghost material for people, ACES + bloom), but no
 * city, lightmap or ASCII overlay.
 * Mouse: left-drag orbit, right-drag pan, wheel zoom. Keys: WASD / Q E fly the view (Shift faster),
 * 1 studio / 2 night / 3 day lighting, L labels, X wireframe, B bloom, R turntable.
 */

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(window.innerWidth, window.innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' });
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 500);
camera.position.set(0, 7, 24);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 4);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.update();

// Lighting: a key light with soft shadows, sky/ground fill, and two warm "street" point lights for night.
const hemi = new THREE.HemisphereLight();
const key = new THREE.DirectionalLight();
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 120 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.02;
key.position.set(18, 30, 22);
const street = [new THREE.PointLight(0xffc98a, 0, 30, 1.6), new THREE.PointLight(0xffc98a, 0, 30, 1.6), new THREE.PointLight(0x9ac8ff, 0, 30, 1.6)];
street[0].position.set(-6, 5.5, 1);
street[1].position.set(6, 5.5, 9);
street[2].position.set(0, 5, 15);
scene.add(hemi, key, ...street);

const cityU = cityUniforms();
cityU.uLightGain.value = 0;
const city = cityMaterial(cityU);
const ghost = ghostMaterial();

// Floor: asphalt pad for the cars, a paved area for the people, on a neutral studio floor.
const floor = new MeshBuilder();
floor.kind = KIND.lot;
floor.color = lin(0x5e5e5c);
floor.box(0, 6, -0.2, 0, 80, 80, KIND.lot);
floor.kind = KIND.asphalt;
floor.box(0, -4, 0, 0.02, 18, 16, KIND.asphalt);
floor.kind = KIND.plain;
floor.color = lin(0x8a867e);
floor.box(0, 17.5, 0, 0.15, 17, 23, KIND.sidewalk);
const floorMesh = new THREE.Mesh(floor.build()!, city);
floorMesh.receiveShadow = true;
scene.add(floorMesh);

interface Item {
  readonly name: string;
  readonly group: string;
  readonly at: THREE.Vector3;
  readonly size: number;
  /** Fixed viewing direction (from the item towards the camera); otherwise keep the current one. */
  readonly view?: THREE.Vector3;
}
/** People face +z in rows; viewed from the front and ~30 degrees up, the row in front doesn't block. */
const FRONT_VIEW = new THREE.Vector3(0, 0.55, 0.85).normalize();
const items: Item[] = [];
const labelObjects: CSS2DObject[] = [];
const label = (text: string, x: number, y: number, z: number): void => {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.position.set(x, y, z);
  scene.add(o);
  labelObjects.push(o);
};

// Cars: one of each type facing the camera, and a second row with other paints, facing away.
const carRows: { z: number; dir: number; paints: Record<string, number> }[] = [
  { z: -1.5, dir: 1, paints: { sedan: 0xe2e2de, kei: 0x9ac8b0, minivan: 0xa8aaae, taxi: 0x141416 } },
  { z: -8.5, dir: -1, paints: { sedan: 0x1e2c48, kei: 0xc8b48c, minivan: 0x141416, taxi: 0xd89a20 } },
];
const carMb = new MeshBuilder();
for (const [ri, row] of carRows.entries()) {
  CAR_TYPES.forEach((type, i) => {
    const x = -6 + i * 4;
    addCar(carMb, { x, z: row.z, fx: 0, fz: row.dir, variant: 1, type, paint: row.paints[type] });
    const name = `${type}${ri ? ' (alt paint)' : ''}`;
    items.push({ name, group: 'Cars', at: new THREE.Vector3(x, 0.8, row.z), size: 4.5 });
    label(name, x, 2.4, row.z);
  });
}
const cars = new THREE.Mesh(carMb.build()!, city);
cars.castShadow = cars.receiveShadow = true;
scene.add(cars);

// People: body types (rows) x poses (columns), plus a row of hair / clothing variants.
const BODIES: Body[] = ['man', 'woman', 'child', 'elder'];
const POSES: Pose[] = ['stand', 'walk', 'talk', 'phone', 'pockets', 'wave', 'hold'];
const DX = 2.0;
const DZ = 3.6;
const x0 = -((POSES.length - 1) * DX) / 2;
const peopleRoot = new THREE.Group();
scene.add(peopleRoot);
const person = (s: FigureSpec): void => {
  const gb = new GhostBuilder();
  addFigure(gb, s);
  const m = new THREE.Mesh(gb.build(0, 0)!, ghost);
  m.renderOrder = 2;
  peopleRoot.add(m);
};
const base = (x: number, z: number, body: Body, pose: Pose, color: [number, number, number]): FigureSpec => ({
  x, z, yaw: 0, body, pose, color, hair: body === 'woman' ? 'long' : body === 'elder' ? 'none' : 'short',
  long: false, phase: 0.25, side: 1, look: 0,
});
BODIES.forEach((body, r) => {
  const z = 8 + r * DZ;
  POSES.forEach((pose, c) => {
    const x = x0 + c * DX;
    person(base(x, z, body, pose, GHOST_COLORS[r % GHOST_COLORS.length] as [number, number, number]));
    label(`${body} · ${pose}`, x, body === 'child' ? 1.5 : 2.2, z);
  });
  items.push({ name: `${body} × all poses`, group: 'People', at: new THREE.Vector3(0, 1, z), size: 7, view: FRONT_VIEW });
});
const variants: [string, Body, Hair, boolean, Pose][] = [
  ['woman · dress + bun', 'woman', 'bun', true, 'stand'],
  ['woman · skirt + long hair', 'woman', 'long', true, 'walk'],
  ['woman · hat', 'woman', 'hat', false, 'talk'],
  ['man · coat + hat', 'man', 'hat', true, 'pockets'],
  ['man · cap', 'man', 'cap', false, 'walk'],
  ['elder · hat', 'elder', 'hat', false, 'stand'],
  ['child · cap', 'child', 'cap', false, 'wave'],
];
const zv = 8 + BODIES.length * DZ;
variants.forEach(([name, body, hair, long, pose], c) => {
  const x = x0 + c * DX;
  person({ ...base(x, zv, body, pose, GHOST_COLORS[(c + 4) % GHOST_COLORS.length] as [number, number, number]), hair, long });
  label(name, x, body === 'child' ? 1.5 : 2.3, zv);
});
items.push({ name: 'hair / clothing variants', group: 'People', at: new THREE.Vector3(0, 1, zv), size: 7, view: FRONT_VIEW });
// Groups as they appear in the street: talking pair, parent + child holding hands, couple walking.
const zg = zv + DZ + 0.4;
person({ ...base(-4.5, zg - 0.45, 'woman', 'talk', GHOST_COLORS[1] as [number, number, number]), hair: 'bun' });
person({ ...base(-4.5, zg + 0.45, 'man', 'stand', GHOST_COLORS[0] as [number, number, number]), yaw: Math.PI });
person({ ...base(-0.3, zg, 'woman', 'hold', GHOST_COLORS[3] as [number, number, number]), side: 1 });
person({ ...base(0.3, zg, 'child', 'hold', GHOST_COLORS[4] as [number, number, number]), side: -1, hair: 'cap', look: -0.3 });
person({ ...base(4.15, zg, 'man', 'walk', GHOST_COLORS[5] as [number, number, number]) });
person({ ...base(4.85, zg + 0.1, 'woman', 'walk', GHOST_COLORS[2] as [number, number, number]), phase: 0.75, look: -0.4, long: true });
label('talking pair', -4.5, 2.4, zg);
label('parent + child', 0, 2.4, zg);
label('couple walking', 4.5, 2.4, zg);
items.push({ name: 'groups', group: 'People', at: new THREE.Vector3(0, 1, zg), size: 6, view: FRONT_VIEW });

// Lighting modes.
type Mode = 'studio' | 'night' | 'day';
let mode: Mode = 'studio';
const applyMode = (m: Mode): void => {
  mode = m;
  const L = {
    studio: { bg: 0x2a2c30, hs: 0xdde4ee, hg: 0x4a4640, hi: 1.4, kc: 0xfff4e8, ki: 2.4, exp: 1.0, pts: 0, zen: 0x9aa4b4, hor: 0xc8ccd4, lamps: 0.3 },
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
  cityU.uNeon.value = m === 'day' ? 0 : 1;
  renderPanel();
};

// Post: HDR + MSAA -> bloom -> ACES, like the district (no ASCII overlay here).
const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.45, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Focus: glide the orbit target and camera to an item.
let glide: { t0: number; from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3 } | null = null;
const focus = (it: Item): void => {
  const dir = it.view ? it.view.clone() : camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.25) dir.y = 0.35;
  dir.normalize();
  glide = { t0: performance.now(), from: controls.target.clone(), to: it.at.clone(), camFrom: camera.position.clone(), camTo: it.at.clone().addScaledVector(dir, it.size * 1.3) };
};

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
  section('Lighting');
  for (const m of ['studio', 'night', 'day'] as const) button(m, mode === m, () => applyMode(m));
  for (const g of ['Cars', 'People']) {
    section(g);
    for (const it of items.filter((i) => i.group === g)) button(it.name, false, () => focus(it));
  }
  section('View');
  button('overview', false, () => focus({ name: '', group: '', at: new THREE.Vector3(0, 1, 8), size: 20, view: new THREE.Vector3(0.3, 0.6, 0.75).normalize() }));
}
applyMode('studio');

// Fly keys move the camera and its orbit target together.
const keys = new Set<string>();
let turntable = false;
let wire = false;
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Digit1') applyMode('studio');
  if (e.code === 'Digit2') applyMode('night');
  if (e.code === 'Digit3') applyMode('day');
  if (e.code === 'KeyL') for (const o of labelObjects) o.visible = !o.visible;
  if (e.code === 'KeyB') bloom.enabled = !bloom.enabled;
  if (e.code === 'KeyR') turntable = !turntable;
  if (e.code === 'KeyX') {
    wire = !wire;
    city.wireframe = wire;
    ghost.wireframe = wire;
  }
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

const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 14 : 4) * dt;
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
    const t = Math.min(1, (performance.now() - glide.t0) / 600);
    const k = t * t * (3 - 2 * t);
    controls.target.lerpVectors(glide.from, glide.to, k);
    camera.position.lerpVectors(glide.camFrom, glide.camTo, k);
    if (t >= 1) glide = null;
  }
  controls.autoRotate = turntable;
  controls.update();
  cityU.uTime.value = performance.now() / 1000;
  composer.render(dt);
  labels.render(scene, camera);
  $('hud').textContent = [
    `MODEL SHOWROOM · ${mode} lighting · ${CAR_TYPES.length} car types · ${BODIES.length} bodies × ${POSES.length} poses + variants`,
    'left-drag orbit · right-drag pan · wheel zoom · WASD / Q E fly (Shift faster)',
    `1 studio · 2 night · 3 day · L labels · X wireframe${wire ? ' (on)' : ''} · B bloom${bloom.enabled ? '' : ' (off)'} · R turntable${turntable ? ' (on)' : ''}`,
  ].join('\n');
});
