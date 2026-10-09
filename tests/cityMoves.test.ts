import { describe, expect, it } from 'vitest';
import { CityMoves, type MoveState } from '../src/poc3d/models/cityMoves';

const LENGTHS: Record<string, number> = { Walk_35_Loop: 1.13, Pistol_Idle_Loop: 1.7, Pistol_Aim_Neutral: 0.2, Pistol_Shoot: 0.6, Pistol_Reload: 1.7 };
const moves = (): CityMoves => new CityMoves((n) => LENGTHS[n] ?? 0);
const DT = 1 / 60;
const state = (o: Partial<MoveState> = {}): MoveState => ({ dt: DT, gait: 0, air: 0, ...o });
/** Runs `seconds` of a state and gives back the names that played at any time, and what's playing at the end. */
function run(m: CityMoves, seconds: number, o: Partial<MoveState> = {}): { seen: Set<string>; last: readonly { name: string; weight: number; time: number }[] } {
  const seen = new Set<string>();
  let last: readonly { name: string; weight: number; time: number }[] = [];
  for (let t = 0; t < seconds; t += DT) {
    last = m.update(state(o)).map((l) => ({ ...l }));
    for (const l of last) seen.add(l.name);
  }
  return { seen, last };
}
const names = (l: readonly { name: string }[]): string[] => l.map((x) => x.name);

describe("what of the library is Mack's own on foot", () => {
  it('standing about, jumping, breaking into a run, running and stopping play nothing of it: they are his own', () => {
    const m = moves();
    expect(run(m, 60).seen.size).toBe(0);
    expect(run(m, 1, { air: 0.5 }).seen.size).toBe(0);
    for (const gait of [1.5, 4.2, 0]) expect(run(m, 2, { gait }).seen.size).toBe(0);
    expect(run(m, 1, { gait: 4.2, stride: { at: 0.5, k: 1, run: 1 } }).seen.size).toBe(0);
  });

  it('walking is the captured walk, in step with the stride he is given, and it leaves his eyes where they are', () => {
    const l = moves().update(state({ gait: 1.5, stride: { at: 0.25, k: 1, run: 0 } }));
    expect(names(l)).toEqual(['Walk_35_Loop']);
    expect(l[0].time).toBeCloseTo(0.25 * 1.13, 5);
    expect(l[0].steady).toBe(true);
  });

  it('the walk gives way to his own run as he speeds up, and comes in with the stride as he sets off', () => {
    const w = (o: Partial<MoveState>) => moves().update(state(o)).map((l) => `${l.name} ${l.weight.toFixed(2)}`);
    expect(w({ gait: 3, stride: { at: 0.5, k: 1, run: 0.5 } })).toEqual(['Walk_35_Loop 0.50']);
    expect(w({ gait: 0.5, stride: { at: 0.5, k: 0.3, run: 0 } })).toEqual(['Walk_35_Loop 0.30']);
  });

  it("a clip the library hasn't got is never played", () => {
    const m = new CityMoves(() => 0);
    expect(m.update(state({ gait: 1.5, stride: { at: 0, k: 1, run: 0 }, gun: { out: 1, aim: 1, shots: 0, reload: -1 } }))).toEqual([]);
  });
});

describe('the pistol', () => {
  const gun = (o: Partial<NonNullable<MoveState['gun']>> = {}): NonNullable<MoveState['gun']> => ({ out: 1, aim: 0, shots: 0, reload: -1, ...o });

  it('standing with it out he is in its ready stance, and its aim by how far the gun is raised', () => {
    const m = moves();
    expect(names(run(m, 0.5, { gun: gun() }).last)).toEqual(['Pistol_Idle_Loop']);
    expect(m.gunWeight).toBe(1);
    const aimed = run(m, 0.1, { gun: gun({ aim: 0.5 }) }).last;
    expect(names(aimed)).toEqual(['Pistol_Idle_Loop', 'Pistol_Aim_Neutral']);
    expect(aimed[1].weight).toBeCloseTo(0.5, 5);
  });

  it('walking with it he moves as he is keyed, and the stance comes back when he stops', () => {
    const m = moves();
    run(m, 0.5, { gun: gun() });
    expect(run(m, 0.5, { gait: 1.5, gun: gun() }).last).toEqual([]);
    expect(names(run(m, 0.5, { gun: gun() }).last)).toEqual(['Pistol_Idle_Loop']);
  });

  it('a shot jolts him once, and a reload follows the reload itself', () => {
    const m = moves();
    run(m, 0.5, { gun: gun({ aim: 1 }) });
    expect(names(run(m, 0.1, { gun: gun({ aim: 1, shots: 1 }) }).last)).toContain('Pistol_Shoot');
    expect(names(run(m, 1, { gun: gun({ aim: 1, shots: 1 }) }).last)).not.toContain('Pistol_Shoot');
    const half = run(m, 0.05, { gun: gun({ shots: 1, reload: 0.5 }) }).last.find((l) => l.name === 'Pistol_Reload');
    expect(half?.time).toBeCloseTo(0.85, 5);
    expect(half?.weight).toBe(1);
  });

  it('it comes in with the draw, lets go in the air, and the shotgun has none of it', () => {
    const m = moves();
    expect(run(m, 0.5, { gun: gun({ out: 0.4 }) }).last[0].weight).toBeCloseTo(0.4, 5);
    expect(run(m, 0.4, { air: 0.4, gun: gun() }).last).toEqual([]);
    expect(run(moves(), 1, { gun: null }).last).toEqual([]);
  });
});
