import * as THREE from 'three';
import { model, tunedSpec } from '../../race/catalog';
import { buildCar, poseCar, turnWheels, type CarView } from '../../race/carView';
import { CarSound } from '../../race/sound';
import { Car, type Controls, type Ground } from '../../race/vehicle';
import type { RacePath } from './cityRace';
import type { Expressway } from './expressway';
import { CITY_ASSISTS } from './ownCar';

/**
 * The rival in a city race (district/cityRace.ts): a car on the racing model, on the expressway (its ground the
 * network's height, its walls the parapets), driven along the race's line. It keeps to a lane, changes lanes to get
 * by traffic (and you), follows when both are blocked, slows for the bends by its skill, and pushes when behind.
 * Its engine is heard, louder the nearer it is.
 */
export interface Obstacle {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}

/** The lanes (metres left of the centre line): the expressway's two, as its traffic drives them. */
const LANES = [1.8, -1.8] as const;

export class RaceRival {
  readonly car: Car;
  readonly view: CarView;
  readonly ground: Ground;
  readonly sound = new CarSound();
  /** Progress along the race (metres). */
  s = 0;
  private lane: number = LANES[1];
  private want: number = LANES[1];
  private throttle = 0;

  constructor(
    private readonly path: RacePath,
    private readonly ex: Expressway,
    material: THREE.Material,
    private readonly skill: number,
    look: { type: Parameters<typeof tunedSpec>[0]; paint: number; parts: Parameters<typeof tunedSpec>[1] },
  ) {
    this.car = new Car(tunedSpec(look.type, look.parts), CITY_ASSISTS);
    this.view = buildCar({ type: look.type, paint: look.paint }, material);
    this.sound.configure(model(look.type).sound);
    const car = this.car;
    const height = (x: number, z: number): number => this.ex.at(x, z, car.y)?.height ?? car.y;
    this.ground = {
      height,
      normal: (x, z) => {
        const e = 0.6;
        const n = new THREE.Vector3(-(height(x + e, z) - height(x - e, z)) / (2 * e), 1, -(height(x, z + e) - height(x, z - e)) / (2 * e)).normalize();
        return [n.x, n.y, n.z];
      },
      grip: () => 1,
      collide: (x, z, h, hl, hw) => {
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        for (const f of [hl - 0.25, -(hl - 0.25)]) {
          for (const sd of [hw, -hw]) {
            const p = this.ex.pushBack(x + fx * f + fz * sd, z + fz * f - fx * sd, car.y);
            if (p) return { ...p, friction: 0.998 };
          }
        }
        return null;
      },
    };
  }

  /** On the grid: at s along the line, in a lane. */
  place(s: number, lane: number): void {
    const p = this.path.at(s, lane);
    this.s = s;
    this.lane = this.want = lane;
    this.car.place(p.x, p.z, Math.atan2(p.tx, p.tz), this.ground);
    this.car.y = p.y;
    this.pose(0);
  }

  /** The lateral offset of a point from the line at s (left positive). */
  private lateral(x: number, z: number, s: number): number {
    const p = this.path.at(s);
    return (x - p.x) * p.tz - (z - p.z) * p.tx;
  }

  /**
   * The controls for this step: steer along the lane, a speed for the bend ahead, and for what's ahead in the lane
   * (traffic, you). behind: how far the rival trails you (metres; negative ahead), for its pace.
   */
  private controls(dt: number, others: readonly Obstacle[], behind: number, held: boolean): Controls {
    const car = this.car;
    if (held) return { throttle: 0, brake: 0, steer: 0, handbrake: false };
    const path = this.path;
    // What's in each lane ahead: the nearest thing in it and its speed.
    const inLane = (lane: number, from: number, to: number): { gap: number; v: number } | null => {
      let best: { gap: number; v: number } | null = null;
      for (const o of others) {
        const pr = path.progress(o.x, o.z, this.s);
        if (pr.off > 12) continue;
        const d = pr.s - this.s;
        if (d < from || d > to) continue;
        if (Math.abs(this.lateral(o.x, o.z, pr.s) - lane) > 1.9) continue;
        const p = path.at(pr.s);
        const v = o.vx * p.tx + o.vz * p.tz;
        if (!best || d < best.gap) best = { gap: d, v };
      }
      return best;
    };
    const ahead = inLane(this.want, 0, 55);
    let limit = Infinity;
    if (ahead && ahead.v < car.u - 1) {
      const other = this.want === LANES[0] ? LANES[1] : LANES[0];
      // The other lane clear from just behind to well ahead: move over. Otherwise follow.
      if (!inLane(other, -9, 45)) this.want = other;
      else limit = ahead.v + Math.max(0, ahead.gap - 12) * 0.5;
    }
    // Over to the lane it wants at a steady rate (a lane change takes a couple of seconds).
    this.lane += Math.max(-1.6 * dt, Math.min(1.6 * dt, this.want - this.lane));
    // Pace: a quick driver's cornering (skill), pushing when behind you, easing off far ahead.
    let pace = this.skill;
    if (behind > 60) pace *= 1.06;
    else if (behind < -120) pace *= 0.9;
    const want = Math.min(90, path.safeSpeed(this.s, 160, 8.0 * pace * pace, 7.5 * pace), limit);
    // Steer at a point ahead on the lane.
    const look = 9 + Math.abs(car.u) * 0.55;
    const t = path.at(this.s + look, this.lane);
    const dx = t.x - car.x;
    const dz = t.z - car.z;
    const err = Math.atan2(dx * Math.cos(car.h) - dz * Math.sin(car.h), dx * Math.sin(car.h) + dz * Math.cos(car.h));
    const speedErr = want - car.u;
    const throttle = speedErr > 0 ? Math.min(1, speedErr * 0.4 + 0.3) : 0;
    const brake = speedErr < -2 ? Math.min(1, -speedErr * 0.15) : 0;
    return { throttle, brake, steer: Math.max(-1, Math.min(1, err * 2.6)), handbrake: false };
  }

  /** One step: drive, keep track of where it is, pose the model, and its engine by the camera. */
  update(dt: number, others: readonly Obstacle[], behind: number, held: boolean, camera: THREE.Vector3): void {
    const c = this.controls(dt, others, behind, held);
    this.throttle = c.throttle;
    this.car.update(dt, c, this.ground);
    if (held) this.car.u = this.car.w = this.car.r = 0;
    this.s = this.path.progress(this.car.x, this.car.z, this.s).s;
    this.pose(dt);
    const d = Math.hypot(this.car.x - camera.x, this.car.y - camera.y, this.car.z - camera.z);
    this.sound.setVolume(Math.max(0, 1 - d / 160) ** 1.5 * 0.9);
    this.sound.update(dt, { rev: this.car.rev, gear: this.car.gear, throttle: this.throttle, speed: this.car.speed, slide: this.car.slide, spin: this.car.spin, bump: 0, boost: this.car.boost, turbo: !!this.car.spec.turbo });
  }

  private pose(dt: number): void {
    poseCar(this.view, this.car, this.ground);
    turnWheels(this.view, this.car, dt);
  }

  /** As an obstacle for others (the traffic, you): where it is and how it's moving. */
  get obstacle(): Obstacle {
    const c = this.car;
    return { x: c.x, z: c.z, vx: Math.sin(c.h) * c.u, vz: Math.cos(c.h) * c.u };
  }

  stop(): void {
    this.sound.setVolume(0);
  }
}
