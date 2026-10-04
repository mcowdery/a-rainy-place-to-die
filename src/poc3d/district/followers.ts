/**
 * People who follow Mack (pure; real/followerParty.ts draws them and seats them in his car). On foot each keeps
 * to a spot a little way back along the way he came: he leaves a trail of crumbs, and a follower heads for the
 * spot its `gap` back along it and `side` across, straight there when the way is clear, else from crumb to crumb
 * the way he went (so round corners, through doorways and up stairs without a map of the place). They walk when
 * he walks and run when he runs, close up when he stops and turn to face him, slide along walls like any walker,
 * and catch up out of sight when they're left far behind, stuck, or he's gone somewhere by a fade.
 *
 * Who follows is the story's (flags, `followFlag`): for now two of the mob's figures standing in for Koharu and
 * the old detective, switched on from the debug menu.
 */

export interface FollowerDef {
  readonly id: string;
  readonly name: string;
  /** The mob figure that stands in for them (real/people.ts). */
  readonly body: 'man' | 'woman';
  readonly hair: 'short' | 'long' | 'bun' | 'hat' | 'cap' | 'none';
  readonly outfit: 'plain' | 'long' | 'suit';
  readonly color: readonly [number, number, number];
  /** Where they keep to: metres back along Mack's trail, and across it (positive: his right as he went). */
  readonly gap: number;
  readonly side: number;
}

/** Stand-ins until the cast is modelled: Koharu, and the old detective in his hat and trench coat. */
export const FOLLOWERS: readonly FollowerDef[] = [
  { id: 'koharu', name: 'Koharu', body: 'woman', hair: 'long', outfit: 'long', color: [0.05, 0.02, 0.026], gap: 1.4, side: -0.75 },
  { id: 'detective', name: 'The detective', body: 'man', hair: 'hat', outfit: 'long', color: [0.078, 0.064, 0.042], gap: 2.5, side: 0.7 },
];

/** The story flag that has someone follow Mack while it's true. */
export const followFlag = (id: string): string => `following_${id}`;

/** What a follower needs of the place: the walker's own collision and floors (controls.ts). */
export interface FollowWorld {
  blocked(x: number, z: number, r: number, floor: number): boolean;
  floorAt(x: number, z: number, current: number): number;
}

/** Mack on foot: where he stands, the floor under his feet, and the way he faces (a unit vector). */
export interface Leader {
  readonly x: number;
  readonly z: number;
  readonly floor: number;
  readonly fx: number;
  readonly fz: number;
}

interface Crumb {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

/** Crumbs this far apart (m), this many kept (80 m of trail). */
export const STEP = 0.5;
const KEEP = 160;
/** Further than this between frames (or this much up or down) isn't walking: a fade to somewhere else. */
const JUMP = 4;
const JUMP_UP = 3;
const RADIUS = 0.3;
/** The game's walk and run (controls.ts), and a follower's best when left behind (m/s); how hard it speeds up. */
export const WALK = 4.5;
export const RUN = 9;
const TOP = 11;
const ACCEL = 16;
/** Left this far behind (m), or held up this long (s) with a way still to go: it catches up out of sight. */
const FAR = 35;
const STUCK = 2.5;
/** How often it looks for a clear line (s), and how far it looks (m). */
const THINK = 0.12;
const SIGHT = 18;
/** Floors within this of each other are one level (a line of sight between them means something). */
const LEVEL = 0.6;

/** The way Mack came: a crumb every STEP metres, the oldest dropped. Indexes count from the first ever laid. */
export class Trail {
  private pts: Crumb[] = [];
  private base = 0;

  /** The oldest and newest crumbs' indexes (`end` < `start` when empty). */
  get start(): number {
    return this.base;
  }
  get end(): number {
    return this.base + this.pts.length - 1;
  }
  at(i: number): Crumb | null {
    return this.pts[i - this.base] ?? null;
  }

  /** Mack's place this frame. True when he got here by something other than walking (the trail starts again). */
  push(x: number, z: number, y: number): boolean {
    const last = this.pts[this.pts.length - 1];
    if (!last) {
      this.pts.push({ x, z, y });
      return false;
    }
    const d = Math.hypot(x - last.x, z - last.z);
    if (d > JUMP || Math.abs(y - last.y) > JUMP_UP) {
      this.reset();
      this.pts.push({ x, z, y });
      return true;
    }
    if (d >= STEP) {
      this.pts.push({ x, z, y });
      if (this.pts.length > KEEP) {
        this.pts.shift();
        this.base++;
      }
    }
    return false;
  }

