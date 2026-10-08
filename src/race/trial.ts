import type { Course } from './course';

/**
 * Time trials on a venue's pass, up it or down it: a standing start on the grid behind the line, a 3-2-1
 * countdown with the car held, the clock from GO, three checkpoints (splits, compared with your best run's),
 * and the finish: into the viewpoint going up, back into the lot going down. Progress is the car's place along
 * the road (its nearest road sample), and checkpoints only count in order, from close by, so the finish can't
 * be reached by skipping any. Pure (no DOM, no three), so the tests drive it.
 */

export type Dir = 'up' | 'down';

export interface TrialPlan {
  readonly dir: Dir;
  /** Road samples: where the car waits (facing the way the run goes), the checkpoints in order, the finish. */
  readonly grid: number;
  readonly checkpoints: readonly number[];
  readonly finish: number;
}

export function trialPlan(c: Course, dir: Dir): TrialPlan {
  const top = c.summitStart;
  const grid = dir === 'up' ? 20 : top - 3;
  const finish = dir === 'up' ? top : 12;
  const checkpoints = [0.25, 0.5, 0.75].map((f) => Math.round(grid + (finish - grid) * f));
  return { dir, grid, checkpoints, finish };
}

export type TrialEvent = { readonly kind: 'go' } | { readonly kind: 'split'; readonly n: number; readonly t: number } | { readonly kind: 'finish'; readonly t: number };

export class Trial {
  phase: 'countdown' | 'running' | 'finished' = 'countdown';
  /** Seconds left of the countdown. */
  count = 3;
  /** The run's time (s) and the checkpoints passed (their times). */
  t = 0;
  readonly splits: number[] = [];

  constructor(readonly plan: TrialPlan) {}

  /** A step of real time; `i` is the car's road sample (-1 off the road). */
  update(dt: number, i: number): TrialEvent[] {
    const ev: TrialEvent[] = [];
    if (this.phase === 'countdown') {
      this.count -= dt;
      if (this.count <= 0) {
        this.count = 0;
        this.phase = 'running';
        ev.push({ kind: 'go' });
      }
      return ev;
    }
    if (this.phase !== 'running') return ev;
    this.t += dt;
    if (i < 0) return ev;
    const up = this.plan.dir === 'up';
    // Past a mark, and not far past it (the nearest sample can't jump across a hairpin to count it).
    const passed = (k: number): boolean => (up ? i >= k && i - k < 60 : i <= k && k - i < 60);
    const cps = this.plan.checkpoints;
    if (this.splits.length < cps.length && passed(cps[this.splits.length])) {
      this.splits.push(this.t);
      ev.push({ kind: 'split', n: this.splits.length, t: this.t });
    }
    if (this.splits.length === cps.length && (up ? i >= this.plan.finish : i <= this.plan.finish)) {
      this.phase = 'finished';
      ev.push({ kind: 'finish', t: this.t });
    }
    return ev;
  }
}

export type Medal = 'gold' | 'silver' | 'bronze';

/** The medal a time earns against [bronze, silver, gold] times, or null. */
export function medalFor(t: number, times: readonly [number, number, number]): Medal | null {
  return t <= times[2] ? 'gold' : t <= times[1] ? 'silver' : t <= times[0] ? 'bronze' : null;
}

/** m:ss.cc */
export const clock = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

/**
 * A run recorded for its ghost: the car's position and heading 20 times a second from GO, and where it is at
 * any time between (interpolated).
 */
export class GhostTrack {
  static readonly RATE = 20;
  readonly data: number[];

  constructor(data: number[] = []) {
    this.data = data;
  }

  /** Record the car at run time t (samples are taken as t passes each 1/20 s). */
  record(t: number, x: number, y: number, z: number, h: number): void {
    while (this.data.length / 4 <= t * GhostTrack.RATE) this.data.push(round(x), round(y), round(z), round(h, 1000));
  }

  get duration(): number {
    return Math.max(0, this.data.length / 4 - 1) / GhostTrack.RATE;
  }

  /** Where the ghost is at time t: {x, y, z, h}, or null past its end. */
  at(t: number): { x: number; y: number; z: number; h: number } | null {
    const n = this.data.length / 4;
    if (n < 2 || t < 0) return null;
    const f = t * GhostTrack.RATE;
    if (f > n - 1) return null;
    const i = Math.min(n - 2, Math.floor(f));
    const k = f - i;
    const d = this.data;
    const lerp = (a: number, b: number): number => a + (b - a) * k;
    let dh = d[i * 4 + 7] - d[i * 4 + 3];
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return { x: lerp(d[i * 4], d[i * 4 + 4]), y: lerp(d[i * 4 + 1], d[i * 4 + 5]), z: lerp(d[i * 4 + 2], d[i * 4 + 6]), h: d[i * 4 + 3] + dh * k };
  }
}

const round = (v: number, k = 100): number => Math.round(v * k) / k;

/** A venue and direction's best run, as kept in the browser. */
export interface BestRun {
  readonly time: number;
  readonly splits: readonly number[];
  readonly ghost: readonly number[];
}

const key = (venue: string, dir: Dir): string => `rainyplace.race.v1.${venue}.${dir}`;

export function loadBest(venue: string, dir: Dir): BestRun | null {
  try {
    const s = localStorage.getItem(key(venue, dir));
    if (!s) return null;
    const b = JSON.parse(s) as BestRun;
    return typeof b.time === 'number' && Array.isArray(b.splits) && Array.isArray(b.ghost) ? b : null;
  } catch {
    return null;
  }
}

export function saveBest(venue: string, dir: Dir, run: BestRun): void {
  try {
    localStorage.setItem(key(venue, dir), JSON.stringify(run));
  } catch {
    /* storage blocked or full: the best lasts this session */
  }
}
