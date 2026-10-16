import { describe, expect, it } from 'vitest';
import { GATE, StreetRaceState, parseStreetRaces } from '../src/poc3d/district/streetRace';

const gates = [
  { x: 100, z: 0 },
  { x: 200, z: 0 },
  { x: 300, z: 0 },
];
const names = ['You', 'A', 'B', 'C', 'D', 'E'];
const at = (xs: number[]): { x: number; z: number }[] => xs.map((x) => ({ x, z: 0 }));
const fresh = (): StreetRaceState => {
  const s = new StreetRaceState(gates, names, { x: 0, z: 0 });
  s.update(3.1, at([0, 0, 0, 0, 0, 0]));
  return s;
};

describe('StreetRaceState', () => {
  it('counts down, then runs', () => {
    const s = new StreetRaceState(gates, names, { x: 0, z: 0 });
    expect(s.phase).toBe('countdown');
    s.update(3.1, at([0, 0, 0, 0, 0, 0]));
    expect(s.phase).toBe('running');
  });

  it('counts gates only in order and from close by', () => {
    const s = fresh();
    // racer 1 is at the second gate: it isn't its next
    s.update(0.1, at([0, 200, 0, 0, 0, 0]));
    expect(s.passed[1]).toBe(0);
    s.update(0.1, at([0, 100, 0, 0, 0, 0]));
    expect(s.passed[1]).toBe(1);
    // and the first isn't counted twice
    s.update(0.1, at([0, 100 + GATE * 2, 0, 0, 0, 0]));
    expect(s.passed[1]).toBe(1);
  });

  it('places by gates then nearness, the retired last', () => {
    const s = fresh();
    s.update(0.1, at([90, 100, 40, 0, 0, 0]));
    // A passed gate 0; You are 10 m from it, B 60 m.
    expect(s.standings().slice(0, 3).map((x) => x.who)).toEqual([1, 0, 2]);
    s.retire(1, 'WRECKED');
    expect(s.standings().at(-1)!.who).toBe(1);
  });

  it('finishes in order and ends when you finish', () => {
    const s = fresh();
    for (const x of [100, 200, 300]) s.update(0.1, at([0, x, 0, 0, 0, 0]));
    expect(s.finishPlace[1]).toBe(1);
    expect(s.phase).toBe('running');
    for (const x of [100, 200, 300]) s.update(0.1, at([x, 300, 0, 0, 0, 0]));
    expect(s.finishPlace[0]).toBe(2);
    expect(s.phase).toBe('over');
    expect(s.placeOf(0)).toBe(2);
  });

  it('measures progress along the gates', () => {
    const s = fresh();
    s.update(0.1, at([50, 80, 0, 0, 0, 0]));
    expect(s.progress(0)).toBeCloseTo(50, 0);
    expect(s.progress(1)).toBeCloseTo(80, 0);
  });
});

describe('parseStreetRaces', () => {
  const field = (n: number): string => Array.from({ length: n }, (_, i) => `      - { name: R${i}, type: sports, paint: '#112233' }`).join('\n');
  it('reads a race and wants six cars', () => {
    const errors: string[] = [];
    const ok = parseStreetRaces('f', `races:\n  - id: a\n    name: A\n    points: [[1, 1], [2, 1], [3, 1]]\n    pay: [10, 5]\n    field:\n${field(5)}\n`, errors);
    expect(errors).toEqual([]);
    expect(ok[0].field).toHaveLength(5);
    const e2: string[] = [];
    parseStreetRaces('f', `races:\n  - id: a\n    name: A\n    points: [[1, 1], [2, 1], [3, 1]]\n    pay: [10]\n    field:\n${field(3)}\n`, e2);
    expect(e2.join()).toContain('at least five rivals');
  });
});
