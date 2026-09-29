import * as THREE from 'three';
import type { Expressway, Road } from '../district/expressway';
import { addCar } from './cars';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * The expressway's look and its traffic (the layout is district/expressway.ts). One merged mesh on the city
 * material (so rain wets it and fog takes it): the deck (asphalt, lane lines), its underside and edges, a
 * parapet with a rail wherever an edge is a wall (not where roads merge), piers with crossbeams, sodium lamps
 * on the parapet every 40 m (their heads glowing, and orange pools of light on the deck), green gantry signs
 * before the ramps and exits, and a tunnel portal at the end of each exit spur. Traffic: cars on the loop in
 * both lanes, each keeping its distance (the Intelligent Driver Model, as in the street's traffic), slowing
 * for the corners and for your car.
 */

type V3 = [number, number, number];

const CONCRETE = 0x8a8a84;
const UNDER = 0x3a3a38;

export interface ExpresswayView {
  readonly group: THREE.Group;
}

export function buildExpressway(ex: Expressway, city: THREE.Material): ExpresswayView {
  const group = new THREE.Group();
  const mb = new MeshBuilder(1 << 18);
  mb.style = [0, 0, 0, 0];
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3): void => mb.quadN(a, b, c, d, n, n, n, n);
  const box = (hex: number, cx: number, cz: number, y0: number, y1: number, w: number, d: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    mb.box(cx, cz, y0, y1, w, d, KIND.plain, true);
  };
  const pools: { x: number; z: number; y: number }[] = [];
  const lampHeads: { x: number; z: number; y: number; ox: number; oz: number }[] = [];
  for (const road of ex.roads) {
    const n = road.x.length;
    const segs = road.closed ? n : n - 1;
    const L = (i: number, lat: number, dy = 0): V3 => [road.x[i] + road.tz[i] * lat, road.y[i] + dy, road.z[i] - road.tx[i] * lat];
    for (let k = 0; k < segs; k++) {
      const i = k;
      const j = (k + 1) % n;
      const h = road.half;
      // The deck: asphalt on top, dark underneath.
      mb.kind = KIND.asphalt;
      mb.color = lin(0x2c2c30);
      quad(L(i, h), L(j, h), L(j, -h), L(i, -h), [0, 1, 0]);
      mb.kind = KIND.plain;
      mb.color = lin(UNDER);
      quad(L(i, h, -1.2), L(i, -h, -1.2), L(j, -h, -1.2), L(j, h, -1.2), [0, -1, 0]);
      // Lane lines: solid at the edges, a dashed divider on the loop.
      mb.kind = KIND.paint;
      mb.color = lin(0xe8e8e0);
      for (const lat of [h - 0.9, -(h - 0.9)]) quad(L(i, lat + 0.08, 0.02), L(j, lat + 0.08, 0.02), L(j, lat - 0.08, 0.02), L(i, lat - 0.08, 0.02), [0, 1, 0]);
      if (road.kind === 'loop' && k % 12 < 6) quad(L(i, 0.08, 0.02), L(j, 0.08, 0.02), L(j, -0.08, 0.02), L(i, -0.08, 0.02), [0, 1, 0]);
      // Each edge: a wall (a parapet with a rail) unless another road carries on past it (a merge).
      for (const s of [1, -1]) {
        const lat = s * h;
        const pa = L(i, lat);
        const pb = L(j, lat);
        const merged = ex.insideOther(road, pa[0] + road.tz[i] * s * 0.4, pa[2] - road.tx[i] * s * 0.4, pa[1]);
        const nx = road.tz[i] * s;
        const nz = -road.tx[i] * s;
        if (merged) continue;
        mb.kind = KIND.plain;
        mb.color = lin(CONCRETE);
        const top = 1.05;
        const t = 0.25;
        // Outer face, down to the underside; inner face; top.
        const o = (p: V3, dy: number, off: number): V3 => [p[0] + nx * off, p[1] + dy, p[2] + nz * off];
        quad(o(pa, -1.2, t), o(pb, -1.2, t), o(pb, top, t), o(pa, top, t), [nx, 0, nz]);
        quad(o(pa, 0, 0), o(pa, top, 0), o(pb, top, 0), o(pb, 0, 0), [-nx, 0, -nz]);
        quad(o(pa, top, 0), o(pa, top, t), o(pb, top, t), o(pb, top, 0), [0, 1, 0]);
        // The steel rail on top, and a line of reflectors at wheel height.
        mb.kind = KIND.chrome;
        mb.color = lin(0x9aa0a6);
        quad(o(pa, top + 0.15, 0.05), o(pb, top + 0.15, 0.05), o(pb, top + 0.25, 0.05), o(pa, top + 0.25, 0.05), [-nx, 0, -nz]);
        if (k % 8 === 0) {
          mb.kind = KIND.emit;
          mb.style = [EMIT.lamp, 0, 0, 0];
          mb.color = s > 0 ? [0.35, 0.18, 0.03] : [0.3, 0.3, 0.3];
          const pm: V3 = [(pa[0] + pb[0]) / 2, pa[1], (pa[2] + pb[2]) / 2];
          quad(o(pa, 0.5, -0.02), o(pa, 0.58, -0.02), o(pm, 0.58, -0.02), o(pm, 0.5, -0.02), [-nx, 0, -nz]);
          mb.style = [0, 0, 0, 0];
        }
        // Sodium lamps along the outside (left) parapet every 40 m, the arm reaching over the lanes.
        if (s > 0 && k % 40 === 20) lampHeads.push({ x: pa[0], z: pa[2], y: pa[1], ox: -nx, oz: -nz });
      }
    }
    // The ends of a ramp or spur: close the deck's edge.
    if (!road.closed) {
      for (const i of [0, n - 1]) {
        const s = i === 0 ? -1 : 1;
        mb.kind = KIND.plain;
        mb.color = lin(CONCRETE);
        const h = road.half;
        quad(L(i, h, -1.2), L(i, -h, -1.2), L(i, -h), L(i, h), [road.tx[i] * s, 0, road.tz[i] * s]);
      }
    }
    if (road.kind === 'spur') portal(mb, road);
    if (road.kind === 'ramp') ramp(mb, road, box);
  }
  // Piers with crossbeams under the deck (the street's colliders are the same piers, less those in junctions).
  for (const p of ex.piers()) {
    const cell = 128;
    const nearJ = Math.hypot(p.x - Math.round(p.x / cell) * cell, p.z - Math.round(p.z / cell) * cell) < 20;
    if (nearJ) continue;
    box(CONCRETE, p.x, p.z, 0, p.top, 1.4, 1.4);
    const road = ex.loop;
    // The beam across the deck: its long side across the road here.
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < road.x.length; i += 4) {
      const d = Math.hypot(road.x[i] - p.x, road.z[i] - p.z);
      if (d < bd) [best, bd] = [i, d];
    }
    const across = Math.abs(road.tx[best]) > 0.7;
    box(CONCRETE, p.x, p.z, p.top - 1.2, p.top, across ? 1.6 : ex.def.half * 2 + 1, across ? ex.def.half * 2 + 1 : 1.6);
  }
  for (const L of lampHeads) {
    // The pole on the parapet, the arm, the head (a sodium lamp: orange, on at night).
    box(0x5a5e62, L.x, L.z, L.y + 1.05, L.y + 8, 0.2, 0.2);
    const hx = L.x + L.ox * 2.6;
    const hz = L.z + L.oz * 2.6;
    box(0x5a5e62, (L.x + hx) / 2, (L.z + hz) / 2, L.y + 7.9, L.y + 8.05, Math.abs(L.ox) > 0.5 ? 2.6 : 0.15, Math.abs(L.oz) > 0.5 ? 2.6 : 0.15);
    mb.kind = KIND.emit;
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = [2.4, 1.1, 0.3];
    mb.box(hx, hz, L.y + 7.6, L.y + 7.9, 0.7, 0.7, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
    pools.push({ x: hx, z: hz, y: L.y });
  }
  // Gantry signs over the deck before each exit (green, white lettering), and at street level a sign before
  // each entrance, on the avenue's median.
  for (const road of ex.roads) {
    if (road.kind === 'loop') continue;
    if (road.rampKind === 'on') {
      group.add(entranceSign(road));
      continue;
    }
    const text = road.kind === 'spur' ? [`${road.sign}`, 'TUNNEL · 直進'] : [`出口 EXIT`, `${road.sign}`];
    group.add(gantry(road, 0, text, ex));
  }
  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  group.add(mesh);
  // Pools of sodium light on the deck (additive decals), shown at night with the lamps.
  const pool = poolTexture();
  const pm = new THREE.MeshBasicMaterial({ map: pool, color: new THREE.Color(0.26, 0.12, 0.03), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const pg = new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2);
  const pools3 = new THREE.InstancedMesh(pg, pm, pools.length);
  const m4 = new THREE.Matrix4();
  pools.forEach((p, i) => pools3.setMatrixAt(i, m4.makeTranslation(p.x, p.y + 0.04, p.z)));
  pools3.frustumCulled = false;
  pools3.name = 'sodium';
  group.add(pools3);
  return { group };
}

/**
 * A ramp's solid part: where it's too low to walk or drive under (below 5.2 m), a filled embankment between
 * retaining walls, down to the street; above that, on piers. Where an exit ramp's embankment starts, facing
 * the street traffic coming along the lane under it, a yellow-and-black crash cushion.
 */
function ramp(mb: MeshBuilder, road: Road, box: (hex: number, cx: number, cz: number, y0: number, y1: number, w: number, d: number) => void): void {
  const n = road.x.length;
  const h = road.half;
  const L = (i: number, lat: number, y: number): V3 => [road.x[i] + road.tz[i] * lat, y, road.z[i] - road.tx[i] * lat];
  const LOW = 5.2;
  mb.kind = KIND.plain;
  mb.color = lin(CONCRETE);
  for (let i = 0; i + 1 < n; i++) {
    const ya = road.y[i];
    const yb = road.y[i + 1];
    if (Math.min(ya, yb) >= LOW) continue;
    for (const s of [1, -1]) {
      const nx = road.tz[i] * s;
      const nz = -road.tx[i] * s;
      const n3: V3 = [nx, 0, nz];
      mb.quadN(L(i, s * (h + 0.25), 0), L(i + 1, s * (h + 0.25), 0), L(i + 1, s * (h + 0.25), yb), L(i, s * (h + 0.25), ya), n3, n3, n3, n3);
    }
  }
  // Piers under the high part.
  for (let i = 12; i < n; i += 24) if (road.y[i] > LOW) box(CONCRETE, road.x[i], road.z[i], 0, road.y[i] - 1.2, 1.1, 1.1);
  // The end of the embankment that faces the street's oncoming traffic (an off-ramp's, where it drops below
  // the clearance): a concrete face and a striped cushion.
  if (road.rampKind === 'off') {
    let i = 0;
    while (i < n - 1 && road.y[i] >= LOW) i++;
    const y = road.y[i];
    mb.kind = KIND.plain;
    mb.color = lin(CONCRETE);
    const back: V3 = [-road.tx[i], 0, -road.tz[i]];
    mb.quadN(L(i, h + 0.25, 0), L(i, -h - 0.25, 0), L(i, -h - 0.25, y), L(i, h + 0.25, y), back, back, back, back);
    const cx = road.x[i] - road.tx[i] * 0.6;
    const cz = road.z[i] - road.tz[i] * 0.6;
    for (let k = 0; k < 5; k++) {
      mb.kind = KIND.gloss;
      mb.color = lin(k % 2 ? 0x141414 : 0xe8c020);
      mb.box(cx, cz, 0.15 + k * 0.22, 0.37 + k * 0.22, Math.abs(road.tz[i]) * 2.8 + Math.abs(road.tx[i]) * 1.0, Math.abs(road.tx[i]) * 2.8 + Math.abs(road.tz[i]) * 1.0, KIND.gloss, true);
    }
    // Amber flashers on top (lamps: bright at night).
    mb.kind = KIND.emit;
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = [2.0, 1.1, 0.1];
    mb.box(cx, cz, 1.3, 1.5, 0.25, 0.25, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  }
}

/**
 * At street level before an entrance, on the avenue's median: 東都高速 入口 with the district and an arrow up
 * the ramp (the expressway's green, on a post), facing the traffic coming.
 */
function entranceSign(road: Road): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const cg = c.getContext('2d')!;
  cg.fillStyle = '#0e6a3a';
  cg.fillRect(0, 0, 512, 384);
  cg.strokeStyle = '#f0f0f0';
  cg.lineWidth = 7;
  cg.strokeRect(8, 8, 496, 368);
  cg.fillStyle = '#f4f4f0';
  cg.textAlign = 'center';
  cg.font = "bold 68px 'Yu Gothic', 'Meiryo', sans-serif";
  cg.fillText('東都高速 入口', 256, 96);
  cg.font = 'bold 40px Consolas, sans-serif';
  cg.fillText('EXPRESSWAY', 256, 150);
  cg.font = "bold 44px 'Yu Gothic', sans-serif";
  cg.fillText(road.sign ?? '', 256, 216);
  // The arrow: ahead and up (the ramp rises from the lane by the median).
  cg.beginPath();
  cg.moveTo(256, 250);
  cg.lineTo(316, 310);
  cg.lineTo(280, 310);
  cg.lineTo(280, 364);
  cg.lineTo(232, 364);
  cg.lineTo(232, 310);
  cg.lineTo(196, 310);
  cg.closePath();
  cg.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.9, 0.9, 0.9) }));
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.5, roughness: 0.5 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.6, 0.16), steel);
  post.position.set(0, 1.8, 0);
  sign.position.set(0, 3.3, -0.1);
  sign.rotation.y = Math.PI;
  g.add(post, sign);
  // 22 m before the ramp's foot, on the median (5.9 m to the ramp's right, i.e. the avenue's centre line).
  const back = 22;
  const lat = -(road.half + 4.6 - 0.6);
  g.position.set(road.x[0] - road.tx[0] * back + road.tz[0] * lat, 0.18, road.z[0] - road.tz[0] * back - road.tx[0] * lat);
  g.rotation.y = Math.atan2(road.tx[0], road.tz[0]);
  return g;
}

