import { describe, expect, it } from 'vitest';
import { HOURS, hoursOf, hoursPhase, openHours, withHours } from '../src/poc3d/real/hours';
import { TRADE } from '../src/poc3d/real/shops';

describe('shops’ hours', () => {
  it('open and shut each class at its times, give or take 45 minutes', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(openHours(HOURS.always, seed, 3)).toBe(true);
      expect(openHours(HOURS.night, seed, 18)).toBe(true);
      expect(openHours(HOURS.night, seed, 2)).toBe(true);
      expect(openHours(HOURS.night, seed, 12)).toBe(false);
      expect(openHours(HOURS.late, seed, 23)).toBe(true);
      expect(openHours(HOURS.late, seed, 1)).toBe(false);
      expect(openHours(HOURS.shops, seed, 21)).toBe(true);
      expect(openHours(HOURS.shops, seed, 23)).toBe(false);
      expect(openHours(HOURS.office, seed, 12)).toBe(true);
      expect(openHours(HOURS.office, seed, 20)).toBe(false);
    }
  });

  it('shut a street a place at a time: not all at once', () => {
    const shut = [...Array(100).keys()].filter((seed) => !openHours(HOURS.shops, seed, 22)).length;
    expect(shut).toBeGreaterThan(20);
    expect(shut).toBeLessThan(80);
  });

  it('change what the lightmap shows at an opening, through a closing, and not in the dead of the day', () => {
    expect(hoursPhase(16.9)).not.toBe(hoursPhase(17.1));
    expect(hoursPhase(21.6)).not.toBe(hoursPhase(22.1));
    expect(hoursPhase(13.0)).toBe(hoursPhase(13.2));
  });

  it('put the class in a sign id and give the trades theirs', () => {
    expect(Math.floor(withHours(123456, HOURS.office) / 100000)).toBe(HOURS.office);
    expect(hoursOf(TRADE.snack)).toBe(HOURS.night);
    expect(hoursOf(TRADE.konbini)).toBe(HOURS.always);
    expect(hoursOf(TRADE.bank)).toBe(HOURS.office);
  });
});
