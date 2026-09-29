import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { cityMaterial, cityUniforms } from '../poc3d/real/city';
import { DAMAGE, HEALTH, PAINT_PENALTY, RivalDriver, separateCars, type Arms } from './battle';
import { addHeadlights, buildCar, CarMarks, hitVolumes, poseCar, turnWheels } from './carView';
import { loadCourses } from './courses';
import { buildVenue } from './scene';
import { GunSound } from './gunSound';
import { buildCabin } from './cabin';
import { EYE, nearestShot, Shooting, sideFor, spreadOf, WEAPONS, wrap, type BodyHit, type Side } from './shooting';
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
/** Free drive, a time trial, or a battle against an armed rival (real guns or paintball; downhill unless ?dir=up). */
const kind: 'free' | 'trial' | 'battle' = modeParam === 'up' || modeParam === 'down' ? 'trial' : modeParam === 'battle' ? 'battle' : 'free';
const arms: Arms = params.get('arms') === 'paint' ? 'paint' : 'gun';
const dir: Dir = modeParam === 'up' || (modeParam === 'battle' && params.get('dir') === 'up') ? 'up' : 'down';
/** 'free', or the direction a race (trial or battle) runs. */
const mode: 'free' | Dir = kind === 'free' ? 'free' : dir;
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

// The car: the showroom's coupe on the city material (its lamps lit), with two headlight beams (carView.ts).
const cityU = cityUniforms();
cityU.uLightGain.value = 0;
cityU.uLamps.value = 1;
const carMat = cityMaterial(cityU);
const player = buildCar(Number(params.get('paint') ?? 0xf0f0ec), carMat);
const carObj = player.obj;
const body = player.body;
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
addHeadlights(carObj);

