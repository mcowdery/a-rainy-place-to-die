import { OBSTACLE_R, type District } from './world';

type Hit = ReturnType<District['obstacle']>;

/**
 * `District.obstacle` for a vehicle that probes many times a frame near one place (your car, your bikes): it costs
 * ~40-65 us a call (nine cells' buildings, medians, solids, every stamp's colliders and every prop), the largest single
 * function in a CPU profile of driving. This gathers what is within `pad` of the first probe once (`obstacleNear`:
 * ~0.2 us a probe, identical answers: tests/obstacleNear.test.ts, tests/nearProbe.test.ts) and answers from that,
 * gathering again when it is a second old (the props of a chunk that loads later aren't in it, and the car has moved
 * on). A probe outside what was gathered, or with a radius over `OBSTACLE_R`, takes the slow way; a probe outside it
 * that finds the gathering a quarter-second old gathers again round itself, so a far probe now and then doesn't make
 * every other probe slow. The chase cars keep their own (`ChaseCar.refreshNear`).
 */
export class NearObstacle {
  private fn: ((x: number, z: number, r: number) => Hit) | null = null;
  private cx = 0;
  private cz = 0;
  private at = -1e9;
  /** Gatherings made, and probes answered the slow way (for checks). */
  gathers = 0;
  slow = 0;

  constructor(
    private readonly district: Pick<District, 'obstacle' | 'obstacleNear'>,
    private readonly pad = 110,
    private readonly keepMs = 1000,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** `District.obstacle(x, z, r)`. */
  readonly probe = (x: number, z: number, r: number): Hit => {
    if (r > OBSTACLE_R) {
      this.slow++;
      return this.district.obstacle(x, z, r);
    }
    const t = this.now();
    const reach = this.pad - 3;
    const inside = this.fn !== null && Math.abs(x - this.cx) < reach && Math.abs(z - this.cz) < reach;
    const age = t - this.at;
    if (!this.fn || age > this.keepMs || (!inside && age > 250)) {
      this.fn = this.district.obstacleNear(x, z, this.pad);
      this.cx = x;
      this.cz = z;
      this.at = t;
      this.gathers++;
    } else if (!inside) {
      this.slow++;
      return this.district.obstacle(x, z, r);
    }
    return this.fn(x, z, r);
  };
}
