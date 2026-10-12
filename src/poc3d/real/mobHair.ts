import type { DetailedHair } from './mobHairKinds';
import { table } from './mobMesh';
import type { Row, V3 } from './mobRig';

/**
 * Women's detailed hair (a trial, 2026-10-10; the user: less anime, more detailed). The anime cuts are a thick cap
 * with broad pointed blades; these are a thin cap with the hair itself laid over it in fine tapering strands, each
 * cut a few of the same moves (`fall`, `sides`, `bangs`, `tail`, `braid`, `bun`) with other numbers. Head units from
 * the neck joint, as mobShape.ts's hair: y up, z negative at the back, angles from the front round to the back (pi).
 * The geometry comes from the kit buildShaped gives (its `lock`, `onHead` and `loft`); nothing here is random (the
 * variety between strands is a fixed fraction of their index).
 */

/** The cap: a thin shell from a hairline (by angle, as mobShape.ts's `HairStyle`). */
export interface Cap {
  readonly line: readonly (readonly [number, number])[];
  readonly thick: readonly [number, number];
  readonly hang?: number;
  /** The edge cut into points (blending). */
  readonly spike?: number;
  readonly spikeBack?: number;
}
/** What buildShaped lends the cuts to build with. */
export interface HairKit {
  /** A tapering strand along a path, with half widths along it and a half thickness. */
  lock(path: readonly V3[], width: readonly number[], thick: number, headOnly?: boolean, tone?: number): void;
  /** A point on the skull: at an angle from the front, at a height, standing `off` off it. */
  onHead(phi: number, y: number, off: number, wide?: number): V3;
  /** A lofted form of hair: rows [y, half width, half depth, z] a little to one side (`x`). */
  loft(rows: readonly Row[], x: number, seg?: number): void;
}
export interface Do {
  readonly cap: Cap;
  readonly build: (k: HairKit) => void;
}

const PI = Math.PI;
const TAU = Math.PI * 2;
/** A fixed fraction of an index, to vary strands from one another. */
const frac = (i: number): number => (i * 0.618) % 1;

// ---- Caps ----
const CAP_PART: Cap = { line: [[0, 0.17], [0.7, 0.168], [1.0, 0.15], [1.3, 0.122], [1.6, 0.1], [2.0, 0.07], [PI, 0.04]], thick: [0.012, 0.022] };
const CAP_FULL: Cap = { line: [[0, 0.172], [0.7, 0.17], [1.0, 0.15], [1.3, 0.12], [1.6, 0.09], [2.0, 0.05], [PI, 0.02]], thick: [0.02, 0.036] };
const CAP_SLEEK: Cap = { line: [[0, 0.178], [0.5, 0.176], [0.85, 0.165], [1.2, 0.13], [1.45, 0.108], [1.75, 0.1], [2.1, 0.05], [PI, 0.03]], thick: [0.008, 0.014] };
const CAP_UP: Cap = { line: [[0, 0.17], [0.7, 0.164], [1.2, 0.118], [1.45, 0.1], [1.75, 0.1], [2.1, 0.05], [PI, 0.03]], thick: [0.012, 0.022] };
const CAP_BOB: Cap = { line: [[0, 0.162], [0.74, 0.155], [1.04, 0.03], [1.3, 0.0], [1.6, -0.02], [PI, -0.03]], thick: [0.02, 0.032], hang: 0.092 };
const CAP_LOB: Cap = { line: [[0, 0.162], [0.74, 0.155], [1.04, 0.02], [1.3, -0.05], [1.6, -0.09], [PI, -0.11]], thick: [0.02, 0.032], hang: 0.092 };
const CAP_BUZZ: Cap = { line: [[0, 0.172], [0.6, 0.164], [1.0, 0.11], [1.4, 0.07], [1.8, 0.05], [2.3, 0.02], [PI, 0.01]], thick: [0.006, 0.012] };
// The old anime cuts' own hairlines (mobShape.ts H_CROP, H_BOB, H_LONG, H_BACK, H_UP), a little thinner, without the blade edge.
const CAP_OLD_CROP: Cap = { line: [[0, 0.156], [0.6, 0.15], [1.0, 0.09], [1.4, 0.05], [1.8, 0.03], [2.3, 0.0], [PI, -0.01]], thick: [0.022, 0.034], hang: 0.09 };
const CAP_OLD_BOB: Cap = { line: [[0, 0.156], [0.74, 0.15], [1.04, 0.0], [1.4, -0.03], [PI, -0.036]], thick: [0.028, 0.036], hang: 0.092 };
const CAP_OLD_LONG: Cap = { line: [[0, 0.156], [0.74, 0.15], [1.04, 0.01], [1.4, -0.05], [PI, -0.04]], thick: [0.026, 0.036], hang: 0.092 };
const CAP_OLD_BACK: Cap = { line: [[0, 0.156], [0.5, 0.152], [0.8, 0.146], [1.2, 0.112], [1.45, 0.098], [1.75, 0.1], [2.1, 0.05], [PI, 0.03]], thick: [0.02, 0.034] };
const CAP_OLD_UP: Cap = { line: [[0, 0.166], [0.7, 0.16], [1.2, 0.114], [1.45, 0.098], [1.75, 0.1], [2.1, 0.05], [PI, 0.03]], thick: [0.018, 0.03] };
const CAP_PIXIE: Cap = { line: [[0, 0.17], [0.6, 0.16], [1.0, 0.1], [1.4, 0.06], [1.8, 0.04], [2.3, 0.01], [PI, 0.0]], thick: [0.014, 0.034] };

// ---- Blending the strands into the cap (a toggle, off by default) ----
// Off: strands start a little off the skull, standing over the cap. On (the hair room's ?blend=1): they lie on the cap's own
// surface (its thickness at that angle and height, and its hang), start sunk in it with their width easing up from nearly
// nothing so they grow out of it, and the cap's edge is cut ragged so the strands come out of its points, not under a straight hem.
let BLEND = false;
let CAPX: Cap = { line: [[0, 0.17], [PI, 0.04]], thick: [0.01, 0.02] };
/** 0 as it was, 1 the strands blended into the cap. (A fluted cap, strands over a full cap and strands only were tried as levels above this and turned down.) */
let LEVEL = 0;
export const setHairBlend = (level: number): void => {
  LEVEL = Math.max(0, Math.min(1, Math.round(level) || 0));
  BLEND = LEVEL >= 1;
};
export const hairBlend = (): number => LEVEL;
const CROWN = 0.231;
/** The cap's thickness at an angle and height (mobShape.ts's shell: its rows climb the hairline to the crown by a sine). */
function capThick(phi: number, y: number): number {
  let a = ((phi % TAU) + TAU) % TAU;
  if (a > PI) a = TAU - a;
  const lo = table(CAPX.line, a);
  const u = Math.max(0, Math.min(1, Math.asin(Math.max(0, Math.min(1, (y - lo) / Math.max(CROWN - lo, 0.01)))) / (PI / 2)));
  return CAPX.thick[0] + (CAPX.thick[1] - CAPX.thick[0]) * u;
}
/** A point on the cap's surface (blending on), `extra` proud of it (negative: sunk in it). */
const surf = (k: HairKit, phi: number, y: number, extra: number): V3 => k.onHead(phi, y, capThick(phi, y) + extra, CAPX.hang ?? -1);
/** A strand's root, easing out of the cap: the first width to a fifth, the second a little under. */
const ease = (wd: number[]): void => {
  if (BLEND && wd.length > 2) {
    wd[0] *= 0.2;
    wd[1] *= 0.85;
  }
};

