import type { Outfit } from '../district/peopleMix';
import { FACE_CHEEK, FACE_EYE, FACE_MARK } from './emoteGlsl';
import { ARM_L, ARM_R, blend, FOOT_L, FOOT_R, FORE_L, FORE_R, HEAD, one, PELVIS, pivotsOf, PROPORTIONS, SHIN_L, SHIN_R, SPINE, TemplateBuilder, THIGH_L, THIGH_R, type Body, type Hair, type Row, type Template, type V3, type Weight } from './mobRig';

/**
 * The mob's shaped generation (under review in mob.html; the district still draws real/people.ts's classic
 * templates): the same skeleton, the same lofts and the same faceless dark figures, with the body anime draws
 * (after COM3D2's models): grown-up and shapely rather than cute.
 *
 * - A woman: a high small waist, a full bust, wide hips and round buttocks, the back hollow (`Bulge`s on a torso
 *   lofted through more sections and smoothed), thighs that taper to slim knees and ankles, the legs close
 *   together, heels, thin arms, a slim neck. Her hips and legs are one surface (rings round the hips that draw in
 *   to the two thighs, the legs carrying on from the lowest: `HIP_ANGLES`, `zip`), the buttocks meeting in a cleft
 *   (`CHEEK`, where the clothes show it). A man: wide shoulders tapering to narrow hips.
 * - The same field is applied to whatever is worn over the torso, so an apron's bib, a vest or a jacket follows
 *   the body under it.
 * - Hair has volume: a thick shell over the skull from a hairline (`shell`), its edge cut into locks, with what
 *   hangs from it lofted (locks in front of the ears, long hair to the waist, a ponytail, twin tails, a bun).
 * - No face: a smooth head with a small chin, a hint of a nose in profile, ears where the hair leaves them out.
 *
 * Skin (face, neck, hands, bare legs) is tagged in the shade (`SKIN`), so the material can lift it apart from the
 * clothes (`uSkin`; 1 leaves it as dark as the rest).
 */

/** Shades: multipliers on the figure's dark colour. Skin is tagged +100 for the material's `uSkin`. */
const SKIN = 101;
const TOP = 1;
const BOTTOM = 0.78;
// (Hair and shoes are tagged too, 19 and 20: the material colours them, black hair, an elder's grey, dark shoes.)
const SHOE = 2001;
const HAIR = 1901;
const HAT = 0.5;
const WHITE = 3.6;
/**
 * Parts with a colour of their own whatever the figure's (the material's tags 2 and 3, the shade after them): a
 * police uniform's blue, a hard hat's orange, the lenses of an otaku's glasses.
 */
const POLICE = 200;
const HARD_HAT = 301;
/** The lenses of glasses: pale, whatever the figure's colour (the material's tag 4). */
const LENS = 401;
/** A stethoscope: dark blue (the material's tag 2), to show on the white coat; its chest piece brighter. */
const STETHOSCOPE = 201;
/** A nurse's whites and a doctor's coat (the same pale: they show whatever the figure's colour), a shop apron's red (tag 5), a nurse's red cross (tag 6). */
const WHITES = 400.9;
const APRON = 501;
const CROSS = 601;
/** An otaku's rucksack (dark green, tag 7), a school's track suit and gym clothes (red, tag 8), an evening dress (dark red, tag 9): their own colours too. */
const PACK = 701;
const TRACK = 801;
const GOWN = 901;
/** A yukata's sash (golden yellow, tag 10). */
const SASH = 1001;
/**
 * The rest of the outfits' own colours (people.ts TAG_COLORS): navy (tag 2: a sailor uniform's skirt and collar, a
 * man's kimono), a woman's kimono (violet, 11), a hi-vis vest (12), tan (13: a trench coat, a long skirt, shorts) and
 * the brown of bags, sky blue (14: a dress; a down jacket darker), a mini skirt's pink (15), a hoodie's grey.
 */
const NAVY = 201;
const VIOLET = 1101;
const HIVIS = 1201;
const TAN = 1301;
const BROWN = 1300.45;
const SKY = 1401;
const PINK = 1501;
/**
 * Everyday clothes, coloured by the figure (people.ts CLOTH_TOPS, CLOTH_BOTTOMS, CLOTH_SUITS: tags 16-18): a top, the
 * bottoms, a suit. So nobody's clothes are left the figure's black; only skin, hair and shoes are.
 */
const CLOTH_TOP = 1601;
const CLOTH_BOTTOM = 1701;
const SUIT = 1801;
/**
 * The shady ones' own: black (no tag: the figure's own dark, so a mobster's suit, a biker's coat and leather stay
 * black whatever is coloured), the lenses of sunglasses, the ink of a tattoo (dusty blue, 14, at a low shade).
 */
const BLACK = 1;
const SHADES = 0.3;
const INK = SKY - 0.5;

/** Each body's head against life size (a little over, with the hair's volume on top; children's larger). */
const HEAD_K: Record<Body, number> = { man: 1.06, woman: 1.1, child: 1.12, elder: 1 };
/**
 * Teens: whoever wears the school uniform, its track suit or its gym clothes (or is a school's delinquent: 'yankee') is built as the adult, slighter (a girl's bust less, the head a little
 * larger against the body), then scaled down whole, joints and all: [across, up]. real/people.ts gives them joints
 * of their own in the material (`isTeen`, its teen rows), scaled the same.
 */
export const TEEN_SCALE: Record<'woman' | 'man', readonly [number, number]> = { woman: [0.89, 0.915], man: [0.88, 0.905] };
const TEEN_HEAD = 1.05;
const TEEN_BUST = 0.6;
export const isTeen = (body: Body, outfit: Outfit): body is 'woman' | 'man' => (outfit === 'school' || outfit === 'track' || outfit === 'gym' || outfit === 'yankee') && (body === 'woman' || body === 'man');

/** A scale on every head, for trying sizes in the mob showroom (set before the templates are built: they're cached). */
let headScale = 1;
export function setShapedHeadScale(k: number): void {
  headScale = k;
}

/**
 * For the mob showroom, to compare ways of building a woman's hips (null: as the city has them). Set before a
 * template is built (real/people.ts keeps one per variant).
 */
export interface ShapedTrial {
  /** How full her bottom is in trousers (1: as FORM_FITTING clothes have it; 0: the plain seat), where the city's is ROUND_SEAT. */
  readonly rear?: number;
  /** Whether the two sides then meet in the cleft, its line drawn (the city's trousers: no, run together). */
  readonly cleft?: boolean;
  /** Where her legs part (CROTCH), and where above it her hips start to draw in to the thighs (HIPS_PART). */
  readonly crotch?: number;
  readonly part?: number;
  readonly nipple?: number;
  readonly hair?: number;
}
let trial: ShapedTrial | null = null;
export function setShapedTrial(t: ShapedTrial | null): void {
  trial = t && Object.keys(t).length ? t : null;
}
/** What the templates built now differ by from the city's (part of their cache's key). */
export const shapedVariant = (): string => (trial ? JSON.stringify(trial) : '');

/** A push on the surface: vertices within the ellipsoid (centre c, radii r) move by `push`, fading to its edge. */
interface Bulge {
  readonly c: V3;
  readonly r: V3;
  readonly push: V3;
  /** How round its top is: 2 a soft bell (the default), nearer 1 a dome. */
  readonly round?: number;
  /** Its reach above its centre, where that's longer than below (a breast: a long upper slope, the underside short). */
  readonly up?: number;
  /**
   * How round it is toward its lower edge, where that differs from `round` (eased in from the centre's height down):
   * under 1 it meets the surface below at a crease instead of fading into it (the fold under a bare breast).
   */
  readonly under?: number;
  /**
   * How far its upper half and sides are a cone's rather than a dome's (0: a dome, the default; 1: straight slopes
   * to a point): a form that comes to its tip instead of being round all over.
   */
  readonly point?: number;
  /**
   * How round it is across the body, where that differs from up and down: under 1 its sides are steep (a mound
   * that stands off the chest all the way round its sides, not a swell that fades into it).
   */
  readonly side?: number;
  /**
   * Its lower half's profile, where that's its own (a bare breast's, rounding down under its tip and back up into
   * the fold): [how far from the centre (0) to the lower edge (1), the share of the push there, how far it's let
   * down besides (m)], straight under the centre; less of it round toward the sides.
   */
  readonly lower?: readonly (readonly [number, number, number])[];
  /**
   * The two sides meet in a crease down the middle instead of running together (the buttocks' cleft): where they
   * overlap a vertex takes the nearer side's push alone, not both.
   */
  readonly cleft?: boolean;
}

/** How far past a bulge's lower edge (of its reach) the surface still goes with that edge (`Bulge.lower`). */
const LOWER_BAND = 0.6;
/** How far a field moves a point. Bulges with a centre off the middle are mirrored to the other side. */
function pushAt(x: number, y: number, z: number, field: readonly Bulge[]): V3 {
  let dx = 0, dy = 0, dz = 0;
  for (const b of field) {
    let most = 0, side = 1, mostDrop = 0, pastMost = 0;
    for (const sx of b.c[0] === 0 ? [1] : [1, -1]) {
      const ex = (x - sx * b.c[0]) / b.r[0], ey = (y - b.c[1]) / (y > b.c[1] ? (b.up ?? b.r[1]) : b.r[1]), ez = (z - b.c[2]) / b.r[2];
      /** Its form across and above: a dome, part cone where it comes to a point. */
      const form = (d2: number, lower: number): number => {
        // (How much of the way out from its centre is across the body: there `side` is its roundness.)
        const across = b.side === undefined || d2 < 1e-9 ? 0 : (ex * ex) / d2;
        const round = (b.round ?? 2) + ((b.under ?? 0) - (b.round ?? 2)) * lower;
        const dome = Math.pow(1 - d2, round + ((b.side ?? round) - round) * across);
        return b.point ? dome + (1 - Math.sqrt(d2) - dome) * b.point * (1 - lower) * (1 - across) : dome;
      };
      let k: number, drop = 0;
      if (b.lower && ey < 0) {
        // Its lower half by its own profile, out from the centre to the lower edge: how far it stands out there and
        // how far it's let down, as the profile says straight under the centre, less of both the nearer the point
        // is to beside it (where it's the form the upper half has).
        const d2 = ex * ex + ey * ey + ez * ez;
        const t = Math.sqrt(d2);
        // (Fuller round toward the sides than straight in proportion: a round lower half, not a pointed one.)
        const under = t > 1e-6 ? Math.pow(-ey / t, 0.7) : 0;
        if (t >= 1) {
          // Past its lower edge the surface goes with the edge, less and less (LOWER_BAND of its reach on): where
          // the edge is drawn up into a fold, the chest under it is drawn up behind it, not left as a step.
          const past = clamp01((t - 1) / LOWER_BAND);
          const lift = -b.lower[b.lower.length - 1][2] * under * (1 - past * past * (3 - 2 * past));
          if (!b.cleft) dy += lift;
          else if (Math.abs(lift) > Math.abs(pastMost)) pastMost = lift;
          continue;
        }
        let n = 0;
        while (n < b.lower.length - 2 && b.lower[n + 1][0] < t) n++;
        const [t0, k0, d0] = b.lower[n], [t1, k1, d1] = b.lower[n + 1];
        const u = clamp01((t - t0) / (t1 - t0));
        const beside = form(d2, 0);
        k = beside + (k0 + (k1 - k0) * u - beside) * under;
        drop = (d0 + (d1 - d0) * u) * under;
      } else {
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= 1) continue;
        const low = b.under === undefined || ey >= 0 ? 0 : Math.min(1, -ey);
        k = form(d2, low * low * (3 - 2 * low));
      }
      if (b.cleft) {
        if (k > most) {
          most = k;
          side = sx;
          mostDrop = drop;
        }
        continue;
      }
      dx += sx * b.push[0] * k;
      dy += b.push[1] * k - drop;
      dz += b.push[2] * k;
    }
    // (On the middle itself neither side's push across counts.)
    dx += (Math.abs(x) < 1e-6 ? 0 : side) * b.push[0] * most;
    // (Where it's within one side, that side's alone; only clear of both does it go with a lower edge.)
    dy += most > 0 ? b.push[1] * most - mostDrop : pastMost;
    dz += b.push[2] * most;
  }
  return [dx, dy, dz];
}
function displace(tb: TemplateBuilder, from: number, field: readonly Bulge[]): void {
  if (!field.length) return;
  const P = tb.pos;
  for (let i = from * 3; i < P.length; i += 3) {
    const d = pushAt(P[i], P[i + 1], P[i + 2], field);
    P[i] += d[0];
    P[i + 1] += d[1];
    P[i + 2] += d[2];
  }
}

/**
 * Faces between two rows of points of different counts (vertex indices, both listed the same way round, `lo` the
 * lower): a zipper, advancing along whichever row is behind by its share of the way. The vertices are shared with
 * the lofts either side, so the surface shades as one. `closed`: rings (the upper is turned to start where the
 * lower does). `flip`: the rows are listed against a loft's sense (from +z toward +x).
 */
function zip(tb: TemplateBuilder, lo: readonly number[], hi: readonly number[], closed: boolean, flip = false): void {
  const P = tb.pos;
  const dist = (a: number, b: number): number => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  let H = hi.slice();
  if (closed) {
    let k0 = 0;
    for (let k = 1; k < H.length; k++) if (dist(H[k], lo[0]) < dist(H[k0], lo[0])) k0 = k;
    H = [...H.slice(k0), ...H.slice(0, k0)];
  }
  const L = closed ? [...lo, lo[0]] : lo;
  if (closed) H.push(H[0]);
  const along = (row: readonly number[]): number[] => {
    const f = [0];
    for (let i = 1; i < row.length; i++) f.push(f[i - 1] + dist(row[i - 1], row[i]));
    return f.map((v) => v / (f[f.length - 1] || 1));
  };
  const fl = along(L), fh = along(H);
  let i = 0, k = 0;
  while (i < L.length - 1 || k < H.length - 1) {
    const stepLo = k === H.length - 1 || (i < L.length - 1 && fl[i + 1] <= fh[k + 1]);
    const c = stepLo ? L[i + 1] : H[k + 1];
    if (flip) tb.idx.push(L[i], c, H[k]);
    else tb.idx.push(L[i], H[k], c);
    if (stepLo) i++;
    else k++;
  }
}

/** How far along a ray (from o, direction u, in a horizontal section) an ellipse's far side is; 0 if it misses. */
function rayEllipse(ox: number, oz: number, ux: number, uz: number, cx: number, cz: number, a: number, b: number): number {
  const px = ox - cx, pz = oz - cz;
  const A = (ux / a) ** 2 + (uz / b) ** 2;
  const B = 2 * ((px * ux) / (a * a) + (pz * uz) / (b * b));
  const C = (px / a) ** 2 + (pz / b) ** 2 - 1;
  const D = B * B - 4 * A * C;
  return D < 0 ? 0 : Math.max(0, (-B + Math.sqrt(D)) / (2 * A));
}
/** The larger of two, rounded over where they're within k of one another. */
function smoothMax(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (a - b)) / k);
  return b + (a - b) * h + k * h * (1 - h);
}

/**
 * A loft through horizontal rings with its points at the given angles round each (from +x; pi/2 is the front), so a
 * torso can have them close together across the chest, where its form is, and few round the back.
 */
function loftAt(tb: TemplateBuilder, rows: readonly Row[], angles: readonly number[], weight: (r: Row) => Weight, shade: number, n: number): void {
  const start = tb.pos.length / 3;
  const e = 2 / n;
  const se = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);
  const m = angles.length;
  for (const r of rows) {
    const [b0, b1, w] = weight(r);
    for (const t of angles) {
      tb.pos.push(r[1] * se(Math.cos(t)), r[0], r[3] + r[2] * se(Math.sin(t)));
      tb.b0.push(b0);
      tb.b1.push(b1);
      tb.w.push(w);
      tb.shade.push(shade);
    }
  }
  for (let k = 0; k + 1 < rows.length; k++) {
    for (let j = 0; j < m; j++) {
      const a = start + k * m + j, b = start + k * m + ((j + 1) % m), c = start + (k + 1) * m + ((j + 1) % m), d = start + (k + 1) * m + j;
      tb.idx.push(a, c, b, a, d, c);
    }
  }
}
/** Every ten degrees across the front, a few round the back. */
const CHEST_ANGLES: readonly number[] = [...Array.from({ length: 16 }, (_, i) => ((15 + i * 10) * Math.PI) / 180), ...Array.from({ length: 7 }, (_, i) => ((191.25 + i * 26.25) * Math.PI) / 180)];
/**
 * Round a woman's hips, below the waist: a point on the middle in front and behind (where the legs part), close
 * together either side of the middle behind (the buttocks and the cleft between them), fewer round the sides.
 */
const HIP_ANGLES: readonly number[] = [0, 25, 50, 70, 81, 90, 99, 110, 130, 155, 180, 198, 218, 236, 250, 260, 266, 270, 274, 280, 290, 304, 322, 342].map((d) => (d * Math.PI) / 180);
const HIP_FRONT = 5, HIP_BACK = 17;
/**
 * The same with nothing on: more points close either side of the middle in front (and BARE_HIP_ROWS: more rings
 * low down, by how far above where the legs part), so the front of the hips can have form there.
 */
const BARE_HIP_DEGREES = [0, 25, 50, 70, 81, 84, 87, 88.5, 89.3, 90, 90.7, 91.5, 93, 96, 99, 110, 130, 155, 180, 198, 218, 236, 250, 260, 266, 270, 274, 280, 290, 304, 322, 342];
const BARE_HIP_ANGLES: readonly number[] = BARE_HIP_DEGREES.map((d) => (d * Math.PI) / 180);
const BARE_HIP_ROWS: readonly number[] = [0.01, 0.0275, 0.044];
/** The heights (the man's) of the rings between her waist and where her legs part, and that height. */
const CROTCH = 0.825;
/** (The first few are by how far above the crotch they are; the rest by the hips' own heights.) */
const hipRows = (crotch: number): number[] => [0.02, 0.035, 0.053, 0.073].map((d) => crotch + d).concat([0.9, 0.92, 0.945, 0.985, 1.022, 1.026, 1.04].filter((y) => y > crotch + 0.09));
/**
 * From here down her hips draw in to her two thighs (kept where it was when the crotch was raised from 0.8, so the
 * seat is as deep as it was: the user's choice of the two); and where her top ends over her trousers.
 */
const HIPS_PART = 0.875;
const WAISTLINE = 1.024;
/**
 * Between her legs: how far in front of and behind the middle the two part, and half the width of what joins them
 * (m). Broad and well forward in front, so the front of her trousers is smooth down to where the legs part; narrow
 * behind, where the cleft runs down into it.
 */
const PART_FRONT = 0.08, PART_BACK = 0.05, PART_HALF_FRONT = 0.075, PART_HALF_BACK = 0.032;
/** Where the line under her, between the legs, starts in front (m ahead of the legs' middle). */
const PART_TUCK = 0.05;
/**
 * Where a woman's hips hand over to her thighs (thighShare; the man's metres): the height of the half-way line at
 * the side, behind and in front (at the middle it's the crotch's), and how tall the band is against THIGH_BAND
 * behind and in front; THIGH_BAND, the band at the middle and at the side (a broad one out there and over the
 * buttock, so a leg raised or swung out bends the hip rather than folding it).
 */
const THIGH_LINE = [0.89, 0.875, 1.8, 1] as const;
const THIGH_BAND = [0.09, 0.15] as const;
/**
 * The space between her thighs from mid thigh up to where the legs part (m; they used to touch there, and the user
 * asked for a little space as female figures have: 2026-10-06). Below, the legs were apart already.
 */
const THIGH_GAP = 0.02;
/** Points round each of her legs (the others' have 8). */
const LEG_SEG = 12;