const car = new Car(COUPE, DRIFT_ASSISTS);
const at = mode === 'free' ? (params.get('at') ?? 'lot') : 'grid';
const placeAt = (where: string): void => {
  if (where === 'grid' && trial) {
    // The trial's grid: on the road behind the line, facing the way the run goes.
    // In a battle you start in the left lane (Japan keeps left), the rival beside you on the right.
    const i = trial.plan.grid;
    const s = trial.plan.dir === 'up' ? 1 : -1;
    const lane = kind === 'battle' ? 1.7 : 0;
    car.place(course.x[i] + course.tz[i] * s * lane, course.z[i] - course.tx[i] * s * lane, Math.atan2(course.tx[i] * s, course.tz[i] * s), ground);
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
let best: BestRun | null = kind === 'trial' ? loadBest(venueId, dir) : null;
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
  if (kind === 'battle') startBattle(trial);
};

// ---- Battle: the rival, a red coupe on the same handling model (RivalDriver drives it), armed as you are.
// Real guns: each hit takes health (more through the glass); a car at none is out, coasting to a stop, and the
// first down wins. Paintball: each hit you take adds PAINT_PENALTY seconds to your time; the lower total wins.
const inBattle = kind === 'battle';
const rivalCar = new Car(COUPE, DRIFT_ASSISTS);
const rivalView = buildCar(0xc01818, carMat);
const rivalDrv = new RivalDriver(rivalCar, course, dir, Number(params.get('skill') ?? 1));
const rivalShooting = new Shooting(course, targets);
rivalShooting.assist = false;
// The rival car carries a gunman in the passenger (left) seat: his wide arc is out of the left window.
rivalShooting.seat = 'left';
const playerMarks = new CarMarks(carObj);
const rivalMarks = new CarMarks(rivalView.obj);
let rivalTrial: Trial | null = null;
const FRESH = { you: HEALTH, them: HEALTH, youTaken: 0, themTaken: 0, youOut: false, themOut: false, youOutAt: 0, youTime: null as number | null, themTime: null as number | null, cool: 2, aimT: 0, burstLeft: 3, burstT: 0.8 };
const fight = { ...FRESH };
/** The outcome; a time is null for a car that hadn't finished (then `youSoFar`/`themSoFar`: its clock when it was settled). */
let battleResult: { win: boolean; why: string; you: number | null; them: number | null; youPen: number; themPen: number; youSoFar: number; themSoFar: number } | null = null;
/** A hit on you: the screen's edge flashes (red for a round, the paint's colour), and a round shakes the view. */
let hurtT = 0;
let hurtColor = 'rgba(255, 40, 50, ';
let shake = 0;
if (inBattle) {
  scene.add(rivalView.obj, rivalShooting.group);
  addHeadlights(rivalView.obj);
  rivalView.obj.add(rivalShooting.arm);
  shooting.pickWeapon(arms === 'gun' ? 0 : 1);
  rivalShooting.pickWeapon(arms === 'gun' ? 0 : 1);
  shooting.bodies.push(...hitVolumes(rivalView.obj, 'them'));
  rivalShooting.bodies.push(...hitVolumes(carObj, 'you'));
  shooting.onBody = (h, k, col) => struck('them', h, k, col);
  rivalShooting.onBody = (h, k, col) => struck('you', h, k, col);
}

function startBattle(t: Trial): void {
  rivalTrial = new Trial(t.plan);
  const i = t.plan.grid;
  const s = dir === 'up' ? 1 : -1;
  rivalCar.place(course.x[i] - course.tz[i] * s * 1.7, course.z[i] + course.tx[i] * s * 1.7, Math.atan2(course.tx[i] * s, course.tz[i] * s), ground);
  rivalDrv.reset(-1.7);
  Object.assign(fight, FRESH);
  battleResult = null;
  playerMarks.clear();
  rivalMarks.clear();
  shooting.reset();
  rivalShooting.reset();
}

/** A shot struck a car: the mark on it, then damage (real guns) or a penalty second (paint). */
function struck(who: 'you' | 'them', h: BodyHit, k: 'bullet' | 'paint', col?: THREE.Color): void {
  (who === 'you' ? playerMarks : rivalMarks).add(h.point, h.normal, k, col);
  if (who === 'you' ? fight.youOut : fight.themOut) return;
  const glass = !!h.object.userData.glass;
  if (arms === 'gun') {
    const dmg = glass ? DAMAGE.glass : DAMAGE.body;
    if (who === 'them') {
      fight.them = Math.max(0, fight.them - dmg);
      pops.push({ text: `${glass ? 'THROUGH THE GLASS' : 'HIT'} −${dmg}`, t: 1.4 });
      if (fight.them === 0) {
        fight.themOut = true;
        pops.push({ text: 'RIVAL DOWN', t: 2.5 });
      }
    } else {
      fight.you = Math.max(0, fight.you - dmg);
      hurtT = glass ? 0.7 : 0.45;
      hurtColor = 'rgba(255, 40, 50, ';
      shake = glass ? 0.8 : 0.45;
      if (fight.you === 0) {
        fight.youOut = true;
        fight.youOutAt = elapsed.t;
      }
    }
  } else if (who === 'them') {
    fight.themTaken++;
    pops.push({ text: `SPLAT  rival +${PAINT_PENALTY} s`, t: 1.4 });
  } else {
    fight.youTaken++;
    hurtT = 0.45;
    hurtColor = `rgba(${Math.round(col!.r * 255)}, ${Math.round(col!.g * 255)}, ${Math.round(col!.b * 255)}, `;
  }
}

/**
 * The rival's gun, in its gunman's hands (the passenger seat, so the left window is his wide side): he shoots
 * when he has a line on you through a window (your rules, mirrored) within range, after a moment to aim; it leads a paintball, and misses by more the
 * further off you are, the faster you both go, and across its car. Pistol shots come in twos and threes,
 * paint in short bursts, with a pause between.
 */
function rivalGun(dt: number): void {
  const S = rivalShooting;
  const live = inBattle && trial?.phase === 'running' && !fight.themOut && !fight.youOut && fight.themTime === null && fight.youTime === null;
  if (!live) {
    S.arm.visible = false;
    fight.aimT = 0;
    return;
  }
  rivalView.obj.updateMatrixWorld();
  carObj.updateMatrixWorld();
  // From the gunman's eye (the driver's, mirrored to the left seat); his windows are the driver's mirrored.
  const eye = rivalView.obj.localToWorld(new THREE.Vector3(-EYE.x, EYE.y, EYE.z));
  const at = carObj.localToWorld(new THREE.Vector3(0, 0.8, 0.2));
  const dist = eye.distanceTo(at);
  const dl = at.clone().sub(eye).applyQuaternion(rivalView.obj.quaternion.clone().invert()).normalize();
  const side = sideFor(-Math.atan2(dl.x, dl.z), Math.asin(THREE.MathUtils.clamp(dl.y, -1, 1)));
  fight.cool -= dt;
  if (!side || dist > (arms === 'gun' ? 42 : 34)) {
    fight.aimT = Math.max(0, fight.aimT - dt * 2);
    if (fight.aimT <= 0) S.arm.visible = false;
    return;
  }
  fight.aimT = Math.min(3, fight.aimT + dt);
  const vel = (c: Car): THREE.Vector3 => new THREE.Vector3(Math.sin(c.h) * c.u + Math.cos(c.h) * c.w, 0, Math.cos(c.h) * c.u - Math.sin(c.h) * c.w);
  const rv = vel(rivalCar);
  const aimPoint = at.clone().addScaledVector(vel(car).sub(rv), arms === 'paint' ? dist / 88 : 0);
  const miss = (0.45 + dist * 0.045 + (car.speed + rivalCar.speed) * 0.02 + (side === 'across' ? 0.6 : 0)) / rivalDrv.skill;
  aimPoint.add(new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).multiplyScalar(miss * 2));
  S.pose(rivalView.obj, aimPoint, side);
  if (fight.aimT < 0.8 || fight.cool > 0) return;
  const ctx = { aimPoint, carVel: rv, across: side === 'across', hip: false, slide: rivalCar.slide, speed: rivalCar.speed, mult: 1, why: '' };
  if (arms === 'gun') {
    if (S.fire(ctx, false) === 0 && S.reloading === 0) return;
    fight.cool = 0.4 + Math.random() * 0.5;
    if (--fight.burstLeft <= 0) {
      fight.cool = 1.8 + Math.random() * 2.2;
      fight.burstLeft = 2 + Math.floor(Math.random() * 3);
    }
  } else {
    S.fire(ctx, true);
    fight.burstT -= dt;
    if (fight.burstT <= 0) {
      fight.cool = 1.6 + Math.random() * 1.8;
      fight.burstT = 0.35 + Math.random() * 0.5;
    }
  }
}