/** A tunnel portal at a spur's end: a concrete headwall round a dark mouth, lamps inside, the name over it. */
function portal(mb: MeshBuilder, road: Road): void {
  const n = road.x.length;
  const i = n - 1;
  const fx = road.tx[i];
  const fz = road.tz[i];
  const lx = road.tz[i];
  const lz = -road.tx[i];
  const y = road.y[i];
  const at = (along: number, lat: number): [number, number] => [road.x[i] + fx * along + lx * lat, road.z[i] + fz * along + lz * lat];
  const put = (hex: number, a0: number, a1: number, l0: number, l1: number, y0: number, y1: number, kind: number = KIND.plain): void => {
    const [x0, z0] = at(a0, l0);
    const [x1, z1] = at(a1, l1);
    mb.kind = kind;
    mb.color = lin(hex);
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, Math.abs(x1 - x0), Math.abs(z1 - z0), kind, true);
  };
  const h = road.half + 1.5;
  // The headwall and the tube behind (a long box: the mountain it bores into is far away).
  put(0x6a6a66, -14, 0, -h, h, y + 6.5, y + 9);
  put(0x6a6a66, -14, 0, -h - 1.2, -h, y - 1.2, y + 9);
  put(0x6a6a66, -14, 0, h, h + 1.2, y - 1.2, y + 9);
  // The mouth: a black back wall deep inside, and lights along the tube's walls fading into it.
  put(0x050506, 0.2, 1.2, -h, h, y - 1.2, y + 6.5);
  for (let a = -12; a < 0; a += 3) {
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    for (const s of [-1, 1]) {
      const [x, z] = at(a, s * (h - 0.1));
      mb.color = [1.6, 1.2, 0.5];
      mb.box(x, z, y + 4.6, y + 4.8, 0.6, 0.6, KIND.emit, true);
    }
    mb.style = [0, 0, 0, 0];
  }
}

