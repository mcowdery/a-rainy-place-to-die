import { describe, expect, it } from 'vitest';
import { HOURS, isOut, nightLife, outAt, RAIN, seasonsOf, span, whenOf } from '../src/poc3d/district/peopleHours';
import { OUTFITS } from '../src/poc3d/district/peopleMix';
import { FIGURE_STRIDE, packFigures, type FigureSpec } from '../src/poc3d/real/people';

describe('when people are out', () => {
  it('spans hours, wrapping past midnight', () => {
    expect(span(12, 9, 18, 1)).toBeCloseTo(1);
    expect(span(8, 9, 18, 1)).toBe(0);
    expect(span(23, 21, 4, 1)).toBeCloseTo(1);
    expect(span(2, 21, 4, 1)).toBeCloseTo(1);
    expect(span(12, 21, 4, 1)).toBe(0);
  });

  it('keeps every share between 0 and 1 all day', () => {
    for (const hours of HOURS) {
      for (let h = 0; h < 24; h += 0.25) {
        const o = outAt(hours, h);
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fills the streets by day and thins them at night, but not where the night is alive', () => {
    expect(outAt('always', 13)).toBeGreaterThan(0.9);
    expect(outAt('always', 3.5)).toBeLessThan(0.45);
    // Schoolchildren at the school run, none at midnight.
    expect(outAt('school', 8)).toBeGreaterThan(0.9);
    expect(outAt('school', 0)).toBe(0);
    expect(outAt('day', 2)).toBeLessThan(0.1);
    // Office workers at the rush hours more than mid-morning.
    expect(outAt('commute', 8.5)).toBeGreaterThan(outAt('commute', 10.8));
    expect(outAt('commute', 18.5)).toBeGreaterThan(outAt('commute', 15));
    // The nightlife and the shady ones after dark.
    expect(outAt('evening', 22)).toBeGreaterThan(0.9);
    expect(outAt('evening', 12)).toBeLessThan(0.4);
    expect(outAt('late', 1)).toBeGreaterThan(0.9);
    expect(outAt('late', 13)).toBeLessThan(0.2);
    // Kaburo doesn't sleep; the suburbs do.
    expect(nightLife({}, 'neon')).toBeGreaterThan(0.7);
    expect(nightLife({}, 'residential')).toBeLessThan(0.2);
    expect(nightLife({ night: 1 }, 'residential')).toBe(1);
  });

  it('keeps people in when it rains, the nightlife least', () => {
    for (const hours of HOURS) expect(RAIN[hours]).toBeGreaterThan(0);
    expect(RAIN.late).toBeLessThan(RAIN.always);
    expect(isOut('always', 0.6, 13, 0)).toBe(true);
    expect(isOut('always', 0.6, 13, 1)).toBe(false);
    expect(isOut('late', 0.6, 1, 1)).toBe(true);
  });

  it('gives each kind of person hours and a manner', () => {
    expect(whenOf('school', 'woman', 1, 0)).toEqual({ hours: 'school', manner: 'young' });
    expect(whenOf('plain', 'child', 1, 0).hours).toBe('day');
    expect(whenOf('suit', 'man', 0.9, 0.5).hours).toBe('evening');
    expect(whenOf('suit', 'man', 0.1, 0.5).hours).toBe('commute');
    expect(whenOf('plain', 'man', 0.1, 0.5).hours).toBe('always');
    expect(whenOf('gown', 'woman', 0, 0.5).hours).toBe('evening');
    for (const o of OUTFITS) expect(HOURS).toContain(whenOf(o, 'man', 0.5, 0.5).hours);
  });

  it('keeps summer and winter clothes to their seasons', () => {
    expect(seasonsOf('shorts') & 8).toBe(0);
    expect(seasonsOf('shorts') & 2).toBe(2);
    expect(seasonsOf('puffer') & 2).toBe(0);
    expect(seasonsOf('puffer') & 8).toBe(8);
    expect(seasonsOf('plain')).toBe(15);
  });

  it('packs them into a figure: its hours, manner, threshold and seasons; someone fixed is always there', () => {
    const base: FigureSpec = { x: 0, z: 0, yaw: 0, body: 'man', pose: 'stand', color: [0.1, 0.1, 0.1], hair: 'short', long: false, phase: 0, side: 1, look: 0 };
    const f = packFigures([{ ...base, outfit: 'shorts', hours: 'late', manner: 'shady', out: 0.4 }]);
    expect(f.length).toBe(FIGURE_STRIDE);
    expect(f[20]).toBe(HOURS.indexOf('late'));
    expect(f[21]).toBe(1);
    expect(f[22]).toBeCloseTo(0.4);
    expect(f[23]).toBe(2);
    expect(packFigures([base])[20]).toBe(-1);
    expect(packFigures([{ ...base, hours: 'day', fade: false }])[20]).toBe(-1);
  });
});
