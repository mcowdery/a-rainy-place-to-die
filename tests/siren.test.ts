import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLASH_HZ, litHalf, nextMode, pulse, Siren } from '../src/poc3d/district/siren';
import { cockpitLayout } from '../src/poc3d/models/carInterior';
import { bodyShape } from '../src/poc3d/models/vehicles';

describe('the glovebox siren', () => {
  it('flashes its two halves in turn', () => {
    const step = 1 / (FLASH_HZ * 2);
    expect(litHalf(0)).toBe(0);
    expect(litHalf(step * 1.1)).toBe(1);
    expect(litHalf(step * 2.1)).toBe(0);
  });

  it('sits on the roof of each car, between the windscreen and the rear glass, and only while on', () => {
    for (const type of ['sedan', 'luxury', 'sports', 'taxi', 'police'] as const) {
      const parent = new THREE.Group();
      const siren = new Siren();
      siren.fit(parent, type);
      const B = bodyShape(type);
      const p = siren.group.position;
      expect(parent.children).toContain(siren.group);
      expect(siren.group.visible).toBe(false);
      expect(p.y).toBeCloseTo(B.top(p.z + B.L / 2) - 0.005, 5);
      expect(p.z + B.L / 2).toBeGreaterThan(B.rearGlass[1] - 1e-6);
      expect(p.z + B.L / 2).toBeLessThan(B.windscreen[0] + 1e-6);
      siren.set('lights');
      expect(siren.group.visible).toBe(true);
      siren.set('off');
      expect(siren.group.visible).toBe(false);
    }
  });

  it('steps through lights and siren, lights only, and off', () => {
    expect(nextMode('off')).toBe('siren');
    expect(nextMode('siren')).toBe('lights');
    expect(nextMode('lights')).toBe('off');
    const siren = new Siren();
    expect(siren.press(false)).toBe('siren');
    expect(siren.on).toBe(true);
  });

  it('is taken from the glovebox and set on the roof by hand, and taken down the same way', () => {
    for (const type of ['sedan', 'luxury', 'sports', 'taxi', 'police', 'hardtop'] as const) {
      const parent = new THREE.Group();
      const siren = new Siren();
      siren.fit(parent, type);
      const roof = siren.group.position.clone();
      const L = cockpitLayout(type);
      // Putting it up: nothing on the roof until his hand sets it there, and his hands are busy meanwhile.
      expect(siren.press(true)).toBe('siren');
      expect(siren.busy).toBe(true);
      expect(siren.press(true)).toBeNull();
      let last: THREE.Vector3 | null = null;
      let placed = -1;
      let widest = 0;
      let reach = 0;
      for (let t = 0; siren.busy && t < 10; t += 1 / 60) {
        siren.update(1 / 60);
        if (siren.group.visible && !siren.on) {
          // In a hand: it moves smoothly (no jumps), and the hand that has it stays within an arm's length of its shoulder.
          if (last) widest = Math.max(widest, siren.group.position.distanceTo(last));
          last = siren.group.position.clone();
          const h = siren.hands()!;
          reach = Math.max(reach, h.rightAt.distanceTo(new THREE.Vector3(L.eye.x - 0.2, L.eye.y - 0.2, L.eye.z)));
        } else last = null;
        if (siren.on && placed < 0) placed = t;
      }
      expect(widest).toBeLessThan(0.06);
      expect(reach).toBeLessThan(0.7);
      expect(placed).toBeGreaterThan(2.5);
      expect(siren.mode).toBe('siren');
      expect(siren.group.position.distanceTo(roof)).toBeLessThan(1e-6);
      // The roof spot is on the driver's side, beside his window, within an arm of his shoulder.
      expect(roof.x).toBeLessThan(0);
      expect(Math.abs(roof.x)).toBeLessThan(L.halfW);
      // The lights only: no hands. Then off: the hand takes it down; its lights go when it's lifted off.
      expect(siren.press(true)).toBe('lights');
      expect(siren.busy).toBe(false);
      expect(siren.press(true)).toBe('off');
      expect(siren.busy).toBe(true);
      let offAt = -1;
      for (let t = 0; siren.busy && t < 10; t += 1 / 60) {
        siren.update(1 / 60);
        if (!siren.on && offAt < 0) offAt = t;
      }
      expect(offAt).toBeGreaterThan(0.5);
      expect(siren.mode).toBe('off');
      expect(siren.group.visible).toBe(false);
    }
  });

  it('is done at once without a driver to act it, or when he gets out part way', () => {
    const siren = new Siren();
    siren.fit(new THREE.Group(), 'sedan');
    expect(siren.press(false)).toBe('siren');
    expect(siren.on).toBe(true);
    expect(siren.busy).toBe(false);
    siren.set('off');
    siren.press(true);
    siren.update(0.5);
    siren.finish();
    expect(siren.busy).toBe(false);
    expect(siren.mode).toBe('siren');
  });

  it('throws its red on the street only while on, pulsing between a floor and full', () => {
    const siren = new Siren();
    const parent = new THREE.Group();
    parent.position.set(10, 0, 20);
    siren.fit(parent, 'sedan');
    parent.updateMatrixWorld(true);
    const out = new THREE.Vector4(1, 1, 1, 1);
    siren.light(out);
    expect(out.w).toBe(0);
    siren.set('siren');
    siren.light(out);
    expect(out.x).toBeCloseTo(10 + siren.group.position.x, 5);
    expect(out.w).toBeGreaterThan(0.2);
    for (let t = 0; t < 2; t += 0.01) {
      expect(pulse(t)).toBeGreaterThanOrEqual(0.25 - 1e-9);
      expect(pulse(t)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
