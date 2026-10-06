import { describe, expect, it } from 'vitest';
import { FOLLOWERS, FollowerWalk, Trail, followFlag, spotBehind, spotOnTrail, RUN, WALK, type FollowWorld, type Leader } from '../src/poc3d/district/followers';
import { cockpitLayout, passengerSeats } from '../src/poc3d/models/carInterior';
import { bodyShape } from '../src/poc3d/models/vehicles';
import { SPORT_TYPES } from '../src/poc3d/models/vehicles';
import { GHOST_COLORS, RIDE_HIP, figureSize, posedFigure, type FigureSpec } from '../src/poc3d/real/people';

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
const world = (boxes: readonly Box[] = [], floorAt: FollowWorld['floorAt'] = () => 0): FollowWorld => ({
  blocked: (x, z, r) => boxes.some((b) => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r),
  floorAt,
});
const OPEN = world();
const DT = 1 / 60;

/** Mack walking a path of straight legs at `speed`, the followers stepping with him; `each` sees every frame. */
function walkPath(pts: readonly [number, number][], speed: number, w: FollowWorld, each?: (L: Leader, fs: FollowerWalk[]) => void): { L: Leader; fs: FollowerWalk[]; trail: Trail } {
  const trail = new Trail();
  const fs = FOLLOWERS.map((f) => new FollowerWalk(f.gap, f.side));
  let L: Leader = { x: pts[0][0], z: pts[0][1], floor: w.floorAt(pts[0][0], pts[0][1], 0), fx: 0, fz: 1 };
  trail.push(L.x, L.z, L.floor);
  for (const f of fs) f.join(L, trail, w);
  for (let i = 1; i < pts.length; i++) {
    const [tx, tz] = pts[i];
    for (;;) {
      const d = Math.hypot(tx - L.x, tz - L.z);
      if (d < 1e-6) break;
      const step = Math.min(d, speed * DT);
      const fx = (tx - L.x) / d;
      const fz = (tz - L.z) / d;
      const x = L.x + fx * step;
      const z = L.z + fz * step;
      L = { x, z, floor: w.floorAt(x, z, L.floor), fx, fz };
      trail.push(L.x, L.z, L.floor);
      for (const f of fs) f.step(DT, L, speed, trail, w);
      each?.(L, fs);
    }
  }
  return { L, fs, trail };
}

/** He stands still for `seconds`; the followers close up. */
function settle(L: Leader, fs: FollowerWalk[], trail: Trail, w: FollowWorld, seconds = 3): void {
  for (let t = 0; t < seconds; t += DT) for (const f of fs) f.step(DT, L, 0, trail, w);
}

