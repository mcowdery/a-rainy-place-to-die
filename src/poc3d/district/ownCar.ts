import * as THREE from 'three';
import { model, tunedSpec } from '../../race/catalog';
import { buildCar, poseCar, turnWheels, type CarView } from '../../race/carView';
import { currentCar, loadProfile, saveProfile } from '../../race/profile';
import { CarSound } from '../../race/sound';
import { Car, ROAD_ASSISTS, type Assists, type Controls, type Ground } from '../../race/vehicle';
import type { DrivenVehicle, TrafficSystem } from '../real/traffic';
import type { Expressway } from './expressway';
import { impactDamage, passThrough, powerLeft, TOTALED, type HitKind } from './crash';

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
 * The racing model wants a Ground. On the street: height 0, and what's in the way from `probe` (hard,
 * soft or a person: crash.ts). Crashing is forgiving: only something hard (or a person) across the car's
 * centre line stops it (pushed out the shortest way, only the speed into it lost: a glancing hit scrapes
 * along), with damage by that speed; a corner or a side through something hard, and anything soft, you drive
 * through, losing some speed and some of the car. On the expressway (district/expressway.ts; up a ramp from
 * its foot, or anywhere once you're above the street): its height, its parapets (a corner off the network is
 * pushed back on, a hit like any wall) and the cars in its traffic (`deckObstacles`, hard).
 * The car's condition (crash.ts: 0 like new, 100 totalled) is kept with it in the profile; a damaged car
 * loses power and smokes, and a totalled one won't go (`onTotaled`; the garage repairs it).
 */

/** The city: road assists, but with room to slide (the expressway's long bends). */
export const CITY_ASSISTS: Assists = { ...ROAD_ASSISTS, maxSlide: (38 * Math.PI) / 180 };

const SAVE_KEY = 'citypop.city.car';
/** The car's centre line is probed with small circles (a real hit), its sides with more (pass through). */
const CL = 0.35;
const SIDE = 0.55;
const DIRS = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)] as const);

export class OwnCar {
  readonly sim: Car;
  readonly view: CarView;
  readonly vehicle: DrivenVehicle;
  readonly ground: Ground;
  readonly name: string;
  readonly sound = new CarSound();
  private saveT = 0;
  /** 0 (like new) to TOTALED; which owned car this is (for keeping its condition). */
  condition = 0;
  private readonly carId: string;
  /** What stopped the car this step, if anything (so a person costs no damage). */
  private lastHit: HitKind | null = null;
  /** What the car was driving through last frame (pass-through: the knock is on the way in, once). */
  private touching = new Set<HitKind>();
  /** A knock this frame for the sound and the camera (m/s), and the car totalled just now. */
  knock = 0;
  onTotaled: (() => void) | null = null;
  /** Engine smoke from a damaged car (world space: add it to the scene). */
  readonly smoke: THREE.Points;
  private readonly smokePos: Float32Array;
  private readonly smokeLife: Float32Array;
  private smokeNext = 0;

