import { describe, expect, it } from 'vitest';
import { Blocker, CHASES, ChaseState, fleeGoals, GUNMAN, LOST, missBy, pickAttacker, pursue, RAM_SLOTS, ramDamage, SHAKEN, SHOT, shotAt, SLOTS, Spawner, swarmTarget, Trigger, YOUR_HEALTH, type ChaseView, type Mover } from '../src/poc3d/district/chase';
import { Car, COUPE } from '../src/race/vehicle';
import { CITY_ASSISTS } from '../src/poc3d/district/ownCar';

const job = (id: string): ChaseState => new ChaseState(CHASES.find((c) => c.id === id)!);
const view = (o: Partial<ChaseView> & { n: number }): ChaseView => ({ driving: true, wrecked: false, dist: new Array(o.n).fill(30), seen: new Array(o.n).fill(true), ...o });
/** Run a job for s seconds with a view. */
const run = (st: ChaseState, s: number, v: ChaseView): void => {
  for (let t = 0; t < s; t += 0.1) st.update(0.1, v);
};

describe('The jobs', () => {
  it('are well formed: a hunt has a clock and a runner, the hunted have gunmen after them', () => {
    expect(new Set(CHASES.map((c) => c.id)).size).toBe(CHASES.length);
    for (const c of CHASES) {
      expect(c.pay).toBeGreaterThan(0);
      // (A gauntlet's cars come from its swarm.)
      if (c.kind === 'gauntlet') continue;
      expect(c.cars.length).toBeGreaterThan(0);
      for (const k of c.cars) {
        expect(k.health).toBeGreaterThan(0);
        expect(k.pace).toBeGreaterThan(0.6);
        expect(k.pace).toBeLessThan(1.2);
      }
      if (c.kind === 'hunt') expect(c.time).toBeGreaterThan(60);
      else expect(c.cars.every((k) => k.gunman)).toBe(true);
    }
    // Both kinds, and a getaway.
    expect(CHASES.some((c) => c.kind === 'hunt')).toBe(true);
    expect(CHASES.some((c) => c.kind === 'hunted' && !c.reach)).toBe(true);
    expect(CHASES.some((c) => c.reach)).toBe(true);
  });
});

describe('Damage', () => {
  it('the driver ends a car at once, a tyre cripples it; the glass costs more than the body; a gunman only his gun', () => {
    expect(shotAt('tyre', undefined)).toMatchObject({ out: null, tyre: true, damage: SHOT.tyre });
    expect(shotAt('head', 'driver').out).toBeTruthy();
    expect(shotAt('head', 'gunman')).toMatchObject({ out: null, gunman: true, damage: 0 });
    expect(shotAt('glass', undefined).damage).toBe(SHOT.glass);
    expect(shotAt('body', undefined).damage).toBe(SHOT.body);
    expect(SHOT.glass).toBeGreaterThan(SHOT.body);
  });

  it('a nudge is nothing and a ram tells', () => {
    expect(ramDamage(2)).toBe(0);
    expect(ramDamage(8)).toBeGreaterThan(8);
    expect(ramDamage(16)).toBeGreaterThan(ramDamage(8) * 2);
  });
});

