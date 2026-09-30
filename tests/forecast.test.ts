import { describe, expect, it } from 'vitest';
import { BLOCK, forecastAt, ODDS } from '../src/poc3d/district/forecast';
import { SEASONS } from '../src/poc3d/district/seasons';

describe('forecast', () => {
  const share = (season: (typeof SEASONS)[number], w: string): number => {
    let n = 0;
    const N = 4000;
    // Midday of each block (no morning fog).
    for (let i = 0; i < N; i++) if (forecastAt(i * 24 * 60 + 12 * 60, season) === w) n++;
    return n / N;
  };

  it('rains about as often as the season says, spring most', () => {
    for (const s of SEASONS) expect(Math.abs(share(s, 'rain') - ODDS[s].rain)).toBeLessThan(0.03);
    expect(share('spring', 'rain')).toBeGreaterThan(share('summer', 'rain'));
    expect(share('spring', 'rain')).toBeGreaterThan(share('autumn', 'rain'));
  });

  it('snows only in winter, fogs only in the morning', () => {
    for (const s of ['spring', 'summer', 'autumn'] as const) expect(share(s, 'snow')).toBe(0);
    expect(share('winter', 'snow')).toBeGreaterThan(0.15);
    for (const s of SEASONS) expect(share(s, 'fog')).toBe(0);
    let fog = 0;
    for (let d = 0; d < 400; d++) if (forecastAt(d * 24 * 60 + 6 * 60, 'autumn') === 'fog') fog++;
    expect(fog).toBeGreaterThan(20);
  });

  it('holds for a whole spell and is the same every time', () => {
    for (let b = 0; b < 50; b++) {
      const t = b * BLOCK + 12 * 60 * 0;
      const w = forecastAt(t + 30, 'spring');
      if (w === 'fog') continue;
      expect(forecastAt(t + BLOCK - 30, 'spring') === w || forecastAt(t + BLOCK - 30, 'spring') === 'fog').toBe(true);
    }
    expect(forecastAt(12345, 'spring')).toBe(forecastAt(12345, 'spring'));
  });
});
