import { ATTACK_PAY, DriftAttack, loadAttackBest, rankFor, saveAttackBest, type Rank } from './driftAttack';
import { installSnap } from '../debug/snap';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { cityMaterial, cityUniforms } from '../poc3d/real/city';
import { DAMAGE, HEALTH, PAINT_PENALTY, RivalDriver, separateCars, type Arms } from './battle';
import { CircuitRace, gridSlots } from './circuit';
import { assistsBy, loadTuning, tunedBy, TuningPanel } from './tuning';
import type { CarType } from '../poc3d/models/vehicles';
import { addHeadlights, buildCar, CarMarks, hitVolumes, lampsByMotion, poseCar, setLamps, turnWheels, type Part } from './carView';
import { loadCourses } from './courses';
import { buildVenue } from './scene';
import { GunSound } from './gunSound';
import { CarInterior } from '../poc3d/models/carInterior';
import { Head, loadView, lookInto, nextView, outside, parseView, placeInCar, RearMirror, saveView, turnedEye, VIEW_NAMES, type DriveViewId } from './driveCam';
import { EYE, nearestShot, Shooting, sideFor, spreadOf, WEAPONS, wrap, type BodyHit, type Side } from './shooting';
import { model, tunedSpec } from './catalog';
import { cityReturn, rememberCityReturn } from './cityLink';
import { currentCar, earn, loadProfile, PAY, saveProfile, trialPay, yen } from './profile';
import { CarSound } from './sound';
import { clock, GhostTrack, loadBest, medalFor, saveBest, Trial, trialPlan, type BestRun, type Dir, type Medal } from './trial';
import { Targets } from './targets';
import { Car, DRIFT_ASSISTS, ROAD_ASSISTS, type Assists, type Controls } from './vehicle';
import { bikeIdOf, BikeRide } from './bikeRide';
import { CarDriver, driverLine } from './carDriver';
import { Crosshair } from '../poc3d/models/crosshair';
import { MuzzleFlashes } from '../poc3d/models/muzzleFlash';

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
const kind: 'free' | 'trial' | 'battle' | 'drift' | 'gp' = modeParam === 'up' || modeParam === 'down' ? 'trial' : modeParam === 'battle' ? 'battle' : modeParam === 'drift' && course.def.drift ? 'drift' : modeParam === 'race' && course.def.circuit ? 'gp' : 'free';
const arms: Arms = params.get('arms') === 'paint' ? 'paint' : 'gun';
const dir: Dir = modeParam === 'up' || (modeParam === 'battle' && params.get('dir') === 'up') ? 'up' : 'down';
/** 'free', or the direction a race (trial or battle) runs. */
const mode: 'free' | Dir = kind === 'free' || kind === 'drift' || kind === 'gp' ? 'free' : dir;
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
// (Created once the scene and renderer are up: below.)
let ride: BikeRide | null = null;
const rideCross = new Crosshair();

const venue = buildVenue(course);
scene.add(venue.group);
if (params.get('ride') && bikeIdOf(params.get('ride'))) ride = BikeRide.create(bikeIdOf(params.get('ride'))!, scene, renderer);

// The car: the showroom's coupe on the city material (its lamps lit), with two headlight beams (carView.ts).
const cityU = cityUniforms();
cityU.uLightGain.value = 0;
cityU.uLamps.value = 1;
const carMat = cityMaterial(cityU);
// Your car: the one you're driving in the garage (profile.ts), its paint, livery and neon, tuned by its parts.
const profile = loadProfile();
// Checks and testing: ?yen= sets your money.
if (params.has('yen')) {
  profile.yen = Number(params.get('yen'));
  saveProfile(profile);
}
const mine = currentCar(profile);
// Came from the city (a tunnel, or the garage): remembered, so the menu's way back goes the same way.
rememberCityReturn(params);
const mineModel = model(mine.type);
const player = buildCar({ type: mine.type, paint: mine.paint, paint2: mine.paint2, livery: mine.livery, neon: mine.neonFitted ? mine.neon : null }, carMat);
const carObj = player.obj;
const body = player.body;
scene.add(carObj);
// Shooting practice: the lot's targets, and the driver's pistol and paintball marker (shooting.ts).
const targets = new Targets(course);
scene.add(targets.group);
const shooting = new Shooting(course, targets);
shooting.pointScale = window.innerHeight;
if (kind !== 'battle') shooting.pickWeapon(WEAPONS.findIndex((w) => w.id === 'shotgun'));
scene.add(shooting.group);
carObj.add(shooting.arm);
// The cabin (models/carInterior.ts), fitted to your car: shown in the cockpit view and when shooting from the
// driver's eye; the rear-view mirror shows what's behind (driveCam.ts). And the gauges' faint glow on it (the
// light is always there, only dark outside the view: adding and removing lights recompiles the shaders).
const interior = new CarInterior(mine.type, carMat, { rpmMax: mineModel.sound.maxRpm, turbo: !!tunedSpec(mine.type, mine.parts).turbo });
const cabin = interior.group;
carObj.add(cabin);
const mirror = new RearMirror();
interior.showMirror(mirror.material);
/** The driver's eyes in this car, and his head thrown about in the cockpit. */
const eyeAt = interior.layout.eye;
const head = new Head();
const cabinLight = new THREE.PointLight(0x9aa8c8, 0, 2.4, 1.5);
cabinLight.position.set(0.1, 1.15, 0.1);
carObj.add(cabinLight);
/** 0 over the shoulder, 1 at the driver's eye (shooting across the car through the passenger window). */
let pov = 0;
const gunSound = new GunSound();
/** Aiming, the car holds its line a little better (more countersteer), so one hand on the wheel will do. */
const AIM_ASSISTS: Assists = { ...DRIFT_ASSISTS, countersteer: 0.7 };
addHeadlights(carObj);
// Mack at the wheel (carDriver.ts): seated, his hands on the wheel, his shotgun out of a window (the side
// windows roll down for any weapon). Not on a bike: the bike carries him itself.
const driver = ride ? null : CarDriver.create(player, scene, renderer);
/** The weapon is one of Mack's (his shotgun or his Type 54, in his hand), not the old arm's paintball marker. */
const hisGun = (): boolean => driver !== null && (shooting.weapon.id === 'shotgun' || shooting.weapon.id === 'pistol');
// On a bike the two beams come from its one headlamp (in the car's frame: +z forward), a little apart.
if (ride) {
  let k = 0;
  carObj.traverse((o) => {
    const l = o as THREE.SpotLight;
    if (!l.isSpotLight) return;
    const sx = k++ === 0 ? -0.06 : 0.06;
    l.position.set(sx, 0.95, 0.95);
    l.target.position.set(sx * 8, -0.3, 30);
  });
}