/** Rows with one more between each pair (Catmull-Rom through the sections), so a silhouette curves. */
function smooth(rows: readonly Row[]): Row[] {
  const out: Row[] = [];
  const at = (i: number): Row => rows[Math.min(rows.length - 1, Math.max(0, i))];
  for (let i = 0; i + 1 < rows.length; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    out.push(p1);
    const c = (k: number): number => 0.5 * (p1[k] + p2[k]) + (p1[k] + p2[k] - p0[k] - p3[k]) / 16;
    out.push([0.5 * (p1[0] + p2[0]), Math.max(0.002, c(1)), Math.max(0.002, c(2)), c(3)]);
  }
  out.push(rows[rows.length - 1]);
  return out;
}

/** The section at a height: half width, half depth, centre z. */
function rowAt(rows: readonly Row[], y: number): [number, number, number] {
  let i = 0;
  while (i < rows.length - 2 && rows[i + 1][0] < y) i++;
  const a = rows[i], b = rows[i + 1];
  const k = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** A value by a table of [x, value], linear between. */
function table(t: readonly (readonly [number, number])[], x: number): number {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 0; i + 1 < t.length; i++) {
    if (x <= t[i + 1][0]) return t[i][1] + ((t[i + 1][1] - t[i][1]) * (x - t[i][0])) / (t[i + 1][0] - t[i][0]);
  }
  return t[t.length - 1][1];
}

// ---- Bodies (the man's metres; each body scales them as real/mobRig.ts's proportions say) ----

/** Wide shoulders tapering to a slim waist and narrow hips. */
const MAN: readonly Row[] = [
  [0.8, 0.065, 0.065, 0],
  [0.84, 0.136, 0.096, -0.006],
  [0.9, 0.158, 0.11, -0.01],
  [0.97, 0.152, 0.104, -0.006],
  [1.04, 0.14, 0.096, 0],
  [1.12, 0.146, 0.1, 0.008],
  [1.2, 0.164, 0.11, 0.014],
  [1.28, 0.184, 0.114, 0.016],
  [1.35, 0.196, 0.108, 0.01],
  [1.41, 0.202, 0.096, -0.002],
  [1.442, 0.184, 0.086, -0.006],
  [1.47, 0.11, 0.068, -0.01],
  [1.492, 0.06, 0.056, -0.012],
];
/** An hourglass: wide hips, a small high waist, the ribs and chest carried forward, narrow sloping shoulders. */
const WOMAN: readonly Row[] = [
  [0.8, 0.06, 0.06, 0],
  [0.84, 0.15, 0.096, -0.006],
  [0.89, 0.176, 0.102, -0.008],
  [0.95, 0.17, 0.1, -0.009],
  [1.01, 0.144, 0.09, -0.008],
  [1.07, 0.11, 0.078, 0],
  [1.13, 0.112, 0.08, 0.01],
  [1.17, 0.119, 0.085, 0.016],
  [1.2, 0.125, 0.088, 0.019],
  [1.23, 0.13, 0.091, 0.021],
  [1.26, 0.135, 0.093, 0.022],
  [1.29, 0.139, 0.092, 0.021],
  [1.32, 0.142, 0.09, 0.018],
  [1.36, 0.146, 0.086, 0.012],
  [1.41, 0.154, 0.078, 0],
  [1.44, 0.138, 0.07, -0.005],
  [1.468, 0.086, 0.056, -0.01],
  [1.492, 0.046, 0.044, -0.012],
];
const CHILD: readonly Row[] = [
  [0.8, 0.07, 0.07, 0],
  [0.84, 0.14, 0.1, -0.006],
  [0.9, 0.162, 0.115, -0.01],
  [0.98, 0.158, 0.112, -0.004],
  [1.06, 0.152, 0.112, 0.006],
  [1.16, 0.154, 0.114, 0.012],
  [1.26, 0.16, 0.112, 0.012],
  [1.35, 0.176, 0.104, 0.008],
  [1.41, 0.194, 0.09, -0.002],
  [1.442, 0.178, 0.08, -0.006],
  [1.47, 0.11, 0.066, -0.01],
  [1.5, 0.058, 0.055, -0.012],
];
/** An old man: the shoulders narrower, the chest sunk, a belly. */
const ELDER: readonly Row[] = [
  [0.8, 0.07, 0.07, 0],
  [0.84, 0.145, 0.1, -0.006],
  [0.9, 0.17, 0.116, -0.012],
  [0.97, 0.166, 0.114, -0.004],
  [1.04, 0.16, 0.116, 0.006],
  [1.12, 0.162, 0.12, 0.012],
  [1.2, 0.166, 0.12, 0.014],
  [1.28, 0.172, 0.116, 0.012],
  [1.35, 0.184, 0.108, 0.006],
  [1.41, 0.194, 0.094, -0.002],
  [1.442, 0.178, 0.084, -0.006],
  [1.47, 0.11, 0.068, -0.01],
  [1.492, 0.06, 0.056, -0.012],
];

/** A heavy man (the boss): a paunch carried out in front over the belt, a thick waist and back, a full chest. */
const HEAVY: readonly Row[] = [
  [0.8, 0.07, 0.07, 0],
  [0.84, 0.148, 0.106, -0.004],
  [0.9, 0.174, 0.13, 0.002],
  [0.97, 0.18, 0.156, 0.022],
  [1.04, 0.181, 0.172, 0.04],
  [1.12, 0.181, 0.172, 0.044],
  [1.2, 0.182, 0.154, 0.036],
  [1.28, 0.19, 0.132, 0.024],
  [1.35, 0.198, 0.114, 0.012],
  [1.41, 0.203, 0.1, -0.002],
  [1.442, 0.186, 0.09, -0.006],
  [1.47, 0.114, 0.072, -0.01],
  [1.492, 0.066, 0.06, -0.012],
];

interface BodyShape {
  readonly torso: readonly Row[];
  /** The torso's width scale (heights scale by the proportions' ys). */
  readonly xs: number;
  /** Points round the torso (a woman's are CHEST_ANGLES and HIP_ANGLES). */
  readonly seg: number;
  /** Where the torso has form (the man's metres, before scaling). */
  readonly field: readonly Bulge[];
}

const BODY: Record<Body, BodyShape> = {
  man: {
    torso: MAN,
    xs: 1,
    seg: 16,
    field: [
      // Chest, shoulder blades, buttocks.
      { c: [0.08, 1.3, 0.125], r: [0.09, 0.075, 0.07], push: [0, 0, 0.012] },
      { c: [0.09, 1.3, -0.095], r: [0.09, 0.09, 0.07], push: [0, 0, -0.01] },
      { c: [0.07, 0.9, -0.118], r: [0.08, 0.085, 0.08], push: [0, 0, -0.014] },
    ],
  },
  woman: {
    torso: WOMAN,
    xs: 1,
    seg: 20,
    field: [
      // The bust, shaped in the torso itself: each breast a long slope from above into a round underside, the cloth
      // between them; soft round buttocks; the hollow of the back.
      { c: [0.066, 1.238, 0.112], r: [0.07, 0.062, 0.1], up: 0.125, push: [0.007, -0.006, 0.058], round: 1.15 },
      { c: [0, 1.27, 0.115], r: [0.055, 0.07, 0.08], up: 0.09, push: [0, 0, 0.012] },
      { c: [0.07, 0.905, -0.105], r: [0.105, 0.14, 0.11], push: [0, 0, -0.012] },
      { c: [0, 1.09, -0.07], r: [0.1, 0.11, 0.06], push: [0, 0, 0.01] },
    ],
  },
  child: { torso: CHILD, xs: 0.64, seg: 14, field: [{ c: [0, 1.04, 0.11], r: [0.13, 0.14, 0.08], push: [0, 0, 0.012] }] },
  elder: {
    torso: ELDER,
    xs: 0.95,
    seg: 16,
    field: [
      { c: [0, 1.04, 0.11], r: [0.14, 0.15, 0.09], push: [0, 0, 0.026] },
      { c: [0.075, 0.9, -0.125], r: [0.085, 0.085, 0.08], push: [0, 0, -0.012] },
    ],
  },
};

/** The boss's (on a man's or an elder's joints: only the flesh is his own), and how much thicker his limbs and neck are. */
const HEAVY_BODY: Omit<BodyShape, 'xs'> = {
  torso: HEAVY,
  seg: 20,
  field: [
    // The paunch hanging a little over the belt; the buttocks.
    { c: [0, 1.04, 0.2], r: [0.17, 0.15, 0.11], push: [0, -0.012, 0.026], round: 1.4 },
    { c: [0.075, 0.9, -0.125], r: [0.09, 0.09, 0.08], push: [0, 0, -0.014] },
  ],
};
const HEAVY_LIMB = 1.13;
/**
 * A woman's buttocks in full, over the plain seat every body has: each a round cheek, the two meeting in the cleft.
 * In full only with what's worn skin-tight or not at all (FORM_FITTING). In ordinary clothes, trousers, shorts and
 * skirts alike, ROUND_SEAT of it with the two sides run together: no cleft, no line (the user's choice, 2026-10-05, from
 * the showroom's row of fullnesses). A teen keeps the plain seat alone.
 */
const CHEEK: Bulge = { c: [0.074, 0.9, -0.11], r: [0.1, 0.105, 0.11], up: 0.13, push: [0.002, -0.004, -0.022], round: 1.25 };
const ROUND_SEAT = 0.6;
/**
 * A woman with nothing on (the user, 2026-10-05: a cleft more pronounced than clothes show, however tight; and
 * breasts that don't look as if they were under clothing). The cleft: the middle of the seat drawn in between the
 * cheeks, over their own crease.
 * A breast: the clothed bust's own place and size (the user: the general shape and size should reflect the clothed
 * model), a little smaller for want of a bra; pushed outward as well as forward, so it points to the side; coming
 * to its tip rather than round all over (`point`: 'more pointy-ness than a perfect round shape'), a nipple there
 * in shape; and its underside as the user drew it over a side view: from under the tip it rounds down and back,
 * and then turns up into the fold, which lies well above its lowest point, behind it, a little under the nipple's
 * height (`lower`); the chest runs straight on down from the fold.
 * Nothing lies across between the two. Shape only.
 */
/**
 * The front of her hips between the legs, as form (the user, 2026-10-06, after the cleft drawn as a line alone: 'this
 * is what I want', of giving the hips finer points there): a soft fullness either side of the middle and the middle
 * drawn in between them, from a little above where the legs part down to it. Nothing more than that.
 */
const BARE_FRONT: readonly Bulge[] = [
  { c: [0.0095, 0.85, 0.075], r: [0.013, 0.034, 0.07], push: [0, 0, 0.0075], round: 1.1 },
  { c: [0, 0.848, 0.075], r: [0.006, 0.032, 0.07], push: [0, 0, -0.009], round: 1 },
];
/**
 * And under her, between the legs, so it shows in her outline from the front (the user: 'more pronounced', and to
 * 'show in her silhouette when viewed from the front'): the two sides carried down and back under the body as a
 * rounded form each, side by side with the middle between them, hanging a little below where the legs part into
 * the space between the thighs. Each as sections front to back: [how far in front of the legs' middle, half width,
 * half height, how far above where the legs part (m)]; and how far from the middle its centre is.
 */
const BARE_UNDER = {
  x: 0.006,
  rows: [[0.066, 0.0005, 0.0005, 0.03], [0.061, 0.005, 0.007, 0.019], [0.052, 0.0065, 0.012, 0.004], [0.038, 0.007, 0.014, -0.009], [0.02, 0.007, 0.0145, -0.014], [0.002, 0.0066, 0.0135, -0.013], [-0.016, 0.005, 0.01, -0.007], [-0.03, 0.0005, 0.0005, 0.003]],
} as const;
const BARE_CLEFT: Bulge = { c: [0, 0.895, -0.11], r: [0.03, 0.095, 0.06], push: [0, 0, 0.014], round: 1.5 };
const BARE_BREAST: Bulge = {
  // (Each a mound of its own, round across with steep sides (`side`), its inner edge just short of the middle: seen
  // from above the chest goes back in between the two, an upturned V, as the user drew it twice. Joined across the
  // middle in a crease they made one shelf from above.)
  c: [0.07, 1.236, 0.112],
  r: [0.064, 0.062, 0.1],
  side: 0.7,
  up: 0.125,
  push: [0.022, -0.008, 0.052],
  round: 1.3,
  point: 0.4,
  // (Seen from the side, about half a circle under the tip: down from the nipple, round under, and back up to the
  // fold at the chest, a little under the nipple's height: the user's second drawing. The skin is the clothed bust's
  // lower half, down to its lower edge: toward that edge it's drawn up, behind the rest, to where the fold is, less
  // round toward the sides, so the fold is a shallow arc and the chest behind the breast stands straight.)
  lower: [[0, 1, 0], [0.15, 0.98, 0], [0.3, 0.9, 0.0012], [0.45, 0.77, 0.0009], [0.6, 0.6, -0.002], [0.72, 0.42, -0.009], [0.83, 0.25, -0.0195], [0.92, 0.115, -0.032], [1, 0, -0.046]],
};
/**
 * Round her chest with nothing on: a point every five degrees across the front (the middle one on the middle), so
 * each breast's inner side and its underside have the skin to turn with; the back as CHEST_ANGLES.
 */
const BARE_ANGLES: readonly number[] = [...Array.from({ length: 31 }, (_, i) => ((15 + i * 5) * Math.PI) / 180), ...CHEST_ANGLES.slice(16)];
/** Sections through her chest for it, by how far below the breast's centre toward its lower edge (and a little past both). */
const BREAST_ROWS: readonly number[] = [...Array.from({ length: 21 }, (_, i) => i * 0.05), 1.04, 1.1, 1.18, 1.28, 1.4, 1.52, 1.62];
/**
 * Her navel (the user: 'color in some more detail on the rest of her body such as a navel'; a round mark 'looks
 * really bad', so 'how anime does it', with two stills to go by): one short stroke down the middle of the belly, a
 * little curved, fine at both ends, in her skin darkened. Its height (the man's); the stroke as [how far above
 * that, how far round the belly from the middle (radians), its half width (m)]; how far off the skin; its shade.
 */
const NAVEL = { y: 1.03, stroke: [[0.011, 0.006, 0.0003], [0.005, -0.006, 0.0013], [-0.002, -0.009, 0.0012], [-0.009, 0.002, 0.0003]], off: 0.0012, shade: SKIN - 0.45 } as const;
/** How much darker the cleft's line is drawn down the seat. */
const CLEFT_SHADE = 0.2;

/** Legs, bottom to top: trousers (a straight leg to a hem over the shoe), slim ones, and a bare leg with a calf. */
const TROUSERS: readonly Row[] = [
  [0.062, 0.004, 0.004, 0.006],
  [0.066, 0.05, 0.06, 0.008],
  [0.1, 0.052, 0.062, 0.004],
  [0.28, 0.055, 0.064, -0.006],
  [0.42, 0.057, 0.064, -0.002],
  [0.5, 0.06, 0.066, 0.004],
  [0.62, 0.068, 0.074, 0.004],
  [0.76, 0.076, 0.084, 0],
  [0.86, 0.07, 0.088, -0.004],
  [0.93, 0.058, 0.082, -0.006],
];
/** A woman's leg, in tight trousers or bare: a full thigh tapering to the knee, the calf, a fine ankle (raised: heels). */
const SHAPELY: readonly Row[] = [
  [0.088, 0.004, 0.004, -0.012],
  [0.092, 0.027, 0.033, -0.012],
  [0.14, 0.028, 0.034, -0.014],
  [0.24, 0.038, 0.047, -0.022],
  [0.33, 0.044, 0.054, -0.026],
  [0.42, 0.039, 0.047, -0.014],
  [0.48, 0.041, 0.048, -0.002],
  [0.58, 0.055, 0.061, 0.004],
  [0.7, 0.078, 0.082, 0.006],
  [0.8, 0.089, 0.093, 0.002],
  [0.87, 0.09, 0.095, -0.004],
  [0.93, 0.076, 0.09, -0.008],
];
/** A man's or a child's bare leg (shorts): the trouser leg's thigh, then a calf and a slim ankle. */
const BARE_LEG: readonly Row[] = [
  [0.062, 0.004, 0.004, 0.004],
  [0.066, 0.036, 0.043, 0.004],
  [0.12, 0.037, 0.044, 0],
  [0.28, 0.05, 0.058, -0.008],
  [0.42, 0.046, 0.052, -0.002],
  ...TROUSERS.slice(5),
];
/** A short sleeve over the upper arm. */
const SHORT_SLEEVE: readonly Row[] = [
  [1.27, 0.052, 0.058, -0.013],
  [1.275, 0.062, 0.068, -0.013],
  [1.33, 0.066, 0.072, -0.012],
  [1.385, 0.068, 0.074, -0.01],
  [1.425, 0.064, 0.069, -0.01],
  [1.45, 0.05, 0.054, -0.01],
  [1.462, 0.02, 0.022, -0.01],
];
/** The same leg down to a flat shoe: the ankle where it is without a heel under it. */
const FLAT_LEG: readonly Row[] = SHAPELY.map(([y, a, b, z]): Row => [y < 0.24 ? y - 0.03 * (1 - (y - 0.088) / 0.152) : y, a, b, z]);
/**
 * Footwear, rows along z: [z, half width, half height, centre y]. A shoe (men, children, elders), a woman's flat, a
 * pump (only with a suit), a work boot, and a sandal (zori or geta: its sole, and the foot on it).
 */
