import { describe, expect, it } from 'vitest';
import { blendAt, clockAt, clockLabel, DAY, lateAt, phaseAt, sleepUntil, START_MINUTE, sunDirAt, totalOf, untilMinute } from '../src/poc3d/district/clock';

describe('the clock', () => {
  it("counts days and minutes from the story's start, a Friday night", () => {
    expect(clockAt(START_MINUTE)).toEqual({ day: 1, minute: 22 * 60 });
    expect(clockAt(DAY + 90)).toEqual({ day: 2, minute: 90 });
    expect(totalOf({ day: 3, minute: 600 })).toBe(2 * DAY + 600);
    expect(clockLabel(clockAt(START_MINUTE))).toBe('Day 1 · 金 22:00');
    expect(clockLabel(clockAt(DAY * 2 + 7 * 60))).toBe('Day 3 · 日 07:00');
  });

  it('names the time of day for the story, and blends the light between the looks without a jump', () => {
    expect(phaseAt(3 * 60)).toBe('night');
    expect(phaseAt(5 * 60 + 30)).toBe('dawn');
    expect(phaseAt(12 * 60)).toBe('day');
    expect(phaseAt(18 * 60)).toBe('dusk');
    expect(phaseAt(22 * 60)).toBe('night');
    // Along the day the blend never jumps: each minute's mix of looks is next to the last one's.
    const weight = (m: number): Record<string, number> => {
      const b = blendAt(m);
      const w: Record<string, number> = { dawn: 0, day: 0, dusk: 0, night: 0 };
      w[b.a] += 1 - b.f;
      w[b.b] += b.f;
      return w;
    };
    let prev = weight(0);
    for (let m = 1; m <= DAY; m++) {
      const w = weight(m % DAY);
      for (const k of Object.keys(w)) expect(Math.abs(w[k] - prev[k]), `${k} at ${m}`).toBeLessThan(0.06);
      prev = w;
    }
  });

  it('waits forward to a time, sleeps to the morning, and knows the last train', () => {
    expect(untilMinute(22 * 60, 23 * 60)).toBe(60);
    expect(untilMinute(22 * 60, 7 * 60)).toBe(9 * 60);
    expect(untilMinute(7 * 60, 7 * 60)).toBe(DAY);
    expect(sleepUntil(DAY + 23 * 60)).toBe(8 * 60);
    expect(sleepUntil(DAY + 2 * 60)).toBe(5 * 60);
    expect(lateAt(30)).toBe(false);
    expect(lateAt(60)).toBe(true);
    expect(lateAt(5 * 60)).toBe(false);
  });

  it('moves the sun from east to west through the day, the moon by night', () => {
    const at = (h: number) => sunDirAt(h * 60);
    expect(at(7)[0]).toBeGreaterThan(0.5);
    expect(at(12)[1]).toBeGreaterThan(0.8);
    expect(at(17)[0]).toBeLessThan(-0.5);
    expect(at(23)[2]).toBeLessThan(0);
    for (let m = 0; m < DAY; m += 5) {
      const a = sunDirAt(m);
      const b = sunDirAt(m + 5);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), `at ${m}`).toBeLessThan(0.16);
    }
  });
});