/** A green gantry sign over a road near sample i: two posts, a beam, the sign (canvas) facing the traffic. */
function gantry(road: Road, i: number, lines: string[], ex: Expressway): THREE.Group {
  const g = new THREE.Group();
  const loop = ex.loop;
  // Stand it on the loop 120 m before the fork, facing the traffic coming.
  let best = 0;
  let bd = Infinity;
  for (let k = 0; k < loop.x.length; k++) {
    const d = Math.hypot(loop.x[k] - road.x[i], loop.z[k] - road.z[i]);
    if (d < bd) [best, bd] = [k, d];
  }
  const k = (best - 120 + loop.x.length) % loop.x.length;
  const x = loop.x[k];
  const z = loop.z[k];
  const y = loop.y[k];
  const heading = Math.atan2(loop.tx[k], loop.tz[k]);
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 300;
  const cg = c.getContext('2d')!;
  cg.fillStyle = '#0e6a3a';
  cg.fillRect(0, 0, 1024, 300);
  cg.strokeStyle = '#f0f0f0';
  cg.lineWidth = 8;
  cg.strokeRect(10, 10, 1004, 280);
  cg.fillStyle = '#f4f4f0';
  cg.textAlign = 'center';
  cg.font = "bold 96px 'Yu Gothic', 'Meiryo', sans-serif";
  cg.fillText(lines[0], 512, 130);
  cg.font = 'bold 64px Consolas, sans-serif';
  cg.fillText(lines[1], 512, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.1), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.9, 0.9, 0.9) }));
  const w = ex.def.half + 0.6;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.5, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7.5, 0.3), steel);
    post.position.set(s * w, 3.75, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.3, 0.4, 0.4), steel);
  beam.position.set(0, 7.4, 0);
  g.add(beam);
  // The sign over the outside (left) lane; the car travels +z in the group's frame, so it faces -z.
  sign.position.set(1.8, 6.1, -0.25);
  sign.rotation.y = Math.PI;
  g.add(sign);
  g.position.set(x, y, z);
  g.rotation.y = heading;
  return g;
}

