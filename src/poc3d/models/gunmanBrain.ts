import { blockedBy, Cover, LOW, type ClipTable, type Layer, type Obstacle } from './cover';

/**
 * An enemy gunman's head (the user, 2026-10-16: "enemy gunman who cover, shoot and flush me out, though I still want brawlers too"): where he goes
 * and what he does, knowing nothing of three.js (tests/gunmanBrain.test.ts). A `Thug` (models/thug.ts) with this as its `brain` is a gunman,
 * so your blows and shots, his health, his falls and the gore are the brawlers' own. He uses the same `Cover` controller you do
 * (models/cover.ts), driven by what a player's hands would do:
 *
 * - **seeks** low cover (a crate or a wall he can shoot over, 0.55 to 1.3 m) on the side away from you, at a good range and not where another
 *   gunman already is, runs to it, faces it and "presses Space": he crouches behind it;
 * - **holds**, hidden, for a second or three, then **peeks**: stands up into the aim (the cover pose fading out, the pistol's aim in), settles
 *   for a beat so you can see it coming, fires a burst of two or three with a gap between, and drops back;
 * - **flushes you out**: when you've been in cover and out of his sight too long (`ctx.player.hidden`), he throws a grenade at where you are
 *   (the page makes it go off and hurt you wherever you hide), and failing that moves to other cover;
 * - and a shot that comes at you or him is the page's to settle: the cover's heights decide whether it clears the crate (`rayBlockedAt`).
 */

export const GUNMAN = {
  /** How fast he runs to cover (m/s). */
  run: 4.8,
  /** How high a crate he'll use may be: his pistol is at 1.45 m when he stands, so a wall he can shoot over. */
  maxCover: 1.3,
  /** Where his muzzle is when he's up (m). */
  muzzle: 1.45,
  /** Hidden for, between peeks (s, from to). */
  hold: [1.4, 3.2],
  /** How long he settles into the aim before the first shot, and between shots in a burst (s), and the shots in one. */
  aim: 0.5,
  gap: 0.3,
  burst: [2, 3],
  /** How long after you've been in cover unseen he goes for a grenade, how long before the next one, and how far he'll throw. */
  flushAfter: 3.2,
  grenadeGap: 9,
  throwRange: [5, 22],
  /** When he moves to other cover (when you've been hidden this long and he can't throw). */
  moveAfter: 7,
  /** How far from a crate's face he stands up to run to it from (so the cover clip's step in lands him against it) (m). */
  approach: 1.6,
  /** Where in the throw clip (0 to 1) the grenade leaves his hand. */
  release: 0.55,
} as const;

/** The clips he uses (names in the animation library: the UAL's, and `cover.ts`'s). */
export const GUN_CLIPS = {
  run: 'Jog_Fwd_Loop',
  idle: 'Pistol_Idle_Loop',
  aim: 'Pistol_Aim_Neutral',
  shoot: 'Pistol_Shoot',
  throw: 'OverhandThrow',
} as const;

type V = { x: number; y: number; z: number };

/** What the page tells him each frame. */
export interface GunCtx {
  readonly obstacles: readonly Obstacle[];
  /** You: where, whether you're in cover and for how long you've been out of sight there (s). */
  readonly player: { readonly x: number; readonly z: number; readonly covered: boolean; readonly hidden: number };
  /** Where the other gunmen have taken cover (a face's middle). */
  readonly taken: readonly { readonly x: number; readonly z: number }[];
  /** A shot from `from` at you (the page settles it: cover, spread, damage); a grenade from `from` to `to`. */
  fire(from: V, who: object): void;
  grenade(from: V, to: V, who: object): void;
}

export type BrainState = 'seek' | 'covered' | 'peek' | 'throw' | 'move' | 'stand';

/** What he does this frame: where he is, which way he faces, the clips to lay (in order), and where his cover is. */
export interface BrainOut {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly layers: readonly Layer[];
  readonly state: BrainState;
  readonly spot: { x: number; z: number } | null;
  /** His muzzle's height while he's up (for the page's shot). */
  readonly up: boolean;
}

/** A place to run to, and the face of the crate it's against. */
interface Spot {
  readonly x: number;
  readonly z: number;
  /** The face's middle, and its outward normal. */
  readonly fx: number;
  readonly fz: number;
  readonly nx: number;
  readonly nz: number;
  /** The crate or wall it's on. */
  readonly of: Obstacle;
}

export class GunBrain {
  state: BrainState = 'seek';
  readonly cover: Cover;
  private spot: Spot | null = null;
  private avoid: Obstacle | null = null;
  private t = 0;
  private wait = 0;
  private shots = 0;
  private fired = 0;
  private aimT = 0;
  private throwT = 0;
  private thrown = false;
  private sinceShot = 99;
  private grenadeIn = 2;
  private phase = 0;
  private rand: () => number;
  private pos = { x: 0, z: 0 };
  private yaw = 0;

  constructor(
    table: ClipTable,
    private readonly lengthOf: (clip: string) => number,
    seed = 1,
    /** Which thing in the world he is (given back to the page with a shot). */
    private readonly who: object = {},
  ) {
    this.cover = new Cover([], table);
    let s = seed * 7919 + 104729;
    this.rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    this.wait = this.between(GUNMAN.hold) * 0.5;
  }