/** Who has won, once it's settled. */
function decideBattle(): void {
  if (!trial || !rivalTrial || battleResult) return;
  const pen = (n: number): number => (arms === 'paint' ? n * PAINT_PENALTY : 0);
  const end = (win: boolean, why: string): void => {
    battleResult = { win, why, you: fight.youTime, them: fight.themTime, youPen: pen(fight.youTaken), themPen: pen(fight.themTaken), youSoFar: trial!.t, themSoFar: rivalTrial!.t };
  };
  if (arms === 'gun') {
    if (fight.youOut && elapsed.t - fight.youOutAt > 1.5) return end(false, 'Your car was shot to pieces.');
    if (fight.youTime !== null) return end(true, fight.themOut ? 'You shot the rival off the pass and made it down.' : 'You crossed the line first.');
    if (fight.themTime !== null) return end(false, 'The rival crossed the line first.');
    return;
  }
  // Paint: the lower time plus penalties. Settled when both are in, or when one is in and the other's clock
  // plus its penalties already runs past it.
  const you = fight.youTime === null ? null : fight.youTime + pen(fight.youTaken);
  const them = fight.themTime === null ? null : fight.themTime + pen(fight.themTaken);
  const youNow = you ?? trial.t + pen(fight.youTaken);
  const themNow = them ?? rivalTrial.t + pen(fight.themTaken);
  if (you !== null && (them !== null || themNow > you)) return end(you <= themNow, you <= themNow ? 'Quicker down, paint and all.' : 'The rival was quicker, paint and all.');
  if (them !== null && youNow > them) return end(false, 'The rival was quicker, paint and all.');
}

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
  if (e.code === 'KeyF' && kind !== 'battle') shooting.pickWeapon(shooting.weaponIndex + 1);
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
/** Trials are about the clock: no shooting. Free drive and battles shoot (targets where the venue has them). */
const armed = kind !== 'trial';
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
if (kind === 'battle')
  helpEl.textContent = `W / S  drive · brake     A / D  steer     Space  handbrake     Q  camera     R  back on the road\nRight mouse  aim (the driver's window, on the right, is the wide one)     Left mouse  fire     E  reload     Enter  start again     M  venues     H  hide this\n${arms === 'gun' ? 'Real guns: shoot the red car to pieces, or beat it down.' : `Paintball: every hit you take adds ${PAINT_PENALTY} s to your time.`}`;
