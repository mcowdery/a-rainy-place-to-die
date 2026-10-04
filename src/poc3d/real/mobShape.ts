import type { Outfit } from '../district/peopleMix';
import { ARM_L, ARM_R, blend, FOOT_L, FOOT_R, FORE_L, FORE_R, HEAD, one, PELVIS, pivotsOf, PROPORTIONS, SHIN_L, SHIN_R, SPINE, TemplateBuilder, THIGH_L, THIGH_R, type Body, type Hair, type Row, type Template, type V3, type Weight } from './mobRig';

/**
 * The mob's shaped generation (under review in mob.html; the district still draws real/people.ts's classic
 * templates): the same skeleton, the same lofts and the same faceless dark figures, with the body anime draws
 * (after COM3D2's models): grown-up and shapely rather than cute.
 *
 * - A woman: a high small waist, a full bust, wide hips and round buttocks, the back hollow (`Bulge`s on a torso
 *   lofted through more sections and smoothed), thighs that taper to slim knees and ankles, the legs close
 *   together, heels, thin arms, a slim neck. A man: wide shoulders tapering to narrow hips.
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

/** Each body's head against life size (a little over, with the hair's volume on top; children's larger). */
const HEAD_K: Record<Body, number> = { man: 1.06, woman: 1.1, child: 1.12, elder: 1 };
/**
 * Teens: whoever wears the school uniform, its track suit or its gym clothes is built as the adult, slighter (a girl's bust less, the head a little
 * larger against the body), then scaled down whole, joints and all: [across, up]. real/people.ts gives them joints
 * of their own in the material (`isTeen`, its teen rows), scaled the same.
 */
export const TEEN_SCALE: Record<'woman' | 'man', readonly [number, number]> = { woman: [0.89, 0.915], man: [0.88, 0.905] };
const TEEN_HEAD = 1.05;
const TEEN_BUST = 0.6;
export const isTeen = (body: Body, outfit: Outfit): body is 'woman' | 'man' => (outfit === 'school' || outfit === 'track' || outfit === 'gym') && (body === 'woman' || body === 'man');

/** A scale on every head, for trying sizes in the mob showroom (set before the templates are built: they're cached). */
let headScale = 1;
export function setShapedHeadScale(k: number): void {
  headScale = k;
}

/** A push on the surface: vertices within the ellipsoid (centre c, radii r) move by `push`, fading to its edge. */
interface Bulge {
  readonly c: V3;
  readonly r: V3;
  readonly push: V3;
  /** How round its top is: 2 a soft bell (the default), nearer 1 a dome. */
  readonly round?: number;
  /** Its reach above its centre, where that's longer than below (a breast: a long upper slope, the underside short). */
  readonly up?: number;
}

/** Bulges with a centre off the middle are mirrored to the other side. */
function displace(tb: TemplateBuilder, from: number, field: readonly Bulge[]): void {
  if (!field.length) return;
  const P = tb.pos;
  for (let i = from * 3; i < P.length; i += 3) {
    let dx = 0, dy = 0, dz = 0;
    for (const b of field) {
      for (const sx of b.c[0] === 0 ? [1] : [1, -1]) {
        const ex = (P[i] - sx * b.c[0]) / b.r[0], ey = (P[i + 1] - b.c[1]) / (P[i + 1] > b.c[1] ? (b.up ?? b.r[1]) : b.r[1]), ez = (P[i + 2] - b.c[2]) / b.r[2];
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= 1) continue;
        const k = Math.pow(1 - d2, b.round ?? 2);
        dx += sx * b.push[0] * k;
        dy += b.push[1] * k;
        dz += b.push[2] * k;
      }
    }
    P[i] += dx;
    P[i + 1] += dy;
    P[i + 2] += dz;
  }
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

