import * as THREE from 'three';
import { KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * The airliner, second generation (review in models.html; `?transit=new` at the airport): a narrow-body twin
 * (about an A320: 37.6 m long, 35.8 m span with its sharklets; invented airlines), on the city material so it's lit
 * and fogged like the city: a lofted fuselage (the nose's ogive, the tail sweeping up), the cockpit and cabin
 * windows (lit at night), swept tapered wings with dihedral and sharklets, the engines on their pylons, the
 * tailplane and the fin in the airline's colours with its emblem, the gear, and the airline's titles.
 *
 * Nose along +z, wheels on y 0 (the same frame as the first airliner, so the airport poses either).
 */

export interface Airline {
  readonly name: string;
  readonly jp: string;
  /** The fin and the titles. */
  readonly tail: number;
  /** The emblem on the fin, the sharklets' tips, a line along the belly. */
  readonly accent: number;
}

/** Invented airlines. */
export const AIRLINES: readonly Airline[] = [
  { name: 'TŌTO AIR', jp: '東都航空', tail: 0x1c2f6e, accent: 0xd8303a },
  { name: 'HANE AIR', jp: 'はねエア', tail: 0x139a92, accent: 0xf0c020 },
  { name: 'ORION AIRWAYS', jp: 'オリオン航空', tail: 0xe8762a, accent: 0x223060 },
  { name: 'KUMO JET', jp: '雲ジェット', tail: 0x3a9ad8, accent: 0xffffff },
];

/** What the airport moves and lights: the plane, its landing lights, strobes, beacon and the cabin windows. */
export interface Airliner {
  readonly group: THREE.Group;
  readonly landing: THREE.Mesh;
  readonly strobes: THREE.Mesh[];
  readonly beacon: THREE.Mesh;
  readonly windows: THREE.Mesh;
}

type V3 = [number, number, number];

const R = 1.97;
const Y = 3.45;
const NOSE = 18.6;
const BODY0 = 14.0;
const TAIL0 = -9.5;
const TAIL1 = -19.0;

/** The fuselage's section at z: its radius and the centre's height. */
function section(z: number): { r: number; y: number } {
  if (z > BODY0) {
    const t = Math.min(1, (z - BODY0) / (NOSE - BODY0));
    const r = R * Math.sqrt(Math.max(0, 1 - t ** 2.2));
    return { r, y: Y - 0.25 * t * t };
  }
  if (z < TAIL0) {
    const t = Math.min(1, (TAIL0 - z) / (TAIL0 - TAIL1));
    const r = R * (1 - 0.86 * t ** 1.25);
    // The top line stays almost level; the underside sweeps up to the tail.
    return { r, y: Y + (R - r) * 0.82 };
  }
  return { r: R, y: Y };
}

/** A titles decal (canvas): the airline's name and its Japanese, in its colour. */
function titles(a: Airline): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d')!;
  const hex = `#${a.tail.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex;
  g.font = "italic bold 92px 'Arial', sans-serif";
  g.textBaseline = 'middle';
  g.fillText(a.name, 10, 70, 640);
  g.font = "bold 64px 'Yu Gothic', 'Meiryo', sans-serif";
  g.fillText(a.jp, 680, 74, 330);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Builds an airliner in an airline's colours on the city material. */
export function airliner2(airline: Airline, city: THREE.Material): Airliner {
  const g = new THREE.Group();
  const mb = new MeshBuilder(1 << 15);
  const wb = new MeshBuilder(4096);
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  const WHITE = lin(0xf0f2f4);
  const BELLY = lin(0xc8ccd2);
  const GREY = lin(0xb8bcc2);
  const DARK = lin(0x1a1c20);
  const TAIL = lin(airline.tail);
  const ACCENT = lin(airline.accent);
  /** A disc (a fan of triangles round c through the points), facing n. */
  const fan = (c: V3, pts: readonly V3[], n: V3): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      let [p, q] = [pts[i], pts[i + 1]];
      const cr = [(p[1] - c[1]) * (q[2] - c[2]) - (p[2] - c[2]) * (q[1] - c[1]), (p[2] - c[2]) * (q[0] - c[0]) - (p[0] - c[0]) * (q[2] - c[2]), (p[0] - c[0]) * (q[1] - c[1]) - (p[1] - c[1]) * (q[0] - c[0])];
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) [p, q] = [q, p];
      mb.quadN(c, p, q, q, n, n, n, n);
    }
  };

  // ---- Fuselage: rings along z, smooth.
  const N = 20;
  const zs: number[] = [];
  for (let k = 0; k <= 12; k++) zs.push(NOSE - (NOSE - BODY0) * (k / 12) ** 1.6);
  for (let z = BODY0 - 2.4; z > TAIL0; z -= 2.4) zs.push(z);
  for (let k = 0; k <= 12; k++) zs.push(TAIL0 + (TAIL1 - TAIL0) * (k / 12));
  const ring = (z: number): { p: V3[]; n: V3[] } => {
    const s = section(z);
    const p: V3[] = [];
    const n: V3[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      p.push([Math.cos(a) * s.r, s.y + Math.sin(a) * s.r, z]);
      n.push([Math.cos(a), Math.sin(a), 0]);
    }
    return { p, n };
  };
  mb.kind = KIND.gloss;
  for (let k = 0; k + 1 < zs.length; k++) {
    const A = ring(zs[k]);
    const B = ring(zs[k + 1]);
    for (let i = 0; i < N; i++) {
      const am = ((i + 0.5) / N) * Math.PI * 2;
      // The belly a light grey, a thin line of the accent above it.
      const sinm = Math.sin(am);
      mb.color = sinm < -0.62 ? BELLY : WHITE;
      mb.quadN(A.p[i], B.p[i], B.p[i + 1], A.p[i + 1], A.n[i], B.n[i], B.n[i + 1], A.n[i + 1]);
    }
  }
  // The tail's end: the APU's exhaust, a dark cap.
  {
    const s = section(TAIL1);
    mb.color = lin(0x3a3c40);
    mb.kind = KIND.plain;
    fan([0, s.y, TAIL1], Array.from({ length: N + 1 }, (_, i) => [Math.cos((i / N) * Math.PI * 2) * s.r, s.y + Math.sin((i / N) * Math.PI * 2) * s.r, TAIL1] as V3), [0, 0, -1]);
  }
  // ---- Windows: the cabin's row each side (lit at night: their own mesh), the cockpit, the doors' outlines.
  for (const s of [-1, 1]) {
    for (let z = -8.3; z < 12.2; z += 0.53) {
      if (Math.abs(z - 11.4) < 0.7 || Math.abs(z + 7.8) < 0.6 || Math.abs(z - 1.9) < 0.3) continue;
      const x = s * (R + 0.012);
      wb.quad([x, Y + 0.3, s > 0 ? z + 0.11 : z - 0.11], [0, 0, s > 0 ? -0.22 : 0.22], [0, 0.32, 0]);
    }
    // Doors (front and back): dark outlines.
    for (const zd of [11.4, -7.8]) {
      mb.kind = KIND.plain;
      mb.color = GREY;
      for (const [a, b, c, d] of [[zd - 0.42, zd - 0.39, Y - 0.85, Y + 1.0], [zd + 0.39, zd + 0.42, Y - 0.85, Y + 1.0], [zd - 0.42, zd + 0.42, Y + 0.97, Y + 1.0], [zd - 0.42, zd + 0.42, Y - 0.88, Y - 0.85]] as const)
        mb.box(s * (R + 0.006), (a + b) / 2, c, d, 0.01, b - a, KIND.plain);
    }
  }
  // The cockpit's windows: three panes down each side of the nose and the two in front.
  mb.kind = KIND.glass;
  mb.color = DARK;
  const pane = (a0: number, a1: number, z0: number, z1: number): void => {
    const s0 = section(z0);
    const s1 = section(z1);
    const P = (s: { r: number; y: number }, a: number, z: number): V3 => [Math.cos(a) * (s.r + 0.015), s.y + Math.sin(a) * (s.r + 0.015), z];
    const am = (a0 + a1) / 2;
    const n: V3 = [Math.cos(am) * 0.8, Math.sin(am) * 0.8, 0.6];
    mb.quadN(P(s0, a0, z0), P(s1, a0, z1), P(s1, a1, z1), P(s0, a1, z0), n, n, n, n);
  };
  for (const side of [-1, 1]) {
    const A = (a: number): number => (side > 0 ? a : Math.PI - a);
    pane(A(0.42), A(0.62), 14.9, 15.55);
    pane(A(0.62), A(0.86), 15.55, 16.15);
    pane(A(0.86), A(1.2), 16.15, 16.75);
    pane(A(1.24), A(1.52), 16.55, 17.05);
  }

  // ---- Wings: a root and a tip section (leading edge, top, trailing edge, bottom), swept, with dihedral.
  const surface = (sections: { x: number; le: number; te: number; y: number; th: number }[], color: [number, number, number], mirror: boolean): void => {
    mb.kind = KIND.gloss;
    mb.color = color;
    const pts = (s: { x: number; le: number; te: number; y: number; th: number }, sx: number): V3[] => {
      const c = s.le - s.te;
      return [
        [sx * s.x, s.y, s.le],
        [sx * s.x, s.y + s.th / 2, s.le - c * 0.32],
        [sx * s.x, s.y + 0.02, s.te],
        [sx * s.x, s.y - s.th / 2, s.le - c * 0.32],
      ];
    };
    for (const sx of mirror ? [-1, 1] : [1]) {
      for (let k = 0; k + 1 < sections.length; k++) {
        const A = pts(sections[k], sx);
        const B = pts(sections[k + 1], sx);
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          const up: V3 = i === 0 || i === 1 ? [0, 1, 0] : [0, -1, 0];
          mb.quadN(A[i], B[i], B[j], A[j], up, up, up, up);
        }
      }
      // The tip's cap.
      const T = pts(sections[sections.length - 1], sx);
      mb.quadN(T[0], T[1], T[2], T[3], [sx, 0, 0], [sx, 0, 0], [sx, 0, 0], [sx, 0, 0]);
    }
  };
  const sweep = Math.tan((26 * Math.PI) / 180);
  const dihedral = Math.tan((6 * Math.PI) / 180);
  const wingY = Y - 1.3;
  const wing = [0, 1].map((k) => {
    const x = 1.7 + k * 14.7;
    return { x, le: 4.2 - (x - 1.7) * sweep, te: k ? -5.0 : -3.4, y: wingY + (x - 1.7) * dihedral, th: k ? 0.18 : 0.58 };
  });
  surface(wing, lin(0xdcdee2), true);
  // The sharklets: up from the tips, raked back, the airline's colour.
  const tip = wing[1];
  surface(
    [
      { x: tip.x, le: tip.le, te: tip.te, y: tip.y, th: 0.14 },
      { x: tip.x + 0.25, le: tip.le - 0.5, te: tip.te - 0.2, y: tip.y + 0.6, th: 0.1 },
      { x: tip.x + 0.55, le: tip.le - 1.4, te: tip.te - 0.45, y: tip.y + 2.4, th: 0.06 },
    ].map((s) => ({ ...s })),
    TAIL,
    true,
  );
  // The flap track fairings under the wings.
  for (const sx of [-1, 1]) for (const x of [4.2, 7.8, 11.0]) {
    mb.kind = KIND.gloss;
    mb.color = GREY;
    const yw = wingY + (x - 1.7) * dihedral;
    const te = -3.4 + ((x - 1.7) / 14.7) * -1.6;
    mb.box(sx * x, te + 0.3, yw - 0.45, yw - 0.1, 0.22, 1.6, KIND.gloss, true);
  }
  // ---- Tailplane and fin.
  surface(
    [0, 1].map((k) => {
      const x = 0.4 + k * 5.8;
      return { x, le: -14.4 - k * 2.7, te: -17.6 - k * 1.2, y: Y + 0.55 + k * 0.6, th: k ? 0.08 : 0.3 };
    }),
    lin(0xdcdee2),
    true,
  );
  const finSection = (h: number): { le: number; te: number; y: number; th: number } => ({ le: -11.4 - h * 0.92, te: -18.5 - h * 0.2, y: Y + R - 0.2 + h, th: 0.45 - h * 0.045 });
  {
    mb.kind = KIND.gloss;
    mb.color = TAIL;
    for (let h = 0; h < 6.2; h += 1.55) {
      const a = finSection(h);
      const b = finSection(Math.min(6.2, h + 1.55));
      const ring2 = (s: { le: number; te: number; y: number; th: number }): V3[] => [
        [0, s.y, s.le],
        [s.th / 2, s.y, s.le - (s.le - s.te) * 0.3],
        [0, s.y, s.te],
        [-s.th / 2, s.y, s.le - (s.le - s.te) * 0.3],
      ];
      const A = ring2(a);
      const B = ring2(b);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const nx = i < 2 ? 1 : -1;
        mb.quadN(A[i], A[j], B[j], B[i], [nx, 0, 0], [nx, 0, 0], [nx, 0, 0], [nx, 0, 0]);
      }
    }
    // The emblem: a disc of the accent each side, a band through it.
    for (const sx of [-1, 1]) {
      const c = finSection(3.4);
      const cz = c.le - (c.le - c.te) * 0.5;
      const x = sx * (c.th / 2 + 0.02);
      mb.color = ACCENT;
      fan([x, c.y, cz], Array.from({ length: 17 }, (_, i) => [x, c.y + Math.sin((i / 16) * Math.PI * 2) * 1.1, cz + Math.cos((i / 16) * Math.PI * 2) * 1.1] as V3), [sx, 0, 0]);
    }
  }
  // ---- Engines: nacelles round z under the wings, the fan's dark face, the pylon up to the wing.
  for (const sx of [-1, 1]) {
    const ex = sx * 5.7;
    const ey = Y - 2.45;
    const prof: [number, number][] = [[4.7, 0.95], [4.4, 1.05], [3.2, 1.06], [1.6, 0.92], [0.8, 0.62], [0.2, 0.3]];
    const NE = 16;
    mb.kind = KIND.gloss;
    for (let k = 0; k + 1 < prof.length; k++) {
      const [za, ra] = prof[k];
      const [zb, rb] = prof[k + 1];
      mb.color = k >= 3 ? GREY : WHITE;
      for (let i = 0; i < NE; i++) {
        const a0 = (i / NE) * Math.PI * 2;
        const a1 = ((i + 1) / NE) * Math.PI * 2;
        const P = (z: number, r: number, a: number): V3 => [ex + Math.cos(a) * r, ey + Math.sin(a) * r, z];
        const Nn = (a: number): V3 => [Math.cos(a), Math.sin(a), 0];
        mb.quadN(P(za, ra, a0), P(zb, rb, a0), P(zb, rb, a1), P(za, ra, a1), Nn(a0), Nn(a0), Nn(a1), Nn(a1));
      }
    }
    // The fan's face, dark inside the intake.
    mb.color = DARK;
    mb.kind = KIND.plain;
    fan([ex, ey, 4.45], Array.from({ length: NE + 1 }, (_, i) => [ex + Math.cos((i / NE) * Math.PI * 2) * 0.94, ey + Math.sin((i / NE) * Math.PI * 2) * 0.94, 4.52] as V3), [0, 0, 1]);
    // The spinner.
    mb.color = lin(0x8a8e94);
    fan([ex, ey, 4.75], Array.from({ length: 9 }, (_, i) => [ex + Math.cos((i / 8) * Math.PI * 2) * 0.22, ey + Math.sin((i / 8) * Math.PI * 2) * 0.22, 4.5] as V3), [0, 0, 1]);
    // The pylon.
    mb.kind = KIND.gloss;
    mb.color = GREY;
    const yw = wingY + (5.7 - 1.7) * dihedral;
    mb.box(ex, 1.8, ey + 0.9, yw, 0.32, 3.6, KIND.gloss, true);
  }
  // ---- Gear: the nose leg and its two wheels, the mains (two wheels each), the bays' doors.
  mb.kind = KIND.plain;
  mb.color = lin(0x9aa0a6);
  mb.cylinder(0, 12.6, 0.36, Y - R + 0.1, 0.09, 6, false);
  for (const sx of [-1, 1]) mb.cylinder(sx * 3.8, -1.2, 0.6, wingY - 0.2, 0.14, 6, false);
  mb.color = lin(0x141416);
  for (const sx of [-0.18, 0.18]) mb.beam([sx - 0.08, 0.36, 12.6], [sx + 0.08, 0.36, 12.6], 0.72);
  for (const sx of [-1, 1]) for (const dx of [-0.32, 0.32]) mb.beam([sx * 3.8 + dx - 0.12, 0.57, -1.2], [sx * 3.8 + dx + 0.12, 0.57, -1.2], 1.14);

  const body = new THREE.Mesh(mb.build()!, city);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  // The windows: dark by day, warm at night (the airport sets their colour).
  const windows = new THREE.Mesh(wb.build()!, new THREE.MeshBasicMaterial({ color: 0x2a3036 }));
  g.add(windows);
  // The titles, forward above the windows, each side reading toward the tail... and from the other side toward
  // the nose (left to right as you look at it).
  const tex = titles(airline);
  const tmat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.12), tmat);
    t.position.set(s * (R + 0.03), Y + 1.05, 5.8);
    t.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(t);
  }
  // Lights: landing lights (on approach), strobes on the wingtips and tail, nav lights, the red beacon.
  const add = (geo: THREE.BufferGeometry, color: THREE.Color, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const landing = add(new THREE.SphereGeometry(0.45, 8, 6), new THREE.Color(6, 6, 5.5), 0, 0.9, 12.4);
  const strobes = [-1, 1].map((s) => add(new THREE.SphereGeometry(0.25, 6, 4), new THREE.Color(5, 5, 5), s * (tip.x + 0.1), tip.y, tip.te - 0.1));
  add(new THREE.SphereGeometry(0.22, 6, 4), new THREE.Color(3, 0.2, 0.2), -(tip.x + 0.05), tip.y, tip.le - 0.2);
  add(new THREE.SphereGeometry(0.22, 6, 4), new THREE.Color(0.2, 3, 0.4), tip.x + 0.05, tip.y, tip.le - 0.2);
  const beacon = add(new THREE.SphereGeometry(0.3, 6, 4), new THREE.Color(4, 0.3, 0.2), 0, Y + R + 0.15, 0);
  return { group: g, landing, strobes, beacon, windows };
}