  constructor(
    material: THREE.Material,
    traffic: TrafficSystem,
    home: { x: number; z: number; h: number },
    private readonly probe: (x: number, z: number, r: number, self: DrivenVehicle) => HitKind | null,
    private readonly ex: Expressway | null = null,
    private readonly deckObstacles: () => readonly DeckObstacle[] = () => [],
    atHome = false,
  ) {
    const height = (x: number, z: number): number => this.ex?.at(x, z, this.sim.y)?.height ?? 0;
    const mine = currentCar(loadProfile());
    this.carId = mine.id;
    this.condition = mine.damage ?? 0;
    const m = model(mine.type);
    this.name = `${m.maker} ${m.name}`;
    this.sim = new Car(tunedSpec(mine.type, mine.parts), CITY_ASSISTS);
    this.view = buildCar({ type: mine.type, paint: mine.paint, paint2: mine.paint2, livery: mine.livery, neon: mine.neonFitted ? mine.neon : null }, material);
    this.sound.configure(m.sound);
    this.ground = {
      height,
      normal: (x, z) => {
        const e = 0.6;
        const hx = height(x + e, z) - height(x - e, z);
        const hz = height(x, z + e) - height(x, z - e);
        const n = new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
        return [n.x, n.y, n.z];
      },
      grip: () => 1,
      collide: (x, z, h, hl, hw) => {
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        this.lastHit = null;
        if (this.onExpressway(x, z)) {
          // On the expressway: each corner kept on the network (the parapets).
          const y = this.sim.y;
          for (const f of [hl - 0.25, -(hl - 0.25)]) {
            for (const s of [hw, -hw]) {
              const p = this.ex!.pushBack(x + fx * f + fz * s, z + fz * f - fx * s, y);
              if (p) {
                this.lastHit = 'hard';
                return p;
              }
            }
          }
        }
        // Along the centre line: anything hard (or a person) there stops the car, pushed out the shortest way.
        const stops = (k: HitKind | null): boolean => k === 'hard' || k === 'person';
        for (const f of [hl - 0.3, (hl - 0.3) / 3, -(hl - 0.3) / 3, -(hl - 0.3)]) {
          const cx = x + fx * f;
          const cz = z + fz * f;
          const k = this.kindAt(cx, cz, CL);
          if (!stops(k)) continue;
          this.lastHit = k;
          // Pushed back the way it came (not round the side of a pole or a person): only directions against
          // the travel, or across it, will do.
          const vx = Math.sin(this.sim.h) * this.sim.u + Math.cos(this.sim.h) * this.sim.w;
          const vz = Math.cos(this.sim.h) * this.sim.u - Math.sin(this.sim.h) * this.sim.w;
          const sp = Math.hypot(vx, vz);
          for (let d = 0.05; d <= 1.2; d += 0.05) {
            for (const [nx, nz] of DIRS) {
              if (sp > 0.5 && nx * vx + nz * vz > 0.17 * sp) continue;
              if (!stops(this.kindAt(cx + nx * d, cz + nz * d, CL))) return { px: nx * d, pz: nz * d, nx, nz };
            }
          }
          return null;
        }
        return null;
      },
    };
    let at = home;
    if (!atHome) {
      try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as { x: number; z: number; h: number; y?: number } | null;
        if (s && [s.x, s.z, s.h].every(Number.isFinite)) at = s;
        if (s && Number.isFinite(s.y)) this.sim.y = s.y!;
      } catch {
        /* none saved */
      }
    }
    const y0 = this.sim.y;
    // Left somewhere the city has since changed under it (a building, a median): back to the garage.
    if (at !== home && y0 < 1 && this.probe(at.x, at.z, 0.9, null as unknown as DrivenVehicle) === 'hard') at = home;
    this.sim.place(at.x, at.z, at.h, this.ground);
    // Left up on the expressway: back up there (its height at that spot).
    this.sim.y = this.ex?.at(at.x, at.z, y0)?.height ?? this.sim.y;
    this.vehicle = traffic.addOwn(this.view.obj, 2.2, 1.8, this.name, at.x, at.z, Math.sin(at.h), Math.cos(at.h));
    this.sync();
    // Engine smoke (grey puffs from under the bonnet), for a car in a bad way.
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

  get totaled(): boolean {
    return this.condition >= TOTALED;
  }

  /** What's at (x, z) within r for the car: on the expressway, its traffic; on the street, `probe`. */
  private kindAt(x: number, z: number, r: number): HitKind | null {
    if (!this.onExpressway(x, z)) return this.probe(x, z, r, this.vehicle);
    for (const o of this.deckObstacles()) {
      const ox = x - o.x;
      const oz = z - o.z;
      if (Math.abs(ox) > 7 || Math.abs(oz) > 7) continue;
      if (Math.abs(ox * o.dx + oz * o.dz) < o.half + r && Math.abs(ox * o.dz - oz * o.dx) < o.hw + r) return 'hard';
    }
    return null;
  }

