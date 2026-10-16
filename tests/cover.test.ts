import { describe, expect, it } from 'vitest';
import table from '../assets/anims/mixamo_picked.json';
import { blockedBy, CLIPS, Cover, DEFAULT_TUNING, HIGH, rayObstacles, STAND_OFF, type ActionFrame, type CoverInput, type Obstacle } from '../src/poc3d/models/cover';

const DT = 1 / 60;
/** The camera yaw that looks along +x. */
const EAST = -Math.PI / 2;
const WALL: Obstacle = { x0: 2, x1: 2.4, z0: -5, z1: 5, h: 3 };
const CRATE: Obstacle = { x0: 2, x1: 2.6, z0: -0.5, z1: 0.5, h: 0.9 };
const TALL_CRATE: Obstacle = { x0: 2, x1: 2.6, z0: -0.5, z1: 0.5, h: 1.2 };

const input = (over: Partial<CoverInput> = {}): CoverInput => ({ dt: DT, x: 0, z: 0, viewYaw: EAST, space: false, forward: false, back: false, left: false, right: false, run: false, ...over });

/** Steps a cover through `seconds`, feeding its own position back as the walker's, with `keys(t)` as the input; returns the last frame. */
function run(cover: Cover, start: { x: number; z: number }, seconds: number, keys: (t: number) => Partial<CoverInput> = () => ({})): ActionFrame | null {
  let pos = { ...start };
  let last: ActionFrame | null = null;
  for (let t = 0; t < seconds; t += DT) {
    const f = cover.update(input({ ...pos, ...keys(t) }));
    if (f) {
      pos = { x: f.x, z: f.z };
      last = f;
    }
  }
  return last;
}

describe('rayObstacles', () => {
  it('meets the near face, with its normal and where the ray comes out', () => {
    const hit = rayObstacles([WALL], 0, 0, 1, 0, 5)!;
    expect(hit.dist).toBeCloseTo(2);
    expect(hit.exit).toBeCloseTo(2.4);
    expect([hit.nx, hit.nz]).toEqual([-1, 0]);
    expect(hit.h).toBe(3);
  });
  it('takes the nearer of two, and none beyond its reach or from inside', () => {
    const far: Obstacle = { x0: 4, x1: 5, z0: -1, z1: 1, h: 1 };
    expect(rayObstacles([far, WALL], 0, 0, 1, 0, 9)!.dist).toBeCloseTo(2);
    expect(rayObstacles([WALL], 0, 0, 1, 0, 1.5)).toBeNull();
    expect(rayObstacles([WALL], 2.2, 0, 1, 0, 5)).toBeNull();
  });
  it('sees a face from the side, along z', () => {
    const hit = rayObstacles([WALL], 2.2, 8, 0, -1, 9)!;
    expect(hit.dist).toBeCloseTo(3);
    expect([hit.nx, hit.nz]).toEqual([0, 1]);
  });
  it('blockedBy keeps a circle out of a box', () => {
    expect(blockedBy([WALL], 1.8, 0, 0.3)).toBe(true);
    expect(blockedBy([WALL], 1.6, 0, 0.3)).toBe(false);
  });
});

describe('Cover: the clips are in the table', () => {
  it('every clip it names has a length and a travel', () => {
    const names = [CLIPS.enterHigh, CLIPS.enterLow, CLIPS.exitHigh, CLIPS.exitLow, CLIPS.idleLow, ...CLIPS.sidleHigh, ...CLIPS.sidleLow, ...CLIPS.vault, CLIPS.rollRun];
    for (const n of names) {
      const c = (table as Record<string, { seconds: number; travel: number[] }>)[n];
      expect(c, n).toBeDefined();
      expect(c.seconds).toBeGreaterThan(0.5);
      expect(c.travel).toHaveLength(2);
    }
  });
});