describe('A hunt', () => {
  it('counts down, then runs; nothing counts before it does', () => {
    const st = job('runner');
    expect(st.phase).toBe('countdown');
    expect(st.shoot(0, 'tyre', undefined)).toBeNull();
    run(st, 3.2, view({ n: 1 }));
    expect(st.phase).toBe('running');
    expect(st.cars[0].out).toBeNull();
  });

  it('is won by body shots that add up, by two tyres, or by ramming', () => {
    const a = job('runner');
    run(a, 3.2, view({ n: 1 }));
    const need = Math.ceil(a.def.cars[0].health / SHOT.body);
    for (let i = 0; i < need - 1; i++) a.shoot(0, 'body', undefined);
    a.update(0.1, view({ n: 1 }));
    expect(a.phase).toBe('running');
    expect(a.shoot(0, 'body', undefined)).toMatch(/DOWN/);
    a.update(0.1, view({ n: 1 }));
    expect(a.result).toMatchObject({ won: true });

    const b = job('runner');
    run(b, 3.2, view({ n: 1 }));
    expect(b.shoot(0, 'tyre', undefined)).toMatch(/TYRE/);
    b.update(0.1, view({ n: 1 }));
    // (One tyre: it limps on.)
    expect(b.phase).toBe('running');
    expect(b.cars[0]).toMatchObject({ tyres: 1, out: null });
    b.shoot(0, 'tyre', undefined);
    b.update(0.1, view({ n: 1 }));
    expect(b.result?.won).toBe(true);
    expect(b.result?.why).toMatch(/tyres/);

    const c = job('runner');
    run(c, 3.2, view({ n: 1 }));
    for (let i = 0; i < 6 && !c.cars[0].out; i++) c.ram(0, 14);
    c.update(0.1, view({ n: 1 }));
    expect(c.result?.won).toBe(true);
  });

  it('is lost when he gets clean away, or the clock runs out, or you leave the car', () => {
    const a = job('runner');
    run(a, 3.2, view({ n: 1 }));
    run(a, LOST.secs - 1, view({ n: 1, dist: [LOST.dist + 50] }));
    expect(a.phase).toBe('running');
    // (Closing up again resets it.)
    run(a, 1, view({ n: 1, dist: [100] }));
    run(a, LOST.secs - 1, view({ n: 1, dist: [LOST.dist + 50] }));
    expect(a.phase).toBe('running');
    run(a, 2, view({ n: 1, dist: [LOST.dist + 50] }));
    expect(a.result).toMatchObject({ won: false });

    const b = job('runner');
    run(b, 3.2 + b.def.time! + 1, view({ n: 1 }));
    expect(b.result?.won).toBe(false);
    expect(b.result?.why).toMatch(/time/);

    const c = job('runner');
    run(c, 3.2, view({ n: 1 }));
    run(c, 2, view({ n: 1, driving: false }));
    expect(c.phase).toBe('running');
    run(c, 3, view({ n: 1, driving: false }));
    expect(c.result?.won).toBe(false);
  });

  it("a gunman's head only silences his gun", () => {
    const st = job('runner_armed');
    run(st, 3.2, view({ n: 1 }));
    expect(st.cars[0].gunman).toBe(true);
    expect(st.shoot(0, 'head', 'gunman')).toMatch(/gunman/);
    expect(st.cars[0].gunman).toBe(false);
    expect(st.cars[0].out).toBeNull();
    expect(st.shoot(0, 'head', 'driver')).toMatch(/HEADSHOT/);
    expect(st.cars[0].out).toBeTruthy();
  });
});

describe('Hunted', () => {
  it('is won by seeing them all off', () => {
    const st = job('tail');
    run(st, 3.2, view({ n: 2 }));
    st.shoot(0, 'tyre', undefined);
    st.shoot(0, 'tyre', undefined);
    st.update(0.1, view({ n: 2 }));
    expect(st.phase).toBe('running');
    expect(st.live).toBe(1);
    st.shoot(1, 'head', 'driver');
    st.update(0.1, view({ n: 2 }));
    expect(st.result).toMatchObject({ won: true });
  });

  it('or by losing them: all far off and out of sight for long enough', () => {
    const st = job('tail');
    run(st, 3.2, view({ n: 2 }));
    const far = [SHAKEN.dist + 30, SHAKEN.dist + 60];
    // One still sees you: not shaken.
    run(st, SHAKEN.secs + 2, view({ n: 2, dist: far, seen: [false, true] }));
    expect(st.phase).toBe('running');
    run(st, SHAKEN.secs + 1, view({ n: 2, dist: far, seen: [false, false] }));
    expect(st.result).toMatchObject({ won: true });
    expect(st.result?.why).toMatch(/lost them/);
  });

  it('is lost when their rounds add up, through the glass faster', () => {
    const st = job('tail');
    run(st, 3.2, view({ n: 2 }));
    const body = st.shot('body');
    const glass = st.shot('glass');
    expect(glass).toBeGreaterThan(body);
    expect(st.health).toBe(YOUR_HEALTH - body - glass);
    for (let i = 0; i < 40 && st.phase === 'running'; i++) st.shot('glass');
    expect(st.health).toBe(0);
    expect(st.result).toMatchObject({ won: false });
  });

  it('a getaway is won by arriving, however many are still on you', () => {
    const st = job('getaway');
    run(st, 3.2, view({ n: 2, toGoal: 900 }));
    // (Losing them isn't the job.)
    run(st, SHAKEN.secs + 2, view({ n: 2, dist: [400, 400], seen: [false, false], toGoal: 600 }));
    expect(st.phase).toBe('running');
    run(st, 0.3, view({ n: 2, toGoal: 6 }));
    expect(st.result).toMatchObject({ won: true });
  });

  it('a wrecked car ends any job', () => {
    const st = job('hit_squad');
    run(st, 3.2, view({ n: 3 }));
    st.update(0.1, view({ n: 3, wrecked: true }));
    expect(st.result).toMatchObject({ won: false });
  });
});