const SHOE_ROWS: readonly Row[] = [
  [-0.062, 0.002, 0.002, 0.03],
  [-0.054, 0.036, 0.034, 0.04],
  [-0.016, 0.043, 0.046, 0.052],
  [0.042, 0.046, 0.04, 0.046],
  [0.1, 0.046, 0.03, 0.036],
  [0.15, 0.04, 0.024, 0.03],
  [0.178, 0.025, 0.017, 0.024],
  [0.187, 0.002, 0.002, 0.022],
];
const FLAT_ROWS: readonly Row[] = [
  [-0.052, 0.002, 0.002, 0.03],
  [-0.045, 0.026, 0.028, 0.033],
  [-0.012, 0.031, 0.036, 0.041],
  [0.03, 0.034, 0.027, 0.032],
  [0.075, 0.035, 0.02, 0.025],
  [0.112, 0.027, 0.015, 0.02],
  [0.13, 0.002, 0.002, 0.018],
];
const BOOT_ROWS: readonly Row[] = [
  [-0.066, 0.002, 0.002, 0.036],
  [-0.058, 0.04, 0.04, 0.046],
  [-0.016, 0.047, 0.054, 0.06],
  [0.042, 0.05, 0.048, 0.054],
  [0.1, 0.05, 0.041, 0.047],
  [0.15, 0.047, 0.037, 0.043],
  [0.182, 0.034, 0.03, 0.037],
  [0.192, 0.002, 0.002, 0.034],
];
const SOLE_ROWS: readonly Row[] = [
  [-0.06, 0.002, 0.002, 0.015],
  [-0.055, 0.03, 0.012, 0.015],
  [0, 0.037, 0.012, 0.015],
  [0.1, 0.039, 0.012, 0.015],
  [0.136, 0.031, 0.012, 0.015],
  [0.143, 0.002, 0.002, 0.015],
];
const BARE_ROWS: readonly Row[] = [
  [-0.05, 0.002, 0.002, 0.052],
  [-0.043, 0.026, 0.026, 0.054],
  [-0.012, 0.031, 0.036, 0.064],
  [0.03, 0.034, 0.026, 0.054],
  [0.075, 0.035, 0.018, 0.046],
  [0.11, 0.029, 0.014, 0.042],
  [0.127, 0.002, 0.002, 0.041],
];
/** How far the bare foot comes down with no sole under it, to stand on the floor. */
const BARE_DROP = 0.024;
/** A woman's pump: the heel up, the foot sloping to a pointed toe; and its heel, bottom to top. */
const PUMP_ROWS: readonly Row[] = [
  [-0.05, 0.002, 0.002, 0.086],
  [-0.043, 0.022, 0.024, 0.086],
  [-0.012, 0.027, 0.031, 0.08],
  [0.03, 0.03, 0.025, 0.056],
  [0.072, 0.031, 0.017, 0.03],
  [0.106, 0.023, 0.012, 0.02],
  [0.124, 0.002, 0.002, 0.016],
];
const HEEL: readonly Row[] = [
  [0.004, 0.002, 0.002, -0.04],
  [0.006, 0.007, 0.008, -0.04],
  [0.045, 0.009, 0.011, -0.037],
  [0.066, 0.018, 0.02, -0.032],
];
const ARM: readonly Row[] = [
  [0.858, 0.004, 0.004, 0],
  [0.862, 0.033, 0.039, 0],
  [0.9, 0.034, 0.04, -0.002],
  [0.97, 0.037, 0.043, -0.006],
  [1.05, 0.04, 0.046, -0.014],
  [1.13, 0.039, 0.045, -0.02],
  [1.22, 0.045, 0.05, -0.016],
  [1.32, 0.05, 0.056, -0.012],
  [1.38, 0.057, 0.062, -0.01],
  [1.42, 0.052, 0.057, -0.01],
  [1.437, 0.034, 0.038, -0.01],
  [1.443, 0.004, 0.004, -0.01],
];
/** A hand, no fingers: the palm, widest at the knuckles, narrowing to the fingertips: [y, half thickness, half width, z]. */
const HAND: readonly Row[] = [
  [0.728, 0.003, 0.003, 0.016],
  [0.735, 0.008, 0.013, 0.016],
  [0.762, 0.011, 0.023, 0.013],
  [0.795, 0.013, 0.029, 0.008],
  [0.832, 0.014, 0.027, 0.003],
  [0.868, 0.016, 0.021, 0],
];
const NECK: readonly Row[] = [
  [1.455, 0.06, 0.056, -0.012],
  [1.5, 0.05, 0.05, -0.008],
  [1.545, 0.047, 0.048, -0.002],
  [1.585, 0.046, 0.046, 0.002],
];
/** The head from the neck joint: a wide round skull, the cheeks running straight down to a small pointed chin. */
const SKULL: readonly Row[] = [
  [-0.034, 0.003, 0.003, 0.06],
  [-0.028, 0.012, 0.012, 0.055],
  [-0.014, 0.03, 0.032, 0.044],
  [0.006, 0.052, 0.054, 0.03],
  [0.028, 0.069, 0.072, 0.017],
  [0.052, 0.08, 0.086, 0.008],
  [0.086, 0.086, 0.096, 0.001],
  [0.122, 0.089, 0.102, -0.005],
  [0.158, 0.087, 0.102, -0.011],
  [0.19, 0.075, 0.091, -0.016],
  [0.214, 0.055, 0.068, -0.018],
  [0.227, 0.026, 0.032, -0.018],
  [0.231, 0.002, 0.002, -0.018],
];
/** The face (head units from the neck joint): no features, only the tip of a small nose in profile. */
const FACE: readonly Bulge[] = [{ c: [0, 0.05, 0.096], r: [0.013, 0.018, 0.03], push: [0, -0.002, 0.01] }];
/** An ear, rows along z: [z, half width, half height, centre y]. */
const EAR: readonly Row[] = [
  [-0.03, 0.002, 0.004, 0.09],
  [-0.022, 0.009, 0.022, 0.09],
  [-0.008, 0.011, 0.03, 0.088],
  [0.004, 0.006, 0.02, 0.084],
  [0.01, 0.002, 0.004, 0.084],
];

// ---- Hair (head units from the neck joint; angles from the front of the head round to the back, 0 to pi) ----

type Line = readonly (readonly [number, number])[];
interface HairStyle {
  /** The hairline: the hair's lower edge by angle. */
  readonly line: Line;
  /** Its thickness at the edge and on top. */
  readonly thick: readonly [number, number];
  /** Below this the hair hangs straight instead of following the jaw in. */
  readonly hang?: number;
  /** The edge cut into locks: every other column this much longer, the ones between half as much shorter. */
  readonly spike?: number;
  /** How much of that the sides and back have (the fringe has it all). */
  readonly spikeBack?: number;
}
/** A man's and a boy's haircut: short back and sides close to the head, a little longer on top, a plain hairline; no locks. */
const H_SHORT: HairStyle = { line: [[0, 0.17], [0.6, 0.168], [0.95, 0.152], [1.25, 0.122], [1.45, 0.104], [1.75, 0.106], [2.05, 0.06], [2.45, 0.032], [Math.PI, 0.026]], thick: [0.007, 0.022] };
const H_THIN: HairStyle = { line: [[0, 0.19], [0.6, 0.186], [0.95, 0.16], [1.25, 0.125], [1.45, 0.106], [1.75, 0.108], [2.05, 0.065], [2.45, 0.036], [Math.PI, 0.03]], thick: [0.008, 0.014] };
/** A woman's short crop. */
const H_CROP: HairStyle = { line: [[0, 0.156], [0.6, 0.15], [1.0, 0.09], [1.4, 0.05], [1.8, 0.03], [2.3, 0.0], [Math.PI, -0.01]], thick: [0.032, 0.05], hang: 0.09, spike: 0.022, spikeBack: 1 };
/** A bob: the sides to the jaw. */
const H_BOB: HairStyle = { line: [[0, 0.156], [0.74, 0.15], [1.04, 0.0], [1.4, -0.03], [Math.PI, -0.036]], thick: [0.042, 0.05], hang: 0.092, spike: 0.02, spikeBack: 1 };
/** Long hair's cap: the sides past the jaw (the rest hangs behind in locks). */
const H_LONG: HairStyle = { line: [[0, 0.156], [0.74, 0.15], [1.04, 0.01], [1.4, -0.05], [Math.PI, -0.04]], thick: [0.038, 0.05], hang: 0.092, spike: 0.012, spikeBack: 1 };
/** Pulled back to a tail or a bun. */
const H_BACK: HairStyle = { line: [[0, 0.156], [0.5, 0.152], [0.8, 0.146], [1.2, 0.112], [1.45, 0.098], [1.75, 0.1], [2.1, 0.05], [Math.PI, 0.03]], thick: [0.03, 0.048] };
const H_UP: HairStyle = { line: [[0, 0.166], [0.7, 0.16], [1.2, 0.114], [1.45, 0.098], [1.75, 0.1], [2.1, 0.05], [Math.PI, 0.03]], thick: [0.024, 0.04] };

/**
 * The shady ones' cuts (men's; an outfit's own, whatever hair was asked for: `cutOf`). A punch perm: a thick tight
 * cap, square across the brow. Slicked straight back from a high hairline, longer at the nape. A crop almost to the
 * skin. A regent's sides, swept back (the pompadour is lofted over them). A balding man's sides and back.
 */
const H_PUNCH: HairStyle = { line: [[0, 0.174], [0.6, 0.172], [0.95, 0.152], [1.25, 0.118], [1.45, 0.1], [1.75, 0.1], [2.05, 0.056], [2.45, 0.03], [Math.PI, 0.024]], thick: [0.02, 0.034], spike: 0.008, spikeBack: 1 };
const H_SLICK: HairStyle = { line: [[0, 0.184], [0.4, 0.196], [0.75, 0.188], [0.95, 0.156], [1.25, 0.122], [1.45, 0.104], [1.75, 0.106], [2.05, 0.05], [2.45, 0.016], [Math.PI, 0.004]], thick: [0.006, 0.02] };
const H_BUZZ: HairStyle = { line: [[0, 0.176], [0.6, 0.174], [0.95, 0.158], [1.25, 0.126], [1.45, 0.108], [1.75, 0.11], [2.05, 0.066], [2.45, 0.04], [Math.PI, 0.034]], thick: [0.002, 0.004] };
const H_REGENT: HairStyle = { line: [[0, 0.176], [0.6, 0.172], [0.95, 0.15], [1.25, 0.12], [1.45, 0.102], [1.75, 0.104], [2.05, 0.05], [2.45, 0.02], [Math.PI, 0.01]], thick: [0.012, 0.026] };
const H_SIDES: HairStyle = { line: [[0, 0.3], [0.5, 0.3], [0.7, 0.15], [1.2, 0.126], [1.45, 0.106], [1.75, 0.108], [2.05, 0.065], [2.45, 0.036], [Math.PI, 0.03]], thick: [0.008, 0.012] };
/** Above this a balding man's head is bare (but for what he combs over it). */
const PATE = 0.168;
type Cut = 'punch' | 'slick' | 'buzz' | 'regent' | 'combover' | 'bald';
const CUTS: Record<Cut, HairStyle | null> = { punch: H_PUNCH, slick: H_SLICK, buzz: H_BUZZ, regent: H_REGENT, combover: H_SIDES, bald: null };
/**
 * A character's own cut, in place of the hair asked for (men: women keep theirs): a mobster's, a street thug's and a
 * tattooed man's punch perm, slicked-back hair (asked for a cap; an old man's) or crop (asked for none), under a hat
 * his own; a biker's and a school gang leader's regent; the boss's comb-over or bald head.
 */
function cutOf(body: Body, hair: Hair, outfit: Outfit): Cut | null {
  if (body !== 'man' && body !== 'elder') return null;
  if (outfit === 'yakuza' || outfit === 'chinpira' || outfit === 'irezumi') return hair === 'hat' ? null : hair === 'none' ? 'buzz' : hair === 'cap' || body === 'elder' ? 'slick' : 'punch';
  if (outfit === 'bosozoku' || outfit === 'yankee') return hair === 'none' ? 'buzz' : 'regent';
  if (outfit === 'boss') return hair === 'none' ? 'bald' : 'combover';
  return null;
}
/** Which of a character's looks (its colours, what it carries): by the hair asked for, a man's four kinds first. */
const VARIANT: Record<Hair, number> = { short: 0, none: 1, cap: 2, hat: 3, long: 0, bob: 1, bun: 2, ponytail: 3, twin: 2 };
/** A regent: the pompadour rolled forward over the brow, rows along z: [z, half width, half height, centre y]. */
const REGENT: readonly Row[] = [
  [-0.07, 0.003, 0.003, 0.214],
  [-0.05, 0.062, 0.02, 0.218],
  [0.0, 0.08, 0.03, 0.232],
  [0.055, 0.084, 0.044, 0.234],
  [0.105, 0.078, 0.05, 0.228],
  [0.145, 0.062, 0.046, 0.216],
  [0.168, 0.036, 0.03, 0.204],
  [0.176, 0.003, 0.003, 0.2],
];
/** A hood up over the head: [y, half width, half depth, z, how far it's open either side of the face's middle]. */
const HOOD: readonly (readonly [number, number, number, number, number])[] = [
  [-0.075, 0.105, 0.1, -0.03, 0.5],
  [-0.02, 0.116, 0.118, -0.02, 0.78],
  [0.06, 0.122, 0.132, -0.01, 0.86],
  [0.13, 0.12, 0.136, -0.004, 0.78],
  [0.185, 0.11, 0.132, 0, 0.5],
  [0.225, 0.092, 0.118, 0.002, 0],
  [0.256, 0.058, 0.076, 0, 0],
  [0.268, 0.003, 0.003, -0.004, 0],
];

const BUN: readonly Row[] = [
  [0.138, 0.003, 0.003, -0.098],
  [0.146, 0.034, 0.03, -0.102],
  [0.176, 0.054, 0.048, -0.108],
  [0.21, 0.056, 0.048, -0.106],
  [0.238, 0.036, 0.03, -0.1],
  [0.246, 0.003, 0.003, -0.096],
];
const FEDORA: readonly Row[] = [
  [0.156, 0.094, 0.112, -0.008],
  [0.158, 0.155, 0.17, -0.008],
  [0.168, 0.155, 0.17, -0.008],
  [0.172, 0.093, 0.111, -0.008],
  [0.215, 0.088, 0.106, -0.01],
  [0.252, 0.082, 0.098, -0.012],
  [0.262, 0.002, 0.002, -0.012],
];
/** A woman's hat: a round crown and a wide brim turned down. */
const SUNHAT: readonly Row[] = [
  [0.15, 0.094, 0.112, -0.008],
  [0.132, 0.19, 0.2, -0.008],
  [0.14, 0.192, 0.202, -0.008],
  [0.162, 0.094, 0.112, -0.008],
  [0.21, 0.09, 0.106, -0.01],
  [0.24, 0.062, 0.074, -0.012],
  [0.252, 0.003, 0.003, -0.012],
];
const CAP: readonly Row[] = [
  [0.128, 0.09, 0.113, -0.012],
  [0.17, 0.092, 0.114, -0.01],
  [0.208, 0.082, 0.102, -0.012],
  [0.234, 0.052, 0.066, -0.016],
  [0.246, 0.002, 0.002, -0.016],
];
const VISOR: readonly Row[] = [
  [0.134, 0.002, 0.002, 0.11],
  [0.135, 0.074, 0.062, 0.11],
  [0.146, 0.074, 0.062, 0.11],
  [0.147, 0.002, 0.002, 0.11],
];

// ---- Garments (the man's metres) ----

/** The maid's dress below the waist: a rounded bell over a petticoat, ending mid-thigh. */
const MAID_SKIRT: readonly Row[] = [
  [0.665, 0.236, 0.212, 0.015],
  [0.68, 0.254, 0.23, 0.015],
  [0.76, 0.247, 0.222, 0.012],
  [0.86, 0.222, 0.19, 0.006],
  [0.95, 0.186, 0.146, 0],
  [1.02, 0.146, 0.104, 0],
  [1.065, 0.126, 0.091, 0],
];
/** Hanging kimono sleeves on the arm: deep front to back, down past the wrist. */
const SLEEVE: readonly Row[] = [
  [0.82, 0.03, 0.07, -0.03],
  [0.85, 0.05, 0.12, -0.03],
  [1.12, 0.052, 0.13, -0.02],
  [1.2, 0.046, 0.08, -0.015],
  [1.25, 0.035, 0.045, -0.01],
];
/** A puffed short sleeve, round, gathered at the shoulder and into a cuff. */
const PUFF: readonly Row[] = [
  [1.25, 0.046, 0.051, -0.012],
  [1.27, 0.066, 0.071, -0.012],
  [1.32, 0.075, 0.08, -0.012],
  [1.38, 0.071, 0.076, -0.011],
  [1.42, 0.056, 0.06, -0.01],
  [1.445, 0.038, 0.043, -0.01],
];
const CUFF: readonly Row[] = [
  [1.236, 0.044, 0.049, -0.012],
  [1.252, 0.05, 0.055, -0.012],
  [1.262, 0.064, 0.069, -0.012],
];
/** A case hanging from the left hand (briefcase or school bag): [y, half thickness, half length, z]. */
const CASE: readonly Row[] = [
  [0.4, 0.028, 0.17, 0.02],
  [0.42, 0.034, 0.19, 0.02],
  [0.64, 0.034, 0.19, 0.02],
  [0.66, 0.028, 0.17, 0.02],
];

/**
 * What's on the feet, by body and outfit: heels only with what they go with (a woman's suit, office clothes, an
 * evening dress); sandals with a kimono (zori, white tabi) and a yukata (geta, bare feet); boots with work clothes;
 * else a woman's flats and everyone else's shoes.
 */
type Footwear = 'shoe' | 'flat' | 'pump' | 'boot' | 'sandal' | 'bare';
function footwearOf(body: Body, outfit: Outfit): Footwear {
  // (Nothing on is barefoot; `nude_heels` is the same in high heels: a cabaret's dancer.)
  if (outfit === 'nude') return 'bare';
  // (A street thug's and a tattooed man's setta, on bare feet; a biker's boots.)
  if (outfit === 'kimono' || outfit === 'yukata' || outfit === 'chinpira' || outfit === 'irezumi') return 'sandal';
  if (outfit === 'work' || outfit === 'bosozoku') return 'boot';
  if (body !== 'woman') return 'shoe';
  return outfit === 'suit' || outfit === 'office' || outfit === 'gown' || outfit === 'nude_heels' ? 'pump' : 'flat';
}

/** The outfits worn with trousers (a woman's legs and hips in the bottoms' shade, not bare under a skirt). */
const TROUSERED: readonly Outfit[] = ['plain', 'work', 'police', 'otaku', 'hoodie', 'track', 'nurse', 'doctor', 'apron', 'puffer', 'shorts', 'gym', 'yakuza', 'chinpira', 'bosozoku', 'boss', 'hood', 'drunk', 'irezumi'];
/** Of those, the ones a man wears tucked in (the rest hang out over his trousers). */
const TUCKED: readonly Outfit[] = ['police', 'doctor', 'yakuza', 'bosozoku', 'boss', 'drunk', 'irezumi'];
/** A man's tops tucked in at the belt, where no jacket covers the hips (else the top runs on down to them). */
const BELTED: readonly Outfit[] = ['office', 'yakuza', 'bosozoku', 'drunk', 'irezumi', 'yankee'];
/** The outfits that leave the arms bare (sleeveless, or a short sleeve lofted over the upper arm). */
const BARE_ARMS: readonly Outfit[] = ['dress', 'mini', 'gown', 'shorts', 'nurse', 'gym', 'chinpira', 'nude', 'nude_heels'];

/**
 * What shows a woman's bottom in full, the cleft with it: nothing on. (Where skin-tight or revealing clothes are
 * added later, yoga pants, underwear, what the shadier streets wear at night, they go here.)
 */
const FORM_FITTING: readonly Outfit[] = ['nude', 'nude_heels'];
/** What a woman wears a skirt or a robe with (no waistband on her hips under it, and never the cleft). */
const SKIRTED: readonly Outfit[] = ['long', 'suit', 'maid', 'school', 'kimono', 'yukata', 'dress', 'mini', 'gown', 'office', 'nurse', 'yankee'];

/** What's on the legs, by body and outfit. */
function legsOf(body: Body, outfit: Outfit, bottom: number): { rows: readonly Row[]; shade: number } {
  // (Shorts, gym clothes: bare legs, the shorts or bloomers lofted over the thighs. Nothing on: bare legs.)
  const bare = outfit === 'shorts' || outfit === 'gym' || outfit === 'nude' || outfit === 'nude_heels';
  if (body !== 'woman') return bare ? { rows: BARE_LEG, shade: SKIN } : { rows: TROUSERS, shade: bottom };
  const rows = footwearOf(body, outfit) === 'pump' ? SHAPELY : FLAT_LEG;
  if (TROUSERED.includes(outfit) && !bare) return { rows, shade: bottom };
  // Bare legs under a skirt (dark stockings under a maid's dress).
  return { rows, shade: outfit === 'maid' ? 0.6 : SKIN };
}

/** The hair under a hat, a cap, a hard hat: only what shows below it. */
const UNDER_HAT = 0.158;