describe('followers on foot', () => {
  it('are a woman and a man in a hat and a long coat, each on a story flag', () => {
    expect(FOLLOWERS.map((f) => f.id)).toEqual(['koharu', 'detective']);
    expect(FOLLOWERS[0].body).toBe('woman');
    expect(FOLLOWERS[1]).toMatchObject({ body: 'man', hair: 'hat', outfit: 'long' });
    for (const f of FOLLOWERS) expect(followFlag(f.id)).toMatch(/^[a-z0-9_]+$/);
  });

  it('walk behind him at his pace and close up when he stops', () => {
    let worst = 0;
    const { L, fs, trail } = walkPath([[0, 0], [0, 60]], WALK, OPEN, (l, f) => {
      for (const w of f) worst = Math.max(worst, Math.hypot(w.x - l.x, w.z - l.z));
    });
    // Never far behind, and walking, not running, once under way.
    expect(worst).toBeLessThan(5);
    for (const f of fs) {
      expect(f.z).toBeLessThan(L.z - 0.8);
      expect(f.speed).toBeGreaterThan(WALK * 0.85);
      expect(f.speed).toBeLessThan(WALK * 1.3);
      expect(f.pace).toBeGreaterThan(0.8);
      expect(f.pace).toBeLessThan(1.3);
      expect(f.warps).toBe(0);
    }
    settle(L, fs, trail, OPEN);
    FOLLOWERS.forEach((def, i) => {
      const f = fs[i];
      expect(f.speed).toBe(0);
      expect(f.pace).toBe(0);
      // At its place back along the way he came and across it (the first to his left, the second his right)...
      expect(L.z - f.z).toBeGreaterThan(def.gap - 0.5);
      expect(L.z - f.z).toBeLessThan(def.gap + 0.5);
      // (Going +z, his right is -x.)
      expect(Math.sign(L.x - f.x)).toBe(Math.sign(def.side));
      // ...and turned to face him.
      const to = Math.atan2(L.x - f.x, L.z - f.z);
      expect(Math.abs(Math.atan2(Math.sin(f.yaw - to), Math.cos(f.yaw - to)))).toBeLessThan(0.2);
    });
    // Apart from each other.
    expect(Math.hypot(fs[0].x - fs[1].x, fs[0].z - fs[1].z)).toBeGreaterThan(0.8);
  });

  it('run when he runs', () => {
    const { L, fs } = walkPath([[0, 0], [80, 0]], RUN, OPEN);
    for (const f of fs) {
      expect(f.speed).toBeGreaterThan(RUN * 0.85);
      expect(f.pace).toBeGreaterThan(1.7);
      expect(Math.hypot(f.x - L.x, f.z - L.z)).toBeLessThan(6);
      expect(f.warps).toBe(0);
    }
  });

  it('stay put while he only looks about', () => {
    const { L, fs, trail } = walkPath([[0, 0], [0, 12]], WALK, OPEN);
    settle(L, fs, trail, OPEN);
    const before = fs.map((f) => [f.x, f.z]);
    for (let a = 0; a < Math.PI * 2; a += 0.05) for (const f of fs) f.step(DT, { ...L, fx: Math.sin(a), fz: Math.cos(a) }, 0, trail, OPEN);
    fs.forEach((f, i) => expect(Math.hypot(f.x - before[i][0], f.z - before[i][1])).toBeLessThan(0.05));
  });

  it('go round a corner the way he went, never through the wall', () => {
    // A building in the corner's inside; he walks along its south face, round its east end and up its far side.
    const wall: Box = { x0: -30, x1: 10, z0: 2, z1: 30 };
    const w = world([wall]);
    const inWall = (f: FollowerWalk): boolean => f.x > wall.x0 && f.x < wall.x1 && f.z > wall.z0 && f.z < wall.z1;
    const { L, fs, trail } = walkPath([[-20, 0], [12, 0], [12, 25]], RUN, w, (_l, f) => {
      for (const one of f) expect(inWall(one)).toBe(false);
    });
    settle(L, fs, trail, w);
    for (const f of fs) {
      expect(Math.hypot(f.x - L.x, f.z - L.z)).toBeLessThan(4);
      expect(f.warps).toBe(0);
    }
  });

  it('climb stairs after him', () => {
    // A flight up from z 10 to z 20 (5 m), a landing beyond.
    const floorAt = (_x: number, z: number): number => Math.min(5, Math.max(0, (z - 10) * 0.5));
    const w = world([], floorAt);
    const { L, fs, trail } = walkPath([[0, 0], [0, 30]], WALK, w, (l, f) => {
      for (const one of f) expect(one.floor).toBeCloseTo(floorAt(one.x, one.z), 5);
      void l;
    });
    settle(L, fs, trail, w);
    for (const f of fs) expect(f.floor).toBe(5);
  });

  it('turn up behind him when he goes somewhere by a fade, or leaves them far behind', () => {
    const { L, fs, trail } = walkPath([[0, 0], [0, 10]], WALK, OPEN);
    // A door: he's 300 m away the next frame.
    const there: Leader = { x: 300, z: -40, floor: -5, fx: 1, fz: 0 };
    expect(trail.push(there.x, there.z, there.floor)).toBe(true);
    for (const f of fs) f.join(there, trail, OPEN);
    FOLLOWERS.forEach((def, i) => {
      const f = fs[i];
      expect(f.floor).toBe(0);
      // Behind him as he faces (+x): back along -x.
      expect(there.x - f.x).toBeCloseTo(def.gap, 1);
      expect(Math.hypot(f.x - there.x, f.z - there.z)).toBeLessThan(def.gap + 1.5);
    });
    // Left 60 m behind (he flew): caught up on the next step.
    void L;
    const far: Leader = { x: 300, z: 30, floor: 0, fx: 0, fz: 1 };
    const t2 = new Trail();
    t2.push(far.x, far.z, far.floor);
    for (const f of fs) {
      f.step(DT, far, 0, t2, OPEN);
      expect(Math.hypot(f.x - far.x, f.z - far.z)).toBeLessThan(4);
      expect(f.warps).toBe(1);
    }
  });

  it('catch up out of sight when shut in', () => {
    // Walled in on every side; he's 12 m off.
    const w = world([{ x0: -3, x1: 3, z0: 2, z1: 3 }, { x0: -3, x1: 3, z0: -3, z1: -2 }, { x0: 2, x1: 3, z0: -3, z1: 3 }, { x0: -3, x1: -2, z0: -3, z1: 3 }]);
    const f = new FollowerWalk(1.4, 0.5);
    f.place(0, 0, 0, 0);
    const L: Leader = { x: 0, z: 12, floor: 0, fx: 0, fz: 1 };
    const trail = new Trail();
    trail.push(L.x, L.z, 0);
    for (let t = 0; t < 5; t += DT) f.step(DT, L, 0, trail, w);
    expect(f.warps).toBe(1);
    expect(Math.hypot(f.x - L.x, f.z - L.z)).toBeLessThan(3);
  });

  it('walk round what they are sent round (the car they got out of) before following again', () => {
    // A car between them: out of its far door, round its end, to him.
    const car: Box = { x0: -0.9, x1: 0.9, z0: -2, z1: 2 };
    const w = world([car]);
    const L: Leader = { x: -1.6, z: 0.3, floor: 0, fx: 0, fz: 1 };
    const trail = new Trail();
    trail.push(L.x, L.z, 0);
    const f = new FollowerWalk(1.4, 0.5);
    f.place(1.6, 0, 0, 0, trail.end);
    f.via([{ x: 1.6, z: 2.9 }, { x: -1.6, z: 2.9 }]);
    let furthest = 0;
    for (let t = 0; t < 4; t += DT) {
      f.step(DT, L, 0, trail, w);
      furthest = Math.max(furthest, f.z);
      expect(f.x > car.x0 && f.x < car.x1 && f.z > car.z0 && f.z < car.z1).toBe(false);
    }
    // Round the front, and standing by him on his side of it.
    expect(furthest).toBeGreaterThan(2.5);
    expect(f.x).toBeLessThan(car.x0);
    expect(Math.hypot(f.x - L.x, f.z - L.z)).toBeLessThan(2.5);
    expect(f.speed).toBe(0);
    expect(f.warps).toBe(0);
  });

  it('stop and wait when there is nobody to follow', () => {
    const { fs, trail } = walkPath([[0, 0], [0, 20]], RUN, OPEN);
    for (let t = 0; t < 2; t += DT) for (const f of fs) f.step(DT, null, 0, trail, OPEN);
    for (const f of fs) expect(f.speed).toBe(0);
  });

  it('find the spots: back along the trail, or behind him where there is room', () => {
    const trail = new Trail();
    for (let z = 0; z <= 10; z += 0.25) trail.push(0, z, 0);
    const L: Leader = { x: 0, z: 10, floor: 0, fx: 0, fz: 1 };
    const s = spotOnTrail(trail, L, 2, 0.6, OPEN)!;
    expect(s.z).toBeCloseTo(8, 1);
    expect(s.x).toBeCloseTo(-0.6, 5);
    // A wall along his right: the spot stays on the trail.
    const walled = spotOnTrail(trail, L, 2, 0.6, world([{ x0: -3, x1: -0.2, z0: 0, z1: 20 }]))!;
    expect(walled.x).toBeCloseTo(0, 5);
    expect(spotOnTrail(trail, L, 40, 0, OPEN)).toBeNull();
    // Behind him: a wall right behind, so beside him instead, never in it.
    const back: Box = { x0: -5, x1: 5, z0: 8.5, z1: 9.6 };
    const b = spotBehind(L, 1.4, 0.6, world([back]));
    expect(b.z).toBeGreaterThan(back.z1);
  });
});