describe('A pursuer with you in sight', () => {
  const at = (x: number, z: number, h: number, u: number): Mover => ({ x, z, h, u });

  it('steers for its place beside you and makes up the ground', () => {
    // You heading +z at 15 m/s; it 30 m behind and 6 m to your left: its slot is on your right, so it steers right.
    const you = at(0, 0, 0, 15);
    const c = pursue(at(6, -30, 0, 12), you, SLOTS[0], 34);
    expect(c.steer).toBeLessThan(0);
    expect(c.throttle).toBeGreaterThan(0.5);
    expect(c.brake).toBe(0);
    // Far off to the other side, it steers left.
    expect(pursue(at(-12, -30, 0, 12), you, SLOTS[0], 34).steer).toBeGreaterThan(0);
  });

  it('brakes when it has overshot, and for a wall ahead, steering to the clear side', () => {
    const you = at(0, 0, 0, 8);
    // 14 m ahead of its slot and much faster: off the throttle and braking.
    const over = pursue(at(-3.1, 14, 0, 24), you, SLOTS[0], 34);
    expect(over.throttle).toBe(0);
    expect(over.brake).toBeGreaterThan(0);
    const clear = pursue(at(0, -40, 0, 25), you, SLOTS[1], 34);
    const wall = pursue(at(0, -40, 0, 25), you, SLOTS[1], 34, { ahead: 8, side: 1 });
    expect(wall.brake).toBeGreaterThan(clear.brake);
    expect(wall.steer).toBeGreaterThan(clear.steer + 0.3);
  });

  it('comes over to you from off to one side when you have stopped', () => {
    // You're stopped heading +z; it's 40 m off to your right, level with you, pointing your way.
    const you = new Car(COUPE, CITY_ASSISTS);
    you.place(0, 0, 0);
    const it = new Car(COUPE, CITY_ASSISTS);
    it.place(-40, 0, 0);
    const none = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    for (let t = 0; t < 14; t += 1 / 60) {
      you.update(1 / 60, none);
      it.update(1 / 60, pursue(it, you, SLOTS[0], 34));
    }
    // Beside you, stopped (or all but).
    expect(Math.hypot(it.x - -3.1, it.z - -0.5)).toBeLessThan(5);
    expect(Math.abs(it.u)).toBeLessThan(2.5);
  });

  it('drives a car on the handling model up beside a car going straight, and stays there', () => {
    const you = new Car(COUPE, CITY_ASSISTS);
    you.place(0, 0, 0);
    you.u = 16;
    const it = new Car(COUPE, CITY_ASSISTS);
    it.place(4, -45, 0.2);
    it.u = 10;
    let worst = 0;
    for (let t = 0; t < 14; t += 1 / 60) {
      // (You hold 16 m/s.)
      you.update(1 / 60, { throttle: you.u < 16 ? 0.5 : 0, brake: 0, steer: 0, handbrake: false });
      it.update(1 / 60, pursue(it, you, SLOTS[0], 34));
      if (t > 9) worst = Math.max(worst, Math.hypot(it.x - (you.x - 3.1), it.z - (you.z - 0.5)));
    }
    // Within a couple of metres of its place on your right, at your speed, pointing your way.
    expect(worst).toBeLessThan(2.5);
    expect(Math.abs(it.u - you.u)).toBeLessThan(2);
    expect(Math.abs(it.h - you.h)).toBeLessThan(0.15);
    expect(it.x).toBeLessThan(you.x - 1.6);
  });
});