let poolTex: THREE.CanvasTexture | null = null;
function poolTexture(): THREE.CanvasTexture {
  if (poolTex) return poolTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  poolTex = new THREE.CanvasTexture(c);
  return poolTex;
}

/**
 * Traffic on the loop: cars in both lanes (left +1.8 m, right -1.8 m of the centre), each following the car
 * ahead in its lane with the Intelligent Driver Model, slowing for the corners ahead, and for your car when
 * it's on the deck in their lane.
 */
export class ExpresswayTraffic {
  readonly group = new THREE.Group();
  private readonly cars: { mesh: THREE.Mesh; s: number; v: number; lane: number; v0: number }[] = [];
  private readonly L: number;
  /** Curvature (rad per m) of the loop at each sample, smoothed over 30 m ahead (for slowing down). */
  private readonly bend: Float32Array;

  constructor(
    private readonly ex: Expressway,
    city: THREE.Material,
    count = 22,
  ) {
    const loop = ex.loop;
    this.L = loop.x.length;
    this.bend = new Float32Array(this.L);
    for (let i = 0; i < this.L; i++) {
      let t = 0;
      for (let k = 0; k < 40; k += 5) {
        const a = (i + k) % this.L;
        const b = (i + k + 5) % this.L;
        t = Math.max(t, Math.acos(Math.min(1, loop.tx[a] * loop.tx[b] + loop.tz[a] * loop.tz[b])) / 5);
      }
      this.bend[i] = t;
    }
    const types = ['sedan', 'sedan', 'kei', 'minivan', 'taxi', 'sedan'] as const;
    const paints = [0xe8e8e4, 0x1a1a1c, 0x8a8e94, 0x2a3a5a, 0x7a1a1a, 0xc8c0b0];
    const geos = types.map((type, k) => {
      const mb = new MeshBuilder();
      addCar(mb, { x: 0, z: 0, fx: 0, fz: 1, variant: 700 + k, type, ...(type === 'taxi' || type === 'kei' ? {} : { paint: paints[k % paints.length] }) });
      // Tail lights, lit (the loop at night is a river of them).
      mb.kind = KIND.emit;
      mb.style = [EMIT.lamp, 0, 0, 0];
      mb.color = [0.6, 0.02, 0.01];
      for (const sd of [-1, 1]) mb.box(sd * 0.6, -2.36, 0.78, 0.9, 0.3, 0.03, KIND.emit, true);
      mb.color = [0.6, 0.58, 0.5];
      for (const sd of [-1, 1]) mb.box(sd * 0.6, 2.37, 0.62, 0.74, 0.3, 0.03, KIND.emit, true);
      return mb.build()!;
    });
    for (let k = 0; k < count; k++) {
      const mesh = new THREE.Mesh(geos[k % geos.length], city);
      this.group.add(mesh);
      this.cars.push({ mesh, s: (this.L * k) / count, v: 18, lane: k % 2 ? -1.8 : 1.8, v0: 17 + ((k * 37) % 10) });
    }
  }

