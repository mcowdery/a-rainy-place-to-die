import * as THREE from 'three';
import { model } from '../../race/catalog';
import { MIRROR_LAYER } from '../../race/driveCam';
import { buildCar, CarMarks, hitVolumes, lampsByMotion, poseCar, setLamps, turnWheels, type CarView } from '../../race/carView';
import { EYE, sideFor, type BodyHit } from '../../race/shooting';
import { CarSound } from '../../race/sound';
import { Car, COUPE, type CarSpec, type Controls, type Ground } from '../../race/vehicle';
import type { CarType } from '../models/vehicles';
import type { CityGunfire } from '../real/gunfire';
import { AutoDrive, lanePath, type AutoVehicle, type AutoWorld, type RoadFinder } from './autoDrive';
import { fleeGoals, GUNMAN, LIMP, missBy, pursue, Trigger, type ChaseCarDef, type Mover, type Slot } from './chase';
import type { HitKind } from './crash';
import { CITY_ASSISTS } from './ownCar';

/**
 * A car in a chase (district/chase.ts): a car on the racing model (race/vehicle.ts) that drives the city's streets
 * by itself. Its ground is the street (the terrain's height; buildings and set pieces are walls; parked cars, the
 * traffic, poles and hedges it ploughs through, losing speed, as your own car does). It gets about on the GPS's
 * road network with the auto drive's pursuit style (autoDrive.ts): a runner from goal to goal away from you; a
 * pursuer to wherever you are, re-planned as you move, until it has you in sight and close, when it drives straight
 * at its place beside you (chase.ts `pursue`). Held up, it backs out and tries again. A pursuer's gunman sits on the
 * left and shoots from his window when he has a line (the race page's rules, mirrored), his arm and pistol out of
 * it; his rounds are the city's (real/gunfire.ts). It can be shot where your shots strike (its hit volumes) and
 * shows the holes; done for, it rolls to a stop, smoking.
 */

/** What a chase car needs of the city (main.ts supplies it). */
export interface ChaseWorld {
  /** What stands at (x, z) within r at street level for a car: a wall, a car (parked or in traffic), a pole, something soft, a person. */
  probe(x: number, z: number, r: number): HitKind | null;
  /** The same without the traffic (what a driver steers round rather than follows). */
  solid(x: number, z: number, r: number): HitKind | null;
  height(x: number, z: number): number;
  /** The road's grip now (rain, snow). */
  grip(): number;
  /** A driving route over the road network (district/gps.ts), setting out the way `heading` faces. */
  route(ax: number, az: number, bx: number, bz: number, heading?: readonly [number, number]): [number, number][] | null;
  readonly roads: RoadFinder;
  /** The vehicles within r of a point: the traffic, your car, and the other chase cars (not `self`). */
  vehicles(x: number, z: number, r: number, self: ChaseCar): readonly AutoVehicle[];
  readonly gunfire: CityGunfire;
  /**
   * `probe` and `solid` for what's within `pad` of (x, z), gathered once (District.obstacleNear): a probe costs ~65 us
   * on the world's own, and a car makes ~50 a frame. For radii up to 2.5 m.
   */
  near(x: number, z: number, pad: number): { probe(x: number, z: number, r: number): HitKind | null; solid(x: number, z: number, r: number): HitKind | null };
}

/** How far round a car what's near is gathered for (m), how far it may move before that's gathered again, and for how long it's kept (s). */
const NEAR_PAD = 70;
const NEAR_MOVE = 18;
const NEAR_KEEP = 1.5;

const HL = 2.15;
const HW = 0.85;
/** The centre line's probes (m along from the middle), their radius, and the directions a way out is looked for in. */
const PROBES = [HL - 0.3, (HL - 0.3) / 3, -(HL - 0.3) / 3, -(HL - 0.3)];
const CL = 0.35;
const DIRS = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)] as const);
/** A pursuer drives straight at you from within this (m), with a clear line. */
const DIRECT = 46;

/** Each model's weight against the coupe's (the saloons are heavier, and less eager to turn). */
const WEIGHT: Partial<Record<CarType, number>> = { sedan: 1.14, luxury: 1.32, minivan: 1.4, taxi: 1.2, taxi2: 1.2 };

