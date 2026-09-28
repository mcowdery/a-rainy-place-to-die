import * as THREE from 'three';
import { EYE, WINDOW } from './shooting';

/**
 * The car's cabin as the driver sees it, shown only while shooting across the car from the driver's seat: the
 * passenger door round its open window (the window is exactly `WINDOW`, so what it frames is what you can
 * hit), the roof lining, the A-pillars either side of the windscreen, the dashboard with its lit gauges, the
 * centre console, the steering wheel, the passenger seat, the mirror and the bulkhead behind. In the car's
 * frame (+x its left, +z forward), a child of the car.
 */
export function buildCabin(): THREE.Group {
  const g = new THREE.Group();
  const trim = new THREE.MeshStandardMaterial({ color: 0x232327, roughness: 0.85 });
  const liner = new THREE.MeshStandardMaterial({ color: 0x3c3a3e, roughness: 0.95 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x17171b, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8c92, metalness: 0.7, roughness: 0.35 });
  const box = (m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tilt = 0): THREE.Mesh => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    b.rotation.x = tilt;
    g.add(b);
    return b;
  };
  const W = WINDOW;
  const X = W.x;
  // The passenger door, round the open window: below it, the rail above, the A-pillar's foot ahead, the B-pillar behind.
  box(trim, X, X + 0.06, 0.28, W.y0, -0.85, 1.1);
  box(trim, X, X + 0.06, W.y1, 1.3, -0.85, 1.1);
  box(trim, X, X + 0.06, W.y0, W.y1, W.z1, 1.1);
  box(trim, X - 0.03, X + 0.06, W.y0, W.y1, -0.85, W.z0);
  // The window's rubber seal all round the opening (so it reads as a window), the armrest and the door handle.
  const seal = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5 });
  box(seal, X - 0.02, X, W.y0 - 0.025, W.y0, W.z0 - 0.025, W.z1 + 0.025);
  box(seal, X - 0.02, X, W.y1, W.y1 + 0.025, W.z0 - 0.025, W.z1 + 0.025);
  box(seal, X - 0.02, X, W.y0, W.y1, W.z0 - 0.025, W.z0);
  box(seal, X - 0.02, X, W.y0, W.y1, W.z1, W.z1 + 0.025);
  box(metal, X - 0.03, X - 0.02, W.y0 - 0.006, W.y0, W.z0, W.z1);
  box(leather, X - 0.13, X, 0.6, 0.67, -0.3, 0.45);
  box(metal, X - 0.02, X, 0.74, 0.76, 0.3, 0.42);
  // The driver's door (behind you to the right, glimpsed turning) and the roof lining.
  box(trim, -X - 0.06, -X, 0.28, 1.3, -0.85, 1.1);
  box(liner, -0.8, 0.8, 1.24, 1.28, -0.9, 0.52);
  // A-pillars, raking down from the roof to the scuttle either side of the open windscreen.
  for (const s of [-1, 1]) box(trim, s * 0.8 - 0.05, s * 0.8 + 0.05, 1.06, 1.12, 0.47, 1.13, 0.43);
  // The dashboard, the gauge hood in front of the driver, the centre console, the floor.
  box(trim, -0.9, 0.9, 0.7, 0.93, 0.62, 1.12);
  box(trim, EYE.x - 0.26, EYE.x + 0.24, 0.93, 1.0, 0.62, 0.76);
  box(trim, -0.13, 0.13, 0.28, 0.72, 0.05, 0.95);
  box(trim, -0.9, 0.9, 0.16, 0.22, -1.0, 1.12);
  // The gauges, lit amber, facing the driver.
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.7, 0.2) });
  for (const dx of [-0.11, 0.11]) {
    const gauge = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 24), glow);
    gauge.position.set(EYE.x + dx, 0.955, 0.618);
    gauge.rotation.y = Math.PI;
    g.add(gauge);
  }
  // The steering wheel.
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 8, 32), leather);
  wheel.position.set(EYE.x, 0.9, 0.44);
  wheel.rotation.x = -0.35;
  g.add(wheel);
  box(leather, EYE.x - 0.03, EYE.x + 0.03, 0.86, 0.94, 0.44, 0.62, -0.35);
  // The passenger seat: cushion, back (reclined a little), headrest.
  box(leather, 0.2, 0.74, 0.34, 0.5, -0.36, 0.24);
  box(leather, 0.22, 0.72, 0.46, 1.04, -0.52, -0.38, -0.16);
  box(leather, 0.34, 0.6, 1.05, 1.2, -0.58, -0.47);
  // The mirror, and the bulkhead behind the seats.
  box(leather, -0.13, 0.13, 1.12, 1.18, 0.45, 0.48);
  box(trim, -0.9, 0.9, 0.3, 1.24, -1.0, -0.94);
  g.visible = false;
  return g;
}