// Your car's spec with its parts, and the driving tuning on top (race/tuning.ts: the ` key's panel, for testing).
// Riding a motorcycle instead (?ride=cruiser|cruiser-silver|bosozoku: bikeRide.ts), on the same handling model.
const rideId = bikeIdOf(params.get('ride'));
const baseSpec = rideId ? BikeRide.specOf(rideId) : tunedSpec(mine.type, mine.parts);
const car = new Car(tunedBy(baseSpec, loadTuning()), DRIFT_ASSISTS);
const tuningPanel = new TuningPanel('drift', (t) => (car.spec = tunedBy(baseSpec, t)));
const driftAssists = (): Assists => assistsBy(DRIFT_ASSISTS, 'drift', tuningPanel.tuning);
const at = kind === 'gp' ? 'grid' : mode === 'free' ? (params.get('at') ?? 'lot') : 'grid';
const placeAt = (where: string): void => {
  // (A circuit has no viewpoint: its "top" is the track.)
  if (where === 'top' && course.loop) where = 'road';
  if (where === 'grid' && gp) {
    // The circuit's grid: your slot (at the back), facing the way the race goes.
    const sl = gp.slots[0];
    const i = sl.i;
    car.place(course.x[i] + course.tz[i] * sl.lane, course.z[i] - course.tx[i] * sl.lane, Math.atan2(course.tx[i], course.tz[i]), ground);
  } else if (where === 'grid' && trial) {
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
// ---- Drift attack (a wharf's scored run, race/driftAttack.ts): the zones on the ground, the run, its result.
let attack: DriftAttack | null = null;
let attackResult: { score: number; rank: Rank; best: { score: number; rank: Rank } | null; newBest: boolean; zones: number[] } | null = null;
const zoneRings = (course.def.drift?.zones ?? []).map((zn) => {
  const m = new THREE.Mesh(new THREE.RingGeometry(zn.r - 0.6, zn.r, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff4fa8, transparent: true, opacity: 0.8, depthWrite: false }));
  m.position.set(zn.at[0], course.height(zn.at[0], zn.at[1]) + 0.05, zn.at[1]);
  m.visible = kind === 'drift';
  scene.add(m);
  return m;
});
const startAttack = (): void => {
  if (!course.def.drift) return;
  attack = new DriftAttack(course.def.drift);
  attackResult = null;
  placeAt('lot');
};

const startTrial = (): void => {
  if (mode === 'free') return;
  trial = new Trial(trialPlan(course, mode));
  track = new GhostTrack();
  result = null;
  placeAt('grid');
  if (kind === 'battle') startBattle(trial);
};

// ---- Battle: the rival, a red coupe on the same handling model (RivalDriver drives it), armed as you are.
// Real guns: each hit takes health (more through the glass); a tyre shot out or a round in the driver's head
// is lethal. A car at none is out (it spins or coasts to a stop) and loses at once; otherwise the first down
// wins. Shooting the rival's gunman silences his gun. Paintball: each hit you take adds PAINT_PENALTY seconds to your time; the lower total wins.
// ---- A race round a circuit (race/circuit.ts): you at the back of the grid, the venue's rivals ahead of you
// (each a car on the same handling model, stock, driven by RivalDriver taking a racing line and passing), a
// standing start under the gantry's five red lights, laps, places, and what the places pay.
interface GpRival { readonly name: string; readonly car: Car; readonly drv: RivalDriver; readonly view: ReturnType<typeof buildCar> }
let gp: { race: CircuitRace; slots: ReturnType<typeof gridSlots>; rivals: GpRival[]; paid: boolean; result: { place: number; pay: number; bestLap: number | null; best: GpBest | null; newBest: boolean } | null } | null = null;
interface GpBest { readonly place: number; readonly lap: number | null }
const gpKey = `rainyplace.race.v1.${venueId}.gp`;
const loadGpBest = (id = venueId): GpBest | null => {
  try {
    return JSON.parse(localStorage.getItem(`rainyplace.race.v1.${id}.gp`) ?? 'null') as GpBest | null;
  } catch {
    return null;
  }
};
const startGp = (): void => {
  const def = course.def.circuit;
  if (!def) return;
  if (gp) for (const r of gp.rivals) scene.remove(r.view.obj);
  const slots = gridSlots(course, def.start, def.rivals.length + 1).reverse();
  const rivals = def.rivals.map((r, k): GpRival => {
    const c = new Car(tunedSpec(r.type as CarType, {}), ROAD_ASSISTS);
    const sl = slots[k + 1];
    c.place(course.x[sl.i] + course.tz[sl.i] * sl.lane, course.z[sl.i] - course.tx[sl.i] * sl.lane, Math.atan2(course.tx[sl.i], course.tz[sl.i]), ground);
    const drv = new RivalDriver(c, course, 'up', r.skill, sl.lane);
    drv.laneMax = course.half - 1.6;
    drv.top = 70;
    const view = buildCar({ type: r.type as CarType, paint: r.paint }, carMat);
    scene.add(view.obj);
    return { name: r.name, car: c, drv, view };
  });
  gp = { race: new CircuitRace(course, def.laps, def.start, ['You', ...def.rivals.map((r) => r.name)], slots), slots, rivals, paid: false, result: null };
  placeAt('grid');
};
/** Each frame of a race: the rivals drive (held on the grid through the countdown), everyone knocks, laps count. */
const updateGp = (dt: number, gdt: number): void => {
  if (!gp) return;
  const race = gp.race;
  const all = [car, ...gp.rivals.map((r) => r.car)];
  // (Rivals push a little when they're behind you, ease off when they're well ahead: a race stays a race.)
  const mine = race.racers[0].dist;
  gp.rivals.forEach((r, k) => {
    const gap = race.racers[k + 1].dist - mine;
    r.drv.push = gap > 180 ? 0.96 : gap < -60 ? 1.03 : 1;
    if (race.phase !== 'countdown') r.car.update(gdt, r.drv.controls(gdt, all, false), ground);
  });
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) separateCars(all[a], all[b]);
  const was = race.phase;
  for (const e of race.update(dt, all.map((c) => course.nearest(c.x, c.z).i), 0)) {
    if (e.kind === 'go') venue.startLights?.(0);
    if (e.kind === 'lap' && e.car === 0) {
      splitEl.innerHTML = `LAP ${e.lap}/${race.laps}  ${clock(e.time)}${e.best ? '  <b class="ahead">FASTEST LAP</b>' : ''}  ·  P${race.placeOf(0)}`;
      splitT = 3;
    }
  }
  if (race.phase === 'countdown') venue.startLights?.(Math.min(5, Math.floor((3 - race.count) / 0.55) + 1));
  if (was === 'racing' && race.phase === 'finished' && !gp.paid) {
    gp.paid = true;
    const place = race.placeOf(0);
    const pay = course.def.circuit!.pay[place - 1] ?? 0;
    const you = race.racers[0];
    const laps = you.lapTimes.map((t, i) => t - (i ? you.lapTimes[i - 1] : 0));
    const bestLap = laps.length ? Math.min(...laps) : null;
    const best = loadGpBest();
    const newBest = !best || place < best.place || (place === best.place && bestLap !== null && (best.lap === null || bestLap < best.lap));
    if (newBest) {
      try {
        localStorage.setItem(gpKey, JSON.stringify({ place: best ? Math.min(place, best.place) : place, lap: bestLap !== null && best?.lap != null ? Math.min(bestLap, best.lap) : bestLap }));
      } catch {
        /* storage blocked */
      }
    }
    gp.result = { place, pay, bestLap, best, newBest };
    if (pay > 0) payout(pay, `P${place}`);
  }
  for (const r of gp.rivals) {
    poseCar(r.view, r.car, ground);
    turnWheels(r.view, r.car, gdt);
    lampsByMotion(r.view, r.car);
  }
};
const ordinal = (n: number): string => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

