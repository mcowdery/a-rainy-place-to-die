/**
 * A ride's timeline (pure; the elevated and subway rides share it): from the doors closing at the first stop,
 * runs to each stop with a dwell at the ones between (doors opening and closing), to the last, where the doors
 * stay open until you get off; then the train shuts its doors and pulls away. s is along the line; the stops'
 * order gives the direction.
 */

export interface RideStop {
  readonly s: number;
  readonly key: string;
  readonly jp: string;
  readonly en: string;
  readonly code?: string;
}

export interface RunProfile {
  readonly T: number;
  at(t: number): number;
}

/** Doors: seconds to open, to close, and how long before leaving they start closing. */
const OPEN = 1.6;
const CLOSE = 1.8;
/** Before the first run: the doors close over the start (t from START to 0). */
export const START = -4;

type Leg = { kind: 'run'; from: RideStop; to: RideStop; T: number; at: (t: number) => number } | { kind: 'wait'; stop: RideStop; T: number };

export interface RideState {
  /** Where the train is along the line. */
  readonly s: number;
  /** How open the doors are (0 shut, 1 open). */
  readonly doors: number;
  /** The stop it's standing at (doors may be opening, open or closing), if any. */
  readonly at: RideStop | null;
  /** The next stop it's running to (or standing at, once there). */
  readonly next: RideStop | null;
  /** At the last stop, doors open: you can get off (and the train waits for you). */
  readonly arrived: boolean;
  /** Pulling away after you got off: hide it once it's gone (`gone`). */
  readonly leaving: boolean;
  readonly gone: boolean;
}

export type RideEvent = { kind: 'depart'; stop: RideStop } | { kind: 'arrive'; stop: RideStop } | { kind: 'doors'; open: boolean };

/** Pulling away after you get off. */
const ACCEL = 1.0;
const VMAX = 17;

export class RideTimeline {
  private readonly legs: Leg[] = [];
  /** The runs and dwells' total (the doors start opening at the last stop then). */
  readonly T: number;
  t = START;
  private leave: { t: number; s: number } | null = null;
  private lastLeg = -1;
  private doorsWere = 1;

  constructor(
    readonly stops: readonly RideStop[],
    run: (d: number) => RunProfile,
    readonly dwell: number,
  ) {
    for (let i = 0; i + 1 < stops.length; i++) {
      const r = run(Math.abs(stops[i + 1].s - stops[i].s));
      this.legs.push({ kind: 'run', from: stops[i], to: stops[i + 1], T: r.T, at: (t) => r.at(t) });
      if (i + 2 < stops.length) this.legs.push({ kind: 'wait', stop: stops[i + 1], T: dwell });
    }
    this.T = this.legs.reduce((a, l) => a + l.T, 0);
  }

  get dir(): number {
    return Math.sign(this.stops[this.stops.length - 1].s - this.stops[0].s) || 1;
  }

  /** Jump to the arrival at the last stop (doors about to open). */
  skip(): void {
    if (!this.leave) this.t = Math.max(this.t, this.T);
  }

  /** You got off: the doors shut and the train pulls away from where it is. */
  alight(): void {
    if (this.leave) return;
    this.leave = { t: 0, s: this.state().s };
  }

  /** Advances the clock; returns what happened (departures, arrivals, the doors). */
  advance(dt: number): RideEvent[] {
    const out: RideEvent[] = [];
    if (this.leave) this.leave.t += dt;
    else this.t += dt;
    // Departures and arrivals as the legs change.
    let acc = 0;
    let leg = -1;
    for (let i = 0; i < this.legs.length; i++) {
      if (this.t >= acc) leg = i;
      acc += this.legs[i].T;
    }
    if (this.t >= this.T) leg = this.legs.length;
    while (this.lastLeg < leg) {
      this.lastLeg++;
      const l = this.legs[this.lastLeg - 1];
      if (this.lastLeg === 0) out.push({ kind: 'depart', stop: this.stops[0] });
      else if (l?.kind === 'run') out.push({ kind: 'arrive', stop: l.to });
      else if (l?.kind === 'wait') out.push({ kind: 'depart', stop: l.stop });
    }
    const d = this.state().doors;
    if (d >= 1 && this.doorsWere < 1) out.push({ kind: 'doors', open: true });
    if (d <= 0 && this.doorsWere > 0) out.push({ kind: 'doors', open: false });
    this.doorsWere = d;
    return out;
  }

  state(): RideState {
    const last = this.stops[this.stops.length - 1];
    if (this.leave) {
      const lt = this.leave.t;
      const doors = Math.max(0, 1 - lt / CLOSE);
      const moving = Math.max(0, lt - CLOSE - 1);
      const tA = VMAX / ACCEL;
      const d = moving < tA ? 0.5 * ACCEL * moving * moving : 0.5 * VMAX * tA + VMAX * (moving - tA);
      return { s: this.leave.s + this.dir * d, doors, at: null, next: null, arrived: false, leaving: true, gone: lt > 28 };
    }
    const t = this.t;
    if (t < 0) {
      // At the first stop, the doors closing.
      const doors = Math.max(0, Math.min(1, -t / CLOSE));
      return { s: this.stops[0].s, doors, at: this.stops[0], next: this.stops[1] ?? null, arrived: false, leaving: false, gone: false };
    }
    if (t >= this.T) {
      const doors = Math.min(1, (t - this.T) / OPEN);
      return { s: last.s, doors, at: last, next: last, arrived: doors >= 1, leaving: false, gone: false };
    }
    let rest = t;
    for (const l of this.legs) {
      if (rest < l.T) {
        if (l.kind === 'run') return { s: l.from.s + Math.sign(l.to.s - l.from.s) * l.at(rest), doors: 0, at: null, next: l.to, arrived: false, leaving: false, gone: false };
        const doors = Math.max(0, Math.min(1, rest / OPEN, (l.T - rest - 0.5) / CLOSE));
        return { s: l.stop.s, doors, at: l.stop, next: l.stop, arrived: false, leaving: false, gone: false };
      }
      rest -= l.T;
    }
    return { s: last.s, doors: 0, at: last, next: last, arrived: false, leaving: false, gone: false };
  }
}

/** How open a standing train's doors are, `rest` seconds into a dwell of T (any train at a station). */
export function dwellDoors(rest: number, T: number): number {
  return Math.max(0, Math.min(1, rest / OPEN, (T - rest - 0.5) / CLOSE));
}
