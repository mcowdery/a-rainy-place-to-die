import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STICKS } from '../src/poc3d/models/cigarette';
import { Smoking, type ArmBones, type Hands, type SmokeCtx } from '../src/poc3d/models/smoking';

/** Hands that go where they're told (no body round them): enough to run the act. */
function fakeHands(): Hands {
  const arm = (x: number): ArmBones & { root: THREE.Bone } => {
    const root = new THREE.Bone();
    const upper = new THREE.Bone();
    const lower = new THREE.Bone();
    const hand = new THREE.Bone();
    root.add(upper, lower, hand);
    upper.position.set(x, 1.5, 0);
    hand.position.set(x, 0.95, 0.05);
    const finger = (i: number): THREE.Bone[] => [0.08, 0.11, 0.13].map((d) => {
      const b = new THREE.Bone();
      b.position.set(0.01 * i, -d, 0);
      hand.add(b);
      return b;
    });
    root.updateMatrixWorld(true);
    return { root, upper, lower, hand, fingers: [0, 1, 2, 3].map(finger), thumb: finger(-1) };
  };
  const arms = { l: arm(0.2), r: arm(-0.2) };
  const frames = { l: { fwd: new THREE.Vector3(0, -1, 0), palm: new THREE.Vector3(-1, 0, 0) }, r: { fwd: new THREE.Vector3(0, -1, 0), palm: new THREE.Vector3(1, 0, 0) } };
  return {
    arm: (s) => arms[s],
    reset: () => undefined,
    reach: (s, wrist) => {
      arms[s].hand.position.copy(wrist);
      arms[s].root.updateMatrixWorld(true);
    },
    orient: (s, fwd, palm) => {
      frames[s] = { fwd: fwd.clone(), palm: palm.clone() };
    },
    relax: () => undefined,
    frame: (s) => ({ fwd: frames[s].fwd.clone(), palm: frames[s].palm.clone() }),
  };
}

