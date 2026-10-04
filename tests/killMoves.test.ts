import { describe, expect, it } from 'vitest';
import { KILL_MOVES, pickKill, type KillQuery } from '../src/poc3d/models/killMoves';

const q = (o: Partial<KillQuery>): KillQuery => ({ weapon: 'fists', floored: false, wall: false, dist: 1, facing: true, ...o });
const all = (query: KillQuery): string[] => KILL_MOVES.filter((k) => k.ok(query)).map((k) => k.id).sort();

describe('kill moves', () => {
  it('fit the weapon and the moment', () => {
    expect(all(q({ weapon: 'katana' }))).toEqual(['decapitate', 'run_through']);
    expect(all(q({ weapon: 'fists' }))).toEqual(['neck_snap']);
    expect(all(q({ weapon: 'fists', wall: true }))).toEqual(['neck_snap', 'wall_slam']);
    expect(all(q({ weapon: 'fists', floored: true }))).toEqual(['stomp']);
    expect(all(q({ weapon: 'shotgun' }))).toEqual(['shotgun_jaw']);
    expect(all(q({ weapon: 'shotgun', facing: false }))).toEqual([]);
    expect(all(q({ weapon: 'katana', dist: 3 }))).toEqual([]);
  });

  it("don't play the same one twice running when another fits", () => {
    for (let i = 0; i < 20; i++) expect(pickKill(q({ weapon: 'katana' }), 'decapitate')?.id).toBe('run_through');
    expect(pickKill(q({ weapon: 'fists' }), 'neck_snap')?.id).toBe('neck_snap');
  });

  it('pick by weight', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(pickKill(q({ weapon: 'katana' }), null, () => i / 40)!.id);
    expect([...seen].sort()).toEqual(['decapitate', 'run_through']);
  });

  it('every move releases its victim inside its time and fires its events in order', () => {
    for (const k of KILL_MOVES) {
      expect(k.release).toBeGreaterThan(0);
      expect(k.release).toBeLessThanOrEqual(1);
      for (let i = 1; i < k.events.length; i++) expect(k.events[i].t).toBeGreaterThanOrEqual(k.events[i - 1].t);
      expect(k.time).toBeGreaterThan(0.5);
      expect(k.time).toBeLessThan(2);
    }
  });
});

describe('duels', () => {
  it("say which side of the one it's aimed at each blow comes", async () => {
    const { sideOf } = await import('../src/poc3d/models/thug');
    // A right-to-left cut (yours or his) comes at the other's left; a downward cut high; a thrust straight in.
    expect(sideOf('slashR')).toBe('left');
    expect(sideOf('hookR')).toBe('left');
    expect(sideOf('slashL')).toBe('right');
    expect(sideOf('hook')).toBe('right');
    expect(sideOf('overhead')).toBe('high');
    expect(sideOf('thrust')).toBe('center');
    expect(sideOf('jab')).toBe('center');
  });
});
