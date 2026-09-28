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
import { GunSound } from './gunSound';
import { buildCabin } from './cabin';
import { EYE, nearestShot, Shooting, sideFor, spreadOf, WEAPONS, wrap, type Side } from './shooting';
import { CarSound } from './sound';
import { clock, GhostTrack, loadBest, medalFor, saveBest, Trial, trialPlan, type BestRun, type Dir, type Medal } from './trial';
import { Targets } from './targets';
import { Car, COUPE, DRIFT_ASSISTS, type Assists, type Controls } from './vehicle';

/**
 * The racing venues (race.html): a venue (course.ts, scene.ts) in its own time of day, the coupe on the
 * handling model (vehicle.ts), and a mode: free drive (the practice lot, drifting, shooting) or a time trial up
 * or down the pass (trial.ts: countdown, checkpoint splits against your best, medals, a ghost of your best run,
 * kept in the browser). A chase camera that trails the way the car is going (so a drift shows it sideways) or
 * a bumper camera; the dashboard; drift scoring (angle x speed, a chain that banks when you straighten up and
 * is lost if you hit something). The venue menu (M) lists the venues, their bests and modes.
 *
 * Keys: W/S (brake, then reverse), A/D, Space handbrake, Q camera, R back on the road, Enter restarts a trial,
 * M the venues, free drive: 1 the lot, 2 the top; H hides the help, I inverts mouse Y. A click captures the
 * mouse for looking round. URL: ?venue=kurokami|yunagi &mode=free|up|down &at=lot|top|road (free drive)
 * &cam=bumper &invertY=1|0; no venue shows the menu.
 */

const params = new URLSearchParams(location.search);
const { courses, errors } = loadCourses();
if (errors.length) {
  document.body.textContent = errors.join('\n');
  throw new Error(errors.join('\n'));
}
const venueId = courses.has(params.get('venue') ?? '') ? params.get('venue')! : [...courses.keys()][0];
const course = courses.get(venueId)!;
const ground = course.ground;
const modeParam = params.get('mode');
const mode: 'free' | Dir = modeParam === 'up' || modeParam === 'down' ? modeParam : 'free';
const atmosphere = course.def.atmosphere;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = atmosphere.exposure;
renderer.shadowMap.enabled = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// The venue's sky: its gradient, top to horizon, and its fog.
const sky = document.createElement('canvas');
sky.width = 4;
sky.height = 256;
{
  const g = sky.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  atmosphere.sky.forEach((c, i) => gr.addColorStop([0, 0.55, 0.8, 1][i], c));
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
}
const skyTex = new THREE.CanvasTexture(sky);
skyTex.colorSpace = THREE.SRGBColorSpace;
scene.background = skyTex;
scene.fog = new THREE.FogExp2(new THREE.Color(atmosphere.fog.color), atmosphere.fog.density);
// Near enough for the driver's-eye view (the wheel and the gun a few tens of centimetres away).
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.04, 2000);

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
// Shooting practice: the lot's targets, and the driver's pistol and paintball marker (shooting.ts).
const targets = new Targets(course);
scene.add(targets.group);
const shooting = new Shooting(course, targets);
shooting.pointScale = window.innerHeight;
scene.add(shooting.group);
carObj.add(shooting.arm);
// The cabin, for the driver's-eye view when shooting across the car, and the gauges' faint glow on it (the
// light is always there, only dark outside the view: adding and removing lights recompiles the shaders).
const cabin = buildCabin();
carObj.add(cabin);
const cabinLight = new THREE.PointLight(0x9aa8c8, 0, 2.4, 1.5);
cabinLight.position.set(0.1, 1.15, 0.1);
carObj.add(cabinLight);
/** 0 over the shoulder, 1 at the driver's eye (shooting across the car through the passenger window). */
let pov = 0;
const gunSound = new GunSound();
/** Aiming, the car holds its line a little better (more countersteer), so one hand on the wheel will do. */
const AIM_ASSISTS: Assists = { ...DRIFT_ASSISTS, countersteer: 0.7 };
const beams: THREE.SpotLight[] = [];
for (const s of [-0.62, 0.62]) {
  const l = new THREE.SpotLight(0xfff2dc, 140, 140, 0.3, 0.6, 1);
  l.position.set(s, 0.72, 2.1);
  l.target.position.set(s * 1.2, -0.1, 30);
  carObj.add(l, l.target);
  beams.push(l);
}