// ---- The moves ----
interface Fall {
  readonly n: number;
  /** The fan's half angle round the head, centred on `at` (the back, pi). */
  readonly spread: number;
  /** The height the longest strand ends at (the neck joint is 0, the crown 0.23). */
  readonly len: number;
  readonly at?: number;
  /** How much shorter the shortest strand is, of the whole drop. */
  readonly jit?: number;
  readonly width?: number;
  /** Waves: their size, and how far apart in phase neighbours are (small: waves run together; large: tangled). */
  readonly wave?: number;
  readonly coh?: number;
  /** How far it spreads out lower down. */
  readonly flare?: number;
  readonly curl?: number;
  /** Ends turned in (a bob) or flicked out. */
  readonly tuck?: number;
  readonly flip?: number;
  /** Where the hair rests against the back. */
  readonly back?: number;
  /** How far further off the skull it lies (over a thick cap). */
  readonly lift?: number;
}
const T7 = [0, 0.14, 0.28, 0.45, 0.62, 0.8, 1] as const;
/** Hair falling over the cap round the back, strand by strand, in a fan. */
function fall(k: HairKit, o: Fall): void {
  const { n, spread, len, width = 0.0055, wave = 0.01, coh = 1.7, flare = 1.12, curl = 0, tuck = 0, flip = 0, back = -0.1, lift = 0 } = o;
  const jit = o.jit ?? 0.2;
  const wdth = width;
  const up = 0;
  const TOP = BLEND ? 0.222 : 0.2;
  const at = o.at ?? PI;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * 2 - 1;
    const end = 0.2 - (0.2 - len) * (1 - jit * frac(i));
    const phi = at + s * spread;
    const [bx, , bz] = BLEND ? surf(k, phi, 0.02, 0.008 + up) : k.onHead(phi, 0.02, 0.04);
    const path: V3[] = [];
    const wd: number[] = [];
    T7.forEach((t, j) => {
      const y = TOP + (end - TOP) * t;
      if (y >= 0.02) path.push(BLEND ? surf(k, phi, y, (j === 0 ? -0.008 : 0.003 + 0.01 * t) + up) : k.onHead(phi, y, 0.012 + lift + 0.024 * Math.sqrt(t)));
      else {
        const u = Math.min(1, (0.02 - y) / Math.max(0.02 - end, 0.01));
        let x = bx * (1 + (flare - 1) * u) + wave * Math.sin(i * coh + u * 3) * u;
        let z = bz + (back - 0.012 * Math.abs(s) - bz) * Math.min(1, u * 2.5);
        if (curl) {
          const a = u * 13 + i * 0.9;
          x += curl * 0.016 * Math.sin(a) * u;
          z += curl * 0.016 * (Math.cos(a) - 1) * u;
        }
        x *= (1 - tuck * u * u) * (1 + flip * u * u * u);
        z += tuck * 0.03 * u * u - flip * 0.03 * u * u * u;
        path.push([x, y, z]);
      }
      wd.push(j === T7.length - 1 ? 0 : wdth * (1 - 0.3 * t));
    });
    ease(wd);
    k.lock(path, wd, 0.009);
  }
}

interface Sides {
  readonly n?: number;
  /** Where they end (never above -0.02). */
  readonly len: number;
  readonly width?: number;
  /** Forward of the neck, and how far apart the strands fan. */
  readonly fwd?: number;
  readonly fan?: number;
  readonly flip?: number;
  /** A side's share: [one side, the other] (a side parting). */
  readonly heavy?: readonly [number, number];
}
/** Strands in front of each ear, framing the face, down to `len`. */
function sides(k: HairKit, o: Sides): void {
  const { n = 5, width = 0.0065, fwd = 0, fan = 0.006, flip = 0, heavy = [1, 1] } = o;
  const len = Math.min(o.len, -0.02);
  for (const sd of [-1, 1]) {
    const cnt = Math.round(n * heavy[sd < 0 ? 0 : 1]);
    for (let i = 0; i < cnt; i++) {
      const e = i * fan;
      const end = len - 0.02 * frac(i);
      const wd = [width, width * 1.05, width, width * 0.85, 0];
      ease(wd);
      k.lock([
        BLEND ? surf(k, -sd * 1.0, 0.19, -0.006) : k.onHead(-sd * 1.0, 0.19, 0.02 + e * 0.5),
        BLEND ? surf(k, -sd * 1.02, 0.1, 0.004 + e) : k.onHead(-sd * 1.02, 0.1, 0.03 + e),
        [sd * (0.093 + e), 0.0, 0.03 + fwd * 0.5 + e * 0.6],
        [sd * (0.092 + e * 1.2 + flip * 0.01), end * 0.5, 0.045 + fwd + e],
        [sd * (0.088 + e * 1.4 + flip * 0.04), end, 0.05 + fwd * 1.1 + e + flip * 0.02],
      ], wd, 0.009);
    }
  }
}

interface Bangs {
  readonly kind: 'blunt' | 'curtain' | 'swept' | 'wispy';
  readonly n?: number;
  /** The brow's height, 0.112. */
  readonly tip?: number;
  readonly width?: number;
  /** The half angle across the forehead. */
  readonly reach?: number;
  readonly sweep?: number;
}
/** A fringe in fine strands from the crown down over the forehead. */
function bangs(k: HairKit, o: Bangs): void {
  const { kind, n = 14, tip = 0.112, reach = 0.68, sweep = 0.25 } = o;
  const width = o.width ?? (kind === 'wispy' ? 0.0045 : 0.0075);
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * 2 - 1;
    const phi = s * reach;
    let y = tip;
    let sw = 0;
    if (kind === 'blunt') y = tip + 0.004 * Math.sin(i * 2.3);
    else if (kind === 'curtain') {
      y = tip + 0.07 * Math.pow(1 - Math.abs(s), 1.4);
      sw = (s < 0 ? -1 : 1) * sweep * (0.4 + 0.6 * Math.abs(s));
    } else if (kind === 'swept') {
      y = tip + 0.03 * s;
      sw = sweep;
    } else y = tip + 0.012 + 0.02 * Math.sin(i * 1.9);
    const wd = [width * 0.8, width, width * 0.8, 0];
    if (BLEND) wd[0] *= 0.2;
    k.lock([
      BLEND ? surf(k, phi * 0.8, 0.212, -0.006) : k.onHead(phi * 0.8, 0.212, 0.03),
      BLEND ? surf(k, phi, 0.172, 0.006) : k.onHead(phi, 0.172, 0.04),
      BLEND ? surf(k, phi + sw * 0.5, (0.172 + y) / 2, 0.008) : k.onHead(phi + sw * 0.5, (0.172 + y) / 2, 0.032),
      k.onHead(phi + sw, y, 0.014),
    ], wd, 0.012);
  }
}

/** A form of hair as an ellipsoid (a bun, a tie), centre and radii in head units. */
function ball(k: HairKit, c: V3, r: V3, seg = 10): void {
  const rows: Row[] = [];
  const M = 9;
  for (let i = 0; i <= M; i++) {
    const a = (i / M) * PI;
    rows.push([c[1] - r[1] * Math.cos(a), Math.max(0.003, r[0] * Math.sin(a)), Math.max(0.003, r[2] * Math.sin(a)), c[2]]);
  }
  k.loft(rows, c[0], seg);
}

interface Gather {
  readonly n: number;
  /** The half angle the strands come from, round `at`. */
  readonly from: number;
  readonly at?: number;
  readonly width?: number;
}
/** Strands drawn from the back of the head to a point (a tie, a bun). */
function gather(k: HairKit, g: V3, o: Gather): void {
  const { n, from, width = 0.0055 } = o;
  const at = o.at ?? PI;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * 2 - 1;
    const p0 = BLEND ? surf(k, at + s * from, 0.16 - 0.04 * Math.abs(s), -0.006) : k.onHead(at + s * from, 0.16 - 0.04 * Math.abs(s), 0.02);
    const mid: V3 = [(p0[0] + g[0]) / 2, (p0[1] + g[1]) / 2 + 0.01, (p0[2] + g[2]) / 2 - 0.01];
    k.lock([p0, mid, g], BLEND ? [width * 0.16, width, width * 0.8] : [width * 0.8, width, width * 0.8], 0.01);
  }
}