describe('A runner', () => {
  it('runs away from you, the way it is already going for choice', () => {
    // It heads +z at the origin; you're behind it.
    const goals = fleeGoals(0, 0, 0, 1, 0, -40);
    expect(goals.length).toBeGreaterThan(6);
    for (const [gx, gz] of goals) {
      // Never back toward you.
      const toward = (gx * 0 + gz * -1) / Math.hypot(gx, gz);
      expect(toward).toBeLessThan(0.55);
    }
    // The best is ahead of it.
    expect(goals[0][1]).toBeGreaterThan(400);
    // With you ahead, the best is not through you.
    const cut = fleeGoals(0, 0, 0, 1, 0, 40);
    expect(cut[0][1]).toBeLessThan(200);
  });
});

describe('A gunman', () => {
  it('misses by more the further off, the faster, and across his own car; a better shot by less', () => {
    expect(missBy(40, 30, false, 1)).toBeGreaterThan(missBy(10, 30, false, 1));
    expect(missBy(20, 60, false, 1)).toBeGreaterThan(missBy(20, 10, false, 1));
    expect(missBy(20, 30, true, 1)).toBeGreaterThan(missBy(20, 30, false, 1));
    expect(missBy(20, 30, false, 1.3)).toBeLessThan(missBy(20, 30, false, 1));
  });

  it('takes a moment to bring the gun up, fires in bursts with pauses, and lowers it when he loses the line', () => {
    let seed = 7;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const g = new Trigger(rand);
    const shots: number[] = [];
    for (let t = 0; t < 30; t += 1 / 60) if (g.step(1 / 60, true)) shots.push(t);
    expect(shots[0]).toBeGreaterThanOrEqual(GUNMAN.aim);
    expect(shots.length).toBeGreaterThan(10);
    expect(shots.length).toBeLessThan(40);
    const gaps = shots.slice(1).map((s, i) => s - shots[i]);
    // Shots a beat apart within a burst, and real pauses between bursts.
    expect(Math.min(...gaps)).toBeGreaterThan(0.35);
    expect(gaps.filter((d) => d > 1.7).length).toBeGreaterThan(2);
    expect(g.raised).toBe(1);
    for (let t = 0; t < 2; t += 1 / 60) expect(g.step(1 / 60, false)).toBe(false);
    expect(g.raised).toBe(0);
  });
});

