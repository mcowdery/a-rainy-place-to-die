import * as THREE from 'three';
import type { Course } from './course';
import { buildCircuit } from './circuitScene';

/**
 * The venue's scenery from its course: the hillside (coloured by slope: forest floor, rock, the gravel
 * shoulders), the road (tarmac, white edge lines, the yellow centre line of a Japanese pass), guardrails on
 * posts with reflectors, a cedar forest, the practice lot (floodlit, cones, a painted drift circle, tyre
 * walls), the viewpoint at the top (a vending machine glowing), the sea on a coastal venue, and the venue's
 * time of day from its atmosphere (the moon or a low sun, the sky's fill, stars, the sun's disc at dusk).
 */
export interface VenueScene {
  readonly group: THREE.Group;
  /** A circuit's start lights: how many of the five reds are lit, or all out for GO (race/circuitScene.ts). */
  readonly startLights?: (lit: number) => void;
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
  if (course.def.kind === 'circuit') return buildCircuit(course);
  const group = new THREE.Group();
  const wharf = course.def.kind === 'wharf';
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
      if (wharf) c.setRGB(0.1 + rand() * 0.015, 0.1 + rand() * 0.015, 0.11 + rand() * 0.015);
      else if (course.inLot(x, z)) c.setHex(0x1e1e22);
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
  if (!wharf) lines.add(ring);
  group.add(lines);
  const coneGeo = new THREE.ConeGeometry(0.22, 0.7, 12).translate(0, 0.35, 0);
  const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0xff5a1a, roughness: 0.6, emissive: 0x401000 }), 40);
  let cn = 0;
  for (let k = 0; k < (wharf ? 0 : 8); k++) cones.setMatrixAt(cn++, m4.makeTranslation(lot.x + 20 + k * 11, 0, lot.z + lot.h * 0.3));
  for (let k = 0; k < (wharf ? 0 : 12); k++) {
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
  lamp(lot.x + 8, lot.z + 8, 0, 12, 560);
  lamp(lot.x + lot.w - 8, lot.z + lot.h - 8, 0, 12, 560);
  lamp(lot.x + lot.w - 8, lot.z + 8, 0, 12, 430);
  lamp(lot.x + 8, lot.z + lot.h / 2, 0, 12, 430);
  lamp(lot.x + lot.w - 8, lot.z + lot.h / 2 - 10, 0, 12, 430);
  lamp(lot.x + lot.w / 2 - 25, lot.z + 8, 0, 12, 370);
  // A wharf: tall sodium masts across the whole lot.
  if (wharf) for (const fx of [0.2, 0.5, 0.8]) for (const fz of [0.3, 0.75]) lamp(lot.x + lot.w * fx, lot.z + lot.h * fz, 0, 24, 800, 0xffa860);

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
    lamp(v.x, v.z, course.height(v.x, v.z), 8, 150);
  }

  // ---- The forest: cedars on the hillside, clear of the road, the lot and the viewpoint.
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 3, 6).translate(0, 1.5, 0);
  const crownGeo = new THREE.ConeGeometry(1.9, 8.5, 7).translate(0, 7.2, 0);
  const TREES = 5200;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 1 }), TREES);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x1a2a1c, roughness: 1 }), TREES);
  const tr = rng(99);
  let tc = 0;
  for (let k = 0; k < (wharf ? 0 : TREES * 3) && tc < TREES; k++) {
    const x = b.minX + tr() * (b.maxX - b.minX);
    const z = b.minZ + tr() * (b.maxZ - b.minZ);
    if (course.inLot(x, z, -6) || course.inSummit(x, z, -8)) continue;
    // On the coast: the shore below the lot and the viewpoint's seaward side kept clear for the view, and
    // the seaward face of the hill wooded more thinly.
    if (course.def.sea) {
      const l = course.def.lot;
      const top = course.summit;
      if (z > l.z + l.h - 4 || (z > top.z - 10 && Math.hypot(x - top.x, z - top.z) < 110) || tr() < 0.5) continue;
    }
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

  if (wharf) group.add(wharfDressing(course));

  const stars = addSky(course, group);
  return { group, stars };
}

/**
 * The sky's light (the moon, or the low sun at dusk), the sky's fill, the stars (dim at dusk), at dusk the sun's
 * disc on the horizon (the stars and the sun ride with the camera: main.ts moves them), and the sea on a coastal
 * venue. Every venue has these (circuits too: race/circuitScene.ts).
 */
