import { Terrain } from './terrain';
import * as THREE from 'three';
import { wheelLayout } from '../models/vehicles';
import { model, tunedSpec } from '../../race/catalog';
import { buildCar, poseCar, setLamps, turnWheels, type CarView } from '../../race/carView';
import { CarInterior } from '../models/carInterior';
import { Dents } from '../../race/dents';
import { currentCar, loadProfile, saveProfile } from '../../race/profile';
import { CarSound } from '../../race/sound';
import { Car, ROAD_ASSISTS, type Assists, type CarSpec, type Controls, type Ground } from '../../race/vehicle';
import type { DrivenVehicle, TrafficSystem } from '../real/traffic';
import type { Expressway } from './expressway';
import { DRY, weatherAfter, weatherBefore, weatherGrip, type RoadWeather } from './roadGrip';
import { assistsBy, loadTuning, tunedBy, type Tuning } from '../../race/tuning';
import { BIKES, type BikeId } from '../../race/bikeRide';
import {
  DIRECT,
  impactDamage,
  newParts,
  NUDGE,
  overall,
  partsOf,
  passThrough,
  powerLeft,
  scrapeDamage,
  sectionsAt,
  totaled,
  tyreGrip,
  tyrePull,
  WRECKED,
  type HitKind,
  type Parts,
  type Section,
} from './crash';

/** Something on the expressway your car can run into (a car in its traffic). */
export interface DeckObstacle {
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
  readonly half: number;
  readonly hw: number;
}

/**
 * Your own car in the city: the one you're driving in the garage (race/profile.ts), with its paint, livery,
 * neon and tuning, on the racing handling model (race/vehicle.ts) with calmer road assists. It joins the
 * traffic as a parked vehicle (traffic stops behind it and honks; E by it takes the wheel), and it stays where
 * you leave it (localStorage `citypop.city.car`; at first, and after ?car=home, in its bay at the garage).
 *
 * The racing model wants a Ground. On the street: height 0, and what's in the way from `probe` (crash.ts:
 * a wall, a car, a pole, something soft or a person). Crashing is forgiving (crash.ts): walls and people stop
 * the car, pushed back against its travel and losing only the speed into them (at an angle you slide along a
 * wall at speed); a car or a pole stops it only when the nose meets it head-on at speed, and anything else you
 * drive through, losing some speed. On the expressway (district/expressway.ts): its height, its parapets
 * (walls) and the cars in its traffic (`deckObstacles`).
 *
 * Damage goes to the part that took it (`parts`: front, rear, sides, tyres), shows on the car (the body
 * crumples and scrapes there; a flat tyre drops its corner and a damaged one wobbles), is listed for the HUD
 * (`hits`), costs power (the front) and grip (the tyres), and is kept with the car in the profile; a totalled
 * car won't go (`onTotaled`; the garage repairs it).
 *
 * Its lights are the page's to switch (`lamps`: the headlamps and tail lamps, with the brake lights and reversing
 * lamps from how it's driven; `beam`: where they shine from, for the city shader); parked, they're off.
 *
 * Or your motorcycle (`bike`: race/bikeRide.ts' BIKES): the same model, ground and crashing, its own spec and
 * saved spot (`citypop.city.bike`); no dents or damage yet; the page draws it and its rider (`onPose`).
 */

/** The city: road assists, but with room to slide (the expressway's long bends). */
export const CITY_ASSISTS: Assists = { ...ROAD_ASSISTS, maxSlide: (38 * Math.PI) / 180 };

const SAVE_KEY = 'citypop.city.car';
const BIKE_SAVE_KEY = 'citypop.city.bike';
/** The car's centre line is probed with small circles (what can stop it), its sides with more (drive through). */
const CL = 0.35;
const SIDE = 0.55;
const HL = 2.15;
const HW = 0.85;
/** Sliding along a wall keeps nearly all your speed. */
const WALL_FRICTION = 0.998;
const DIRS = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)] as const);

