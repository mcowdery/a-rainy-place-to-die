/**
 * Space on foot: cover, a vault, a roll, in place of a jump (the user, 2026-10-16: "get rid of jump altogether and replace
 * it with a cover mechanic, where space bar hugs walls, ducks behind cover, or dive rolls or jumps over small obstacles").
 * The decision and the geometry, knowing nothing of three.js (tests/cover.test.ts); the page gives it the walker, what's
 * around him (`Obstacle`s) and the keys, and takes back where the body is, which way it's turned and which clips lie
 * over its pose (`ActionFrame`). The clips are Mixamo's (assets/anims/mixamo_picked.glb, credited in assets/anims/CREDITS.md;
 * `mixamo_picked.json` is what each does over the floor).
 *
 * One key by what's in reach, along the view:
 * - a tall wall (1.45 m and up) or anything he can't vault, close ahead: **stand to cover**, his back to it, **sidling** along it
 *   with A and D (the camera's sides), and Space again steps out;
 * - something low (0.55 to 1.45 m): **down behind it**, sidling crouched; W with Space from there goes **over** it, and so
 *   does Space with W held, or running, at it from further off, if it's no higher than 1.25 m (one hand planted);
 * - nothing there: a **roll** the way the keys go (the view's way standing still), Mixamo's sprint-to-roll from a stand as well as
 *   from a run (the user, 2026-10-16: the dive roll from a stand "doesn't look good"; "fill in the vacancy with the shift roll animation and
 *   also make that animation faster"). The clip has a run-in before the roll itself (half its travel in its first half second), so from a
 *   stand some of it is skipped, and the body is moved by the clip's own travel curve; how fast, how much to skip and how far are `Tuning`.
 *
 * The Mixamo clips are authored with the wall along their +z (the way a clip's rest pose faces): the entry steps toward it
 * and turns, the exit steps away from it, the sneaks go along x. So the body's heading is set to point +z at the wall
 * and each clip plays as authored, which turns him however the clip does; the page moves the body to where this says.
 */

export interface Obstacle {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** Its height (m). */
  readonly h: number;
}

/** A ray's hit on an obstacle: along the ray where it goes in and where it comes out, the face it meets (unit, out of the obstacle) and its height. */
export interface Hit {
  readonly dist: number;
  readonly exit: number;
  readonly nx: number;
  readonly nz: number;
  readonly h: number;
  readonly obstacle: Obstacle;
}

/** The first obstacle a ray from (ox, oz) along the unit (dx, dz) meets within `max`, or null (slab test on each box). */
export function rayObstacles(obstacles: readonly Obstacle[], ox: number, oz: number, dx: number, dz: number, max: number): Hit | null {
  let best: Hit | null = null;
  for (const o of obstacles) {
    let t0 = 0;
    // (Where it comes out isn't cut at `max`: a vault wants the far side of what it meets.)
    let t1 = Infinity;
    let nx = 0;
    let nz = 0;
    let ok = true;
    for (const axis of ['x', 'z'] as const) {
      const p = axis === 'x' ? ox : oz;
      const d = axis === 'x' ? dx : dz;
      const lo = axis === 'x' ? o.x0 : o.z0;
      const hi = axis === 'x' ? o.x1 : o.z1;
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) ok = false;
        continue;
      }
      let a = (lo - p) / d;
      let b = (hi - p) / d;
      const n = -Math.sign(d);
      if (a > b) [a, b] = [b, a];
      if (a > t0) {
        t0 = a;
        nx = axis === 'x' ? n : 0;
        nz = axis === 'z' ? n : 0;
      }
      t1 = Math.min(t1, b);
      if (t0 > t1) ok = false;
    }
    if (!ok || t0 > t1 || t0 > max) continue;
    // (Starting inside it has no face to meet.)
    if (nx === 0 && nz === 0) continue;
    if (!best || t0 < best.dist) best = { dist: t0, exit: t1, nx, nz, h: o.h, obstacle: o };
  }
  return best;
}

