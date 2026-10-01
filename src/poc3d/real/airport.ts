import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { airliner2, AIRLINES } from './airliner';

/**
 * 東都空港 Tōto Airport's airfield on Hanejima (the whole-city plan: docs/city-plan.md). The island's landside
 * (the terminal, the control tower, its streets) is generated like any district; its south half is the airfield,
 * drawn here and fenced off (outside the district, so nothing walks or drives onto it): the runway with its
 * markings and edge lights, the approach lights out over the water with their sequenced strobes, the parallel
 * taxiway and its blue lights, the apron with airliners parked at the terminal's jet bridges, and the traffic:
 * an arrival every two and a half minutes, descending out of the west over the bay on its landing lights, and a
 * departure between them, rolling east and climbing out south over the bay.
 */

/** The airfield: L0 cells [c0, r0] to [c1, r1) (Hanejima's south half), and the runway's centreline z. */
export const AIRFIELD = { c0: 4, r0: 25, c1: 12, r1: 27 } as const;
const CELL = 128;
const X0 = AIRFIELD.c0 * CELL;
const X1 = AIRFIELD.c1 * CELL;
const Z0 = AIRFIELD.r0 * CELL;
const Z1 = AIRFIELD.r1 * CELL;
const RWY = { z: Z0 + 150, x0: X0 + 40, x1: X1 - 40, half: 22.5 } as const;
const TWY = { z: Z0 + 70, half: 11 } as const;
/** Parked airliners at the terminal's stands (nose north, toward the terminal). */
const STANDS: readonly number[] = [1062, 1106, 1150];
const APRON_Z = Z0 + 26;

/** Is this L0 cell part of the airfield (drawn here, not generated)? */
export const onAirfield = (mx: number, my: number): boolean => mx >= AIRFIELD.c0 && mx < AIRFIELD.c1 && my >= AIRFIELD.r0 && my < AIRFIELD.r1;

export interface Airport {
  readonly group: THREE.Group;
  update(dt: number, night: boolean): void;
}

/** A low-poly airliner (about an A320: 38 m long, 34 m span), nose along +z, wheels at y 0. */
export function airliner(tail: number): { group: THREE.Group; landing: THREE.Mesh; strobes: THREE.Mesh[]; beacon: THREE.Mesh; windows: THREE.Mesh } {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.35, metalness: 0.1 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.3 });
  const livery = new THREE.MeshStandardMaterial({ color: tail, roughness: 0.4 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const R = 2.0;
  const Y = 3.2;
  // Fuselage, nose and tail cones.
  add(new THREE.CylinderGeometry(R, R, 28, 14), white, 0, Y, 0, Math.PI / 2);
  add(new THREE.SphereGeometry(R, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, Y, 14, Math.PI / 2);
  add(new THREE.ConeGeometry(R, 8, 14), white, 0, Y + 0.6, -18, -Math.PI / 2);
  // A cheatline and the windows (lit at night).
  add(new THREE.BoxGeometry(R * 2.02, 0.35, 26), livery, 0, Y - 0.6, 0.5);
  const windows = add(new THREE.BoxGeometry(R * 2.03, 0.28, 22), new THREE.MeshBasicMaterial({ color: 0x2a3036 }), 0, Y + 0.45, 1);
  // Wings (swept), engines under them, the tailplane and the fin in the airline's colour.
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(15, 0.35, 4.2), grey, s * 9.2, Y - 1.1, -1.5, 0, s * 0.42, s * 0.05);
    add(new THREE.CylinderGeometry(0.95, 0.9, 3.8, 12), grey, s * 5.6, Y - 2.2, 1.6, Math.PI / 2);
    add(new THREE.BoxGeometry(5.5, 0.25, 2.2), grey, s * 3.2, Y + 0.3, -17.2, 0, s * 0.35);
  }
  add(new THREE.BoxGeometry(0.4, 6, 4.4), livery, 0, Y + 4.4, -16.8, 0.35);
  // Gear.
  for (const [x, z] of [[0, 11], [-2.6, -1], [2.6, -1]] as const) add(new THREE.BoxGeometry(0.4, 1.4, 0.8), grey, x, 0.7, z);
  // Lights: landing lights (on approach), strobes on the wingtips and tail, the red beacon on top.
  const landing = add(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5.5) }), 0, Y - 1.4, 12);
  const strobes = [-1, 1].map((s) => add(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5) }), s * 17, Y - 0.6, -4.6));
  add(new THREE.SphereGeometry(0.28, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2) }), -17.2, Y - 0.6, -4.2);
  add(new THREE.SphereGeometry(0.28, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 3, 0.4) }), 17.2, Y - 0.6, -4.2);
  const beacon = add(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }), 0, Y + R + 0.2, 0);
  return { group: g, landing, strobes, beacon, windows };
}