function specFor(def: ChaseCarDef): CarSpec {
  const w = WEIGHT[def.type] ?? 1;
  return { ...COUPE, mass: COUPE.mass * w, power: COUPE.power * def.power * w, maxDrive: COUPE.maxDrive * Math.sqrt(def.power) * w, gripFront: COUPE.gripFront * def.grip, gripRear: COUPE.gripRear * def.grip, lock: w > 1.2 ? 0.55 : COUPE.lock };
}

/** The gunman's arm out of the window: a dark sleeve, a cuff, a hand, the pistol (+z along the aim). */
function gunArm(): THREE.Group {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb98a6c, roughness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.6, roughness: 0.35 });
  g.add(
    new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.62, 10).rotateX(Math.PI / 2).translate(0, -0.02, -0.33), suit),
    new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 10).rotateX(Math.PI / 2).translate(0, -0.02, -0.02), new THREE.MeshStandardMaterial({ color: 0xe8e4dc })),
    new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.09).translate(0, -0.02, 0.03), skin),
    new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.19).translate(0, 0.035, 0.08), black),
    new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.09, 0.04).rotateX(-0.25).translate(0, -0.015, 0.01), black),
  );
  g.visible = false;
  return g;
}

/** Engine sounds not in use (each has an audio context of its own, and a page may only have so many: they're reused). */
const idleSounds: CarSound[] = [];