/** Whether a circle of radius r at (x, z) is inside any obstacle (to walk, and to land on). */
export function blockedBy(obstacles: readonly Obstacle[], x: number, z: number, r: number): boolean {
  return obstacles.some((o) => x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r);
}

/** What a clip does over the floor (assets/anims/mixamo_picked.json: the builder's `extras`). */
export interface ClipInfo {
  /** Where the hips went over the clip, in the clip's frame (x to his left, z the way the rest pose faces), metres. */
  readonly travel: readonly number[];
  readonly seconds: number;
  /** The share of that travel done at 13 evenly spaced moments of the clip (0 to 1), where it moved at all. */
  readonly path?: readonly number[];
}

/** What's to be got right by feel (the fight page's sliders), the roll's. */
export interface Tuning {
  /** How fast the roll plays, times the clip's own pace. */
  rollSpeed: number;
  /** How much of the clip's run-in is skipped, starting from a stand and from a run (s). */
  rollLeadStill: number;
  rollLeadRun: number;
  /** How far it goes, as a share of what the clip itself travels from where it starts. */
  rollDistance: number;
}
export const DEFAULT_TUNING: Readonly<Tuning> = { rollSpeed: 1.35, rollLeadStill: 0.4, rollLeadRun: 0, rollDistance: 0.7 };
export type ClipTable = Readonly<Record<string, ClipInfo>>;

/** A clip over his pose, and how much of it. */
export interface Layer {
  readonly name: string;
  readonly time: number;
  readonly weight: number;
}

/** Where the body is this frame and what's on it. */
export interface ActionFrame {
  readonly x: number;
  readonly z: number;
  /** The body's heading (rad; 0 faces +z, the rig's): the clip's own turn comes on top. */
  readonly heading: number;
  readonly layers: readonly Layer[];
  readonly state: State;
  /** Standing or crouched, for the camera and the gun. */
  readonly crouched: boolean;
}

export type State = 'enter' | 'hold' | 'slide' | 'exit' | 'vault' | 'roll';

/** His keys and where he is, this frame. `viewYaw`: the camera's (it faces (-sin, -cos)). */
export interface CoverInput {
  readonly dt: number;
  readonly x: number;
  readonly z: number;
  readonly viewYaw: number;
  readonly space: boolean;
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly run: boolean;
}

/** The clips each move uses (names in assets/anims/mixamo_picked.glb). */
export const CLIPS = {
  enterHigh: 'MX_AA_stand_to_cover',
  enterLow: 'MX_AA_stand_to_cover_2',
  exitHigh: 'MX_AA_cover_to_stand_2',
  exitLow: 'MX_AA_cover_to_stand',
  idleLow: 'MX_Crouched_For_Cover_Against_Object',
  sidleHigh: ['MX_AA_left_cover_sneak', 'MX_AA_right_cover_sneak'],
  sidleLow: ['MX_AA_crouched_sneaking_left', 'MX_AA_crouched_sneaking_right'],
  vault: ['MX_Male_Jumping_Over_An_Obstacle_With_1_Hand_Planted', 'MX_Male_Jumping_Over_An_Obstacle_With_2_Hands_Planted'],
  rollRun: 'MX_Sprint_To_Forward_Roll_To_Sprinting',
} as const;

/** Heights (m): from here up a wall is stood against; from the low one up, something to crouch behind; the vault's top. */
export const HIGH = 1.45;
export const LOW = 0.55;
export const VAULT_TOP = 1.25;
/** How far from the face the body stands in cover (m), how far ahead he looks for something, how far a roll goes. */
export const STAND_OFF = 0.38;
export const REACH = 2.2;
/** A clip fades in and out over this long (s). */
const FADE = 0.14;

const ease = (u: number): number => u * u * (3 - 2 * u);
const clamp01 = (u: number): number => Math.max(0, Math.min(1, u));
const heading = (dx: number, dz: number): number => Math.atan2(dx, dz);