const inBattle = kind === 'battle';
// The rival drives the same model as you, stock (your parts are your edge), in red (or black if you're red).
const rivalCar = new Car(mineModel.spec, DRIFT_ASSISTS);
const rivalView = buildCar({ type: mine.type, paint: mine.paint === 0xc01818 ? 0x121316 : 0xc01818 }, carMat);
const rivalDrv = new RivalDriver(rivalCar, course, dir, Number(params.get('skill') ?? 1));
const rivalShooting = new Shooting(course, targets);
// (Both sides' muzzle flashes are the footage: models/muzzleFlash.ts.)
for (const s of [shooting, rivalShooting]) {
  s.flashes = new MuzzleFlashes();
  scene.add(s.flashes.group);
}
rivalShooting.assist = false;
// The rival car carries a gunman in the passenger (left) seat: his wide arc is out of the left window.
rivalShooting.seat = 'left';
const playerMarks = new CarMarks(carObj);
const rivalMarks = new CarMarks(rivalView.obj);
let rivalTrial: Trial | null = null;
const FRESH = { you: HEALTH, them: HEALTH, youTaken: 0, themTaken: 0, youOut: false, themOut: false, youOutAt: 0, themOutAt: 0, youWhy: '', themWhy: '', youDead: false, gunmanDown: false, youTime: null as number | null, themTime: null as number | null, cool: 2, aimT: 0, burstLeft: 3, burstT: 0.8 };
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
  shooting.bodies.push(...hitVolumes(rivalView.obj, 'them', true, mine.type));
  rivalShooting.bodies.push(...hitVolumes(carObj, 'you', false, mine.type));
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

/** A car is out: why, and when (the result waits a moment so you see it go). A blown tyre spins it. */
function knockOut(who: 'you' | 'them', why: string, tyre: boolean): void {
  const c = who === 'you' ? car : rivalCar;
  if (tyre) c.r += (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random());
  if (who === 'you') {
    fight.you = 0;
    fight.youOut = true;
    fight.youOutAt = elapsed.t;
    fight.youWhy = why;
  } else {
    fight.them = 0;
    fight.themOut = true;
    fight.themOutAt = elapsed.t;
    fight.themWhy = why;
  }
}

