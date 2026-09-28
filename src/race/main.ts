import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { cityMaterial, cityUniforms } from '../poc3d/real/city';
import { MeshBuilder } from '../poc3d/real/meshBuilder';
import { addVehicle, addWheel, wheelLayout } from '../poc3d/models/vehicles';
import { loadCourses } from './courses';
import { buildVenue } from './scene';
import { CarSound } from './sound';
import { Car, COUPE, DRIFT_ASSISTS, type Controls } from './vehicle';

/**
 * The handling test venue (race.html): Kurokami Pass at night. The coupe on the handling model (vehicle.ts),
 * the practice lot and the pass (course.ts, scene.ts). A chase camera that trails the way the car is going
 * (so a drift shows it sideways) or a bumper camera; the dashboard; drift scoring (angle x speed, a chain
 * that banks when you straighten up and is lost if you hit something); timed runs up and down the pass.
 *
 * Keys: W/S (brake, then reverse), A/D, Space handbrake, Q camera, R back on the road, 1 the lot, 2 the top,
 * H hides the help, I inverts mouse Y. A click captures the mouse for looking round. URL: ?at=lot|top|road,
 * ?cam=bumper, ?invertY=1|0.
 */

const params = new URLSearchParams(location.search);
const { courses, errors } = loadCourses();
if (errors.length) {
  document.body.textContent = errors.join('\n');
  throw new Error(errors.join('\n'));
}
const course = courses.get('kurokami')!;
const ground = course.ground;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const sky = document.createElement('canvas');
sky.width = 4;
sky.height = 256;
{
  const g = sky.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#04050c');
  gr.addColorStop(0.55, '#0a0e1e');
  gr.addColorStop(0.8, '#1a1a30');
  // The glow of the city down in the valley, low on the horizon.
  gr.addColorStop(1, '#3a2438');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
}
const skyTex = new THREE.CanvasTexture(sky);
skyTex.colorSpace = THREE.SRGBColorSpace;
scene.background = skyTex;
scene.fog = new THREE.FogExp2(0x0c1020, 0.0042);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);

const venue = buildVenue(course);
scene.add(venue.group);

// The car: the showroom's coupe on the city material (its lamps lit), with two headlight beams.
const cityU = cityUniforms();
cityU.uLightGain.value = 0;
cityU.uLamps.value = 1;
const mb = new MeshBuilder(1 << 17);
addVehicle(mb, { x: 0, z: 0, fx: 0, fz: 1, type: 'sports', paint: Number(params.get('paint') ?? 0xf0f0ec), detail: 0.05, wheels: false });
const carMat = cityMaterial(cityU);
const body = new THREE.Mesh(mb.build()!, carMat);
const carObj = new THREE.Group();
carObj.rotation.order = 'YXZ';
carObj.add(body);
// The wheels, apart from the body so they turn: the fronts steer, all roll with the road, the rears spin up
// with wheelspin and stop dead under the handbrake.
const WL = wheelLayout('sports');
const wheelGeo = new Map<1 | -1, THREE.BufferGeometry>();
for (const sd of [1, -1] as const) {
  const wb = new MeshBuilder(1 << 14);
  addWheel(wb, WL.r, WL.tw, sd, WL.rims);
  wheelGeo.set(sd, wb.build()!);
}
const wheels = WL.spots.map((w) => {
  const m = new THREE.Mesh(wheelGeo.get(w.sd)!, carMat);
  m.position.set(w.x, w.y, w.z);
  m.rotation.order = 'YXZ';
  body.add(m);
  return { m, front: w.front, roll: 0 };
});
scene.add(carObj);
const beams: THREE.SpotLight[] = [];
for (const s of [-0.62, 0.62]) {
  const l = new THREE.SpotLight(0xfff2dc, 140, 140, 0.3, 0.6, 1);
  l.position.set(s, 0.72, 2.1);
  l.target.position.set(s * 1.2, -0.1, 30);
  carObj.add(l, l.target);
  beams.push(l);
}

const car = new Car(COUPE, DRIFT_ASSISTS);
const at = params.get('at') ?? 'lot';
const placeAt = (where: string): void => {
  if (where === 'top') {
    const n = course.x.length - 1;
    const s = course.summit;
    car.place(s.x - course.tx[n] * 6, s.z - course.tz[n] * 6, Math.atan2(-course.tx[n], -course.tz[n]), ground);
  } else if (where === 'road') {
    const i = 60;
    car.place(course.x[i], course.z[i], Math.atan2(course.tx[i], course.tz[i]), ground);
  } else {
    const l = course.def.lot;
    car.place(l.x + l.w / 2 - 20, l.z + l.h - 20, Math.PI, ground);
  }
  chain = 0;
  chainT = 0;
  run = null;
  snapCam = true;
};