describe('Cover: Space by what is ahead', () => {
  it('does nothing without Space', () => {
    const c = new Cover([WALL], table);
    expect(c.update(input())).toBeNull();
    expect(c.active).toBe(false);
  });

  it('a tall wall: stands to cover with his back to it, 0.38 m off its face, heading the clip’s +z at it', () => {
    const c = new Cover([WALL], table);
    const f = c.update(input({ space: true }))!;
    expect(f.state).toBe('enter');
    expect(f.layers[0].name).toBe(CLIPS.enterHigh);
    expect(f.crouched).toBe(false);
    // The heading faces +x, at the wall (atan2(x, z) of (1, 0)).
    expect(f.heading).toBeCloseTo(Math.PI / 2);
    const end = run(c, { x: 0, z: 0 }, 2)!;
    expect(end.state).toBe('hold');
    expect(end.x).toBeCloseTo(WALL.x0 - STAND_OFF, 1);
    expect(end.z).toBeCloseTo(0, 1);
    expect(c.current).toBe('hold');
  });

  it('something low: crouches behind it, and the crouched idle fades in over the entry’s last frame', () => {
    const c = new Cover([CRATE], table);
    c.update(input({ space: true }));
    const end = run(c, { x: 0, z: 0 }, 3)!;
    expect(end.crouched).toBe(true);
    expect(end.layers[0].name).toBe(CLIPS.enterLow);
    expect(end.layers.some((l) => l.name === CLIPS.idleLow && l.weight > 0.9)).toBe(true);
  });

  it('something low with W held: over it, landing past the far side', () => {
    const c = new Cover([CRATE], table);
    const f = c.update(input({ space: true, forward: true }))!;
    expect(f.state).toBe('vault');
    expect(CLIPS.vault as readonly string[]).toContain(f.layers[0].name);
    const end = run(c, { x: 0, z: 0 }, 3, () => ({}))!;
    expect(end.x).toBeGreaterThan(CRATE.x1);
    expect(c.active).toBe(false);
  });

  it('too tall to vault (1.4 m is cover, not a hop): crouches behind it even running at it', () => {
    const tall: Obstacle = { ...TALL_CRATE, h: 1.4 };
    const c = new Cover([tall], table);
    expect(c.update(input({ space: true, forward: true, run: true }))!.state).toBe('enter');
  });

  it('a vault with its far side blocked is not taken: cover instead', () => {
    const behind: Obstacle = { x0: 2.7, x1: 3.5, z0: -1, z1: 1, h: 3 };
    const c = new Cover([CRATE, behind], table);
    expect(c.update(input({ space: true, forward: true }))!.state).toBe('enter');
  });

  it('nothing ahead: Mixamo’s sprint-to-roll, standing, walking or running, the run-in skipped more from a stand', () => {
    const still = new Cover([], table).update(input({ space: true }))!;
    expect(still.state).toBe('roll');
    expect(still.layers[0].name).toBe(CLIPS.rollRun);
    // (It starts partway into the clip: the lead for a stand.)
    expect(still.layers[0].time).toBeCloseTo(DEFAULT_TUNING.rollLeadStill, 1);
    const walking = new Cover([], table).update(input({ space: true, forward: true }))!;
    expect(walking.layers[0].time).toBeCloseTo(DEFAULT_TUNING.rollLeadStill, 1);
    const running = new Cover([], table).update(input({ space: true, forward: true, run: true }))!;
    expect(running.layers[0].name).toBe(CLIPS.rollRun);
    expect(running.layers[0].time).toBeCloseTo(DEFAULT_TUNING.rollLeadRun, 1);
  });

  it('a roll fades out over its last 0.3 s (it ends in a run: the way back to standing is slow), not snapping off', () => {
    const c = new Cover([], table);
    let f = c.update(input({ space: true }))!;
    const weights: number[] = [f.layers[0].weight];
    while (c.active) {
      f = c.update(input({}))!;
      weights.push(f.layers[0].weight);
    }
    expect(Math.max(...weights)).toBe(1);
    // The last frames come down gradually: no step bigger than a fraction of the whole.
    const steps = weights.slice(1).map((w, k) => Math.abs(w - weights[k]));
    expect(Math.max(...steps)).toBeLessThan(0.15);
    expect(weights.filter((w) => w < 1 && w > 0).length).toBeGreaterThan(8);
  });

  it('standing, a roll goes the view’s way; with keys held, theirs', () => {
    const ahead = run(new Cover([], table), { x: 0, z: 0 }, 3, (t) => ({ space: t < DT }))!;
    expect(ahead.x).toBeGreaterThan(2);
    expect(Math.abs(ahead.z)).toBeLessThan(0.01);
    const back = run(new Cover([], table), { x: 0, z: 0 }, 3, (t) => ({ space: t < DT, back: true }))!;
    expect(back.x).toBeLessThan(-2);
  });

  it('a faster roll is over sooner, and a longer distance goes further; the clip’s own curve moves the body (fast in the run-in, slow in the roll)', () => {
    const seconds = (speed: number): number => {
      const c = new Cover([], table);
      c.tuning.rollSpeed = speed;
      c.update(input({ space: true }));
      let t = 0;
      while (c.active && t < 10) {
        c.update(input({}));
        t += DT;
      }
      return t;
    };
    expect(seconds(2)).toBeLessThan(seconds(1) * 0.6);
    const far = (share: number): number => {
      const c = new Cover([], table);
      c.tuning.rollDistance = share;
      return run(c, { x: 0, z: 0 }, 4, (t) => ({ space: t < DT }))!.x;
    };
    expect(far(1)).toBeGreaterThan(far(0.5) * 1.8);
    // From the start of the clip (nothing skipped, its own pace, the whole distance) the first half of its time covers more than half
    // of the way: the run-in is fast, the roll itself slow (the sprint-to-roll's curve: 0.655 of it by 0.6 s).
    const c = new Cover([], table);
    Object.assign(c.tuning, { rollLeadStill: 0, rollSpeed: 1, rollDistance: 1 });
    let x = c.update(input({ space: true }))!.x;
    for (let t = DT; t < 0.6; t += DT) x = c.update(input({}))!.x;
    const whole = (table as Record<string, { travel: number[] }>)[CLIPS.rollRun].travel[1];
    expect(x).toBeGreaterThan(whole * 0.55);
    expect(x).toBeLessThan(whole * 0.75);
  });

  it('the roll goes the way the keys say (D is the camera’s right), and stops short of a wall', () => {
    const c = new Cover([{ x0: -5, x1: 5, z0: 1.2, z1: 3, h: 3 }], table);
    // Looking east, D is south (+z): the wall is 1.2 m that way, and he keeps half a metre off it: not the 0.9 a roll needs.
    expect(c.update(input({ space: true, right: true, run: true }))).toBeNull();
    // Rolling the other way (A, north, -z): room.
    const w = c.update(input({ space: true, left: true, run: true }))!;
    expect(w.state).toBe('roll');
    const end = run(c, { x: 0, z: 0 }, 4)!;
    expect(end.z).toBeLessThan(-2.5);
    expect(Math.abs(end.x)).toBeLessThan(0.5);
  });

  it('a roll nearly into a wall is shortened to stop short of it', () => {
    const c = new Cover([{ x0: 3.5, x1: 4, z0: -5, z1: 5, h: 3 }], table);
    // 3.5 m to the wall, but it's farther than REACH (2.2): the roll plays and stops 0.5 m short.
    c.update(input({ space: true, forward: true, run: true }));
    const end = run(c, { x: 0, z: 0 }, 4)!;
    expect(end.x).toBeLessThanOrEqual(3.0 + 0.01);
    expect(end.x).toBeGreaterThan(2);
  });
});