interface BodyShape {
  readonly torso: readonly Row[];
  /** The torso's width scale (heights scale by the proportions' ys). */
  readonly xs: number;
  /** Points round the torso. */
  readonly seg: number;
  /** Where they are, when not evenly round it. */
  readonly angles?: readonly number[];
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
    angles: CHEST_ANGLES,
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
type Footwear = 'shoe' | 'flat' | 'pump' | 'boot' | 'sandal';
function footwearOf(body: Body, outfit: Outfit): Footwear {
  if (outfit === 'kimono' || outfit === 'yukata') return 'sandal';
  if (outfit === 'work') return 'boot';
  if (body !== 'woman') return 'shoe';
  return outfit === 'suit' || outfit === 'office' || outfit === 'gown' ? 'pump' : 'flat';
}

/** The outfits worn with trousers (a woman's legs and hips in the bottoms' shade, not bare under a skirt). */
const TROUSERED: readonly Outfit[] = ['plain', 'work', 'police', 'otaku', 'hoodie', 'track', 'nurse', 'doctor', 'apron', 'puffer', 'shorts', 'gym'];
/** The outfits that leave the arms bare (sleeveless, or a short sleeve lofted over the upper arm). */
const BARE_ARMS: readonly Outfit[] = ['dress', 'mini', 'gown', 'shorts', 'nurse', 'gym'];

/** What's on the legs, by body and outfit. */
function legsOf(body: Body, outfit: Outfit, bottom: number): { rows: readonly Row[]; shade: number } {
  // (Shorts, gym clothes: bare legs, the shorts or bloomers lofted over the thighs.)
  const bare = outfit === 'shorts' || outfit === 'gym';
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
  const S = BODY[body];
  const ys = P.ys;
  const xs = S.xs;
  const woman = body === 'woman';
  const tb = new TemplateBuilder();
  const { pivot, armOut } = pivotsOf(body);
  const mark = (): number => tb.pos.length / 3;

  // ---- Torso ----
  const waist = 1.06 * ys;
  const hipY = 0.9 * ys;
  const T = smooth(S.torso).map(([y, a, b, z]): Row => [y * ys, a * xs, b * xs, z * xs]);
  // (A schoolgirl's bust is less: the bulges on the front of the chest.)
  const bust = (b: Bulge): number => (isTeen(body, outfit) && body === 'woman' && b.c[1] > 1.15 && b.c[2] > 0 ? TEEN_BUST : 1);
  const field: Bulge[] = S.field.map((b) => ({ round: b.round, up: b.up === undefined ? undefined : b.up * ys, c: [b.c[0] * xs, b.c[1] * ys, b.c[2] * xs], r: [b.r[0] * xs, b.r[1] * ys, b.r[2] * xs], push: [b.push[0] * xs * bust(b), b.push[1] * ys * bust(b), b.push[2] * xs * bust(b)] }));
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
  const hem = woman ? 1.02 : outfit === 'office' ? 0.99 : 0.855;
  const untucked = !woman && (outfit === 'school' || (TROUSERED.includes(outfit) && outfit !== 'police' && outfit !== 'doctor'));
  // A kimono's or a yukata's cloth: a yukata pale cotton, a woman's kimono violet, a man's navy.
  const robe = outfit === 'yukata' ? WHITES - 0.25 : woman ? VIOLET : NAVY - 0.15;
  const whiteTop = outfit === 'office' || outfit === 'nurse' || outfit === 'gym' || (outfit === 'school' && body !== 'child');
  const topShade =
    whiteTop ? WHITES
    : outfit === 'track' ? TRACK
    : outfit === 'gown' ? GOWN
    : outfit === 'dress' ? SKY
    : outfit === 'kimono' || outfit === 'yukata' ? robe
    : outfit === 'suit' ? SUIT
    // (A maid's dress is dark navy; a police uniform is coloured whole at the end.)
    : outfit === 'maid' ? NAVY - 0.45
    : outfit === 'police' ? TOP
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
    : CLOTH_BOTTOM;
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
    if (S.angles) {
      loftAt(tb, T, S.angles, hips, topShade, 2.4);
      displace(tb, t0, field);
    } else over(T, hips, topShade, S.seg, 2.4);
    if (trousers) for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys < hem + 0.01) tb.shade[i] = bottomShade;
    // An evening dress is off the shoulders: skin above the bust.
    if (outfit === 'gown') for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys > 1.34) tb.shade[i] = SKIN;
  }

  // ---- Neck and head ----
  const neckY = 1.5 * ys;
  const teen = isTeen(body, outfit);
  const hk = P.head * HEAD_K[body] * headScale * (teen ? TEEN_HEAD : 1);
  const nk = P.arm * 0.9;
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
  const hatted = hair === 'hat' || hair === 'cap' || outfit === 'work' || outfit === 'police' || outfit === 'apron';
  // (No long-haired child: one asked for gets the ordinary haircut.)
  const girl = body === 'child' && (hair === 'bun' || hair === 'bob' || hair === 'ponytail' || hair === 'twin');
  const feminine = woman || girl;
  let style: HairStyle | null = null;
  if (hair !== 'none') {
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
   * a lip at the edge closes it onto the skin. `top` cuts it short under a hat.
   */
  const shell = (st: HairStyle, top: number | null): void => {
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
        const lo = table(st.line, a) + lock;
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
    shell(style, hatted ? UNDER_HAT : null);
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
  if (feminine && style) {
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
  if (hair === 'hat') tb.loft(headRows(feminine ? SUNHAT : FEDORA), () => 0, () => one(HEAD), feminine ? TAN + 0.35 : TAN - 0.6, 14);
  if (hair === 'cap') {
    // (A schoolchild's cap is yellow.)
    const capShade = body === 'child' && outfit === 'school' ? SASH : outfit === 'police' ? HAT : CLOTH_BOTTOM;
    tb.loft(headRows(CAP), () => 0, () => one(HEAD), capShade, 12, 2.1);
    tb.loft(headRows(VISOR), () => 0, () => one(HEAD), capShade, 8);
  }

  // ---- Legs and feet ----
  const L = legsOf(body, outfit, bottomShade);
  const footwear = footwearOf(body, outfit);
  const shoes: [number, number][] = [];
  const knee = 0.47 * ys;
  for (const [s, thigh, shin, foot] of [[-1, THIGH_L, SHIN_L, FOOT_L], [1, THIGH_R, SHIN_R, FOOT_R]] as const) {
    const rows = L.rows.map(([y, a, b, z]): Row => [y * ys, a * P.leg, b * P.leg, z * P.leg]);
    // A woman's legs run in from the hips to knees and ankles close together.
    const x = (r: Row): number => {
      if (!woman) return s * P.hipX * (0.86 + 0.14 * Math.min(1, r[0] / (0.92 * ys)));
      const k = clamp01((r[0] / ys - 0.45) / 0.45);
      return s * (0.052 + 0.036 * k * k * (3 - 2 * k));
    };
    const l0 = mark();
    const bound = (r: Row): Weight => (r[0] > 0.88 * ys ? blend(thigh, PELVIS, 0.6) : blend(thigh, shin, clamp01((r[0] - (knee - 0.06 * ys)) / (0.1 * ys))));
    tb.loft(rows, x, bound, L.shade, 8);
    // (The buttocks run on into the thighs.)
    displace(tb, l0, field);
    const fx = woman ? s * 0.052 : s * P.hipX * 0.88;
    const s0 = mark();
    const grown = (g: number, lo: number, hi: number): Row[] => rows.filter((r) => r[0] >= lo * ys && r[0] <= hi * ys).map(([y, a, b, z]): Row => [y, a + g, b + g, z]);
    if (outfit === 'shorts' || outfit === 'gym') {
      // Shorts over the thighs: to just above the knee, a woman's short. Gym clothes: a girl's bloomers (to the top
      // of the thigh), a boy's short shorts, in the school's red.
      const gym = outfit === 'gym';
      const cut = (gym ? (woman ? 0.8 : 0.64) : woman ? 0.74 : 0.5) * ys;
      const [w, d, z0] = rowAt(rows, cut);
      const s1 = mark();
      // (A man's and a child's run up only to under the shirt's hem, a little slimmer there, so they don't come through it.)
      tb.loft([[cut, w + 0.011, d + 0.011, z0], ...(woman ? grown(0.009, cut / ys + 0.012, 2) : grown(0.005, cut / ys + 0.012, 0.87))], x, bound, bottomShade, 8);
      displace(tb, s1, field);
      // (White socks with them.)
      if (gym) tb.loft(grown(0.004, 0, 0.2), x, bound, WHITES, 8);
    }
    // Knee boots with a short skirt; a stripe down the outside of a track suit's leg.
    if (outfit === 'mini') tb.loft(grown(0.005, 0, 0.43), x, bound, SHOE, 8);
    if (outfit === 'track') tb.loft(grown(0.004, 0.09, 0.88), x, bound, LENS, 2, 2, 'y', s < 0 ? [Math.PI - 0.3, Math.PI + 0.3] : [-0.3, 0.3]);
    // A schoolgirl's knee socks.
    if (woman && outfit === 'school') tb.loft(rows.filter((r) => r[0] <= 0.43 * ys).map(([y, a, b, z]): Row => [y, a + 0.003, b + 0.003, z]), x, bound, NAVY - 0.1, 8);
    // (kz along the foot, kw across and up: a woman's boots and sandals are smaller than a man's.)
    const shoe = (R: readonly Row[], kz: number, kw: number, shade: number): void =>
      tb.loft(R.map(([z, a, h, y]): Row => [z * P.leg * kz, a * P.leg * kw, h * P.leg * kw, y * P.leg * kw]), () => fx, () => one(foot), shade, 8, 2.8, 'z');
    // (A nurse's white shoes.)
    const shoeShade = outfit === 'nurse' || outfit === 'gym' ? WHITES : SHOE;
    if (footwear === 'pump') {
      shoe(PUMP_ROWS, 1, 1, SHOE);
      tb.loft(HEEL.map(([y, a, b, z]): Row => [y * P.leg, a, b, z * P.leg]), () => fx, () => one(foot), SHOE, 5);
    } else if (footwear === 'flat') shoe(FLAT_ROWS, 1, 1, shoeShade);
    else if (footwear === 'boot') shoe(BOOT_ROWS, woman ? 0.76 : 1, woman ? 0.8 : 1, SHOE);
    else if (footwear === 'sandal') {
      const k = woman ? 1 : 1.22;
      shoe(SOLE_ROWS, k, k, SHOE);
      shoe(BARE_ROWS, k, k, outfit === 'kimono' ? WHITE : SKIN);
    } else shoe(SHOE_ROWS, 1, 1, shoeShade);
    shoes.push([s0, mark()]);
  }

  // ---- Arms and hands ----
  // (A woman's arms hang a little inside the joints: narrower shoulders.)
  const armIn = woman ? 0.014 : 0;
  const ax = (y: number): number =>
    (y >= 1.42 ? P.shoulderX * 0.97 : y >= 1.13 ? P.elbowX + ((y - 1.13) / 0.29) * (P.shoulderX - P.elbowX) : P.wristX + ((y - 0.865) / 0.265) * (P.elbowX - P.wristX)) - armIn;
  const armShade = BARE_ARMS.includes(outfit) ? SKIN : outfit === 'doctor' ? WHITES : outfit === 'long' && !woman ? TAN : topShade;
  for (const [s, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) {
    const ak = P.arm * (woman ? 0.88 : 1);
    const rows = ARM.map(([y, a, b, z]): Row => [y * ys, a * ak, b * ak, z * ak]);
    tb.loft(rows, (r) => s * ax(r[0] / ys), (r) => (r[0] > 1.4 * ys ? blend(arm, SPINE, 0.6) : blend(arm, fore, clamp01((r[0] - 1.08 * ys) / (0.1 * ys)))), armShade, 6);
    // The hand: curling in a little toward the thigh, the thumb's base standing out at the front. A man's is longer.
    const hl = woman || body === 'child' ? 1 : 1.14;
    const curl = (y: number): number => 0.012 * Math.pow(clamp01((0.868 - y / ys) / (0.14 * hl)), 2);
    const h0 = mark();
    tb.loft(HAND.map(([y, a, b, z]): Row => [(0.868 - (0.868 - y) * hl) * ys, a * P.arm, b * P.arm, z]), (r) => s * (P.wristX + 0.003 - armIn - curl(r[0])), () => one(fore), SKIN, 6);
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
  /** A stand collar round the neck. */
  const collar = (shade: number): void => tb.loft([[1.45 * ys, 0.088 * gs, 0.07 * gs, -0.008], [1.515 * ys, 0.068 * gs, 0.064 * gs, -0.014]], () => 0, () => one(SPINE), shade, 10, 2.4);

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
    // The glasses: a frame across the brow, a pale lens under it before each eye, the arms back to the ears.
    // (A little further out in front of a fringe, so the hair doesn't cross the lenses.)
    const gz = feminine ? 0.009 : 0;
    const onFace = (rows: readonly Row[], x: number, shade: number, seg: number, n: number): void =>
      tb.loft(rows.map(([z, a, h, y]): Row => [(z > 0.05 ? z + gz : z) * hk, a * hk, h * hk, neckY + y * hk]), () => x * hk, () => one(HEAD), shade, seg, n, 'z');
    onFace([[0.093, 0.076, 0.0045, 0.112], [0.103, 0.076, 0.0045, 0.112], [0.1035, 0, 0, 0.112]], 0, 0.4, 8, 6);
    // (Each lens's front closes to a point: a ring left open there shows as a dot in its middle.)
    for (const sd of [-1, 1]) {
      onFace([[0.094, 0.03, 0.019, 0.091], [0.102, 0.031, 0.02, 0.091], [0.1026, 0, 0, 0.091]], sd * 0.04, LENS, 10, 3.2);
      onFace([[-0.012, 0.003, 0.0045, 0.104], [0.1, 0.003, 0.0045, 0.11]], sd * 0.079, 0.4, 4, 6);
    }
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
  } else if (outfit === 'hoodie') {
    // A loose body over the hips, the hood down behind the neck, the pocket on the front.
    over([wrap(0.868, 0.004), ...[0.875, 1.0, 1.1, 1.2, 1.3, 1.38, 1.43].map((y) => wrap(y, 0.016))], hips, topShade, S.seg, 2.4);
    const [, hd, hz] = torsoAt(1.42 * ys);
    const back = hz - hd;
    tb.loft([[1.32 * ys, 0.004, 0.004, back - 0.01], [1.335 * ys, 0.075 * gs, 0.026, back - 0.014], [1.39 * ys, 0.118 * gs, 0.046, back - 0.03], [1.455 * ys, 0.112 * gs, 0.05, back - 0.028], [1.5 * ys, 0.07 * gs, 0.034, back - 0.006], [1.51 * ys, 0.004, 0.004, back]], () => 0, () => one(SPINE), topShade - 0.05, 8, 2.4);
    panel(0.96, 1.1, () => 0.078, 1, topShade - 0.08, 0.018);
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
  }
  if (outfit === 'police') {
    // The uniform in police blue, cap to trouser hems: everything but the skin, the hair and the shoes.
    const dark = (i: number): boolean => (i >= hairFrom && i < hairTo) || shoes.some(([a, b]) => i >= a && i < b);
    for (let i = 0; i < tb.shade.length; i++) if (tb.shade[i] < 100 && !dark(i)) tb.shade[i] += POLICE;
  }
  if (isTeen(body, outfit)) {
    // Scaled down whole, the joints with it.
    const [kx, ky] = TEEN_SCALE[body];
    for (let i = 0; i < tb.pos.length; i += 3) {
      tb.pos[i] *= kx;
      tb.pos[i + 1] *= ky;
      tb.pos[i + 2] *= kx;
    }
    return tb.build(pivot.map((v): V3 => [v[0] * kx, v[1] * ky, v[2] * kx]), armOut);
  }
  return tb.build(pivot, armOut);
}