  /** Forget the way (old indexes never come back). */
  reset(): void {
    this.base += this.pts.length;
    this.pts = [];
  }
}

/** A follower's spot: where, on what floor, and the crumb it's by (`start - 1` when it isn't on the trail). */
export interface Spot {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly idx: number;
}

/** Is the straight line from a to b clear for a walker at `floor`? (Sampled every 0.4 m.) */
function clear(world: FollowWorld, ax: number, az: number, bx: number, bz: number, floor: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 0.4));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    if (world.blocked(ax + (bx - ax) * k, az + (bz - az) * k, RADIUS, floor)) return false;
  }
  return true;
}

/**
 * The spot `gap` back along the trail from the leader and `side` across it (to the right of the way he went),
 * or null where the trail isn't that long yet. Across only as far as there's room.
 */
export function spotOnTrail(trail: Trail, leader: Leader, gap: number, side: number, world: FollowWorld): Spot | null {
  let px = leader.x;
  let pz = leader.z;
  let left = gap;
  for (let i = trail.end; i >= trail.start; i--) {
    const c = trail.at(i)!;
    const d = Math.hypot(px - c.x, pz - c.z);
    if (d >= left && d > 1e-6) {
      const k = left / d;
      const x = px + (c.x - px) * k;
      const z = pz + (c.z - pz) * k;
      // (The way he went here: from the crumb toward where he is now.)
      const tx = (px - c.x) / d;
      const tz = (pz - c.z) / d;
      for (const s of [side, side * 0.5]) {
        const sx = x - tz * s;
        const sz = z + tx * s;
        if (!world.blocked(sx, sz, RADIUS, c.y)) return { x: sx, z: sz, y: c.y, idx: i };
      }
      return { x, z, y: c.y, idx: i };
    }
    left -= d;
    px = c.x;
    pz = c.z;
  }
  return null;
}

/** A free spot behind the leader (as he faces) for someone arriving out of nowhere: `gap` back, `side` across. */
export function spotBehind(leader: Leader, gap: number, side: number, world: FollowWorld): { x: number; z: number; y: number } {
  for (const [g, s] of [[gap, side], [gap, 0], [gap * 0.5, side], [gap * 0.5, 0], [0, side], [-gap, side]] as const) {
    const x = leader.x - leader.fx * g - leader.fz * s;
    const z = leader.z - leader.fz * g + leader.fx * s;
    if (!world.blocked(x, z, RADIUS, leader.floor) && clear(world, leader.x, leader.z, x, z, leader.floor)) return { x, z, y: world.floorAt(x, z, leader.floor) };
  }
  return { x: leader.x, z: leader.z, y: leader.floor };
}

const turnTo = (from: number, to: number, most: number): number => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-most, Math.min(most, d));
};

/** One follower on foot: where it is, how it's moving, and its stride for the figure (real/liveFigure.ts). */
export class FollowerWalk {
  x = 0;
  z = 0;
  /** The floor under its feet. */
  floor = 0;
  /** Facing (the mob's yaw: 0 toward +z, positive toward +x). */
  yaw = 0;
  /** How fast it's going (m/s), and its velocity. */
  speed = 0;
  vx = 0;
  vz = 0;
  /** For the figure: 0 standing, 1 walking, 2 running; the stride's phase (0-1). */
  pace = 0;
  phase = 0;
  /** How many times it has caught up out of sight (for tests and debugging). */
  warps = 0;
  /** The last crumb it reached (an index into the trail). */
  private at = -1;
  /** What it's heading for: the spot itself, or a crumb. */
  private aim: { x: number; z: number; idx: number; direct: boolean } | null = null;
  private think = 0;
  private stuck = 0;
  private resting = true;
  /** Points to walk by first (round the car it just got out of), before it follows again. */
  private route: { x: number; z: number }[] = [];

  constructor(readonly gap: number, readonly side: number) {}

  /** Walk by these points first, then follow (dropped once the way to its spot is clear, or if it's held up). */
  via(points: readonly { x: number; z: number }[]): void {
    this.route = points.map((p) => ({ x: p.x, z: p.z }));
  }

