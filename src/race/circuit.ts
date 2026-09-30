import type { Course } from './course';

/**
 * A race round a circuit (a course of kind circuit): a standing start from the grid behind the line, a 3-2-1
 * countdown with every car held, then laps. Each car's progress is the distance it has covered along the road
 * (its nearest road sample, unwrapped round the loop as it goes, so it counts laps; a jump of more than a few
 * metres, off the track or across it where two parts run close, is ignored), its lap times and its place; the
 * race ends for a car when it crosses the line after the last lap, and for everyone once you finish (the rest
 * are placed by how far round they are). Pure (no DOM, no three), so the tests drive it.
 */

export interface Racer {
  readonly name: string;
  /** Distance covered from the start line (m; negative on the grid behind it). */
  dist: number;
  /** The road sample it was last at. */
  at: number;
  /** Laps completed, and when each was (race time, s). */
  laps: number;
  readonly lapTimes: number[];
  /** Race time at the finish (s), or null. */
  finished: number | null;
}

export interface GridSlot {
  /** Road sample, and the offset left of the centre line (m). */
  readonly i: number;
  readonly lane: number;
}

export type RaceEvent =
  | { readonly kind: 'go' }
  | { readonly kind: 'lap'; readonly car: number; readonly lap: number; readonly time: number; readonly best: boolean }
  | { readonly kind: 'finish'; readonly car: number; readonly place: number; readonly time: number };

/** The grid: two by two behind the line (8 m a row, the second car of a row staggered back 4 m), n cars. */
export function gridSlots(c: Course, start: number, n: number, lane = 2.6): GridSlot[] {
  const line = c.wrap(Math.round(start));
  return [...Array(n).keys()].map((k) => ({ i: c.wrap(line - 10 - Math.floor(k / 2) * 8 - (k % 2) * 4), lane: k % 2 === 0 ? lane : -lane }));
}

export class CircuitRace {
  phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  count = 3;
  t = 0;
  readonly racers: Racer[];
  readonly line: number;

  constructor(
    readonly course: Course,
    readonly laps: number,
    start: number,
    names: readonly string[],
    slots: readonly GridSlot[],
  ) {
    this.line = course.wrap(Math.round(start));
    const n = course.x.length;
    this.racers = names.map((name, k) => {
      // Behind the line: how far back, as a negative distance.
      const back = (this.line - slots[k].i + n) % n;
      return { name, dist: -back, at: slots[k].i, laps: 0, lapTimes: [], finished: null };
    });
  }

  get length(): number {
    return this.course.length;
  }

  /** The places: finished cars by their time, then the rest by how far round they are. */
  standings(): number[] {
    return this.racers
      .map((r, k) => ({ r, k }))
      .sort((a, b) => {
        if (a.r.finished !== null || b.r.finished !== null) {
          if (a.r.finished === null) return 1;
          if (b.r.finished === null) return -1;
          return a.r.finished - b.r.finished;
        }
        return b.r.dist - a.r.dist;
      })
      .map((x) => x.k);
  }

  placeOf(k: number): number {
    return this.standings().indexOf(k) + 1;
  }

  /** The fastest lap so far by anyone (s), or null. */
  bestLap(): number | null {
    let best: number | null = null;
    for (const r of this.racers) {
      r.lapTimes.forEach((t, i) => {
        const lap = t - (i === 0 ? 0 : r.lapTimes[i - 1]);
        if (best === null || lap < best) best = lap;
      });
    }
    return best;
  }

  /**
   * A step of real time: each car's road sample (-1 off the road). `you` is the player's car (its finish ends the
   * race for everyone).
   */
  update(dt: number, at: readonly number[], you = 0): RaceEvent[] {
    const ev: RaceEvent[] = [];
    if (this.phase === 'countdown') {
      this.count -= dt;
      if (this.count <= 0) {
        this.count = 0;
        this.phase = 'racing';
        ev.push({ kind: 'go' });
      }
      return ev;
    }
    if (this.phase !== 'racing') return ev;
    this.t += dt;
    const n = this.course.x.length;
    this.racers.forEach((r, k) => {
      const i = at[k];
      if (r.finished !== null || i < 0) return;
      let d = i - r.at;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;
      // (A car goes at most a few metres a step: a bigger jump is the nearest sample leaping across.)
      if (Math.abs(d) > 30) return;
      r.at = i;
      r.dist += d;
      // A lap: across the line, the next lap's worth round (backing over the line and on again doesn't count twice).
      while (r.laps < this.laps && r.dist >= (r.laps + 1) * this.length) {
        r.laps++;
        r.lapTimes.push(this.t);
        const lap = this.t - (r.laps === 1 ? 0 : r.lapTimes[r.laps - 2]);
        const best = this.bestLap() === lap;
        if (r.laps < this.laps) ev.push({ kind: 'lap', car: k, lap: r.laps, time: lap, best });
        else {
          r.finished = this.t;
          ev.push({ kind: 'finish', car: k, place: this.racers.filter((q) => q.finished !== null).length, time: this.t });
        }
      }
    });
    if (this.racers[you].finished !== null) this.phase = 'finished';
    return ev;
  }

  /** Ends the race now (you gave up, or you're wrecked): places as they stand. */
  end(): void {
    this.phase = 'finished';
  }
}
