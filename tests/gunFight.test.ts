import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Obstacle } from '../src/poc3d/models/cover';
import { GRENADE, GunFight, type PlayerInfo } from '../src/poc3d/models/gunFight';

/** A crate 1.1 m high, 1 m in front of you (you at the origin, the gunman off along +x). */
const CRATE: Obstacle = { x0: 0.8, x1: 1.4, z0: -1.5, z1: 1.5, h: 1.1 };
const MUZZLE = { x: 12, y: 1.45, z: 0 };

function fight(player: PlayerInfo, obstacles: readonly Obstacle[] = [CRATE]): { g: GunFight; damage: number[]; blasts: number[] } {
  const g = new GunFight(new THREE.Scene());
  g.obstacles = obstacles;
  g.player = () => player;
  const damage: number[] = [];
  const blasts: number[] = [];
  g.onHit = (_w, d) => damage.push(d);
  g.onBlast = (d) => blasts.push(d);
  return { g, damage, blasts };
}

describe('GunFight: shots and cover', () => {
  it('crouched behind a crate (1.1 m) you are safe from a gunman standing at the other side of it', () => {
    const { g, damage } = fight({ x: 0, z: 0, height: 1.0, hidden: true });
    for (let i = 0; i < 300; i++) g.shot(MUZZLE);
    expect(g.shotsAtYou).toBe(300);
    expect(damage.length).toBe(0);
  });

  it('peeking over it (standing, 1.8 m) you are not: a good share of shots hit', () => {
    const { g, damage } = fight({ x: 0, z: 0, height: 1.8, hidden: false });
    for (let i = 0; i < 300; i++) g.shot(MUZZLE);
    // (About a fifth at 12 m: a gunman misses more than he hits.)
    expect(damage.length).toBeGreaterThan(20);
    expect(damage.length).toBeLessThan(200);
  });

  it('with nothing in the way a crouched man is hit as a standing one is (cover is the crate, not the crouch)', () => {
    const { g, damage } = fight({ x: 0, z: 0, height: 1.0, hidden: true }, []);
    for (let i = 0; i < 300; i++) g.shot(MUZZLE);
    expect(damage.length).toBeGreaterThan(20);
  });

  it('a tall wall stops a shot at any height; a hit does the damage it says', () => {
    const wall = fight({ x: 0, z: 0, height: 1.8, hidden: false }, [{ ...CRATE, h: 3 }]);
    for (let i = 0; i < 200; i++) wall.g.shot(MUZZLE);
    expect(wall.damage.length).toBe(0);
    const open = fight({ x: 0, z: 0, height: 1.8, hidden: false }, []);
    for (let i = 0; i < 200; i++) open.g.shot(MUZZLE);
    expect(open.damage.every((d) => d > 0)).toBe(true);
  });

  it('shots far wide miss: spread grows with range', () => {
    const near = fight({ x: 0, z: 0, height: 1.8, hidden: false }, []);
    const far = fight({ x: 0, z: 0, height: 1.8, hidden: false }, []);
    for (let i = 0; i < 400; i++) {
      near.g.shot({ x: 3, y: 1.45, z: 0 });
      far.g.shot({ x: 30, y: 1.45, z: 0 });
    }
    expect(near.damage.length).toBeGreaterThan(far.damage.length);
  });
});

describe('GunFight: grenades and hiding', () => {
  it('a grenade lands where it was thrown and goes off after its fuse, hurting you and driving you out', () => {
    const { g, damage, blasts } = fight({ x: 0, z: 0, height: 1.0, hidden: true }, []);
    g.grenade({ x: 12, y: 1.5, z: 0 }, { x: 0, y: 0, z: 0 });
    for (let t = 0; t < GRENADE.fuse - 0.1; t += 1 / 60) g.update(1 / 60);
    expect(damage.length).toBe(0);
    for (let t = 0; t < 0.3; t += 1 / 60) g.update(1 / 60);
    expect(damage.length).toBe(1);
    expect(damage[0]).toBeGreaterThan(20);
    expect(blasts.length).toBe(1);
  });

  it('a crate between you and the blast takes half off; far enough away it does nothing', () => {
    const open = fight({ x: 0, z: 0, height: 1.0, hidden: true }, []);
    open.g.grenade({ x: 12, y: 1.5, z: 0 }, { x: 1.2, y: 0, z: 0 });
    const covered = fight({ x: 0, z: 0, height: 1.0, hidden: true }, [CRATE]);
    covered.g.grenade({ x: 12, y: 1.5, z: 0 }, { x: 1.9, y: 0, z: 0 });
    const away = fight({ x: 0, z: 0, height: 1.0, hidden: true }, []);
    away.g.grenade({ x: 12, y: 1.5, z: 0 }, { x: 9, y: 0, z: 0 });
    for (const f of [open, covered, away]) for (let t = 0; t < GRENADE.fuse + 0.5; t += 1 / 60) f.g.update(1 / 60);
    expect(away.damage.length).toBe(0);
    expect(open.damage[0]).toBeGreaterThan(covered.damage[0] * 1.2);
  });

  it('counts how long you have been hiding, and starts over when you show yourself', () => {
    let hidden = true;
    const g = new GunFight(new THREE.Scene());
    g.player = () => ({ x: 0, z: 0, height: 1.0, hidden });
    for (let t = 0; t < 3; t += 0.1) g.update(0.1);
    expect(g.hidden).toBeCloseTo(3, 0);
    hidden = false;
    g.update(0.1);
    expect(g.hidden).toBe(0);
  });
});