export class Cover {
  private state: State | 'free' = 'free';
  private t = 0;
  private dur = 1;
  private from = { x: 0, z: 0 };
  private to = { x: 0, z: 0 };
  private head = 0;
  private low = false;
  /** The wall's unit normal (out of it) and the point of its face we're at, while in cover. */
  private n = { x: 0, z: 1 };
  private clip = '';
  /** The sidle's clip last frame, and how long since it stopped (so the hold fades into it). */
  private sidleClip = '';
  private since = 99;
  private vaultN = 0;
  /** A roll's start in its clip (s), how fast it plays and the share of the clip's travel done by its start. */
  private rollLead = 0;
  private rollSpeed = 1;
  private rollShare0 = 0;
  /** The things to get right by feel: the page's sliders set these. */
  tuning: Tuning = { ...DEFAULT_TUNING };

  constructor(
    private obstacles: readonly Obstacle[],
    private readonly table: ClipTable,
    /** The body's radius for what it may land on. */
    private readonly radius = 0.32,
  ) {}

  setObstacles(obstacles: readonly Obstacle[]): void {
    this.obstacles = obstacles;
  }

  /** Whether an action has the body (the page stops walking him and lets this move him). */
  get active(): boolean {
    return this.state !== 'free';
  }

  get current(): State | 'free' {
    return this.state;
  }

  /** Back to walking, now. */
  cancel(): void {
    this.state = 'free';
  }

  private len(name: string): number {
    return this.table[name]?.seconds ?? 1;
  }

