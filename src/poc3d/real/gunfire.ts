import * as THREE from 'three';
import type { FirstPersonRig } from '../models/firstPerson';
import { MeleeSound } from '../models/meleeSound';
import { MuzzleFlashes } from '../models/muzzleFlash';
import { GunSound } from '../../race/gunSound';
import type { GunVoice } from '../../race/gunVoices';
import { castVolumes, type BodyHit } from '../../race/shooting';
import type { ScreenLight } from './screenLight';
import { CarHits, type CarHit } from './carHits';

/**
 * Shots in the city: each pellet (or the pistol's bullet) is marched from the muzzle
 * against the district (`District.shotProbe`, gathered once a shot along its line: walls to each building's
 * height, the ground and floors, parked cars, poles and hedges) and the traffic, and where it lands it leaves a mark (a hole on a wall or the ground),
 * kicks up dust and chips, or throws sparks off metal. The blast (models/meleeSound.ts) or the pistol's crack
 * (race/gunSound.ts) and the impacts are heard from where they are. The mob and the traffic carry on.
 *
 * On foot and on a bike the shots are Mack's rig's, along its bore (`update`). From a car (district/carGun.ts) and
 * from the cars that come after you (district/chaseCar.ts) they're made with `shot`: from a muzzle toward a point,
 * with a tracer. Cars in a chase can be struck where it matters (`bodies`: race/carView.ts' hit
 * volumes, the body, the glass, the tyres, the heads inside; `onBody` says what was hit).
 *
 * Every shot has a muzzle flash (models/muzzleFlash.ts: small, ragged, a frame or two), a wisp of smoke, a spent
 * case thrown out to the right, and at night for a moment lights what's in front of the gun a little: `light` is the newest flash as one of the screens' lights
 * (real/screenLight.ts: the city shader already has those, so nothing recompiles as a light of its own would).
 */

/** What a shot meets at a point (world): see District.shotAt; 'car' also for traffic. */
export type ShotProbe = (x: number, y: number, z: number) => 'ground' | 'wall' | 'car' | 'pole' | 'soft' | null;
/** A probe for points near the line from (ax, az) to (bx, bz), within `pad` of it (District.shotProbe). */
export type ShotProbes = (ax: number, az: number, bx: number, bz: number, pad: number) => ShotProbe;

/** A shot made for a shooter that isn't the rig on foot: from `muzzle` along `dir`. */
export interface CityShot {
  readonly muzzle: THREE.Vector3;
  readonly dir: THREE.Vector3;
  /** The cone's half-angle (rad), the pellets in it (1: a bullet), how far it carries. */
  readonly spread: number;
  readonly pellets?: number;
  readonly range?: number;
  /** Its sound: the pistol's crack or the shotgun's blast. */
  readonly sound: 'pistol' | 'blast';
  /** Where it's heard from. */
  readonly listener: THREE.Vector3;
  /** The car hit volumes it can strike (default: `CityGunfire.bodies`, the cars you're up against). */
  readonly bodies?: readonly THREE.Object3D[];
  /** Fired from your own car, or at it: its place in the traffic isn't in the way (its hit volumes are, if listed). */
  readonly skipOwn?: boolean;
  /** Who fired, passed on to `onBody`. */
  readonly by?: string;
  /** The shooter's own velocity (m/s): the flash and the spent case go with it. */
  readonly vel?: THREE.Vector3;
}

/** What a ray met: the point, and what's there (a car's hit volume, or the world's). */
export interface ShotMet {
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly what: 'ground' | 'wall' | 'car' | 'pole' | 'soft' | 'body';
  readonly body: BodyHit | null;
  readonly distance: number;
}