  private between(r: readonly [number, number]): number {
    return r[0] + this.rand() * (r[1] - r[0]);
  }

  /** Back to looking for cover (he was knocked about, or his cover is gone). */
  reset(): void {
    this.cover.cancel();
    this.state = 'seek';
    this.spot = null;
  }

  /** The cover he's at or going to (a face's middle), for the others to keep off. */
  get at(): { x: number; z: number } | null {
    return this.spot ? { x: this.spot.fx, z: this.spot.fz } : null;
  }

  /**
   * The best low cover for him now: a face of a crate or wall he can shoot over, with the crate between him and you, a good way off you and
   * a short run for him, not where another gunman is. Null if there's none.
   */
  chooseSpot(me: { x: number; z: number }, ctx: GunCtx): Spot | null {
    let best: { cost: number; spot: Spot } | null = null;
    for (const o of ctx.obstacles) {
      if (o.h < LOW || o.h > GUNMAN.maxCover || o === this.avoid) continue;
      const w = o.x1 - o.x0;
      const d = o.z1 - o.z0;
      if (Math.max(w, d) < 1) continue;
      const cx = (o.x0 + o.x1) / 2;
      const cz = (o.z0 + o.z1) / 2;
      // The four faces: outward normal, the face's middle, and the way along it.
      const faces: [number, number, number, number, number, number, number][] = [
        [1, 0, o.x1, cz, 0, 1, d],
        [-1, 0, o.x0, cz, 0, 1, d],
        [0, 1, cx, o.z1, 1, 0, w],
        [0, -1, cx, o.z0, 1, 0, w],
      ];
      for (const [nx, nz, fx0, fz0, ax, az, len] of faces) {
        // Away from you: the crate is between the face and you.
        const toYou = (ctx.player.x - cx) * nx + (ctx.player.z - cz) * nz;
        if (toYou > -0.3) continue;
        // Points along the face: the one nearest him and a stride either side, kept off its ends (so a second gunman has somewhere else on it).
        const near = (me.x - fx0) * ax + (me.z - fz0) * az;
        for (const step of [0, -0.9, 0.9]) {
          const along = Math.max(-len / 2 + 0.4, Math.min(len / 2 - 0.4, near + step));
          const fx = fx0 + ax * along;
          const fz = fz0 + az * along;
          const x = fx + nx * GUNMAN.approach;
          const z = fz + nz * GUNMAN.approach;
          if (blockedBy(ctx.obstacles, x, z, 0.3)) continue;
          const dPlayer = Math.hypot(x - ctx.player.x, z - ctx.player.z);
          let cost = Math.hypot(x - me.x, z - me.z) + 0.4 * Math.abs(dPlayer - 9);
          // (Another man's spot costs the more the nearer it is: a stride off it is better, the same place worst.)
          for (const t of ctx.taken) cost += 8 * Math.max(0, 1 - Math.hypot(t.x - fx, t.z - fz) / 1.6);
          if (!best || cost < best.cost) best = { cost, spot: { x, z, fx, fz, nx, nz, of: o } };
        }
      }
    }
    return best ? best.spot : null;
  }

  update(dt: number, me: { x: number; z: number }, ctx: GunCtx): BrainOut {
    this.t += dt;
    this.sinceShot += dt;
    this.grenadeIn -= dt;
    this.pos = { x: me.x, z: me.z };
    this.cover.setObstacles(ctx.obstacles);
    const toYou = Math.atan2(ctx.player.x - me.x, ctx.player.z - me.z);
    const dist = Math.hypot(ctx.player.x - me.x, ctx.player.z - me.z);

    if (this.state === 'seek' || this.state === 'stand') {
      if (!this.spot) this.spot = this.chooseSpot(me, ctx);
      if (!this.spot) {
        // No cover to be had: he stands and watches you.
        this.state = 'stand';
        this.yaw = toYou;
        return this.out('stand', [{ name: GUN_CLIPS.idle, time: this.t % Math.max(0.1, this.lengthOf(GUN_CLIPS.idle)), weight: 1 }, { name: GUN_CLIPS.aim, time: this.lengthOf(GUN_CLIPS.aim), weight: 1 }]);
      }
      this.state = 'seek';
      const dx = this.spot.x - me.x;
      const dz = this.spot.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.25) {
        // Runs to it.
        const step = Math.min(d, GUNMAN.run * dt);
        this.pos = { x: me.x + (dx / d) * step, z: me.z + (dz / d) * step };
        this.yaw = Math.atan2(dx, dz);
        this.phase += dt * 1.45;
        return this.out('seek', [{ name: GUN_CLIPS.run, time: (this.phase % 1) * Math.max(0.1, this.lengthOf(GUN_CLIPS.run)), weight: 1 }]);
      }
      // There: faces the crate and presses Space.
      const wx = -this.spot.nx;
      const wz = -this.spot.nz;
      const f = this.cover.update({ dt, x: me.x, z: me.z, viewYaw: Math.atan2(-wx, -wz), space: true, forward: false, back: false, left: false, right: false, run: false });
      if (!f) {
        // (It wasn't cover after all, or the way was blocked: another.)
        this.avoid = null;
        this.spot = null;
        return this.out('seek', [], false);
      }
      this.state = 'covered';
      this.wait = this.between(GUNMAN.hold);
      return this.fromCover(f, ctx, toYou, dt);
    }

