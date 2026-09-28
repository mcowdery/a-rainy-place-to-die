import { describe, expect, it } from 'vitest';
import { loadCourses } from '../src/race/courses';
import { clock, GhostTrack, medalFor, Trial, trialPlan } from '../src/race/trial';

const { courses } = loadCourses();

describe('time trials', () => {
  for (const [name, c] of courses) {
    it(`${name}: plans a run each way with checkpoints in order`, () => {
      const up = trialPlan(c, 'up');
      expect(up.grid).toBeLessThan(up.checkpoints[0]);
      expect(up.checkpoints[2]).toBeLessThan(up.finish);
      expect(up.finish).toBe(c.summitStart);
      const down = trialPlan(c, 'down');
      expect(down.grid).toBeGreaterThan(down.checkpoints[0]);
      expect(down.checkpoints[2]).toBeGreaterThan(down.finish);
      // The downhill finish is on the road just before the lot; the uphill grid just out of it.
      expect(c.inLot(c.x[down.finish], c.z[down.finish])).toBe(false);
      expect(c.inLot(c.x[up.grid], c.z[up.grid])).toBe(false);
    });
  }

  it('counts down, then times a run through every checkpoint to the finish', () => {
    const c = courses.get('kurokami')!;
    const plan = trialPlan(c, 'up');
    const t = new Trial(plan);
    const events: string[] = [];
    const log = (e: ReturnType<Trial['update']>): void => e.forEach((x) => events.push(x.kind));
    // Held during the countdown: moving does nothing.
    for (let k = 0; k < 170; k++) log(t.update(1 / 60, plan.grid + 200));
    expect(t.phase).toBe('countdown');
    for (let k = 0; k < 20; k++) log(t.update(1 / 60, plan.grid));
    expect(t.phase).toBe('running');
    // Drive up the road a sample every 1/60 s (60 m/s, for a quick test).
    for (let i = plan.grid; i <= plan.finish + 2 && t.phase === 'running'; i++) log(t.update(1 / 60, i));
    expect(events).toEqual(['go', 'split', 'split', 'split', 'finish']);
    expect(t.splits).toHaveLength(3);
    // The clock ran from GO (a few frames before the drive began) to the finish.
    expect(t.t).toBeGreaterThanOrEqual((plan.finish - plan.grid) / 60);
    expect(t.t).toBeLessThan((plan.finish - plan.grid) / 60 + 0.3);
  });

  it('does not count the finish without the checkpoints (a jump along the road)', () => {
    const c = courses.get('kurokami')!;
    const plan = trialPlan(c, 'up');
    const t = new Trial(plan);
    t.update(3.1, plan.grid);
    t.update(0.1, plan.finish + 1);
    expect(t.phase).toBe('running');
    expect(t.splits).toHaveLength(0);
  });

  it('awards medals and formats times', () => {
    expect(medalFor(50, [70, 60, 55])).toBe('gold');
    expect(medalFor(58, [70, 60, 55])).toBe('silver');
    expect(medalFor(65, [70, 60, 55])).toBe('bronze');
    expect(medalFor(71, [70, 60, 55])).toBe(null);
    expect(clock(63.456)).toBe('1:03.46');
  });

  it('records a ghost and plays it back between samples', () => {
    const g = new GhostTrack();
    for (let t = 0; t <= 2; t += 1 / 120) g.record(t, t * 10, 0, 0, t);
    expect(g.duration).toBeGreaterThan(1.9);
    // Sampled on the first frame past each 1/20 s: within a frame of the true place.
    expect(Math.abs(g.at(1.025)!.x - 10.25)).toBeLessThan(0.15);
    expect(g.at(5)).toBe(null);
    const again = new GhostTrack([...g.data]);
    expect(again.at(0.5)!.h).toBeCloseTo(0.5, 2);
  });
});