/** How far a pellet and a bullet carry (m), and the march's step. */
const PELLET_RANGE = 90;
const BULLET_RANGE = 220;
const STEP = 0.5;
const MAX_PARTICLES = 600;
const MAX_MARKS = 240;
/** Tracers shown at once, and how long each lasts (s). (A pistol's bullet isn't a line of light: the streak is faint, a frame or two, just enough to tell which way a shot went.) */
const TRACERS = 10;
const TRACER_LIFE = 0.035;
/** A flash's light on what's in front of the gun, as a screen's (real/screenLight.ts): its colour at full strength (before the screens' gain), and half its side (m: a wide soft source, so what's right by the gun isn't burnt out). */
const FLASH_LIGHT = new THREE.Color(0.04, 0.028, 0.013);
const FLASH_HALF = 0.6;
const UP = new THREE.Vector3(0, 1, 0);

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  t: number;
  life: number;
  size: number;
  r: number;
  g: number;
  b: number;
  /** Falls under gravity (chips, sparks) or drifts and slows (dust). */
  heavy: boolean;
  /** How thick it is at most (0-1; 1 without it): gun smoke is thin. */
  thin?: number;
}

const pointsVert = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * 900.0 / max(0.3, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const pointsFrag = /* glsl */ `
  varying vec4 vColor;
  uniform float uSoft;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = mix(1.0, 1.0 - d * d, uSoft);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }
`;

/** A pool of points (dust or sparks) drawn in one go. */
class Particles {
  readonly points: THREE.Points;
  private readonly list: Particle[] = [];
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly col = new Float32Array(MAX_PARTICLES * 4);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly geo = new THREE.BufferGeometry();

  constructor(additive: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: pointsVert,
      fragmentShader: pointsFrag,
      uniforms: { uSoft: { value: additive ? 1 : 0.8 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.name = additive ? 'gunfire:sparks' : 'gunfire:dust';
  }

  add(p: Particle): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const q = this.list[i];
      q.t += dt;
      if (q.t >= q.life) {
        this.list.splice(i, 1);
        continue;
      }
      if (q.heavy) q.v.y -= 9.8 * dt;
      else q.v.multiplyScalar(Math.max(0, 1 - dt * 3)).add(new THREE.Vector3(0, 0.25 * dt, 0));
      q.p.addScaledVector(q.v, dt);
    }
    for (const q of this.list) {
      const k = q.t / q.life;
      this.pos.set([q.p.x, q.p.y, q.p.z], n * 3);
      // Dust grows as it thins; sparks shrink as they cool.
      const a = (q.heavy ? 1 - k : (1 - k) * (1 - k) * 0.55) * (q.thin ?? 1);
      this.col.set([q.r, q.g, q.b, a], n * 4);
      this.size[n] = q.heavy ? q.size * (1 - k * 0.6) : q.size * (1 + k * 2.5);
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aSize']) {
      const at = this.geo.getAttribute(name) as THREE.BufferAttribute;
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * at.itemSize);
      at.needsUpdate = true;
    }
  }
}

