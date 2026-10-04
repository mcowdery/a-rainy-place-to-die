import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { goreSetting, lerpSword, Melee, MOVES, partFactor, segmentDistance, SWORD_GUARD, sweepHit, type Capsule, type SwordKey } from '../src/poc3d/models/melee';

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const sheath: SwordKey = { p: v(-0.2, -0.75, 0.1), dir: v(0, -0.3, 1).normalize(), edge: v(0, 1, 0.3).normalize() };

/** Runs the state for `secs` in small steps. */
function run(m: Melee, secs: number): void {
  for (let t = 0; t < secs; t += 1 / 120) m.update(1 / 120);
}

describe('melee moves', () => {
  it('every move has keys from 0 to 1 and an active window inside it', () => {
    for (const mv of Object.values(MOVES)) {
      expect(mv.keys[0].t).toBe(0);
      expect(mv.keys[mv.keys.length - 1].t).toBe(1);
      for (let i = 1; i < mv.keys.length; i++) expect(mv.keys[i].t).toBeGreaterThanOrEqual(mv.keys[i - 1].t);
      expect(mv.active[0]).toBeLessThanOrEqual(mv.active[1]);
    }
  });

  it('a click with the fists down puts them up; then the combo runs jab, cross, hook, uppercut', () => {
    const m = new Melee();
    m.attack();
    expect(m.drawn).toBe(true);
    expect(m.move).toBeNull();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      m.attack();
      seen.push(m.move!.id);
      run(m, m.move!.time + 0.05);
    }
    expect(seen).toEqual(['jab', 'cross', 'hook', 'uppercut']);
  });

  it('a click late in a move queues the next; a pause starts the combo over', () => {
    const m = new Melee();
    m.drawn = true;
    m.attack();
    run(m, MOVES.jab.time * 0.6);
    m.attack();
    run(m, MOVES.jab.time * 0.5);
    expect(m.move?.id).toBe('cross');
    run(m, 2);
    m.attack();
    expect(m.move?.id).toBe('jab');
  });

  it('a click early in a move is ignored', () => {
    const m = new Melee();
    m.drawn = true;
    m.attack();
    run(m, 0.02);
    m.attack();
    run(m, MOVES.jab.time + 0.05);
    expect(m.move).toBeNull();
  });

  it('strikes only in its active window', () => {
    const m = new Melee();
    m.drawn = true;
    m.attack();
    const hits: boolean[] = [];
    for (let t = 0; t < MOVES.jab.time; t += 0.01) {
      hits.push(m.striking === 'fist_l');
      m.update(0.01);
    }
    expect(hits[0]).toBe(false);
    expect(hits.some((h) => h)).toBe(true);
    expect(hits[hits.length - 1]).toBe(false);
  });

  it('the katana draws, cuts in turn, thrusts from the guard and sheathes', () => {
    const m = new Melee();
    m.setWeapon('katana');
    m.toggleDrawn();
    expect(m.move?.id).toBe('draw');
    // Drawing starts from the saya.
    expect(m.pose(sheath).sword!.p.distanceTo(sheath.p)).toBeLessThan(1e-6);
    run(m, MOVES.draw.time + 0.05);
    expect(m.drawn).toBe(true);
    expect(m.pose(sheath).sword!.p.distanceTo(SWORD_GUARD.p)).toBeLessThan(1e-6);
    m.attack();
    expect(m.move?.id).toBe('slashR');
    run(m, MOVES.slashR.time + 0.05);
    m.attack();
    expect(m.move?.id).toBe('slashL');
    run(m, 2);
    m.guarding = true;
    m.attack();
    expect(m.move?.id).toBe('thrust');
    run(m, 2);
    m.guarding = false;
    m.toggleDrawn();
    run(m, MOVES.sheathe.time + 0.05);
    expect(m.drawn).toBe(false);
    expect(m.pose(sheath).sword).toBeNull();
  });

  it('a kick lifts the foot and puts it back', () => {
    const m = new Melee();
    m.drawn = true;
    m.kick();
    expect(m.pose(sheath).foot).toBeNull();
    run(m, MOVES.kick.time * 0.5);
    const f = m.pose(sheath).foot!;
    expect(f.w).toBeCloseTo(1, 1);
    expect(f.p.y).toBeGreaterThan(0.8);
    run(m, MOVES.kick.time);
    expect(m.pose(sheath).foot).toBeNull();
  });

  it('the sword turns on its arc with its edge square to the blade', () => {
    const b: SwordKey = { p: v(0, -0.2, -0.4), dir: v(-1, 0, -0.3).normalize(), edge: v(0, -1, 0) };
    for (let u = 0; u <= 1; u += 0.1) {
      const k = lerpSword(SWORD_GUARD, b, u);
      expect(k.dir.length()).toBeCloseTo(1, 5);
      expect(Math.abs(k.dir.dot(k.edge))).toBeLessThan(1e-5);
    }
  });
});