describe('followers in his car', () => {
  it('have a seat beside him in every car, and seats behind where the car has them', () => {
    for (const type of [...SPORT_TYPES, 'sedan', 'kei', 'luxury', 'minivan'] as const) {
      const L = cockpitLayout(type);
      const B = bodyShape(type);
      const seats = passengerSeats(type);
      expect(seats.length).toBe(type === 'roadster' ? 1 : seats.length);
      expect(seats.length === 1 || seats.length === 3).toBe(true);
      // The front passenger's: the driver's, mirrored (right-hand drive: the driver on the right, -x).
      expect(seats[0].at.x).toBeCloseTo(-L.seat.x, 5);
      expect(seats[0].at.x).toBeGreaterThan(0.2);
      expect(seats[0].legs).toBeGreaterThan(0.7);
      for (const s of seats) {
        // Inside the body, over the floor, under a roof.
        expect(Math.abs(s.at.x)).toBeLessThan(B.halfW(s.at.z + B.L / 2) - 0.1);
        expect(s.at.y).toBeGreaterThan(L.floor);
        expect(s.head).toBeGreaterThan(0.5);
      }
      if (seats.length === 3) {
        expect(seats[1].at.z).toBeLessThan(L.seat.z - 0.4);
        expect(seats[1].at.x).toBeGreaterThan(0);
        expect(seats[2].at.x).toBeCloseTo(-seats[1].at.x, 5);
      }
    }
    expect(passengerSeats('roadster').length).toBe(1);
    expect(passengerSeats('sedan').length).toBe(3);
  });
});

