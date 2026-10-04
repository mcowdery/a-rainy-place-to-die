import { describe, expect, it } from 'vitest';
import { cockpitLayout, CABIN_STYLE } from '../src/poc3d/models/carInterior';
import { bodyShape, CAR_TYPES2 } from '../src/poc3d/models/vehicles';
import * as THREE from 'three';
import { DRIVE_VIEWS, Head, lookInto, NECK, nextView, outside, parseView, turnedEye } from '../src/race/driveCam';
import { EYE } from '../src/race/shooting';

describe('cockpit layout', () => {
  it('fits every car: eyes under the roof and over the belt, the wheel ahead and below, the dash beyond it', () => {
    for (const type of CAR_TYPES2) {
      const L = cockpitLayout(type);
      const B = bodyShape(type);
      const x = (z: number): number => z + B.L / 2;
      const ex = x(L.eye.z);
      expect(L.eye.y, type).toBeLessThan(B.top(ex) - 0.12);
      expect(L.eye.y, type).toBeGreaterThan(B.belt(ex) + 0.1);
      // Right-hand drive, inside the body.
      expect(L.side, type).toBeLessThan(-0.2);
      expect(Math.abs(L.side), type).toBeLessThan(B.halfW(ex) - 0.3);
      expect(L.seat.y, type).toBeLessThan(L.eye.y - 0.6);
      expect(L.seat.y, type).toBeGreaterThan(L.floor);
      expect(L.wheel.c.z, type).toBeGreaterThan(L.eye.z + 0.3);
      expect(L.wheel.c.y, type).toBeLessThan(L.eye.y - 0.15);
      // The wheel's axis runs forward and down the column; its up leans away from the driver.
      expect(L.wheel.axis.z, type).toBeGreaterThan(0);
      expect(L.wheel.axis.y, type).toBeLessThan(0);
      expect(L.wheel.up.z, type).toBeGreaterThan(0);
      expect(L.dash.lip, type).toBeGreaterThan(L.wheel.c.z);
      expect(L.dash.lip, type).toBeLessThan(L.dash.front);
      expect(L.pedals.z, type).toBeGreaterThan(L.seat.z + 0.4);
      // The mirror up under the roof ahead of the eyes; the bonnet camera on the bonnet ahead of the glass.
      expect(L.mirror.z, type).toBeGreaterThan(L.eye.z + 0.2);
      expect(L.mirror.y, type).toBeLessThan(B.top(x(L.mirror.z)));
      expect(L.hood.z, type).toBeGreaterThan(L.dash.front);
      expect(L.hood.y, type).toBeGreaterThan(B.top(x(L.hood.z)));
      expect(L.back, type).toBeLessThan(L.seat.z - 0.2);
      expect(CABIN_STYLE[type], type).toBeTruthy();
    }
  });

  it("puts the coupe's driver where shooting from the car expects his eyes", () => {
    const L = cockpitLayout('sports');
    expect(Math.abs(L.eye.x - EYE.x)).toBeLessThan(0.03);
    expect(Math.abs(L.eye.y - EYE.y)).toBeLessThan(0.03);
    expect(Math.abs(L.eye.z - EYE.z)).toBeLessThan(0.03);
  });

  it('sits you higher in a kei tall-wagon or a van than in a sports car', () => {
    expect(cockpitLayout('kei').eye.y).toBeGreaterThan(cockpitLayout('sports').eye.y + 0.2);
    expect(cockpitLayout('van').eye.y).toBeGreaterThan(cockpitLayout('sedan').eye.y + 0.2);
    expect(cockpitLayout('roadster').eye.y).toBeLessThan(cockpitLayout('sports').eye.y);
  });
});

describe('driving cameras', () => {
  it('cycles every view, and a bike between his eyes and behind it', () => {
    let v = DRIVE_VIEWS[0];
    const seen = new Set<string>();
    for (let i = 0; i < DRIVE_VIEWS.length; i++) {
      seen.add(v);
      v = nextView(v);
    }
    expect(seen.size).toBe(DRIVE_VIEWS.length);
    expect(v).toBe(DRIVE_VIEWS[0]);
    expect(nextView('chase', true)).toBe('cockpit');
    expect(nextView('cockpit', true)).toBe('chase');
    expect(nextView('hood', true)).toBe('chase');
    expect(outside('far')).toBe(true);
    expect(outside('cockpit')).toBe(false);
    expect(parseView('hood')).toBe('hood');
    expect(parseView('nonsense')).toBeNull();
  });

  it("throws the driver's head out of a bend and forward under braking, and settles", () => {
    const h = new Head();
    // A left-hand bend (accelerating to the left): the head goes right (-x).
    for (let i = 0; i < 120; i++) h.update(1 / 60, 0, 8, 0);
    expect(h.offset.x).toBeLessThan(-0.02);
    h.reset();
    // Braking hard: forward (+z).
    for (let i = 0; i < 120; i++) h.update(1 / 60, -9, 0, 0);
    expect(h.offset.z).toBeGreaterThan(0.02);
    // Let go: back to rest.
    for (let i = 0; i < 240; i++) h.update(1 / 60, 0, 0, 0);
    expect(h.offset.length()).toBeLessThan(0.005);
  });

  it('swings his eyes round his neck as he looks about: behind it looking back, never over his own collar', () => {
    const eye = new THREE.Vector3(-0.36, 1.07, 0.1);
    const neck = eye.clone().add(new THREE.Vector3(0, 0, -NECK));
    expect(turnedEye(eye.clone(), 0).distanceTo(eye)).toBeCloseTo(0, 9);
    for (const yaw of [-2.2, -1, 0.6, 2.2, Math.PI]) {
      const at = turnedEye(eye.clone(), yaw);
      // Always the same way from the neck as he looks, the same distance out, at the same height.
      expect(at.x - neck.x).toBeCloseTo(Math.sin(yaw) * NECK, 9);
      expect(at.z - neck.z).toBeCloseTo(Math.cos(yaw) * NECK, 9);
      expect(at.y).toBe(eye.y);
    }
  });

  it('looks into the bend and along a slide', () => {
    expect(lookInto(0.2, 20, 0)).toBeGreaterThan(0.1);
    expect(lookInto(-0.2, 20, 0)).toBeLessThan(-0.1);
    expect(lookInto(0.2, 0, 0)).toBe(0);
    expect(lookInto(0, 20, 0.5)).toBeGreaterThan(0.2);
    expect(Math.abs(lookInto(1, 40, 1))).toBeLessThanOrEqual(0.55);
  });
});