describe('Cover: in cover', () => {
  const into = (obstacle: Obstacle): { c: Cover; at: { x: number; z: number } } => {
    const c = new Cover([obstacle], table);
    c.update(input({ space: true }));
    const f = run(c, { x: 0, z: 0 }, 3)!;
    return { c, at: { x: f.x, z: f.z } };
  };

  it('Space steps out: the exit clip, the body moving away from the wall as it does, then free', () => {
    const { c, at } = into(WALL);
    const f = c.update(input({ ...at, space: true }))!;
    expect(f.state).toBe('exit');
    expect(f.layers[0].name).toBe(CLIPS.exitHigh);
    const end = run(c, at, 3)!;
    expect(c.active).toBe(false);
    // Away from the wall (-x), by about the clip's own travel.
    expect(end.x).toBeLessThan(at.x - 0.5);
    expect(end.x).toBeGreaterThan(at.x - 1.5);
  });

  it('sidles along it with A and D, the clip chosen by which way, at the clip’s own pace', () => {
    const { c, at } = into(WALL);
    // Looking east with the wall ahead: D (screen right) is +z.
    const right = run(c, at, 1, () => ({ right: true }))!;
    expect(right.state).toBe('slide');
    expect(right.z).toBeGreaterThan(0.5);
    expect(Math.abs(right.x - at.x)).toBeLessThan(0.01);
    const sidle = new Set<string>();
    const c2 = into(WALL);
    for (let t = 0; t < 1; t += DT) sidle.add(c2.c.update(input({ ...c2.at, left: true }))!.layers[0].name);
    // A and D pick opposite clips.
    const c3 = into(WALL);
    const d = c3.c.update(input({ ...c3.at, right: true }))!.layers[0].name;
    expect([...sidle][0]).not.toBe(d);
    expect(CLIPS.sidleHigh as readonly string[]).toContain(d);
  });

  it('a corner stops the sidle: he does not walk off the end of the wall', () => {
    const short: Obstacle = { x0: 2, x1: 2.4, z0: -1, z1: 1, h: 3 };
    const { c, at } = into(short);
    const end = run(c, at, 5, () => ({ right: true }))!;
    expect(end.z).toBeLessThan(1.05);
    expect(end.z).toBeGreaterThan(0.5);
  });

  it('crouched cover over a low wall: Space with W goes over it, Space alone steps out', () => {
    const over = into(CRATE);
    const f = over.c.update(input({ ...over.at, space: true, forward: true }))!;
    expect(f.state).toBe('vault');
    const out = into(CRATE);
    expect(out.c.update(input({ ...out.at, space: true }))!.layers[0].name).toBe(CLIPS.exitLow);
  });

  it('holding keeps the pose still: the same place and no drift', () => {
    const { c, at } = into(WALL);
    const f = run(c, at, 1.5)!;
    expect(f.x).toBeCloseTo(at.x, 5);
    expect(f.z).toBeCloseTo(at.z, 5);
    expect(f.state).toBe('hold');
    expect(HIGH).toBeGreaterThan(1);
  });
});
