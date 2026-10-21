import { describe, expect, it } from 'vitest';
import table from '../assets/anims/mixamo_picked.json';
import type { Obstacle } from '../src/poc3d/models/cover';
import { GUNMAN, GunBrain, type BrainOut, type GunCtx } from '../src/poc3d/models/gunmanBrain';

const DT = 1 / 60;
/** A low wall 10 m from you, 2 m long, 1 m high. */
const WALL: Obstacle = { x0: 10, x1: 10.6, z0: -1, z1: 1, h: 1 };
const LENGTHS: Record<string, number> = { Jog_Fwd_Loop: 1, Pistol_Idle_Loop: 2, Pistol_Aim_Neutral: 0.6, Pistol_Shoot: 0.5, OverhandThrow: 1.2 };
const lengthOf = (c: string): number => LENGTHS[c] ?? (table as Record<string, { seconds: number }>)[c]?.seconds ?? 1;

interface Log {
  shots: { y: number; at: number }[];
  grenades: { to: { x: number; z: number }; at: number }[];
}

function world(obstacles: readonly Obstacle[], over: Partial<GunCtx['player']> = {}, taken: GunCtx['taken'] = []): { ctx: GunCtx; log: Log; clock: { t: number } } {
  const log: Log = { shots: [], grenades: [] };
  const clock = { t: 0 };
  const ctx: GunCtx = {
    obstacles,
    player: { x: 0, z: 0, covered: false, hidden: 0, ...over },
    taken,
    fire: (from) => log.shots.push({ y: from.y, at: clock.t }),
    grenade: (_f, to) => log.grenades.push({ to: { x: to.x, z: to.z }, at: clock.t }),
  };
  return { ctx, log, clock };
}

/** Steps a brain for `seconds` from (x, z); returns the last output and where he ended. */
function run(brain: GunBrain, from: { x: number; z: number }, seconds: number, w: ReturnType<typeof world>): BrainOut {
  let me = { ...from };
  let out!: BrainOut;
  for (let t = 0; t < seconds; t += DT) {
    w.clock.t += DT;
    out = brain.update(DT, me, w.ctx);
    me = { x: out.x, z: out.z };
  }
  return out;
}

describe('GunBrain: cover', () => {
  it('chooses the face of the crate away from you, at its approach distance', () => {
    const b = new GunBrain(table, lengthOf, 1);
    const s = b.chooseSpot({ x: 20, z: 0 }, world([WALL]).ctx)!;
    // You're at x = 0, so the safe face is the far one (x1, normal +x), and he stands off it by the approach distance.
    expect([s.nx, s.nz]).toEqual([1, 0]);
    expect(s.x).toBeCloseTo(WALL.x1 + GUNMAN.approach);
  });

  it('uses only cover he can shoot over: a wall of 3 m or a crate of 1.4 m is not, so he stands and watches', () => {
    const b = new GunBrain(table, lengthOf, 1);
    expect(b.chooseSpot({ x: 20, z: 0 }, world([{ ...WALL, h: 3 }, { ...WALL, h: 1.4, x0: 14, x1: 15 }]).ctx)).toBeNull();
    const w = world([{ ...WALL, h: 3 }]);
    const out = run(b, { x: 20, z: 0 }, 0.5, w);
    expect(out.state).toBe('stand');
  });

  it('runs to it, crouches behind it (against the face), and holds', () => {
    const w = world([WALL]);
    const b = new GunBrain(table, lengthOf, 1);
    const out = run(b, { x: 20, z: 0 }, 5, w);
    expect(['covered', 'peek']).toContain(out.state);
    expect(out.x).toBeCloseTo(WALL.x1 + 0.38, 1);
    // (And when he's running it's the jog clip.)
    const early = run(new GunBrain(table, lengthOf, 1), { x: 20, z: 0 }, 0.5, world([WALL]));
    expect(early.state).toBe('seek');
    expect(early.layers[0].name).toBe('Jog_Fwd_Loop');
  });

  it('two gunmen don\'t take the same face: the second keeps off the first', () => {
    const long: Obstacle = { ...WALL, z0: -2, z1: 2 };
    const w = world([long]);
    const a = new GunBrain(table, lengthOf, 1).chooseSpot({ x: 20, z: 0 }, w.ctx)!;
    const b = new GunBrain(table, lengthOf, 2).chooseSpot({ x: 20, z: 0 }, world([long], {}, [{ x: a.fx, z: a.fz }]).ctx)!;
    // (The same face, but another point on it: a stride off, with room for a second man behind the same crate.)
    expect(Math.hypot(b.fx - a.fx, b.fz - a.fz)).toBeGreaterThan(0.8);
  });
});

describe('GunBrain: peeking and shooting', () => {
  it('peeks up and fires bursts of two or three, from muzzle height, with gaps, then drops back', () => {
    const w = world([WALL]);
    const b = new GunBrain(table, lengthOf, 3);
    run(b, { x: 20, z: 0 }, 20, w);
    expect(w.log.shots.length).toBeGreaterThanOrEqual(4);
    for (const s of w.log.shots) expect(s.y).toBeCloseTo(GUNMAN.muzzle);
    // The shots come in runs separated by at least the gap, and no run is longer than the burst's top.
    const gaps = w.log.shots.slice(1).map((s, i) => s.at - w.log.shots[i].at);
    expect(Math.min(...gaps)).toBeGreaterThan(GUNMAN.gap * 0.9);
    let run3 = 1;
    let most = 1;
    for (const g of gaps) {
      run3 = g < GUNMAN.gap * 1.5 ? run3 + 1 : 1;
      most = Math.max(most, run3);
    }
    expect(most).toBeLessThanOrEqual(GUNMAN.burst[1]);
  });

  it('is hidden between bursts: not always up', () => {
    const w = world([WALL]);
    const b = new GunBrain(table, lengthOf, 4);
    let me = { x: 20, z: 0 };
    let up = 0;
    let down = 0;
    for (let t = 0; t < 25; t += DT) {
      w.clock.t += DT;
      const o = b.update(DT, me, w.ctx);
      me = { x: o.x, z: o.z };
      if (t > 6) o.up ? up++ : down++;
    }
    expect(up).toBeGreaterThan(30);
    expect(down).toBeGreaterThan(up);
  });
});

describe('GunBrain: flushing you out', () => {
  it('throws a grenade at where you are once you have been in cover out of sight long enough, and then waits out its gap', () => {
    const w = world([WALL], { x: 0, z: 0, covered: true, hidden: 6 });
    const b = new GunBrain(table, lengthOf, 5);
    run(b, { x: 20, z: 0 }, 14, w);
    expect(w.log.grenades.length).toBe(1);
    expect(w.log.grenades[0].to).toEqual({ x: 0, z: 0 });
    // Not another within the gap.
    const first = w.log.grenades[0].at;
    run(b, { x: 13, z: 0 }, 6, w);
    expect(w.log.grenades.filter((g) => g.at - first < GUNMAN.grenadeGap - 1).length).toBe(1);
  });

  it('throws none while you are in the open, or too near or too far to throw to', () => {
    const open = world([WALL], { hidden: 0 });
    run(new GunBrain(table, lengthOf, 6), { x: 20, z: 0 }, 20, open);
    expect(open.log.grenades.length).toBe(0);
    const far = world([WALL], { x: -30, z: 0, covered: true, hidden: 9 });
    run(new GunBrain(table, lengthOf, 7), { x: 20, z: 0 }, 20, far);
    expect(far.log.grenades.length).toBe(0);
  });
});
