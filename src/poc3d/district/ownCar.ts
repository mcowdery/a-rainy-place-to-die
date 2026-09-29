import * as THREE from 'three';
import { model, tunedSpec } from '../../race/catalog';
import { buildCar, poseCar, turnWheels, type CarView } from '../../race/carView';
import { currentCar, loadProfile } from '../../race/profile';
import { CarSound } from '../../race/sound';
import { Car, ROAD_ASSISTS, type Assists, type Controls, type Ground } from '../../race/vehicle';
import type { DrivenVehicle, TrafficSystem } from '../real/traffic';
import type { Expressway } from './expressway';

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
 * The racing model wants a Ground. On the street: height 0, and walls from `blocked` (buildings, props,
 * other vehicles, people, the expressway's piers and ramp sides): a car corner that finds itself inside one
 * is pushed out the shortest way. On the expressway (district/expressway.ts; up a ramp from its foot, or
 * anywhere once you're above the street): its height, its parapets (a corner off the network is pushed back
 * on) and the cars in its traffic (`deckObstacles`).
 */

/** The city: road assists, but with room to slide (the expressway's long bends). */
export const CITY_ASSISTS: Assists = { ...ROAD_ASSISTS, maxSlide: (38 * Math.PI) / 180 };

const SAVE_KEY = 'citypop.city.car';
const DIRS = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)] as const);

export class OwnCar {
  readonly sim: Car;
  readonly view: CarView;
  readonly vehicle: DrivenVehicle;
  readonly ground: Ground;
  readonly name: string;
  readonly sound = new CarSound();
  private saveT = 0;

  constructor(
    material: THREE.Material,
    traffic: TrafficSystem,
    home: { x: number; z: number; h: number },
    private readonly blocked: (x: number, z: number, r: number, self: DrivenVehicle) => boolean,
    private readonly ex: Expressway | null = null,
    private readonly deckObstacles: () => readonly DeckObstacle[] = () => [],
    atHome = false,
  ) {
    const height = (x: number, z: number): number => this.ex?.at(x, z, this.sim.y)?.height ?? 0;
    const mine = currentCar(loadProfile());
    const m = model(mine.type);
    this.name = `${m.maker} ${m.name}`;
    this.sim = new Car(tunedSpec(mine.type, mine.parts), CITY_ASSISTS);
    this.view = buildCar({ type: mine.type, paint: mine.paint, paint2: mine.paint2, livery: mine.livery, neon: mine.neonFitted ? mine.neon : null }, material);
    this.sound.configure(m.sound);
    const self = (): DrivenVehicle => this.vehicle;
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
        if (this.onExpressway(x, z)) {
          // On the expressway: each corner kept on the network, then the cars on the deck.
          const y = this.sim.y;
          for (const f of [hl - 0.25, -(hl - 0.25)]) {
            for (const s of [hw, -hw]) {
              const p = this.ex!.pushBack(x + fx * f + fz * s, z + fz * f - fx * s, y);
              if (p) return p;
            }
          }
          for (const o of this.deckObstacles()) {
            const ox = x - o.x;
            const oz = z - o.z;
            if (Math.abs(ox) > 7 || Math.abs(oz) > 7) continue;
            for (const f of [hl - hw, 0, -(hl - hw)]) {
              const px = ox + fx * f;
              const pz = oz + fz * f;
              const a = px * o.dx + pz * o.dz;
              const c = px * o.dz - pz * o.dx;
              const oa = o.half + hw - Math.abs(a);
              const oc = o.hw + hw - Math.abs(c);
              if (oa <= 0 || oc <= 0) continue;
              // Out along the shallower overlap.
              if (oc < oa) {
                const s = Math.sign(c) || 1;
                return { px: o.dz * s * oc, pz: -o.dx * s * oc, nx: o.dz * s, nz: -o.dx * s };
              }
              const s = Math.sign(a) || 1;
              return { px: o.dx * s * oa, pz: o.dz * s * oa, nx: o.dx * s, nz: o.dz * s };
            }
          }
          return null;
        }
        // The street: circles along the car; the first one inside something is pushed out the shortest way.
        for (const f of [hl - hw, (hl - hw) / 3, -(hl - hw) / 3, -(hl - hw)]) {
          const cx = x + fx * f;
          const cz = z + fz * f;
          if (!this.blocked(cx, cz, hw, self())) continue;
          for (let d = 0.05; d <= 1.2; d += 0.05) {
            for (const [nx, nz] of DIRS) {
              if (!this.blocked(cx + nx * d, cz + nz * d, hw, self())) return { px: nx * d, pz: nz * d, nx, nz };
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
    if (at !== home && y0 < 1 && this.blocked(at.x, at.z, 0.9, null as unknown as DrivenVehicle)) at = home;
    this.sim.place(at.x, at.z, at.h, this.ground);
    // Left up on the expressway: back up there (its height at that spot).
    this.sim.y = this.ex?.at(at.x, at.z, y0)?.height ?? this.sim.y;
    this.vehicle = traffic.addOwn(this.view.obj, 2.2, 1.8, this.name, at.x, at.z, Math.sin(at.h), Math.cos(at.h));
    this.sync();
    this.pose(0);
  }

  /** Drive a step: the handling model, then the traffic system's copy of where the car is. */
  drive(dt: number, c: Controls): void {
    this.sim.update(dt, c, this.ground);
    this.sync();
    this.saveT += dt;
    if (this.saveT > 5) this.save();
    this.sound.update(dt, { rev: this.sim.rev, gear: this.sim.gear, throttle: c.throttle, speed: this.sim.speed, slide: this.sim.slide, spin: this.sim.spin, bump: this.sim.bump, boost: this.sim.boost, turbo: !!this.sim.spec.turbo });
  }

  /** Every frame: the body on the ground, the wheels turning. */
  pose(dt: number): void {
    poseCar(this.view, this.sim, this.ground);
    turnWheels(this.view, this.sim, dt);
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