// ---- Tyre smoke: puffs from the rear wheels while sliding or spinning, rising and fading.
const SMOKE = 260;
const smokeGeo = new THREE.BufferGeometry();
const sPos = new Float32Array(SMOKE * 3);
const sLife = new Float32Array(SMOKE);
const sVel = new Float32Array(SMOKE * 3);
smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
smokeGeo.setAttribute('life', new THREE.BufferAttribute(sLife, 1));
const smoke = new THREE.Points(
  smokeGeo,
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uScale: { value: window.innerHeight } },
    vertexShader: /* glsl */ `
      attribute float life;
      varying float vLife;
      uniform float uScale;
      void main() {
        vLife = life;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (0.8 + (1.0 - life) * 3.2) * uScale * 0.6 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        if (vLife <= 0.0) discard;
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vLife * min(1.0, (1.0 - vLife) * 6.0) * 0.18;
        gl_FragColor = vec4(vec3(0.72, 0.72, 0.76), a);
      }`,
  }),
);
smoke.frustumCulled = false;
scene.add(smoke);
let smokeNext = 0;
const puff = (x: number, y: number, z: number, vx: number, vz: number): void => {
  const k = smokeNext++ % SMOKE;
  sPos.set([x, y, z], k * 3);
  sVel.set([vx * 0.15 + (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.5, vz * 0.15 + (Math.random() - 0.5) * 0.8], k * 3);
  sLife[k] = 1;
};

// ---- Post: bloom for the lamps, reflectors and the car's lights.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.6, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---- Input.
const keys = new Set<string>();
const sound = new CarSound();
let view: 'chase' | 'bumper' = params.get('cam') === 'bumper' ? 'bumper' : 'chase';
let help = true;
window.addEventListener('keydown', (e) => {
  sound.start();
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyQ') view = view === 'chase' ? 'bumper' : 'chase';
  if (e.code === 'KeyR') {
    // Back on the road where you are, facing the way you were going.
    const n = course.nearest(car.x, car.z);
    if (course.inLot(car.x, car.z) || course.inSummit(car.x, car.z)) car.place(car.x, car.z, car.h, ground);
    else if (n.i >= 0) {
      const fwd = Math.sin(car.h) * course.tx[n.i] + Math.cos(car.h) * course.tz[n.i] >= 0 ? 1 : -1;
      car.place(course.x[n.i], course.z[n.i], Math.atan2(course.tx[n.i] * fwd, course.tz[n.i] * fwd), ground);
    }
    chain = 0;
  }
  if (e.code === 'Digit1') placeAt('lot');
  if (e.code === 'Digit2') placeAt('top');
  if (e.code === 'KeyH') help = !help;
  if (e.code === 'KeyI') {
    invertY = !invertY;
    try {
      localStorage.setItem(INVERT_KEY, invertY ? '1' : '0');
    } catch {
      /* this session only */
    }
    toastT = 2.5;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('pointerdown', () => sound.start());
// Mouse look: a click captures the mouse (Esc lets it go); moving it swings the camera round the car and up
// or down, and it eases back behind the car a moment after you stop. Mouse Y follows the district's choice
// (the same 'citypop.invertY' in localStorage; I toggles it here too; ?invertY=1 / 0).
const INVERT_KEY = 'citypop.invertY';
let invertY = false;
{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(INVERT_KEY);
  } catch {
    /* storage blocked */
  }
  invertY = (params.get('invertY') ?? saved) === '1';
}
let orbitYaw = 0;
let lookPitch = 0;
let mouseIdle = 9;
let toastT = 0;
document.addEventListener('click', () => {
  if (document.pointerLockElement) return;
  const el = renderer.domElement as HTMLCanvasElement & { requestPointerLock(o?: object): Promise<void> | void };
  const p = el.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
  // Some systems refuse raw input: fall back to the plain lock.
  p?.catch?.(() => (el.requestPointerLock() as Promise<void> | undefined)?.catch?.(() => undefined));
});
document.addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  orbitYaw -= e.movementX * 0.003;
  const my = invertY ? -e.movementY : e.movementY;
  lookPitch = THREE.MathUtils.clamp(lookPitch - my * 0.003, -0.6, 0.5);
  mouseIdle = 0;
});
const controls = (): Controls => ({
  throttle: keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0,
  brake: keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0,
  steer: (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0),
  handbrake: keys.has('Space'),
});

// ---- The HUD.
const hud = document.getElementById('hud')!;
const speedo = document.getElementById('speedo')!;
const driftEl = document.getElementById('drift')!;
const timerEl = document.getElementById('timer')!;
const helpEl = document.getElementById('help')!;
const HELP = helpEl.textContent ?? '';
let chain = 0;
let chainT = 0;
let chainIdle = 0;
let total = 0;
let best = 0;
let lostFlash = 0;
let run: { dir: 'up' | 'down'; t: number } | null = null;
const bestRun: Record<'up' | 'down', number> = { up: Infinity, down: Infinity };
let lastRun = '';
let snapCam = true;
let wasIn: 'lot' | 'top' | 'road' = 'lot';
const fmt = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

// ---- The camera: behind the way the car is going (so drifts show), eased; a bumper view.
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camDir = 0;
const placeCamera = (dt: number, snap = false): void => {
  const speed = Math.hypot(car.u, car.w);
  const velA = Math.atan2(Math.sin(car.h) * car.u + Math.cos(car.h) * car.w, Math.cos(car.h) * car.u - Math.sin(car.h) * car.w);
  // Trail between the heading and the direction of travel (only the travel once it's going).
  const travel = speed > 3 && car.u > 0 ? velA : car.h;
  const want = car.h + Math.atan2(Math.sin(travel - car.h), Math.cos(travel - car.h)) * 0.55;
  const k = snap ? 1 : 1 - Math.exp(-dt * 4);
  camDir += Math.atan2(Math.sin(want - camDir), Math.cos(want - camDir)) * k;
  // Let go of the mouse and the view swings back to straight ahead.
  mouseIdle += dt;
  if (snap) orbitYaw = lookPitch = 0;
  else if (mouseIdle > 1.2) {
    const ease = 1 - Math.exp(-dt * 2.5);
    orbitYaw -= orbitYaw * ease;
    lookPitch -= lookPitch * ease;
  }
  if (view === 'bumper') {
    const p = new THREE.Vector3(car.x + Math.sin(car.h) * 2.1, car.y + 0.85, car.z + Math.cos(car.h) * 2.1);
    const a = car.h + orbitYaw;
    camera.position.copy(p);
    camera.lookAt(p.x + Math.sin(a) * 10, p.y + Math.tan(lookPitch - 0.025) * 10, p.z + Math.cos(a) * 10);
    camPos.copy(camera.position);
    return;
  }
  // Orbit about the car: looking up swings the camera down behind it (and looking down lifts it).
  const a = camDir + orbitYaw;
  const elev = -lookPitch;
  const back = (5.8 + Math.min(1.5, speed / 25)) * Math.cos(elev);
  const target = new THREE.Vector3(car.x - Math.sin(a) * back, car.y + 2.0 + Math.sin(elev) * 6, car.z - Math.cos(a) * back);
  target.y = Math.max(target.y, course.height(target.x, target.z) + 0.6);
  camPos.lerp(target, snap || mouseIdle < 0.2 ? 1 - Math.exp(-dt * 25) : 1 - Math.exp(-dt * 7));
  if (snap) camPos.copy(target);
  camera.position.copy(camPos);
  camLook.set(car.x + Math.sin(a) * 6, car.y + 1.25 + Math.max(0, lookPitch) * 6, car.z + Math.cos(a) * 6);
  camera.lookAt(camLook);
};

placeAt(at);

let last = performance.now();
const clock = { t: 0 };
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock.t += dt;
  const c = controls();
  car.update(dt, c, ground);
  // Where you are: the lot, the top, or on the pass (for the timed runs).
  const here: 'lot' | 'top' | 'road' = course.inLot(car.x, car.z) ? 'lot' : course.inSummit(car.x, car.z) ? 'top' : 'road';
  if (here !== wasIn) {
    if (wasIn === 'lot' && here === 'road') run = { dir: 'up', t: 0 };
    else if (wasIn === 'top' && here === 'road') run = { dir: 'down', t: 0 };
    else if (run && ((run.dir === 'up' && here === 'top') || (run.dir === 'down' && here === 'lot'))) {
      lastRun = `${run.dir === 'up' ? 'Uphill' : 'Downhill'} ${fmt(run.t)}${run.t < bestRun[run.dir] ? '  NEW BEST' : ''}`;
      bestRun[run.dir] = Math.min(bestRun[run.dir], run.t);
      run = null;
    } else run = null;
    wasIn = here;
  }
  if (run) run.t += dt;
  // Drift scoring: angle x speed while sideways, a multiplier that builds; banked when you straighten up.
  const ang = Math.abs(car.slide);
  const drifting = ang > 0.2 && car.u > 7;
  if (drifting) {
    chainT += dt;
    chainIdle = 0;
    chain += ((ang * 180) / Math.PI) * car.u * dt * 0.6 * Math.min(4, 1 + chainT * 0.3);
  } else if (chain > 0) {
    chainIdle += dt;
    if (chainIdle > 1.2) {
      total += Math.round(chain);
      best = Math.max(best, Math.round(chain));
      chain = 0;
      chainT = 0;
    }
  }
  if (car.bump > 3 && chain > 0) {
    chain = 0;
    chainT = 0;
    lostFlash = 1.2;
  }
  lostFlash = Math.max(0, lostFlash - dt);
  // The car on the ground: pitched and rolled by the slope under it and by the load shifting.
  const [nx, ny, nz] = ground.normal(car.x, car.z);
  const fx = Math.sin(car.h);
  const fz = Math.cos(car.h);
  const slopePitch = Math.atan2(nx * fx + nz * fz, ny);
  const slopeRoll = Math.atan2(nx * Math.cos(car.h) - nz * Math.sin(car.h), ny);
  carObj.position.set(car.x, car.y, car.z);
  carObj.rotation.set(slopePitch - car.ax * 0.006, car.h, -slopeRoll + car.ay * 0.007);
  body.visible = view === 'chase';
  for (const wh of wheels) {
    const rate = wh.front ? car.u / WL.r : car.handbrake ? 0 : (car.u / WL.r) * (1 + car.spin * 2.5) + car.spin * 25;
    wh.roll = (wh.roll + rate * dt) % (Math.PI * 2);
    wh.m.rotation.set(wh.roll, wh.front ? car.steer : 0, 0);
  }
  // Smoke from the rear wheels.
  const slideSmoke = Math.max(0, ang - 0.18) * 3 * Math.min(1, car.u / 8) + car.spin;
  if (slideSmoke > 0.15) {
    for (const s of [-0.7, 0.7]) {
      if (Math.random() < Math.min(0.7, slideSmoke * 0.6)) {
        const x = car.x - fx * 1.25 + Math.cos(car.h) * s;
        const z = car.z - fz * 1.25 - Math.sin(car.h) * s;
        puff(x, car.y + 0.25, z, fx * car.u, fz * car.u);
      }
    }
  }
  for (let k = 0; k < SMOKE; k++) {
    if (sLife[k] <= 0) continue;
    sLife[k] -= dt / 1.8;
    sPos[k * 3] += sVel[k * 3] * dt;
    sPos[k * 3 + 1] += sVel[k * 3 + 1] * dt;
    sPos[k * 3 + 2] += sVel[k * 3 + 2] * dt;
  }
  smokeGeo.attributes.position.needsUpdate = true;
  smokeGeo.attributes.life.needsUpdate = true;
  if (snapCam) camDir = car.h;
  placeCamera(dt, snapCam);
  snapCam = false;
  venue.stars.position.copy(camera.position);
  sound.update(dt, { rev: car.rev, gear: car.gear, throttle: c.throttle, speed: Math.hypot(car.u, car.w), slide: car.slide, spin: car.spin, bump: car.bump });
  // HUD.
  const kmh = Math.round(Math.abs(car.u) * 3.6);
  speedo.innerHTML = `<div class="kmh">${kmh}<span>km/h</span></div><div class="gear">${car.gear === 0 ? 'R' : car.gear}</div><div class="rev"><i style="width:${Math.round(car.rev * 100)}%"></i></div>`;
  driftEl.innerHTML = chain > 0 || lostFlash > 0
    ? `<div class="angle">${Math.round((ang * 180) / Math.PI)}°</div><div class="chain ${lostFlash > 0 ? 'lost' : ''}">${lostFlash > 0 ? 'CHAIN LOST' : `+${Math.round(chain).toLocaleString()}`}</div><div class="mult">×${Math.min(4, 1 + chainT * 0.3).toFixed(1)}</div>`
    : `<div class="total">DRIFT ${total.toLocaleString()}<br><small>best chain ${best.toLocaleString()}</small></div>`;
  timerEl.textContent = run ? `${run.dir === 'up' ? '▲ UPHILL' : '▼ DOWNHILL'}  ${fmt(run.t)}` : lastRun;
  toastT = Math.max(0, toastT - dt);
  helpEl.style.display = help || toastT > 0 ? 'block' : 'none';
  if (toastT > 0) helpEl.textContent = invertY ? 'Mouse Y inverted (mouse up looks down) · I to switch back' : 'Mouse Y normal (mouse up looks up) · I to invert';
  else if (helpEl.textContent !== HELP) helpEl.textContent = HELP;
  hud.textContent = `${course.def.name} · ${here === 'lot' ? 'practice lot' : here === 'top' ? 'the viewpoint' : 'the pass'}${bestRun.up < Infinity ? ` · best up ${fmt(bestRun.up)}` : ''}${bestRun.down < Infinity ? ` · best down ${fmt(bestRun.down)}` : ''}`;
  composer.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  (smoke.material as THREE.ShaderMaterial).uniforms.uScale.value = window.innerHeight;
});
// For checks: the car and a way to drive it from a script.
(window as unknown as { __race: unknown }).__race = { car, course, keys, camera, scene };
