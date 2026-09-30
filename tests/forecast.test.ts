import { describe, expect, it } from 'vitest';
import { BLOCK, forecastAt, ODDS, outlookAt, TSUYU_DAYS } from '../src/poc3d/district/forecast';
import { SEASONS } from '../src/poc3d/district/seasons';

const DAY = 24 * 60;
// Well into the season (past summer's rainy season).
const LATE = -30 * DAY;

describe('forecast', () => {
  /** The share of time it's raining (spells and showers), sampled every 10 minutes over many days. */
  const wet = (season: (typeof SEASONS)[number], start = LATE): number => {
    let n = 0;
    let all = 0;
    for (let t = 0; t < 600 * DAY; t += 10) {
      all++;
      if (forecastAt(t, season, start) === 'rain') n++;
    }
    return n / all;
  };

  it('has spells of rain about as often as the season says, and spring the wettest', () => {
    for (const s of ['spring', 'autumn', 'winter'] as const) {
      let n = 0;
      const N = 4000;
      for (let i = 0; i < N; i++) {
        const o = outlookAt(i * DAY + 12 * 60 + 5, s, LATE);
        if (o.weather === 'rain' && !o.shower) n++;
      }
      expect(Math.abs(n / N - ODDS[s].rain)).toBeLessThan(0.03);
    }
    expect(wet('spring')).toBeGreaterThan(wet('summer'));
    expect(wet('spring')).toBeGreaterThan(wet('autumn'));
  });

  it('has short showers, most in spring, each 20 to 60 minutes of rain in a dry spell', () => {
    const showers = (season: (typeof SEASONS)[number]): number[] => {
      const lens: number[] = [];
      let run = 0;
      for (let t = 0; t < 400 * DAY; t++) {
        const o = outlookAt(t, season, LATE);
        if (o.shower) run++;
        else if (run) {
          lens.push(run);
          run = 0;
        }
      }
      return lens;
    };
    const spring = showers('spring');
    expect(spring.length).toBeGreaterThan(showers('autumn').length);
    for (const l of spring) {
      expect(l).toBeGreaterThanOrEqual(19);
      expect(l).toBeLessThanOrEqual(61);
    }
  });

  it('opens summer with the rainy season, then heat waves', () => {
    // The first days of summer (the season began a day or two before).
    let rain = 0;
    let all = 0;
    for (let b = 0; b < 2000; b++) {
      const t = b * BLOCK * 7 + 12 * 60 + 5;
      const o = outlookAt(t, 'summer', t - ((b % TSUYU_DAYS) + 0.5) * DAY);
      expect(o.tsuyu).toBe(true);
      all++;
      if (o.weather === 'rain' && !o.shower) rain++;
    }
    expect(rain / all).toBeGreaterThan(0.5);
    expect(outlookAt(10 * DAY, 'summer', 0).tsuyu).toBe(false);
    // Later: about half the days a heat wave, hot in the afternoon.
    let heat = 0;
    for (let d = 0; d < 900; d++) {
      const o = outlookAt(d * DAY + 14 * 60, 'summer', LATE);
      if (o.heat) {
        heat++;
        expect(o.weather === 'clear' ? o.temp : 30).toBeGreaterThan(25);
      }
    }
    expect(heat / 900).toBeGreaterThan(0.35);
    expect(heat / 900).toBeLessThan(0.65);
    expect(wet('summer', 0)).toBeGreaterThan(0);
  });

  it('snows only in winter, fogs only in the morning, and is the same every time', () => {
    for (const s of ['spring', 'summer', 'autumn'] as const) {
      for (let t = 0; t < 200 * DAY; t += 30) expect(forecastAt(t, s, LATE)).not.toBe('snow');
    }
    expect(wet('winter')).toBeLessThan(wet('spring'));
    let fog = 0;
    for (let d = 0; d < 400; d++) {
      expect(forecastAt(d * DAY + 14 * 60, 'autumn', LATE)).not.toBe('fog');
      if (forecastAt(d * DAY + 6 * 60, 'autumn', LATE) === 'fog') fog++;
    }
    expect(fog).toBeGreaterThan(20);
    expect(outlookAt(12345, 'spring')).toEqual(outlookAt(12345, 'spring'));
  });
});