export function buildShaped(body: Body, hair: Hair, outfit: Outfit): Template {
  const P = PROPORTIONS[body];
  const woman = body === 'woman';
  // (The boss is a heavy man: his own flesh on the body's joints.)
  const heavy = outfit === 'boss' && (body === 'man' || body === 'elder');
  const S: BodyShape = heavy ? { ...HEAVY_BODY, xs: BODY[body].xs } : BODY[body];
  const limb = heavy ? HEAVY_LIMB : 1;
  const ys = P.ys;
  const xs = S.xs;
  const tb = new TemplateBuilder();
  const { pivot, armOut } = pivotsOf(body);
  const mark = (): number => tb.pos.length / 3;

  // ---- Torso ----
  const waist = 1.06 * ys;
  const hipY = 0.9 * ys;
  const T = smooth(S.torso).map(([y, a, b, z]): Row => [y * ys, a * xs, b * xs, z * xs]);
  // (A schoolgirl's bust is less: the bulges on the front of the chest.)
  const bust = (b: Bulge): number => (isTeen(body, outfit) && body === 'woman' && b.c[1] > 1.15 && b.c[2] > 0 ? TEEN_BUST : 1);
  // (A woman's bottom: in full, with its cleft, only in what's skin-tight or with nothing on; round, the two sides
  // run together, in everything else; a teen's always the plain seat.)
  const skirted = woman && SKIRTED.includes(outfit);
  const unclothed = outfit === 'nude' || outfit === 'nude_heels';
  const fitted = FORM_FITTING.includes(outfit);
  const cheeks = !woman || isTeen(body, outfit) ? 0 : fitted ? 1 : skirted ? ROUND_SEAT : (trial?.rear ?? ROUND_SEAT);
  const cheek: Bulge[] = cheeks > 0 ? [{ ...CHEEK, push: [CHEEK.push[0] * cheeks, CHEEK.push[1] * cheeks, CHEEK.push[2] * cheeks] }] : [];
  // What's worn over the body takes `field`; the body itself `bodyField`, the same but for the cleft (never more).
  const cleft = fitted || (cheeks > 0 && !skirted && trial?.cleft === true);
  // (Where her legs part, and where above it the hips start to draw in to them.)
  const crotch = trial?.crotch ?? CROTCH;
  const hipsPart = trial?.part ?? HIPS_PART;
  // (The rings of her hips, and the points round them: finer in front with nothing on. `baseRing`: where each of
  // the usual rings is among them; `hipSide`: how many points the usual next one is from the middle in front.)
  const fineHips = woman && unclothed;
  const baseRows = hipRows(crotch);
  const HIP_ROWS = fineHips ? [...baseRows, ...BARE_HIP_ROWS.map((d) => crotch + d)].sort((p, q) => p - q) : baseRows;
  const baseRing = baseRows.map((y) => HIP_ROWS.indexOf(y));
  const hipAngles = fineHips ? BARE_HIP_ANGLES : HIP_ANGLES;
  const hipFront = fineHips ? BARE_HIP_DEGREES.indexOf(90) : HIP_FRONT, hipBack = fineHips ? BARE_HIP_DEGREES.indexOf(270) : HIP_BACK;
  const hipSide = fineHips ? hipFront - BARE_HIP_DEGREES.indexOf(81) : 1;
  const scaled = (b: Bulge): Bulge => ({ round: b.round, under: b.under, point: b.point, side: b.side, cleft: b.cleft, lower: b.lower?.map(([t, k, d]) => [t, k, d * ys] as const), up: b.up === undefined ? undefined : b.up * ys, c: [b.c[0] * xs, b.c[1] * ys, b.c[2] * xs], r: [b.r[0] * xs, b.r[1] * ys, b.r[2] * xs], push: [b.push[0] * xs * bust(b), b.push[1] * ys * bust(b), b.push[2] * xs * bust(b)] });
  // A woman with nothing on: her breasts as they are without clothes (BARE_BREAST, in place of the clothed bust and
  // the cloth across it), and the cleft behind runs deeper (BARE_CLEFT).
  const bareWoman = woman && unclothed;
  const onChest = (b: Bulge): boolean => b.c[1] > 1.15 && b.c[2] > 0;
  const form: readonly Bulge[] = bareWoman ? [...S.field.filter((b) => !onChest(b)), BARE_BREAST] : S.field;
  const field: Bulge[] = [...form, ...cheek].map(scaled);
  const bodyField: Bulge[] = cleft ? [...field.map((b, i): Bulge => (i >= form.length ? { ...b, cleft: true } : b)), ...(bareWoman ? [scaled(BARE_CLEFT), ...BARE_FRONT.map(scaled)] : [])] : field;
  const torsoAt = (y: number): [number, number, number] => rowAt(T, y);
  const hips = (r: Row): Weight => blend(SPINE, PELVIS, clamp01((r[0] - (waist - 0.05 * ys)) / (0.1 * ys)));
  /** A skirt's or coat's skinning: below the hip joints each side follows its thigh (more of it lower down). */
  const drape = (r: Row, _i: number, x: number): Weight => {
    if (r[0] >= hipY) return hips(r);
    const k = Math.min(1, (hipY - r[0]) / (0.3 * ys));
    return [x < 0 ? THIGH_L : THIGH_R, PELVIS, 0.25 + 0.65 * k];
  };
  /** A loft over the torso: it takes the body's form with it. */
  const over = (rows: readonly Row[], weight: (r: Row, i: number, x: number) => Weight, shade: number, seg: number, n = 2.4, arc?: readonly [number, number]): void => {
    const from = mark();
    tb.loft(rows, () => 0, weight, shade, seg, n, 'y', arc);
    displace(tb, from, field);
  };
  /** The torso's section at a height (the man's), grown by g. */
  const wrap = (y: number, g: number): Row => {
    const [w, d, z] = torsoAt(y * ys);
    return [y * ys, w + g, d + g, z];
  };

  // What the top is: its hem over the hips, and how much skin shows at the neck.
  const trousers = !woman || TROUSERED.includes(outfit);
  // (A man's shirt tucked in at the belt with office clothes.)
  const hem = woman ? 1.02 : BELTED.includes(outfit) ? 0.99 : 0.855;
  const untucked = !woman && (outfit === 'school' || (TROUSERED.includes(outfit) && !TUCKED.includes(outfit)));
  // A kimono's or a yukata's cloth: a yukata pale cotton, a woman's kimono violet, a man's navy.
  const robe = outfit === 'yukata' ? WHITES - 0.25 : woman ? VIOLET : NAVY - 0.15;
  // The shady ones: which of the character's looks this is, and the jacket or coat worn open over the top (its
  // sleeves on the arms). A mobster's suit black, the figure's own, navy, or the old boss's off-white; a biker's
  // coat white, black, plum or navy; a school gang leader's long black-navy uniform coat; a drunk's suit.
  const v = VARIANT[hair];
  const coatShade =
    outfit === 'yakuza' ? [BLACK, SUIT, NAVY + 0.1, WHITES - 0.15][v]
    : outfit === 'bosozoku' ? [WHITES - 0.1, BLACK - 0.15, VIOLET, NAVY + 0.2][v]
    : outfit === 'yankee' && !woman ? NAVY - 0.45
    : outfit === 'drunk' ? SUIT
    : null;
  // (The boss with a hat or a cap asked for is a politician out canvassing: a sash and white gloves.)
  const politician = outfit === 'boss' && v >= 2;
  const whiteTop = outfit === 'office' || outfit === 'nurse' || outfit === 'gym' || (outfit === 'school' && body !== 'child') || outfit === 'bosozoku' || outfit === 'drunk' || outfit === 'irezumi' || (outfit === 'yankee' && !woman);
  const topShade =
    whiteTop ? WHITES
    // A mobster's loud shirt (dark red, plum, white, black); a street thug's aloha shirt (ochre, dusty blue, red, green).
    : outfit === 'yakuza' ? [GOWN + 0.2, VIOLET + 0.1, WHITES, 0.5][v]
    : outfit === 'chinpira' ? [SASH - 0.1, SKY, GOWN + 0.25, PACK + 0.35][v]
    // (A politician's navy; a sukeban's navy sailor top; a hooded top in the figure's own colour, darkened.)
    : outfit === 'boss' ? (politician ? NAVY + 0.2 : SUIT)
    : outfit === 'yankee' ? NAVY
    : outfit === 'hood' ? CLOTH_TOP - 0.55
    : outfit === 'track' ? TRACK
    : outfit === 'gown' ? GOWN
    : outfit === 'dress' ? SKY
    : outfit === 'kimono' || outfit === 'yukata' ? robe
    : outfit === 'suit' ? SUIT
    // (A maid's dress is dark navy; a police uniform is coloured whole at the end.)
    : outfit === 'maid' ? NAVY - 0.45
    : outfit === 'police' ? TOP
    // (Nothing on: the body as it is, nothing lofted over it and nothing added to it, barefoot; or, a cabaret's
    // dancer, in her heels. A mannequin's body, smooth; a woman's has her breasts' own shape, a nipple on each with
    : outfit === 'nude' || outfit === 'nude_heels' ? SKIN
    // Everything else (plain clothes, a hoodie, a down jacket, a T-shirt, what's under an apron or a coat): a top in a colour of the figure's own.
    : CLOTH_TOP;
  const bottomShade =
    outfit === 'nurse' ? WHITES - 0.1
    : outfit === 'track' ? TRACK - 0.2
    : outfit === 'gym' ? TRACK - 0.1
    : outfit === 'shorts' ? TAN - 0.15
    : outfit === 'police' ? BOTTOM
    : outfit === 'suit' || outfit === 'office' || outfit === 'doctor' ? SUIT - 0.1
    // (A schoolboy's dark trousers.)
    : outfit === 'school' && body !== 'child' ? NAVY - 0.5
    // (Suit trousers with a jacket, a biker's in his coat's cloth; a thug's white slacks; a gang leader's black-navy.)
    : outfit === 'yakuza' || outfit === 'bosozoku' || outfit === 'drunk' ? coatShade! - 0.1
    : outfit === 'boss' ? topShade - 0.1
    : outfit === 'chinpira' && v % 2 === 0 ? WHITES - 0.2
    : outfit === 'yankee' ? NAVY - 0.5
    : outfit === 'hood' ? CLOTH_BOTTOM - 0.3
    : CLOTH_BOTTOM;
  // The legs (built below, after the head and the hair; a woman's hips are one surface with hers): what's on them,
  // their sections, and each one's centre at a height.
  const L = legsOf(body, outfit, bottomShade);
  // (A woman's thighs don't meet: each is that much slimmer on the inside from mid thigh up, its outside where it was.)
  const apart = (y: number): number => {
    if (!woman) return 0;
    const k = clamp01((y / ys - 0.5) / 0.15);
    return (THIGH_GAP / 2) * k * k * (3 - 2 * k);
  };
  const legRows = L.rows.map(([y, a, b, z]): Row => [y * ys, a * P.leg * limb - apart(y * ys) / 2, b * P.leg * limb, z * P.leg]);
  const legX = (s: number, y: number): number => {
    if (!woman) return s * P.hipX * (0.86 + 0.14 * Math.min(1, y / (0.92 * ys)));
    // A woman's legs run in from the hips to knees and ankles close together.
    const k = clamp01((y / ys - 0.45) / 0.45);
    return s * (0.052 + 0.036 * k * k * (3 - 2 * k) + apart(y) / 2);
  };
  /** (Where the lowest ring of a woman's hips starts: her legs join it.) */
  let hipRing = 0;
  /**
   * How much of a point on a woman's hips or at the top of a leg goes with that side's thigh (the rest with the
   * pelvis), so the two bend into one another when the leg is raised, swung back or out to the side, instead of
   * the top of the thigh turning whole into the belly and out of the hip. Half at a line that runs from the crotch
   * up and out to a little under the hip joint's height at the side (THIGH_LINE); none half a band above it, all
   * half a band below, the band tallest at the side (THIGH_BAND).
   */
  const thighShare = (x: number, y: number, z: number): number => {
    const out = clamp01(Math.abs(x) / 0.16);
    const front = clamp01((z + 0.03) / 0.06);
    const [lineB, lineF, bandB, bandF] = THIGH_LINE;
    const line = (crotch - 0.005 + ((lineB + (lineF - lineB) * front) - crotch + 0.005) * out) * ys;
    const band = ((THIGH_BAND[0] + (THIGH_BAND[1] - THIGH_BAND[0]) * out) * (bandB + (bandF - bandB) * front)) * ys;
    const u = clamp01((line + band / 2 - y) / band);
    return u * u * (3 - 2 * u);
  };
  if (untucked) {
    // Trousers to just past the hem; the top from its hem up, standing a little proud of the hips, easing onto the body.
    const g = 0.01;
    const hy = hem * ys;
    over(T.filter((r) => r[0] <= hy + 0.05 * ys), hips, bottomShade, S.seg, 2.4);
    const top: Row[] = [wrap(hem, -0.006), wrap(hem, g)];
    for (const r of T) {
      if (r[0] <= hy + 0.012 * ys) continue;
      const k = g * clamp01(1 - (r[0] - hy) / (0.2 * ys));
      top.push([r[0], r[1] + k, r[2] + k, r[3]]);
    }
    over(top, hips, topShade, S.seg, 2.4);
  } else {
    const t0 = mark();
    if (woman) {
      // Her chest down to the waist; below it her hips, one surface with her legs (not a body the legs are pushed
      // into: that left a crease from each hip to the crotch, like the leg of a pair of briefs): rings with their
      // points where the hips have form, which from HIPS_PART down draw in from the hips' section to the two thighs'
      // own, parting in the middle in front and behind. The legs carry on from the lowest (below, with the legs).
      let chestRows = T.filter((r) => r[0] > 1.055 * ys);
      if (bareWoman) {
        // (Close sections where a bare breast's lower half is let down from, so it has the skin to round with.)
        const more = BREAST_ROWS.map((t) => (BARE_BREAST.c[1] - t * BARE_BREAST.r[1]) * ys).filter((y) => chestRows.every((r) => Math.abs(r[0] - y) > 0.0006));
        chestRows = [...chestRows, ...more.map((y): Row => [y, ...rowAt(T, y)])].sort((p, q) => p[0] - q[0]);
      }
      const chestAngles = bareWoman ? BARE_ANGLES : CHEST_ANGLES;
      loftAt(tb, chestRows, chestAngles, hips, topShade, 2.4);
      const chest = chestAngles.map((_, j) => t0 + j);
      const e24 = 2 / 2.4;
      const se24 = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), e24);
      const M = hipAngles.length;
      const widest = rowAt(T, 0.89 * ys);
      const y0 = crotch * ys;
      const [a0, b0, z0] = rowAt(legRows, y0);
      const painted = trousers && !unclothed;
      hipRing = mark();
      for (const hy of HIP_ROWS) {
        const y = hy * ys;
        // The hips' section: the torso's, and below its widest drawing in to what the two thighs span.
        const k = clamp01((0.89 - hy) / (0.89 - crotch));
        const [w, d, z] = hy >= 0.89 ? rowAt(T, y) : [widest[0] + (legX(1, y0) + a0 - widest[0]) * k, widest[1] + (b0 - widest[1]) * k, widest[2] + (z0 - widest[2]) * k];
        const u = clamp01((hipsPart - hy) / (hipsPart - crotch));
        const m = u * u * (3 - 2 * u);
        const [la, lb, lz] = rowAt(legRows, y);
        const lx = legX(1, y);
        for (const t of hipAngles) {
          let px = w * se24(Math.cos(t)), pz = d * se24(Math.sin(t));
          if (m > 0) {
            // Toward the outline of the two thighs there (and of what joins them between), along the same ray.
            const len = Math.hypot(px, pz);
            const ux = px / len, uz = pz / len;
            const legs = Math.max(rayEllipse(0, z, ux, uz, lx, lz, la, lb), rayEllipse(0, z, ux, uz, -lx, lz, la, lb));
            const between = 1 / (uz > 0 ? Math.hypot(ux / PART_HALF_FRONT, uz / PART_FRONT) : Math.hypot(ux / PART_HALF_BACK, uz / PART_BACK));
            const r = len + (smoothMax(legs, between, 0.01) - len) * m;
            px = ux * r;
            pz = uz * r;
          }
          tb.pos.push(px, y, z + pz);
          // (Each side goes with its thigh by where it is: thighShare; on the middle itself, with neither.)
          const share = hy < 0.99 ? thighShare(px, y, z + pz) * clamp01(Math.abs(px) / 0.025) : 0;
          const [wa, wb, ww] = share > 0 ? blend(px < 0 ? THIGH_L : THIGH_R, PELVIS, share) : hips([y, 0, 0, 0]);
          tb.b0.push(wa);
          tb.b1.push(wb);
          tb.w.push(ww);
          tb.shade.push(painted && hy < WAISTLINE ? bottomShade : topShade);
        }
      }
      for (let k = 0; k + 1 < HIP_ROWS.length; k++) {
        for (let j = 0; j < M; j++) {
          const a = hipRing + k * M + j, b = hipRing + k * M + ((j + 1) % M), c = hipRing + (k + 1) * M + ((j + 1) % M), d = hipRing + (k + 1) * M + j;
          tb.idx.push(a, c, b, a, d, c);
        }
      }
      zip(tb, hipAngles.map((_, j) => hipRing + (HIP_ROWS.length - 1) * M + j), chest, true);
      displace(tb, t0, bodyField);
      if (bareWoman) {
      }
      // The cleft's line, a little darker down the middle of the seat.
      if (cleft) HIP_ROWS.forEach((hy, k) => (tb.shade[hipRing + k * M + hipBack] -= CLEFT_SHADE * clamp01((0.985 - hy) / 0.04)));
    } else {
      over(T, hips, topShade, S.seg, 2.4);
      if (trousers && !unclothed) for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys < hem + 0.01) tb.shade[i] = bottomShade;
    }
    // The waistband of a woman's trousers, where her top goes into them.
    if (woman && trousers && !unclothed && !skirted && outfit !== 'police' && outfit !== 'bosozoku') over([wrap(0.997, 0.001), wrap(1.0, 0.005), wrap(1.03, 0.005), wrap(1.033, 0.001)], hips, bottomShade - 0.12, 18, 2.4);
    // An evening dress is off the shoulders: skin above the bust.
    if (outfit === 'gown') for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys > 1.34) tb.shade[i] = SKIN;
    // A tattooed man's chest and shoulders are bare above his undershirt (its straps are lofted over them): inked,
    // as his arms are.
    if (outfit === 'irezumi') for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys > 1.24) tb.shade[i] = INK;
    // A biker's chest is bare over the cloth bound round the belly (a woman's bound over the bust).
    if (outfit === 'bosozoku') for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys > (woman ? 1.335 : 1.14)) tb.shade[i] = SKIN;
  }

  // ---- Neck and head ----
  const neckY = 1.5 * ys;
  const teen = isTeen(body, outfit);
  const hk = P.head * HEAD_K[body] * headScale * (teen ? TEEN_HEAD : 1);
  const nk = P.arm * 0.9 * (heavy ? 1.2 : 1);
  const neck = NECK.map(([y, a, b, z]): Row => [y * ys, a * nk, b * nk, z * nk]);
  tb.loft(neck, () => 0, (_, i) => (i === 0 ? one(SPINE) : i === 1 ? blend(HEAD, SPINE, 0.4) : i === 2 ? blend(HEAD, SPINE, 0.8) : one(HEAD)), SKIN, 8);
  const headRows = (rows: readonly Row[]): Row[] => rows.map(([y, a, b, z]) => [neckY + y * hk, a * hk, b * hk, z * hk]);
  const headField = (f: readonly Bulge[]): Bulge[] => f.map((b) => ({ c: [b.c[0] * hk, neckY + b.c[1] * hk, b.c[2] * hk], r: [b.r[0] * hk, b.r[1] * hk, b.r[2] * hk], push: [b.push[0] * hk, b.push[1] * hk, b.push[2] * hk] }));
  const skull = headRows(SKULL);
  const dome = smooth(skull);
  const h0 = mark();
  tb.loft(skull, () => 0, () => one(HEAD), SKIN, 12, 2.1);
  displace(tb, h0, headField(FACE));

  // ---- Hair ----
  // A character's own cut; and no hat with it, nor under a hood, a tie or a headband round the head.
  const cut = cutOf(body, hair, outfit);
  const hooded = outfit === 'hood' && hair !== 'cap';
  const bare = cut !== null || hooded || outfit === 'drunk' || outfit === 'bosozoku' || outfit === 'yankee';
  const hatted = ((hair === 'hat' || hair === 'cap') && !bare) || outfit === 'work' || outfit === 'police' || outfit === 'apron' || hooded;
  // (No long-haired child: one asked for gets the ordinary haircut.)
  const girl = body === 'child' && (hair === 'bun' || hair === 'bob' || hair === 'ponytail' || hair === 'twin');
  const feminine = woman || girl;
  let style: HairStyle | null = null;
  if (cut) style = CUTS[cut];
  else if (hair !== 'none') {
    if (feminine) {
      style = hair === 'long' ? H_LONG : hair === 'bob' || hair === 'hat' ? H_BOB : hair === 'bun' ? H_UP : hair === 'ponytail' || hair === 'twin' || hair === 'cap' ? H_BACK : H_CROP;
    } else if (body === 'elder') style = H_THIN;
    // (A man and a boy have the one haircut: the kinds only women and girls wear differently come out the same on them.)
    else style = H_SHORT;
  }
  const SE = 2 / 2.1;
  const se = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), SE);
  /**
   * Hair as a shell over the skull: from the hairline (by angle) up to the crown, standing off by its thickness;
   * a lip at the edge closes it onto the skin. `top` cuts it short under a hat; with `sink`, where the hairline is
   * above that there's none (it's sunk under the skin: a bald pate).
   */
  const shell = (st: HairStyle, top: number | null, sink = false): void => {
    const seg = 16, R = 7;
    const start = mark();
    const cy = neckY + 0.12 * hk, cz = -0.006 * hk;
    const crown = SKULL[SKULL.length - 1][0];
    for (let i = 0; i <= R; i++) {
      const u = i <= 1 ? 0 : (i - 1) / (R - 1);
      const f = Math.sin((u * Math.PI) / 2);
      for (let j = 0; j < seg; j++) {
        const th = (j / seg) * Math.PI * 2;
        let phi = th - Math.PI / 2;
        if (phi > Math.PI) phi -= Math.PI * 2;
        const a = Math.abs(phi);
        // The edge cut into locks: every other column longer.
        const lock = (st.spike ?? 0) * (j % 2 === 0 ? -1 : 0.5) * (a < 0.95 ? 0 : (st.spikeBack ?? 0));
        const sunk = sink && top !== null && table(st.line, a) + lock >= top;
        const lo = sunk ? top - 0.012 : table(st.line, a) + lock;
        const hi = top === null ? crown : Math.max(top, lo + 0.004);
        const yh = lo + (hi - lo) * f;
        // Where the skull is at this height (hanging hair keeps the width it had above).
        const [w, d, z] = rowAt(dome, neckY + Math.max(yh, st.hang ?? -1) * hk);
        const x = w * se(Math.cos(th)), zz = z + d * se(Math.sin(th));
        const y = neckY + yh * hk;
        let nx = x, ny = Math.max(0, y - cy), nz = zz - cz;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        let t = st.thick[0] + (st.thick[1] - st.thick[0]) * u;
        if (top !== null) t = Math.min(t, 0.008);
        if (i === 0) t = 0.001;
        if (sunk) t = -0.008;
        t *= hk;
        tb.pos.push(x + nx * t, y + ny * t, zz + nz * t);
        // Below the neck joint the hair lies on the shoulders.
        const k = clamp01((neckY - y) / (0.08 * ys));
        tb.b0.push(HEAD);
        tb.b1.push(SPINE);
        tb.w.push(1 - k);
        tb.shade.push(HAIR);
      }
    }
    for (let k = 0; k < R; k++) {
      for (let j = 0; j < seg; j++) {
        const a = start + k * seg + j, b = start + k * seg + ((j + 1) % seg);
        const c = start + (k + 1) * seg + ((j + 1) % seg), d = start + (k + 1) * seg + j;
        tb.idx.push(a, c, b, a, d, c);
      }
    }
  };
  /** A point on the head (head units): at an angle from the front, at a height, standing `off` off the skull. */
  const onHead = (phi: number, y: number, off: number, wide = -1): V3 => {
    const th = phi + Math.PI / 2;
    const [w, d, z] = rowAt(dome, neckY + Math.max(y, wide) * hk);
    const x = (w * se(Math.cos(th))) / hk, zz = (z + d * se(Math.sin(th))) / hk;
    const l = Math.hypot(x, zz + 0.006) || 1;
    return [x + (x / l) * off, y, zz + ((zz + 0.006) / l) * off];
  };
  /**
   * A lock of hair: a flat blade along a path (head units from the neck joint), `width` its half width at each
   * point (to nothing at its tip), `thick` its half thickness. Four sides: sharp, as anime draws hair.
   */
  const lock = (path: readonly V3[], width: readonly number[], thick: number, headOnly = false): void => {
    const start = mark();
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)], c = path[i];
      let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      // Out from the head's axis, then across the lock.
      let rx = c[0], rz = c[2] + 0.006;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl;
      rz /= rl;
      let sx = dy * rz, sy = dz * rx - dx * rz, sz = -dy * rx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl;
      sy /= sl;
      sz /= sl;
      const ox = sy * dz - sz * dy, oy = sz * dx - sx * dz, oz = sx * dy - sy * dx;
      const w = Math.max(0.0012, width[i]), t = Math.max(0.001, (thick * width[i]) / Math.max(...width));
      for (const [ks, ko] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const y = neckY + (c[1] + sy * w * ks + oy * t * ko) * hk;
        tb.pos.push((c[0] + sx * w * ks + ox * t * ko) * hk, y, (c[2] + sz * w * ks + oz * t * ko) * hk);
        const k = headOnly ? 0 : clamp01((neckY + 0.02 * ys - y) / (0.1 * ys));
        tb.b0.push(HEAD);
        tb.b1.push(SPINE);
        tb.w.push(1 - k);
        tb.shade.push(HAIR);
      }
    }
    // Faces out: whichever way round the rings came, away from the path.
    const P3 = tb.pos;
    const flip = ((): boolean => {
      const a = start * 3, b = (start + 1) * 3, c = (start + 5) * 3;
      const ux = P3[c] - P3[a], uy = P3[c + 1] - P3[a + 1], uz = P3[c + 2] - P3[a + 2];
      const vx = P3[b] - P3[a], vy = P3[b + 1] - P3[a + 1], vz = P3[b + 2] - P3[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (P3[a] + P3[b]) / 2 - path[0][0] * hk, my = (P3[a + 1] + P3[b + 1]) / 2 - (neckY + path[0][1] * hk), mz = (P3[a + 2] + P3[b + 2]) / 2 - path[0][2] * hk;
      return nx * mx + ny * my + nz * mz < 0;
    })();
    for (let i = 0; i + 1 < n; i++) {
      for (let j = 0; j < 4; j++) {
        const a = start + i * 4 + j, b = start + i * 4 + ((j + 1) % 4), c = start + (i + 1) * 4 + ((j + 1) % 4), d = start + (i + 1) * 4 + j;
        if (flip) tb.idx.push(a, b, c, a, c, d);
        else tb.idx.push(a, c, b, a, d, c);
      }
    }
  };
  /** A fringe: locks from the crown down over the forehead, each to its own length, swept a little to one side. */
  const fringe = (phis: readonly number[], tip: (phi: number) => number, w: number): void => {
    phis.forEach((phi, i) => {
      const y = tip(phi) + (i % 2 ? 0.014 : 0);
      lock([onHead(phi * 0.8, 0.212, 0.036), onHead(phi, 0.172, 0.052), onHead(phi + 0.03, (0.172 + y) / 2, 0.038), onHead(phi + 0.07, y, 0.014)], [w * 0.8, w, w * 0.8, 0], 0.016);
    });
  };
  /** A layer of locks lying on the cap from high on the head, their tips flicking out past its edge. */
  const layer = (phis: readonly number[], tipY: (phi: number) => number, out: number, w: number): void => {
    phis.forEach((phi, i) => {
      const y = tipY(phi) + (i % 2 ? 0.02 : 0);
      lock([onHead(phi, 0.2, 0.04), onHead(phi, 0.1, 0.056, 0.092), onHead(phi + (phi < 0 ? -0.06 : 0.06), y, out, 0.092)], [w, w, 0], 0.016);
    });
  };
  const ROUND = [1.3, 1.72, 2.14, 2.56, 2.98, -2.9, -2.48, -2.06, -1.64, -1.26];
  const hairFrom = mark();
  if (style) {
    if (cut === 'combover') shell(style, PATE, true);
    // (Under a hood none shows at the brow.)
    else shell(style, hatted ? UNDER_HAT : null, hooded);
    // Ears where the hair leaves them out.
    if (table(style.line, Math.PI / 2) > 0.085) {
      for (const sd of [-1, 1]) tb.loft(EAR.map(([z, a, b, y]): Row => [z * hk, a * hk, b * hk, neckY + y * hk]), () => sd * 0.085 * hk, () => one(HEAD), SKIN, 5, 2, 'z');
    }
  } else if (hair === 'none' || hatted) {
    for (const sd of [-1, 1]) tb.loft(EAR.map(([z, a, b, y]): Row => [z * hk, a * hk, b * hk, neckY + y * hk]), () => sd * 0.085 * hk, () => one(HEAD), SKIN, 5, 2, 'z');
  }
  if (style && !hatted && body !== 'elder') {
    if (feminine) {
      // Bangs to the brows, longer at the temples.
      fringe([-0.66, -0.4, -0.13, 0.15, 0.42, 0.68], (phi) => 0.112 - 0.05 * Math.pow(Math.abs(phi) / 0.68, 2), 0.036);
      // A crop and a bob: layers round the sides and back, flicking out at the ends.
      if (hair === 'short') layer(ROUND, (phi) => 0.04 - 0.05 * clamp01((Math.abs(phi) - 1.3) / 1.6), 0.058, 0.034);
      if (hair === 'bob') layer(ROUND, () => -0.04, 0.066, 0.036);
    }
    // (A man's and a boy's haircut has no locks: the cap is all of it.)
  }
  // A regent's pompadour, rolled forward over the brow.
  if (cut === 'regent') tb.loft(REGENT.map(([z, a, h, y]): Row => [z * hk, a * hk, h * hk, neckY + y * hk]), () => 0, () => one(HEAD), HAIR, 10, 2.4, 'z');
  // What a balding man combs over his pate: a few strands from one side across to the other.
  if (cut === 'combover') {
    for (const [z, w, h] of [[0.04, 0.095, 0.112], [0.006, 0.098, 0.121], [-0.028, 0.098, 0.122], [-0.062, 0.095, 0.112]]) {
      tb.loft([z - 0.009, z + 0.009].map((zz): Row => [zz * hk, w * hk, h * hk, neckY + 0.118 * hk]), () => 0, () => one(HEAD), HAIR, 8, 2.1, 'z', [Math.PI + 0.42, 2 * Math.PI - 0.42]);
    }
  }
  // (Under a hood only the fringe's place shows: nothing hangs out of it.)
  if (feminine && style && !hooded) {
    // A little girl's twin tails are short bunches (below): no long locks with them.
    const bunches = body === 'child' && hair === 'twin';
    // A long lock in front of each ear (a bob and a crop have their sides already).
    if (hair !== 'short' && hair !== 'bob' && hair !== 'hat' && !bunches) {
      for (const sd of [-1, 1]) lock([onHead(-sd * 1.02, 0.17, 0.03), onHead(-sd * 1.0, 0.1, 0.034), [sd * 0.094, 0.0, 0.03], [sd * 0.09, -0.13, 0.05]], [0.02, 0.024, 0.02, 0], 0.022);
    }
    if (hair === 'long') {
      // Down the back to the waist in broad locks, each ending in a point, the middle ones longest.
      for (let k = -3; k <= 3; k++) {
        const a = Math.PI + k * 0.3;
        const far = Math.abs(k) / 3;
        lock([onHead(a, 0.09, 0.034), [k * 0.034, -0.05, -0.1 + 0.03 * far], [k * 0.04, -0.21, -0.112 + 0.02 * far], [k * 0.036, -0.4 + 0.09 * far, -0.104]], [0.04, 0.046, 0.04, 0], 0.016);
      }
    }
    if (hair === 'ponytail' || hair === 'cap') {
      // A high tail: out from the back of the crown and down in three locks.
      for (const [x, len] of [[-0.034, -0.2], [0, -0.27], [0.034, -0.22]] as const) lock([[0, 0.176, -0.1], [x * 0.5, 0.19, -0.165], [x, 0.03, -0.18], [x * 1.3, len, -0.14]], [0.024, 0.046, 0.042, 0], 0.032, true);
    }
    if (bunches) {
      // A little girl's bunches: tied high at each side with a bobble, standing out from the head and falling to the jaw.
      for (const sd of [-1, 1]) {
        tb.loft(headRows([[0.15, 0.003, 0.003, -0.018], [0.156, 0.018, 0.018, -0.018], [0.172, 0.024, 0.024, -0.018], [0.188, 0.018, 0.018, -0.018], [0.194, 0.003, 0.003, -0.018]]), () => sd * 0.1 * hk, () => one(HEAD), HAIR, 6);
        for (const [out, fwd, len] of [[0.075, 0.012, 0.035], [0.062, -0.012, 0.012], [0.05, 0.004, -0.004]] as const) {
          lock([[sd * 0.098, 0.172, -0.018], [sd * (0.118 + out * 0.5), 0.176, -0.018 + fwd], [sd * (0.112 + out), 0.115, -0.018 + fwd * 1.6], [sd * (0.108 + out * 0.86), len, -0.018 + fwd * 1.4]], [0.02, 0.04, 0.036, 0], 0.03, true);
        }
      }
    } else if (hair === 'twin') {
      // Twin tails: from high at each side, down past the shoulders in locks.
      for (const sd of [-1, 1]) {
        for (const [dx, dz, len] of [[0.03, 0.01, -0.3], [0.0, -0.03, -0.36], [0.05, -0.04, -0.24]] as const) lock([[sd * 0.09, 0.172, -0.02], [sd * (0.135 + dx * 0.3), 0.1, -0.02 + dz * 0.4], [sd * (0.15 + dx), -0.09, -0.01 + dz], [sd * (0.15 + dx * 1.5), len, dz]], [0.024, 0.046, 0.04, 0], 0.03);
      }
    }
    if (hair === 'bun') tb.loft(headRows(BUN), () => 0, () => one(HEAD), HAIR, 8);
  }
  const hairTo = mark();
  // (A straw sun hat; a brown fedora.)
  // (The old boss's is off-white, as his suit.)
  if (hair === 'hat' && !bare) tb.loft(headRows(feminine ? SUNHAT : FEDORA), () => 0, () => one(HEAD), feminine ? TAN + 0.35 : outfit === 'yakuza' ? WHITES - 0.1 : TAN - 0.6, 14);
  if (hair === 'cap' && !bare) {
    // (A schoolchild's cap is yellow.)
    const capShade = body === 'child' && outfit === 'school' ? SASH : outfit === 'police' ? HAT : CLOTH_BOTTOM;
    tb.loft(headRows(CAP), () => 0, () => one(HEAD), capShade, 12, 2.1);
    tb.loft(headRows(VISOR), () => 0, () => one(HEAD), capShade, 8);
  }

  // ---- Legs and feet ----
  const footwear = footwearOf(body, outfit);
  const shoes: [number, number][] = [];
  const knee = 0.47 * ys;
  const gym = outfit === 'gym';
  // Shorts over the thighs: to just above the knee, a woman's short. Gym clothes: a girl's bloomers (to the top
  // of the thigh), a boy's short shorts, in the school's red.
  const legCut = outfit === 'shorts' || gym ? (gym ? (woman ? crotch : 0.64) : woman ? 0.74 : 0.5) * ys : null;
  // A woman's legs: more points round them, more sections through the thigh (so it curves), and only up to where
  // they part: there each joins her hips. Her shorts and bloomers are the leg itself in their colour from the cut up
  // (a section either side of it, so the edge is a line).
  const legSeg = woman ? LEG_SEG : 8;
  let rows: readonly Row[] = legRows;
  if (woman) {
    const y0 = crotch * ys;
    const fine = smooth(legRows).filter((r, i) => r[0] < y0 - 0.012 * ys && (i % 2 === 0 || r[0] > 0.42 * ys));
    const at = (y: number): Row => {
      const [a, b, z] = rowAt(legRows, y);
      return [y, a, b, z];
    };
    const extra = [...(legCut === null ? [] : [legCut - 0.005 * ys, legCut]), y0].filter((y, i, all) => all.indexOf(y) === i && fine.every((r) => Math.abs(r[0] - y) > 0.002 * ys)).map(at);
    rows = [...fine, ...extra].sort((p, q) => p[0] - q[0]);
  }
  /** (The points where a woman's legs part, on the middle: the first leg's, which the second shares.) */
  let parting: number[] | null = null;
  for (const [s, thigh, shin, foot] of [[-1, THIGH_L, SHIN_L, FOOT_L], [1, THIGH_R, SHIN_R, FOOT_R]] as const) {
    const x = (r: Row): number => legX(s, r[0]);
    const l0 = mark();
    const i0 = tb.idx.length;
    const bound = (r: Row): Weight => (r[0] > 0.88 * ys ? blend(thigh, PELVIS, 0.6) : blend(thigh, shin, clamp01((r[0] - (knee - 0.06 * ys)) / (0.1 * ys))));
    tb.loft(rows, x, bound, L.shade, legSeg);
    if (woman) {
      if (legCut !== null) for (let i = l0; i < mark(); i++) if (tb.pos[i * 3 + 1] > legCut - 1e-5) tb.shade[i] = bottomShade;
      // (The top of the leg is shared with the pelvis as the hips are: thighShare.)
      for (let i = l0; i < mark(); i++) {
        const share = thighShare(tb.pos[i * 3], tb.pos[i * 3 + 1], tb.pos[i * 3 + 2]);
        if (share >= 1) continue;
        tb.b0[i] = thigh;
        tb.b1[i] = PELVIS;
        tb.w[i] = share;
      }
      // The top ring's inner points go to the middle, front to back under the body (the two legs' are the same
      // points, and the hips'); its outer ones are joined to the lowest ring of the hips' half on this side.
      const top = l0 + (rows.length - 1) * LEG_SEG;
      const inner = s < 0 ? [2, 1, 0, 11, 10] : [4, 5, 6, 7, 8];
      const outer = s < 0 ? [3, 4, 5, 6, 7, 8, 9] : [3, 2, 1, 0, 11, 10, 9];
      const y0 = crotch * ys, zc = rows[rows.length - 1][3];
      // (Its front end well behind the hips' smooth front, tucked in between the thighs: further forward it stood out
      // as a flap when a thigh was raised or the legs parted.)
      const line: V3[] = [[0, y0, zc + PART_TUCK], [0, y0 - 0.005, zc + 0.026], [0, y0 - 0.007, zc + 0.002], [0, y0 - 0.005, zc - 0.026], [0, y0, zc - PART_BACK]];
      if (!parting) {
        parting = inner.map((j) => top + j);
        parting.forEach((i, n) => {
          tb.pos.splice(i * 3, 3, ...line[n]);
          tb.b0[i] = tb.b1[i] = PELVIS;
          tb.w[i] = 1;
        });
        if (cleft) tb.shade[parting[4]] -= CLEFT_SHADE;
      } else {
        const same = new Map(inner.map((j, n) => [top + j, parting![n]]));
        for (let q = i0; q < tb.idx.length; q++) tb.idx[q] = same.get(tb.idx[q]) ?? tb.idx[q];
        // (Left behind, used by nothing: out of the way, inside the body.)
        for (const i of same.keys()) tb.pos.splice(i * 3, 3, 0, y0 + 0.05, 0);
      }
      const half = s < 0 ? Array.from({ length: hipBack - hipFront + 1 }, (_, n) => hipFront + n) : Array.from({ length: hipAngles.length - (hipBack - hipFront) + 1 }, (_, n) => (hipFront - n + hipAngles.length) % hipAngles.length);
      zip(tb, [parting[0], ...outer.map((j) => top + j), parting[4]], half.map((j) => hipRing + j), false, s > 0);
    }
    // (The buttocks run on into the thighs.)
    displace(tb, l0, bodyField);
    const fx = woman ? s * 0.052 : s * P.hipX * 0.88;
    const s0 = mark();
    const grown = (g: number, lo: number, hi: number): Row[] => rows.filter((r) => r[0] >= lo * ys && r[0] <= hi * ys).map(([y, a, b, z]): Row => [y, a + g, b + g, z]);
    if (legCut !== null) {
      const [w, d, z0] = rowAt(rows, legCut);
      const s1 = mark();
      // (A woman's shorts: the hem standing a little off the leg. A man's and a child's are lofted over the thighs,
      // up only to under the shirt's hem, a little slimmer there, so they don't come through it.)
      if (!woman) tb.loft([[legCut, w + 0.011, d + 0.011, z0], ...grown(0.005, legCut / ys + 0.012, 0.87)], x, bound, bottomShade, 8);
      else if (!gym) {
        const [w1, d1, z1] = rowAt(rows, legCut + 0.02 * ys);
        tb.loft([[legCut - 0.004 * ys, w + 0.008, d + 0.008, z0], [legCut + 0.02 * ys, w1 + 0.003, d1 + 0.003, z1]], x, bound, bottomShade, LEG_SEG);
      }
      displace(tb, s1, field);
      // (White socks with them.)
      if (gym) tb.loft(grown(0.004, 0, 0.2), x, bound, WHITES, legSeg);
    }
    // Knee boots with a short skirt; a stripe down the outside of a track suit's leg.
    if (outfit === 'mini') tb.loft(grown(0.005, 0, 0.43), x, bound, SHOE, legSeg);
    if (outfit === 'track') tb.loft(grown(0.004, 0.09, 0.88), x, bound, LENS, 2, 2, 'y', s < 0 ? [Math.PI - 0.3, Math.PI + 0.3] : [-0.3, 0.3]);
    // A schoolgirl's knee socks.
    if (woman && outfit === 'school') tb.loft(rows.filter((r) => r[0] <= 0.43 * ys).map(([y, a, b, z]): Row => [y, a + 0.003, b + 0.003, z]), x, bound, NAVY - 0.1, legSeg);
    // (kz along the foot, kw across and up: a woman's boots and sandals are smaller than a man's.)
    const shoe = (R: readonly Row[], kz: number, kw: number, shade: number): void =>
      tb.loft(R.map(([z, a, h, y]): Row => [z * P.leg * kz, a * P.leg * kw, h * P.leg * kw, y * P.leg * kw]), () => fx, () => one(foot), shade, 8, 2.8, 'z');
    // (A nurse's white shoes; the old boss's, with his white suit.)
    const shoeShade = outfit === 'nurse' || outfit === 'gym' || (outfit === 'yakuza' && v === 3) ? WHITES : SHOE;
    if (footwear === 'pump') {
      shoe(PUMP_ROWS, 1, 1, SHOE);
      tb.loft(HEEL.map(([y, a, b, z]): Row => [y * P.leg, a, b, z * P.leg]), () => fx, () => one(foot), SHOE, 5);
    } else if (footwear === 'flat') shoe(FLAT_ROWS, 1, 1, shoeShade);
    else if (footwear === 'boot') shoe(BOOT_ROWS, woman ? 0.76 : 1, woman ? 0.8 : 1, SHOE);
    else if (footwear === 'sandal') {
      const k = woman ? 1 : 1.22;
      shoe(SOLE_ROWS, k, k, SHOE);
      shoe(BARE_ROWS, k, k, outfit === 'kimono' ? WHITE : SKIN);
    } else if (footwear === 'bare') {
      const k = woman ? 1 : 1.22;
      shoe(BARE_ROWS.map(([z, a, h, y]): Row => [z, a, h, y - BARE_DROP]), k, k, SKIN);
    }
    else shoe(SHOE_ROWS, 1, 1, shoeShade);
    shoes.push([s0, mark()]);
  }
  if (bareWoman && parting) {
    // The form under her, between the legs (BARE_UNDER): with the pelvis.
    {
      const y0 = crotch * ys, zc = rows[rows.length - 1][3];
      for (const sd of [-1, 1]) tb.loft(BARE_UNDER.rows.map(([z, w, h, y]): Row => [zc + z, w, h, y0 + y]), () => sd * BARE_UNDER.x, () => one(PELVIS), SKIN, 12, 2.6, 'z');
    }
  }

  // ---- Arms and hands ----
  // (A woman's arms hang a little inside the joints: narrower shoulders.)
  const armIn = woman ? 0.014 : 0;
  const ax = (y: number): number =>
    (y >= 1.42 ? P.shoulderX * 0.97 : y >= 1.13 ? P.elbowX + ((y - 1.13) / 0.29) * (P.shoulderX - P.elbowX) : P.wristX + ((y - 0.865) / 0.265) * (P.elbowX - P.wristX)) - armIn;
  // (A tattooed man's are inked to the wrist; a jacket's or a coat's sleeves; a politician's white gloves.)
  const armShade = BARE_ARMS.includes(outfit) ? SKIN : outfit === 'irezumi' ? INK : (coatShade ?? (outfit === 'doctor' ? WHITES : outfit === 'long' && !woman ? TAN : topShade));
  const handShade = politician ? WHITES : SKIN;
  for (const [s, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) {
    const ak = P.arm * (woman ? 0.88 : 1) * limb;
    const rows = ARM.map(([y, a, b, z]): Row => [y * ys, a * ak, b * ak, z * ak]);
    tb.loft(rows, (r) => s * ax(r[0] / ys), (r) => (r[0] > 1.4 * ys ? blend(arm, SPINE, 0.6) : blend(arm, fore, clamp01((r[0] - 1.08 * ys) / (0.1 * ys)))), armShade, 6);
    // The hand: curling in a little toward the thigh, the thumb's base standing out at the front. A man's is longer.
    const hl = woman || body === 'child' ? 1 : 1.14;
    const curl = (y: number): number => 0.012 * Math.pow(clamp01((0.868 - y / ys) / (0.14 * hl)), 2);
    const h0 = mark();
    tb.loft(HAND.map(([y, a, b, z]): Row => [(0.868 - (0.868 - y) * hl) * ys, a * P.arm, b * P.arm, z]), (r) => s * (P.wristX + 0.003 - armIn - curl(r[0])), () => one(fore), handShade, 6);
    displace(tb, h0, [{ c: [s * (P.wristX - armIn), (0.868 - 0.05 * hl) * ys, 0.03], r: [0.04, 0.03 * hl * ys, 0.03], push: [0, 0, 0.01] }]);
  }

  // ---- Outfits ----
  /** A thin panel over the torso's front (side 1) or back (-1), between two heights (man's), narrowing by `w`. */
  const panel = (y0: number, y1: number, w: (y: number) => number, side: number, shade: number, off = 0.004, thick = 0.007): void => {
    const rows: Row[] = [];
    for (let i = 0; i <= 4; i++) {
      const y = (y0 + ((y1 - y0) * i) / 4) * ys;
      const [, d, z] = torsoAt(y);
      rows.push([y, w(y / ys) * xs, thick, z + side * (d + off + thick)]);
    }
    over(rows, (r) => (r[0] > waist ? one(SPINE) : one(PELVIS)), shade, 8, 6);
  };
  /** A case in the left hand (a briefcase, a school bag), `k` its size. */
  const caseInHand = (k: number): void => tb.loft(CASE.map(([y, a, b, z]): Row => [y * ys, a, b * k, z]), () => -(P.wristX + 0.012), () => one(FORE_L), BROWN, 8, 6);
  const armRows = (rows: readonly Row[], s: number, shade: number, arm: number, fore: number): void =>
    tb.loft(rows.map(([y, a, b, z]): Row => [y * ys, a * P.arm, b * P.arm, z * P.arm]), (r) => s * ax(r[0] / ys), (r) => (r[0] > 1.4 * ys ? blend(arm, SPINE, 0.6) : r[0] > 1.18 * ys ? one(arm) : one(fore)), shade, 8);
  const gs = woman ? 0.95 : P.arm;
  /** A skirt from a hem (explicit rows below the hips) up over the hips to the waist. */
  const skirt = (below: readonly Row[], shade: number, seg: number, n: number, top = 1.05): void =>
    over([...below.map(([y, a, b, z]): Row => [y * ys, a * gs, b * gs, z * gs]), wrap(0.86, 0.014), wrap(0.93, 0.011), wrap(1.0, 0.008), wrap(top, 0.006)], drape, shade, seg, n);
  const F = Math.PI / 2;
  const ARMS = [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const;
  const shortSleeves = (shade: number): void => {
    for (const [sd, arm, fore] of ARMS) armRows(SHORT_SLEEVE, sd, shade, arm, fore);
  };
  /** Something lofted over the arm from `lo` up (man's heights), grown by g(i), bending at the elbow with it. */
  const overArm = (lo: number, hi: number, g: (i: number) => number, shade: number, seg: number, arc?: (sd: number) => readonly [number, number]): void => {
    for (const [sd, arm, fore] of ARMS) {
      const rows = ARM.filter((r) => r[0] >= lo && r[0] <= hi).map(([y, a, b, z], i): Row => [y * ys, a * P.arm + g(i), b * P.arm + g(i), z * P.arm]);
      tb.loft(rows, (r) => sd * ax(r[0] / ys), (r) => (r[0] > 1.4 * ys ? blend(arm, SPINE, 0.6) : blend(arm, fore, clamp01((r[0] - 1.08 * ys) / (0.1 * ys)))), shade, seg, 2, 'y', arc?.(sd));
    }
  };
  /** A stand collar round the neck (`open`: left open that far either side of the throat). */
  const collar = (shade: number, open = 0): void =>
    tb.loft([[1.45 * ys, 0.088 * gs, 0.07 * gs, -0.008], [1.515 * ys, 0.068 * gs, 0.064 * gs, -0.014]], () => 0, () => one(SPINE), shade, 10, 2.4, 'y', open ? [F + open, F + 2 * Math.PI - open] : undefined);
  /**
   * Glasses: a frame across the brow, a lens under it before each eye (pale, or a pair of sunglasses' dark), the
   * arms back to the ears. (A little further out in front of a fringe, so the hair doesn't cross the lenses.)
   */
  const glasses = (lens: number): void => {
    const gz = feminine ? 0.009 : 0;
    const onFace = (rows: readonly Row[], x: number, shade: number, seg: number, n: number): void =>
      tb.loft(rows.map(([z, a, h, y]): Row => [(z > 0.05 ? z + gz : z) * hk, a * hk, h * hk, neckY + y * hk]), () => x * hk, () => one(HEAD), shade, seg, n, 'z');
    onFace([[0.093, 0.076, 0.0045, 0.112], [0.103, 0.076, 0.0045, 0.112], [0.1035, 0, 0, 0.112]], 0, 0.4, 8, 6);
    // (Each lens's front closes to a point: a ring left open there shows as a dot in its middle.)
    for (const sd of [-1, 1]) {
      onFace([[0.094, 0.03, 0.019, 0.091], [0.102, 0.031, 0.02, 0.091], [0.1026, 0, 0, 0.091]], sd * 0.04, lens, 10, 3.2);
      onFace([[-0.012, 0.003, 0.0045, 0.104], [0.1, 0.003, 0.0045, 0.11]], sd * 0.079, 0.4, 4, 6);
    }
  };
  /** A gauze mask over the nose and mouth, down under the chin. */
  const mask = (): void => {
    const from = mark();
    tb.loft(skull.filter((r) => r[0] < neckY + 0.09 * hk).slice(1).map(([y, a, b, z]): Row => [y, a + 0.006 * hk, b + 0.007 * hk, z]), () => 0, () => one(HEAD), WHITES, 8, 2.1, 'y', [F - 1.1, F + 1.1]);
    displace(tb, from, headField(FACE));
  };
  /** A band round the head at the brow (a hachimaki, a tie), standing `g` off the skull: over the hair. */
  const headband = (shade: number, g: number): void => {
    const at = (y: number, k: number): Row => {
      const [w, d, z] = rowAt(dome, neckY + y * hk);
      return [neckY + y * hk, w + k * hk, d + k * hk, z];
    };
    tb.loft([at(0.136, 0.002), at(0.14, g), at(0.17, g), at(0.174, 0.002)], () => 0, () => one(HEAD), shade, 12, 2.1);
  };
  /** A hood up over the head (HOOD): open at the face, closed over the brow, its inside faced too (darker). */
  const hoodUp = (shade: number): void => {
    const seg = 12;
    for (const inside of [false, true]) {
      const start = mark();
      const g = inside ? -0.008 : 0;
      for (const [y, a, b, z, open] of HOOD) {
        for (let j = 0; j <= seg; j++) {
          const t = F + open + ((2 * Math.PI - 2 * open) * j) / seg;
          const py = neckY + y * hk;
          tb.pos.push(Math.max(0.002, a + g) * hk * se(Math.cos(t)), py, (z + Math.max(0.002, b + g) * se(Math.sin(t))) * hk);
          // Below the neck joint it lies on the shoulders.
          tb.b0.push(HEAD);
          tb.b1.push(SPINE);
          tb.w.push(1 - clamp01((neckY - py) / (0.08 * ys)));
          tb.shade.push(inside ? shade - 0.3 : shade);
        }
      }
      for (let k = 0; k + 1 < HOOD.length; k++) {
        for (let j = 0; j < seg; j++) {
          const a = start + k * (seg + 1) + j, b = a + 1, c = b + seg + 1, d = a + seg + 1;
          if (inside) tb.idx.push(a, b, c, a, c, d);
          else tb.idx.push(a, c, b, a, d, c);
        }
      }
    }
  };
  /** A point on the torso (or on `rows` over it): at a height (the man's) and an angle (from +x; F is the front), `g` off it. */
  const E24 = 2 / 2.4;
  const onTorso = (y: number, t: number, g: number, rows: readonly Row[] = T): V3 => {
    const [w, d, z] = rowAt(rows, y * ys);
    const c = Math.cos(t), sn = Math.sin(t);
    return [(w + g) * Math.sign(c) * Math.pow(Math.abs(c), E24), y * ys, z + (d + g) * Math.sign(sn) * Math.pow(Math.abs(sn), E24)];
  };
  /** (A width on the torso as an angle round it: about this far from its axis.) */
  const GIRTH = 0.14 * xs;
  const put = (p: V3, weight: (r: Row, i: number, x: number) => Weight, shade: number): void => {
    const [b0, b1, w] = weight([p[1], 0, 0, 0], 0, p[0]);
    tb.pos.push(p[0], p[1], p[2]);
    tb.b0.push(b0);
    tb.b1.push(b1);
    tb.w.push(w);
    tb.shade.push(shade);
  };
  /**
   * A flat strip lying on the torso along a path of [height (the man's), angle]: a sash, a chain, a collar's wing.
   * `half` its half width (m), one for all or one per point; `g` how far off the surface (by height). It takes the
   * body's form with it (cut finer where it runs round the body, so it doesn't cut through it).
   */
  const ribbon = (line: readonly (readonly [number, number])[], half: number | readonly number[], g: (y: number) => number, shade: number, rows: readonly Row[] = T, weight: (r: Row, i: number, x: number) => Weight = hips): void => {
    const from = mark();
    const path: [number, number, number][] = [];
    line.forEach(([y, t], i) => {
      const h = typeof half === 'number' ? half : half[i];
      if (i > 0) {
        const [y0, t0, h0] = path[path.length - 1];
        const n = Math.ceil(Math.abs(t - t0) / 0.22);
        for (let k = 1; k < n; k++) path.push([y0 + ((y - y0) * k) / n, t0 + ((t - t0) * k) / n, h0 + ((h - h0) * k) / n]);
      }
      path.push([y, t, h]);
    });
    path.forEach(([y, t, h], i) => {
      // The path's direction along the surface, and across it.
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      let ds = (b[1] - a[1]) * GIRTH, dy = (b[0] - a[0]) * ys;
      const l = Math.hypot(ds, dy) || 1;
      ds /= l;
      dy /= l;
      for (const k of [-1, 1]) {
        const yy = y + (k * h * ds) / ys;
        put(onTorso(yy, t - (k * h * dy) / GIRTH, g(yy), rows), weight, shade);
      }
    });
    for (let i = 0; i + 1 < path.length; i++) {
      const a = from + i * 2, b = a + 1, c = a + 3, d = a + 2;
      tb.idx.push(b, c, d, b, d, a);
    }
    displace(tb, from, field);
  };
  /** A small round patch on the torso (a button, a pin, a flower on a shirt), radius r, `g` off the surface. */
  const disc = (y: number, t: number, r: number, g: number, shade: number, n = 6, rows: readonly Row[] = T, weight: (r: Row, i: number, x: number) => Weight = hips): void => {
    const from = mark();
    put(onTorso(y, t, g + r * 0.2, rows), weight, shade);
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      put(onTorso(y + (r * Math.sin(a)) / ys, t - (r * Math.cos(a)) / GIRTH, g, rows), weight, shade);
    }
    for (let j = 0; j < n; j++) tb.idx.push(from, from + 1 + j, from + 1 + ((j + 1) % n));
    displace(tb, from, field);
  };
  /**
   * A jacket or a coat worn open: from its skirt (`below`: a long coat's rows under the hips; none, a jacket's hem
   * at the hip) up over the shoulders to the neck, the front left open `gap` either side of the middle. Its rows.
   */
  const openCoat = (below: readonly Row[], shade: number, gap: number, g = 0.02): Row[] => {
    const hip = wrap(0.9, g);
    // (Its sections close together over a woman's bust, so it lies over it.)
    const chest = woman ? [1.1, 1.15, 1.19, 1.23, 1.27, 1.31, 1.36] : [1.12, 1.2, 1.28, 1.35];
    const rows: Row[] = [
      ...(below.length ? below.map(([y, a, b, z]): Row => [y * ys, a * gs, b * gs, z * gs]) : ([[0.8 * ys, hip[1] - 0.006, hip[2] - 0.006, hip[3]], [0.806 * ys, hip[1], hip[2], hip[3]]] as Row[])),
      hip,
      wrap(0.98, g),
      wrap(1.05, g),
      ...chest.map((y) => wrap(y, g)),
      wrap(1.41, g - 0.004),
      wrap(1.45, g - 0.006),
      wrap(1.478, g - 0.008),
    ];
    over(rows, drape, shade, 18, 2.2, [F + gap, F + 2 * Math.PI - gap]);
    return rows;
  };
  /** A block of embroidery on a coat (its rows): between two heights (the man's), `a` either side of an angle. */
  const block = (rows: readonly Row[], y0: number, y1: number, t: number, a: number, shade: number): void => {
    const at = (y: number): Row => {
      const [w, d, z] = rowAt(rows, y * ys);
      return [y * ys, w + 0.01, d + 0.01, z];
    };
    over([at(y0), at((y0 + y1) / 2), at(y1)], drape, shade, 2, 2.2, [t - a, t + a]);
  };
  /** The outside of each arm between two heights (the man's): a stripe, a block of embroidery, a tattoo's flames. */
  const onArms = (lo: number, hi: number, shade: number, a = 0.45): void => overArm(lo - 0.005, hi + 0.005, () => 0.004, shade, 2, (sd) => (sd < 0 ? [Math.PI - a, Math.PI + a] : [-a, a]));
  /** An open collar: the skin at the throat in a V down the chest, from `y0` up. */
  const throat = (y0: number): void => panel(y0, 1.465, (y) => 0.006 + (y - y0) * 0.36, 1, SKIN, 0.003, 0.003);
  /** A gold chain round the neck, down into the open collar. */
  const chain = (y0: number): void => {
    for (const sd of [-1, 1]) ribbon([[1.468, F + sd * 0.3], [(1.468 + y0) / 2, F + sd * 0.15], [y0, F]], 0.003, () => 0.013, SASH + 0.15);
  };

  if (outfit === 'long') {
    if (woman) skirt([[0.6, 0.218, 0.186, 0.006], [0.62, 0.216, 0.184, 0.006], [0.75, 0.204, 0.168, 0]], TAN - 0.1, 16, 2.2);
    else {
      // A long coat (a tan trench): its skirt to the knee, the body, a collar turned up.
      over([[0.42 * ys, 0.215 * gs, 0.165 * gs, 0], [0.44 * ys, 0.217 * gs, 0.167 * gs, 0], [0.7 * ys, 0.2 * gs, 0.15 * gs, 0], wrap(0.9, 0.022), wrap(1.04, 0.022), wrap(1.2, 0.022), wrap(1.28, 0.024), wrap(1.34, 0.022), wrap(1.42, 0.018), wrap(1.452, 0.018), [1.47 * ys, 0.112 * gs, 0.09 * gs, -0.008], [1.515 * ys, 0.086 * gs, 0.078 * gs, -0.016]], drape, TAN, 16, 2.2);
    }
  } else if (outfit === 'suit') {
    if (woman) {
      skirt([[0.48, 0.14, 0.108, 0], [0.5, 0.146, 0.114, 0], [0.7, 0.172, 0.13, -0.004]], topShade - 0.1, 16, 2.4);
      // The jacket's hem at the hip, and a shoulder bag at the left hip.
      over([wrap(0.93, 0.002), wrap(0.936, 0.02), wrap(1.0, 0.016), wrap(1.06, 0.01)], hips, topShade, S.seg, 2.4);
      tb.loft([[0.84 * ys, 0.03, 0.11, 0], [0.86 * ys, 0.034, 0.12, 0], [1.0 * ys, 0.034, 0.12, 0], [1.02 * ys, 0.03, 0.11, 0]], () => -(P.hipX + 0.125), () => one(PELVIS), BROWN, 8, 6);
    } else {
      // The jacket's skirt over the hips, a little proud of the body.
      over([wrap(0.815, 0.002), wrap(0.82, 0.02), wrap(0.9, 0.019), wrap(0.99, 0.016), wrap(1.06, 0.012)], hips, topShade, S.seg, 2.4);
      caseInHand(1);
    }
    // The white shirt's V at the collar and a red tie down it.
    panel(1.26, 1.46, (y) => 0.012 + (y - 1.26) * 0.24, 1, WHITES);
    if (!woman) panel(1.08, 1.43, () => 0.014, 1, APRON - 0.1, 0.012);
  } else if (outfit === 'maid') {
    const rows = MAID_SKIRT.map(([y, a, b, z]): Row => [y * ys, a * 0.95, b * 0.95, z * 0.95]);
    over(rows, drape, topShade, 18, 2);
    // The skirt at a height: its section, grown by `g` (the apron and lace sit just outside it).
    const skirtAt = (y: number, g: number): Row => {
      const [w, d, z] = rowAt(rows, y);
      return [y, w + g, d + g, z];
    };
    // Lace under the hem (the petticoat's edge).
    over([skirtAt(0.665 * ys, -0.01), [0.63 * ys, 0.25, 0.226, 0.015], [0.65 * ys, 0.262, 0.238, 0.015], skirtAt(0.67 * ys, 0.006)], drape, WHITES, 18, 2);
    // The apron round the front of the skirt, a frill along its bottom, and the waistband all round.
    over([0.7, 0.76, 0.86, 0.95, 1.03].map((y) => skirtAt(y * ys, 0.012)), drape, WHITES, 10, 2, [F - 1.0, F + 1.0]);
    const flare = skirtAt(0.7 * ys, 0.03);
    over([[0.672 * ys, flare[1], flare[2], flare[3]], skirtAt(0.7 * ys, 0.014)], drape, WHITES - 0.1, 10, 2, [F - 1.05, F + 1.05]);
    over([wrap(1.04, 0.012), wrap(1.085, 0.012)], hips, WHITES, 16, 2.4);
    // The bib up the chest, a frill along its top, and straps over the shoulders to the back.
    over([1.08, 1.14, 1.2, 1.26, 1.32].map((y) => wrap(y, 0.008)), () => one(SPINE), WHITES, 10, 2.4, [F - 0.7, F + 0.7]);
    over([wrap(1.32, 0.008), wrap(1.345, 0.022)], () => one(SPINE), WHITES - 0.1, 10, 2.4, [F - 0.74, F + 0.74]);
    for (const c of [F - 0.55, F + 0.55, -F + 0.5, -F - 0.5]) over([1.31, 1.36, 1.42, 1.455].map((y) => wrap(y, 0.009)), () => one(SPINE), WHITES, 2, 2.4, [c - 0.07, c + 0.07]);
    // The bow at the back of the waist, its two loops and tails.
    const [, bd, bz] = torsoAt(1.06 * ys);
    const back = bz - bd - 0.02;
    for (const sd of [-1, 1]) {
      const y = 1.07 * ys;
      tb.loft([[y - 0.045, 0.004, 0.004, back], [y - 0.03, 0.04, 0.02, back - 0.006], [y, 0.055, 0.026, back - 0.01], [y + 0.03, 0.04, 0.02, back - 0.006], [y + 0.045, 0.004, 0.004, back]], () => sd * 0.055, hips, WHITES, 8);
      tb.loft([[0.84 * ys, 0.022, 0.005, back - 0.03], [1.05 * ys, 0.016, 0.005, back]], () => sd * 0.03, hips, WHITES, 6, 6);
    }
    // A white collar at the neck.
    over([wrap(1.44, 0.006), wrap(1.475, 0.006)], () => one(SPINE), WHITES, 10, 2.4, [F - 1.2, F + 1.2]);
    // Puffed sleeves with white cuffs.
    for (const [sd, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) {
      armRows(PUFF, sd, topShade, arm, fore);
      armRows(CUFF, sd, WHITES, arm, fore);
    }
    // The katyusha: a band arching over the head from ear to ear, a frill of lace along its front.
    const hoop = (z: number, w: number, h: number): Row => [z * hk, w * hk, h * hk, neckY + 0.118 * hk];
    tb.loft([hoop(-0.012, 0.1, 0.138), hoop(0.012, 0.1, 0.138)], () => 0, () => one(HEAD), 0.5, 12, 2, 'z', [Math.PI + 0.5, 2 * Math.PI - 0.5]);
    tb.loft([hoop(0.012, 0.101, 0.139), hoop(0.026, 0.113, 0.154)], () => 0, () => one(HEAD), WHITES, 12, 2, 'z', [Math.PI + 0.62, 2 * Math.PI - 0.62]);
  } else if (outfit === 'school') {
    if (woman) {
      skirt([[0.6, 0.212, 0.18, 0.008], [0.64, 0.21, 0.178, 0.008]], NAVY, 16, 3.5);
      // A sailor uniform: the white top (with the torso), the navy skirt, the navy collar's flap down the back, the red scarf at the front.
      panel(1.33, 1.47, () => 0.13, -1, NAVY);
      panel(1.3, 1.38, () => 0.035, 1, APRON);
    }
    if (body === 'child') {
      // The randoseru on the back, red.
      const yb = [0.6, 0.62, 0.84, 0.86].map((y) => (y * ys) / 0.6);
      const back = Math.min(...yb.map((y) => torsoAt(y)[2] - torsoAt(y)[1]));
      tb.loft(yb.map((y, i): Row => [y, i % 3 === 0 ? 0.095 : 0.105, i % 3 === 0 ? 0.05 : 0.06, back - 0.06]), () => 0, () => one(SPINE), APRON, 8, 6);
    } else caseInHand(0.8);
  } else if (outfit === 'kimono' || outfit === 'yukata') {
    const yukata = outfit === 'yukata';
    const cloth = robe;
    // The robe to the ankles, straight over the hips; the obi round the waist (wide for a woman's kimono; a
    // yukata's sash golden yellow, whatever the figure's colour).
    over([[0.07 * ys, 0.13 * gs, 0.11 * gs, 0.01], [0.1 * ys, 0.14 * gs, 0.115 * gs, 0.01], [0.35 * ys, 0.158 * gs, 0.122 * gs, 0.01], [0.65 * ys, 0.172 * gs, 0.128 * gs, 0], wrap(0.86, 0.012), wrap(0.93, 0.01), wrap(1.0, 0.008)], drape, cloth, 14, 2.4);
    const obi = (y: number, g: number): Row => {
      const r = wrap(y, g);
      return [r[0], Math.max(r[1], 0.166 * gs), Math.max(r[2], 0.118 * gs), r[3]];
    };
    tb.loft([obi(0.97, 0.004), obi(0.99, 0.012), obi(1.17, 0.012), obi(1.19, 0.004)], () => 0, hips, yukata ? SASH : woman ? WHITES : TAN - 0.4, 14, 2.4);
    if (woman || (yukata && body === 'child')) {
      // The obi's bow on the back.
      const [, d, z] = torsoAt(1.08 * ys);
      const k = yukata ? gs : 1;
      tb.loft([1.0, 1.02, 1.16, 1.18].map((y, i): Row => [y * ys, (i % 3 === 0 ? 0.11 : 0.13) * k, (i % 3 === 0 ? 0.025 : 0.035) * k, z - Math.max(d, 0.118 * gs) - 0.045 * k]), () => 0, () => one(SPINE), yukata ? SASH - 0.15 : WHITES - 0.1, 8, 6);
    }
    // The collar crossing at the chest.
    panel(1.26, 1.47, (y) => 0.01 + (y - 1.26) * 0.2, 1, yukata ? NAVY : WHITES);
    const sleeve = yukata ? SLEEVE.map(([y, a, b, z]): Row => [y + 0.06, a, b * 0.85, z]) : SLEEVE;
    for (const [sd, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) armRows(sleeve, sd, cloth, arm, fore);
  } else if (outfit === 'work') {
    // A hard hat with its brim (orange, whatever the figure's colour), and a hi-vis vest with two reflective bands.
    tb.loft(headRows([[0.13, 0.126, 0.136, -0.005], [0.14, 0.126, 0.136, -0.005], [0.145, 0.094, 0.112, -0.008], [0.2, 0.09, 0.106, -0.01], [0.244, 0.054, 0.064, -0.012], [0.26, 0.003, 0.003, -0.012]]), () => 0, () => one(HEAD), HARD_HAT, 12, 2.1);
    over([1.0, 1.1, 1.2, 1.3, 1.38].map((y) => wrap(y, 0.012)), hips, HIVIS, S.seg, 2.4);
    for (const y of [1.1, 1.24]) over([wrap(y, 0.016), wrap(y + 0.035, 0.016)], () => one(SPINE), LENS, S.seg, 2.4);
  } else if (outfit === 'police') {
    // A peaked cap with a lighter band, and the duty belt.
    tb.loft(headRows([[0.155, 0.088, 0.11, -0.006], [0.18, 0.096, 0.118, -0.01], [0.212, 0.108, 0.128, -0.014], [0.226, 0.104, 0.123, -0.015], [0.232, 0.003, 0.003, -0.015]]), () => 0, () => one(HEAD), 0.7, 12, 2.1);
    tb.loft(headRows([[0.155, 0.089, 0.111, -0.006], [0.172, 0.092, 0.114, -0.008]]), () => 0, () => one(HEAD), WHITE * 0.6, 12, 2.1);
    tb.loft(headRows(VISOR.map(([y, a, b, z]): Row => [y + 0.02, a * 1.05, b * 1.1, z + 0.004])), () => 0, () => one(HEAD), 0.4, 8);
    over([wrap(0.955, 0.014), wrap(1.0, 0.014)], hips, 0.4, S.seg, 2.4);
  } else if (outfit === 'otaku') {
    // A rucksack on the back (dark green, whatever the figure's colour), its straps over the shoulders and down the chest (the hands hold them: people.ts
    // STRAP_HOLD), and glasses.
    const ys0 = [1.04, 1.06, 1.36, 1.39].map((y) => y * ys);
    const back = Math.min(...ys0.map((y) => torsoAt(y)[2] - torsoAt(y)[1]));
    const k = body === 'child' ? 0.75 : 1;
    tb.loft(ys0.map((y, i): Row => [y, (i % 3 === 0 ? 0.12 : 0.135) * k, (i % 3 === 0 ? 0.06 : 0.075) * k, back - 0.075 * k]), () => 0, () => one(SPINE), PACK, 10, 3);
    // The straps, each all the way round: down the chest, over the shoulder to the top of the pack, and from the
    // chest's foot round under the arm to the pack's foot.
    const SA = 0.52, SW = 0.085, ST = PACK - 0.25, SG = 0.013;
    const [w5, d5, z5] = torsoAt(1.45 * ys);
    const e = 2 / 2.4;
    for (const sd of [-1, 1]) {
      const front = F - sd * SA;
      const rear = -F + sd * SA;
      over([1.1, 1.16, 1.22, 1.28, 1.34, 1.4, 1.45].map((y) => wrap(y, SG)), () => one(SPINE), ST, 2, 2.4, [front - SW, front + SW]);
      over([1.3, 1.36, 1.41, 1.45].map((y) => wrap(y, SG)), () => one(SPINE), ST, 2, 2.4, [rear - SW, rear + SW]);
      over([wrap(1.085, SG), wrap(1.125, SG)], hips, ST, 6, 2.4, sd > 0 ? [rear, front] : [front, rear + 2 * Math.PI]);
      // Over the top of the shoulder, front to back, arched over where the torso closes in to the neck.
      const sx = sd * (w5 + SG) * Math.pow(Math.sin(SA), e);
      const reach = (d5 + SG) * Math.pow(Math.cos(SA), e);
      let top = 1.45 * ys;
      while (top < 1.53 * ys && torsoAt(top)[0] > Math.abs(sx)) top += 0.004;
      const rise = top - 1.45 * ys + 0.012;
      tb.loft([0, 0.2, 0.4, 0.6, 0.8, 1].map((u): Row => [z5 - reach + 2 * reach * u, 0.015, 0.006, 1.45 * ys - 0.004 + rise * Math.sin(Math.PI * u)]), () => sx, () => one(SPINE), ST, 4, 6, 'z');
    }
    glasses(LENS);
  } else if (outfit === 'dress') {
    // A one-piece dress to the knee, flaring from the waist, a sash round it; short sleeves.
    skirt([[0.5, 0.206, 0.172, 0.004], [0.52, 0.205, 0.171, 0.004], [0.7, 0.19, 0.15, 0]], topShade, 16, 2.2);
    over([wrap(1.04, 0.01), wrap(1.085, 0.01)], hips, WHITES, 16, 2.4);
    shortSleeves(topShade);
  } else if (outfit === 'mini') {
    // A sleeveless top and a short tight skirt (the knee boots are with the legs).
    skirt([[0.72, 0.176, 0.136, -0.004], [0.74, 0.178, 0.138, -0.004]], PINK, 16, 2.4);
  } else if (outfit === 'gown') {
    // An evening dress (dark red, whatever the figure's colour): close to the knee, a little flare to the ankle (off the shoulders: with the torso).
    skirt([[0.09, 0.158, 0.136, 0.006], [0.11, 0.156, 0.134, 0.006], [0.42, 0.132, 0.108, 0.002], [0.7, 0.172, 0.132, -0.004]], GOWN, 16, 2.4);
  } else if (outfit === 'shorts') {
    // A T-shirt (the shorts are with the legs).
    shortSleeves(topShade);
  } else if (outfit === 'hoodie' || outfit === 'hood') {
    // A loose body over the hips, the hood down behind the neck, the pocket on the front.
    // (More sections over a woman's hips, so it lies over her bottom.)
    over([wrap(0.868, 0.004), ...[0.875, ...(woman ? [0.91, 0.95] : []), 1.0, 1.1, 1.2, 1.3, 1.38, 1.43].map((y) => wrap(y, 0.016))], hips, topShade, S.seg, 2.4);
    if (hooded) hoodUp(topShade);
    else {
      const [, hd, hz] = torsoAt(1.42 * ys);
      const back = hz - hd;
      tb.loft([[1.32 * ys, 0.004, 0.004, back - 0.01], [1.335 * ys, 0.075 * gs, 0.026, back - 0.014], [1.39 * ys, 0.118 * gs, 0.046, back - 0.03], [1.455 * ys, 0.112 * gs, 0.05, back - 0.028], [1.5 * ys, 0.07 * gs, 0.034, back - 0.006], [1.51 * ys, 0.004, 0.004, back]], () => 0, () => one(SPINE), topShade - 0.05, 8, 2.4);
    }
    panel(0.96, 1.1, () => 0.078, 1, topShade - 0.08, 0.018);
    // Someone to give room to in an alley ('hood'): the top dark, the hood up over the head (asked for a cap: the cap
    // pulled low, the hood down behind), a gauze mask over the face, or dark glasses.
    if (outfit === 'hood') {
      if (v === 1) glasses(SHADES);
      else mask();
    }
  } else if (outfit === 'office') {
    // Office clothes without the jacket: a white shirt or blouse with its collar.
    if (woman) {
      skirt([[0.48, 0.14, 0.108, 0], [0.5, 0.146, 0.114, 0], [0.7, 0.172, 0.13, -0.004]], NAVY - 0.2, 16, 2.4);
      tb.loft([[0.84 * ys, 0.03, 0.11, 0], [0.86 * ys, 0.034, 0.12, 0], [1.0 * ys, 0.034, 0.12, 0], [1.02 * ys, 0.03, 0.11, 0]], () => -(P.hipX + 0.125), () => one(PELVIS), BROWN, 8, 6);
    } else {
      // The belt, the tie, the briefcase.
      over([wrap(0.955, 0.012), wrap(0.995, 0.012)], hips, 0.4, S.seg, 2.4);
      panel(1.08, 1.43, () => 0.014, 1, APRON - 0.1, 0.006);
      caseInHand(1);
    }
    over([wrap(1.44, 0.006), wrap(1.475, 0.008)], () => one(SPINE), WHITES, 10, 2.4, [F - 1.2, F + 1.2]);
  } else if (outfit === 'track') {
    // A school track suit (red, whatever the figure's colour; teens wear it): the jacket's stand collar, a white stripe down each arm (the legs' are with the legs).
    collar(TRACK);
    overArm(0.9, 1.42, () => 0.004, LENS, 2, (sd) => (sd < 0 ? [Math.PI - 0.3, Math.PI + 0.3] : [-0.3, 0.3]));
  } else if (outfit === 'gym') {
    // School gym clothes (teens, and children): a white short-sleeved shirt, the school's red round its neck; a
    // girl's is tucked into her bloomers (the hips below the waist, and the tops of the legs), a boy's worn out over
    // his shorts; socks and white shoes are with the legs.
    shortSleeves(WHITES);
    tb.loft([[1.452 * ys, 0.09 * gs, 0.07 * gs, -0.008], [1.484 * ys, 0.07 * gs, 0.062 * gs, -0.012]], () => 0, () => one(SPINE), TRACK, 10, 2.4);
  } else if (outfit === 'nurse') {
    // Whites (pale whatever the figure's colour): a woman's dress to the knee, a man's tunic to the thigh, short
    // sleeves, a red cross on the chest, and for a woman the cap with its cross.
    if (woman) skirt([[0.5, 0.186, 0.152, 0.002], [0.52, 0.186, 0.152, 0.002], [0.7, 0.186, 0.146, 0]], WHITES, 16, 2.4);
    else skirt([[0.75, 0.196, 0.15, 0], [0.77, 0.198, 0.152, 0]], WHITES, 16, 2.4);
    shortSleeves(WHITES);
    /** A cross facing forward at (x, y), its back at z: an upright and a bar. */
    const cross = (x: number, y: number, z: number, k: number, bone: number): void => {
      for (const [a, h] of [[0.0055, 0.018], [0.018, 0.0055]]) tb.loft([[z, a * k, h * k, y], [z + 0.012 * k, a * k, h * k, y], [z + 0.0125 * k, 0, 0, y]], () => x, () => one(bone), CROSS, 8, 10, 'z');
    };
    const by = 1.34 * ys;
    const [bw, bd, bz] = torsoAt(by);
    const bx = 0.068 * xs;
    const b0 = mark();
    cross(bx, by, bz + (bd + 0.004) * Math.pow(Math.max(0, 1 - Math.pow(bx / bw, 2.4)), 1 / 2.4), 1.7, SPINE);
    displace(tb, b0, field);
    if (woman) {
      tb.loft(headRows([[0.196, 0.066, 0.056, 0.014], [0.21, 0.072, 0.062, 0.016], [0.262, 0.084, 0.05, 0.02], [0.266, 0, 0, 0.02]]), () => 0, () => one(HEAD), WHITES + 0.2, 12, 2.6);
      cross(0, neckY + 0.238 * hk, 0.068 * hk, hk * 1.2, HEAD);
    }
  } else if (outfit === 'doctor') {
    // A white coat to the knee (white whatever the figure's colour), worn open: what's under it shows down the front.
    const w0 = woman ? 0.198 : 0.212;
    // (Up over the shoulders to the neck; its sections close together over a woman's bust, so it lies over it.)
    const chest = woman ? [1.1, 1.14, 1.18, 1.21, 1.24, 1.27, 1.3, 1.33, 1.36] : [1.2, 1.34];
    over(
      [[0.5 * ys, w0 * gs, 0.162 * gs, 0], [0.52 * ys, (w0 + 0.002) * gs, 0.164 * gs, 0], [0.7 * ys, (woman ? 0.192 : 0.2) * gs, 0.15 * gs, 0], wrap(0.9, 0.02), wrap(1.04, 0.02), ...chest.map((y) => wrap(y, 0.022)), wrap(1.42, 0.016), wrap(1.455, 0.012), wrap(1.482, 0.01)],
      drape,
      WHITES,
      woman ? 28 : 20,
      2.2,
      [F + 0.2, F + 2 * Math.PI - 0.2],
    );
    // The stethoscope round the neck (dark blue, so it shows on the coat): its tube behind the neck and
    // down each side of the chest, the chest piece at the end of one.
    over([wrap(1.445, 0.022), wrap(1.47, 0.022)], () => one(SPINE), STETHOSCOPE, 6, 2.4, [-F - 0.95, -F + 0.95]);
    const sa = 0.42;
    for (const cc of [F - sa, F + sa]) over([1.2, 1.26, 1.32, 1.38, 1.43, 1.465].map((y) => wrap(y, 0.028)), () => one(SPINE), STETHOSCOPE, 2, 2.4, [cc - 0.05, cc + 0.05]);
    const [sw, sd0, sz] = torsoAt(1.185 * ys);
    const piece = mark();
    const pz = sz + (sd0 + 0.028) * Math.pow(Math.cos(sa), 2 / 2.4);
    tb.loft([[pz - 0.004, 0.024, 0.024, 1.185 * ys], [pz + 0.012, 0.024, 0.024, 1.185 * ys], [pz + 0.0125, 0, 0, 1.185 * ys]], () => (sw + 0.028) * Math.pow(Math.sin(sa), 2 / 2.4), () => one(SPINE), STETHOSCOPE + 1.6, 8, 2, 'z');
    displace(tb, piece, field);
  } else if (outfit === 'apron') {
    // Shop staff: an apron (red, whatever the figure's colour) from the chest to above the knee, tied at the waist, its straps over the shoulders, and a cloth over the hair.
    const A = APRON;
    over([[0.56 * ys, 0.17 * gs, 0.132 * gs, 0.008], [0.7 * ys, 0.18 * gs, 0.138 * gs, 0.006], wrap(0.86, 0.016), wrap(0.95, 0.014), wrap(1.04, 0.012)], drape, A, 12, 2.4, [F - 0.85, F + 0.85]);
    // (Closely enough set to lie over a woman's bust.)
    over([1.04, 1.08, 1.12, 1.16, 1.2, 1.24, 1.28, 1.31, 1.34].map((y) => wrap(y, 0.016)), () => one(SPINE), A, woman ? 16 : 8, 2.4, [F - 0.62, F + 0.62]);
    over([wrap(1.03, 0.014), wrap(1.065, 0.014)], hips, A - 0.25, S.seg, 2.4);
    // The neck strap: up from the bib's corners to the neck, and round behind it.
    for (const c of [F - 0.42, F + 0.42]) over([1.33, 1.38, 1.43, 1.472].map((y) => wrap(y, 0.018)), () => one(SPINE), A, 2, 2.4, [c - 0.08, c + 0.08]);
    over([wrap(1.458, 0.018), wrap(1.494, 0.016)], () => one(SPINE), A, 12, 2.4, [F + 0.34, F + 2 * Math.PI - 0.34]);
    tb.loft(headRows([[0.148, 0.098, 0.116, -0.006], [0.2, 0.094, 0.11, -0.01], [0.244, 0.056, 0.066, -0.012], [0.258, 0.003, 0.003, -0.012]]), () => 0, () => one(HEAD), A, 12, 2.1);
  } else if (outfit === 'puffer') {
    // A down jacket: quilted in rolls round the body and the arms, a stand collar.
    over([wrap(0.875, 0.004), ...[0.885, 0.94, 1.0, 1.06, 1.12, 1.18, 1.24, 1.3, 1.36, 1.42].map((y, i) => wrap(y, i % 2 ? 0.02 : 0.032))], hips, topShade, S.seg, 2.4);
    overArm(0.95, 1.44, (i) => (i % 2 ? 0.01 : 0.02), topShade, 6);
    collar(topShade);
  } else if (outfit === 'yakuza') {
    // A mobster: the suit's jacket worn open over a loud shirt, the shirt's collar spread out over the jacket's and
    // the throat bare, a gold chain in it; a belt with a gold buckle, the family's pin on the lapel; sunglasses (not
    // the old boss in off-white, under his hat). (The punch perm is with the hair.)
    openCoat([], coatShade!, 0.5);
    over([wrap(0.955, 0.01), wrap(0.995, 0.01)], hips, 0.4, S.seg, 2.4);
    disc(0.975, F, 0.017, 0.013, SASH + 0.1);
    throat(1.34);
    chain(1.375);
    for (const sd of [-1, 1]) ribbon([[1.476, F + sd * 0.34], [1.452, F + sd * 0.62], [1.42, F + sd * 0.84]], [0.012, 0.024, 0.003], () => 0.024, topShade + 0.12);
    disc(1.35, F + 0.74, 0.008, 0.024, SASH + 0.3);
    if (v !== 3) glasses(SHADES);
  } else if (outfit === 'chinpira') {
    // A street thug: an aloha shirt worn out, big flowers all over it, open at the throat on a gold chain;
    // sunglasses. (His slacks, often white, and his sandals are with the legs.)
    shortSleeves(topShade);
    const flower = [GOWN + 0.25, WHITES, SASH, WHITES][v];
    const FLOWERS: readonly (readonly [number, number])[] = [[1.36, F - 0.62], [1.25, F + 0.55], [1.14, F - 0.3], [1.02, F + 0.45], [0.92, F - 0.6], [1.3, F + 1.5], [1.08, F - 1.5], [1.37, -F + 0.5], [1.24, -F - 0.4], [1.1, -F + 0.3], [0.96, -F - 0.5], [1.0, -F + 1.0]];
    FLOWERS.forEach(([y, t], i) => disc(y, t, i % 3 ? 0.026 : 0.019, 0.014, i % 4 === 3 ? flower - 0.3 : flower, 5));
    throat(1.33);
    chain(1.37);
    glasses(SHADES);
  } else if (outfit === 'irezumi') {
    // A tattooed man in his undershirt: its straps over inked shoulders, the arms inked to above the wrist with red
    // among the blue (peonies, flames), a wool band round the belly. (His sandals are with the legs.)
    over([wrap(1.16, 0.003), wrap(1.23, 0.005), wrap(1.3, 0.005)], () => one(SPINE), WHITES, S.seg, 2.4);
    for (const c of [F - 0.62, F + 0.62, -F + 0.56, -F - 0.56]) over([1.29, 1.33, 1.37, 1.41, 1.44, 1.468].map((y) => wrap(y, 0.006)), () => one(SPINE), WHITES, 3, 2.4, [c - 0.2, c + 0.2]);
    over([wrap(0.925, 0.004), wrap(0.935, 0.015), wrap(1.02, 0.015), wrap(1.1, 0.015), wrap(1.11, 0.004)], hips, TAN - 0.2, S.seg, 2.4);
    overArm(0.85, 1.06, () => 0.0025, SKIN, 6);
    onArms(1.22, 1.32, APRON + 0.2);
    onArms(1.13, 1.22, SASH - 0.2, 0.3);
    // (Bare skin between the pictures: down the breastbone, and in windows on the arms.)
    throat(1.31);
    overArm(1.125, 1.225, () => 0.004, SKIN, 2, () => [F - 0.4, F + 0.4]);
    overArm(1.315, 1.385, () => 0.004, SKIN, 2, () => [-F - 0.4, -F + 0.4]);
    for (const sd of [-1, 1]) disc(1.4, F + sd * 0.36, 0.024, 0.004, APRON + 0.2, 5);
  } else if (outfit === 'bosozoku') {
    // A biker gang's tokkofuku: a long coat to the calf worn open (white, black, plum or navy), a stand collar,
    // blocks of gold embroidery down the back, the chest and the arms (the top one on the back red); a white band
    // round the head, knotted behind, and a gauze mask. (The regent is with the hair, the boots with the legs.)
    const coat = coatShade!;
    const rows = openCoat([[0.3, 0.2, 0.15, 0], [0.32, 0.203, 0.153, 0], [0.62, 0.198, 0.148, 0]], coat, 0.55, 0.022);
    collar(coat, 0.6);
    const gold = SASH + 0.1;
    [1.3, 1.17, 1.04, 0.91, 0.78, 0.65, 0.52].forEach((y, i) => block(rows, y, y + 0.1, -F, i % 2 ? 0.25 : 0.31, i === 0 ? CROSS - 0.2 : gold));
    for (const sd of [-1, 1]) for (const y of [1.3, 1.2, 1.1]) block(rows, y, y + 0.07, F + sd * 0.92, 0.13, gold);
    for (const [lo, hi] of [[0.97, 1.05], [1.13, 1.22], [1.32, 1.38]]) onArms(lo, hi, gold, 0.4);
    over([wrap(0.955, 0.01), wrap(0.995, 0.01)], hips, 0.4, S.seg, 2.4);
    // (The top of the cloth bound round a man's belly.)
    if (!woman) over([wrap(1.08, 0.003), wrap(1.14, 0.005), wrap(1.21, 0.005)], () => one(SPINE), WHITES, S.seg, 2.4);
    const off = cut === 'regent' ? 0.02 : feminine ? 0.03 : 0.012;
    headband(WHITES, off);
    const [, kd, kz] = rowAt(dome, neckY + 0.155 * hk);
    const knot = kz - kd - off * hk;
    for (const sd of [-1, 1]) tb.loft([[neckY + 0.01 * hk, 0.013 * hk, 0.003, knot - 0.03 * hk], [neckY + 0.09 * hk, 0.012 * hk, 0.003, knot - 0.02 * hk], [neckY + 0.155 * hk, 0.008 * hk, 0.003, knot - 0.002 * hk]], () => sd * 0.02 * hk, () => one(HEAD), WHITES, 4, 6);
    mask();
  } else if (outfit === 'yankee') {
    if (woman) {
      // A sukeban (a girls' gang): the sailor uniform in navy, its skirt down to the ankles, the red scarf, a gauze
      // mask, a wooden sword in the left hand.
      skirt([[0.15, 0.2, 0.168, 0.006], [0.17, 0.2, 0.168, 0.006], [0.5, 0.194, 0.162, 0.004], [0.75, 0.186, 0.152, 0]], NAVY, 16, 2.6);
      panel(1.33, 1.47, () => 0.13, -1, NAVY + 0.3);
      ribbon([[1.34, -F - 0.8], [1.34, -F], [1.34, -F + 0.8]], 0.006, () => 0.02, WHITES);
      // (The collar's white line down to the scarf's knot, and the scarf's two ends.)
      for (const sd of [-1, 1]) {
        ribbon([[1.472, F + sd * 0.62], [1.4, F + sd * 0.34], [1.31, F + sd * 0.04]], 0.007, () => 0.006, WHITES);
        ribbon([[1.31, F], [1.25, F + sd * 0.1], [1.2, F + sd * 0.16]], [0.008, 0.016, 0.004], () => 0.008, APRON + 0.1);
      }
      disc(1.31, F, 0.016, 0.009, APRON + 0.1);
      mask();
      tb.loft([[0.1, 0.003, 0.003, 0.11], [0.115, 0.011, 0.015, 0.108], [0.6, 0.012, 0.017, 0.05], [0.9, 0.011, 0.014, 0.012], [0.912, 0.003, 0.003, 0.01]].map(([y, a, b, z]): Row => [y * ys, a, b, z]), () => -(P.wristX + 0.012), () => one(FORE_L), TAN - 0.25, 5);
    } else {
      // A school's gang leader: the uniform's coat long to the knee and worn open (its gold buttons down one edge,
      // the stand collar), a T-shirt under it, a belt. (The regent is with the hair.)
      const rows = openCoat([[0.5, 0.2, 0.15, 0], [0.52, 0.203, 0.153, 0], [0.72, 0.198, 0.148, 0]], coatShade!, 0.5);
      collar(coatShade!, 0.55);
      for (const y of [0.74, 0.9, 1.06, 1.22, 1.37]) disc(y, F - 0.64, 0.01, 0.007, SASH + 0.2, 6, rows, drape);
      over([wrap(0.955, 0.01), wrap(0.995, 0.01)], hips, 0.4, S.seg, 2.4);
    }
  } else if (outfit === 'drunk') {
    // The salaryman at midnight: the jacket hanging open, the shirt's collar undone and a tail of it out, his tie
    // round his head with its end hanging by his ear, and the box of sushi he's taking home on its string in his
    // left hand.
    openCoat([], coatShade!, 0.62);
    over([wrap(0.955, 0.01), wrap(0.995, 0.01)], hips, 0.4, S.seg, 2.4);
    over([wrap(0.86, 0.013), wrap(0.92, 0.014), wrap(0.985, 0.012)], hips, WHITES - 0.05, 3, 2.4, [F + 0.2, F + 0.75]);
    throat(1.36);
    const tie = APRON - 0.1;
    headband(tie, 0.016);
    tb.loft([[neckY - 0.02 * hk, 0.003, 0.003, 0.012], [neckY + 0.002 * hk, 0.005, 0.027 * hk, 0.012], [neckY + 0.09 * hk, 0.005, 0.017 * hk, 0.004], [neckY + 0.15 * hk, 0.005, 0.011 * hk, -0.004]], () => 0.108 * hk, () => one(HEAD), tie, 4, 4);
    const bx = -(P.wristX + 0.012);
    tb.loft([[0.56 * ys, 0.003, 0.003, 0.02], [0.75 * ys, 0.003, 0.003, 0.02]], () => bx, () => one(FORE_L), TAN - 0.5, 3);
    tb.loft([[0.5, 0.003, 0.003], [0.505, 0.07, 0.07], [0.555, 0.07, 0.07], [0.56, 0.003, 0.003]].map(([y, a, b]): Row => [y * ys, a, b, 0.02]), () => bx, () => one(FORE_L), WHITES - 0.12, 8, 8);
  } else if (outfit === 'boss') {
    // The boss (a businessman, a fixer: the heavy body is his): a double-breasted suit closed over the paunch, two
    // rows of gold buttons, the shirt's V and a tie, a gold pin on the lapel and a handkerchief in the breast
    // pocket. A politician out canvassing: a white sash from the shoulder across to the hip and round the back, a
    // rosette on the chest (his white gloves are with the hands).
    over([wrap(0.8, 0.002), wrap(0.806, 0.022), wrap(0.9, 0.021), wrap(0.99, 0.018), wrap(1.06, 0.012)], hips, topShade, S.seg, 2.4);
    panel(1.3, 1.46, (y) => 0.012 + (y - 1.3) * 0.26, 1, WHITES);
    panel(1.3, 1.44, () => 0.015, 1, APRON - 0.1, 0.012);
    for (const sd of [-1, 1]) for (const y of [0.99, 1.09, 1.19]) disc(y, F + sd * 0.27, 0.012, y < 1.07 ? 0.022 : 0.006, SASH);
    if (politician) {
      const g = (y: number): number => (y < 1.09 ? 0.027 : 0.01);
      ribbon([[1.44, F - 0.74], [1.38, F - 0.52], [1.27, F - 0.2], [1.16, F + 0.15], [1.06, F + 0.5], [0.98, F + 0.88], [0.94, F + 1.3], [0.98, F + 1.9], [1.1, F + 2.6], [1.25, F + 3.2], [1.38, F + 3.65], [1.44, F + 3.92]], 0.036, g, WHITES);
      disc(1.33, F + 0.5, 0.026, 0.012, WHITES + 0.2, 8);
      disc(1.33, F + 0.5, 0.013, 0.02, CROSS, 6);
    } else {
      disc(1.385, F + 0.52, 0.009, 0.005, SASH + 0.3);
      disc(1.33, F - 0.55, 0.015, 0.005, WHITES, 4);
    }
  }
  if (bareWoman) {
    // Her navel (NAVEL): on the middle of the belly.
    ribbon(NAVEL.stroke.map(([dy, da]): [number, number] => [NAVEL.y + dy, F + da]), NAVEL.stroke.map((p) => p[2]), () => NAVEL.off, NAVEL.shade);
  }
  if (outfit === 'police') {
    // The uniform in police blue, cap to trouser hems: everything but the skin, the hair and the shoes.
    const dark = (i: number): boolean => (i >= hairFrom && i < hairTo) || shoes.some(([a, b]) => i >= a && i < b);
    for (let i = 0; i < tb.shade.length; i++) if (tb.shade[i] < 100 && !dark(i)) tb.shade[i] += POLICE;
  }
  // ---- Face marks (real/emoteGlsl.ts) ----
  // Small quads lying just off the face, on the head's bone: one where each eye would be, one on each cheek. The
  // mob's material draws an emote's mark in them (hearts or stars for eyes, a blush's hatching) and folds them away
  // the rest of the time; being part of the head they turn, nod and bob with it. Their normals aren't normals: they
  // carry (u, v) across the quad and which it is (set once the template is built, below).
  const marks: [number, V3][] = [];
  for (const [which, phi, y, hw, hh] of [[FACE_EYE, 0.42, 0.088, 0.025, 0.025], [FACE_CHEEK, 0.55, 0.05, 0.026, 0.017]] as const) {
    for (const sd of [-1, 1]) {
      const at = (yy: number): V3 => {
        const q = onHead(sd * phi, yy, 0.006);
        return [q[0] * hk, neckY + q[1] * hk, q[2] * hk];
      };
      const c = at(y), lo = at(y - 0.012), hi = at(y + 0.012);
      // Up the face's slope there; out of the face, square to that; and across.
      let up: V3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const ul = Math.hypot(up[0], up[1], up[2]);
      up = [up[0] / ul, up[1] / ul, up[2] / ul];
      let out: V3 = [c[0], 0, c[2] + 0.006 * hk];
      const d = out[0] * up[0] + out[1] * up[1] + out[2] * up[2];
      out = [out[0] - d * up[0], out[1] - d * up[1], out[2] - d * up[2]];
      const ol = Math.hypot(out[0], out[1], out[2]);
      out = [out[0] / ol, out[1] / ol, out[2] / ol];
      const across: V3 = [up[1] * out[2] - up[2] * out[1], up[2] * out[0] - up[0] * out[2], up[0] * out[1] - up[1] * out[0]];
      const start = mark();
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const a = (u * 2 - 1) * hw * hk, b = (v * 2 - 1) * hh * hk;
        tb.pos.push(c[0] + across[0] * a + up[0] * b, c[1] + across[1] * a + up[1] * b, c[2] + across[2] * a + up[2] * b);
        tb.b0.push(HEAD);
        tb.b1.push(HEAD);
        tb.w.push(1);
        tb.shade.push(FACE_MARK + which);
        marks.push([start + marks.length % 4, [u, v, which]]);
      }
      tb.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const built = (t: Template): Template => {
    for (const [i, n] of marks) t.nor.set(n, i * 3);
    return t;
  };
  if (isTeen(body, outfit)) {
    // Scaled down whole, the joints with it.
    const [kx, ky] = TEEN_SCALE[body];
    for (let i = 0; i < tb.pos.length; i += 3) {
      tb.pos[i] *= kx;
      tb.pos[i + 1] *= ky;
      tb.pos[i + 2] *= kx;
    }
    return built(tb.build(pivot.map((v): V3 => [v[0] * kx, v[1] * ky, v[2] * kx]), armOut));
  }
  return built(tb.build(pivot, armOut));
}