  /** The share (0 to 1) of a clip's travel done `at` seconds in, by its own curve (evenly if it has none). */
  private share(name: string, at: number): number {
    const info = this.table[name];
    const u = clamp01(at / (info?.seconds || 1));
    const path = info?.path;
    if (!path || path.length < 2) return u;
    const x = u * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(x));
    return path[i] + (path[i + 1] - path[i]) * (x - i);
  }

  private travel(name: string): readonly number[] {
    return this.table[name]?.travel ?? [0, 0];
  }

  /** A point `along` a heading from a place, and `left` of it: the clip's own frame (x his left, z the way it faces) into the world. */
  private frame(p: { x: number; z: number }, h: number, left: number, along: number): { x: number; z: number } {
    return { x: p.x + Math.cos(h) * left + Math.sin(h) * along, z: p.z - Math.sin(h) * left + Math.cos(h) * along };
  }

  private begin(state: State, clip: string, from: { x: number; z: number }, to: { x: number; z: number }, h: number, low: boolean, dur = this.len(clip)): void {
    this.state = state;
    this.clip = clip;
    this.t = 0;
    this.dur = dur;
    this.from = { ...from };
    this.to = { ...to };
    this.head = h;
    this.low = low;
  }

  /** The frame for the state now, or null when he's free to walk. */
  update(i: CoverInput): ActionFrame | null {
    if (this.state === 'free') {
      if (!i.space) return null;
      if (!this.start(i)) return null;
    } else this.t += i.dt;
    switch (this.state) {
      case 'enter':
      case 'exit':
      case 'vault':
      case 'roll':
        return this.travelling(i);
      case 'hold':
      case 'slide':
        return this.inCover(i);
      default:
        return null;
    }
  }

  /** What Space does from walking. False if nothing: he's against a wall to his back, or there's nowhere to go. */
  private start(i: CoverInput): boolean {
    const fx = -Math.sin(i.viewYaw);
    const fz = -Math.cos(i.viewYaw);
    const here = { x: i.x, z: i.z };
    const hit = rayObstacles(this.obstacles, i.x, i.z, fx, fz, REACH);
    if (hit && hit.h >= LOW) {
      const toWall = heading(-hit.nx, -hit.nz);
      this.n = { x: hit.nx, z: hit.nz };
      const dest = { x: i.x + fx * hit.dist + hit.nx * STAND_OFF, z: i.z + fz * hit.dist + hit.nz * STAND_OFF };
      // Over it: moving at it (or running), straight enough on, no higher than a hand can plant on, and the far side clear.
      const straight = fx * -hit.nx + fz * -hit.nz > 0.7;
      if (hit.h <= VAULT_TOP && straight && (i.forward || i.run)) {
        const land = { x: i.x + fx * (hit.exit + 0.55), z: i.z + fz * (hit.exit + 0.55) };
        if (!blockedBy(this.obstacles, land.x, land.z, this.radius)) {
          const clip = CLIPS.vault[this.vaultN++ % CLIPS.vault.length];
          this.begin('vault', clip, here, land, heading(-hit.nx, -hit.nz), false);
          return true;
        }
      }
      const low = hit.h < HIGH;
      this.begin('enter', low ? CLIPS.enterLow : CLIPS.enterHigh, here, dest, toWall, low);
      return true;
    }
    // A roll the way he's running (the keys, Shift held), and only running: standing or walking, nothing.
    let dx = fx;
    let dz = fz;
    const f = (i.forward ? 1 : 0) - (i.back ? 1 : 0);
    const r = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    if (f || r) {
      dx = fx * f + -fz * r;
      dz = fz * f + fx * r;
      const m = Math.hypot(dx, dz);
      dx /= m;
      dz /= m;
    }
    // Standing, walking or running: the clip's run-in is skipped by `tuning`'s lead (more from a stand, where a sprint's first strides are
    // out of place), and it goes `rollDistance` of what the clip travels from there, less if a wall is in the way.
    const clip = CLIPS.rollRun;
    const t = this.tuning;
    const len = this.len(clip);
    const lead = Math.max(0, Math.min(len - 0.3, i.run && (f || r) ? t.rollLeadRun : t.rollLeadStill));
    const share0 = this.share(clip, lead);
    const net = Math.hypot(...(this.travel(clip) as [number, number]));
    const want = net * (1 - share0) * t.rollDistance;
    const wall = rayObstacles(this.obstacles, i.x, i.z, dx, dz, want + 0.5);
    const room = Math.min(want, wall ? wall.dist - 0.5 : want);
    if (room < 0.9) return false;
    this.rollLead = lead;
    this.rollSpeed = Math.max(0.3, t.rollSpeed);
    this.rollShare0 = share0;
    this.begin('roll', clip, here, { x: i.x + dx * room, z: i.z + dz * room }, heading(dx, dz), false, (len - lead) / this.rollSpeed);
    return true;
  }

  private weights(): number {
    const fadeIn = this.state === 'enter' || this.state === 'vault' || this.state === 'roll' ? clamp01(this.t / FADE) : 1;
    const fadeOut = this.state === 'exit' || this.state === 'vault' || this.state === 'roll' ? clamp01((this.dur - this.t) / FADE) : 1;
    return Math.min(fadeIn, fadeOut);
  }

  private travelling(i: CoverInput): ActionFrame | null {
    const s = this.state as State;
    const u = clamp01(this.t / this.dur);
    let pos: { x: number; z: number };
    if (s === 'exit') {
      // Out as the clip goes (it steps away from the wall), from where he stood.
      const [tx = 0, tz = 0] = this.travel(this.clip);
      pos = this.frame(this.from, this.head, tx * ease(u), tz * ease(u));
    } else {
      // A roll goes by the clip's own travel curve (its run-in fast, the roll itself slow), so the body moves as the pose does.
      const k = s === 'roll' ? clamp01((this.share(this.clip, this.rollLead + this.t * this.rollSpeed) - this.rollShare0) / Math.max(1e-6, 1 - this.rollShare0)) : ease(u);
      pos = { x: this.from.x + (this.to.x - this.from.x) * k, z: this.from.z + (this.to.z - this.from.z) * k };
    }
    const at = s === 'roll' ? this.rollLead + this.t * this.rollSpeed : this.t;
    const frame: ActionFrame = { ...pos, heading: this.head, layers: [{ name: this.clip, time: Math.min(at, this.len(this.clip)), weight: this.weights() }], state: s, crouched: this.low && s !== 'exit' };
    if (this.t >= this.dur) {
      if (s === 'enter') {
        this.state = 'hold';
        this.t = 0;
        this.from = { ...pos };
        this.since = 99;
      } else this.state = 'free';
    }
    void i;
    return frame;
  }

  /** In cover: held, or sidling along it; Space steps out (or over). */
  private inCover(i: CoverInput): ActionFrame {
    const enter = this.low ? CLIPS.enterLow : CLIPS.enterHigh;
    if (i.space) {
      // Over it from crouched cover with W; else out, the way the clip steps away from the wall.
      if (this.low && i.forward) return this.vaultOut(i);
      const at = { x: i.x, z: i.z };
      this.begin('exit', this.low ? CLIPS.exitLow : CLIPS.exitHigh, at, at, this.head, this.low);
      return this.travelling(i)!;
    }
    // Along the wall: the camera's right (A and D) on the clip's own x axis, which is the way the sneaks go.
    const lx = Math.cos(this.head);
    const lz = -Math.sin(this.head);
    const push = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    const a = push * (Math.cos(i.viewYaw) * lx + -Math.sin(i.viewYaw) * lz);
    const want = Math.abs(a) < 0.2 ? 0 : Math.sign(a);
    let pos = { x: i.x, z: i.z };
    this.since += i.dt;
    if (want !== 0) {
      const clips = this.low ? CLIPS.sidleLow : CLIPS.sidleHigh;
      const pick = clips.find((c) => Math.sign(this.travel(c)[0]) === want) ?? clips[0];
      const info = this.table[pick];
      const step = (Math.abs(info?.travel[0] ?? 1) / (info?.seconds ?? 1)) * i.dt * want;
      const next = { x: pos.x + lx * step, z: pos.z + lz * step };
      // Only along cover: the same face has to be there still, a step on (a corner stops him).
      const wall = rayObstacles(this.obstacles, next.x, next.z, -this.n.x, -this.n.z, STAND_OFF + 0.3);
      if (wall && Math.abs(wall.nx - this.n.x) + Math.abs(wall.nz - this.n.z) < 0.01) pos = next;
      if (this.state !== 'slide' || this.sidleClip !== pick) this.t = 0;
      this.state = 'slide';
      this.sidleClip = pick;
      this.since = 0;
      return { ...pos, heading: this.head, layers: [{ name: pick, time: this.t % (info?.seconds ?? 1), weight: 1 }], state: 'slide', crouched: this.low };
    }
    this.state = 'hold';
    // Held: the entry's last frame (and, crouched, the idle fading in over it); a sidle that has just stopped fades out.
    const layers: Layer[] = [{ name: enter, time: Math.max(0, this.len(enter) - 0.001), weight: 1 }];
    if (this.low) layers.push({ name: CLIPS.idleLow, time: this.t % this.len(CLIPS.idleLow), weight: clamp01(this.t / 0.3) });
    if (this.since < FADE && this.sidleClip) layers.push({ name: this.sidleClip, time: this.t % this.len(this.sidleClip), weight: 1 - this.since / FADE });
    return { ...pos, heading: this.head, layers, state: 'hold', crouched: this.low };
  }

  /** Over the low wall he's crouched behind: the vault's clip, to the far side. */
  private vaultOut(i: CoverInput): ActionFrame {
    const from = { x: i.x, z: i.z };
    // Over it away from where he's standing: toward the wall (the clip's +z), across its depth and a little more.
    const dx = -this.n.x;
    const dz = -this.n.z;
    const hit = rayObstacles(this.obstacles, i.x - dx * 0.4, i.z - dz * 0.4, dx, dz, 6);
    const land = hit ? { x: i.x + dx * (hit.exit - 0.4 + 0.55), z: i.z + dz * (hit.exit - 0.4 + 0.55) } : { x: i.x + dx * 1.5, z: i.z + dz * 1.5 };
    const clip = CLIPS.vault[this.vaultN++ % CLIPS.vault.length];
    this.begin('vault', clip, from, land, heading(dx, dz), false);
    return this.travelling(i)!;
  }
}