export class OwnCar {
  /** The car's spec with its parts (before the driving tuning). */
  readonly baseSpec: CarSpec;
  /** A new driving tuning (race/tuning.ts): re-spec the car and its assists. */
  retune(t: Tuning): void {
    this.sim.spec = tunedBy(this.baseSpec, t);
    this.sim.assists = assistsBy(CITY_ASSISTS, 'road', t);
  }
  /** The weather on the road (main.ts sets it each frame; district/roadGrip.ts). */
  weather: RoadWeather = DRY;
  /** How much water the wheels are in now (0-1). */
  water = 0;
  readonly sim: Car;
  readonly view: CarView;
  /** How to fit its cabin (models/carInterior.ts), built the first time it's wanted; a bike has none. */
  private readonly cabinFor: (() => CarInterior) | null;
  private cabin: CarInterior | null = null;
  readonly vehicle: DrivenVehicle;
  readonly ground: Ground;
  readonly name: string;
  readonly sound = new CarSound();
  private saveT = 0;
  /** Damage by part (0 whole to 100 gone), and which owned car this is (for keeping it). */
  readonly parts: Parts;
  private readonly carId: string;
  /** Where the wheels are along the car (rear, front), for which tyre a hit catches. */
  private readonly wheelAlong: [number, number];
  /** What stopped the car this step and where on it (car frame: along forward, across to the left). */
  private contact: { kind: HitKind; along: number; across: number; nx: number; nz: number } | null = null;
  /** What the car was driving through last frame (the knock is on the way in, once per kind of thing). */
  private touching = new Set<HitKind>();
  /** Damage taken, by part, since the HUD last took them (it empties this). */
  readonly hits: { part: Section; amount: number }[] = [];
  /** A knock this frame for the sound and the camera (m/s). */
  knock = 0;
  /** The brake pedal's down and slowing the car (the brake lights), as last driven. */
  braking = false;
  onTotaled: (() => void) | null = null;
  /** Engine smoke from a smashed front (world space: add it to the scene). */
  readonly smoke: THREE.Points;
  private readonly smokePos: Float32Array;
  private readonly smokeLife: Float32Array;
  private smokeNext = 0;
  /** The damage showing on the car (race/dents.ts), redone when it changes. */
  private readonly dents: Dents | null;
  /** A motorcycle (else a car), its half length and width, where it's kept. */
  readonly bike: BikeId | null;
  private readonly hl: number;
  private readonly hw: number;
  private readonly saveKey: string;
  /** A bike's drawing each frame (the page's: race/bikeRide.ts), called from `pose`. */
  onPose: ((dt: number) => void) | null = null;
  private reshape = true;
  private unsaved = false;
  private keptT = 0;

