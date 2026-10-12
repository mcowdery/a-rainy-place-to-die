import { describe, expect, it } from 'vitest';
import { FAUNA_KINDS, faunaTargets, habitatWeight, type FaunaContext, type Habitat } from '../src/poc3d/district/faunaMix';

const base: FaunaContext = { tropical: false, hour: 12, season: 'summer', rain: 0, wind: 1, snow: false, typhoon: false, water: 0, green: 1, lamps: 1 };
const t = (c: Partial<FaunaContext>) => faunaTargets({ ...base, ...c });

describe('faunaMix', () => {
  it('never asks for a negative or fractional number', () => {
    for (const tropical of [false, true]) for (const hour of [0, 5, 6, 12, 18, 19, 23]) for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) for (const rain of [0, 0.5, 1]) {
      const x = t({ tropical, hour, season, rain, water: 1 });
      for (const k of FAUNA_KINDS) expect(Number.isInteger(x[k]) && x[k] >= 0).toBe(true);
    }
  });
  it('has nothing indoors or in a typhoon', () => {
    expect(Object.values(t({ shut: true })).every((n) => n === 0)).toBe(true);
    expect(Object.values(t({ typhoon: true })).every((n) => n === 0)).toBe(true);
  });
  it('keeps insects out of the rain and the wind', () => {
    const wet = t({ rain: 0.8 });
    const gale = t({ wind: 12 });
    for (const k of ['butterfly', 'dragonfly', 'firefly', 'moth'] as const) {
      expect(wet[k]).toBe(0);
      expect(gale[k]).toBe(0);
    }
  });
  it('has fireflies on summer nights and butterflies by day, not the other way round', () => {
    expect(t({ hour: 22 }).firefly).toBeGreaterThan(0);
    expect(t({ hour: 22 }).butterfly).toBe(0);
    expect(t({ hour: 12 }).butterfly).toBeGreaterThan(0);
    expect(t({ hour: 12 }).firefly).toBe(0);
  });
  it('has no insects in a Tōto winter', () => {
    const w = t({ season: 'winter', hour: 21 });
    for (const k of ['butterfly', 'dragonfly', 'firefly', 'moth'] as const) expect(w[k]).toBe(0);
  });
  it('keeps gulls to the sea', () => {
    expect(t({ water: 0 }).gull).toBe(0);
    expect(t({ water: 1 }).gull).toBeGreaterThan(0);
  });
  it("gives Manila its own animals: dogs and hens, no crows; Tōto's crows and no hens", () => {
    const m = t({ tropical: true });
    const j = t({});
    expect(m.dog).toBeGreaterThan(0);
    expect(m.chicken).toBeGreaterThan(0);
    expect(m.crow).toBe(0);
    expect(j.crow).toBeGreaterThan(0);
    expect(j.chicken).toBe(0);
    expect(j.dog).toBe(0);
  });
  it("keeps each city's own animals to it", () => {
    const m = t({ tropical: true, hour: 22, water: 1, green: 1 });
    const j = t({ hour: 22, water: 1, green: 1 });
    for (const k of ['fox', 'tanuki', 'squirrel', 'turtle'] as const) expect(m[k]).toBe(0);
    for (const k of ['goat', 'gecko', 'parrot', 'crab', 'monkey', 'cockroach', 'lizard'] as const) expect(j[k]).toBe(0);
    expect(j.fox).toBeGreaterThan(0);
    expect(m.gecko).toBeGreaterThan(0);
  });
  describe('habitat', () => {
    const at = (h: Partial<Habitat>): Habitat => ({ urban: 0.1, park: false, pond: false, coast: 0, tropical: false, ...h });
    it('keeps downtown to pigeons, crows, sparrows and the alleys', () => {
      const core = at({ urban: 1 });
      for (const k of ['duck', 'turtle', 'goat', 'chicken', 'gull', 'crab', 'egret'] as const) expect(habitatWeight(k, core)).toBe(0);
      expect(habitatWeight('pigeon', core)).toBeGreaterThan(0.9);
      expect(habitatWeight('cat', core)).toBeLessThan(0.15);
      expect(habitatWeight('dog', core)).toBeLessThan(0.06);
      expect(habitatWeight('fox', core)).toBe(0);
      expect(habitatWeight('squirrel', core)).toBe(0);
    });
    it('puts cats and dogs in the suburbs', () => {
      expect(habitatWeight('cat', at({ urban: 0.15 }))).toBeGreaterThan(0.9);
      expect(habitatWeight('dog', at({ urban: 0.15 }))).toBeGreaterThan(0.9);
    });
    it('puts ducks and turtles at ponds only, and the wild ones in parks', () => {
      expect(habitatWeight('duck', at({ urban: 0.9 }))).toBe(0);
      expect(habitatWeight('duck', at({ urban: 0.1, coast: 1 }))).toBe(0);
      expect(habitatWeight('duck', at({ pond: true }))).toBe(1);
      expect(habitatWeight('fox', at({ park: true }))).toBe(1);
      expect(habitatWeight('monkey', at({ urban: 0.1 }))).toBeLessThan(0.1);
    });
    it("keeps Manila's goats and hens out of the centre but not its cats and dogs", () => {
      const core = at({ urban: 0.9, tropical: true });
      const edge = at({ urban: 0.2, tropical: true });
      expect(habitatWeight('goat', core)).toBe(0);
      expect(habitatWeight('chicken', core)).toBe(0);
      expect(habitatWeight('goat', edge)).toBe(1);
      expect(habitatWeight('cat', core)).toBeGreaterThan(0.4);
      expect(habitatWeight('dog', core)).toBeGreaterThan(0.35);
      expect(habitatWeight('cat', edge)).toBe(1);
    });
    it("keeps Manila's goats and hens out of the centre but not its cats and dogs", () => {
      const core = at({ urban: 0.9, tropical: true });
      const edge = at({ urban: 0.2, tropical: true });
      expect(habitatWeight('goat', core)).toBe(0);
      expect(habitatWeight('chicken', core)).toBe(0);
      expect(habitatWeight('goat', edge)).toBe(1);
      expect(habitatWeight('cat', core)).toBeGreaterThan(0.4);
      expect(habitatWeight('dog', core)).toBeGreaterThan(0.35);
      expect(habitatWeight('cat', edge)).toBe(1);
    });
    it('puts the sea birds and crabs at the coast, and no crows in Manila', () => {
      expect(habitatWeight('gull', at({ coast: 0.8 }))).toBe(1);
      expect(habitatWeight('gull', at({ coast: 0 }))).toBe(0);
      expect(habitatWeight('crow', at({ tropical: true }))).toBe(0);
    });
  });
});
