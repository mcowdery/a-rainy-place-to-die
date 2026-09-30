import type { CourseDef } from './course';

/**
 * Drift attack (a wharf venue's scored run: the course's `drift`): zones laid out round the lot, to drift through
 * in order against the clock, like clipping zones at a drift event. After a 3-2-1, drift points (angle x speed, as
 * free drive scores them) count only inside the zone that's up, times its multiplier; leaving a zone you've been
 * in moves on to the next (reaching a later one skips those between, for nothing). Done when the last is left or
 * the time runs out: the score, a rank against the venue's [C, B, A, S], and the best kept in the browser. Pure.
 */
export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';
export type AttackPhase = 'countdown' | 'running' | 'finished';

export class DriftAttack {
  phase: AttackPhase = 'countdown';
  countdown = 3.5;
  t = 0;
  /** The zone that's up (all done: zones.length). */
  zone = 0;
  /** Points scored in each zone. */
  readonly points: number[];
  private inside = false;

  constructor(readonly def: NonNullable<CourseDef['drift']>) {
    this.points = def.zones.map(() => 0);
  }

  get score(): number {
    return Math.round(this.points.reduce((a, b) => a + b, 0));
  }

  get timeLeft(): number {
    return Math.max(0, this.def.time - this.t);
  }

  /**
   * One step (dt real seconds): where the car is, and the drift points it made this step. Returns the zone just
   * finished (its index and points), if one was.
   */
  update(dt: number, x: number, z: number, points: number): { zone: number; points: number } | null {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'running';
      return null;
    }
    if (this.phase !== 'running') return null;
    this.t += dt;
    const zs = this.def.zones;
    // A later zone reached first: the ones between are passed for nothing.
    for (let k = zs.length - 1; k > this.zone; k--) {
      if (Math.hypot(x - zs[k].at[0], z - zs[k].at[1]) < zs[k].r) {
        this.zone = k;
        this.inside = false;
        break;
      }
    }
    let done: { zone: number; points: number } | null = null;
    const zn = zs[this.zone];
    const inZone = Math.hypot(x - zn.at[0], z - zn.at[1]) < zn.r;
    if (inZone) this.points[this.zone] += points * zn.mult;
    if (this.inside && !inZone) {
      done = { zone: this.zone, points: Math.round(this.points[this.zone]) };
      this.zone++;
    }
    this.inside = inZone && this.zone < zs.length;
    if (this.zone >= zs.length || this.t >= this.def.time) this.phase = 'finished';
    return done;
  }
}

export function rankFor(score: number, ranks: readonly [number, number, number, number]): Rank {
  return score >= ranks[3] ? 'S' : score >= ranks[2] ? 'A' : score >= ranks[1] ? 'B' : score >= ranks[0] ? 'C' : 'D';
}

/** What a rank pays (yen). */
export const ATTACK_PAY: Readonly<Record<Rank, number>> = { S: 40000, A: 24000, B: 12000, C: 5000, D: 1000 };

const key = (venue: string): string => `citypop.race.v1.${venue}.drift`;

export function loadAttackBest(venue: string): { score: number; rank: Rank } | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(venue)) ?? 'null') as { score: number; rank: Rank } | null;
    return v && Number.isFinite(v.score) ? v : null;
  } catch {
    return null;
  }
}

export function saveAttackBest(venue: string, best: { score: number; rank: Rank }): void {
  try {
    localStorage.setItem(key(venue), JSON.stringify(best));
  } catch {
    /* storage blocked */
  }
}