describe('Mack smoking', () => {
  const ctx = (free: boolean, running = false, dt = 1 / 60): SmokeCtx => ({ dt, eye: new THREE.Vector3(0, 1.7, 0), viewQ: new THREE.Quaternion(), fx: 0, fz: -1, floor: 0, sc: 1, free, idle: !running, running, squat: 0, face: null });
  const run = (s: Smoking, seconds: number, free: boolean, each?: () => void, running = false): void => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      s.pose(ctx(free, running));
      s.place(ctx(free, running));
      each?.();
    }
  };

  it('lights up only with both hands free, with a flame, and ends with it burning in his hand', () => {
    const s = new Smoking(fakeHands());
    run(s, 0.1, false);
    expect(s.light('cigarette')).toBe(false);
    run(s, 0.1, true);
    expect(s.light('cigarette')).toBe(true);
    // (Nothing's conjured: it isn't lit until the flame has been at it.)
    expect(s.out.lit).toBe(false);
    let flame = 0;
    let litAt = -1;
    let flameAt = -1;
    let t = 0;
    run(s, 5, true, () => {
      t += 1 / 60;
      flame = Math.max(flame, s.out.flame);
      if (flameAt < 0 && s.out.flame > 0.5) flameAt = t;
      if (litAt < 0 && s.out.lit) litAt = t;
    });
    expect(flame).toBeGreaterThan(0.9);
    expect(litAt).toBeGreaterThan(flameAt);
    expect(s.what).toBe('cigarette');
    expect(s.held).toBe('hand');
    expect(s.out.lit).toBe(true);
    expect(s.out.flame).toBe(0);
    // A second one can't be lit over it.
    expect(s.light('cigar')).toBe(false);
  });

  it('draws on it every so often: the ember flares at his mouth, then the breath comes out', () => {
    const s = new Smoking(fakeHands());
    run(s, 0.1, true);
    s.light('cigarette');
    run(s, 5, true);
    let heat = 0;
    let breath = 0;
    let nearest = Infinity;
    let hotAt = -1;
    let breathAt = -1;
    let t = 0;
    run(s, 16, true, () => {
      t += 1 / 60;
      if (s.out.heat > heat) [heat, hotAt] = [s.out.heat, t];
      if (s.out.breath > breath) [breath, breathAt] = [s.out.breath, t];
      if (s.out.heat > 0.9) nearest = Math.min(nearest, s.out.tip.distanceTo(s.out.mouth));
    });
    expect(heat).toBeGreaterThan(0.95);
    expect(breath).toBeGreaterThan(0.95);
    expect(breathAt).toBeGreaterThan(hotAt);
    // On the drag its mouth end is at his lips: the lit end a cigarette's length from them.
    expect(nearest).toBeLessThan(STICKS.cigarette.len + 0.02);
  });

  it('left to himself lights one before long, standing about sooner than walking, and another a while after', () => {
    const s = new Smoking(fakeHands());
    // Not by himself unless that's wanted, and not with his hands full.
    run(s, 30, true);
    expect(s.what).toBeNull();
    s.auto = 'cigarette';
    run(s, 30, false);
    expect(s.what).toBeNull();
    let t = 0;
    while (!s.what && t < 60) {
      run(s, 0.5, true);
      t += 0.5;
    }
    expect(t).toBeGreaterThan(3);
    expect(t).toBeLessThan(12);
    run(s, 6, true);
    expect(s.held).toBe('hand');
    // Flicked away, he doesn't light the next at once, but does in a couple of minutes.
    s.flick();
    run(s, 10, true);
    expect(s.what).toBeNull();
    run(s, 20, true);
    expect(s.what).toBeNull();
    run(s, 120, true);
    expect(s.what).toBe('cigarette');
  });

  it('throws it away when he breaks into a run, and lights nothing while running', () => {
    const s = new Smoking(fakeHands());
    s.auto = 'cigarette';
    run(s, 12, true);
    expect(s.what).toBe('cigarette');
    expect(s.out.lit).toBe(true);
    // Running: it leaves his hand at once and is gone within a few seconds; however long he runs, he lights no other.
    let lowest = Infinity;
    run(s, 0.6, true, () => (lowest = Math.min(lowest, s.out.tip.y)), true);
    run(s, 9, true, () => (lowest = Math.min(lowest, s.out.tip.y)), true);
    expect(lowest).toBeLessThan(0.2);
    expect(s.what).toBeNull();
    run(s, 200, true, undefined, true);
    expect(s.what).toBeNull();
    // One he's only just taken out goes back unlit.
    const t = new Smoking(fakeHands());
    run(t, 0.1, true);
    t.light('cigar');
    run(t, 0.5, true);
    run(t, 0.1, true, undefined, true);
    expect(t.what).toBeNull();
    expect(t.out.lit).toBe(false);
  });

  it('stays in his lips while his hands are busy, comes back to the hand, and is flicked away', () => {
    const s = new Smoking(fakeHands());
    run(s, 0.1, true);
    s.light('cigar');
    run(s, 5, true);
    expect(s.held).toBe('hand');
    run(s, 1.2, false);
    expect(s.held).toBe('lips');
    expect(s.out.lit).toBe(true);
    // (Between his lips, the lit end is out in front of his mouth.)
    expect(s.out.tip.distanceTo(s.out.mouth)).toBeLessThan(STICKS.cigar.len + 0.01);
    run(s, 4, true);
    expect(s.held).toBe('hand');
    expect(s.flick()).toBe(true);
    let lowest = Infinity;
    run(s, 9, true, () => {
      if (s.out.lit) lowest = Math.min(lowest, s.out.tip.y);
    });
    // It landed on the ground, burnt out, and he has nothing.
    expect(lowest).toBeLessThan(0.2);
    expect(s.what).toBeNull();
    expect(s.out.lit).toBe(false);
    expect(s.flick()).toBe(false);
  });
});