describe('hits', () => {
  it('measures segments', () => {
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0.5, 1, -1), v(0.5, 1, 1))).toBeCloseTo(1, 6);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0))).toBeCloseTo(1, 6);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0, 2, 0), v(1, 2, 0))).toBeCloseTo(2, 6);
  });

  const body: Capsule[] = [
    { name: 'torso', a: v(0, 0.9, 0), b: v(0, 1.4, 0), r: 0.17 },
    { name: 'head', a: v(0, 1.55, 0), b: v(0, 1.68, 0), r: 0.1 },
  ];

  it('a blade swept through a body cuts it, though both ends of the sweep are clear of it', () => {
    // From right of him to left of him at chest height, in one frame.
    const hit = sweepHit([v(0.6, 1.2, -0.3), v(1.3, 1.2, -0.3)], [v(-0.6, 1.2, 0.2), v(-1.3, 1.2, 0.2)], 0.012, body);
    expect(hit?.part.name).toBe('torso');
  });

  it('a swing over his head misses', () => {
    expect(sweepHit([v(0.6, 2.0, 0), v(1.3, 2.0, 0)], [v(-0.6, 2.0, 0), v(-1.3, 2.0, 0)], 0.012, body)).toBeNull();
  });

  it('a jab to the face finds the head', () => {
    const hit = sweepHit([v(0, 1.62, -0.6), v(0, 1.62, -0.5)], [v(0, 1.62, -0.25), v(0, 1.62, -0.12)], 0.045, body);
    expect(hit?.part.name).toBe('head');
  });

  it('the head and neck take more, the limbs less', () => {
    expect(partFactor('head')).toBeGreaterThan(1);
    expect(partFactor('neck')).toBeGreaterThan(1);
    expect(partFactor('torso')).toBe(1);
    expect(partFactor('lowerarm_l')).toBeLessThan(1);
  });

  it('gore follows the URL first', () => {
    expect(goreSetting('?gore=low')).toBe('low');
    expect(goreSetting('?gore=off')).toBe('off');
    expect(['full', 'low', 'off']).toContain(goreSetting('?gore=nonsense'));
  });
});

describe('directions and enemies', () => {
  it('a swing goes the way the mouse moved', () => {
    const fists = new Melee();
    fists.drawn = true;
    fists.attack('left');
    expect(fists.move?.id).toBe('hookR');
    const sword = new Melee();
    sword.setWeapon('katana');
    sword.drawn = true;
    sword.attack('down');
    expect(sword.move?.id).toBe('overhead');
    sword.cancel();
    sword.attack('up');
    expect(sword.move?.id).toBe('rising');
  });

  it("the right hook is the left's mirror, thrown with the right hand", () => {
    expect(MOVES.hookR.hitter).toBe('fist_r');
    const k = MOVES.hook.keys[2].l!;
    const m = MOVES.hookR.keys[2].r!;
    expect(m.p.x).toBeCloseTo(-k.p.x);
    expect(m.p.z).toBeCloseTo(k.p.z);
    expect(MOVES.hookR.keys[2].twist).toBeCloseTo(-MOVES.hook.keys[2].twist!);
  });

  it("an enemy's slower rate stretches his moves", () => {
    const m = new Melee();
    m.drawn = true;
    m.rate = 0.5;
    m.attack();
    run(m, MOVES.jab.time * 1.2);
    expect(m.move?.id).toBe('jab');
    run(m, MOVES.jab.time);
    expect(m.move).toBeNull();
  });
});