interface Bun {
  readonly c: V3;
  readonly r: V3;
  /** Strands wound round it, and how much they twist from pole to pole. */
  readonly wrap?: number;
  readonly twist?: number;
}
/** A bun, with strands wound round it. */
function bun(k: HairKit, o: Bun): void {
  const { c, r, wrap = 10, twist = 1.5 } = o;
  ball(k, c, r);
  for (let i = 0; i < wrap; i++) {
    const a0 = (i / wrap) * TAU;
    const path: V3[] = [];
    for (let j = 0; j <= 6; j++) {
      const th = (j / 6) * PI;
      const a = a0 + twist * th;
      path.push([c[0] + r[0] * 1.07 * Math.sin(th) * Math.cos(a), c[1] + r[1] * 1.07 * Math.cos(th), c[2] + r[2] * 1.07 * Math.sin(th) * Math.sin(a)]);
    }
    k.lock(path, [0, 0.004, 0.0055, 0.006, 0.0055, 0.004, 0], 0.008);
  }
}

interface Tail {
  /** The tie. */
  readonly g: V3;
  readonly len: number;
  readonly n?: number;
  /** How far it stands out from the head before it falls. */
  readonly out?: number;
  readonly spread?: number;
  readonly width?: number;
  readonly from?: number;
  readonly at?: number;
  /** Where it drifts to by its end. */
  readonly dx?: number;
  readonly dz?: number;
  readonly wave?: number;
  readonly curl?: number;
}
/** A tail: strands from the head gathered at a tie and falling from it, with the tie. */
function tail(k: HairKit, o: Tail): void {
  const { g, len, n = 18, out = 0.05, spread = 0.035, width = 0.0075, from = 1.3, dx = 0, dz = 0, wave = 0.006, curl = 0 } = o;
  const at = o.at ?? PI;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * 2 - 1;
    const L = len * (1 - 0.2 * frac(i));
    const w = wave * Math.sin(i * 1.3);
    const sp = s * spread;
    const p0 = BLEND ? surf(k, at + s * from, 0.16 - 0.04 * Math.abs(s), -0.006) : k.onHead(at + s * from, 0.16 - 0.04 * Math.abs(s), 0.02);
    const mid: V3 = [(p0[0] + g[0]) / 2, (p0[1] + g[1]) / 2 + 0.01, (p0[2] + g[2]) / 2 - 0.01];
    const a = i * 0.9;
    const cx = curl * 0.02 * Math.sin(a), cz = curl * 0.02 * (Math.cos(a) - 1);
    k.lock([
      p0,
      mid,
      [g[0] + sp * 0.8, g[1], g[2] - 0.012],
      [g[0] + sp + dx * 0.3 + w, g[1] - L * 0.25, g[2] - out + dz * 0.3],
      [g[0] + sp * 1.4 + dx * 0.7 + w + cx * 0.5, g[1] - L * 0.6, g[2] - out * 0.8 + dz * 0.7 + cz * 0.5],
      [g[0] + sp * 1.7 + dx + w * 1.5 + cx, g[1] - L, g[2] - out * 0.5 + dz + cz],
    ], BLEND ? [width * 0.16, width, width, width, width * 0.85, 0] : [width * 0.8, width, width, width, width * 0.85, 0], 0.01);
  }
  ball(k, g, [0.02, 0.014, 0.02], 8);
}

const OVER: readonly V3[] = [[0.09, -0.01, -0.085], [0.115, -0.015, -0.02], [0.125, -0.03, 0.09], [0.13, -0.11, 0.135], [0.125, -0.19, 0.185], [0.12, -0.29, 0.15], [0.115, -0.39, 0.12]];
interface TailOver {
  /** The tie, low at the nape and a little to one side. */
  readonly g: V3;
  /** Which shoulder it goes over: 1 or -1. */
  readonly sd: number;
  readonly len?: number;
  readonly n?: number;
  readonly spread?: number;
  readonly width?: number;
  readonly wave?: number;
  readonly coh?: number;
  readonly curl?: number;
  readonly from?: number;
}
/** A low tail brought forward over one shoulder: strands gathered at a tie low at the nape, over the back, the top and the front of the shoulder. */
function tailOver(k: HairKit, o: TailOver): void {
  const { g, sd, len = 0.34, n = 18, spread = 0.03, width = 0.0075, wave = 0.006, coh = 1.3, curl = 0, from = 1.2 } = o;
  const at = PI * (1 + sd * 0.25);
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * 2 - 1;
    const dr = (len * (1 - 0.2 * frac(i))) / 0.34;
    const w = wave * Math.sin(i * coh);
    const sp = s * spread;
    const p0 = BLEND ? surf(k, at + s * from, 0.16 - 0.04 * Math.abs(s), -0.006) : k.onHead(at + s * from, 0.16 - 0.04 * Math.abs(s), 0.02);
    const mid: V3 = [(p0[0] + g[0]) / 2, (p0[1] + g[1]) / 2 + 0.01, (p0[2] + g[2]) / 2 - 0.01];
    const a = i * 0.9;
    const cx = curl * 0.02 * Math.sin(a), cz = curl * 0.02 * (Math.cos(a) - 1);
    const pts: V3[] = [p0, mid, [g[0] + sp * 0.8, g[1], g[2] - 0.012]];
    let prevY = g[1];
    OVER.forEach(([ox, oy, oz], j) => {
      let y = j >= 4 ? oy * dr : oy;
      if (j >= 4) y = Math.min(y, prevY - 0.03);
      prevY = y;
      pts.push([sd * ox + sp * (0.8 + 0.1 * j) + (j >= 2 ? w : 0) + (j >= 5 ? cx : 0), y, oz + (j >= 5 ? cz : 0)]);
    });
    const wd = [width * 0.8, width, width, width, width, width, width, width, width * 0.85, 0];
    ease(wd);
    k.lock(pts, wd, 0.01);
  }
  ball(k, g, [0.02, 0.014, 0.02], 8);
}

/** The line a tail over a shoulder follows (the tie, then over the back, the top and the front of the shoulder), for a braid. */
const overLine = (g: V3, sd: number, len: number): V3[] => {
  const pts: V3[] = [g, ...OVER.map(([ox, oy, oz], j): V3 => [sd * ox, j >= 4 ? oy * (len / 0.34) : oy, oz])];
  const line: V3[] = [];
  for (let i = 0; i <= 14; i++) {
    const u = (i / 14) * (pts.length - 1);
    const j = Math.min(pts.length - 2, Math.floor(u));
    const f = u - j;
    line.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f, pts[j][2] + (pts[j + 1][2] - pts[j][2]) * f]);
  }
  return line;
};

interface Braid {
  readonly g: V3;
  /** Where its end is from its top. */
  readonly dir: V3;
  /** Or the line it follows (a crown braid round the head): the strands weave up and down and in and out of it. */
  readonly line?: readonly V3[];
  readonly turns?: number;
  readonly width?: number;
  readonly amp?: number;
}
/** A three-strand braid: the strands weave about its line. */
function braid(k: HairKit, o: Braid): void {
  const { g, dir, turns = 5, width = 0.013, amp = 0.014, line } = o;
  const M = line ? line.length : 11;
  for (let j = 0; j < 3; j++) {
    const path: V3[] = [];
    const wd: number[] = [];
    for (let i = 0; i < M; i++) {
      const t = i / (M - 1);
      const ph = t * turns * TAU + (j * TAU) / 3;
      const a = amp * (1 - 0.5 * t);
      if (line) {
        const c = line[i];
        const rl = Math.hypot(c[0], c[2] + 0.006) || 1;
        const co = a * Math.cos(ph);
        path.push([c[0] + (c[0] / rl) * co, c[1] + a * Math.sin(ph), c[2] + ((c[2] + 0.006) / rl) * co]);
      } else path.push([g[0] + dir[0] * t + a * Math.sin(ph), g[1] + dir[1] * t, g[2] + dir[2] * t + a * 0.9 * Math.cos(ph)]);
      wd.push(i === M - 1 ? 0 : i === 0 ? width * 0.7 : i > M - 3 ? width * 0.6 : width * (1 - 0.35 * t));
    }
    k.lock(path, wd, 0.013);
  }
}