    // In cover: the controller has him; he decides when to peek.
    return this.coverStep(dt, me, ctx, toYou, dist);
  }

  private coverStep(dt: number, me: { x: number; z: number }, ctx: GunCtx, toYou: number, dist: number): BrainOut {
    let aim = this.state === 'peek' || this.state === 'throw';
    let leave = false;
    const hidden = ctx.player.hidden;
    if (this.state === 'covered' && this.cover.current === 'hold') {
      this.wait -= dt;
      if (this.wait <= 0) {
        const range = dist >= GUNMAN.throwRange[0] && dist <= GUNMAN.throwRange[1];
        if (hidden > GUNMAN.flushAfter && this.grenadeIn <= 0 && range) {
          this.state = 'throw';
          this.throwT = 0;
          this.thrown = false;
          aim = true;
        } else if (hidden > GUNMAN.moveAfter && this.grenadeIn > 0) {
          // He can't throw and you're not coming out: he goes to other cover.
          this.avoid = this.spot?.of ?? null;
          this.state = 'move';
          leave = true;
        } else {
          this.state = 'peek';
          this.shots = Math.round(this.between(GUNMAN.burst));
          this.fired = 0;
          this.aimT = 0;
          aim = true;
        }
      }
    }
    const f = this.cover.update({ dt, x: me.x, z: me.z, viewYaw: 0, space: leave, forward: false, back: false, left: false, right: false, run: false, aim });
    if (!f) {
      // The exit's done (or it never held): to seek the next cover.
      this.spot = null;
      this.state = 'seek';
      return this.out('seek', [], false);
    }
    return this.fromCover(f, ctx, toYou, dt);
  }

  /** The frame the controller gave, as the thing he does: the cover pose, and over it the aim, the shots and the throw as he peeks. */
  private fromCover(f: { x: number; z: number; heading: number; layers: readonly Layer[]; peek: number }, ctx: GunCtx, toYou: number, dt: number): BrainOut {
    this.pos = { x: f.x, z: f.z };
    this.yaw = f.peek >= 1 ? toYou : f.heading;
    const layers: Layer[] = [...f.layers];
    if (f.peek > 0) {
      // Up and aiming at you (turned to you as he comes up).
      this.yaw = f.peek > 0.5 ? toYou : f.heading;
      layers.push({ name: GUN_CLIPS.idle, time: this.t % Math.max(0.1, this.lengthOf(GUN_CLIPS.idle)), weight: f.peek });
      layers.push({ name: GUN_CLIPS.aim, time: this.lengthOf(GUN_CLIPS.aim), weight: f.peek });
    }
    if (f.peek >= 1 && this.state === 'peek') {
      this.aimT += dt;
      const due = GUNMAN.aim + this.fired * GUNMAN.gap;
      if (this.fired < this.shots && this.aimT >= due) {
        this.fired++;
        this.sinceShot = 0;
        ctx.fire({ x: f.x - Math.sin(this.yaw) * 0.5, y: GUNMAN.muzzle, z: f.z - Math.cos(this.yaw) * 0.5 }, this.who);
      }
      if (this.fired >= this.shots && this.aimT >= GUNMAN.aim + this.shots * GUNMAN.gap + 0.25) {
        this.state = 'covered';
        this.wait = this.between(GUNMAN.hold);
      }
    }
    if (f.peek >= 1 && this.state === 'throw') {
      const len = Math.max(0.4, this.lengthOf(GUN_CLIPS.throw));
      this.throwT += dt;
      layers.push({ name: GUN_CLIPS.throw, time: Math.min(this.throwT, len), weight: 1 });
      if (!this.thrown && this.throwT >= len * GUNMAN.release) {
        this.thrown = true;
        ctx.grenade({ x: f.x, y: 1.5, z: f.z }, { x: ctx.player.x, y: 0, z: ctx.player.z }, this.who);
      }
      if (this.throwT >= len) {
        this.state = 'covered';
        this.grenadeIn = GUNMAN.grenadeGap;
        this.wait = this.between(GUNMAN.hold);
      }
    }
    // A shot's kick over the aim.
    const shoot = this.lengthOf(GUN_CLIPS.shoot);
    if (this.sinceShot < shoot) layers.push({ name: GUN_CLIPS.shoot, time: this.sinceShot, weight: Math.min(1, this.sinceShot / 0.03, (shoot - this.sinceShot) / 0.15) });
    return this.out(this.state, layers, f.peek >= 1);
  }

  private out(state: BrainState, layers: readonly Layer[], up = false): BrainOut {
    return { x: this.pos.x, z: this.pos.z, yaw: this.yaw, layers, state, spot: this.spot ? { x: this.spot.fx, z: this.spot.fz } : null, up };
  }
}
