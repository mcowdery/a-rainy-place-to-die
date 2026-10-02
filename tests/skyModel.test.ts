import { describe, expect, it } from 'vitest';
import { SkyModel } from '../src/poc3d/real/skyModel';

describe('the physical sky', () => {
  const t0 = performance.now();
  const sky = new SkyModel();
  const built = performance.now() - t0;
  const at = (sunDeg: number, elDeg: number, azDeg: number): [number, number, number] =>
    SkyModel.at(sky.slice((sunDeg * Math.PI) / 180), (elDeg * Math.PI) / 180, (azDeg * Math.PI) / 180);
  const lum = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  it('builds quickly enough for the warm start, every value finite', () => {
    expect(built).toBeLessThan(2500);
    for (const v of sky.data) expect(Number.isFinite(v) && v >= 0).toBe(true);
  });

  it('is blue overhead at noon, paler at the horizon', () => {
    const z = at(60, 90, 0);
    expect(z[2]).toBeGreaterThan(z[0] * 2);
    const h = at(60, 2, 90);
    expect(h[2] / h[0]).toBeLessThan(z[2] / z[0]);
  });

  it('reddens toward the setting sun, and the sun with it', () => {
    const toward = at(1, 3, 0);
    const away = at(1, 3, 180);
    expect(toward[0] / toward[2]).toBeGreaterThan(away[0] / away[2]);
    expect(lum(toward)).toBeGreaterThan(lum(away));
    const s = sky.stats((1 * Math.PI) / 180, sky.slice((1 * Math.PI) / 180)).sun;
    const noon = sky.stats(1, sky.slice(1)).sun;
    expect(s[0] / s[2]).toBeGreaterThan(noon[0] / noon[2] * 2);
  });

  it('darkens through the twilight, staying blue overhead (the ozone), black by night', () => {
    const l = [0, -3, -6, -10, -18].map((d) => lum(at(d, 90, 90)));
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);
    const blue = at(-5, 90, 90);
    expect(blue[2]).toBeGreaterThan(blue[0]);
    expect(lum(at(-19, 60, 90))).toBeLessThan(lum(at(60, 60, 90)) * 0.01);
    expect(sky.stats(-0.1, sky.slice(-0.1)).sun).toEqual([0, 0, 0]);
  });
});
