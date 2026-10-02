import { describe, expect, it } from 'vitest';
import { blendAt, clockAt, clockLabel, DAY, DAYLIGHT, keyframes, lateAt, LIGHT_LOOKS, moonAt, phaseAt, sleepUntil, starsAt, START_MINUTE, sunAt, sunDirAt, SYNODIC, totalOf, untilMinute } from '../src/poc3d/district/clock';

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
    // By the season's daylight: a winter evening at half five is dusk and dark by six; a summer one still day at six.
    expect(phaseAt(17 * 60 + 30, DAYLIGHT.winter)).toBe('dusk');
    expect(phaseAt(18 * 60, DAYLIGHT.winter)).toBe('night');
    expect(phaseAt(18 * 60, DAYLIGHT.summer)).toBe('day');
    expect(phaseAt(19 * 60 + 30, DAYLIGHT.summer)).toBe('dusk');
    expect(phaseAt(4 * 60 + 30, DAYLIGHT.summer)).toBe('dawn');
    expect(phaseAt(6 * 60 + 30, DAYLIGHT.winter)).toBe('dawn');
    // Along the day the blend never jumps: each minute's mix of looks is next to the last one's.
    for (const dl of Object.values(DAYLIGHT)) {
      const weight = (m: number): Record<string, number> => {
        const b = blendAt(m, dl);
        const w: Record<string, number> = Object.fromEntries(LIGHT_LOOKS.map((l) => [l, 0]));
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

  it('runs the moon on the lunar calendar: full on the first night, waning, new, waxing, full again', () => {
    const first = moonAt(START_MINUTE);
    expect(first.lit).toBeCloseTo(1, 3);
    // The full moon is high at midnight and down at noon.
    expect(moonAt(DAY).dir[1]).toBeGreaterThan(0.6);
    expect(moonAt(DAY + 12 * 60).up).toBe(0);
    // A week on, a last quarter: half lit, lit from the left (waning), rising about midnight and up at dawn.
    const week = START_MINUTE + Math.round((SYNODIC / 4) * DAY);
    expect(moonAt(week).lit).toBeCloseTo(0.5, 1);
    expect(moonAt(week).phase).toBeLessThan(0);
    const lastQ = (Math.floor(week / DAY) + 1) * DAY;
    expect(moonAt(lastQ + 6 * 60).up).toBe(1);
    expect(moonAt(lastQ + 20 * 60).up).toBe(0);
    // A new moon two weeks on: dark, and down all night.
    const nu = START_MINUTE + Math.round((SYNODIC / 2) * DAY);
    expect(moonAt(nu).lit).toBeLessThan(0.01);
    for (const h of [21, 23, 25, 27]) expect(moonAt(Math.floor(nu / DAY) * DAY + h * 60).light).toBeLessThan(0.01);
    // Rising about 50 minutes later each day.
    const rise = (day: number): number => {
      for (let m = 0; m < DAY; m++) if (moonAt(day * DAY + m).up > 0 && moonAt(day * DAY + m - 1).up === 0) return m;
      return -1;
    };
    const late = (((rise(3) - rise(2)) % DAY) + DAY) % DAY;
    expect(late).toBeGreaterThan(40);
    expect(late).toBeLessThan(60);
    // Full again a month on.
    expect(moonAt(START_MINUTE + Math.round(SYNODIC * DAY)).lit).toBeCloseTo(1, 3);
  });

  it('lights the night from the moon where it is, never from below the horizon', () => {
    const m = moonAt(DAY + 30);
    const d = sunDirAt(30, m.dir);
    expect(d[0]).toBeCloseTo(m.dir[0] / Math.hypot(...m.dir), 1);
    expect(sunDirAt(3 * 60, moonAt(DAY / 2 + 15 * DAY).dir)[1]).toBeGreaterThan(0.15);
  });

  it("follows the season's day: the light keyed to sunrise and sunset, winter evenings dark early, summer's light late", () => {
    for (const dl of Object.values(DAYLIGHT)) {
      const k = keyframes(dl);
      for (let i = 1; i < k.length; i++) expect(k[i][0]).toBeGreaterThan(k[i - 1][0]);
      // The sun is on the horizon at sunrise and sunset, highest about midday, down at midnight.
      expect(Math.abs(sunAt(dl.rise, dl).dir[1])).toBeLessThan(0.01);
      expect(Math.abs(sunAt(dl.set, dl).dir[1])).toBeLessThan(0.01);
      expect(sunAt((dl.rise + dl.set) / 2, dl).dir[1]).toBeCloseTo(Math.sin(dl.noon), 3);
      expect(sunAt(0, dl).up).toBe(0);
    }
    const looks = (m: number, dl = DAYLIGHT.winter): string[] => [blendAt(m, dl).a, blendAt(m, dl).b];
    expect(looks(17 * 60 + 45)).toContain('night');
    expect(looks(17 * 60 + 45, DAYLIGHT.summer)).toContain('golden');
    expect(looks(18 * 60 + 30, DAYLIGHT.summer)).toContain('dusk');
    // Winter's noon sun is low, summer's high.
    expect(sunAt(12 * 60, DAYLIGHT.winter).dir[1]).toBeLessThan(0.6);
    expect(sunAt(12 * 60, DAYLIGHT.summer).dir[1]).toBeGreaterThan(0.9);
  });

  it('brings the stars out through the twilight, not all at once', () => {
    const dl = DAYLIGHT.spring;
    expect(starsAt(12 * 60, dl)).toBe(0);
    expect(starsAt(0, dl)).toBe(1);
    let prev = starsAt(dl.set, dl);
    let between = 0;
    for (let m = dl.set + 1; m < dl.set + 180; m++) {
      const v = starsAt(m, dl);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v - prev).toBeLessThan(0.05);
      if (v > 0.05 && v < 0.95) between++;
      prev = v;
    }
    expect(between).toBeGreaterThan(20);
  });
});
