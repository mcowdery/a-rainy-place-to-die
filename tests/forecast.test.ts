import { describe, expect, it } from 'vitest';
import { airWith, BLOCK, coldBreath, forecastAt, ODDS, outlookAt, TSUYU_DAYS, TYPHOON_HOURS } from '../src/poc3d/district/forecast';
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

  it('brings typhoons in late summer and early autumn: they build, blow and pass, then clear', () => {
    const count = (season: (typeof SEASONS)[number], start: number): number => {
      let n = 0;
      let was = false;
      for (let t = 0; t < 400 * DAY; t += 60) {
        const on = outlookAt(t, season, start).typhoon > 0;
        if (on && !was) n++;
        was = on;
      }
      return n;
    };
    expect(count('summer', LATE)).toBeGreaterThan(5);
    expect(count('spring', LATE)).toBe(0);
    expect(count('winter', LATE)).toBe(0);
    // Past its first weeks, autumn has none.
    expect(count('autumn', LATE)).toBe(0);
    // One forced at a minute: the wind rises to a storm with a downpour, turns, and after it the sky clears.
    const at = 1000 * DAY;
    const o = (h: number) => outlookAt(at + h * 60, 'spring', 0, { typhoonAt: at });
    expect(o(1).wind).toBeLessThan(0.4);
    const peak = o(TYPHOON_HOURS * 0.55);
    expect(peak.typhoon).toBeGreaterThan(0.9);
    expect(peak.wind).toBeGreaterThan(1);
    expect(peak.weather).toBe('rain');
    expect(peak.amount).toBeGreaterThan(0.9);
    expect(o(2).turn).toBeLessThan(o(TYPHOON_HOURS - 2).turn);
    const after = o(TYPHOON_HOURS + 3);
    expect(after.after).toBe(true);
    expect(after.weather).toBe('clear');
    expect(o(TYPHOON_HOURS * 2).typhoon).toBe(0);
  });

  it("shows people's breath only in the cold: never at 10 °C, on winter nights, whenever it snows", () => {
    expect(coldBreath(10)).toBe(0);
    expect(coldBreath(7)).toBe(0);
    expect(coldBreath(4.5)).toBeCloseTo(0.5, 5);
    expect(coldBreath(2)).toBe(1);
    expect(coldBreath(-3)).toBe(1);
    // Summer and autumn: none at any hour. Spring: none in the dry, and none from morning to mid-evening even in
    // the rain (a wet spring night can dip under 7 °C toward dawn, and a little shows then).
    for (const s of ['summer', 'autumn'] as const) {
      for (let t = 0; t < 200 * DAY; t += 30) expect(coldBreath(outlookAt(t, s, LATE).temp)).toBe(0);
    }
    for (let t = 0; t < 200 * DAY; t += 30) {
      const o = outlookAt(t, 'spring', LATE);
      if (o.weather === 'clear') expect(coldBreath(o.temp)).toBe(0);
      const h = (t % DAY) / 60;
      if (h >= 9 && h <= 21) expect(coldBreath(o.temp)).toBe(0);
    }
    // Winter: before dawn always some, mid-afternoon in the dry none.
    let nights = 0;
    for (let d = 0; d < 200; d++) {
      if (coldBreath(outlookAt(d * DAY + 5 * 60, 'winter', LATE).temp) > 0.5) nights++;
      const noon = outlookAt(d * DAY + 14 * 60, 'winter', LATE);
      if (noon.weather === 'clear') expect(coldBreath(noon.temp)).toBe(0);
    }
    expect(nights).toBe(200);
    // Snow, the forecast's or set by hand over a milder spell, is freezing.
    const mild = outlookAt(14 * 60, 'winter', LATE);
    expect(coldBreath(airWith({ ...mild, weather: 'clear', temp: 9 }, 'snow'))).toBe(1);
    expect(airWith({ ...mild, temp: 9 }, 'clear')).toBe(9);
  });

  it('keeps a heat wave going when told to', () => {
    const t = 5000 * DAY + 14 * 60;
    expect(outlookAt(t, 'summer', LATE, { heatUntil: t + DAY }).heat).toBe(true);
  });

  it('keeps the weather settled when told to: no heat wave or typhoon of its own, a forced one still comes', () => {
    for (let d = 0; d < 60; d++) {
      const t = (5000 + d) * DAY + 14 * 60;
      const o = outlookAt(t, 'summer', LATE, { settledUntil: t + 1 });
      expect(o.heat).toBe(false);
      expect(o.typhoon).toBe(0);
    }
    const t = 5000 * DAY + 14 * 60;
    expect(outlookAt(t, 'summer', LATE, { settledUntil: t + DAY, heatUntil: t + DAY }).heat).toBe(true);
    expect(outlookAt(t, 'summer', LATE, { settledUntil: t + DAY, typhoonAt: t - 60 }).typhoon).toBeGreaterThan(0);
  });
});