const car = new Car(COUPE, DRIFT_ASSISTS);
const at = mode === 'free' ? (params.get('at') ?? 'lot') : 'grid';
const placeAt = (where: string): void => {
  if (where === 'grid' && trial) {
    // The trial's grid: on the road behind the line, facing the way the run goes.
    const i = trial.plan.grid;
    const s = trial.plan.dir === 'up' ? 1 : -1;
    car.place(course.x[i], course.z[i], Math.atan2(course.tx[i] * s, course.tz[i] * s), ground);
  } else if (where === 'top') {
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
  snapCam = true;
};

// ---- Time trial: the run, your best (its splits and ghost), the ghost car, the recording of this run.
let trial: Trial | null = null;
let best: BestRun | null = mode === 'free' ? null : loadBest(venueId, mode);
let track = new GhostTrack();
let ghostTrack: GhostTrack | null = best ? new GhostTrack([...best.ghost]) : null;
let driftAtStart = 0;
/** What the last finish said (for the results card), and when it came. */
let result: { time: number; medal: Medal | null; newBest: boolean; prev: number | null; splits: number[]; drift: number } | null = null;
const ghost = new THREE.Mesh(body.geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.85, 1.4), transparent: true, opacity: 0.22, depthWrite: false }));
ghost.visible = false;
scene.add(ghost);
const startTrial = (): void => {
  if (mode === 'free') return;
  trial = new Trial(trialPlan(course, mode));
  track = new GhostTrack();
  result = null;
  placeAt('grid');
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
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.5, 1.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---- Input.
const keys = new Set<string>();
const sound = new CarSound();
let view: 'chase' | 'bumper' = params.get('cam') === 'bumper' ? 'bumper' : 'chase';
let help = true;
window.addEventListener('keydown', (e) => {
  sound.start();
  gunSound.start();
  if (e.code === 'KeyF') shooting.pickWeapon(shooting.weaponIndex + 1);
  if (e.code === 'KeyE') shooting.reload();
  if (e.code === 'KeyT') shooting.reset();
  if (e.code === 'KeyG') {
    slowAuto = !slowAuto;
    if (!slowAuto) slowOn = false;
    toastText = slowAuto ? 'Slow motion when you aim: on · G to turn it off' : 'Slow motion when you aim: off · G to turn it on';
    toastT = 2.5;
  }
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
  // Free drive: jump to the lot or the top. In a trial: Enter starts it again; the jumps are off.
  if (mode === 'free' && e.code === 'Digit1') placeAt('lot');
  if (mode === 'free' && e.code === 'Digit2') placeAt('top');
  if (mode !== 'free' && e.code === 'Enter') startTrial();
  if (e.code === 'KeyM') showMenu(!menuOpen);
  if (e.code === 'KeyH') help = !help;
  if (e.code === 'KeyI') {
    invertY = !invertY;
    try {
      localStorage.setItem(INVERT_KEY, invertY ? '1' : '0');
    } catch {
      /* this session only */
    }
    toastText = invertY ? 'Mouse Y inverted (mouse up looks down) · I to switch back' : 'Mouse Y normal (mouse up looks up) · I to invert';
    toastT = 2.5;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('pointerdown', () => {
  sound.start();
  gunSound.start();
});
// Aim with the right mouse button (the camera over the driver's shoulder, the crosshair in the middle), fire
// with the left: once per click with the pistol, held for the paintball marker. The left button alone fires
// from the hip, where the camera looks, far less accurately (and never in slow motion).
// Raising the gun slows the world (to 30%) while the focus lasts (2.5 s of it, refilling while the gun is
// down); the camera and the mouse keep full speed. G turns it off.
let aiming = false;
let slowAuto = true;
let slowOn = false;
let focus = 1;
let slow = 0;
/** Seconds the hip-fire crosshair and arm stay up after a shot; seconds of the 'no line of fire' note. */
let hipT = 0;
let blockedT = 0;
const FOCUS_SECS = 2.5;
const FOCUS_REFILL = 6;
/** Checks only (__race.aimAt): a point the aim follows. */
let aimTrack: THREE.Vector3 | null = null;
let aimYaw = 0;
let aimPitch = 0;
let trigger = false;
let pulled = false;
document.addEventListener('contextmenu', (e) => e.preventDefault());
/** Trials are about the clock: no shooting. Free drive shoots anywhere (targets where the venue has them). */
const armed = mode === 'free';
document.addEventListener('mousedown', (e) => {
  if (!document.pointerLockElement || !armed) return;
  if (e.button === 2) startAiming();
  if (e.button === 0) {
    trigger = true;
    pulled = true;
  }
});
function startAiming(): void {
  if (aiming) return;
  aiming = true;
  const d = camera.getWorldDirection(new THREE.Vector3());
  aimYaw = Math.atan2(d.x, d.z);
  aimPitch = Math.max(-0.1, Math.min(0.2, Math.asin(d.y) + 0.12));
  if (slowAuto && focus > 0.25) slowOn = true;
}
const stopAiming = (): void => {
  if (!aiming) return;
  aiming = false;
  slowOn = false;
  trigger = false;
  // The chase camera carries on looking where you were aiming, then eases back behind the car.
  orbitYaw = wrap(aimYaw - camDir);
  lookPitch = 0;
  mouseIdle = 0;
};
document.addEventListener('mouseup', (e) => {
  if (e.button === 2) stopAiming();
  if (e.button === 0) trigger = false;
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) stopAiming();
});
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
let toastText = '';
document.addEventListener('click', () => {
  if (document.pointerLockElement || menuOpen) return;
  const el = renderer.domElement as HTMLCanvasElement & { requestPointerLock(o?: object): Promise<void> | void };
  const p = el.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
  // Some systems refuse raw input: fall back to the plain lock.
  p?.catch?.(() => (el.requestPointerLock() as Promise<void> | undefined)?.catch?.(() => undefined));
});
document.addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  const my = invertY ? -e.movementY : e.movementY;
  if (aiming) {
    aimYaw -= e.movementX * 0.0018;
    aimPitch = THREE.MathUtils.clamp(aimPitch - my * 0.0018, -0.45, 0.4);
    return;
  }
  orbitYaw -= e.movementX * 0.003;
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
// A trial's help is only the driving (no shooting in trials).
if (mode !== 'free') helpEl.textContent = 'W / S  drive · brake     A / D  steer     Space  handbrake     Q  camera     R  back on the road\nEnter  start again     M  venues     H  hide this     The blue car is your best run.';
const HELP = helpEl.textContent ?? '';
let chain = 0;
let chainT = 0;
let chainIdle = 0;
let total = 0;
let bestChain = 0;
let lostFlash = 0;
let snapCam = true;
const countEl = document.getElementById('count')!;
const splitEl = document.getElementById('split')!;
const resultsEl = document.getElementById('results')!;
let splitT = 0;
const MEDAL: Record<Medal, string> = { gold: '金 GOLD', silver: '銀 SILVER', bronze: '銅 BRONZE' };
const medalHtml = (m: Medal | null): string => (m ? `<span class="medal ${m}">${MEDAL[m]}</span>` : '<span class="medal none">no medal</span>');
const signed = (d: number): string => `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;

// ---- The venue menu: every venue, its time of day, your bests with their medals, and its modes.
const menuEl = document.getElementById('menu')!;
let menuOpen = false;
const showMenu = (open: boolean): void => {
  menuOpen = open;
  menuEl.style.display = open ? 'flex' : 'none';
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    keys.clear();
    menuEl.innerHTML = `<h1>峠 <span>the passes</span></h1><div class="cards">${[...courses.entries()]
      .map(([id, c]) => {
        const row = (d: Dir, label: string): string => {
          const b = loadBest(id, d);
          const m = b ? medalFor(b.time, c.def.trial[d]) : null;
          return `<a class="mode" href="?venue=${id}&mode=${d}">${label}<span>${b ? `${clock(b.time)} ${medalHtml(m)}` : `gold ${clock(c.def.trial[d][2])}`}</span></a>`;
        };
        return `<div class="card${id === venueId ? ' here' : ''}"><div class="name">${c.def.name}</div><div class="meta">${c.def.atmosphere.label} · ${(c.length / 1000).toFixed(1)} km · ${Math.round(c.summit.y)} m climb</div><p>${c.def.blurb}</p>${row('up', '▲ Time trial, uphill')}${row('down', '▼ Time trial, downhill')}<a class="mode" href="?venue=${id}&mode=free">Free drive<span>the lot, drifting${c.def.targets?.length ? ', shooting' : ''}</span></a></div>`;
      })
      .join('')}</div><small>${params.has('venue') ? 'M closes this · ' : ''}Times are kept in this browser.</small>`;
  }
};

// Trial HUD: the countdown, the clock (and the gap to your best at the last checkpoint), split flashes, results.
const drawTrialHud = (dt: number): void => {
  splitT = Math.max(0, splitT - dt);
  splitEl.style.opacity = Math.min(1, splitT * 2).toFixed(2);
  if (!trial) {
    timerEl.textContent = '';
    countEl.textContent = '';
    resultsEl.style.display = 'none';
    return;
  }
  const cd = trial.phase === 'countdown' ? Math.ceil(trial.count) : 0;
  countEl.textContent = cd > 0 ? String(cd) : trial.phase === 'running' && trial.t < 0.8 ? 'GO' : '';
  countEl.className = cd > 0 ? 'n' : 'go';
  const label = mode === 'up' ? '▲ UPHILL' : '▼ DOWNHILL';
  timerEl.textContent = trial.phase === 'finished' && result ? `${label}  ${clock(result.time)}` : `${label}  ${clock(trial.t)}`;
  resultsEl.style.display = result ? 'block' : 'none';
  if (result) {
    const r = result;
    const splits = r.splits.map((t, i) => `<div>Checkpoint ${i + 1}<span>${clock(t)}</span></div>`).join('');
    resultsEl.innerHTML = `<div class="head">${course.def.name}  ${label}</div><div class="time">${clock(r.time)}</div>${medalHtml(r.medal)}${r.newBest ? `<div class="best">NEW BEST${r.prev !== null ? `  ${signed(r.time - r.prev)}` : ''}</div>` : `<div class="prev">best ${clock(r.prev!)}  (${signed(r.time - r.prev!)})</div>`}<div class="splits">${splits}<div>Drift<span>${r.drift.toLocaleString()}</span></div></div><div class="medals">gold ${clock(course.def.trial[mode as Dir][2])} · silver ${clock(course.def.trial[mode as Dir][1])} · bronze ${clock(course.def.trial[mode as Dir][0])}</div><small>Enter  again · M  venues</small>`;
  }
};

// Shooting HUD: the crosshair (its circle the spread), the weapon and rounds, the score, and points popping up.
const reticle = document.getElementById('reticle')!;
const gunEl = document.getElementById('gun')!;
const shootEl = document.getElementById('shoot')!;
const popsEl = document.getElementById('pops')!;
const focusEl = document.getElementById('focus')!;
const pops: { text: string; t: number }[] = [];
const slowEl = document.getElementById('slowmo')!;
const drawShootingHud = (dt: number, side: Side | null, hip: boolean): void => {
  for (const e of shooting.scored) pops.push({ text: `+${e.points}${e.why ? ` ${e.why}` : ''}${e.mult !== 1 ? ` ×${e.mult}` : ''}`, t: 1.4 });
  shooting.scored.length = 0;
  for (let i = pops.length - 1; i >= 0; i--) if ((pops[i].t -= dt) <= 0) pops.splice(i, 1);
  while (pops.length > 5) pops.shift();
  popsEl.innerHTML = pops.map((p) => `<div style="opacity:${Math.min(1, p.t * 2).toFixed(2)}">${p.text}</div>`).join('');
  const W = shooting.weapon;
  const shown = aiming || hipT > 0;
  reticle.style.display = shown ? 'block' : 'none';
  if (shown) {
    const across = side === 'across';
    const spread = spreadOf(W, { slide: car.slide, speed: Math.hypot(car.u, car.w), across, hip });
    const px = Math.max(6, (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (window.innerHeight / 2));
    reticle.style.setProperty('--r', `${px.toFixed(1)}px`);
    reticle.className = [hip ? 'hip' : '', across ? 'across' : '', side ? '' : 'blocked', shooting.hitMark > 0 ? 'hit' : '', shooting.reloading > 0 ? 'reload' : ''].join(' ');
    reticle.dataset.note = shooting.reloading > 0 ? 'RELOADING' : !side ? 'NO LINE OF FIRE' : across ? 'THROUGH THE PASSENGER WINDOW' : '';
  }
  const bars = Math.round(focus * 10);
  focusEl.innerHTML = slowAuto ? `FOCUS <span>${'▮'.repeat(bars)}${'▯'.repeat(10 - bars)}</span>` : '';
  focusEl.style.opacity = aiming || focus < 1 ? '1' : '0.35';
  const n = shooting.ammo[shooting.weaponIndex];
  const pips = W.mag <= 12 ? '▮'.repeat(n) + '▯'.repeat(W.mag - n) : `${n} / ${W.mag}`;
  gunEl.style.display = armed ? 'block' : 'none';
  shootEl.style.display = armed && targets.list.length > 0 ? 'block' : 'none';
  focusEl.style.display = armed ? 'block' : 'none';
  gunEl.innerHTML = `<div class="name">${W.label}</div><div class="ammo">${shooting.reloading > 0 ? 'reloading…' : pips}</div><small>F ${WEAPONS[(shooting.weaponIndex + 1) % WEAPONS.length].label} · E reload · T clean targets</small>`;
  const acc = shooting.shots ? Math.round((shooting.hits / shooting.shots) * 100) : 0;
  shootEl.innerHTML = `<div class="score">${shooting.score.toLocaleString()}</div><small>${shooting.hits}/${shooting.shots} hits · ${acc}% · streak ${shooting.streak} (best ${shooting.bestStreak})</small>`;
};

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
  // Aiming: over the driver's (right) shoulder, looking along the aim; the crosshair is the view's centre.
  const fov = aiming ? 50 + pov * 16 : 62;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
  if (aiming) {
    if (aimTrack) {
      const p = camera.position;
      aimYaw = Math.atan2(aimTrack.x - p.x, aimTrack.z - p.z);
      aimPitch = Math.atan2(aimTrack.y - p.y, Math.hypot(aimTrack.x - p.x, aimTrack.z - p.z));
    }
    const d = new THREE.Vector3(Math.sin(aimYaw) * Math.cos(aimPitch), Math.sin(aimPitch), Math.cos(aimYaw) * Math.cos(aimPitch));
    // Behind the aim and up over the roof, a little to the right of it; or, aiming to the left (across the
    // car), the driver's own eye, looking out through the passenger window.
    const head = carObj.localToWorld(new THREE.Vector3(-0.35, 1.25, 0));
    const target = head.addScaledVector(d, -2.6).add(new THREE.Vector3(-Math.cos(aimYaw) * 0.55, 0.95, Math.sin(aimYaw) * 0.55));
    target.y = Math.max(target.y, course.height(target.x, target.z) + 0.5);
    camPos.lerp(target, 1 - Math.exp(-dt * 18));
    const rel = wrap(aimYaw - car.h);
    const left = rel > 32 * (Math.PI / 180) && rel < 165 * (Math.PI / 180);
    pov += ((left ? 1 : 0) - pov) * Math.min(1, dt * 10);
    const k = pov * pov * (3 - 2 * pov);
    const eye = carObj.localToWorld(new THREE.Vector3(EYE.x, EYE.y, EYE.z));
    camera.position.copy(camPos).lerp(eye, k);
    camera.lookAt(camera.position.clone().add(d));
    cabin.visible = pov > 0.5;
    cabinLight.intensity = cabin.visible ? 0.3 : 0;
    return;
  }
  pov = 0;
  cabin.visible = false;
  cabinLight.intensity = 0;
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

if (mode !== 'free') startTrial();
else placeAt(at);
if (!params.has('venue')) showMenu(true);

let last = performance.now();
const elapsed = { t: 0 };
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed.t += dt;
  // Slow motion: drains the focus while aiming; lowering the gun ends it and the focus refills.
  if (aiming && slowOn) {
    focus = Math.max(0, focus - dt / FOCUS_SECS);
    if (focus <= 0) slowOn = false;
  } else if (!aiming) focus = Math.min(1, focus + dt / FOCUS_REFILL);
  slow += ((slowOn ? 1 : 0) - slow) * Math.min(1, dt * 7);
  /** The world's time step (the car, targets, shots, smoke); dt stays real for the camera and the clock. */
  const gdt = dt * (1 - 0.7 * slow);
  const c = menuOpen ? { throttle: 0, brake: 1, steer: 0, handbrake: false } : controls();
  car.assists = aiming ? AIM_ASSISTS : DRIFT_ASSISTS;
  // Held on the grid through the countdown (the engine still revs).
  if (!trial || trial.phase !== 'countdown') car.update(gdt, c, ground);
  const here: 'lot' | 'top' | 'road' = course.inLot(car.x, car.z) ? 'lot' : course.inSummit(car.x, car.z) ? 'top' : 'road';
  // The trial runs on real time (slow motion is no help against the clock).
  if (trial) {
    const ni = course.nearest(car.x, car.z).i;
    for (const e of trial.update(dt, ni)) {
      if (e.kind === 'go') driftAtStart = total + chain;
      if (e.kind === 'split') {
        const prev = best?.splits[e.n - 1];
        splitEl.innerHTML = `CHECKPOINT ${e.n}  ${clock(e.t)}${prev !== undefined ? `  <b class="${e.t <= prev ? 'ahead' : 'behind'}">${signed(e.t - prev)}</b>` : ''}`;
        splitT = 3;
      }
      if (e.kind === 'finish') {
        const prev = best?.time ?? null;
        const newBest = prev === null || e.t < prev;
        result = { time: e.t, medal: medalFor(e.t, course.def.trial[mode as Dir]), newBest, prev, splits: [...trial.splits], drift: Math.round(total + chain - driftAtStart) };
        if (newBest) {
          track.record(e.t, car.x, car.y, car.z, car.h);
          best = { time: e.t, splits: [...trial.splits], ghost: track.data };
          saveBest(venueId, mode as Dir, best);
          ghostTrack = new GhostTrack([...track.data]);
        }
      }
    }
    if (trial.phase === 'running') track.record(trial.t, car.x, car.y, car.z, car.h);
    // The ghost of your best run, alongside from the start (waiting on the grid through the countdown).
    const g = ghostTrack?.at(trial.phase === 'countdown' ? 0 : trial.t);
    ghost.visible = !!g && trial.phase !== 'finished';
    if (g) {
      ghost.position.set(g.x, g.y, g.z);
      ghost.rotation.set(0, g.h, 0);
    }
  }
  // Drift scoring: angle x speed while sideways, a multiplier that builds; banked when you straighten up.
  const ang = Math.abs(car.slide);
  const drifting = ang > 0.2 && car.u > 7;
  if (drifting) {
    chainT += gdt;
    chainIdle = 0;
    chain += ((ang * 180) / Math.PI) * car.u * gdt * 0.6 * Math.min(4, 1 + chainT * 0.3);
  } else if (chain > 0) {
    chainIdle += gdt;
    if (chainIdle > 1.2) {
      total += Math.round(chain);
      bestChain = Math.max(bestChain, Math.round(chain));
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
  // In the driver's-eye view the lean is damped to a third (a driver holds their head level against it), so
  // the passenger window doesn't tip into the ground mid-drift; the shoulder and chase views keep all of it.
  const lean = 1 - 0.65 * pov;
  carObj.rotation.set(slopePitch - car.ax * 0.006 * lean, car.h, -slopeRoll + car.ay * 0.007 * lean);
  body.visible = view === 'chase' || aiming || hipT > 0;
  for (const wh of wheels) {
    const rate = wh.front ? car.u / WL.r : car.handbrake ? 0 : (car.u / WL.r) * (1 + car.spin * 2.5) + car.spin * 25;
    wh.roll = (wh.roll + rate * gdt) % (Math.PI * 2);
    wh.m.rotation.set(wh.roll, wh.front ? car.steer : 0, 0);
  }
  // Smoke from the rear wheels.
  const slideSmoke = Math.max(0, ang - 0.18) * 3 * Math.min(1, car.u / 8) + car.spin;
  if (slideSmoke > 0.15) {
    for (const s of [-0.7, 0.7]) {
      if (Math.random() < Math.min(0.7, slideSmoke * 0.6) * (gdt / dt)) {
        const x = car.x - fx * 1.25 + Math.cos(car.h) * s;
        const z = car.z - fz * 1.25 - Math.sin(car.h) * s;
        puff(x, car.y + 0.25, z, fx * car.u, fz * car.u);
      }
    }
  }
  for (let k = 0; k < SMOKE; k++) {
    if (sLife[k] <= 0) continue;
    sLife[k] -= gdt / 1.8;
    sPos[k * 3] += sVel[k * 3] * gdt;
    sPos[k * 3 + 1] += sVel[k * 3 + 1] * gdt;
    sPos[k * 3 + 2] += sVel[k * 3 + 2] * gdt;
  }
  smokeGeo.attributes.position.needsUpdate = true;
  smokeGeo.attributes.life.needsUpdate = true;
  if (snapCam) camDir = car.h;
  placeCamera(dt, snapCam);
  snapCam = false;
  venue.stars.position.copy(camera.position);
  // Shooting: the crosshair's point in the world (aimed, or where the camera looks from the hip), which window
  // it's through as seen from the driver's seat, the weapon held toward it, the trigger.
  targets.update(gdt);
  hipT = Math.max(0, hipT - dt);
  blockedT = Math.max(0, blockedT - dt);
  let side: Side | null = null;
  const hip = !aiming;
  if (aiming || trigger || hipT > 0) {
    camera.updateMatrixWorld();
    const look = camera.getWorldDirection(new THREE.Vector3());
    const aimPoint = shooting.pick(camera.position, look).point;
    carObj.updateMatrixWorld();
    // In the car's own frame, lean and all, so the window's opening is exactly what it frames on screen.
    const head = carObj.localToWorld(new THREE.Vector3(EYE.x, EYE.y, EYE.z));
    const toCar = carObj.quaternion.clone().invert();
    const dl = aimPoint.clone().sub(head).applyQuaternion(toCar).normalize();
    const rel = Math.atan2(dl.x, dl.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(dl.y, -1, 1));
    side = sideFor(rel, pitch);
    // Off every window (the windscreen, behind on the left), the weapon waits at the nearest shot it has.
    const n = nearestShot(rel, pitch);
    const nd = new THREE.Vector3(Math.sin(n.rel) * Math.cos(n.pitch), Math.sin(n.pitch), Math.cos(n.rel) * Math.cos(n.pitch)).applyQuaternion(carObj.quaternion);
    const armAt = side ? aimPoint : head.clone().addScaledVector(nd, 20);
    shooting.pose(carObj, armAt, side ?? n.side);
    if (trigger && side) {
      if (hip) hipT = 1.2;
      const across = side === 'across';
      const mult = (drifting ? 2 : 1) * (across ? 1.5 : 1);
      const why = [drifting ? 'DRIFT' : '', across ? 'ACROSS' : '', hip ? 'HIP' : ''].filter(Boolean).join(' ');
      const carVel = new THREE.Vector3(Math.sin(car.h) * car.u + Math.cos(car.h) * car.w, 0, Math.cos(car.h) * car.u - Math.sin(car.h) * car.w);
      const kick = shooting.fire({ aimPoint, carVel, across, hip, slide: car.slide, speed: Math.hypot(car.u, car.w), mult, why }, !pulled);
      if (aiming) aimPitch += kick;
    } else if (trigger && pulled) {
      blockedT = 0.9;
      if (hip) hipT = 1.2;
    }
    pulled = false;
  } else shooting.arm.visible = false;
  shooting.update(gdt);
  sound.slow = slow;
  gunSound.setSlow(slow);
  gunSound.play(shooting.events, camera.position);
  shooting.events.length = 0;
  drawShootingHud(dt, side, hip);
  slowEl.style.opacity = (slow * 0.9).toFixed(3);
  sound.update(dt, { rev: car.rev, gear: car.gear, throttle: c.throttle, speed: Math.hypot(car.u, car.w), slide: car.slide, spin: car.spin, bump: car.bump });
  // HUD.
  const kmh = Math.round(Math.abs(car.u) * 3.6);
  speedo.innerHTML = `<div class="kmh">${kmh}<span>km/h</span></div><div class="gear">${car.gear === 0 ? 'R' : car.gear}</div><div class="rev"><i style="width:${Math.round(car.rev * 100)}%"></i></div>`;
  driftEl.innerHTML = chain > 0 || lostFlash > 0
    ? `<div class="angle">${Math.round((ang * 180) / Math.PI)}°</div><div class="chain ${lostFlash > 0 ? 'lost' : ''}">${lostFlash > 0 ? 'CHAIN LOST' : `+${Math.round(chain).toLocaleString()}`}</div><div class="mult">×${Math.min(4, 1 + chainT * 0.3).toFixed(1)}</div>`
    : `<div class="total">DRIFT ${total.toLocaleString()}<br><small>best chain ${bestChain.toLocaleString()}</small></div>`;
  drawTrialHud(dt);
  toastT = Math.max(0, toastT - dt);
  helpEl.style.display = help || toastT > 0 ? 'block' : 'none';
  if (toastT > 0) helpEl.textContent = toastText;
  else if (helpEl.textContent !== HELP) helpEl.textContent = HELP;
  hud.textContent = `${course.def.name} · ${course.def.atmosphere.label} · ${mode === 'free' ? `free drive · ${here === 'lot' ? 'practice lot' : here === 'top' ? 'the viewpoint' : 'the pass'}` : `time trial ${mode === 'up' ? '▲ uphill' : '▼ downhill'}${best ? ` · best ${clock(best.time)}` : ''}`} · M venues`;
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
  shooting.pointScale = window.innerHeight;
});
// For checks: the car and a way to drive it from a script.
(window as unknown as { __race: unknown }).__race = {
  car,
  course,
  keys,
  camera,
  scene,
  shooting,
  targets,
  cabin,
  // Keep the crosshair on (x, y, z) (re-aimed each frame from where the camera is).
  aimAt: (x: number, y: number, z: number): void => {
    startAiming();
    aimTrack = new THREE.Vector3(x, y, z);
  },
  aim: (on: boolean, yaw?: number, pitch?: number): void => {
    if (on) startAiming();
    else stopAiming();
    aimTrack = null;
    if (yaw !== undefined) aimYaw = car.h + yaw;
    if (pitch !== undefined) aimPitch = pitch;
  },
  state: () => ({ aiming, slow, focus, hipT }),
  trial: () => trial,
  trigger: (on: boolean): void => {
    trigger = on;
    pulled = on;
  },
};