/** A hole's look: a dark centre with chipped, lighter edges, cut out round. */
function holeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(8,7,6,1)');
  grad.addColorStop(0.32, 'rgba(18,16,14,0.95)');
  grad.addColorStop(0.45, 'rgba(120,112,100,0.55)');
  grad.addColorStop(1, 'rgba(120,112,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Chips round the rim.
  g.fillStyle = 'rgba(30,27,24,0.8)';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.6;
    g.beginPath();
    g.ellipse(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, 4, 1.6, a, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CityGunfire {
  readonly group = new THREE.Group();
  private readonly dust = new Particles(false);
  private readonly sparks = new Particles(true);
  private readonly marks: THREE.InstancedMesh;
  private nextMark = 0;
  private readonly blastSound = new MeleeSound();
  private readonly gunSound = new GunSound();
  private seen = 0;
  private wasReloading = false;

  /** For a shader warm-up: the tracers and the flashes, drawn only while they last, shown so their shaders compile, or put away. */
  warm(on: boolean): void {
    this.tracers.visible = on;
    this.flashes.warm(on);
  }

  /** The probe for the shot being made, and whether your own car's place in the traffic is left out of it. */
  private probe: ShotProbe = () => null;
  private skipOwn = false;
  /** The cars your shots can strike (their hit volumes), and what to do when a shot strikes one (`by`: who fired). */
  readonly bodies: THREE.Object3D[] = [];
  onBody: ((h: BodyHit, by: string | undefined) => void) | null = null;
  /** Bullet marks on cars (holes, cracked and broken glass), the moving car at a point a shot met (the page's: the traffic's, and yours unless `skipOwn`), and what to do when one is struck. */
  readonly carHits = new CarHits();
  carAt: ((x: number, y: number, z: number, skipOwn: boolean) => THREE.Object3D | null) | null = null;
  onCarHit: ((car: THREE.Object3D, hit: CarHit, by: string | undefined) => void) | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly tracers: THREE.LineSegments;
  private readonly tracerLife = new Float32Array(TRACERS);
  private nextTracer = 0;
  private readonly flashes = new MuzzleFlashes();
  /** How dark it is (0 broad day, 1 night: the page's street lamps): by day a flash is thin and lights nothing. */
  dark = 1;
  /** The newest muzzle flash as a light for the city (add it to the page's `ScreenLights`): on only while it lasts. */
  readonly light: ScreenLight & { on(): boolean };

  constructor(
    private readonly probes: ShotProbes,
    /** A vehicle in traffic at (x, y, z), if any (`skipOwn`: not counting your own car). */
    private readonly vehicleAt: (x: number, y: number, z: number, skipOwn: boolean) => boolean,
  ) {
    this.group.name = 'gunfire';
    const mat = new THREE.MeshStandardMaterial({ map: holeTexture(), transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX_MARKS);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.name = 'gunfire:marks';
    // Tracers: bright lines that fade in a few frames (their colour is their brightness: additive).
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACERS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRACERS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.tracers.visible = false;
    this.tracers.name = 'gunfire:tracers';
    this.group.add(this.dust.points, this.sparks.points, this.marks, this.tracers, this.flashes.group);
    const F = this.flashes;
    this.light = {
      centre: F.at,
      normal: new THREE.Vector3(0, 0, 1),
      halfW: FLASH_HALF,
      halfH: FLASH_HALF,
      on: () => F.strength > 0.01,
      colour: (_t, _neon, out) => out.copy(FLASH_LIGHT).multiplyScalar(F.strength),
    };
  }

  /** Start the sounds (from a click or a key). */
  resume(): void {
    this.blastSound.resume();
    this.gunSound.start();
  }

  /** Per frame: makes any shots the rig fired since the last call (it can fire inside its update, swinging
   * down first), and moves the dust and sparks. The camera is where you hear from and where you look. */
  update(rig: FirstPersonRig | null, camera: THREE.Camera, dt: number): void {
    if (rig && rig.shotsFired !== this.seen) {
      const n = rig.shotsFired - this.seen;
      this.seen = rig.shotsFired;
      if (n > 0) this.shoot(rig, camera.position, camera.getWorldDirection(new THREE.Vector3()));
    }
    // A reload: heard as it starts.
    const reloading = !!rig?.reloading;
    if (reloading && !this.wasReloading && rig) this.gunSound.play([{ kind: rig.kind === 'pistol' ? 'magazine' : 'reload', at: rig.muzzle() }], camera.position);
    this.wasReloading = reloading;
    this.dust.update(dt);
    this.sparks.update(dt);
    // Tracers and flashes fade.
    const col = this.tracers.geometry.getAttribute('color') as THREE.BufferAttribute;
    let lit = false;
    for (let i = 0; i < TRACERS; i++) {
      if (this.tracerLife[i] <= 0) continue;
      this.tracerLife[i] = Math.max(0, this.tracerLife[i] - dt);
      const k = this.tracerLife[i] / TRACER_LIFE;
      col.setXYZ(i * 2, 0.3 * k, 0.27 * k, 0.22 * k);
      col.setXYZ(i * 2 + 1, 0.06 * k, 0.055 * k, 0.05 * k);
      lit = true;
    }
    if (lit) col.needsUpdate = true;
    this.tracers.visible = lit;
    this.flashes.dark = this.dark;
    this.flashes.update(dt, camera.position);
    // (A screen's light faces level: the way the gun points, on the map.)
    const d = this.flashes.dir;
    if (Math.hypot(d.x, d.z) > 0.05) this.light.normal.set(d.x, 0, d.z).normalize();
    // (The city draws the flash: the rig's own plain one is for the pages without this.)
    if (rig) rig.ownFlash = false;
  }

  /** A shot's flash, its smoke and its spent case (a speck of brass thrown out to the right of the bore and up). */
  private muzzleBlast(muzzle: THREE.Vector3, bore: THREE.Vector3, size: number, puffs: number, vel?: THREE.Vector3): void {
    this.flashes.fire(muzzle, bore, size, vel);
    for (let i = 0; i < puffs; i++)
      this.dust.add({ p: muzzle.clone().addScaledVector(bore, 0.15 + i * 0.12), v: bore.clone().multiplyScalar(2 + Math.random() * 3).add(rand(0.6)), t: 0, life: 0.5 + Math.random() * 0.5, size: 0.02, r: 0.66, g: 0.65, b: 0.63, heavy: false, thin: 0.4 });
    const right = new THREE.Vector3().crossVectors(bore, UP).normalize();
    const v = right.multiplyScalar(1.6 + Math.random() * 0.9).add(new THREE.Vector3(0, 1.5 + Math.random() * 0.8, 0)).addScaledVector(bore, -0.4 + Math.random() * 0.5);
    if (vel) v.add(vel);
    this.dust.add({ p: muzzle.clone().addScaledVector(bore, -0.13), v, t: 0, life: 0.7, size: 0.006, r: 0.62, g: 0.47, b: 0.2, heavy: true });
  }

  /**
   * What's along a ray from `origin` within `range`: the nearest of the district, the traffic and the hit volumes
   * (`bodies`), or null. (For the crosshair: what you'd hit.)
   */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, range = BULLET_RANGE, bodies: readonly THREE.Object3D[] = this.bodies, skipOwn = false): ShotMet | null {
    this.skipOwn = skipOwn;
    this.probe = this.probes(origin.x, origin.z, origin.x + dir.x * range, origin.z + dir.z * range, 1);
    return this.cast(origin, dir, range, bodies, 2);
  }

  /** A shot from a muzzle along a direction (a car's gun, yours or theirs): returns what its first pellet met. */
  shot(s: CityShot): ShotMet | null {
    const pellets = s.pellets ?? 1;
    const range = s.range ?? (pellets > 1 ? PELLET_RANGE : BULLET_RANGE);
    const bore = s.dir.clone().normalize();
    if (s.sound === 'pistol') this.gunSound.play([{ kind: 'pistol', at: s.muzzle }], s.listener);
    else this.blast(s.muzzle, s.listener);
    this.muzzleBlast(s.muzzle, bore, pellets > 1 ? 1.8 : 1, 2, s.vel);
    this.skipOwn = !!s.skipOwn;
    this.probe = this.probes(s.muzzle.x, s.muzzle.z, s.muzzle.x + bore.x * range, s.muzzle.z + bore.z * range, range * s.spread * 2.5 + 1);
    const bodies = s.bodies ?? this.bodies;
    const heard: THREE.Vector3[] = [];
    let first: ShotMet | null = null;
    for (let i = 0; i < pellets; i++) {
      const dir = bore.clone().add(rand(2 * s.spread)).normalize();
      const hit = this.cast(s.muzzle, dir, range, bodies);
      if (i === 0) {
        first = hit;
        this.tracer(s.muzzle, hit ? hit.point : s.muzzle.clone().addScaledVector(dir, range));
      }
      if (!hit) continue;
      if (hit.body) {
        const car = hit.body.object.parent;
        if (!car || hit.body.object.userData.part === 'head' || !this.intoCar(car, s.muzzle, dir, s.by)) this.spark(hit.point, hit.normal, dir, 10);
        this.onBody?.(hit.body, s.by);
      } else if (hit.what !== 'car' || !this.trafficCar(hit.point, s.muzzle, dir, s.by, !!s.skipOwn)) this.impact(hit.point, hit.normal, hit.what as 'ground', dir);
      if (!heard.some((h) => h.distanceTo(hit.point) < 1.2)) {
        heard.push(hit.point);
        this.gunSound.play([{ kind: hit.body || hit.what === 'car' || hit.what === 'pole' ? 'clang' : 'ground', at: hit.point }], s.listener);
      }
    }
    return first;
  }

  /** The nearest thing along a ray: a car's hit volume, or the world (marched at `coarse` times the usual step). */
  private cast(o: THREE.Vector3, d: THREE.Vector3, range: number, bodies: readonly THREE.Object3D[], coarse = 1): ShotMet | null {
    const body = castVolumes(this.ray, bodies, o, d, range);
    const world = this.march(o, d, body ? body.distance : range, coarse);
    if (world) return { point: world.point, normal: world.normal, what: world.what, body: null, distance: world.point.distanceTo(o) };
    if (body) return { point: body.point, normal: body.normal, what: 'body', body, distance: body.distance };
    return null;
  }

  private tracer(a: THREE.Vector3, b: THREE.Vector3): void {
    const i = this.nextTracer;
    this.nextTracer = (i + 1) % TRACERS;
    const pos = this.tracers.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(i * 2, a.x, a.y, a.z);
    pos.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    this.tracerLife[i] = TRACER_LIFE;
  }

  /** Sparks off metal at p. */
  private spark(p: THREE.Vector3, n: THREE.Vector3, dir: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const v = n.clone().multiplyScalar(2 + Math.random() * 3).add(rand(3)).addScaledVector(dir, -1);
      this.sparks.add({ p: p.clone(), v, t: 0, life: 0.2 + Math.random() * 0.25, size: 0.012 + Math.random() * 0.01, r: 3, g: 2.1, b: 0.8, heavy: true });
    }
  }

  /** A round into a car: its mark on the car's own skin (real/carHits.ts), sparks, bits of glass. False if it passed the skin by. */
  private intoCar(car: THREE.Object3D, origin: THREE.Vector3, dir: THREE.Vector3, by: string | undefined): boolean {
    const h = this.carHits.strike(car, origin, dir);
    if (!h) return false;
    this.spark(h.point, h.normal, dir, h.pane ? 3 : 8);
    for (let i = h.pane ? (h.shattered ? 30 : 7) : 0; i > 0; i--)
      this.dust.add({ p: h.point.clone().add(rand(h.shattered ? 0.22 : 0.03)), v: h.normal.clone().multiplyScalar(0.4 + Math.random() * 2).add(rand(1.4)), t: 0, life: 0.5 + Math.random() * 0.4, size: 0.004 + Math.random() * 0.006, r: 0.78, g: 0.86, b: 0.88, heavy: true });
    this.onCarHit?.(car, h, by);
    return true;
  }

  /** A round that met a car in the street (the traffic's, or yours): marked on that car, so it rides with it. False for a parked one (it's scenery). */
  private trafficCar(at: THREE.Vector3, origin: THREE.Vector3, dir: THREE.Vector3, by: string | undefined, skipOwn: boolean): boolean {
    const car = this.carAt?.(at.x, at.y, at.z, skipOwn);
    if (!car) return false;
    if (!this.intoCar(car, origin, dir, by)) this.spark(at, dir.clone().negate(), dir, 6);
    return true;
  }

  /** The shotgun's shot: a recording, or (none loaded, or 'synth' chosen) the synthesised blast. */
  private blast(muzzle: THREE.Vector3, listener: THREE.Vector3): void {
    if (this.gunSound.recordedShotgun) this.gunSound.play([{ kind: 'shotgun', at: muzzle }], listener);
    else this.blastSound.blast();
  }

  /** Which recordings the pistol and the shotgun are, the guns' level (1 as built) and a recorded shot's street echo (0-1): race/gunSound.ts. */
  setSound(voice: GunVoice, level: number, echo: number, shotgun: 'a' | 'b' | 'synth' = 'a'): void {
    this.gunSound.voice = voice;
    this.gunSound.shotgunVoice = shotgun;
    this.gunSound.setLevel(level, echo);
  }

  /** Slow motion (0-1): the shots' sounds drop with it. */
  setSlow(k: number): void {
    this.gunSound.setSlow(k);
  }

  /** Forget shots fired before now (a new rig took over: its count starts again). */
  sync(rig: FirstPersonRig): void {
    this.seen = rig.shotsFired;
  }

  private shoot(rig: FirstPersonRig, listener: THREE.Vector3, view: THREE.Vector3): void {
    const gun = rig.gun;
    const muzzle = rig.muzzle();
    const out = rig.boreDir();
    // Raised, the gun points at what's under the crosshair: along the bore. From the hip (carried muzzle down) the
    // shot goes where you look, as on the race page, with twice the spread.
    const raised = rig.aim > 0.9;
    const bore = raised ? out : view;
    const pellets = gun.pellets ?? 1;
    const spread = (gun.spread ?? 0.01) * (raised ? 1 : 2);
    if (gun.kind === 'pistol') this.gunSound.play([{ kind: 'pistol', at: muzzle }], listener);
    else {
      this.blast(muzzle, listener);
      if (gun.lever) this.gunSound.play([{ kind: 'lever', at: muzzle }], listener);
    }
    this.muzzleBlast(muzzle, out, pellets > 1 ? 1.8 : 1, 4);
    const range = pellets > 1 ? PELLET_RANGE : BULLET_RANGE;
    this.skipOwn = false;
    this.probe = this.probes(muzzle.x, muzzle.z, muzzle.x + bore.x * range, muzzle.z + bore.z * range, range * spread * 2.5 + 1);
    const heard: THREE.Vector3[] = [];
    for (let i = 0; i < pellets; i++) {
      const dir = bore.clone().add(rand(2 * spread)).normalize();
      const hit = this.cast(muzzle, dir, range, this.bodies);
      if (!hit) continue;
      if (hit.body) {
        const car = hit.body.object.parent;
        if (!car || hit.body.object.userData.part === 'head' || !this.intoCar(car, muzzle, dir, undefined)) this.spark(hit.point, hit.normal, dir, pellets > 1 ? 4 : 10);
        this.onBody?.(hit.body, undefined);
      } else if (hit.what !== 'car' || !this.trafficCar(hit.point, muzzle, dir, undefined, false)) this.impact(hit.point, hit.normal, hit.what as 'ground', dir);
      // One impact sound per spot, not one per pellet.
      if (!heard.some((h) => h.distanceTo(hit.point) < 1.2)) {
        heard.push(hit.point);
        this.gunSound.play([{ kind: hit.body || hit.what === 'car' || hit.what === 'pole' ? 'clang' : 'ground', at: hit.point }], listener);
      }
    }
  }

  /** Along the ray to the first thing it meets, bisected to its surface, with the surface's normal. */
  private march(o: THREE.Vector3, d: THREE.Vector3, range: number, coarse = 1): { point: THREE.Vector3; normal: THREE.Vector3; what: 'ground' | 'wall' | 'car' | 'pole' | 'soft' } | null {
    const at = (s: number): ReturnType<ShotProbe> => {
      const x = o.x + d.x * s;
      const y = o.y + d.y * s;
      const z = o.z + d.z * s;
      return this.probe(x, y, z) ?? (this.vehicleAt(x, y, z, this.skipOwn) ? 'car' : null);
    };
    let prev = 0;
    for (let s = STEP * coarse; s <= range; s += STEP * coarse) {
      const what = at(s);
      if (!what) {
        prev = s;
        continue;
      }
      let a = prev;
      let b = s;
      for (let k = 0; k < 6; k++) {
        const m = (a + b) / 2;
        if (at(m)) b = m;
        else a = m;
      }
      const point = o.clone().addScaledVector(d, a);
      return { point, normal: this.normalAt(point, d, what), what };
    }
    return null;
  }

  /** The way out of the surface at p (just outside it): the ground's up, a wall's open side along x or z. */
  private normalAt(p: THREE.Vector3, d: THREE.Vector3, what: string): THREE.Vector3 {
    if (what === 'ground') return new THREE.Vector3(0, 1, 0);
    const e = 0.12;
    const tries = [
      new THREE.Vector3(-Math.sign(d.x) || 1, 0, 0),
      new THREE.Vector3(0, 0, -Math.sign(d.z) || 1),
      new THREE.Vector3(0, 1, 0),
    ].sort((u, v) => Math.abs(v.dot(d)) - Math.abs(u.dot(d)));
    for (const n of tries) {
      const q = p.clone().addScaledVector(d, e).addScaledVector(n, e * 2);
      if (!this.probe(q.x, q.y, q.z) && !this.vehicleAt(q.x, q.y, q.z, this.skipOwn)) return n;
    }
    return d.clone().negate();
  }

  private impact(p: THREE.Vector3, n: THREE.Vector3, what: 'ground' | 'wall' | 'car' | 'pole' | 'soft', dir: THREE.Vector3): void {
    const metal = what === 'car' || what === 'pole';
    if (metal) this.spark(p, n, dir, 6);
    if (what !== 'soft') {
      // Chips and a puff of dust off the surface (leaves off a hedge).
      for (let i = 0; i < (metal ? 1 : 4); i++)
        this.dust.add({ p: p.clone().addScaledVector(n, 0.05), v: n.clone().multiplyScalar(0.8 + Math.random() * 1.2).add(rand(0.6)), t: 0, life: 0.8 + Math.random() * 0.8, size: 0.08 + Math.random() * 0.06, r: 0.36, g: 0.34, b: 0.32, heavy: false });
      for (let i = 0; i < (metal ? 0 : 3); i++)
        this.dust.add({ p: p.clone().addScaledVector(n, 0.02), v: n.clone().multiplyScalar(2 + Math.random() * 2).add(rand(2)), t: 0, life: 0.5 + Math.random() * 0.4, size: 0.02, r: 0.25, g: 0.23, b: 0.21, heavy: true });
    } else {
      for (let i = 0; i < 4; i++)
        this.dust.add({ p: p.clone(), v: rand(1.5).add(new THREE.Vector3(0, 0.6, 0)), t: 0, life: 0.9 + Math.random() * 0.6, size: 0.014, r: 0.12, g: 0.2, b: 0.08, heavy: true });
      return;
    }
    // A hole (not on cars in traffic: they drive off with it).
    if (what === 'car' && this.vehicleAt(p.x - n.x * 0.05, p.y - n.y * 0.05, p.z - n.z * 0.05, this.skipOwn)) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * Math.PI * 2));
    const s = 0.05 + Math.random() * 0.03;
    m.compose(p.clone().addScaledVector(n, 0.012), q, new THREE.Vector3(s, s, s));
    this.marks.setMatrixAt(this.nextMark, m);
    this.nextMark = (this.nextMark + 1) % MAX_MARKS;
    this.marks.count = Math.min(MAX_MARKS, this.marks.count + 1);
    this.marks.instanceMatrix.needsUpdate = true;
  }
}

function rand(k: number): THREE.Vector3 {
  return new THREE.Vector3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
}
