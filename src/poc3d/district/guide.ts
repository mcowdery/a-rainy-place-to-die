import { type NavMode, onRoute, type Router } from './gps';

/** Where the GPS routes from, and how you're getting about. */
export interface GuideFrom {
  readonly x: number;
  readonly z: number;
  readonly mode: NavMode;
}

export interface GuideDest {
  readonly x: number;
  readonly z: number;
  readonly label: string;
}

/**
 * The GPS's state, shared by everything that shows it (the M map, the phone's Maps app, the chevrons and
 * compass in the world): the destination, the route to it for the way you're getting about (on foot or
 * driving: gps.ts has a grid for each), rerouting when you stray or get in or out of a car, and arrival.
 */
export class Guide {
  dest: GuideDest | null = null;
  route: [number, number][] | null = null;
  /** The way the current route is for. */
  mode: NavMode = 'walk';
  private routedAt = -Infinity;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly grid: (mode: NavMode) => Router,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Called when the destination or the route changes. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  set(dest: GuideDest | null, from: GuideFrom): void {
    this.dest = dest;
    this.route = null;
    if (dest) this.reroute(from);
    else this.changed();
  }

  reroute(from: GuideFrom): void {
    if (!this.dest) return;
    this.mode = from.mode;
    this.route = this.grid(from.mode).route(from.x, from.z, this.dest.x, this.dest.z);
    this.routedAt = this.now();
    this.changed();
  }

  /**
   * Per frame: where you are on the route (null without one), rerouting if you've strayed more than `stray`
   * metres (at most every 1.5 s) or changed how you're getting about; `arrived` (and the destination cleared)
   * within `arrive` metres of it.
   */
  update(from: GuideFrom, stray = 15, arrive = 12): { at: ReturnType<typeof onRoute> | null; direct: number; arrived: GuideDest | null } | null {
    const d = this.dest;
    if (!d) return null;
    const direct = Math.hypot(d.x - from.x, d.z - from.z);
    if (direct < arrive) {
      this.set(null, from);
      return { at: null, direct, arrived: d };
    }
    if (from.mode !== this.mode) this.reroute(from);
    let at = this.route ? onRoute(this.route, from.x, from.z) : null;
    if (at && at.off > stray && this.now() - this.routedAt > 1500) {
      this.reroute(from);
      at = this.route ? onRoute(this.route, from.x, from.z) : null;
    }
    return { at, direct, arrived: null };
  }
}
