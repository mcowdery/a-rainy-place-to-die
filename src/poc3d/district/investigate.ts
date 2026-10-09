import * as THREE from 'three';

/**
 * Looking, the gun's aim without the gun. In the city the right button raises Mack's aim as ever; with no threat
 * about it raises his attention instead (the same crosshair, as a ring that warms over something he has a word
 * about), and holding the view on that thing for a moment has him say it. When there are enemies about
 * (`Stance.fight`) he is in fight mode and the same button raises the gun. One mechanic, two functions.
 */

/** A line: Mack's own, or someone's (`who`), said only while `when` holds (rain, night). */
export type Line = string | { readonly text: string; readonly who?: string; readonly when?: () => boolean };

/** Something Mack can look at and remark on. */
export interface Inspectable {
  readonly id: string;
  /** Where it is now (a bird moves). */
  at(out: THREE.Vector3): THREE.Vector3 | null;
  /** How big it looks to the eye, metres: the cone of the view that counts as looking at it. */
  readonly radius: number;
  /** What he says; one at a time, each look a different one, in order. */
  readonly lines: readonly Line[];
  /** The crosshair's caption while it is in view (default: none). */
  readonly label?: string;
  /** How far he can make it out (default 90 m). */
  readonly range?: number;
  /**
   * Something he can do to it, if anything: the reticule becomes a hand within `range` (default 2.5 m) and the left
   * button does it. The object says what: its own lines, and `run` for what happens (open, pick up, switch on).
   */
  readonly interact?: { readonly label: string; readonly lines?: readonly Line[]; readonly range?: number; readonly run?: () => void };
  /** Said only if this returns true (a story flag, the hour). */
  readonly when?: () => boolean;
}

/** The ring warms once the view has stayed on a thing this long (s), and he speaks. */
export const DWELL = 0.7;
/** After a remark he says nothing about the same thing for this long (s). */
export const REPEAT = 25;
/** And nothing at all for this long (s), so a sweep over a busy street isn't a stream of talk. */
export const BREATH = 3;

/** Whether Mack is in a fight: any threat registered keeps him in it. */
export class Stance {
  private readonly threats = new Set<string>();
  /** Raise or clear a threat (an enemy in sight, a chase). */
  threat(id: string, on: boolean): void {
    if (on) this.threats.add(id);
    else this.threats.delete(id);
  }
  clear(): void {
    this.threats.clear();
  }
  get fight(): boolean {
    return this.threats.size > 0;
  }
}

export interface LookState {
  /** The thing under the crosshair (null: nothing he has a word for). */
  readonly target: Inspectable | null;
  /** 0..1: how far the dwell has got. */
  readonly progress: number;
  /** He could use it now (it has an `interact` and he is near enough): the reticule is a hand. */
  readonly canUse: boolean;
}

export class Investigator {
  private readonly items = new Map<string, Inspectable>();
  /** Things that come and go with where he is (the props and people about): asked for the nearest every so often. */
  private readonly sources: ((origin: THREE.Vector3) => readonly Inspectable[])[] = [];
  private nearby: readonly Inspectable[] = [];
  private nearbyAge = Infinity;
  private readonly told = new Map<string, number>();
  private readonly spoken = new Map<string, number>();
  private target: Inspectable | null = null;
  private canUse = false;
  private readonly used = new Map<string, number>();
  private dwell = 0;
  private breath = 0;
  private clock = 0;
  private readonly p = new THREE.Vector3();
  private readonly d = new THREE.Vector3();

  /** What he says goes here (a subtitle). */
  constructor(private readonly say: (text: string, id: string, who: string | null) => void) {}

  source(fn: (origin: THREE.Vector3) => readonly Inspectable[]): void {
    this.sources.push(fn);
  }
  /** The lines that apply now, and the n-th of them. */
  private static pick(lines: readonly Line[], n: number): { text: string; who: string | null } | null {
    const ok = lines.filter((l) => typeof l === 'string' || !l.when || l.when());
    if (!ok.length) return null;
    const l = ok[n % ok.length];
    return typeof l === 'string' ? { text: l, who: null } : { text: l.text, who: l.who ?? null };
  }
  add(item: Inspectable): void {
    this.items.set(item.id, item);
  }
  remove(id: string): void {
    this.items.delete(id);
  }

  /**
   * Each frame. `looking`: the right button is held with no gun out. `origin`/`dir`: the eye and the way the view
   * points. `blocked(point)`: something solid between (the world's ray), so he can't see through a wall.
   */
  update(looking: boolean, origin: THREE.Vector3, dir: THREE.Vector3, dt: number, blocked?: (to: THREE.Vector3) => boolean): LookState {
    this.clock += dt;
    this.breath = Math.max(0, this.breath - dt);
    if (!looking) {
      this.target = null;
      this.dwell = 0;
      this.canUse = false;
      return { target: null, progress: 0, canUse: false };
    }
    let best: Inspectable | null = null;
    let bestScore = Infinity;
    let bestDist = 0;
    this.nearbyAge += dt;
    if (this.nearbyAge > 0.4) {
      this.nearbyAge = 0;
      this.nearby = this.sources.flatMap((f) => f(origin));
    }
    for (const it of [...this.items.values(), ...this.nearby]) {
      if (it.when && !it.when()) continue;
      const at = it.at(this.p);
      if (!at) continue;
      this.d.subVectors(at, origin);
      if (this.d.dot(dir) <= 0) continue;
      const dist = this.d.length();
      if (dist < 0.5 || dist > (it.range ?? 90)) continue;
      // The angle off the view's axis against the angle the thing fills (a little leeway, as a crosshair has).
      const off = Math.acos(THREE.MathUtils.clamp(this.d.dot(dir) / dist, -1, 1));
      const reach = Math.atan2(it.radius, dist) + 0.035;
      if (off > reach) continue;
      const score = off / reach;
      if (score < bestScore && !blocked?.(at)) {
        best = it;
        bestScore = score;
        bestDist = dist;
      }
    }
    if (best?.id !== this.target?.id) this.dwell = 0;
    else if (best) this.dwell += dt;
    this.target = best;
    const progress = best ? Math.min(1, this.dwell / DWELL) : 0;
    if (best && this.dwell >= DWELL && this.breath <= 0 && this.clock - (this.spoken.get(best.id) ?? -Infinity) > REPEAT) {
      const n = this.told.get(best.id) ?? 0;
      const line = Investigator.pick(best.lines, n);
      if (line) {
        this.told.set(best.id, n + 1);
        this.spoken.set(best.id, this.clock);
        this.breath = BREATH;
        this.say(line.text, best.id, line.who);
      }
    }
    this.canUse = !!best?.interact && bestDist <= (best.interact.range ?? 2.5);
    return { target: best, progress, canUse: this.canUse };
  }

  /** The left button while looking: do the thing under the hand. Returns whether there was one. */
  use(): boolean {
    const it = this.target?.interact;
    if (!this.target || !it || !this.canUse) return false;
    it.run?.();
    const n = this.used.get(this.target.id) ?? 0;
    const line = it.lines ? Investigator.pick(it.lines, n) : null;
    if (line) {
      this.used.set(this.target.id, n + 1);
      this.breath = BREATH;
      this.say(line.text, this.target.id, line.who);
    }
    return true;
  }
}
