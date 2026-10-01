import { describe, expect, it } from 'vitest';
import { CITY_CARS, DISTRICT_CARS, pickCar } from '../src/poc3d/district/carMix';
import { addVehicle, CAR_TYPES2, liveryOf, PAINTS, POLICE_EN, POLICE_NAME, vehicleTexts, WORK_LIVERIES } from '../src/poc3d/models/vehicles';
import { addCar } from '../src/poc3d/real/cars';
import { MeshBuilder } from '../src/poc3d/real/meshBuilder';
import { SignBuilder, SignLayout } from '../src/poc3d/real/signs';
import { taxiPhotos } from '../src/poc3d/real/taxiAdLayout';

describe('parked cars', () => {
  it('a stamped car is the same as one lofted in place', () => {
    const [fx, fz] = [Math.cos(0.7), Math.sin(0.7)];
    const a = new MeshBuilder();
    addVehicle(a, { x: 12, z: -30, fx, fz, type: 'minivan', paint: PAINTS.minivan[1], detail: 0.25, lamps: false });
    const b = new MeshBuilder();
    addCar(b, { x: 12, z: -30, fx, fz, variant: 1, type: 'minivan', paint: PAINTS.minivan[1] });
    const ga = a.build()!;
    const gb = b.build()!;
    for (const name of ['position', 'normal', 'color', 'aFacade', 'aStyle']) {
      const pa = ga.getAttribute(name).array;
      const pb = gb.getAttribute(name).array;
      expect(pb.length).toBe(pa.length);
      for (let i = 0; i < pa.length; i++) expect(pb[i]).toBeCloseTo(pa[i], 4);
    }
    expect([...gb.index!.array]).toEqual([...ga.index!.array]);
  });

  it("traffic's brake lights sit on the tail lamps, at the back", () => {
    for (const type of CAR_TYPES2) {
      const body = new MeshBuilder();
      const brake = new MeshBuilder();
      addVehicle(body, { x: 0, z: 0, fx: 0, fz: 1, type, paint: PAINTS[type][0], detail: 0.12, wheels: false }, undefined, brake);
      const g = body.build()!;
      g.computeBoundingBox();
      const b = brake.build()!;
      b.computeBoundingBox();
      const bb = g.boundingBox!;
      const lb = b.boundingBox!;
      expect(lb.max.z).toBeLessThan(bb.min.z + 0.6);
      expect(lb.min.z).toBeGreaterThan(bb.min.z - 0.05);
      expect(lb.min.y).toBeGreaterThan(0.2);
      expect(lb.max.x).toBeLessThan(bb.max.x);
      expect(lb.min.x).toBeGreaterThan(bb.min.x);
    }
  });

  it('street detail keeps a parked car light', () => {
    for (const type of CAR_TYPES2) {
      const mb = new MeshBuilder();
      addCar(mb, { x: 0, z: 0, fx: 0, fz: 1, variant: 3, type });
      expect(mb.build()!.index!.count / 3).toBeLessThan(2400);
    }
  });
});

describe('car mixes', () => {
  it('pick cars by their weights, deterministically', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) {
      const c = pickCar(CITY_CARS, i);
      counts[c.type] = (counts[c.type] ?? 0) + 1;
      expect(PAINTS[c.type]).toContain(c.paint);
    }
    const total = Object.values(CITY_CARS).reduce((a, b) => a + b!, 0);
    for (const [t, w] of Object.entries(CITY_CARS)) expect(Math.abs(counts[t] / 20000 - w! / total)).toBeLessThan(0.015);
    expect(Object.keys(counts).every((t) => t in CITY_CARS)).toBe(true);
    expect(pickCar(CITY_CARS, 42)).toEqual(pickCar(CITY_CARS, 42));
  });

  it('every district has taxis to hail', () => {
    for (const mix of Object.values(DISTRICT_CARS)) expect((mix!.taxi ?? 0) + (mix!.taxi2 ?? 0)).toBeGreaterThan(0);
  });
});

describe('lettering and ads', () => {
  const layout = new SignLayout(vehicleTexts());
  const quads = (sb: SignBuilder): number => (sb.raw(0, 0)?.index.length ?? 0) / 6;

  it('every text a vehicle can carry is in the sign layout', () => {
    for (const l of WORK_LIVERIES) for (const t of [l.name, l.sub]) expect(layout.rect(t, false)).not.toBe(null);
    for (const t of [POLICE_NAME, POLICE_EN]) expect(layout.rect(t, false)).not.toBe(null);
  });

  it('parked work vehicles wear their company, or none', () => {
    for (const type of ['van', 'keivan', 'boxtruck'] as const) {
      let lettered = 0;
      for (let v = 0; v < 200; v++) {
        const sb = new SignBuilder();
        addCar(new MeshBuilder(), { x: 0, z: 0, fx: 0, fz: 1, variant: v, type }, { sb, layout, photos: taxiPhotos(new SignBuilder()) });
        const liv = liveryOf({ x: 0, z: 0, fx: 0, fz: 1, type, paint: 0, marks: v });
        expect(quads(sb) > 0).toBe(liv !== null);
        if (liv) {
          expect(liv.on).toContain(type);
          lettered++;
        }
      }
      expect(lettered).toBeGreaterThan(80);
      expect(lettered).toBeLessThan(190);
    }
  });

  it('patrol cars carry 警視庁, POLICE and their unit; most taxis an ad', () => {
    const sb = new SignBuilder();
    addCar(new MeshBuilder(), { x: 0, z: 0, fx: 0, fz: 1, variant: 5, type: 'police' }, { sb, layout, photos: taxiPhotos(new SignBuilder()) });
    // Two door texts on each side, and the roof.
    expect(quads(sb)).toBe(5);
    let ads = 0;
    for (let v = 0; v < 200; v++) {
      const pb = new SignBuilder();
      addCar(new MeshBuilder(), { x: 0, z: 0, fx: 0, fz: 1, variant: v, type: v % 2 ? 'taxi' : 'taxi2' }, { sb: new SignBuilder(), layout, photos: taxiPhotos(pb) });
      if (quads(pb) > 0) ads++;
    }
    expect(ads).toBeGreaterThan(90);
    expect(ads).toBeLessThan(150);
  });
});