export class ChaseCar {
  sim: Car;
  readonly view: CarView;
  readonly ground: Ground;
  readonly sound = idleSounds.pop() ?? new CarSound();
  /** What your shots strike, and the holes they leave. */
  readonly volumes: THREE.Mesh[];
  readonly marks: CarMarks;
  private readonly tag: THREE.Sprite;
  private static tagMat: THREE.SpriteMaterial | null = null;
  private static tagMaterial(): THREE.SpriteMaterial {
    if (!ChaseCar.tagMat) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.translate(32, 32);
      g.beginPath();
      g.moveTo(0, -27);
      g.lineTo(21, 0);
      g.lineTo(0, 27);
      g.lineTo(-21, 0);
      g.closePath();
      g.fillStyle = '#ff2b3a';
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = '#120406';
      g.stroke();
      const map = new THREE.CanvasTexture(c);
      map.colorSpace = THREE.SRGBColorSpace;
      ChaseCar.tagMat = new THREE.SpriteMaterial({ map, color: new THREE.Color(2.2, 1.2, 1.2), depthTest: false, depthWrite: false, transparent: true, fog: false });
    }
    return ChaseCar.tagMat;
  }
  private readonly arm = gunArm();
  private trigger = new Trigger();
  private pilot: AutoDrive | null = null;
  /** Where its route goes, and seconds until it may plan another. */
  private goal: [number, number] | null = null;
  private replanIn = 0;
  private sightIn = 0;
  private sight = false;
  /** Seconds for which a pursuer keeps to the road though it can see you (driving straight at you got it stuck). */
  private byRoad = 0;
  /** Held up: seconds it's been standing when it wants to go, seconds left of backing out, the wheel while it does. */
  private stuck = 0;
  private backing = 0;
  private backSteer = 1;
  /** Seconds it's been getting nowhere (the page may put a lost pursuer back on your trail). */
  stalled = 0;
  /** Seconds it's been crawling behind the traffic, or stopped at something standing in its way; seconds left of barging through such things. */
  private queued = 0;
  private blocked = 0;
  private barge = 0;
  private touching = false;
  private throttle = 0;
  /** A knock this frame (m/s into a wall, or the speed it ploughed into something at), for what it costs the car. */
  knock = 0;
  /** What's near it, gathered for a moment (`ChaseWorld.near`), where from and how long ago. */
  private nearCache: { x: number; z: number; w: ReturnType<ChaseWorld['near']> } | null = null;
  private nearAge = Math.random() * NEAR_KEEP;
  /** Out of it (the page says so: chase.ts): it rolls to a stop. */
  out = false;
  /** Seconds it's been out of it (a gauntlet clears the wrecks away), and whether it has its engine sound running. */
  outFor = 0;
  loud = false;
  /** Its pace with a tyre gone (1: whole). */
  private limp = 1;
  /** How it's driving now, for the HUD and checks. */
  mode: 'held' | 'route' | 'direct' | 'backing' | 'out' = 'held';

  constructor(
    public def: ChaseCarDef,
    public id: string,
    material: THREE.Material,
    private readonly world: ChaseWorld,
  ) {
    this.sim = new Car(specFor(def), CITY_ASSISTS);
    this.view = buildCar({ type: def.type, paint: def.paint }, material);
    this.view.obj.add(this.arm);
    this.volumes = hitVolumes(this.view.obj, id, def.gunman, def.type);
    world.gunfire.carHits.skin(this.view.obj, this.view.body, this.view.windows);
    // Its mark in your mirrors (the markers over the view are the HUD's, which a mirror can't show): a red diamond
    // over its roof, drawn only for the mirrors' cameras (race/driveCam.ts `MIRROR_LAYER`) and through whatever
    // stands between.
    this.tag = new THREE.Sprite(ChaseCar.tagMaterial());
    this.tag.position.set(0, 1.85, 0);
    this.tag.layers.set(MIRROR_LAYER);
    this.tag.renderOrder = 950;
    this.view.obj.add(this.tag);
    this.marks = new CarMarks(this.view.obj);
    this.sound.configure(model(def.type === 'sports' ? 'sports' : 'awd').sound);
    const height = (x: number, z: number): number => world.height(x, z);
    this.ground = {
      height,
      normal: (x, z) => {
        const e = 0.6;
        const n = new THREE.Vector3(-(height(x + e, z) - height(x - e, z)) / (2 * e), 1, -(height(x, z + e) - height(x, z - e)) / (2 * e)).normalize();
        return [n.x, n.y, n.z];
      },
      grip: () => world.grip(),
      collide: (x, z, h) => this.collide(x, z, h),
    };
  }

  /** How it's getting on, for checks: its mode and, on a route, what its driver says. */
  get status(): string {
    return this.pilot ? `${this.mode}: ${this.pilot.status}, ${Math.round(this.pilot.left)} m to go` : this.mode;
  }

  /** As a pursuer or a runner needs you: where a car is, the way it points, its speed. */
  get mover(): Mover {
    return this.sim;
  }

  /** As another driver sees it. */
  get vehicle(): AutoVehicle {
    const s = this.sim;
    return { x: s.x, z: s.z, dx: Math.sin(s.h), dz: Math.cos(s.h), v: s.u, half: HL, width: HW * 2 };
  }

  place(x: number, z: number, h: number): void {
    this.sim.place(x, z, h, this.ground);
    this.pilot = null;
    this.goal = null;
    this.stuck = this.backing = this.stalled = 0;
    this.replanIn = 0;
    this.pose(0, 0);
  }

  /** The local probes' gathering, made again once the car has moved on or it has gone stale. */
  private refreshNear(dt: number): void {
    const s = this.sim;
    const c = this.nearCache;
    this.nearAge += dt;
    if (c && this.nearAge < NEAR_KEEP && Math.hypot(s.x - c.x, s.z - c.z) < NEAR_MOVE) return;
    this.nearAge = 0;
    this.nearCache = { x: s.x, z: s.z, w: this.world.near(s.x, s.z, NEAR_PAD) };
  }

  /** `world.probe` / `world.solid`, from what's been gathered near the car where the point is inside it. */
  private probe(x: number, z: number, r: number): HitKind | null {
    const c = this.nearCache;
    return c && Math.abs(x - c.x) < NEAR_PAD - 3 && Math.abs(z - c.z) < NEAR_PAD - 3 ? c.w.probe(x, z, r) : this.world.probe(x, z, r);
  }

  private solid(x: number, z: number, r: number): HitKind | null {
    const c = this.nearCache;
    return c && Math.abs(x - c.x) < NEAR_PAD - 3 && Math.abs(z - c.z) < NEAR_PAD - 3 ? c.w.solid(x, z, r) : this.world.solid(x, z, r);
  }

  /** The street's walls: a wall on the car's centre line pushes it back out the nearest way. */
  private collide(x: number, z: number, h: number): { px: number; pz: number; nx: number; nz: number; friction: number } | null {
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    for (const f of PROBES) {
      const cx = x + fx * f;
      const cz = z + fz * f;
      if (this.probe(cx, cz, CL) !== 'wall') continue;
      for (let d = 0.05; d <= 1.6; d += 0.05) {
        let nx = 0;
        let nz = 0;
        for (const [dx, dz] of DIRS) {
          if (this.probe(cx + dx * d, cz + dz * d, CL) !== 'wall') {
            nx += dx;
            nz += dz;
          }
        }
        const n = Math.hypot(nx, nz);
        if (n > 1e-6) return { px: (nx / n) * d, pz: (nz / n) * d, nx: nx / n, nz: nz / n, friction: 0.99 };
      }
      return null;
    }
    return null;
  }

  /** Whether a car's width of straight line from here to (x, z) is clear of walls (a pier, a corner). */
  private clearTo(x: number, z: number): boolean {
    const s = this.sim;
    const d = Math.hypot(x - s.x, z - s.z);
    for (let t = 2.5; t < d - 2; t += 1.3) if (this.probe(s.x + ((x - s.x) * t) / d, s.z + ((z - s.z) * t) / d, HW + 0.15) === 'wall') return false;
    return true;
  }

  /** Metres to a wall dead ahead (Infinity if none within 26), and the clearer side (+1 the left). */
  private wallAhead(): { ahead: number; side: number } {
    const s = this.sim;
    const fx = Math.sin(s.h);
    const fz = Math.cos(s.h);
    let ahead = Infinity;
    for (const d of [5, 9, 13, 18, 26]) {
      if (this.probe(s.x + fx * d, s.z + fz * d, 0.8) === 'wall') {
        ahead = d;
        break;
      }
    }
    if (ahead === Infinity) return { ahead, side: 0 };
    const at = (a: number): boolean => this.probe(s.x + Math.sin(s.h + a) * 9, s.z + Math.cos(s.h + a) * 9, 0.8) !== 'wall';
    const l = at(0.6);
    const r = at(-0.6);
    return { ahead, side: l === r ? (this.backSteer > 0 ? 1 : -1) : l ? 1 : -1 };
  }

  /** A route to (gx, gz) from where it stands, the way it faces; false if there's none. */
  private plan(gx: number, gz: number, pace: number): boolean {
    const s = this.sim;
    const route = this.world.route(s.x, s.z, gx, gz, [Math.sin(s.h), Math.cos(s.h)]);
    const path = route && lanePath(route, s, this.world.roads, HL);
    if (!path) return false;
    const auto: AutoWorld = {
      light: () => 'green',
      vehicles: (x, z, r) => this.world.vehicles(x, z, r, this),
      // (Barging through: only walls and people are in its way.)
      solid: (x, z, r) => {
        const k = this.solid(x, z, r);
        return this.barge > 0 && k !== 'wall' && k !== 'person' ? null : k;
      },
    };
    const prev = this.pilot;
    this.pilot = new AutoDrive(path, 'pursuit', auto, HL, HW);
    if (prev) this.pilot.carryOn(prev);
    this.pilot.pace = pace;
    this.goal = [gx, gz];
    return true;
  }

  /** A runner's driving: from goal to goal, away from you; quicker with you close, easing off when you're far behind. */
  private flee(dt: number, you: Mover): Controls {
    const s = this.sim;
    const dist = Math.hypot(you.x - s.x, you.z - s.z);
    const pace = this.def.pace * this.limp * (dist > 190 ? 0.8 : dist < 40 ? 1.08 : 1);
    const p = this.pilot;
    // You're across its way just ahead: another way.
    const cutOff = dist < 45 && (you.x - s.x) * Math.sin(s.h) + (you.z - s.z) * Math.cos(s.h) > dist * 0.6 && Math.abs(you.u) < 6;
    if ((!p || p.arrived || p.left < 170 || p.blockedFor > 2.5 || cutOff) && this.replanIn <= 0) {
      this.replanIn = 2.5;
      for (const [gx, gz] of fleeGoals(s.x, s.z, Math.sin(s.h), Math.cos(s.h), you.x, you.z)) if (this.plan(gx, gz, pace)) break;
    }
    if (!this.pilot) return { throttle: 0, brake: 0, steer: 0, handbrake: true };
    this.pilot.pace = pace;
    return this.pilot.step(dt, s, this.world.grip());
  }

  /** A pursuer's: along the streets to where you are; with you in sight and close, straight to its place beside you. */
  private hunt(dt: number, you: Mover, slot: Slot): Controls {
    const s = this.sim;
    const dist = Math.hypot(you.x - s.x, you.z - s.z);
    this.sightIn -= dt;
    this.byRoad -= dt;
    if (this.sightIn <= 0) {
      this.sightIn = 0.2;
      this.sight = dist < DIRECT && this.byRoad <= 0 && this.clearTo(you.x, you.z);
    }
    if (this.sight) {
      this.mode = 'direct';
      this.pilot = null;
      return pursue(s, you, slot, 34 * this.def.pace * this.limp, this.wallAhead());
    }
    this.mode = 'route';
    const pace = this.def.pace * this.limp * (dist > 140 ? 1.2 : 1.06);
    const p = this.pilot;
    // (To where you'll be in a moment, planned again as you move: often when it's close, now and then from far off.)
    const lead = Math.min(40, Math.max(0, you.u) * 1.5);
    const gx = you.x + Math.sin(you.h) * lead;
    const gz = you.z + Math.cos(you.h) * lead;
    const moved = !this.goal || Math.hypot(this.goal[0] - gx, this.goal[1] - gz) > (dist > 120 ? 45 : 14);
    if ((!p || p.arrived || p.blockedFor > 2.5 || moved) && this.replanIn <= 0) {
      this.replanIn = dist > 120 ? 2.2 : 1.1;
      if (!this.plan(gx, gz, pace) && !this.plan(you.x, you.z, pace) && !this.pilot) return pursue(s, you, slot, 20, this.wallAhead());
    }
    if (!this.pilot) return pursue(s, you, slot, 20, this.wallAhead());
    this.pilot.pace = pace;
    const c = this.pilot.step(dt, s, this.world.grip());
    // (The route ends where you were: it doesn't pull in there.)
    return this.pilot.arrived ? pursue(s, you, slot, 20, this.wallAhead()) : c;
  }

  /**
   * One step. `role`: a runner, a pursuer, or a roadblock's car (stood across the road with its brakes on); `you`: your car; `slot`: a pursuer's place about you; `held`: on the
   * grid through the countdown; `gdt`: the world's step (slow motion), `dt` real time for its sound.
   */
  update(gdt: number, role: 'run' | 'hunt' | 'block', you: Mover, slot: Slot, held: boolean, camera: THREE.Vector3, lamps: number): void {
    // (Its mark in your mirrors: bigger the further off, so it's a few pixels of red at any distance.)
    const size = THREE.MathUtils.clamp(Math.hypot(you.x - this.sim.x, you.z - this.sim.z) / 13, 0.8, 6);
    this.tag.scale.setScalar(size);
    this.tag.position.y = 1.55 + size * 0.5;
    const s = this.sim;
    this.knock = 0;
    this.replanIn -= gdt;
    this.refreshNear(gdt);
    let c: Controls;
    if (this.out) {
      this.mode = 'out';
      this.outFor += gdt;
      c = { throttle: 0, brake: 0.4, steer: 0, handbrake: false };
    } else if (role === 'block') {
      this.mode = 'held';
      c = { throttle: 0, brake: 1, steer: 0, handbrake: true };
    } else if (held) {
      this.mode = 'held';
      c = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    } else if (this.backing > 0) {
      // Backing out of where it was held up, the wheel over so the nose comes round.
      this.backing -= gdt;
      this.mode = 'backing';
      const behind = this.probe(s.x - Math.sin(s.h) * (HL + 1.2), s.z - Math.cos(s.h) * (HL + 1.2), HW) === 'wall';
      if (behind) this.backing = 0;
      c = { throttle: 0, brake: behind ? 0 : 1, steer: this.backSteer, handbrake: false };
    } else {
      this.mode = 'route';
      c = role === 'run' ? this.flee(gdt, you) : this.hunt(gdt, you, slot);
      // Standing when it wants to go (nose against a wall, wedged among parked cars): back out and try again.
      const wants = c.throttle > 0.2 && !c.handbrake;
      this.stuck = wants && Math.abs(s.u) < 0.8 ? this.stuck + gdt : 0;
      if (this.stuck > 1.4) {
        this.stuck = 0;
        this.backing = 1.5;
        this.backSteer = c.steer > 0 ? -1 : 1;
        this.pilot = null;
        this.replanIn = 0;
        // (Held up driving straight at you: round by the road for a while.)
        if ((this.mode as string) === 'direct') this.byRoad = 5;
      }
    }
    this.stalled = !this.out && !held && Math.abs(s.u) < 2 ? this.stalled + gdt : 0;
    // Held up behind the traffic (a queue at a light): it doesn't wait, it shoves through.
    const queued = !!this.pilot && this.pilot.status === 'following' && Math.abs(s.u) < 3;
    this.queued = queued ? this.queued + gdt : 0;
    if (this.pilot && this.queued > 0.8) this.pilot.shove = 4;
    // The same with something standing in its way that it can't get round (cars parked both sides): through it.
    const blocked = !!this.pilot && this.pilot.status === 'in the way' && Math.abs(s.u) < 2;
    this.blocked = blocked ? this.blocked + gdt : 0;
    this.barge = this.blocked > 0.8 ? 4 : Math.max(0, this.barge - gdt);
    this.throttle = c.throttle;
    s.update(gdt, c, this.ground);
    if (held) s.u = s.w = s.r = 0;
    // (A roadblock's car stays where it was put, creeping on a slope included; a hard knock still sends it rolling.)
    else if (role === 'block' && Math.abs(s.u) < 2 && Math.abs(s.w) < 2) s.u = s.w = s.r = 0;
    if (s.bump > 0) this.knock = s.bump;
    this.plough(gdt);
    this.pose(gdt, lamps);
    const d = Math.hypot(s.x - camera.x, s.y - camera.y, s.z - camera.z);
    this.sound.setVolume(Math.max(0, 1 - d / 150) ** 1.5 * 0.85);
    this.sound.update(gdt, { rev: s.rev, gear: s.gear, throttle: this.throttle, speed: s.speed, slide: s.slide, spin: s.spin, bump: 0, boost: s.boost, turbo: !!s.spec.turbo });
  }

  /** Through what isn't a wall (cars, poles, hedges, people): a knock on the way in, and drag while it's in it. */
  private plough(dt: number): void {
    const s = this.sim;
    const fx = Math.sin(s.h);
    const fz = Math.cos(s.h);
    let k: HitKind | null = null;
    for (const f of PROBES) {
      const q = this.probe(s.x + fx * f, s.z + fz * f, CL + 0.25);
      if (q && q !== 'wall' && (!k || q === 'car')) k = q;
    }
    if (k && !this.touching && s.speed > 4) {
      const cut = k === 'soft' ? 0.04 : 0.14;
      if (k !== 'soft' && s.speed > 9) this.knock = Math.max(this.knock, s.speed * 0.45);
      s.u *= 1 - cut;
      s.w *= 1 - cut;
    }
    this.touching = !!k;
    if (k && s.speed > 0.1) {
      const drag = Math.max(0, 1 - ((k === 'soft' ? 1.5 : 3) * dt) / s.speed);
      s.u *= drag;
      s.w *= drag;
    }
  }

  private pose(dt: number, lamps: number): void {
    poseCar(this.view, this.sim, this.ground);
    turnWheels(this.view, this.sim, dt);
    setLamps(this.view, { head: lamps > 0.3 && !this.out, tail: lamps > 0.3 });
    lampsByMotion(this.view, this.sim);
  }

  /** What a car is built as: a pooled one can only be given another def of the same key (its model, paint and whether it has a gunman). */
  static key(def: ChaseCarDef): string {
    return `${def.type}|${def.paint}|${def.gunman}`;
  }

  /**
   * Put a retired car back to work as `def` (district/cityChase.ts keeps them in a pool: building one is 25-40 ms of
   * geometry): as new, with the holes and cracks and broken glass mended, its driver and gunman alive, nothing it
   * was doing before remembered.
   */
  rebind(def: ChaseCarDef, id: string): void {
    this.def = def;
    this.id = id;
    this.sim = new Car(specFor(def), CITY_ASSISTS);
    for (const v of this.volumes) v.userData.id = id;
    this.world.gunfire.carHits.mend(this.view.obj);
    this.marks.clear();
    this.arm.visible = false;
    this.tag.visible = true;
    this.trigger = new Trigger();
    this.pilot = null;
    this.goal = null;
    this.replanIn = this.sightIn = this.byRoad = this.stuck = this.backing = this.stalled = this.queued = this.blocked = this.barge = 0;
    this.sight = false;
    this.touching = false;
    this.throttle = this.knock = this.outFor = 0;
    this.out = false;
    this.limp = 1;
    this.mode = 'held';
    this.nearCache = null;
    this.nearAge = Math.random() * NEAR_KEEP;
    this.view.obj.visible = true;
  }

  /** Off the street but kept (its sound silent, its holes cleared): `rebind` brings it back. */
  retire(): void {
    this.sound.setVolume(0);
    this.marks.clear();
    this.arm.visible = false;
    this.view.obj.removeFromParent();
  }

  /** For the shader warm-up (CityChase.warmUp): everything it only shows in time (his arm, its mirror tag, a hole) shown, or put away. */
  warm(on: boolean): void {
    this.arm.visible = on;
    this.tag.visible = on;
    if (on) this.marks.add(new THREE.Vector3(this.sim.x, this.sim.y + 0.8, this.sim.z), new THREE.Vector3(0, 1, 0), 'bullet');
    else this.marks.clear();
  }

  /** A tyre's shot out: it swerves, and limps on slower and loose at the back. */
  blowTyre(): void {
    this.limp = LIMP;
    this.sim.r += (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 0.8);
    this.sim.gripMul = [0.85, 0.6];
  }

  /** Done for (shot to pieces, its driver shot, its tyres gone, wrecked): it rolls to a stop. */
  finish(): void {
    if (this.out) return;
    this.out = true;
    this.pilot = null;
    this.arm.visible = false;
    this.tag.visible = false;
  }

  /** One of your rounds struck it: the hole it leaves (not on a head: that's inside). */
  mark(h: BodyHit): void {
    if (h.object.userData.part !== 'head') this.marks.add(h.point, h.normal, 'bullet');
  }

  /**
   * Its gunman (the passenger seat, on the left: that window is his wide side): he shoots when he has a line on your
   * car's cabin through a window, within range, after a moment to bring the gun up; missing by more the further off
   * and the faster you both go. `alive`: he still can. `bodies`: what his rounds strike (your car's hit volumes).
   */
  shoot(dt: number, alive: boolean, you: THREE.Object3D, yourSpeed: number, bodies: readonly THREE.Object3D[], listener: THREE.Vector3): void {
    if (!alive || this.out) {
      this.arm.visible = false;
      return;
    }
    const obj = this.view.obj;
    obj.updateMatrixWorld();
    you.updateMatrixWorld();
    const eye = obj.localToWorld(new THREE.Vector3(-EYE.x, EYE.y, EYE.z));
    const at = you.localToWorld(new THREE.Vector3(0, 0.95, 0.1));
    const dist = eye.distanceTo(at);
    const dl = at.clone().sub(eye).applyQuaternion(obj.quaternion.clone().invert()).normalize();
    // (The driver's windows, mirrored to the left seat.)
    const side = sideFor(-Math.atan2(dl.x, dl.z), Math.asin(THREE.MathUtils.clamp(dl.y, -1, 1)));
    const line = !!side && dist < GUNMAN.range;
    const fire = this.trigger.step(dt, line);
    if (!line) {
      if (this.trigger.raised <= 0) this.arm.visible = false;
      return;
    }
    const miss = missBy(dist, yourSpeed + this.sim.speed, side === 'across', this.def.aim);
    const aim = at.clone().add(new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).multiplyScalar(miss * 2));
    // His arm out of his window (or, across the car, held inside toward the far one).
    this.arm.visible = true;
    if (side === 'driver') {
      const w = new THREE.Vector3(0.95, 1.02, 0.1);
      const d = obj.worldToLocal(aim.clone()).sub(w).normalize();
      this.arm.position.copy(w).addScaledVector(d, 0.32);
    } else this.arm.position.set(-EYE.x - 0.2, EYE.y - 0.2, EYE.z + 0.45);
    this.arm.lookAt(aim);
    if (!fire) return;
    const muzzle = this.arm.localToWorld(new THREE.Vector3(0, 0.04, 0.2));
    const c = this.sim;
    const vel = new THREE.Vector3(Math.sin(c.h) * c.u + Math.cos(c.h) * c.w, 0, Math.cos(c.h) * c.u - Math.sin(c.h) * c.w);
    this.world.gunfire.shot({ muzzle, dir: aim.clone().sub(muzzle), spread: 0.006, sound: 'pistol', listener, bodies, skipOwn: true, by: this.id, vel });
  }

  /** Off the street: its model and its sound gone. */
  dispose(): void {
    this.sound.setVolume(0);
    idleSounds.push(this.sound);
    this.marks.clear();
    this.view.obj.removeFromParent();
    // (Its own geometry: the body, the side windows, the lamps. The wheels' and the wipers' are shared.)
    this.view.body.geometry.dispose();
    for (const m of [this.view.windows.left, this.view.windows.right, ...Object.values(this.view.lamps)]) m?.geometry.dispose();
  }
}