  /** Where each car is (for your car's collisions): centre, heading, half length and width. */
  get obstacles(): { x: number; z: number; dx: number; dz: number; half: number; hw: number; vx: number; vz: number }[] {
    const loop = this.ex.loop;
    return this.cars.map((c) => {
      const i = Math.floor(c.s) % this.L;
      return { x: c.mesh.position.x, z: c.mesh.position.z, dx: loop.tx[i], dz: loop.tz[i], half: 2.3, hw: 0.9, vx: loop.tx[i] * c.v, vz: loop.tz[i] * c.v };
    });
  }

  /** You on the loop: your place along it (samples), your lane offset and speed; null off it. */
  update(dt: number, you: { i: number; lateral: number; v: number } | null): void {
    const loop = this.ex.loop;
    const L = this.L;
    const ahead = (a: number, b: number): number => (((b - a) % L) + L) % L;
    for (const c of this.cars) {
      // The nearest thing ahead in this lane: another car, or you.
      let gap = Infinity;
      let lead = 0;
      for (const o of this.cars) {
        if (o === c || o.lane !== c.lane) continue;
        const d = ahead(c.s, o.s);
        if (d > 0 && d < gap) [gap, lead] = [d, o.v];
      }
      if (you && Math.abs(you.lateral - c.lane) < 2.2) {
        const d = ahead(c.s, you.i);
        if (d > 0 && d < gap) [gap, lead] = [d, Math.max(0, you.v)];
      }
      gap -= 4.6;
      // A comfortable speed for the bend ahead, and the IDM toward it and the leader.
      const b = this.bend[Math.floor(c.s) % L];
      const vBend = b > 0.004 ? Math.sqrt(4.5 / b) : 99;
      const v0 = Math.min(c.v0, vBend);
      const a = 2.0;
      const bb = 3.0;
      const sStar = 2.5 + Math.max(0, c.v * 1.3 + (c.v * (c.v - lead)) / (2 * Math.sqrt(a * bb)));
      const acc = a * (1 - (c.v / Math.max(v0, 1)) ** 4 - (gap === Infinity - 4.6 ? 0 : (sStar / Math.max(gap, 0.3)) ** 2));
      c.v = Math.max(0, c.v + Math.max(-9, acc) * dt);
      c.s = (c.s + c.v * dt) % L;
      const i = Math.floor(c.s) % L;
      const j = (i + 1) % L;
      const f = c.s - Math.floor(c.s);
      const x = loop.x[i] + (loop.x[j] - loop.x[i]) * f + loop.tz[i] * c.lane;
      const z = loop.z[i] + (loop.z[j] - loop.z[i]) * f - loop.tx[i] * c.lane;
      c.mesh.position.set(x, loop.y[i], z);
      c.mesh.rotation.y = Math.atan2(loop.tx[i], loop.tz[i]);
    }
  }
}