  /** Put it somewhere (arriving, or catching up out of sight), facing `yaw`. */
  place(x: number, z: number, floor: number, yaw: number, idx = -1): void {
    this.x = x;
    this.z = z;
    this.floor = floor;
    this.yaw = yaw;
    this.speed = this.vx = this.vz = 0;
    this.at = idx;
    this.aim = null;
    this.think = 0;
    this.stuck = 0;
    this.resting = true;
    this.route = [];
  }

  /** Beside or behind the leader, out of nowhere (the trail's spot if there's one, else behind him as he faces). */
  join(leader: Leader, trail: Trail, world: FollowWorld): void {
    const s = spotOnTrail(trail, leader, this.gap, this.side, world);
    const yaw = Math.atan2(leader.fx, leader.fz);
    if (s) this.place(s.x, s.z, s.y, yaw, s.idx);
    else {
      const b = spotBehind(leader, this.gap, this.side, world);
      this.place(b.x, b.z, b.y, yaw, trail.end);
    }
  }

  /**
   * A frame on foot. `leader` null: nobody to follow just now (a scene, he's flying): it comes to a stop and
   * waits. `leaderSpeed`: how fast he's going (m/s).
   */
  step(dt: number, leader: Leader | null, leaderSpeed: number, trail: Trail, world: FollowWorld): void {
    if (dt <= 0) return;
    if (!leader) {
      this.move(dt, null, 0, world);
      return;
    }
    const away = Math.hypot(leader.x - this.x, leader.z - this.z);
    if (away > FAR) {
      this.warps++;
      this.join(leader, trail, world);
      return;
    }
    // Where it wants to be: its spot on the trail; before there's that much trail, anywhere within reach of him
    // (so it doesn't scurry round behind him as he looks about), else toward him and stop short.
    let goal: Spot | null = spotOnTrail(trail, leader, this.gap, this.side, world);
    if (!goal) {
      const reach = this.gap + 0.8;
      if (away <= reach && Math.abs(leader.floor - this.floor) < LEVEL) goal = { x: this.x, z: this.z, y: this.floor, idx: trail.end };
      else {
        const k = away > 1e-3 ? this.gap / away : 0;
        goal = { x: leader.x + (this.x - leader.x) * k, z: leader.z + (this.z - leader.z) * k, y: leader.floor, idx: trail.end };
      }
    }
    // The crumbs it has reached: on to the furthest one within a step of it.
    if (this.at < trail.start - 1) this.at = trail.start - 1;
    for (let i = Math.min(goal.idx, this.at + 4); i > this.at; i--) {
      const c = trail.at(i);
      if (c && Math.hypot(c.x - this.x, c.z - this.z) < 0.7 && Math.abs(c.y - this.floor) < LEVEL) {
        this.at = i;
        break;
      }
    }
    this.think -= dt;
    if (this.think <= 0 || !this.aim) {
      this.think = THINK;
      this.aim = this.choose(goal, trail, world);
      if (this.aim.direct) this.route = [];
    }
    // Something to walk round first (the car): by its points at a walk, then on as usual.
    if (this.route.length > 0) {
      const p = this.route[0];
      if (Math.hypot(p.x - this.x, p.z - this.z) < 0.35) this.route.shift();
      else {
        const moved = this.move(dt, p, WALK, world);
        this.stuck = moved < 0.3 * this.speed * dt ? this.stuck + dt : 0;
        if (this.stuck > 1) this.route = [];
        if (moved > 1e-4) this.yaw = turnTo(this.yaw, Math.atan2(this.vx, this.vz), dt * 10);
        this.resting = false;
        return;
      }
    }
    // (The spot moves with him: a direct line goes to where it is now.)
    const aim = this.aim.direct ? { x: goal.x, z: goal.z } : this.aim;
    const toAim = Math.hypot(aim.x - this.x, aim.z - this.z);
    const remain = this.aim.direct ? toAim : toAim + Math.max(0, goal.idx - this.aim.idx) * STEP;
    // As fast as he's going while there's a way to go, and faster the further behind; easing in to stop.
    if (this.resting && remain > 0.6) this.resting = false;
    if (!this.resting && remain < 0.2 && leaderSpeed < 0.5) this.resting = true;
    const want = this.resting ? 0 : Math.min(TOP, leaderSpeed * Math.min(1, remain / 0.8) + 3 * remain);
    const moved = this.move(dt, toAim > 1e-3 ? aim : null, want, world);
    // Held up (a wall it can't get round, a door that shut): after a while it catches up out of sight.
    if (!this.resting && remain > 2 && moved < 0.3 * this.speed * dt) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > STUCK) {
      this.warps++;
      this.join(leader, trail, world);
      return;
    }
    // Facing the way it's going; standing, round to him.
    if (this.speed > 0.4 && moved > 1e-4) this.yaw = turnTo(this.yaw, Math.atan2(this.vx, this.vz), dt * 10);
    else if (away > 0.3) this.yaw = turnTo(this.yaw, Math.atan2(leader.x - this.x, leader.z - this.z), dt * 3.5);
  }

  /**
   * What to head for: the spot itself if the way's clear; else the furthest crumb on the way there that it can
   * walk straight to; else the next crumb after the last it reached (he went that way, so it's open).
   */
  private choose(goal: Spot, trail: Trail, world: FollowWorld): { x: number; z: number; idx: number; direct: boolean } {
    const sees = (x: number, z: number, y: number): boolean =>
      Math.abs(y - this.floor) < LEVEL && Math.hypot(x - this.x, z - this.z) < SIGHT && clear(world, this.x, this.z, x, z, this.floor);
    if (sees(goal.x, goal.z, goal.y)) return { x: goal.x, z: goal.z, idx: goal.idx, direct: true };
    const from = Math.max(this.at + 1, trail.start);
    const stride = Math.max(1, Math.ceil((goal.idx - from) / 10));
    for (let i = goal.idx; i > from; i -= stride) {
      const c = trail.at(i);
      if (c && sees(c.x, c.z, c.y)) return { x: c.x, z: c.z, idx: i, direct: false };
    }
    // The next crumb, if it's by the trail; off it (it cut a corner and lost sight), the nearest crumb ahead.
    const next = trail.at(from);
    if (next && Math.hypot(next.x - this.x, next.z - this.z) < 3) return { x: next.x, z: next.z, idx: from, direct: false };
    let best = goal.idx;
    let bestD = Infinity;
    for (let i = from; i <= goal.idx; i++) {
      const c = trail.at(i);
      if (!c) continue;
      const d = Math.hypot(c.x - this.x, c.z - this.z) + Math.abs(c.y - this.floor) * 4;
      if (d < bestD) [best, bestD] = [i, d];
    }
    const c = trail.at(best);
    return c ? { x: c.x, z: c.z, idx: best, direct: false } : { x: goal.x, z: goal.z, idx: goal.idx, direct: true };
  }

  /** Toward `aim` at up to `want` m/s, sliding along what's in the way; the stride follows. Returns how far it got. */
  private move(dt: number, aim: { x: number; z: number } | null, want: number, world: FollowWorld): number {
    this.speed += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, want - this.speed));
    let moved = 0;
    if (aim && this.speed > 0.01) {
      const dx = aim.x - this.x;
      const dz = aim.z - this.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, this.speed * dt);
      const sx = (dx / d) * step;
      const sz = (dz / d) * step;
      const x0 = this.x;
      const z0 = this.z;
      // (Somehow inside something: walk out of it.)
      const free = world.blocked(this.x, this.z, RADIUS, this.floor);
      if (free || !world.blocked(this.x + sx, this.z, RADIUS, this.floor)) this.x += sx;
      if (free || !world.blocked(this.x, this.z + sz, RADIUS, this.floor)) this.z += sz;
      this.floor = world.floorAt(this.x, this.z, this.floor);
      moved = Math.hypot(this.x - x0, this.z - z0);
      this.vx = (this.x - x0) / dt;
      this.vz = (this.z - z0) / dt;
    } else this.vx = this.vz = 0;
    // The stride: by how fast it's really going (the game's walk its walk, the game's run its run).
    const v = moved / dt;
    const pace = v <= WALK ? v / WALK : Math.min(2, 1 + (v - WALK) / (RUN - WALK));
    this.pace += (pace - this.pace) * Math.min(1, dt * 9);
    if (this.pace < 0.02) this.pace = 0;
    else this.phase = (this.phase + dt * (0.7 + 0.4 * Math.min(1, this.pace) + 0.45 * Math.max(0, this.pace - 1))) % 1;
    return moved;
  }
}