/** The airfield; with the city material, its airliners are the new ones (real/airliner.ts, ?transit=new). */
export function buildAirport(city: THREE.Material | null = null): Airport {
  const plane = (k: number, tail: number): ReturnType<typeof airliner> => (city ? airliner2(AIRLINES[k % AIRLINES.length], city) : airliner(tail));
  const group = new THREE.Group();
  // The airfield's static parts are a handful of draws (it was ~500 meshes, each its own draw and matrix): the
  // ground and paint one merged mesh with vertex colours, the bulbs and posts instanced.
  const flats: THREE.BufferGeometry[] = [];
  const flat = (x0: number, z0: number, x1: number, z1: number, y: number, color: number): void => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
    flats.push(g);
  };
  // The field (short grass), the runway, the taxiway and its links, the apron.
  flat(X0, Z0, X1, Z1, 0.02, 0x3a4630);
  flat(RWY.x0, RWY.z - RWY.half, RWY.x1, RWY.z + RWY.half, 0.05, 0x2c2c30);
  flat(RWY.x0 + 60, TWY.z - TWY.half, RWY.x1 - 60, TWY.z + TWY.half, 0.05, 0x323236);
  for (const x of [RWY.x0 + 70, (RWY.x0 + RWY.x1) / 2, RWY.x1 - 70]) flat(x - TWY.half, TWY.z, x + TWY.half, RWY.z, 0.05, 0x323236);
  flat(1030, Z0 + 2, 1190, APRON_Z + 22, 0.055, 0x5a5a5c);
  // Runway markings: the centreline, the threshold bars, the touchdown zone, the numbers' blocks.
  const paint = (x0: number, z0: number, x1: number, z1: number): void => flat(x0, z0, x1, z1, 0.07, 0xe8e8e0);
  for (let x = RWY.x0 + 90; x < RWY.x1 - 90; x += 50) paint(x, RWY.z - 0.45, x + 30, RWY.z + 0.45);
  for (const [xa, dir] of [[RWY.x0 + 6, 1], [RWY.x1 - 6, -1]] as const) {
    for (let k = -7; k <= 7; k++) if (k !== 0) paint(Math.min(xa, xa + dir * 30), RWY.z + k * 2.6 - 0.9, Math.max(xa, xa + dir * 30), RWY.z + k * 2.6 + 0.9);
    for (const off of [150, 300]) for (const s of [-1, 1]) paint(Math.min(xa + dir * off, xa + dir * (off + 22)), RWY.z + s * 9 - 1.6, Math.max(xa + dir * off, xa + dir * (off + 22)), RWY.z + s * 9 + 1.6);
  }
  for (const s of [-1, 1]) paint(RWY.x0, RWY.z + s * (RWY.half - 1) - 0.4, RWY.x1, RWY.z + s * (RWY.half - 1) + 0.4);
  const ground = new THREE.Mesh(mergeGeometries(flats)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  ground.receiveShadow = true;
  group.add(ground);
  // Lights: runway edges (white), taxiway edges (blue), approach lights over the water west of the runway.
  const lights: { x: number; z: number; y: number; c: THREE.Color }[] = [];
  for (let x = RWY.x0; x <= RWY.x1; x += 40) for (const s of [-1, 1]) lights.push({ x, z: RWY.z + s * (RWY.half + 1), y: 0.4, c: new THREE.Color(3, 2.9, 2.5) });
  for (let k = -7; k <= 7; k++) lights.push({ x: RWY.x0 - 2, z: RWY.z + k * 3, y: 0.4, c: new THREE.Color(0.3, 3, 0.5) });
  for (let x = RWY.x0 + 60; x <= RWY.x1 - 60; x += 30) for (const s of [-1, 1]) lights.push({ x, z: TWY.z + s * (TWY.half + 1), y: 0.3, c: new THREE.Color(0.4, 0.7, 3.2) });
  const posts: { x: number; y: number; z: number; w: number; h: number }[] = [];
  // The approach lights: a bar of five on a post every 30 m; the middle one of each is the sequenced strobe.
  const approachAt: THREE.Vector3[] = [];
  for (let k = 1; k <= 12; k++) {
    const x = RWY.x0 - k * 30;
    posts.push({ x, y: 0, z: RWY.z, w: 0.4, h: 4 });
    for (const dz of [-4, -2, 2, 4]) lights.push({ x, z: RWY.z + dz, y: 2, c: new THREE.Color(2.4, 2.3, 2.0) });
    approachAt.push(new THREE.Vector3(x, 2, RWY.z));
  }
  const bulb = new THREE.SphereGeometry(0.45, 6, 4);
  const bulbs = new THREE.InstancedMesh(bulb, new THREE.MeshBasicMaterial(), lights.length);
  const m4 = new THREE.Matrix4();
  lights.forEach((L, i) => {
    bulbs.setMatrixAt(i, m4.makeTranslation(L.x, L.y, L.z));
    bulbs.setColorAt(i, L.c);
  });
  bulbs.computeBoundingSphere();
  group.add(bulbs);
  const approach = new THREE.InstancedMesh(bulb, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.3, 2.0) }), approachAt.length);
  approachAt.forEach((p, i) => approach.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  approach.computeBoundingSphere();
  group.add(approach);
  // The perimeter fence along the landside (posts and rails; the fence itself reads as a haze of wire).
  const fence = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.6, transparent: true, opacity: 0.35 });
  const fz = Z0 + 1;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, 3), fence);
  mesh.position.set((X0 + X1) / 2, 1.5, fz);
  group.add(mesh);
  for (let x = X0; x <= X1; x += 6) posts.push({ x, y: 1.6, z: fz, w: 0.12, h: 3.2 });
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x6a6e72, roughness: 0.8 }), posts.length);
  posts.forEach((p, i) => postMesh.setMatrixAt(i, m4.makeScale(p.w, p.h, p.w).setPosition(p.x, p.y, p.z)));
  postMesh.computeBoundingSphere();
  group.add(postMesh);
  for (const o of [ground, bulbs, approach, mesh, postMesh]) {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  }
  // Airliners at the stands, their jet bridges out from the terminal.
  const TAILS = [0x1a4aa0, 0xc8201a, 0x1a8a6a, 0xe8a020];
  STANDS.forEach((x, i) => {
    const a = plane(i + 1, TAILS[i % TAILS.length]);
    a.group.position.set(x, 0, APRON_Z);
    a.landing.visible = false;
    group.add(a.group);
    const jb = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 34), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.5 }));
    jb.position.set(x - 5, 4.5, APRON_Z + 26);
    group.add(jb);
  });

  // The traffic: an arrival and a departure on one 150 s cycle.
  const arrival = plane(0, 0x1a4aa0);
  const departure = plane(2, 0xc8201a);
  group.add(arrival.group, departure.group);
  const CYCLE = 150;
  const TOUCH = RWY.x0 + 300;
  const GLIDE = Math.tan((3 * Math.PI) / 180);
  let t = 20;
  let strobeT = 0;
  const pose = (a: ReturnType<typeof airliner>, x: number, y: number, z: number, heading: number, pitch: number, bank: number): void => {
    a.group.position.set(x, y, z);
    a.group.rotation.set(0, 0, 0);
    a.group.rotateY(heading);
    a.group.rotateX(-pitch);
    a.group.rotateZ(bank);
  };
  return {
    group,
    update(dt, night) {
      t = (t + dt) % CYCLE;
      strobeT += dt;
      // Arrival: 70 m/s down the glide slope out of the west, touchdown, and the rollout to taxi speed.
      const tTouch = 80;
      if (t < tTouch) {
        const x = TOUCH - (tTouch - t) * 70;
        pose(arrival, x, (TOUCH - x) * GLIDE, RWY.z, Math.PI / 2, 0.05, 0);
        arrival.group.visible = true;
        arrival.landing.visible = true;
      } else if (t < tTouch + 30) {
        const s = t - tTouch;
        const x = TOUCH + 70 * s - 1.1 * s * s;
        pose(arrival, Math.min(x, RWY.x1 - 150), 0, RWY.z, Math.PI / 2, 0, 0);
        arrival.landing.visible = s < 20;
      } else arrival.group.visible = false;
      // Departure (half a cycle on): the roll from the west end, rotation, and the climb out turning south.
      const d = (t + CYCLE / 2) % CYCLE;
      if (d < 70) {
        const roll = Math.min(d, 26);
        const x0 = RWY.x0 + 40 + 1.5 * roll * roll;
        const air = Math.max(0, d - 26);
        const v = 78;
        const turn = Math.min(1, air / 30) * 0.9;
        const heading = Math.PI / 2 - turn * 0.9;
        const x = x0 + air * v * Math.cos(turn * 0.45);
        const z = RWY.z + air * air * 0.9 * turn;
        const y = air * 11;
        pose(departure, x, y, z, heading, air > 0 ? 0.14 : 0, air > 0 ? -turn * 0.35 : 0);
        departure.group.visible = true;
        departure.landing.visible = air < 12;
      } else departure.group.visible = false;
      // Night: windows and strobes; the approach lights' "rabbit" running in toward the runway twice a second.
      const flash = strobeT % 1.2 < 0.08;
      for (const a of [arrival, departure]) {
        for (const s of a.strobes) s.visible = flash;
        a.beacon.visible = strobeT % 1.0 < 0.5;
        (a.windows.material as THREE.MeshBasicMaterial).color.setHex(night ? 0xffe0a0 : 0x2a3036);
      }
      const k = Math.floor((strobeT * 24) % approachAt.length);
      approachAt.forEach((p, i) => {
        const sc = night && i === approachAt.length - 1 - k ? 2.6 : 1;
        approach.setMatrixAt(i, m4.makeScale(sc, sc, sc).setPosition(p));
      });
      approach.instanceMatrix.needsUpdate = true;
    },
  };
}