  /** Drive a step: the handling model, then the traffic system's copy of where the car is. */
  drive(dt: number, c: Controls): void {
    // A wreck limps; a totalled car won't go.
    const k = this.totaled ? 0 : powerLeft(this.condition);
    c = this.totaled ? { throttle: 0, brake: 0.6, steer: c.steer, handbrake: c.handbrake } : { ...c, throttle: c.throttle * k };
    const before = this.condition;
    this.sim.update(dt, c, this.ground);
    // A real hit (something hard across the centre line): damage by the speed into it.
    if (this.sim.bump > 0 && this.lastHit !== 'person') this.condition += impactDamage(this.sim.bump);
    this.knock = this.sim.bump;
    this.passThrough(dt);
    this.condition = Math.min(TOTALED, this.condition);
    if (this.condition !== before) {
      this.keepCondition();
      if (this.totaled && before < TOTALED) {
        this.sim.u *= 0.3;
        this.sim.w *= 0.3;
        this.onTotaled?.();
      }
    }
    this.sync();
    this.saveT += dt;
    if (this.saveT > 5) this.save();
    this.sound.update(dt, { rev: this.sim.rev, gear: this.sim.gear, throttle: c.throttle, speed: this.sim.speed, slide: this.sim.slide, spin: this.sim.spin, bump: this.sim.bump, boost: this.sim.boost, turbo: !!this.sim.spec.turbo });
  }

  /**
   * Driving through things: the sides' probes (and the centre line's, for soft things). A knock on the way
   * into each (damage, a cut in speed), and drag while any is still inside.
   */
  private passThrough(dt: number): void {
    const s = this.sim;
    const fx = Math.sin(s.h);
    const fz = Math.cos(s.h);
    const hl = 2.15 - 0.3;
    const probes: [number, number, boolean][] = [];
    for (const f of [hl, hl / 3, -hl / 3, -hl]) {
      probes.push([f, 0, true]);
      for (const side of [SIDE, -SIDE]) probes.push([f, side, false]);
    }
    let drag = 0;
    const now = new Set<HitKind>();
    for (const [f, lat, centre] of probes) {
      const k = this.kindAt(s.x + fx * f + fz * lat, s.z + fz * f - fx * lat, CL);
      if (k === 'soft' || (k === 'hard' && !centre)) now.add(k);
    }
    for (const k of now) {
      const p = passThrough(k as 'hard' | 'soft', s.speed);
      if (!this.touching.has(k)) {
        this.condition += p.damage;
        s.u *= 1 - p.cut;
        s.w *= 1 - p.cut;
        this.knock = Math.max(this.knock, s.speed * p.cut * 3);
      }
      drag = Math.max(drag, p.drag);
    }
    this.touching = now;
    if (drag > 0 && s.speed > 0.1) {
      const k = Math.max(0, 1 - (drag * dt) / s.speed);
      s.u *= k;
      s.w *= k;
    }
  }

  /** Keep the car's condition with it (the garage repairs it). */
  private keepCondition(): void {
    const p = loadProfile();
    const c = p.cars.find((q) => q.id === this.carId);
    if (!c) return;
    c.damage = Math.round(this.condition * 10) / 10;
    saveProfile(p);
  }

  /** Every frame: the body on the ground, the wheels turning, the smoke of a damaged car. */
  pose(dt: number): void {
    poseCar(this.view, this.sim, this.ground);
    turnWheels(this.view, this.sim, dt);
    const s = this.sim;
    const heavy = Math.max(0, (this.condition - 55) / 45);
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

  /** Repaired (at the garage): like new again. */
  repaired(): void {
    this.condition = 0;
  }

  /** On the expressway (its ramps included), rather than the street. */
  onExpressway(x = this.sim.x, z = this.sim.z): boolean {
    return !!this.ex && (this.sim.y > 0.6 || this.ex.at(x, z, this.sim.y) !== null);
  }

  private sync(): void {
    const v = this.vehicle;
    const s = this.sim;
    v.acc = (s.u - v.v) / 0.016;
    // Up on the expressway, the street's traffic doesn't see you.
    v.aloft = s.y > 2;
    v.x = s.x;
    v.z = s.z;
    v.dx = Math.sin(s.h);
    v.dz = Math.cos(s.h);
    v.v = s.u;
    v.curv = Math.abs(s.u) > 0.5 ? -s.r / s.u : 0;
  }

  save(): void {
    this.saveT = 0;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ x: this.sim.x, z: this.sim.z, h: this.sim.h, y: this.sim.y }));
    } catch {
      /* this session only */
    }
  }

  /** Stop the engine (getting out): its sound fades to nothing. */
  park(): void {
    this.sim.u = this.sim.w = this.sim.r = 0;
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