else if (kind === 'trial') helpEl.textContent = 'W / S  drive · brake     A / D  steer     Space  handbrake     Q  camera     R  back on the road\nEnter  start again     M  venues     H  hide this     The blue car is your best run.';
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
        return `<div class="card${id === venueId ? ' here' : ''}"><div class="name">${c.def.name}</div><div class="meta">${c.def.atmosphere.label} · ${(c.length / 1000).toFixed(1)} km · ${Math.round(c.summit.y)} m climb</div><p>${c.def.blurb}</p>${row('up', '▲ Time trial, uphill')}${row('down', '▼ Time trial, downhill')}<a class="mode battle" href="?venue=${id}&mode=battle&arms=gun">⚔ Battle, real guns<span>▼ against a rival</span></a><a class="mode battle" href="?venue=${id}&mode=battle&arms=paint">⚔ Battle, paintball<span>▼ +${PAINT_PENALTY} s a hit</span></a><a class="mode" href="?venue=${id}&mode=free">Free drive<span>the lot, drifting${c.def.targets?.length ? ', shooting' : ''}</span></a></div>`;
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
  if (inBattle) {
    const pos = rivalDrv.progress(car) >= rivalDrv.progress(rivalCar) ? '1ST' : '2ND';
    if (trial.phase === 'running' && fight.youTime === null) timerEl.textContent += `   ${pos}`;
    resultsEl.style.display = battleResult ? 'block' : 'none';
    if (battleResult) {
      const r = battleResult;
      const t = (x: number | null, pen: number, soFar: number): string =>
        x === null ? `${clock(soFar)} so far${pen ? ` + ${pen} s` : ''}` : pen ? `${clock(x)} + ${pen} s = ${clock(x + pen)}` : clock(x);
      const rows = [
        `<div>You<span>${fight.youOut ? 'wrecked' : t(r.you, r.youPen, r.youSoFar)}</span></div>`,
        `<div>Rival<span>${fight.themOut ? 'wrecked' : t(r.them, r.themPen, r.themSoFar)}</span></div>`,
        arms === 'gun' ? `<div>Your car<span>${fight.you}%</span></div><div>Rival's car<span>${fight.them}%</span></div>` : `<div>Paint on the rival<span>${fight.themTaken}</span></div><div>Paint on you<span>${fight.youTaken}</span></div>`,
        `<div>Your shots<span>${shooting.hits} of ${shooting.shots} hit</span></div>`,
      ].join('');
      resultsEl.innerHTML = `<div class="head">${course.def.name}  ${label}  ⚔ ${arms === 'gun' ? 'real guns' : 'paintball'}</div><div class="time ${r.win ? 'win' : 'lose'}">${r.win ? 'YOU WIN' : 'YOU LOSE'}</div><div class="prev">${r.why}</div><div class="splits">${rows}</div><small>Enter  again · M  venues</small>`;
    }
    return;
  }
  resultsEl.style.display = result ? 'block' : 'none';
  if (result) {
    const r = result;
    const splits = r.splits.map((t, i) => `<div>Checkpoint ${i + 1}<span>${clock(t)}</span></div>`).join('');
    resultsEl.innerHTML = `<div class="head">${course.def.name}  ${label}</div><div class="time">${clock(r.time)}</div>${medalHtml(r.medal)}${r.newBest ? `<div class="best">NEW BEST${r.prev !== null ? `  ${signed(r.time - r.prev)}` : ''}</div>` : `<div class="prev">best ${clock(r.prev!)}  (${signed(r.time - r.prev!)})</div>`}<div class="splits">${splits}<div>Drift<span>${r.drift.toLocaleString()}</span></div></div><div class="medals">gold ${clock(course.def.trial[mode as Dir][2])} · silver ${clock(course.def.trial[mode as Dir][1])} · bronze ${clock(course.def.trial[mode as Dir][0])}</div><small>Enter  again · M  venues</small>`;
  }
};