// ---- The cuts ----
const LONG: Fall = { n: 40, spread: 0.9, len: -0.42 };
const LOB: Fall = { n: 40, spread: 1.1, len: -0.17, jit: 0.1, flare: 1.08 };
const BOB: Fall = { n: 40, spread: 1.25, len: -0.04, jit: 0.03, flare: 1.0, tuck: 0.15 };

/** A crown braid's line: from above one ear, up over the back of the head to above the other. */
const crownLine = (k: HairKit, lift = 0, a0 = 0.15): V3[] => {
  const line: V3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    line.push(k.onHead(PI * 0.5 + a0 + t * (PI - 2 * a0), 0.12 + lift + 0.07 * Math.sin(t * PI), 0.034));
  }
  return line;
};
/** Strands sprayed up and out of a claw clip at `g`. */
function spray(k: HairKit, g: V3, n: number): void {
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * 2 - 1;
    k.lock([g, [g[0] + s * 0.02, g[1] + 0.03, g[2] - 0.012], [g[0] + s * 0.05, g[1] + 0.065 + 0.01 * frac(i), g[2] - 0.022]], [0.006, 0.0065, 0], 0.01);
  }
}

/** A hair stick through a bun: a thin straight pin from one point to another. */
const stick = (k: HairKit, a: V3, b: V3): void => k.lock([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b], [0.0035, 0.0035, 0.0035], 0.004);
/** A bow: two loops either side of a knot, at c. */
const bow = (k: HairKit, c: V3): void => {
  for (const sd of [-1, 1]) ball(k, [c[0] + sd * 0.04, c[1], c[2]], [0.035, 0.022, 0.016], 8);
  ball(k, c, [0.014, 0.014, 0.014], 8);
};
/** A strip of braid from near a temple back to the nape, joined behind. */
const templeLine = (k: HairKit, sd: number): V3[] => {
  const line: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    line.push(k.onHead(-sd * (1.5 + t * (PI - 1.7)), 0.155 + 0.015 * t, 0.024));
  }
  return line;
};
/** A cut's cap: with blending on, its edge is cut into points (mobShape.ts's shell `spike`) for the strands to come out of. */
export const hairCap = (name: DetailedHair): Cap => (BLEND ? { ...DO[name].cap, spike: 0.014, spikeBack: 1 } : DO[name].cap);
/** Builds a cut. */
export const buildDetailedHair = (name: DetailedHair, k: HairKit): void => {
  CAPX = DO[name].cap;
  // (Blended: each strand its own tone, a multiple of the hair's colour from a little darker to much lighter than the cap's, so the strands read on it.)
  let strand = 0;
  DO[name].build(BLEND ? { ...k, lock: (p, w, t, h, tone) => k.lock(p, w, t, h, tone ?? 0.8 + 1.0 * frac(strand++ * 3.1)) } : k);
};
export const DO: Record<DetailedHair, Do> = {
  // (Low ponytails, from the user's references: a low tie at the nape, over a shoulder or down the back, strands framing the face.)
  lowpony_over_loose: {
    cap: CAP_UP,
    build: (k) => {
      tailOver(k, { g: [0.055, 0.04, -0.115], sd: 1, len: 0.36, curl: 0.4, wave: 0.01, n: 20 });
      sides(k, { n: 5, len: -0.24, width: 0.005 });
      bangs(k, { kind: 'curtain', n: 14, tip: 0.09, sweep: 0.35 });
    },
  },
  lowpony_over_sleek: {
    cap: CAP_SLEEK,
    build: (k) => {
      tailOver(k, { g: [-0.055, 0.04, -0.115], sd: -1, len: 0.34, wave: 0.003, spread: 0.026, n: 18 });
      sides(k, { n: 2, len: -0.14, width: 0.0045 });
      bangs(k, { kind: 'swept', n: 12, tip: 0.1, sweep: 0.3 });
    },
  },
  lowpony_back_center: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.04, -0.125], len: 0.36, out: 0.02, from: 1.2, wave: 0.008, n: 20 });
      sides(k, { n: 4, len: -0.2, width: 0.005 });
      bangs(k, { kind: 'curtain', n: 14, tip: 0.09, sweep: 0.3 });
    },
  },
  lowpony_back_loose: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.05, -0.125], len: 0.3, out: 0.02, from: 1.2, curl: 0.6, wave: 0.014, n: 22 });
      sides(k, { n: 5, len: -0.22, flip: 1, width: 0.005 });
      bangs(k, { kind: 'wispy', n: 12, tip: 0.105 });
    },
  },
  lowpony_braid_over: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0.07, 0.04, -0.11], len: 0.04, out: 0.02, at: PI * 1.25, from: 1.1, n: 14 });
      braid(k, { g: [0.07, 0.035, -0.11], dir: [0, 0, 0], line: overLine([0.07, 0.035, -0.11], 1, 0.36), turns: 7, width: 0.013, amp: 0.015 });
      sides(k, { n: 6, len: -0.3, width: 0.005 });
      bangs(k, { kind: 'curtain', n: 14, tip: 0.09, sweep: 0.35 });
    },
  },
  lowpony_wavy_over: {
    cap: CAP_UP,
    build: (k) => {
      tailOver(k, { g: [0.055, 0.04, -0.115], sd: 1, len: 0.38, wave: 0.014, coh: 0.3, curl: 0.25, n: 22 });
      sides(k, { n: 4, len: -0.26, width: 0.005 });
      bangs(k, { kind: 'curtain', n: 14, tip: 0.09, sweep: 0.3 });
    },
  },
  lowpony_tendrils: {
    cap: CAP_SLEEK,
    build: (k) => {
      tailOver(k, { g: [0.05, 0.04, -0.115], sd: 1, len: 0.3, spread: 0.028, n: 18 });
      sides(k, { n: 3, len: -0.15, width: 0.0045 });
    },
  },
  // (The old anime cuts, in fine strands: the same hairlines, lengths and places.)
  short_fine: { cap: CAP_OLD_CROP, build: (k) => { fall(k, { n: 38, spread: 1.3, len: 0.02, jit: 0.3, flare: 1.0, lift: 0.014 }); bangs(k, { kind: 'curtain', n: 14, tip: 0.1, sweep: 0.12 }); } },
  bob_fine: { cap: CAP_OLD_BOB, build: (k) => { fall(k, { n: 42, spread: 1.25, len: -0.04, jit: 0.05, flare: 1.0, tuck: 0.15, lift: 0.014 }); sides(k, { n: 4, len: -0.03 }); bangs(k, { kind: 'curtain', n: 14, tip: 0.1, sweep: 0.12 }); } },
  long_fine: { cap: CAP_OLD_LONG, build: (k) => { fall(k, { n: 46, spread: 0.95, len: -0.42, jit: 0.15, lift: 0.014 }); sides(k, { n: 5, len: -0.13 }); bangs(k, { kind: 'curtain', n: 14, tip: 0.1, sweep: 0.12 }); } },
  ponytail_fine: { cap: CAP_OLD_BACK, build: (k) => { tail(k, { g: [0, 0.176, -0.1], len: 0.27, out: 0.065, n: 18 }); sides(k, { n: 3, len: -0.13 }); bangs(k, { kind: 'curtain', n: 14, tip: 0.1, sweep: 0.12 }); } },
  twin_fine: {
    cap: CAP_OLD_BACK,
    build: (k) => {
      for (const sd of [-1, 1]) tail(k, { g: [sd * 0.09, 0.172, -0.02], len: 0.3, out: 0.02, at: PI * (1 + sd * 0.4), from: 0.8, n: 16, dx: sd * 0.06, spread: 0.04 });
      sides(k, { n: 3, len: -0.13 });
      bangs(k, { kind: 'curtain', n: 14, tip: 0.1, sweep: 0.12 });
    },
  },
  bun_fine: {
    cap: CAP_OLD_UP,
    build: (k) => {
      bun(k, { c: [0, 0.19, -0.105], r: [0.056, 0.05, 0.048], wrap: 10, twist: 1.5 });
      gather(k, [0, 0.185, -0.105], { n: 12, from: 1.2 });
      sides(k, { n: 3, len: -0.13 });
      bangs(k, { kind: 'curtain', n: 14, tip: 0.1, sweep: 0.12 });
    },
  },
  // (The third batch.)
  long_hollywood: { cap: CAP_FULL, build: (k) => { fall(k, { n: 44, spread: 0.95, len: -0.34, jit: 0.1, wave: 0.02, coh: 0.22, flare: 1.2, curl: 0.1 }); sides(k, { n: 6, len: -0.3, heavy: [2, 0.3] }); bangs(k, { kind: 'swept', n: 10, tip: 0.1, sweep: 0.4 }); } },
  long_tousled: { cap: CAP_FULL, build: (k) => { fall(k, { n: 44, spread: 1.0, len: -0.38, jit: 0.45, wave: 0.03, coh: 1.1, flare: 1.3 }); sides(k, { n: 4, len: -0.22, flip: 1 }); bangs(k, { kind: 'wispy', n: 12, tip: 0.11 }); } },
  long_beach: { cap: CAP_FULL, build: (k) => { fall(k, { n: 44, spread: 0.95, len: -0.36, jit: 0.3, wave: 0.03, coh: 0.35, flare: 1.2, curl: 0.15 }); sides(k, { n: 5, len: -0.25 }); bangs(k, { kind: 'curtain', n: 12, tip: 0.1 }); } },
  long_ringlets: { cap: CAP_FULL, build: (k) => { fall(k, { n: 46, spread: 0.95, len: -0.3, jit: 0.3, curl: 1.6, flare: 1.3, wave: 0.01 }); sides(k, { n: 5, len: -0.2, flip: 1 }); } },
  long_over_shoulder: { cap: CAP_PART, build: (k) => { fall(k, { n: 30, spread: 0.7, len: -0.4 }); sides(k, { n: 5, len: -0.38, width: 0.0065, fwd: 0.02, fan: 0.0045, heavy: [2.4, 0] }); bangs(k, { kind: 'swept', n: 10, tip: 0.1 }); } },
  long_wispy: { cap: CAP_PART, build: (k) => { fall(k, { n: 40, spread: 0.9, len: -0.42, jit: 0.65, width: 0.0045 }); sides(k, { n: 6, len: -0.3, width: 0.0045 }); bangs(k, { kind: 'wispy', n: 12, tip: 0.115 }); } },
  lob_wispy: { cap: CAP_LOB, build: (k) => { fall(k, { ...LOB, jit: 0.4, width: 0.0045 }); sides(k, { n: 5, len: -0.12, width: 0.0045 }); bangs(k, { kind: 'wispy', n: 12, tip: 0.112 }); } },
  lob_beach: { cap: CAP_LOB, build: (k) => { fall(k, { ...LOB, wave: 0.025, coh: 0.35, flare: 1.2, curl: 0.2 }); sides(k, { n: 5, len: -0.12, flip: 0.6 }); bangs(k, { kind: 'curtain', n: 12, tip: 0.105 }); } },
  lob_ringlets: { cap: CAP_LOB, build: (k) => { fall(k, { ...LOB, curl: 1.4, flare: 1.25 }); sides(k, { n: 5, len: -0.12, flip: 1 }); } },
  lob_layers: { cap: CAP_LOB, build: (k) => { fall(k, { n: 44, spread: 1.1, len: -0.16, jit: 0.5, flare: 1.15 }); sides(k, { n: 6, len: -0.1 }); bangs(k, { kind: 'curtain', n: 12, tip: 0.1 }); } },
  lob_sidepart: { cap: CAP_LOB, build: (k) => { fall(k, LOB); sides(k, { n: 6, len: -0.14, heavy: [1.8, 0.3] }); bangs(k, { kind: 'swept', n: 12, tip: 0.1, sweep: 0.35 }); } },
  bob_french: { cap: CAP_BOB, build: (k) => { fall(k, BOB); sides(k, { n: 5, len: -0.02 }); bangs(k, { kind: 'blunt', n: 14, tip: 0.13 }); } },
  bob_inverted: { cap: CAP_BOB, build: (k) => { fall(k, { ...BOB, len: 0.04, tuck: 0.3 }); sides(k, { n: 7, len: -0.12, fwd: 0.02 }); bangs(k, { kind: 'curtain', n: 12, tip: 0.105 }); } },
  bob_curly: { cap: CAP_BOB, build: (k) => { fall(k, { n: 44, spread: 1.25, len: -0.04, jit: 0.3, flare: 1.1, curl: 1.0 }); sides(k, { n: 4, len: -0.03 }); bangs(k, { kind: 'wispy', n: 10, tip: 0.112 }); } },
  pixie_long: { cap: CAP_PIXIE, build: (k) => { fall(k, { n: 30, spread: 1.3, len: 0.02, jit: 0.3, flare: 1.0 }); bangs(k, { kind: 'swept', n: 14, tip: 0.09, sweep: 0.45, width: 0.0075 }); sides(k, { n: 3, len: -0.03 }); } },
  pixie_wisps: { cap: CAP_PIXIE, build: (k) => { fall(k, { n: 34, spread: 1.3, len: 0.03, jit: 0.5, width: 0.0045, flare: 1.0 }); bangs(k, { kind: 'wispy', n: 12, tip: 0.12 }); } },
  crop_buzz: { cap: CAP_BUZZ, build: (k) => { fall(k, { n: 24, spread: 1.3, len: 0.06, jit: 0.2, width: 0.004, flare: 1.0 }); } },
  bowl: { cap: CAP_BOB, build: (k) => { fall(k, { n: 40, spread: 1.3, len: 0.02, jit: 0, flare: 1.0, tuck: 0.3 }); sides(k, { n: 6, len: -0.02 }); bangs(k, { kind: 'blunt', n: 16, tip: 0.1 }); } },
  bun_stick: {
    cap: CAP_UP,
    build: (k) => {
      bun(k, { c: [0, 0.12, -0.11], r: [0.055, 0.05, 0.048], wrap: 10, twist: 2 });
      gather(k, [0, 0.12, -0.11], { n: 12, from: 1.2 });
      stick(k, [-0.085, 0.07, -0.168], [0.085, 0.17, -0.168]);
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  bun_side_high: {
    cap: CAP_UP,
    build: (k) => {
      bun(k, { c: [-0.075, 0.2, -0.05], r: [0.05, 0.045, 0.045], wrap: 8, twist: 1.5 });
      gather(k, [-0.07, 0.18, -0.05], { n: 10, from: 1.0, at: PI * 0.6 });
      bangs(k, { kind: 'swept', n: 10, tip: 0.108, sweep: 0.3 });
    },
  },
  bun_pair_low: {
    cap: CAP_SLEEK,
    build: (k) => {
      bun(k, { c: [-0.055, 0.04, -0.115], r: [0.04, 0.04, 0.038], wrap: 8, twist: 1.2 });
      bun(k, { c: [0.055, 0.04, -0.115], r: [0.04, 0.04, 0.038], wrap: 8, twist: 1.2 });
      gather(k, [-0.05, 0.05, -0.11], { n: 8, from: 0.9, at: PI * 0.75 });
      gather(k, [0.05, 0.05, -0.11], { n: 8, from: 0.9, at: PI * 1.25 });
      bangs(k, { kind: 'blunt', n: 12, tip: 0.108 });
    },
  },
  topknot_messy: {
    cap: CAP_UP,
    build: (k) => {
      bun(k, { c: [0, 0.25, -0.03], r: [0.062, 0.045, 0.055], wrap: 12, twist: 2.5 });
      gather(k, [0, 0.225, -0.03], { n: 14, from: 1.0 });
      sides(k, { n: 2, len: -0.06, fan: 0.01 });
      bangs(k, { kind: 'wispy', n: 10, tip: 0.115 });
    },
  },
  french_roll: {
    cap: CAP_SLEEK,
    build: (k) => {
      bun(k, { c: [0, 0.1, -0.115], r: [0.05, 0.12, 0.04], wrap: 12, twist: 3 });
      gather(k, [0, 0.15, -0.11], { n: 16, from: 1.2 });
      bangs(k, { kind: 'swept', n: 10, tip: 0.11 });
    },
  },
  updo_pinned: {
    cap: CAP_SLEEK,
    build: (k) => {
      for (const [y, rx] of [[0.06, 0.05], [0.12, 0.052], [0.18, 0.048]] as const) bun(k, { c: [0, y, -0.115], r: [rx, 0.035, 0.04], wrap: 6, twist: 1 });
      gather(k, [0, 0.12, -0.11], { n: 14, from: 1.2 });
      stick(k, [-0.07, 0.15, -0.16], [0.07, 0.15, -0.16]);
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  bun_odango_tails: {
    cap: CAP_UP,
    build: (k) => {
      for (const sd of [-1, 1]) {
        bun(k, { c: [sd * 0.085, 0.215, -0.04], r: [0.04, 0.04, 0.04], wrap: 8, twist: 1.5 });
        tail(k, { g: [sd * 0.085, 0.19, -0.04], len: 0.26, out: 0.03, at: PI * (1 - sd * 0.3), from: 0.8, n: 8, dx: sd * 0.03 });
      }
      bangs(k, { kind: 'blunt', n: 12, tip: 0.108 });
    },
  },
  half_up_buns: {
    cap: CAP_PART,
    build: (k) => {
      fall(k, { n: 36, spread: 0.9, len: -0.38, jit: 0.2 });
      for (const sd of [-1, 1]) {
        bun(k, { c: [sd * 0.05, 0.215, -0.05], r: [0.032, 0.03, 0.03], wrap: 6, twist: 1.5 });
        gather(k, [sd * 0.05, 0.205, -0.05], { n: 6, from: 0.7, at: PI * (1 - sd * 0.4), width: 0.005 });
      }
      sides(k, { n: 4, len: -0.22 });
    },
  },
  pony_bubble: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.19, -0.1], len: 0.36, out: 0.05 });
      for (const y of [0.075, -0.045]) ball(k, [0, y, -0.142], [0.034, 0.012, 0.03], 8);
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  pony_half: {
    cap: CAP_PART,
    build: (k) => {
      fall(k, { n: 34, spread: 0.95, len: -0.36 });
      tail(k, { g: [0, 0.19, -0.09], len: 0.18, out: 0.04, n: 12, from: 0.9 });
      sides(k, { n: 4, len: -0.22 });
    },
  },
  pony_bow: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.19, -0.1], len: 0.34, out: 0.05 });
      bow(k, [0, 0.215, -0.11]);
      bangs(k, { kind: 'blunt', n: 12, tip: 0.108 });
    },
  },
  pigtails_curly: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [-0.1, 0.17, -0.04], len: 0.3, out: 0.03, at: PI * 1.3, from: 0.9, n: 16, dx: -0.035, curl: 1.2 });
      tail(k, { g: [0.1, 0.17, -0.04], len: 0.3, out: 0.03, at: PI * 0.7, from: 0.9, n: 16, dx: 0.035, curl: 1.2 });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  braid_fishtail: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.05, -0.12], len: 0.05, out: 0.02, from: 1.2, n: 14 });
      braid(k, { g: [0, 0.04, -0.12], dir: [0, -0.42, -0.01], turns: 9, width: 0.0085, amp: 0.009 });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  braid_thick: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.05, -0.12], len: 0.05, out: 0.02, from: 1.2, n: 14 });
      braid(k, { g: [0, 0.04, -0.125], dir: [0, -0.42, -0.015], turns: 4, width: 0.018, amp: 0.02 });
      bangs(k, { kind: 'swept', n: 10, tip: 0.108 });
    },
  },
  pony_braided: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.19, -0.1], len: 0.05, out: 0.05, n: 14 });
      braid(k, { g: [0, 0.185, -0.12], dir: [0, -0.45, -0.03] });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  braid_milkmaid: {
    cap: CAP_UP,
    build: (k) => {
      braid(k, { g: [0, 0, 0], dir: [0, 0, 0], line: crownLine(k, 0, 0.1), turns: 12, width: 0.0085, amp: 0.01 });
      braid(k, { g: [0, 0, 0], dir: [0, 0, 0], line: crownLine(k, 0.035, 0.3), turns: 10, width: 0.0085, amp: 0.01 });
      bangs(k, { kind: 'blunt', n: 12, tip: 0.108 });
    },
  },
  braid_half_up: {
    cap: CAP_PART,
    build: (k) => {
      fall(k, { n: 34, spread: 0.9, len: -0.38 });
      for (const sd of [-1, 1]) braid(k, { g: [0, 0, 0], dir: [0, 0, 0], line: templeLine(k, sd), turns: 6, width: 0.008, amp: 0.009 });
      ball(k, [0, 0.14, -0.118], [0.022, 0.014, 0.018], 8);
    },
  },
  // (The second batch.)
  long_blunt: { cap: CAP_FULL, build: (k) => { fall(k, { n: 40, spread: 0.9, len: -0.4, jit: 0, flare: 1.0 }); sides(k, { n: 5, len: -0.3 }); bangs(k, { kind: 'blunt', n: 16, tip: 0.108 }); } },
  long_feather: { cap: CAP_FULL, build: (k) => { fall(k, { n: 44, spread: 0.95, len: -0.4, jit: 0.35, wave: 0.012, coh: 0.3, flip: 0.6 }); sides(k, { n: 6, len: -0.22, flip: 1.2 }); bangs(k, { kind: 'curtain', n: 12, tip: 0.1 }); } },
  long_shag: { cap: CAP_FULL, build: (k) => { fall(k, { n: 48, spread: 1.0, len: -0.38, jit: 0.55, flare: 1.3, wave: 0.02, coh: 0.5 }); sides(k, { n: 6, len: -0.2, fan: 0.008 }); bangs(k, { kind: 'wispy', n: 12, tip: 0.11 }); } },
  lob_tuck: { cap: CAP_LOB, build: (k) => { fall(k, { ...LOB, tuck: 0.45 }); sides(k, { n: 5, len: -0.1 }); bangs(k, { kind: 'blunt', n: 14, tip: 0.108 }); } },
  lob_blunt: { cap: CAP_LOB, build: (k) => { fall(k, { ...LOB, len: -0.14, jit: 0, flare: 1.0 }); sides(k, { n: 5, len: -0.14 }); bangs(k, { kind: 'blunt', n: 16, tip: 0.106 }); } },
  bob_asym: { cap: CAP_BOB, build: (k) => { fall(k, { ...BOB, len: 0.0 }); sides(k, { n: 6, len: -0.13, heavy: [2.2, 0.2], fwd: 0.015 }); bangs(k, { kind: 'swept', n: 12, tip: 0.1, sweep: 0.35 }); } },
  crop_curl: { cap: CAP_BOB, build: (k) => { fall(k, { n: 36, spread: 1.25, len: -0.02, jit: 0.3, flare: 1.04, curl: 0.8, wave: 0.01 }); sides(k, { n: 4, len: -0.03 }); bangs(k, { kind: 'wispy', n: 10, tip: 0.112 }); } },
  bob_shaggy: { cap: CAP_BOB, build: (k) => { fall(k, { n: 44, spread: 1.25, len: -0.04, jit: 0.5, flare: 1.1, wave: 0.015, coh: 0.6 }); sides(k, { n: 5, len: -0.05 }); bangs(k, { kind: 'curtain', n: 12, tip: 0.105 }); } },
  bun_double: {
    cap: CAP_UP,
    build: (k) => {
      for (const sd of [-1, 1]) {
        bun(k, { c: [sd * 0.075, 0.2, -0.04], r: [0.04, 0.04, 0.04], wrap: 8, twist: 1.5 });
        gather(k, [sd * 0.07, 0.18, -0.04], { n: 8, from: 0.8, at: PI * (1 - sd * 0.3) });
      }
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  bun_high: { cap: CAP_SLEEK, build: (k) => { bun(k, { c: [0, 0.215, -0.095], r: [0.05, 0.045, 0.045], wrap: 8, twist: 1.2 }); gather(k, [0, 0.2, -0.095], { n: 14, from: 1.1 }); } },
  claw: {
    cap: CAP_UP,
    build: (k) => {
      bun(k, { c: [0, 0.1, -0.115], r: [0.05, 0.07, 0.04], wrap: 6, twist: 2 });
      gather(k, [0, 0.15, -0.11], { n: 14, from: 1.2 });
      spray(k, [0, 0.16, -0.125], 9);
      bangs(k, { kind: 'wispy', n: 10, tip: 0.112 });
    },
  },
  updo_loose: {
    cap: CAP_UP,
    build: (k) => {
      bun(k, { c: [0, 0.12, -0.11], r: [0.06, 0.05, 0.05], wrap: 10, twist: 2 });
      gather(k, [0, 0.12, -0.11], { n: 12, from: 1.2 });
      fall(k, { n: 12, spread: 0.5, len: -0.16, jit: 0.5, width: 0.0045 });
      sides(k, { n: 4, len: -0.14 });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  pony_curly: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.19, -0.1], len: 0.3, out: 0.05, curl: 1, n: 20 });
      sides(k, { n: 2, len: -0.1, flip: 1 });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  braids_high: {
    cap: CAP_UP,
    build: (k) => {
      for (const sd of [-1, 1]) {
        tail(k, { g: [sd * 0.1, 0.16, -0.05], len: 0.04, out: 0.02, at: PI * (1 - sd * 0.35), from: 0.8, n: 10 });
        braid(k, { g: [sd * 0.1, 0.15, -0.05], dir: [sd * 0.03, -0.4, 0.0], width: 0.0115, amp: 0.012 });
      }
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  braid_crown: {
    cap: CAP_UP,
    build: (k) => {
      braid(k, { g: [0, 0, 0], dir: [0, 0, 0], line: crownLine(k), turns: 12, width: 0.0095, amp: 0.011 });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  // Long
  strands: { cap: CAP_PART, build: (k) => fall(k, LONG) },
  long_side: {
    cap: CAP_PART,
    build: (k) => {
      fall(k, LONG);
      sides(k, { n: 6, len: -0.26, heavy: [1.7, 0.4] });
      bangs(k, { kind: 'swept', n: 10, tip: 0.1, sweep: 0.3 });
    },
  },
  long_wavy: { cap: CAP_FULL, build: (k) => { fall(k, { n: 44, spread: 0.95, len: -0.4, wave: 0.022, coh: 0.25, flare: 1.2, curl: 0.2 }); sides(k, { n: 4, len: -0.24 }); } },
  long_curly: {
    cap: CAP_FULL,
    build: (k) => {
      fall(k, { n: 44, spread: 0.95, len: -0.34, jit: 0.25, wave: 0.01, curl: 1, flare: 1.25 });
      sides(k, { n: 5, len: -0.2, flip: 1 });
    },
  },
  long_layered: {
    cap: CAP_FULL,
    build: (k) => {
      fall(k, { n: 44, spread: 0.95, len: -0.4, jit: 0.45 });
      sides(k, { n: 6, len: -0.18 });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.1 });
    },
  },
  hime: {
    cap: CAP_FULL,
    build: (k) => {
      fall(k, { n: 40, spread: 0.9, len: -0.45, jit: 0.05 });
      sides(k, { n: 8, len: -0.07, width: 0.007, fwd: 0.03 });
      bangs(k, { kind: 'blunt', n: 16, tip: 0.1 });
    },
  },
  long_bangs: {
    cap: CAP_PART,
    build: (k) => {
      fall(k, LONG);
      sides(k, { n: 5, len: -0.3 });
      bangs(k, { kind: 'wispy', n: 12, tip: 0.115 });
    },
  },
  long_curtain: {
    cap: CAP_PART,
    build: (k) => {
      fall(k, { ...LONG, wave: 0.015, coh: 0.3 });
      sides(k, { n: 5, len: -0.3 });
      bangs(k, { kind: 'curtain', n: 14, tip: 0.1 });
    },
  },
  // Shoulder length
  lob: { cap: CAP_LOB, build: (k) => { fall(k, LOB); sides(k, { n: 5, len: -0.12 }); bangs(k, { kind: 'curtain', n: 12, tip: 0.105 }); } },
  lob_wave: { cap: CAP_LOB, build: (k) => { fall(k, { ...LOB, wave: 0.014, coh: 0.25, flare: 1.2, curl: 0.25 }); sides(k, { n: 5, len: -0.12, flip: 0.6 }); } },
  flip: { cap: CAP_LOB, build: (k) => { fall(k, { ...LOB, len: -0.13, flip: 1 }); sides(k, { n: 5, len: -0.1, flip: 1 }); bangs(k, { kind: 'swept', n: 10, tip: 0.105 }); } },
  wolf: {
    cap: CAP_FULL,
    build: (k) => {
      fall(k, { n: 48, spread: 1.15, len: -0.2, jit: 0.5, flare: 1.25, wave: 0.02, coh: 0.5 });
      sides(k, { n: 6, len: -0.16, fan: 0.008 });
      bangs(k, { kind: 'wispy', n: 12, tip: 0.108 });
    },
  },
  mid_curtain: { cap: CAP_LOB, build: (k) => { fall(k, { ...LOB, len: -0.2 }); sides(k, { n: 5, len: -0.15 }); bangs(k, { kind: 'curtain', n: 14, tip: 0.098 }); } },
  mid_side: {
    cap: CAP_LOB,
    build: (k) => {
      fall(k, { ...LOB, len: -0.18 });
      sides(k, { n: 6, len: -0.14, heavy: [1.8, 0.3] });
      bangs(k, { kind: 'swept', n: 12, tip: 0.1, sweep: 0.35 });
    },
  },
  // Short
  bob_blunt: { cap: CAP_BOB, build: (k) => { fall(k, BOB); sides(k, { n: 6, len: -0.03, fwd: 0.01 }); bangs(k, { kind: 'blunt', n: 14, tip: 0.108 }); } },
  bob_aline: { cap: CAP_BOB, build: (k) => { fall(k, { ...BOB, len: 0.02 }); sides(k, { n: 6, len: -0.1, fwd: 0.015 }); bangs(k, { kind: 'swept', n: 10, tip: 0.108 }); } },
  bob_curl: { cap: CAP_BOB, build: (k) => { fall(k, { ...BOB, tuck: 0.5, wave: 0.01, coh: 0.3 }); sides(k, { n: 6, len: -0.03 }); bangs(k, { kind: 'curtain', n: 12, tip: 0.105 }); } },
  bob_side: { cap: CAP_BOB, build: (k) => { fall(k, BOB); sides(k, { n: 6, len: -0.04, heavy: [1.8, 0.4] }); bangs(k, { kind: 'swept', n: 12, tip: 0.098, sweep: 0.4 }); } },
  pixie: { cap: CAP_PIXIE, build: (k) => { fall(k, { n: 30, spread: 1.3, len: 0.04, jit: 0.3, flare: 1.0 }); bangs(k, { kind: 'swept', n: 10, tip: 0.125, width: 0.0065 }); } },
  short_wave: { cap: CAP_BOB, build: (k) => { fall(k, { n: 40, spread: 1.25, len: 0.0, jit: 0.2, flare: 1.04, wave: 0.012, coh: 0.3, flip: 0.5 }); sides(k, { n: 4, len: -0.03 }); bangs(k, { kind: 'wispy', n: 10, tip: 0.112 }); } },
  tomboy: { cap: CAP_PIXIE, build: (k) => { fall(k, { n: 32, spread: 1.3, len: 0.03, jit: 0.3, flare: 1.0 }); bangs(k, { kind: 'swept', n: 12, tip: 0.1, sweep: 0.4, width: 0.007 }); } },
  // Up
  sleek: {
    cap: CAP_SLEEK,
    build: (k) => {
      ball(k, [0, 0.18, -0.106], [0.055, 0.045, 0.048]);
      // Strands drawn from the parting into the bun, round its sides and over the top.
      const N = 12;
      for (let i = 0; i < N; i++) {
        const s = ((i + 0.5) / N) * 2 - 1;
        const phi = PI + s * 0.8;
        k.lock([k.onHead(phi, 0.17, 0.02), k.onHead(phi, 0.16, 0.04), [s * 0.05, 0.185, -0.155], [s * 0.02, 0.2, -0.14], [0, 0.2, -0.12]], [0.0055, 0.0055, 0.005, 0.0035, 0], 0.01);
      }
    },
  },
  bun_messy: {
    cap: CAP_UP,
    build: (k) => {
      bun(k, { c: [0, 0.21, -0.09], r: [0.065, 0.05, 0.06], wrap: 12, twist: 2.2 });
      gather(k, [0, 0.2, -0.1], { n: 12, from: 1.3 });
      sides(k, { n: 2, len: -0.1, fan: 0.01 });
      bangs(k, { kind: 'wispy', n: 10, tip: 0.115 });
    },
  },
  bun_low: {
    cap: CAP_SLEEK,
    build: (k) => {
      bun(k, { c: [0, 0.035, -0.125], r: [0.05, 0.045, 0.04], wrap: 10, twist: 1.2 });
      gather(k, [0, 0.04, -0.12], { n: 14, from: 1.2 });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  topknot: {
    cap: CAP_SLEEK,
    build: (k) => {
      // (A knot sunk into the crown, the hair drawn up from the back only: from all round it stood out as horns.)
      bun(k, { c: [0, 0.245, -0.035], r: [0.052, 0.036, 0.048], wrap: 8, twist: 1.5 });
      gather(k, [0, 0.225, -0.035], { n: 14, from: 1.0, width: 0.0055 });
    },
  },
  twist: {
    cap: CAP_SLEEK,
    build: (k) => {
      bun(k, { c: [0, 0.08, -0.115], r: [0.045, 0.1, 0.038], wrap: 10, twist: 2.4 });
      gather(k, [0, 0.14, -0.11], { n: 14, from: 1.2 });
      bangs(k, { kind: 'swept', n: 10, tip: 0.11 });
    },
  },
  half_up: {
    cap: CAP_PART,
    build: (k) => {
      fall(k, { n: 36, spread: 0.9, len: -0.38, jit: 0.2 });
      bun(k, { c: [0, 0.205, -0.07], r: [0.035, 0.03, 0.032], wrap: 6, twist: 1.5 });
      gather(k, [0, 0.2, -0.07], { n: 8, from: 0.9, width: 0.005 });
      sides(k, { n: 4, len: -0.22 });
    },
  },
  chignon: {
    cap: CAP_SLEEK,
    build: (k) => {
      bun(k, { c: [-0.055, 0.06, -0.115], r: [0.045, 0.045, 0.04], wrap: 10, twist: 1.5 });
      gather(k, [-0.05, 0.06, -0.11], { n: 14, from: 1.2 });
      bangs(k, { kind: 'swept', n: 10, tip: 0.108, sweep: 0.3 });
    },
  },
  // Tails and braids
  pony_high: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.19, -0.1], len: 0.34, out: 0.05 });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  pony_low: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.04, -0.125], len: 0.3, out: 0.02, from: 1.2 });
      sides(k, { n: 3, len: -0.08 });
      bangs(k, { kind: 'swept', n: 10, tip: 0.108 });
    },
  },
  pony_side: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0.1, 0.1, -0.07], len: 0.3, out: 0.03, at: PI * 0.75, from: 1.0, dx: 0.02, dz: 0.03 });
      bangs(k, { kind: 'swept', n: 10, tip: 0.108, sweep: -0.3 });
    },
  },
  twin_low: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [-0.09, 0.05, -0.1], len: 0.28, out: 0.02, at: PI * 1.25, from: 0.9, n: 14, dx: -0.02 });
      tail(k, { g: [0.09, 0.05, -0.1], len: 0.28, out: 0.02, at: PI * 0.75, from: 0.9, n: 14, dx: 0.02 });
      bangs(k, { kind: 'blunt', n: 12, tip: 0.108 });
    },
  },
  twin_high: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [-0.1, 0.17, -0.04], len: 0.32, out: 0.03, at: PI * 1.3, from: 0.9, n: 14, dx: -0.035 });
      tail(k, { g: [0.1, 0.17, -0.04], len: 0.32, out: 0.03, at: PI * 0.7, from: 0.9, n: 14, dx: 0.035 });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  braid_back: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0, 0.05, -0.12], len: 0.05, out: 0.02, from: 1.2, n: 14 });
      braid(k, { g: [0, 0.04, -0.12], dir: [0, -0.4, -0.01] });
      bangs(k, { kind: 'curtain', n: 12, tip: 0.105 });
    },
  },
  braid_side: {
    cap: CAP_UP,
    build: (k) => {
      tail(k, { g: [0.08, 0.05, -0.105], len: 0.05, out: 0.02, at: PI * 0.8, from: 1.1, n: 14 });
      braid(k, { g: [0.08, 0.04, -0.105], dir: [0.03, -0.3, 0.14] });
      bangs(k, { kind: 'swept', n: 10, tip: 0.108, sweep: -0.3 });
    },
  },
  braids_twin: {
    cap: CAP_UP,
    build: (k) => {
      for (const sd of [-1, 1]) {
        tail(k, { g: [sd * 0.09, 0.06, -0.1], len: 0.05, out: 0.02, at: PI * (1 + sd * 0.25), from: 0.9, n: 12 });
        braid(k, { g: [sd * 0.09, 0.05, -0.1], dir: [sd * 0.02, -0.3, 0.08], width: 0.0115, amp: 0.012 });
      }
      bangs(k, { kind: 'blunt', n: 12, tip: 0.108 });
    },
  },
};
