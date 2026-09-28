import * as THREE from 'three';
import type { Course } from './course';

/**
 * The venue's scenery from its course: the hillside (coloured by slope: forest floor, rock, the gravel
 * shoulders), the road (tarmac, white edge lines, the yellow centre line of a Japanese pass), guardrails on
 * posts with reflectors, a cedar forest, the practice lot (floodlit, cones, a painted drift circle, tyre
 * walls), the viewpoint at the top (a vending machine glowing), and the night: moon, stars, fog.
 */
export interface VenueScene {
  readonly group: THREE.Group;
  /** Lights that stay on (floodlights, lamps): positions for the headlight-free glow. */
  readonly stars: THREE.Points;
}

const TARMAC = new THREE.Color(0x3a3a40);
const SHOULDER = new THREE.Color(0x5a5448);

/** A seeded random (the scenery comes out the same every time). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function buildVenue(course: Course): VenueScene {
  const group = new THREE.Group();
  const n = course.x.length;
  const half = course.half;
  const rail = course.rail;
  const L = (i: number, d: number, up = 0): THREE.Vector3 =>
    new THREE.Vector3(course.x[i] + course.tz[i] * d, course.y[i] + up, course.z[i] - course.tx[i] * d);

  // ---- The hillside: a 3 m grid, coloured by slope and height (forest floor, rock), lower near the road.
  const b = course.bounds;
  const S = 3;
  const W = Math.ceil((b.maxX - b.minX) / S) + 1;
  const H = Math.ceil((b.maxZ - b.minZ) / S) + 1;
  const pos = new Float32Array(W * H * 3);
  const col = new Float32Array(W * H * 3);
  const rand = rng(7);
  const c = new THREE.Color();
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = b.minX + i * S;
      const z = b.minZ + j * S;
      const y = course.height(x, z);
      const k = (j * W + i) * 3;
      pos[k] = x;
      pos[k + 1] = y - 0.06;
      pos[k + 2] = z;
      const [, ny] = course.normal(x, z);
      const steep = 1 - ny;
      const near = course.nearest(x, z);
      const onEdge = near.i >= 0 && Math.abs(near.d) < rail + 2.5;
      if (course.inLot(x, z)) c.setHex(0x1e1e22);
      else if (onEdge) c.copy(SHOULDER);
      else if (steep > 0.2) c.setRGB(0.2, 0.19, 0.18);
      else c.setRGB(0.07 + rand() * 0.03, 0.1 + rand() * 0.04, 0.06);
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j + 1 < H; j++) {
    for (let i = 0; i + 1 < W; i++) {
      const a = j * W + i;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.receiveShadow = true;
  group.add(terrain);

  // ---- The road: tarmac and shoulders as one ribbon (strips across it), then the painted lines.
  const ribbon = (offsets: readonly number[], colors: readonly THREE.Color[], lift: number, from = 0, to = n - 1, step = 1): THREE.BufferGeometry => {
    const p: number[] = [];
    const cc: number[] = [];
    const ix: number[] = [];
    const m = offsets.length;
    let row = 0;
    for (let i = from; i <= to; i += step) {
      for (let q = 0; q < m; q++) {
        const v = L(i, offsets[q], lift);
        p.push(v.x, v.y, v.z);
        cc.push(colors[q].r, colors[q].g, colors[q].b);
      }
      if (row > 0) for (let q = 0; q + 1 < m; q++) {
        const a = (row - 1) * m + q;
        const d = row * m + q;
        ix.push(a, a + 1, d, a + 1, d + 1, d);
      }
      row++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    return g;
  };
  const road = new THREE.Mesh(
    ribbon([rail + 0.6, half, -half, -rail - 0.6], [SHOULDER, TARMAC, TARMAC, SHOULDER], 0.02),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05, side: THREE.DoubleSide }),
  );
  road.receiveShadow = true;
  group.add(road);
  const paint = (hex: number, glow = 0.12): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, emissive: hex, emissiveIntensity: glow, side: THREE.DoubleSide });
  const white = [new THREE.Color(0xffffff), new THREE.Color(0xffffff)];
  for (const s of [1, -1]) group.add(new THREE.Mesh(ribbon([s * (half - 0.2), s * (half - 0.35)], white, 0.03), paint(0xe8e8e0, 0.06)));
  group.add(new THREE.Mesh(ribbon([0.1, -0.1], white, 0.03, 20, n - 25), paint(0xe8b820, 0.08)));

  // ---- Guardrails: posts every 4 m, a steel rail, reflectors every 16 m (orange on the left, white on the right).
  const first = 14;
  const last = n - 22;
  const postGeo = new THREE.BoxGeometry(0.1, 0.85, 0.1).translate(0, 0.42, 0);
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x9a9ca0, metalness: 0.6, roughness: 0.4 }), 2 * Math.ceil((last - first) / 4) + 2);
  const reflect = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }), 2 * Math.ceil((last - first) / 16) + 2);
  const m4 = new THREE.Matrix4();
  let pc = 0;
  let rc = 0;
  for (let i = first; i <= last; i += 4) {
    for (const s of [1, -1]) {
      const v = L(i, s * rail, 0);
      v.y = course.height(v.x, v.z);
      m4.makeRotationY(Math.atan2(course.tx[i], course.tz[i])).setPosition(v);
      posts.setMatrixAt(pc++, m4);
      if ((i - first) % 16 === 0) {
        m4.makeRotationY(Math.atan2(course.tx[i], course.tz[i])).setPosition(v.x, v.y + 0.9, v.z);
        reflect.setMatrixAt(rc, m4);
        reflect.setColorAt(rc++, new THREE.Color(s > 0 ? 0xffa030 : 0xffffff).multiplyScalar(1.6));
      }
    }
  }
  posts.count = pc;
  reflect.count = rc;
  group.add(posts, reflect);
  for (const s of [1, -1]) {
    const p: number[] = [];
    const ix: number[] = [];
    let row = 0;
    for (let i = first; i <= last; i++) {
      const v = L(i, s * rail, 0);
      const gy = course.height(v.x, v.z);
      p.push(v.x, gy + 0.5, v.z, v.x, gy + 0.78, v.z);
      if (row > 0) {
        const a = (row - 1) * 2;
        ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      row++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide })));
  }

  // ---- The lot: markings, a drift circle, a slalom of cones, tyre walls, floodlights.
  const lot = course.def.lot;
  const lines = new THREE.Group();
  const line = (x0: number, z0: number, x1: number, z1: number, w = 0.15): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2), paint(0xe8e8e0, 0.15));
    m.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
    m.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    lines.add(m);
  };
  for (let x = lot.x + 6; x < lot.x + 60; x += 3) line(x, lot.z + lot.h - 12, x, lot.z + lot.h - 2);
  const ring = new THREE.Mesh(new THREE.RingGeometry(17.8, 18.2, 96).rotateX(-Math.PI / 2), paint(0xe8e8e0, 0.15));
  ring.position.set(lot.x + lot.w * 0.68, 0.012, lot.z + lot.h * 0.55);
  lines.add(ring);
  group.add(lines);
  const coneGeo = new THREE.ConeGeometry(0.22, 0.7, 12).translate(0, 0.35, 0);
  const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0xff5a1a, roughness: 0.6, emissive: 0x401000 }), 40);
  let cn = 0;
  for (let k = 0; k < 8; k++) cones.setMatrixAt(cn++, m4.makeTranslation(lot.x + 20 + k * 11, 0, lot.z + lot.h * 0.3));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    cones.setMatrixAt(cn++, m4.makeTranslation(ring.position.x + Math.cos(a) * 6, 0, ring.position.z + Math.sin(a) * 6));
  }
  cones.count = cn;
  group.add(cones);
  // Tyre walls along the lot's edges (not across the road's way out).
  const tyreGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
  const tyres = new THREE.InstancedMesh(tyreGeo, new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.9 }), 3000);
  let tn = 0;
  const wall = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 0; s < len; s += 0.7) {
      const x = x0 + ((x1 - x0) * s) / len;
      const z = z0 + ((z1 - z0) * s) / len;
      if (z < lot.z + 1 && Math.abs(x) < rail + 1) continue;
      for (const y of [0.13, 0.39]) tyres.setMatrixAt(tn++, m4.makeTranslation(x, y, z));
    }
  };
  const e = 0.2;
  wall(lot.x - e, lot.z - e, lot.x + lot.w + e, lot.z - e);
  wall(lot.x - e, lot.z + lot.h + e, lot.x + lot.w + e, lot.z + lot.h + e);
  wall(lot.x - e, lot.z - e, lot.x - e, lot.z + lot.h + e);
  wall(lot.x + lot.w + e, lot.z - e, lot.x + lot.w + e, lot.z + lot.h + e);
  tyres.count = tn;
  group.add(tyres);
  const lamp = (x: number, z: number, y0: number, h: number, power: number, color = 0xffe8c8): void => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, h, 8).translate(0, h / 2, 0), new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.5, roughness: 0.5 }));
    pole.position.set(x, y0, z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) }));
    head.position.set(x, y0 + h, z);
    const light = new THREE.PointLight(color, power, h * 5, 1.4);
    light.position.set(x, y0 + h - 0.4, z);
    group.add(pole, head, light);
  };
  lamp(lot.x + 8, lot.z + 8, 0, 12, 900);
  lamp(lot.x + lot.w - 8, lot.z + lot.h - 8, 0, 12, 900);
  lamp(lot.x + lot.w - 8, lot.z + 8, 0, 12, 700);
  lamp(lot.x + 8, lot.z + lot.h / 2, 0, 12, 700);
  lamp(lot.x + lot.w - 8, lot.z + lot.h / 2 - 10, 0, 12, 700);
  lamp(lot.x + lot.w / 2 - 25, lot.z + 8, 0, 12, 600);

  // ---- The viewpoint: a disc of tarmac, a rim rail, a vending machine, a lamp.
  const sm = course.summit;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(sm.r + 0.5, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: TARMAC, roughness: 0.85 }));
  disc.position.set(sm.x, sm.y + 0.025, sm.z);
  group.add(disc);
  const toC = Math.atan2(course.x[n - 30] - sm.x, course.z[n - 30] - sm.z);
  // The rim rail: all the way round but for the gap where the road comes in (toC points at the road).
  const gap = (rail + 1) / sm.r;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(sm.r - 0.2, 0.07, 6, 64, Math.PI * 2 - gap * 2).rotateX(Math.PI / 2).rotateY(-(Math.atan2(Math.cos(toC), Math.sin(toC)) + gap)),
    new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.2, roughness: 0.7 }),
  );
  rim.position.set(sm.x, sm.y + 0.7, sm.z);
  group.add(rim);
  const vend = new THREE.Mesh(new THREE.BoxGeometry(1, 1.85, 0.8), new THREE.MeshStandardMaterial({ color: 0xe8e8ec, emissive: 0xc0d8ff, emissiveIntensity: 0.6 }));
  vend.position.set(sm.x - Math.sin(toC) * (sm.r - 2), sm.y + 0.93, sm.z - Math.cos(toC) * (sm.r - 2));
  vend.rotation.y = toC;
  group.add(vend);
  const vglow = new THREE.PointLight(0xc8dcff, 6, 10, 1.6);
  vglow.position.set(vend.position.x, sm.y + 1.6, vend.position.z);
  group.add(vglow);
  lamp(sm.x + Math.cos(toC) * 8, sm.z - Math.sin(toC) * 8, sm.y, 7, 90, 0xfff0d8);
  // Lamps at the two hairpins' apexes.
  for (const t of [0.34, 0.52]) {
    const i = Math.floor(n * t);
    const v = L(i, -(rail + 1.5));
    lamp(v.x, v.z, course.height(v.x, v.z), 8, 380);
  }

  // ---- The forest: cedars on the hillside, clear of the road, the lot and the viewpoint.
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 3, 6).translate(0, 1.5, 0);
  const crownGeo = new THREE.ConeGeometry(1.9, 8.5, 7).translate(0, 7.2, 0);
  const TREES = 5200;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 1 }), TREES);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x1a2a1c, roughness: 1 }), TREES);
  const tr = rng(99);
  let tc = 0;
  for (let k = 0; k < TREES * 3 && tc < TREES; k++) {
    const x = b.minX + tr() * (b.maxX - b.minX);
    const z = b.minZ + tr() * (b.maxZ - b.minZ);
    if (course.inLot(x, z, -6) || course.inSummit(x, z, -8)) continue;
    const near = course.nearest(x, z);
    if (near.i >= 0 && Math.abs(near.d) < rail + 3.5) continue;
    const y = course.height(x, z);
    const s = 0.7 + tr() * 0.7;
    m4.makeRotationY(tr() * 6.28).scale(new THREE.Vector3(s, s * (0.85 + tr() * 0.4), s)).setPosition(x, y - 0.2, z);
    trunks.setMatrixAt(tc, m4);
    crowns.setMatrixAt(tc, m4);
    crowns.setColorAt(tc, new THREE.Color().setRGB(0.09 + tr() * 0.04, 0.15 + tr() * 0.06, 0.1 + tr() * 0.03));
    tc++;
  }
  trunks.count = crowns.count = tc;
  crowns.castShadow = true;
  group.add(trunks, crowns);

  // ---- The night: moon, a little sky light, stars.
  const moon = new THREE.DirectionalLight(0x8a9ad0, 0.35);
  moon.position.set(-300, 400, 200);
  group.add(moon, new THREE.HemisphereLight(0x243052, 0x0a0a0c, 0.45));
  const sp: number[] = [];
  const sr = rng(3);
  for (let k = 0; k < 1500; k++) {
    const a = sr() * Math.PI * 2;
    const el = 0.08 + sr() * 1.4;
    sp.push(Math.cos(a) * Math.cos(el) * 900, Math.sin(el) * 900, Math.sin(a) * Math.cos(el) * 900);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, fog: false }));
  group.add(stars);
  return { group, stars };
}