export function addSky(course: Course, group: THREE.Group): THREE.Points {
  // ---- The sky's light (the moon, or the low sun at dusk), the sky's fill, the stars (dim at dusk), and at
  // dusk the sun's disc on the horizon; the stars and the sun ride with the camera (main.ts moves them).
  const at = course.def.atmosphere;
  const sky = new THREE.DirectionalLight(new THREE.Color(at.light.color), at.light.intensity);
  sky.position.set(...at.light.from);
  group.add(sky, new THREE.HemisphereLight(new THREE.Color(at.hemi.sky), new THREE.Color(at.hemi.ground), at.hemi.intensity));
  const sp: number[] = [];
  const sr = rng(3);
  for (let k = 0; k < 1500; k++) {
    const a = sr() * Math.PI * 2;
    const el = 0.08 + sr() * 1.4;
    sp.push(Math.cos(a) * Math.cos(el) * 900, Math.sin(el) * 900, Math.sin(a) * Math.cos(el) * 900);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: new THREE.Color(0xdfe6ff).multiplyScalar(at.stars), size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: Math.min(1, at.stars * 1.5) }));
  stars.visible = at.stars > 0;
  group.add(stars);
  if (at.sun) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,240,210,1)');
    gr.addColorStop(0.28, 'rgba(255,200,140,1)');
    gr.addColorStop(0.36, 'rgba(255,150,90,0.35)');
    gr.addColorStop(1, 'rgba(255,120,80,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(2.2, 1.6, 1.1), fog: false, depthWrite: false, transparent: true }));
    const d = new THREE.Vector3(...at.light.from).normalize();
    d.y = Math.max(0.02, d.y * 0.35);
    sun.position.copy(d.normalize().multiplyScalar(880));
    sun.scale.setScalar(150);
    stars.add(sun);
  }
  // ---- The sea: a sheet at its level out to the horizon, glossy enough to catch the low sun.
  const sea = course.def.sea;
  if (sea) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c2c48, roughness: 0.16, metalness: 0.55 }));
    const b = course.bounds;
    water.position.set((b.minX + b.maxX) / 2, sea.level, sea.shore + 3900);
    group.add(water);
  }
  return stars;
}

/**
 * A wharf's dressing: the container stacks (the course's blocks, filled with 12 m boxes in the shipping lines'
 * colours, stacked to their tiers), the gantry cranes along the quay with their booms out over the water and the
 * red lights on top, bollards along the edge.
 */
function wharfDressing(course: Course): THREE.Group {
  const g = new THREE.Group();
  const r = rng(11);
  const COLORS = [0xb83a2a, 0x2a5a8a, 0x3a7a4a, 0xc8a030, 0x7a7a7e, 0xd06a20, 0x2a2a30, 0x8a3a6a];
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const boxes: { x: number; z: number; w: number; d: number; y: number; c: number }[] = [];
  for (const b of course.def.blocks ?? []) {
    const alongX = b.w >= b.h;
    const L = alongX ? b.w : b.h;
    const D = alongX ? b.h : b.w;
    const rows = Math.max(1, Math.round(D / 2.5));
    const n = Math.max(1, Math.floor(L / 12.2));
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < (b.tiers ?? 2); t++) {
          if (t > 0 && r() < 0.18) break;
          const a = (i + 0.5) * (L / n);
          const c = (row + 0.5) * (D / rows);
          boxes.push({ x: b.x + (alongX ? a : c), z: b.z + (alongX ? c : a), w: alongX ? L / n - 0.3 : D / rows - 0.2, d: alongX ? D / rows - 0.2 : L / n - 0.3, y: t * 2.6, c: COLORS[Math.floor(r() * COLORS.length)] });
        }
      }
    }
  }
  const mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.2 }), boxes.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  boxes.forEach((b, i) => {
    mesh.setMatrixAt(i, m4.makeScale(b.w, 2.55, b.d).setPosition(b.x, b.y, b.z));
    mesh.setColorAt(i, col.setHex(b.c));
  });
  g.add(mesh);
  // The cranes along the quay: two legs a side, the portal beam, the boom out over the water, a light on top.
  const shore = course.def.sea?.shore ?? 130;
  const steel = new THREE.MeshStandardMaterial({ color: 0xc83a2a, roughness: 0.6, metalness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.6, metalness: 0.3 });
  const part = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): void => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    p.position.set(x, y, z);
    g.add(p);
  };
  for (const cx of [-90, 0, 90]) {
    for (const dx of [-8, 8]) for (const dz of [-12, 12]) part(1.4, 38, 1.4, cx + dx, 19, shore - 6 + dz, steel);
    part(18, 3, 26, cx, 39, shore - 6, white);
    part(6, 3, 70, cx, 43, shore + 10, steel);
    part(6, 6, 10, cx, 45, shore - 20, white);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1) }));
    light.position.set(cx, 47, shore - 6);
    g.add(light);
  }
  // Bollards along the quay's edge.
  const bollard = new THREE.CylinderGeometry(0.3, 0.35, 0.8, 10).translate(0, 0.4, 0);
  const bm = new THREE.InstancedMesh(bollard, new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.8 }), 40);
  let k = 0;
  for (let x = course.def.lot.x + 10; x < course.def.lot.x + course.def.lot.w - 5 && k < 40; x += 12) bm.setMatrixAt(k++, m4.makeTranslation(x, 0, shore - 1.5));
  bm.count = k;
  g.add(bm);
  return g;
}