describe('The gauntlet', () => {
  const def = CHASES.find((c) => c.kind === 'gauntlet')!;
  const sw = def.swarm!;

  it('runs from one node to another, with a swarm and roadblocks', () => {
    expect(def.from).toBeTruthy();
    expect(def.reach).toBeTruthy();
    expect(def.from).not.toBe(def.reach);
    expect(sw.roster.some((r) => r.def.ram)).toBe(true);
    expect(sw.roster.some((r) => r.def.gunman)).toBe(true);
    expect(sw.blocks.length).toBeGreaterThan(1);
    expect(RAM_SLOTS.length).toBeGreaterThan(1);
  });

  it('has no end but the far side: wiping out the cars on you ends nothing, arriving wins', () => {
    const st = new ChaseState(def);
    const v = (toGoal: number): ChaseView => ({ driving: true, wrecked: false, dist: st.cars.map(() => 30), seen: st.cars.map(() => true), toGoal });
    for (let i = 0; i < 3; i++) st.add(sw.roster[0].def);
    for (let t = 0; t < 6; t += 0.1) st.update(0.1, v(3000));
    expect(st.running).toBe(true);
    for (let i = 0; i < 3; i++) st.ram(i, 40);
    expect(st.live).toBe(0);
    expect(st.kills).toBe(3);
    for (let t = 0; t < 30; t += 0.1) st.update(0.1, v(3000));
    expect(st.result).toBeNull();
    st.update(0.1, v(10));
    expect(st.result).toMatchObject({ won: true });
  });

  it('counts a kill once, whether shot or rammed, and keeps its lists in step as cars come and go', () => {
    const st = new ChaseState(def);
    st.update(5.1, view({ n: 0 }));
    const a = st.add(sw.roster[0].def);
    const b = st.add(sw.roster[1].def);
    st.shoot(a, 'head', 'driver');
    st.shoot(a, 'head', 'driver');
    st.ram(a, 40);
    expect(st.kills).toBe(1);
    st.drop(a);
    expect(st.cars.length).toBe(1);
    expect(st.defs[0]).toBe(sw.roster[1].def);
    expect(st.cars[0].health).toBe(sw.roster[1].def.health);
    expect(b).toBe(1);
  });

  it('gives you more health than an ordinary job, and a longer countdown', () => {
    const st = new ChaseState(def);
    expect(st.maxHealth).toBeGreaterThan(YOUR_HEALTH);
    expect(st.health).toBe(st.maxHealth);
    expect(st.countdown).toBeGreaterThan(job('tail').countdown);
  });

  it('sends more of them the further you go, and the rarer ones only later', () => {
    expect(swarmTarget(sw, 0)).toBe(sw.start);
    expect(swarmTarget(sw, 1)).toBe(sw.max);
    expect(swarmTarget(sw, 0.5)).toBeGreaterThan(sw.start);
    const early = new Set<string>();
    const late = new Set<string>();
    for (let k = 0; k < 400; k++) {
      early.add(pickAttacker(sw, 0, () => (k + 0.5) / 400).paint.toString());
      late.add(pickAttacker(sw, 1, () => (k + 0.5) / 400).paint.toString());
    }
    expect(late.size).toBeGreaterThan(early.size);
    expect(pickAttacker(sw, 0, () => 0.999).type).not.toBe('sports');
  });

  it('puts a new car on the road as soon as one is gone, mostly ahead of you', () => {
    const sp = new Spawner(() => 0.5);
    expect(sp.step(1, 5, 5)).toBeNull();
    let ahead = 0;
    let n = 0;
    let seed = 12345;
    const r = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const sp2 = new Spawner(r);
    for (let t = 0; t < 600; t += 0.1) {
      const w = sp2.step(0.1, 2, 6);
      if (w) {
        n++;
        if (w === 'ahead') ahead++;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(ahead / n).toBeGreaterThan(0.6);
    expect(ahead / n).toBeLessThan(0.95);
    // Well under the number it wants it sends one at least every 1.5 s.
    expect(n).toBeGreaterThan(600 / 1.6);
    sp.failed();
    expect(sp.step(0.1, 0, 5)).toBeNull();
    expect(sp.step(0.5, 0, 5)).not.toBeNull();
  });

  it('lays a roadblock now and then, never more than it is allowed', () => {
    const b = new Blocker([24, 40], 2, () => 0.5);
    let laid = 0;
    let standing = 0;
    for (let t = 0; t < 400; t += 0.5) {
      expect(standing).toBeLessThanOrEqual(2);
      if (b.step(0.5, standing)) {
        laid++;
        standing++;
      }
      if (t % 60 === 0 && standing > 0) standing--;
    }
    expect(laid).toBeGreaterThan(5);
    const never = new Blocker([5, 5], 0, () => 0.5);
    for (let t = 0; t < 100; t += 0.5) expect(never.step(0.5, 0)).toBe(false);
  });
});