describe('the mob figures they are', () => {
  const spec = (extra: Partial<FigureSpec>): FigureSpec => ({ x: 0, z: 0, yaw: 0, body: 'man', pose: 'gait', color: GHOST_COLORS[2], hair: 'short', long: false, phase: 0, side: 1, look: 0, y: -0.15, fade: false, ...extra });
  const bounds = (s: FigureSpec): { lo: number; hi: number; front: number; back: number } => {
    const p = posedFigure(s);
    let lo = Infinity, hi = -Infinity, front = -Infinity, back = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      expect(Number.isFinite(p[i] + p[i + 1] + p[i + 2])).toBe(true);
      lo = Math.min(lo, p[i + 1]);
      hi = Math.max(hi, p[i + 1]);
      front = Math.max(front, p[i + 2]);
      back = Math.min(back, p[i + 2]);
    }
    return { lo, hi, front, back };
  };

  it('stand, walk and run with a foot on the ground', () => {
    for (const body of ['man', 'woman'] as const) {
      const still = bounds(spec({ body, pace: 0 }));
      expect(still.lo).toBeGreaterThan(-0.012);
      expect(still.lo).toBeLessThan(0.03);
      for (let phase = 0; phase < 1; phase += 0.05) {
        const walk = bounds(spec({ body, pace: 1, phase }));
        expect(walk.lo).toBeGreaterThan(-0.02);
        expect(walk.lo).toBeLessThan(0.05);
        // Running: a longer stride, and off the ground only a little between bounds.
        const run = bounds(spec({ body, pace: 2, phase }));
        expect(run.lo).toBeGreaterThan(-0.06);
        expect(run.lo).toBeLessThan(0.2);
        expect(run.hi).toBeGreaterThan(1.3);
      }
      const stride = (pace: number): number => bounds(spec({ body, pace, phase: 0.25 })).front - bounds(spec({ body, pace, phase: 0.25 })).back;
      expect(stride(2)).toBeGreaterThan(stride(1) + 0.15);
      expect(stride(1)).toBeGreaterThan(stride(0) + 0.2);
    }
  });

  it('sit in a car seat: the hips just over the cushion, the feet below and ahead, the head under a roof', () => {
    for (const body of ['man', 'woman'] as const) {
      const size = figureSize({ body, hair: 'short', long: false });
      for (const tuck of [0, 1]) {
        // (y is the cushion's top.)
        const b = bounds(spec({ body, pose: 'ride', pace: tuck }));
        // The feet 0.15 to 0.35 m below the cushion: on a car's floor, not under the car.
        expect(b.lo).toBeGreaterThan(-0.36);
        expect(b.lo).toBeLessThan(-0.1);
        // The head no higher than the standing height less the legs.
        expect(b.hi).toBeLessThan(RIDE_HIP + size.height - size.hip + 0.03);
        expect(b.hi).toBeGreaterThan(0.7);
        // Legs out ahead; tucked, much less so.
        expect(b.front).toBeGreaterThan(tuck ? 0.4 : 0.7);
        expect(b.front).toBeLessThan(tuck ? 0.75 : 1.05);
      }
    }
    // The hat adds to the height (the detective sinks into his seat under a low roof).
    expect(figureSize({ body: 'man', hair: 'hat', long: true }).height).toBeGreaterThan(figureSize({ body: 'man', hair: 'short', long: false }).height + 0.005);
  });
});