  constructor(
    material: THREE.Material,
    traffic: TrafficSystem,
    home: { x: number; z: number; h: number },
    private readonly probe: (x: number, z: number, r: number, self: DrivenVehicle) => HitKind | null,
    private readonly ex: Expressway | null = null,
    private readonly deckObstacles: () => readonly DeckObstacle[] = () => [],
    atHome = false,
    /** The lie of the land (terrain.ts): the street's height on the hills. */
    private readonly terrain: Terrain = Terrain.FLAT,
    bike: BikeId | null = null,
  ) {
    this.bike = bike;
    // (The cruiser keeps the first bike's key; the others their own.)
    this.saveKey = !bike ? SAVE_KEY : bike === 'cruiser' ? BIKE_SAVE_KEY : `${BIKE_SAVE_KEY}.${bike}`;
    const height = (x: number, z: number): number => this.ex?.at(x, z, this.sim.y)?.height ?? this.terrain.height(x, z);
    const tuning = loadTuning();
    if (bike) {
      // A motorcycle: its spec and sound; the view is a holder the page puts the bike in (onPose draws it).
      const def = BIKES[bike];
      this.carId = '';
      this.parts = newParts();
      this.name = def.name;
      this.baseSpec = def.spec;
      this.sim = new Car(tunedBy(this.baseSpec, tuning), assistsBy(CITY_ASSISTS, 'road', tuning));
      this.view = { type: 'sports', obj: new THREE.Group(), body: new THREE.Mesh(), windows: { left: null, right: null }, wheels: [], r: 0.33, wipers: [], lamps: {} };
      this.sound.configure(def.sound);
      this.wheelAlong = [-0.78, 0.86];
      this.dents = null;
      this.cabinFor = null;
      [this.hl, this.hw] = def.spec.size ?? [1.15, 0.45];
    } else {
      const mine = currentCar(loadProfile());
      this.carId = mine.id;
      this.parts = partsOf(mine);
      const m = model(mine.type);
      this.name = `${m.maker} ${m.name}`;
      // Its parts, and the driving tuning on top (race/tuning.ts; the debug menu's Car: tune driving).
      this.baseSpec = tunedSpec(mine.type, mine.parts);
      this.sim = new Car(tunedBy(this.baseSpec, tuning), assistsBy(CITY_ASSISTS, 'road', tuning));
      this.view = buildCar({ type: mine.type, paint: mine.paint, paint2: mine.paint2, livery: mine.livery, neon: mine.neonFitted ? mine.neon : null }, material);
      this.sound.configure(m.sound);
      const zs = wheelLayout(mine.type).spots.map((s) => s.z);
      this.wheelAlong = [Math.min(...zs), Math.max(...zs)];
      setLamps(this.view, { head: false, tail: false });
      this.dents = new Dents(this.view);
      this.cabinFor = () => new CarInterior(mine.type, material, { rpmMax: m.sound.maxRpm, turbo: !!this.baseSpec.turbo });
      this.hl = HL;
      this.hw = HW;
    }
    this.ground = {
      height,
      normal: (x, z) => {
        const e = 0.6;
        const hx = height(x + e, z) - height(x - e, z);
        const hz = height(x, z + e) - height(x, z - e);
        const n = new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
        return [n.x, n.y, n.z];
      },
      grip: () => weatherGrip(this.weather),
      collide: (x, z, h, hl, hw) => this.collide(x, z, h, hl, hw),
    };
    let at = home;
    if (!atHome) {
      try {
        const s = JSON.parse(localStorage.getItem(this.saveKey) ?? 'null') as { x: number; z: number; h: number; y?: number } | null;
        if (s && [s.x, s.z, s.h].every(Number.isFinite)) at = s;
        if (s && Number.isFinite(s.y)) this.sim.y = s.y!;
      } catch {
        /* none saved */
      }
    }
    const y0 = this.sim.y;
    // Left somewhere the city has since changed under it (a building, a median): back to the garage.
    if (at !== home && y0 < 1 && this.probe(at.x, at.z, 0.9, null as unknown as DrivenVehicle) === 'wall') at = home;
    this.sim.place(at.x, at.z, at.h, this.ground);
    // Left up on the expressway: back up there (its height at that spot).
    this.sim.y = this.ex?.at(at.x, at.z, y0)?.height ?? this.sim.y;
    this.vehicle = traffic.addOwn(this.view.obj, this.hl + 0.05, this.hw * 2, this.name, at.x, at.z, Math.sin(at.h), Math.cos(at.h));
    this.sync();
    // Engine smoke (grey puffs from under the bonnet), for a car with a smashed front.
    const N = 90;
    this.smokePos = new Float32Array(N * 3);
    this.smokeLife = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.smokeLife, 1));
    this.smoke = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          attribute float life;
          varying float vLife;
          void main() {
            vLife = life;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = (1.0 + (1.0 - life) * 2.5) * 500.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vLife;
          void main() {
            if (vLife <= 0.0) discard;
            float d = length(gl_PointCoord - 0.5);
            gl_FragColor = vec4(vec3(0.32, 0.32, 0.34), smoothstep(0.5, 0.0, d) * vLife * 0.35);
          }`,
      }),
    );
    this.smoke.frustumCulled = false;
    this.pose(0);
  }

  /** Its cabin (models/carInterior.ts), for the cockpit view: fitted the first time it's asked for; a bike has none. */
  get interior(): CarInterior | null {
    if (!this.cabin && this.cabinFor) {
      this.cabin = this.cabinFor();
      this.view.obj.add(this.cabin.group);
    }
    return this.cabin;
  }

  /** Its half length and half width (m). */
  get size(): readonly [number, number] {
    return [this.hl, this.hw];
  }

  /** Overall condition, 0 like new to 100 totalled (crash.ts `overall`). */
  get condition(): number {
    return overall(this.parts);
  }

  get totaled(): boolean {
    return totaled(this.parts);
  }

  /** What's at (x, z) within r for the car: on the expressway, its traffic; on the street, `probe`. */
  private kindAt(x: number, z: number, r: number): HitKind | null {
    if (!this.onExpressway(x, z)) return this.probe(x, z, r, this.vehicle);
    for (const o of this.deckObstacles()) {
      const ox = x - o.x;
      const oz = z - o.z;
      if (Math.abs(ox) > 7 || Math.abs(oz) > 7) continue;
      if (Math.abs(ox * o.dx + oz * o.dz) < o.half + r && Math.abs(ox * o.dz - oz * o.dx) < o.hw + r) return 'car';
    }
    return null;
  }

  /**
   * The way out of what's at (cx, cz): the nearest clear distance, and the mean of the directions clear there
   * (the obstacle's surface normal, near enough). `against` keeps to directions against the travel (vx, vz).
   */
  private way(cx: number, cz: number, k: HitKind, vx: number, vz: number, against: boolean): { d: number; nx: number; nz: number } | null {
    const sp = Math.hypot(vx, vz);
    for (let d = 0.05; d <= 1.2; d += 0.05) {
      let nx = 0;
      let nz = 0;
      for (const [dx, dz] of DIRS) {
        if (against && dx * vx + dz * vz > 0.17 * sp) continue;
        const kk = this.kindAt(cx + dx * d, cz + dz * d, CL);
        if (!(kk === 'wall' || kk === 'person' || kk === k)) {
          nx += dx;
          nz += dz;
        }
      }
      const n = Math.hypot(nx, nz);
      if (n > 1e-6) return { d, nx: nx / n, nz: nz / n };
    }
    return null;
  }

  /** The Ground's walls (see the class comment): what stops the car this step, and the push out of it. */
  private collide(x: number, z: number, h: number, hl: number, hw: number): { px: number; pz: number; nx: number; nz: number; friction: number } | null {
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const lx = fz;
    const lz = -fx;
    if (this.onExpressway(x, z)) {
      // The parapets: each corner kept on the network.
      const y = this.sim.y;
      for (const f of [hl - 0.25, -(hl - 0.25)]) {
        for (const s of [hw, -hw]) {
          const p = this.ex!.pushBack(x + fx * f + lx * s, z + fz * f + lz * s, y);
          if (p) {
            this.contact = { kind: 'wall', along: f, across: s, nx: p.nx, nz: p.nz };
            return { ...p, friction: WALL_FRICTION };
          }
        }
      }
    }
    const s = this.sim;
    const vx = fx * s.u + lx * s.w;
    const vz = fz * s.u + lz * s.w;
    const sp = Math.hypot(vx, vz);
    const probes = [hl - 0.3, (hl - 0.3) / 3, -(hl - 0.3) / 3, -(hl - 0.3)];
    for (let i = 0; i < probes.length; i++) {
      const f = probes[i];
      const cx = x + fx * f;
      const cz = z + fz * f;
      const k = this.kindAt(cx, cz, CL);
      if (k !== 'wall' && k !== 'person' && k !== 'car' && k !== 'pole') continue;
      if (k === 'car' || k === 'pole') {
        // Only the nose, at speed, meeting it fresh (not already ploughing through it), and head-on.
        if (i !== 0 || sp < NUDGE || this.touching.has(k)) continue;
        const n = this.way(cx, cz, k, vx, vz, false);
        if (!n || -(vx * n.nx + vz * n.nz) / sp < DIRECT) continue;
      }
      // Out along the surface's normal (a wall met at an angle takes only the speed into it); a person pushes
      // back against the travel, not round their side.
      const out = (k === 'person' && sp > 0.5 ? this.way(cx, cz, k, vx, vz, true) : null) ?? this.way(cx, cz, k, vx, vz, false);
      if (!out) return null;
      // Where it touches the car (the probe's edge toward it), for which part takes the hit.
      const px = -out.nx * CL;
      const pz = -out.nz * CL;
      this.contact = { kind: k, along: f + px * fx + pz * fz, across: px * lx + pz * lz, nx: out.nx, nz: out.nz };
      return { px: out.nx * out.d, pz: out.nz * out.d, nx: out.nx, nz: out.nz, friction: WALL_FRICTION };
    }
    return null;
  }

  /** Drive a step: the handling model, the damage it took, then the traffic system's copy of where the car is. */
  drive(dt: number, c: Controls): void {
    const P = this.parts;
    const wasTotaled = this.totaled;
    // A smashed front limps, damaged tyres grip less and pull; a totalled car won't go.
    // The weather on the road (district/roadGrip.ts): puddles under the wheels take grip before the step; their
    // drag, the pull toward one side and the crosswind after it.
    const water = weatherBefore(this.sim, this.weather, tyreGrip(P), this.wheelAlong[1], this.wheelAlong[0]);
    c = wasTotaled
      ? { throttle: 0, brake: 0.6, steer: c.steer, handbrake: c.handbrake }
      : { ...c, throttle: c.throttle * powerLeft(P), steer: Math.max(-1, Math.min(1, c.steer + tyrePull(P))) };
    this.braking = (c.brake > 0 && this.sim.u > 0.5) || (c.throttle > 0 && this.sim.u < -0.5);
    this.contact = null;
    this.sim.update(dt, c, this.ground);
    weatherAfter(this.sim, dt, water, this.weather);
    this.water = water.splash;
    this.knock = 0;
    const hit = this.contact as { kind: HitKind; along: number; across: number; nx: number; nz: number } | null;
    if (hit?.kind === 'wall') this.glance(dt, hit.nx, hit.nz);
    if (hit && hit.kind !== 'person') {
      const shares = sectionsAt(hit.along, hit.across, this.hl, this.hw, this.wheelAlong);
      // A real hit costs by the speed into it (and a little by the speed at all: a glancing knock); sliding
      // along a wall, a scrape.
      const d = impactDamage(this.sim.bump) + (this.sim.bump > 2 ? 0.05 * this.sim.speed : 0);
      this.take(shares, d > 0 ? d : hit.kind === 'wall' ? scrapeDamage(this.sim.speed, dt) : 0);
      this.knock = this.sim.bump;
    }
    this.passThrough(dt, hit?.kind ?? null);
    if (this.totaled && !wasTotaled) {
      this.sim.u *= 0.3;
      this.sim.w *= 0.3;
      this.onTotaled?.();
    }
    this.keptT += dt;
    if (this.unsaved && (this.keptT > 0.5 || this.totaled)) this.keepCondition();
    this.sync();
    this.saveT += dt;
    if (this.saveT > 5) this.save();
    this.sound.update(dt, { rev: this.sim.rev, gear: this.sim.gear, throttle: c.throttle, speed: this.sim.speed, slide: this.sim.slide, spin: this.sim.spin, bump: this.knock, boost: this.sim.boost, turbo: !!this.sim.spec.turbo });
  }

  /**
   * A wall met at an angle (under ~45 degrees) turns the car along it, so you slide down the wall keeping your
   * speed instead of grinding to a stop nose-in (n: the wall's normal, out toward the car).
   */
  private glance(dt: number, nx: number, nz: number): void {
    const s = this.sim;
    if (s.speed < 3) return;
    const fx = Math.sin(s.h);
    const fz = Math.cos(s.h);
    const fn = fx * nx + fz * nz;
    if (fn >= 0 || fn < -0.7) return;
    const th = Math.atan2(fx - fn * nx, fz - fn * nz);
    let dh = th - s.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const step = Math.max(-3 * dt, Math.min(3 * dt, dh));
    s.h += step;
    s.r *= 0.6;
  }

  /** Damage `d` to the parts by their shares: kept, shown on the car, and listed for the HUD. */
  private take(shares: Partial<Parts>, d: number): void {
    // (A bike takes no damage yet.)
    if (d <= 0 || this.bike) return;
    for (const [k, v] of Object.entries(shares) as [Section, number][]) {
      const before = this.parts[k];
      this.parts[k] = Math.min(WRECKED, before + d * v);
      const took = this.parts[k] - before;
      if (took <= 0) continue;
      const last = this.hits.find((h) => h.part === k);
      if (last) last.amount += took;
      else this.hits.push({ part: k, amount: took });
    }
    this.reshape = true;
    this.unsaved = true;
  }

  /**
   * Driving through things (cars and poles not met head-on, anything soft): a knock on the way into each kind
   * of thing (damage to the parts touching it, a cut in speed), and drag while you're in it.
   */
  private passThrough(dt: number, stopped: HitKind | null): void {
    const s = this.sim;
    const fx = Math.sin(s.h);
    const fz = Math.cos(s.h);
    const hl = this.hl - 0.3;
    const side = this.bike ? 0.3 : SIDE;
    const now = new Map<'car' | 'pole' | 'soft', [number, number][]>();
    for (const f of [hl, hl / 3, -hl / 3, -hl]) {
      for (const lat of [0, side, -side]) {
        const k = this.kindAt(s.x + fx * f + fz * lat, s.z + fz * f - fx * lat, CL);
        if ((k !== 'car' && k !== 'pole' && k !== 'soft') || k === stopped) continue;
        const at = now.get(k) ?? [];
        at.push([f, lat]);
        now.set(k, at);
      }
    }
    let drag = 0;
    for (const [k, where] of now) {
      const p = passThrough(k, s.speed);
      if (!this.touching.has(k)) {
        // The parts touching it share the knock (a probe out at the side stands for the side's skin).
        const shares: Partial<Parts> = {};
        for (const [a, lat] of where) {
          for (const [sec, v] of Object.entries(sectionsAt(a, lat === 0 ? 0 : Math.sign(lat) * this.hw, this.hl, this.hw, this.wheelAlong)) as [Section, number][]) {
            shares[sec] = (shares[sec] ?? 0) + v / where.length;
          }
        }
        this.take(shares, p.damage);
        s.u *= 1 - p.cut;
        s.w *= 1 - p.cut;
        this.knock = Math.max(this.knock, s.speed * p.cut * 3);
      }
      drag = Math.max(drag, p.drag);
    }
    this.touching = new Set(now.keys());
    if (drag > 0 && s.speed > 0.1) {
      const k = Math.max(0, 1 - (drag * dt) / s.speed);
      s.u *= k;
      s.w *= k;
    }
  }

  /** Keep the car's condition with it (the garage repairs it). */
  private keepCondition(): void {
    this.unsaved = false;
    this.keptT = 0;
    const p = loadProfile();
    const c = p.cars.find((q) => q.id === this.carId);
    if (!c) return;
    c.sections = { ...this.parts };
    c.damage = Math.round(this.condition * 10) / 10;
    saveProfile(p);
  }

  /** Every frame: the body on the ground, the wheels turning, the damage showing, the smoke of a smashed front. */
  pose(dt: number): void {
    if (this.bike) {
      this.onPose?.(dt);
      return;
    }
    poseCar(this.view, this.sim, this.ground);
    turnWheels(this.view, this.sim, dt);
    const P = this.parts;
    this.dents?.tyres(P);
    if (this.reshape) {
      this.reshape = false;
      this.dents?.apply(P);
    }
    const s = this.sim;
    const heavy = Math.max(0, (P.front - 45) / 55);
    if (heavy > 0 && Math.random() < heavy * dt * 30) {
      const k = this.smokeNext++ % this.smokeLife.length;
      this.smokePos.set([s.x + Math.sin(s.h) * 1.5 + (Math.random() - 0.5) * 0.6, s.y + 1.0, s.z + Math.cos(s.h) * 1.5 + (Math.random() - 0.5) * 0.6], k * 3);
      this.smokeLife[k] = 1;
    }
    for (let k = 0; k < this.smokeLife.length; k++) {
      if (this.smokeLife[k] <= 0) continue;
      this.smokeLife[k] -= dt / 2.2;
      this.smokePos[k * 3 + 1] += dt * 1.1;
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
    this.smoke.geometry.attributes.life.needsUpdate = true;
  }

  /**
   * Its lamps (a car's; a bike's are its model's materials, the page's): the headlamps and tail lamps on or off,
   * and while it's `driven` the brake lights and the reversing lamps.
   */
  lamps(on: boolean, driven: boolean): void {
    setLamps(this.view, { head: on, tail: on, brake: driven && this.braking, reverse: driven && this.sim.gear === 0 });
  }

  /**
   * Where its lights shine from, for the city shader (real/city.ts uMyCar, uMyDir): its centre on the ground and how
   * far ahead its nose is; the way it points, the road's slope along that and half the lamps' spacing.
   */
  beam(car: THREE.Vector4, dir: THREE.Vector4): void {
    const s = this.sim;
    const fx = Math.sin(s.h);
    const fz = Math.cos(s.h);
    const e = 2.5;
    const slope = (this.ground.height(s.x + fx * e, s.z + fz * e) - this.ground.height(s.x - fx * e, s.z - fz * e)) / (2 * e);
    car.set(s.x, s.y, s.z, this.hl);
    dir.set(fx, fz, slope, this.bike ? 0 : 0.62);
  }

  /** Repaired: like new again. */
  repair(): void {
    Object.assign(this.parts, newParts());
    this.reshape = true;
    this.keepCondition();
  }

  /** Up off the street (on the expressway's deck, or a car park's floors). */
  aloft(): boolean {
    return this.sim.y - this.terrain.height(this.sim.x, this.sim.z) > 1;
  }

  /** On the expressway (its ramps included), rather than the street. */
  onExpressway(x = this.sim.x, z = this.sim.z): boolean {
    return !!this.ex && (this.sim.y - this.terrain.height(x, z) > 0.6 || this.ex.at(x, z, this.sim.y) !== null);
  }

  private sync(): void {
    const v = this.vehicle;
    const s = this.sim;
    v.acc = (s.u - v.v) / 0.016;
    // Up on the expressway, the street's traffic doesn't see you.
    v.aloft = s.y - this.terrain.height(s.x, s.z) > 2;
    v.x = s.x;
    v.z = s.z;
    v.dx = Math.sin(s.h);
    v.dz = Math.cos(s.h);
    v.v = s.u;
    v.curv = Math.abs(s.u) > 0.5 ? -s.r / s.u : 0;
  }

  save(): void {
    this.saveT = 0;
    if (this.unsaved) this.keepCondition();
    try {
      localStorage.setItem(this.saveKey, JSON.stringify({ x: this.sim.x, z: this.sim.z, h: this.sim.h, y: this.sim.y }));
    } catch {
      /* this session only */
    }
  }

  /** Stop the engine (getting out): its sound fades to nothing. */
  park(): void {
    this.sim.u = this.sim.w = this.sim.r = 0;
    this.braking = false;
    this.sync();
    this.sound.setVolume(0);
    this.save();
  }

  /** Put the car at (x, z) facing h (for checks, and fetching it). */
  place(x: number, z: number, h: number, y = 0): void {
    this.sim.y = y;
    this.sim.place(x, z, h, this.ground);
    this.sim.y = this.ex?.at(x, z, y)?.height ?? this.sim.y;
    this.sync();
    this.pose(0);
  }
}
