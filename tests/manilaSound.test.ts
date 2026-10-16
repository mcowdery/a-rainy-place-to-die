import { describe, expect, it } from 'vitest';
import { ANGELUS_GAP, bellLevel, bellRing, courtProximity, engineVoice, hourCrossed, jeepneyHornNotes, manilaFrame, manilaPlace, windowAt } from '../src/poc3d/real/manilaSound';
import { hash } from '../src/core/hash';

describe('church bells', () => {
  it('rings the Angelus at 6, 12 and 18: three threes, then a peal', () => {
    for (const h of [6, 12, 18]) {
      const r = bellRing(h)!;
      expect(r.kind).toBe('angelus');
      expect(r.at.length).toBe(18);
      expect(r.at[1] - r.at[0]).toBeCloseTo(ANGELUS_GAP);
      expect(r.at[3] - r.at[2]).toBeGreaterThan(ANGELUS_GAP * 1.5);
      expect([...r.at].sort((a, b) => a - b)).toEqual([...r.at]);
    }
  });
  it('tolls the hour on the twelve-hour clock by day, and is silent at night', () => {
    expect(bellRing(8)!.at.length).toBe(8);
    expect(bellRing(15)!.at.length).toBe(3);
    expect(bellRing(21)!.at.length).toBe(9);
    expect(bellRing(3)).toBeNull();
    expect(bellRing(23)).toBeNull();
  });
  it('fires once as the clock crosses an hour, and not on a long jump', () => {
    expect(hourCrossed(359, 360)).toBe(6);
    expect(hourCrossed(360, 361)).toBeNull();
    expect(hourCrossed(1439, 1440)).toBe(0);
    expect(hourCrossed(100, 100 + 300)).toBeNull();
    expect(hourCrossed(Number.NaN, 500)).toBeNull();
  });
  it('is loudest in the old town', () => {
    expect(bellLevel(manilaPlace('Muralya'))).toBeGreaterThan(bellLevel(manilaPlace('Tundo')));
    expect(bellLevel(manilaPlace('Tundo'))).toBeGreaterThan(bellLevel(manilaPlace('Fort Centre')));
  });
});

describe('jeepney horns', () => {
  it('is a run of 3-5 notes, in order, the last longer', () => {
    for (let s = 1; s < 60; s++) {
      const t = jeepneyHornNotes(s);
      expect(t.hz.length).toBeGreaterThanOrEqual(3);
      expect(t.hz.length).toBeLessThanOrEqual(5);
      expect(t.at).toEqual([...t.at].sort((a, b) => a - b));
      expect(t.len[t.len.length - 1]).toBeGreaterThan(t.len[0]);
      const up = t.hz[1] > t.hz[0];
      for (let i = 1; i < t.hz.length; i++) expect(t.hz[i] > t.hz[i - 1]).toBe(up);
    }
  });
});

describe('the street at its hours', () => {
  const brgy = manilaPlace('Tundo');
  const m = (h: number, place = brgy, rain = 0, ty = 0, court = 0) => manilaFrame(place, h * 60, rain, ty, court);
  it('has roosters at dawn, videoke at night, vendors morning and evening', () => {
    expect(m(5).rooster).toBeGreaterThan(m(13).rooster);
    expect(m(21).videoke).toBeGreaterThan(0.5);
    expect(m(10).videoke).toBe(0);
    expect(m(7).vendor).toBeGreaterThan(0.5);
    expect(m(17).vendor).toBeGreaterThan(0.5);
    expect(m(12).vendor).toBeLessThan(0.2);
    expect(m(1).videoke).toBeGreaterThan(0);
  });
  it('puts the videoke in the nightlife strips and the barangays, not the towers', () => {
    expect(m(22, manilaPlace('Ermida-Malaya')).videoke).toBeGreaterThan(0.8);
    expect(m(22, manilaPlace('Fort Centre')).videoke).toBe(0);
  });
  it('plays the court only near one, in the afternoon and evening', () => {
    expect(m(18, brgy, 0, 0, 1).court).toBeGreaterThan(0.8);
    expect(m(18, brgy, 0, 0, 0).court).toBe(0);
    expect(m(4, brgy, 0, 0, 1).court).toBe(0);
  });
  it('drums rain on tin in the barangays only, and a typhoon blows', () => {
    expect(m(14, brgy, 0.8).tin).toBeGreaterThan(0.9);
    expect(m(14, manilaPlace('Fort Centre'), 0.8).tin).toBe(0);
    expect(m(14, brgy, 0, 0).tin).toBe(0);
    expect(m(14, brgy, 1, 0.9).typhoon).toBeCloseTo(0.9);
  });
  it('window wraps past midnight', () => {
    expect(windowAt(0.5, 19, 25.5)).toBe(1);
    expect(windowAt(12, 19, 25.5)).toBe(0);
  });
});

describe('courts and engines', () => {
  it('finds a court near its cell and not a long way off', () => {
    const isB = () => true;
    const h = (mx: number, mz: number, k: number) => hash(1, mx, mz, k);
    let near = 0;
    let far = 0;
    for (let i = 0; i < 40; i++) {
      near = Math.max(near, courtProximity(i * 128 + 64, 500, 128, isB, h));
      far = Math.max(far, courtProximity(i * 128 + 64, 500, 128, () => false, h));
    }
    expect(near).toBeGreaterThan(0.2);
    expect(far).toBe(0);
  });
  it('gives a tricycle a higher, brighter buzz than a car, and a car what it had', () => {
    const car = engineVoice('sedan', 8, 0, false);
    const tri = engineVoice('tricycle', 8, 0, false);
    expect(tri.revs).toBeGreaterThan(car.revs * 1.5);
    expect(tri.lp).toBeGreaterThan(car.lp);
    expect(car.sub).toBeCloseTo(0.505);
    expect(car.revs).toBeCloseTo(30 + (8 % 4.5) * 8 + 8 * 1.5);
    expect(engineVoice(undefined, 8, 0, false)).toEqual(car);
  });
});