/** A shot struck a car: the mark on it (not on a head: that's inside), then damage (real guns) or a penalty (paint). */
function struck(who: 'you' | 'them', h: BodyHit, k: 'bullet' | 'paint', col?: THREE.Color): void {
  const part = h.object.userData.part as Part;
  if (part !== 'head') (who === 'you' ? playerMarks : rivalMarks).add(h.point, h.normal, k, col);
  if (who === 'you' ? fight.youOut : fight.themOut) return;
  const glass = part === 'glass' || part === 'head';
  if (arms === 'gun') {
    const gunman = h.object.userData.who === 'gunman';
    if (who === 'them') {
      if (part === 'head' && gunman) {
        if (!fight.gunmanDown) pops.push({ text: 'HEADSHOT  the gunman is down', t: 2.5 });
        fight.gunmanDown = true;
      } else if (part === 'head') {
        pops.push({ text: 'HEADSHOT', t: 2.5 });
        knockOut('them', 'You shot the rival driver.', false);
      } else if (part === 'tyre') {
        pops.push({ text: 'TYRE SHOT OUT', t: 2.5 });
        knockOut('them', "You shot out the rival's tyre.", true);
      } else {
        const dmg = glass ? DAMAGE.glass : DAMAGE.body;
        fight.them = Math.max(0, fight.them - dmg);
        pops.push({ text: `${glass ? 'THROUGH THE GLASS' : 'HIT'} −${dmg}`, t: 1.4 });
        if (fight.them === 0) {
          pops.push({ text: 'RIVAL DOWN', t: 2.5 });
          knockOut('them', 'You shot the rival car to pieces.', false);
        }
      }
    } else {
      hurtColor = 'rgba(255, 40, 50, ';
      hurtT = glass ? 0.7 : 0.45;
      shake = glass ? 0.8 : 0.45;
      if (part === 'head') {
        fight.youDead = true;
        knockOut('you', 'You were shot through the window.', false);
      } else if (part === 'tyre') {
        shake = 1.2;
        knockOut('you', 'Your tyre was shot out.', true);
      } else {
        fight.you = Math.max(0, fight.you - (glass ? DAMAGE.glass : DAMAGE.body));
        if (fight.you === 0) knockOut('you', 'Your car was shot to pieces.', false);
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
  const live = inBattle && trial?.phase === 'running' && !fight.themOut && !fight.youOut && !fight.gunmanDown && fight.themTime === null && fight.youTime === null;
  if (!live) {
    S.arm.visible = false;
    fight.aimT = 0;
    return;
  }
  rivalView.obj.updateMatrixWorld();
  carObj.updateMatrixWorld();
  // From the gunman's eye (the driver's, mirrored to the left seat); his windows are the driver's mirrored.
  const eye = rivalView.obj.localToWorld(new THREE.Vector3(-EYE.x, EYE.y, EYE.z));
  // He aims at the cabin (a stray low round can still find a tyre).
  const at = carObj.localToWorld(new THREE.Vector3(0, 0.95, 0.1));
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
  aimPoint.add(new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).multiplyScalar(miss * 2));
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
    payout(win ? PAY.battle[arms] : PAY.battleLoss, win ? 'battle won' : 'battle');
    battleResult = { win, why, you: fight.youTime, them: fight.themTime, youPen: pen(fight.youTaken), themPen: pen(fight.themTaken), youSoFar: trial!.t, themSoFar: rivalTrial!.t };
  };
  if (arms === 'gun') {
    // A car out ends it (after a moment to see it go); otherwise the first down wins.
    if (fight.youOut && elapsed.t - fight.youOutAt > 1.5) return end(false, fight.youWhy);
    if (fight.themOut && elapsed.t - fight.themOutAt > 1.5) return end(true, fight.themWhy);
    if (fight.youOut || fight.themOut) return;
    if (fight.youTime !== null) return end(true, 'You crossed the line first.');
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
// The camera: ?cam= any view; else the one last picked (a bike: his eyes unless ?cam=chase).
let view: DriveViewId = parseView(params.get('cam')) ?? (ride ? 'cockpit' : loadView());
if (ride && !outside(view)) view = 'cockpit';
let help = true;
window.addEventListener('keydown', (e) => {
  sound.start();
  sound.configure(ride ? ride.def.sound : mineModel.sound);
  gunSound.start();
  if (ride) {
    // On the bike: X draws or puts away the shotgun, E reloads it.
    if (e.code === 'KeyX' && ride.rig && armed) {
      ride.rig.armed = !ride.rig.armed;
      if (!ride.rig.armed) ride.rig.aiming = false;
    }
    if (e.code === 'KeyE') ride.rig?.reload();
  } else {
    if (e.code === 'KeyF' && kind !== 'battle') shooting.pickWeapon(shooting.weaponIndex + 1);
    if (e.code === 'KeyE') {
      if (hisGun()) driver?.rig?.reload();
      else shooting.reload();
    }
  }
  if (e.code === 'KeyT') shooting.reset();
  if (e.code === 'KeyG') {
    slowAuto = !slowAuto;
    if (!slowAuto) slowOn = false;
    toastText = slowAuto ? 'Slow motion when you aim: on · G to turn it off' : 'Slow motion when you aim: off · G to turn it on';
    toastT = 2.5;
  }
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyQ') {
    view = nextView(view, !!ride);
    if (!ride) saveView(view);
    toastText = ride ? (outside(view) ? 'Third person' : 'First person') : `Camera: ${VIEW_NAMES[view]}`;
    toastT = 1.2;
    head.reset();
  }
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
  if (kind === 'drift' && e.code === 'Enter') startAttack();
  if (kind === 'gp' && e.code === 'Enter') startGp();
  if (e.code === 'Backquote') {
    if (tuningPanel.open) tuningPanel.hide();
    else {
      if (document.pointerLockElement) document.exitPointerLock();
      tuningPanel.show(car, baseSpec, DRIFT_ASSISTS);
    }
  }
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
// from the hip, where the camera looks, less accurately (and never in slow motion).
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
/** Mack's aim in the car (carDriver.ts): the point, and the window it's through. */
let driveAim: THREE.Vector3 | null = null;
let driveWindow: Side | null = null;
/** Checks only (__race.calm): he drives as in the city, one-handed when nothing asks for two (racing, he never does). */
let calmDrive = false;
/** Checks only (__race.freezeCam): the camera stays where a script put it. */
let freezeCam = false;
document.addEventListener('contextmenu', (e) => e.preventDefault());
/** Trials are about the clock: no shooting. Free drive and battles shoot (targets where the venue has them). */
const armed = kind !== 'trial' && kind !== 'gp' && !course.loop;
document.addEventListener('mousedown', (e) => {
  if (!document.pointerLockElement || !armed) return;
  if (ride) {
    if (!ride.rig?.armed) return;
    if (e.button === 2) {
      startAiming();
      ride.rig.aiming = true;
    }
    if (e.button === 0) ride.rig.fire();
    return;
  }
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
  if (e.button === 2) {
    stopAiming();
    if (ride?.rig) ride.rig.aiming = false;
  }
  if (e.button === 0) trigger = false;
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) stopAiming();
});
// Mouse look: a click captures the mouse (Esc lets it go); moving it swings the camera round the car and up
// or down, and it eases back behind the car a moment after you stop. Mouse Y follows the district's choice
// (the same 'rainyplace.invertY' in localStorage; I toggles it here too; ?invertY=1 / 0).
const INVERT_KEY = 'rainyplace.invertY';
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
  helpEl.textContent = `W / S  drive · brake     A / D  steer     Space  handbrake     Q  camera     Z  look back     R  back on the road\nRight mouse  aim (the driver's window, on the right, is the wide one)     Left mouse  fire     E  reload     Enter  start again     M  venues     H  hide this\n${arms === 'gun' ? 'Real guns: shoot the red car to pieces, or beat it down.' : `Paintball: every hit you take adds ${PAINT_PENALTY} s to your time.`}`;
else if (kind === 'trial') helpEl.textContent = 'W / S  drive · brake     A / D  steer     Space  handbrake     Q  camera     Z  look back     R  back on the road\nEnter  start again     M  venues     H  hide this     The blue car is your best run.';
if (ride) {
  helpEl.textContent = [
    'W / S  throttle · brake, then reverse     A / D  steer     Space  rear brake (start a slide)     Q  first / third person     R  back on the road',
    ...(armed ? [`X  ${ride.def.gun === 'pistol' ? 'pistol' : 'shotgun'} / hands on the bars     Right mouse  raise it (slow motion)     Left mouse  fire     E  reload     T  clean targets`] : []),
    'Click  mouse look (Esc lets go)     I  invert mouse Y     `  tune the handling     M  venues     H  hide this',
  ].join('\n');
}
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
const payEl = document.getElementById('pay')!;
let payT = 0;
/** Money in: into the wallet (saved), and a line under the clock. */
function payout(amount: number, why: string): void {
  earn(profile, amount);
  saveProfile(profile);
  payEl.innerHTML = `+${yen(amount)} <span>${why}</span>`;
  payT = 2.5;
}
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
    const back = cityReturn();
    menuEl.innerHTML = `<h1>峠 <span>the passes</span></h1><a class="garage" href="${back.href}"><b>${back.label}</b><span>${back.note}</span></a><a class="garage" href="garage.html"><b>ガレージ Garage</b><span>${mineModel.maker} ${mineModel.name} · ${yen(profile.yen)}</span></a><div class="cards">${[...courses.entries()]
      .map(([id, c]) => {
        const row = (d: Dir, label: string): string => {
          const b = loadBest(id, d);
          const m = b ? medalFor(b.time, c.def.trial[d]) : null;
          return `<a class="mode" href="?venue=${id}&mode=${d}">${label}<span>${b ? `${clock(b.time)} ${medalHtml(m)}` : `gold ${clock(c.def.trial[d][2])}`}</span></a>`;
        };
        if (c.def.kind === 'circuit') {
          const b = loadGpBest(id);
          const ci = c.def.circuit!;
          return `<div class="card${id === venueId ? ' here' : ''}"><div class="name">${c.def.name}</div><div class="meta">${c.def.atmosphere.label} · street circuit · ${(c.length / 1000).toFixed(2)} km</div><p>${c.def.blurb}</p><a class="mode battle" href="?venue=${id}&mode=race">🏁 Race, ${ci.laps} laps<span>${b ? `best ${ordinal(b.place)}${b.lap !== null ? ` · ${clock(b.lap)}` : ''}` : `against ${ci.rivals.length} rivals · 1st ${yen(ci.pay[0])}`}</span></a><a class="mode" href="?venue=${id}&mode=free&at=road">Free drive<span>learn the circuit</span></a></div>`;
        }
        if (c.def.kind === 'wharf') {
          const b = loadAttackBest(id);
          return `<div class="card${id === venueId ? ' here' : ''}"><div class="name">${c.def.name}</div><div class="meta">${c.def.atmosphere.label} · harbour lot · ${c.def.drift?.zones.length ?? 0} zones</div><p>${c.def.blurb}</p><a class="mode" href="?venue=${id}&mode=drift">↻ Drift attack<span>${b ? `best ${b.score.toLocaleString()} (${b.rank})` : `S ${c.def.drift!.ranks[3].toLocaleString()}`}</span></a><a class="mode" href="?venue=${id}&mode=free">Free drive<span>the lot, drifting</span></a></div>`;
        }
        return `<div class="card${id === venueId ? ' here' : ''}"><div class="name">${c.def.name}</div><div class="meta">${c.def.atmosphere.label} · ${(c.length / 1000).toFixed(1)} km · ${Math.round(c.summit.y)} m climb</div><p>${c.def.blurb}</p>${row('up', '▲ Time trial, uphill')}${row('down', '▼ Time trial, downhill')}<a class="mode battle" href="?venue=${id}&mode=battle&arms=gun">⚔ Battle, real guns<span>▼ against a rival</span></a><a class="mode battle" href="?venue=${id}&mode=battle&arms=paint">⚔ Battle, paintball<span>▼ +${PAINT_PENALTY} s a hit</span></a><a class="mode" href="?venue=${id}&mode=free">Free drive<span>the lot, drifting${c.def.targets?.length ? ', shooting' : ''}</span></a></div>`;
      })
      .join('')}</div><small>${params.has('venue') ? 'M closes this · ' : ''}Times are kept in this browser.</small>`;
  }
};

// Trial HUD: the countdown, the clock (and the gap to your best at the last checkpoint), split flashes, results.
const drawTrialHud = (dt: number): void => {
  splitT = Math.max(0, splitT - dt);
  splitEl.style.opacity = Math.min(1, splitT * 2).toFixed(2);
  if (gp) {
    const race = gp.race;
    const cd = race.phase === 'countdown' ? Math.ceil(race.count - 0.5) : 0;
    countEl.textContent = cd > 0 ? String(cd) : race.phase === 'racing' && race.t < 0.8 ? 'GO' : '';
    countEl.className = cd > 0 ? 'n' : 'go';
    const you = race.racers[0];
    const lapStart = you.lapTimes.length ? you.lapTimes[you.lapTimes.length - 1] : 0;
    const fl = race.bestLap();
    timerEl.textContent = race.phase === 'finished' ? `${ordinal(race.placeOf(0))}  ${clock(you.finished ?? race.t)}` : `P${race.placeOf(0)}/${race.racers.length}   LAP ${Math.min(race.laps, you.laps + 1)}/${race.laps}   ${clock(Math.max(0, race.t - lapStart))}${fl !== null ? `   fastest ${clock(fl)}` : ''}`;
    resultsEl.style.display = gp.result ? 'block' : 'none';
    if (gp.result) {
      const r = gp.result;
      const leader = race.racers[race.standings()[0]];
      const rows = race.standings().map((k, i) => {
        const q = race.racers[k];
        const gap = q.finished !== null ? (i === 0 ? clock(q.finished) : `+${(q.finished - (leader.finished ?? 0)).toFixed(2)}`) : q.laps < race.laps - 1 ? `+${race.laps - q.laps} laps` : `+${Math.max(0, Math.round(leader.dist - q.dist))} m`;
        return `<div${k === 0 ? ' class="you"' : ''}>${i + 1}. ${q.name}<span>${gap}</span></div>`;
      }).join('');
      resultsEl.innerHTML = `<div class="head">${course.def.name}  ${race.laps} LAPS</div><div class="time ${r.place === 1 ? 'win' : ''}">${ordinal(r.place).toUpperCase()}</div>${r.bestLap !== null ? `<div class="prev">your fastest lap ${clock(r.bestLap)}</div>` : ''}${r.newBest ? '<div class="best">NEW BEST</div>' : r.best ? `<div class="prev">best ${ordinal(r.best.place)}${r.best.lap !== null ? ` · ${clock(r.best.lap)}` : ''}</div>` : ''}<div class="splits">${rows}</div>${r.pay ? `<div class="prev">+ ${yen(r.pay)}</div>` : ''}<small>Enter  again · M  venues</small>`;
    }
    return;
  }
  if (attack) {
    const cd = attack.phase === 'countdown' ? Math.ceil(attack.countdown - 0.5) : 0;
    countEl.textContent = cd > 0 ? String(cd) : attack.phase === 'running' && attack.t < 0.8 ? 'GO' : '';
    countEl.className = cd > 0 ? 'n' : 'go';
    timerEl.textContent = `DRIFT ATTACK  ${clock(attack.timeLeft)}  ·  ZONE ${Math.min(attack.zone + 1, attack.def.zones.length)}/${attack.def.zones.length}  ·  ${attack.score.toLocaleString()}`;
    resultsEl.style.display = attackResult ? 'block' : 'none';
    if (attackResult) {
      const r = attackResult;
      const zones = r.zones.map((p, i) => `<div>Zone ${i + 1} ×${attack!.def.zones[i].mult}<span>${p.toLocaleString()}</span></div>`).join('');
      resultsEl.innerHTML = `<div class="head">${course.def.name}  DRIFT ATTACK</div><div class="time">${r.score.toLocaleString()}</div><div class="medal">${r.rank} RANK</div>${r.newBest ? '<div class="best">NEW BEST</div>' : `<div class="prev">best ${r.best!.score.toLocaleString()} (${r.best!.rank})</div>`}<div class="splits">${zones}</div><div class="medals">S ${attack.def.ranks[3].toLocaleString()} · A ${attack.def.ranks[2].toLocaleString()} · B ${attack.def.ranks[1].toLocaleString()} · C ${attack.def.ranks[0].toLocaleString()}</div><small>Enter  again · M  venues</small>`;
    }
    return;
  }
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
        `<div>You<span>${fight.youOut ? (fight.youDead ? 'shot' : 'out') : t(r.you, r.youPen, r.youSoFar)}</span></div>`,
        `<div>Rival<span>${fight.themOut ? 'out' : t(r.them, r.themPen, r.themSoFar)}</span></div>`,
        arms === 'gun' ? `<div>Your car<span>${fight.you}%</span></div><div>Rival's car<span>${fight.them}%</span></div>` : `<div>Paint on the rival<span>${fight.themTaken}</span></div><div>Paint on you<span>${fight.youTaken}</span></div>`,
        arms === 'gun' && fight.gunmanDown ? `<div>Rival's gunman<span>shot</span></div>` : '',
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
    rivalEl.innerHTML = `${fight.themOut ? 'OUT' : fight.gunmanDown ? 'RIVAL (unarmed)' : 'RIVAL'} ${Math.round(d)} m${arms === 'gun' ? `<i><b style="width:${fight.them}%"></b></i>` : ` · +${fight.themTaken} s`}`;
  }
  hurtT = Math.max(0, hurtT - dt);
  // Shot dead: the view darkens to a deep red.
  const dead = fight.youDead ? Math.min(1, (elapsed.t - fight.youOutAt) / 1.2) : 0;
  hurtEl.style.background = dead > 0 ? `rgba(40, 0, 4, ${(dead * 0.78).toFixed(2)})` : 'none';
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
/** Looking back (0-1, eased), and where the cockpit view looks into the bend (rad). */
let lookBack = 0;
let cockpitYaw = 0;
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
    // Mack's shotgun is always aimed from his eyes (his arm out of whichever window, as on the bike); the
    // other weapons only across the car.
    const his = hisGun();
    const left = his || (rel > 32 * (Math.PI / 180) && rel < 165 * (Math.PI / 180));
    pov += ((left ? 1 : 0) - pov) * Math.min(1, dt * 10);
    const k = pov * pov * (3 - 2 * pov);
    const eye = carObj.localToWorld(eyeAt.clone().add(driver?.eyeShift ?? new THREE.Vector3()));
    camera.position.copy(camPos).lerp(eye, k);
    camera.lookAt(camera.position.clone().add(d));
    cabin.visible = pov > 0.5;
    cabinLight.intensity = cabin.visible ? 0.3 : 0;
    return;
  }
  // Z looks back (over the left shoulder in the cockpit; the chase cameras swing round in front).
  lookBack += ((keys.has('KeyZ') ? 1 : 0) - lookBack) * Math.min(1, dt * 9);
  const backYaw = lookBack * lookBack * (3 - 2 * lookBack) * Math.PI;
  const inside = view === 'cockpit';
  pov = inside ? 1 : 0;
  cabin.visible = inside;
  cabinLight.intensity = inside ? 0.3 : 0;
  const fovNow = (inside ? 72 : view === 'far' ? 56 : view === 'chase' ? 62 : 66) + Math.min(8, speed * 0.18);
  if (Math.abs(camera.fov - fovNow) > 0.05) {
    camera.fov += (fovNow - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
  if (inside) {
    // At his eyes: thrown about by the car, looking into the bend and along a slide, the roll half held level.
    head.update(dt, car.ax, car.ay, speed, car.bump);
    cockpitYaw += (lookInto(car.steer, speed, car.slide) - cockpitYaw) * Math.min(1, dt * 3);
    const look = THREE.MathUtils.clamp(orbitYaw, -2.2, 2.2) + cockpitYaw + backYaw;
    placeInCar(camera, carObj, turnedEye(eyeAt.clone(), look).add(head.offset).add(driver?.eyeShift ?? new THREE.Vector3()), look, lookPitch - 0.06, 0.5);
    camPos.copy(camera.position);
    return;
  }
  if (view === 'hood') {
    placeInCar(camera, carObj, interior.layout.hood, orbitYaw + backYaw, lookPitch - 0.04);
    camPos.copy(camera.position);
    return;
  }
  if (view === 'bumper') {
    const p = new THREE.Vector3(car.x + Math.sin(car.h) * 2.1, car.y + 0.85, car.z + Math.cos(car.h) * 2.1);
    const a = car.h + orbitYaw + backYaw;
    camera.position.copy(p);
    camera.lookAt(p.x + Math.sin(a) * 10, p.y + Math.tan(lookPitch - 0.025) * 10, p.z + Math.cos(a) * 10);
    camPos.copy(camera.position);
    return;
  }
  // Orbit about the car: looking up swings the camera down behind it (and looking down lifts it); further back
  // and higher for the far chase.
  const far = view === 'far';
  const a = camDir + orbitYaw + backYaw;
  const elev = -lookPitch;
  const back = ((far ? 8.8 : 5.8) + Math.min(1.5, speed / 25)) * Math.cos(elev);
  const target = new THREE.Vector3(car.x - Math.sin(a) * back, car.y + (far ? 3.3 : 2.0) + Math.sin(elev) * 6, car.z - Math.cos(a) * back);
  target.y = Math.max(target.y, course.height(target.x, target.z) + 0.6);
  camPos.lerp(target, snap || mouseIdle < 0.2 ? 1 - Math.exp(-dt * 25) : 1 - Math.exp(-dt * 7));
  if (snap) camPos.copy(target);
  camera.position.copy(camPos);
  camLook.set(car.x + Math.sin(a) * 6, car.y + 1.25 + Math.max(0, lookPitch) * 6, car.z + Math.cos(a) * 6);
  camera.lookAt(camLook);
};

if (mode !== 'free') startTrial();
if (kind === 'drift') startAttack();
else if (kind === 'gp') startGp();
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
  const da = driftAssists();
  car.assists = aiming ? { ...da, countersteer: Math.max(da.countersteer, AIM_ASSISTS.countersteer) } : da;
  tuningPanel.tick();
  // Held on the grid through the countdown (the engine still revs).
  if ((!trial || trial.phase !== 'countdown') && !(attack && attack.phase === 'countdown') && !(gp && gp.race.phase === 'countdown')) car.update(gdt, c, ground);
  updateGp(dt, gdt);
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
        payout(trialPay(result.medal, newBest), result.medal ? `${result.medal} medal` : 'finished');
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
      if (chain >= 5) payout(Math.round(chain) * PAY.drift, 'drift');
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
  if (attack) {
    const was = attack.phase;
    const pts = drifting ? ((ang * 180) / Math.PI) * car.u * gdt * 0.6 : 0;
    const done = attack.update(dt, car.x, car.z, pts);
    if (done) {
      splitEl.textContent = `ZONE ${done.zone + 1}  +${done.points.toLocaleString()}`;
      splitEl.className = done.points > 0 ? 'ahead' : 'behind';
      splitT = 2;
    }
    zoneRings.forEach((m, k) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      m.visible = k >= attack!.zone || attack!.phase === 'finished';
      mat.color.setHex(k === attack!.zone ? 0xff4fa8 : k < attack!.zone ? 0x4fffa0 : 0x6a5a8a);
      mat.opacity = k === attack!.zone ? 0.6 + 0.35 * Math.sin(performance.now() / 180) : 0.45;
    });
    if (was === 'running' && attack.phase === 'finished') {
      const score = attack.score;
      const rank = rankFor(score, attack.def.ranks);
      const best = loadAttackBest(venueId);
      const newBest = !best || score > best.score;
      if (newBest) saveAttackBest(venueId, { score, rank });
      attackResult = { score, rank, best, newBest, zones: attack.points.map(Math.round) };
      payout(ATTACK_PAY[rank], `drift attack ${rank}`);
    }
  }
  lostFlash = Math.max(0, lostFlash - dt);
  // The car on the ground. In the driver's-eye view the lean is damped to a third (a driver holds their head
  // level against it), so the passenger window doesn't tip into the ground mid-drift; the other views keep it.
  const fx = Math.sin(car.h);
  const fz = Math.cos(car.h);
  poseCar(player, car, ground, 1 - 0.65 * pov);
  body.visible = view !== 'bumper' || aiming || hipT > 0;
  turnWheels(player, car, gdt);
  // The brake lights (the pedal's down and it's slowing the car) and the reversing lamps.
  setLamps(player, { brake: (c.brake > 0 && car.u > 0.5) || (c.throttle > 0 && car.u < -0.5), reverse: car.gear === 0 });
  if (inBattle) {
    poseCar(rivalView, rivalCar, ground);
    turnWheels(rivalView, rivalCar, gdt);
    lampsByMotion(rivalView, rivalCar);
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
  const camHeld = freezeCam ? { p: camera.position.clone(), q: camera.quaternion.clone() } : null;
  placeCamera(dt, snapCam);
  snapCam = false;
  if (ride) {
    // The car's meshes hidden (its headlights stay, posed with it: they light the road ahead of the bike).
    carObj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) o.visible = false;
    });
    pov = 0;
    cabin.visible = false;
    cabinLight.intensity = 0;
    if (Math.abs(camera.fov - 66) > 0.05) {
      camera.fov = 66;
      camera.updateProjectionMatrix();
    }
    ride.pose(car, ground, gdt);
    ride.update(car, camera, { third: outside(view), aiming, aimYaw, aimPitch, orbitYaw, lookPitch }, gdt, dt, (x, z) => course.height(x, z));
    // A shot from Mack's gun: pellets from the muzzle at what's under the crosshair.
    for (let n = ride.newShots(); n > 0; n--) {
      camera.updateMatrixWorld();
      const aimPoint = shooting.pick(camera.position, camera.getWorldDirection(new THREE.Vector3())).point;
      const muzzle = ride.rig!.muzzle();
      const why = [drifting ? 'DRIFT' : '', 'SHOTGUN'].filter(Boolean).join(' ');
      const g = ride.rig!.gun;
      shooting.blast(muzzle, aimPoint.sub(muzzle), g.pellets ?? 1, g.spread ?? 0.01, drifting ? 2 : 1, why.replace('SHOTGUN', g.kind === 'pistol' ? 'PISTOL' : 'SHOTGUN'));
      shake = Math.max(shake, 0.35);
      if (aiming) aimPitch += 0.06;
      rideCross.fired();
    }
  }
  if (camHeld) {
    camera.position.copy(camHeld.p);
    camera.quaternion.copy(camHeld.q);
  }
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
  if (!(aiming || hipT > 0)) driveWindow = null;
  if (!ride && (aiming || trigger || hipT > 0)) {
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
    // (Mack's own arm swings from his shoulder: too near straight ahead and his gun's inside, at the windscreen.)
    const line = hisGun() && driver ? driverLine(rel, pitch, driver.outFrom) : { side: sideFor(rel, pitch), wait: nearestShot(rel, pitch) };
    side = line.side;
    // Off every window (the windscreen, behind on the left), the weapon waits at the nearest shot it has.
    const n = line.wait;
    const nd = new THREE.Vector3(Math.sin(n.rel) * Math.cos(n.pitch), Math.sin(n.pitch), Math.cos(n.rel) * Math.cos(n.pitch)).applyQuaternion(carObj.quaternion);
    const armAt = side ? aimPoint : head.clone().addScaledVector(nd, 20);
    driveAim = armAt;
    driveWindow = side ?? n.side;
    if (hisGun()) {
      // His gun, out of the window (the rig fires it; the shot itself is made below, from his muzzle).
      shooting.arm.visible = false;
      if (pulled && side && !fight.youOut && driver) {
        if (hip) hipT = 1.2;
        driver.fire();
      } else if (pulled) {
        blockedT = 0.9;
        if (hip) hipT = 1.2;
      }
    } else shooting.pose(carObj, armAt, side ?? n.side);
    if (!hisGun() && trigger && side && !fight.youOut) {
      if (hip) hipT = 1.2;
      const across = side === 'across';
      const mult = (drifting ? 2 : 1) * (across ? 1.5 : 1);
      const why = [drifting ? 'DRIFT' : '', across ? 'ACROSS' : '', hip ? 'HIP' : ''].filter(Boolean).join(' ');
      const carVel = new THREE.Vector3(Math.sin(car.h) * car.u + Math.cos(car.h) * car.w, 0, Math.cos(car.h) * car.u - Math.sin(car.h) * car.w);
      const kick = shooting.fire({ aimPoint, carVel, across, hip, slide: car.slide, speed: Math.hypot(car.u, car.w), mult, why }, !pulled);
      if (aiming) aimPitch += kick;
    } else if (!hisGun() && trigger && pulled) {
      blockedT = 0.9;
      if (hip) hipT = 1.2;
    }
    pulled = false;
  } else shooting.arm.visible = false;
  if (driver) {
    const out = !ride && (aiming || hipT > 0);
    // His gun to hand: the one the page has chosen.
    const want = shooting.weapon.id === 'pistol' ? 'pistol' : 'lever';
    if (driver.rig && driver.rig.kind !== want) driver.rig.setKind(want);
    // (His hands on the cabin's own wheel as it shows; his feet on the pedals as they're pressed.)
    driver.cabin = interior;
    driver.update(car, { raised: out && hisGun(), blocked: out && hisGun() && !side, window: out ? driveWindow : null, aimPoint: driveAim, pov, throttle: c.throttle, brake: c.brake, calm: calmDrive }, gdt, dt);
    // His shots: nine pellets from the muzzle at what's under the crosshair.
    for (let k = driver.newShots(); k > 0; k--) {
      camera.updateMatrixWorld();
      const aimPoint = shooting.pick(camera.position, camera.getWorldDirection(new THREE.Vector3())).point;
      const muzzle = driver.rig!.muzzle();
      const across = driveWindow === 'across';
      const mult = (drifting ? 2 : 1) * (across ? 1.5 : 1);
      const g = driver.rig!.gun;
      const pistol = g.kind === 'pistol';
      const why = [drifting ? 'DRIFT' : '', across ? 'ACROSS' : '', hip ? 'HIP' : '', pistol ? '' : 'SHOTGUN'].filter(Boolean).join(' ');
      const base = g.spread ?? 0.04;
      shooting.blast(muzzle, aimPoint.sub(muzzle), g.pellets ?? 1, base * (hip ? (pistol ? 6 : 1.25) : across ? (pistol ? 2.5 : 1.4) : 1), mult, why);
      shake = Math.max(shake, 0.3);
      if (aiming) aimPitch += 0.05;
    }
  }
  shooting.update(gdt);
  shooting.flashes?.update(gdt, camera.position);
  rivalShooting.flashes?.update(gdt, camera.position);
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
  if (!ride && hisGun() && driver?.rig) {
    const r = driver.rig;
    gunEl.innerHTML = `<div class="name">${r.gun.label ?? ''}</div><div class="ammo">${r.shells === 0 ? 'reloading…' : '▮'.repeat(r.shells) + '▯'.repeat(Math.max(0, r.gun.shells - r.shells))}</div><small>F ${WEAPONS[(shooting.weaponIndex + 1) % WEAPONS.length].label} · E reload · T clean targets</small>`;
  }
  rideCross.update(!!ride?.rig?.armed && !menuOpen, ride?.rig?.aim ?? 0, dt);
  if (ride) {
    reticle.style.display = 'none';
    focusEl.style.display = 'none';
    const r = ride.rig;
    gunEl.style.display = armed ? 'block' : 'none';
    gunEl.innerHTML = r?.armed
      ? `<div class="name">${r.gun.label ?? ''}</div><div class="ammo">${'▮'.repeat(r.shells)}${'▯'.repeat(Math.max(0, r.gun.shells - r.shells))}</div><small>X put away · E reload · T clean targets</small>`
      : `<div class="name">Hands on the bars</div><small>X draw the ${r?.gun.kind === 'pistol' ? 'pistol' : 'shotgun'}</small>`;
  }
  if (inBattle) drawBattleHud(dt);
  slowEl.style.opacity = (slow * 0.9).toFixed(3);
  sound.update(dt, { rev: car.rev, gear: car.gear, throttle: c.throttle, speed: Math.hypot(car.u, car.w), slide: car.slide, spin: car.spin, bump: car.bump, boost: car.boost, turbo: !!car.spec.turbo });
  // HUD.
  const kmh = Math.round(Math.abs(car.u) * 3.6);
  speedo.innerHTML = `<div class="kmh">${kmh}<span>km/h</span></div><div class="gear">${car.gear === 0 ? 'R' : car.gear}</div><div class="rev"><i style="width:${Math.round(car.rev * 100)}%"></i></div>`;
  driftEl.innerHTML = chain > 0 || lostFlash > 0
    ? `<div class="angle">${Math.round((ang * 180) / Math.PI)}°</div><div class="chain ${lostFlash > 0 ? 'lost' : ''}">${lostFlash > 0 ? 'CHAIN LOST' : `+${Math.round(chain).toLocaleString()}`}</div><div class="mult">×${Math.min(4, 1 + chainT * 0.3).toFixed(1)}</div>`
    : `<div class="total">DRIFT ${total.toLocaleString()}<br><small>best chain ${bestChain.toLocaleString()}</small></div>`;
  drawTrialHud(dt);
  payT = Math.max(0, payT - dt);
  payEl.style.opacity = Math.min(1, payT * 2).toFixed(2);
  toastT = Math.max(0, toastT - dt);
  helpEl.style.display = help || toastT > 0 ? 'block' : 'none';
  if (toastT > 0) helpEl.textContent = toastText;
  else if (helpEl.textContent !== HELP) helpEl.textContent = HELP;
  hud.textContent = `${course.def.name} · ${course.def.atmosphere.label} · ${kind === 'gp' ? `race, ${course.def.circuit!.laps} laps · Enter to start again` : kind === 'drift' ? 'drift attack · Enter to start again' : mode === 'free' ? `free drive · ${here === 'lot' ? (course.def.kind === 'wharf' ? 'the wharf' : 'practice lot') : here === 'top' ? 'the viewpoint' : course.loop ? 'the circuit' : 'the pass'}` : kind === 'battle' ? `⚔ battle, ${arms === 'gun' ? 'real guns' : 'paintball'} ${dir === 'up' ? '▲ uphill' : '▼ downhill'}` : `time trial ${mode === 'up' ? '▲ uphill' : '▼ downhill'}${best ? ` · best ${clock(best.time)}` : ''}`} · ${ride ? ride.def.name : mineModel.name} · ${yen(profile.yen)} · M venues`;
  // The rear-view mirror's picture (without Mack: the mirror looks back past him).
  if (cabin.visible && !ride) {
    interior.update({ steer: car.steer, ax: car.ax, ay: car.ay, kmh: Math.hypot(car.u, car.w) * 3.6, rpm: 900 + car.rev * (mineModel.sound.maxRpm - 900), gear: car.gear, throttle: c.throttle, brake: c.brake, handbrake: car.handbrake, lamps: 1, bump: car.bump, boost: car.spec.turbo ? car.boost : undefined }, gdt);
    mirror.render(renderer, scene, interior.mirror, camera.position, driver?.rig ? [driver.rig.object] : []);
  }
  composer.render(dt);
  snap.afterRender();
  requestAnimationFrame(frame);
}
// F9: a snapshot and a note for reporting an issue (debug/snap.ts, saved to debug-shots/).
const snap = installSnap(renderer.domElement, 'race', () => ({
  venue: venueId,
  mode,
  car: mineModel.name,
  at: [car.x, car.y, car.z].map((v) => Math.round(v * 10) / 10),
  heading: Math.round((car.h * 180) / Math.PI),
  kmh: Math.round(car.speed * 3.6),
  gear: car.gear,
}));
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
  ride: () => ride,
  driver: () => driver,
  /** Checks only: hold the camera where a script put it. */
  set calm(on: boolean) {
    calmDrive = on;
  },
  set freezeCam(on: boolean) {
    freezeCam = on;
  },
  view: (v: DriveViewId): void => {
    view = v;
  },
  interior,
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
  gp: () => gp,
  battle: () => ({ fight, battleResult, rival: rivalCar, rivalTrial, rivalShooting }),
  trigger: (on: boolean): void => {
    trigger = on;
    pulled = on;
  },
};