// Battle HUD: both cars' state (health, or the paint on each), the marker over the rival, and the hurt flash.
const rivalEl = document.getElementById('rival')!;
const hurtEl = document.getElementById('hurt')!;
const drawBattleHud = (dt: number): void => {
  const bar = (label: string, hp: number, cls: string): string => `<div class="hp ${cls}">${label}<i><b style="width:${hp}%"></b></i>${hp}</div>`;
  shootEl.style.display = 'block';
  shootEl.innerHTML =
    arms === 'gun'
      ? `${bar('YOU', fight.you, 'you')}${bar('RIVAL', fight.them, 'them')}`
      : `<div class="paint">paint on the rival <b>${fight.themTaken}</b> (+${fight.themTaken * PAINT_PENALTY} s)</div><div class="paint">paint on you <b>${fight.youTaken}</b> (+${fight.youTaken * PAINT_PENALTY} s)</div>`;
  // The marker: over the rival's roof, with the distance (and its health, or its paint).
  const p = rivalView.obj.position.clone().add(new THREE.Vector3(0, 1.9, 0));
  const d = p.distanceTo(camera.position);
  p.project(camera);
  const on = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 && d > 5;
  rivalEl.style.display = on ? 'block' : 'none';
  if (on) {
    rivalEl.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
    rivalEl.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
    rivalEl.innerHTML = `${fight.themOut ? 'WRECKED' : 'RIVAL'} ${Math.round(d)} m${arms === 'gun' ? `<i><b style="width:${fight.them}%"></b></i>` : ` · +${fight.themTaken} s`}`;
  }
  hurtT = Math.max(0, hurtT - dt);
  hurtEl.style.boxShadow = hurtT > 0 ? `inset 0 0 ${Math.round(80 + hurtT * 160)}px ${hurtColor}${Math.min(0.85, hurtT * 1.6).toFixed(2)})` : 'none';
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
  gunEl.innerHTML = `<div class="name">${W.label}</div><div class="ammo">${shooting.reloading > 0 ? 'reloading…' : pips}</div><small>${inBattle ? 'E reload' : `F ${WEAPONS[(shooting.weaponIndex + 1) % WEAPONS.length].label} · E reload · T clean targets`}</small>`;
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
  const c = menuOpen ? { throttle: 0, brake: 1, steer: 0, handbrake: false } : fight.youOut ? { throttle: 0, brake: 0.35, steer: 0, handbrake: false } : controls();
  car.assists = aiming ? AIM_ASSISTS : DRIFT_ASSISTS;
  // Held on the grid through the countdown (the engine still revs).
  if (!trial || trial.phase !== 'countdown') car.update(gdt, c, ground);
  if (inBattle && trial) {
    if (trial.phase !== 'countdown') rivalCar.update(gdt, rivalDrv.controls(gdt, car, fight.themOut || fight.themTime !== null), ground);
    separateCars(car, rivalCar);
    for (const e of rivalTrial?.update(dt, course.nearest(rivalCar.x, rivalCar.z).i) ?? []) if (e.kind === 'finish' && !fight.themOut) fight.themTime = e.t;
  }
  const here: 'lot' | 'top' | 'road' = course.inLot(car.x, car.z) ? 'lot' : course.inSummit(car.x, car.z) ? 'top' : 'road';
  // The trial runs on real time (slow motion is no help against the clock).
  if (trial) {
    const ni = course.nearest(car.x, car.z).i;
    for (const e of trial.update(dt, ni)) {
      if (e.kind === 'go') driftAtStart = total + chain;
      if (e.kind === 'split') {
        const prev = best?.splits[e.n - 1];
        const lead = inBattle && rivalTrial ? rivalTrial.splits[e.n - 1] : undefined;
        if (inBattle) splitEl.innerHTML = `CHECKPOINT ${e.n}  ${clock(e.t)}  ${lead === undefined ? '<b class="ahead">LEADING</b>' : `<b class="behind">+${(e.t - lead).toFixed(2)} behind</b>`}`;
        else splitEl.innerHTML = `CHECKPOINT ${e.n}  ${clock(e.t)}${prev !== undefined ? `  <b class="${e.t <= prev ? 'ahead' : 'behind'}">${signed(e.t - prev)}</b>` : ''}`;
        splitT = 3;
      }
      if (e.kind === 'finish' && kind === 'battle') fight.youTime = e.t;
      if (e.kind === 'finish' && kind === 'trial') {
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
  // The car on the ground. In the driver's-eye view the lean is damped to a third (a driver holds their head
  // level against it), so the passenger window doesn't tip into the ground mid-drift; the other views keep it.
  const fx = Math.sin(car.h);
  const fz = Math.cos(car.h);
  poseCar(player, car, ground, 1 - 0.65 * pov);
  body.visible = view === 'chase' || aiming || hipT > 0;
  turnWheels(player, car, gdt);
  if (inBattle) {
    poseCar(rivalView, rivalCar, ground);
    turnWheels(rivalView, rivalCar, gdt);
    // Shot up: smoke from under the bonnet, thicker as it goes, pouring once it's out.
    for (const [c2, hp] of [[car, fight.you], [rivalCar, fight.them]] as const) {
      if (arms === 'gun' && hp < 50 && Math.random() < ((50 - hp) / 50) * 0.8 * (gdt / dt)) puff(c2.x + Math.sin(c2.h) * 1.5, c2.y + 0.9, c2.z + Math.cos(c2.h) * 1.5, Math.sin(c2.h) * c2.u, Math.cos(c2.h) * c2.u);
    }
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
  if (shake > 0) {
    camera.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake * 0.12));
    shake = Math.max(0, shake - dt * 2.5);
  }
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
    if (trigger && side && !fight.youOut) {
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
  if (inBattle) {
    rivalGun(gdt);
    rivalShooting.update(gdt);
    gunSound.play(rivalShooting.events, camera.position);
    rivalShooting.events.length = 0;
    rivalShooting.scored.length = 0;
    decideBattle();
  }
  sound.slow = slow;
  gunSound.setSlow(slow);
  gunSound.play(shooting.events, camera.position);
  shooting.events.length = 0;
  drawShootingHud(dt, side, hip);
  if (inBattle) drawBattleHud(dt);
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
  hud.textContent = `${course.def.name} · ${course.def.atmosphere.label} · ${mode === 'free' ? `free drive · ${here === 'lot' ? 'practice lot' : here === 'top' ? 'the viewpoint' : 'the pass'}` : kind === 'battle' ? `⚔ battle, ${arms === 'gun' ? 'real guns' : 'paintball'} ${dir === 'up' ? '▲ uphill' : '▼ downhill'}` : `time trial ${mode === 'up' ? '▲ uphill' : '▼ downhill'}${best ? ` · best ${clock(best.time)}` : ''}`} · M venues`;
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
  battle: () => ({ fight, battleResult, rival: rivalCar, rivalTrial, rivalShooting }),
  trigger: (on: boolean): void => {
    trigger = on;
    pulled = on;
  },
};
