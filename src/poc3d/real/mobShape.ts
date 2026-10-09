import type { Outfit } from '../district/peopleMix';
import { FACE_CHEEK, FACE_EYE, FACE_MARK } from './emoteGlsl';
import { ALL_BONES, ARM_L, ARM_R, armSwing, blend, BONES, clavicle, digitBone, fingerTip, handBone, hipHalf, shoulderHalf, spineBone, toeBone, toeDigit, FOOT_L, FOOT_R, FORE_L, FORE_R, HEAD, one, PELVIS, pivotsOf, PROPORTIONS, SHIN_L, SHIN_R, SPINE, TemplateBuilder, THIGH_L, THIGH_R, type Body, type Hair, type Row, type Template, type V3, type Weight } from './mobRig';
import { bareDetail } from './mobBare';
import '@bare';
import { type Bulge, clamp01, displace, loftAt, openingOf, rayEllipse, rowAt, smooth, smoothMax, softenNormals, stitchRings, table, tube, weld, zip } from './mobMesh';

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
export const SKIN = 101;
const TOP = 1;
const BOTTOM = 0.78;
// (Hair and shoes are tagged too, 19 and 20: the material colours them, black hair, an elder's grey, dark shoes.)
const SHOE = 2001;
export const HAIR = 1901;
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
 * A figure's own proportions, where it isn't the body's usual ones: a named character's (real/mobCharacters.ts).
 * Set before a template is built (real/people.ts keeps one per variant); null, as the crowd is built.
 */
export interface FigureShape {
  /** Its height against the body's own (the whole figure scaled, joints and all). */
  readonly height?: number;
  /** A woman's bust against the usual. */
  readonly bust?: number;
  /** A woman's hips against the usual: their width, and the tops of the thighs with them. */
  readonly hips?: number;
  /**
   * The detailed body a named character has, where the crowd's is simple: arms with an arm's own form that run
   * into the shoulders without a crease, hands with fingers and a thumb in one piece with the arm, bare feet with
   * toes, a curved back, and (with nothing on) the furrow down the spine.
   */
  readonly detail?: boolean;
}
let figure: FigureShape | null = null;
export function setFigureShape(f: FigureShape | null): void {
  figure = f && Object.keys(f).length ? f : null;
}
/** What the templates built now differ by from the crowd's (part of their cache's key). */
export const shapedVariant = (): string => (figure ? JSON.stringify(figure) : '');

/** Every ten degrees across the front, a few round the back. */
const CHEST_ANGLES: readonly number[] = [...Array.from({ length: 16 }, (_, i) => ((15 + i * 10) * Math.PI) / 180), ...Array.from({ length: 7 }, (_, i) => ((191.25 + i * 26.25) * Math.PI) / 180)];
/**
 * Round a woman's hips, below the waist: a point on the middle in front and behind (where the legs part), close
 * together either side of the middle behind (the buttocks and the cleft between them), fewer round the sides.
 */
// (60 and 120: where the front of each thigh is. Without a point there the lowest rings cut straight across from
// 50 to 70, 8 mm inside the thigh's front, a dent across it seen from the side.)
const HIP_DEGREES = [0, 25, 50, 60, 70, 81, 90, 99, 110, 120, 130, 155, 180, 198, 218, 236, 250, 260, 266, 270, 274, 280, 290, 304, 322, 342];
const HIP_ANGLES: readonly number[] = HIP_DEGREES.map((d) => (d * Math.PI) / 180);
const HIP_FRONT = HIP_DEGREES.indexOf(90), HIP_BACK = HIP_DEGREES.indexOf(270);
/**
 * The same with nothing on: more points close either side of the middle in front (and BARE_HIP_ROWS: more rings
 * low down, by how far above where the legs part), so the front of the hips can have form there.
 */
const BARE_HIP_DEGREES = [0, 12, 25, 38, 50, 60, 70, 81, 84, 86, 87, 88, 88.5, 89, 89.3, 89.65, 90, 90.35, 90.7, 91, 91.5, 92, 93, 94, 96, 99, 110, 120, 130, 142, 155, 168, 180, 189, 198, 208, 218, 227, 236, 243, 250, 260, 266, 270, 274, 280, 290, 297, 304, 313, 322, 332, 342, 351];
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
 * With nothing on: there is no such line (the skin between the legs is built of its own points: BARE_UNDER); the
 * space between the thighs is wider (so the form there has room); the leg has closer sections at its top, and the buttock a longer lower slope, so the
 * buttock rolls into the thigh rather than ending in a step.
 */
const BARE_THIGH_GAP = 0.036, BARE_CHEEK_LOW = 0.17;
/** (And it ends further back, nearer the buttocks' own backs: the cleft comes down into a shallow hollow, not a pit.) */
const BARE_PART_BACK = 0.06;
/** (And what joins the thighs in front is narrower: the creases where each thigh meets the belly run in to where the legs part, a Y, where trousers have a smooth front.) */
const BARE_HALF_FRONT = 0.042;
const BARE_LEG_ROWS: readonly number[] = [-0.0125, -0.0375];
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
      // (2 cm higher on her than it first was: the user's pick, tried on the bare body first: BUST_LOOKS.)
      { c: [0.066, 1.2595, 0.112], r: [0.07, 0.062, 0.1], up: 0.125, push: [0.007, -0.006, 0.058], round: 1.15 },
      { c: [0, 1.2915, 0.115], r: [0.055, 0.07, 0.08], up: 0.09, push: [0, 0, 0.012] },
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
 * The form between her legs, in front, as the body's own shape (the user, 2026-10-06: 'this is what I want', of
 * giving the hips finer points there; then, of two tries: the first, on the hips' front alone, was 'too far up and
 * a little too subtle', not in the silhouette; the second, two forms of their own hung under the body, 'too far
 * back', 'too long/pronounced' and 'separated'; 'in between the old and new is where it should be', and shaped
 * from the body as the first was). So: low on the hips' front, a soft fullness either side of the middle with the
 * middle drawn in (BARE_FRONT, on the lowest rings), carried on down and under by the skin between the legs
 * (BARE_UNDER), which hangs a little either side of the middle just behind the front and is level again by the
 * legs' middle: from the front, two low rounded shapes with a notch between at the top of the space between the
 * thighs. Nothing more than that.
 */
const BARE_FRONT: readonly Bulge[] = [
  { c: [0.008, 0.832, 0.075], r: [0.0125, 0.017, 0.07], push: [0, 0, 0.008], round: 1 },
  { c: [0, 0.83, 0.075], r: [0.004, 0.017, 0.07], push: [0, 0, -0.008], round: 1 },
];
/**
 * The skin under her, between the legs: rows from the hips' lowest ring in front (its own points close to the
 * middle, shared) back to the legs' shared point on the middle behind, each `rows` of the way, sagging `sag` at
 * its middle. Either side of the middle it hangs as a round form (the user, of a longer and thinner try: 'two round
 * plumps', with a line drawn under them: two U's side by side across the space between the thighs): a round arc
 * across, `wide` from the middle out (m; a little short of the thigh, so it turns up again before it), `depth` deep, the middle between the two up at `notch` of that; from the front back over the first `to` of
 * the way, deepest midway (short front to back: about as long as it is wide and deep, not a ridge).
 */
const BARE_UNDER = { rows: [0.04, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.4, 0.55, 0.75], sag: 0.0035, depth: 0.016, notch: 0.45, to: 0.34, wide: 0.0165 } as const;
// (Deeper, and running on down to where the legs part, at the user's word: 'a deeper butt crack in general', and
// more of one low down. Narrow ones, the cheeks touching, were tried and turned down.)
export const BARE_CLEFT: Bulge = { c: [0, 0.88, -0.11], r: [0.027, 0.115, 0.075], push: [0, 0, 0.025], round: 1.25 };
/** How far up into the body the point is where the cleft meets the legs' parting behind (m): a notch there, seen from behind. */
const BARE_CLEFT_UP = 0.011;
const BARE_BREAST: Bulge = {
  // (Each a mound of its own, round across with steep sides (`side`), its inner edge just short of the middle: seen
  // from above the chest goes back in between the two, an upturned V, as the user drew it twice. Joined across the
  // middle in a crease they made one shelf from above.)
  // (At the clothed bust's height: 2 cm higher on her than both first were, the user's pick of BUST_LOOKS.)
  c: [0.07, 1.2575, 0.112],
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
  // (Its lower half's profile is the first of UNDER_LOOKS, given where the figure is built; this is the same one.)
  lower: [[0, 1, 0], [0.15, 0.99, 0.002], [0.3, 0.94, 0.005], [0.45, 0.85, 0.007], [0.6, 0.7, 0.006], [0.72, 0.55, 0.003], [0.83, 0.38, 0], [0.92, 0.2, -0.007], [0.97, 0.08, -0.014], [1, 0, -0.022]],
};
/**
 * Round her chest with nothing on: a point every five degrees across the front (the middle one on the middle), so
 * each breast's inner side and its underside have the skin to turn with; the back as CHEST_ANGLES.
 */
const BARE_ANGLES: readonly number[] = [...Array.from({ length: 31 }, (_, i) => ((15 + i * 5) * Math.PI) / 180), ...CHEST_ANGLES.slice(16)];
/** Sections through her chest for it, by how far below the breast's centre toward its lower edge (and a little past both). */
/**
 * How full the underside of a bare woman's breast is where it comes back to the chest, to choose between (the
 * user, with a line drawn from its lowest point round and up the chest: 'more fatness underneath so that it
 * touches', the bottom resting against her body 'instead of floating in the air', and the breast itself not moved).
 * As it was, the underside ran straight from its lowest point up to a fold 2 cm higher on the chest, a wedge of air
 * under it; fuller, it stays low as it comes back, lying along the chest, and turns up into the fold only at the
 * chest itself, the fold lower. Each is BARE_BREAST's `lower` profile. The first is the city's (the user's pick of
 * them: 'perfect'); the mob showroom shows them side by side (ShapedTrial.under).
 */
type Lower = NonNullable<Bulge['lower']>;
const UNDER_HEAD: Lower = [[0, 1, 0], [0.15, 0.99, 0.002], [0.3, 0.94, 0.005], [0.45, 0.85, 0.007], [0.6, 0.7, 0.006]];
export const UNDER_LOOKS: readonly { readonly name: string; readonly lower: Lower }[] = [
  { name: 'full: rests on the chest, the fold low', lower: [...UNDER_HEAD, [0.72, 0.55, 0.003], [0.83, 0.38, 0], [0.92, 0.2, -0.007], [0.97, 0.08, -0.014], [1, 0, -0.022]] },
];
/**
 * How high a bare woman's breasts sit, to choose between (the user: could they be 'slightly higher'; several to
 * compare, the bare body first, the clothed bust to follow once a height is picked): how far above where they are
 * (m, on her). The first is the city's (the user picked 2 cm above where it was: BARE_BREAST has it, and the clothed
 * bust was then moved up the same); the mob showroom shows them side by side (ShapedTrial.bust).
 */
export const BUST_LOOKS: readonly { readonly name: string; readonly rise: number }[] = [
  { name: "as it is (the clothed bust's height)", rise: 0 },
];
const BREAST_ROWS: readonly number[] = [...Array.from({ length: 21 }, (_, i) => i * 0.05), 1.04, 1.1, 1.18, 1.28, 1.4, 1.52, 1.62];
/**
 * Her navel (the user: 'color in some more detail on the rest of her body such as a navel'; a round mark 'looks
 * really bad', so 'how anime does it', with two stills to go by): one short stroke down the middle of the belly, a
 * little curved, fine at both ends, in her skin darkened. Its height (the man's); the stroke as [how far above
 * that, how far round the belly from the middle (radians), its half width (m)]; how far off the skin; its shade.
 */
const NAVEL = { y: 1.03, stroke: [[0.011, 0.006, 0.0003], [0.005, -0.006, 0.0013], [-0.002, -0.009, 0.0012], [-0.009, 0.002, 0.0003]], off: 0.0012, shade: SKIN - 0.45 } as const;
/**
 * How far the form between her legs hangs down, to choose between (the user: round enough now, but 'still too
 * long', about twice what it should be, meaning 'from top to bottom how long it hangs down'; several to pick from):
 * `depth`, how deep the two round forms hang (m; BARE_UNDER's); `tall`, how far up the hips' front the form runs
 * against BARE_FRONT's own height (0: nothing on the front); `to`, how far back under her the forms run. The
 * first is the city's (the user's pick, 2026-10-06: 'perfect'; the height on the front had been one of the main
 * things wrong); the mob showroom shows them side by side (ShapedTrial.front).
 */
export const FRONT_LOOKS: readonly { readonly name: string; readonly tall: number; readonly to: number; readonly depth: number }[] = [
  { name: 'hangs 0.8 cm, half as tall on the front', tall: 0.5, to: 0.34, depth: 0.008 },
];
/**
 * How the cleft behind is drawn, to choose between. The user's words: the first, one column of points darkened,
 * was liked but looked 'low quality' (a blurred line as wide as the points happened to be apart); soft shading in
 * its place was fine from angles but 'looks bad' straight on, a smudge with nothing in it. So: a fine line drawn
 * down the middle (`stroke`, its half width in m; a strip lying in the cleft, widest low down and tapering to
 * nothing at the top, `dark` darker than the skin) with shading either side of it (`shade` darker on the middle,
 * fading over `spread` degrees round from it; `column`: the first way's darkening of the middle column of points,
 * which the user asked to see mixed with the soft shading, and of the mixes picked the one that is mostly shading).
 * The first is the city's; the mob showroom shows them side by side (ShapedTrial.cleftLook).
 */
export const CLEFT_LOOKS: readonly { readonly name: string; readonly shade: number; readonly spread: number; readonly column?: number; readonly stroke: number; readonly dark: number }[] = [
  { name: 'the first line in soft shading, mostly shading', shade: 0.24, spread: 9, column: 0.08, stroke: 0, dark: 0 },
];
/** (How far off the skin the line lies, m; and up to what height, the man's, it runs.) */
const CLEFT_LINE = { off: 0.0006, top: 0.99 } as const;

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
/**
 * A character's detailed arm (FigureShape.detail), wrist to shoulder, in the crowd's ARM's units: a slim wrist,
 * flatter than it is deep (the hand hangs palm to the thigh), the forearm's belly below the elbow, the elbow a
 * little drawn in with its point behind, the upper arm, and the shoulder's cap, which leans in over the top of the
 * chest (ARM_LEAN) so the arm runs into the shoulder's slope, not up beside it.
 */
const ARM_FINE: readonly Row[] = [
  [0.868, 0.024, 0.033, 0.001],
  [0.9, 0.029, 0.037, -0.001],
  [0.95, 0.034, 0.042, -0.004],
  [1.0, 0.039, 0.046, -0.008],
  [1.06, 0.042, 0.048, -0.014],
  [1.1, 0.04, 0.046, -0.019],
  [1.13, 0.037, 0.044, -0.023],
  [1.17, 0.039, 0.045, -0.02],
  [1.24, 0.044, 0.05, -0.016],
  [1.3, 0.05, 0.054, -0.013],
  [1.35, 0.054, 0.058, -0.011],
  [1.39, 0.058, 0.062, -0.01],
  [1.42, 0.055, 0.058, -0.01],
  [1.44, 0.044, 0.05, -0.01],
  [1.452, 0.022, 0.03, -0.01],
  [1.457, 0.004, 0.004, -0.01],
];
const ARM_LEAN = 0.034;
/** Its palm, knuckles to the heel of the hand, in one piece with the arm: [y, half thickness, half width, z]. */
const PALM: readonly Row[] = [
  [0.754, 0.002, 0.002, 0.004],
  [0.757, 0.008, 0.037, 0.004],
  [0.767, 0.012, 0.041, 0.004],
  [0.792, 0.014, 0.041, 0.006],
  [0.822, 0.0155, 0.038, 0.008],
  [0.85, 0.015, 0.03, 0.004],
];
/** Its fingers, index to little: [where across the palm (-1 back to 1 front), length, radius, how much more it curls (degrees)]. */
const FINGERS: readonly (readonly [number, number, number, number])[] = [[0.72, 0.07, 0.0088, 0], [0.26, 0.078, 0.0092, 3], [-0.22, 0.072, 0.0088, 7], [-0.68, 0.057, 0.0078, 12]];
/** A bare foot, heel to the root of the toes: [z, half width, half height, y] (standing on the floor), and its toes, big to little: [how far across from the middle toward the outside, how far forward its tip is (z), its half width]. */
const FOOT_FINE: readonly Row[] = [
  [-0.052, 0.002, 0.002, 0.03],
  [-0.046, 0.022, 0.024, 0.03],
  [-0.03, 0.028, 0.034, 0.037],
  [-0.005, 0.03, 0.04, 0.043],
  [0.03, 0.033, 0.03, 0.033],
  [0.06, 0.04, 0.022, 0.024],
  [0.082, 0.044, 0.016, 0.017],
  [0.096, 0.0435, 0.0125, 0.0135],
  [0.103, 0.037, 0.009, 0.011],
  [0.106, 0.002, 0.002, 0.01],
];
const TOES: readonly (readonly [number, number, number])[] = [[-0.0317, 0.128, 0.0115], [-0.0117, 0.127, 0.0085], [0.005, 0.123, 0.0082], [0.021, 0.118, 0.0078], [0.036, 0.112, 0.0072]];
/** Where the toes are rooted, inside the forefoot (z), and how flat they are (their height against their width). */
const TOE_ROOT = 0.086, TOE_FLAT = 0.8;
/** The knob of the ankle on the outside of each leg: where (x out from the foot's middle, y, z, by the foot's scale), and how far it stands out (m). */
const ANKLE_KNOB = { at: [0.025, 0.072, -0.014], r: [0.017, 0.017, 0.019], out: 0.0048 } as const;
/**
 * A character's back: the small of the back drawn in and the upper back a little out (a curve, where the crowd's
 * is nearly straight), and, with nothing on, the furrow down the spine.
 */
const BACK_CURVE: readonly Bulge[] = [
  // (A stronger arch, after the user's references, was tried and taken back: 'bring it back to what it was'.)
  { c: [0, 1.08, -0.08], r: [0.12, 0.13, 0.08], push: [0, 0, 0.012] },
  { c: [0, 1.33, -0.09], r: [0.13, 0.11, 0.08], push: [0, 0, -0.008] },
  // The shoulder blades, either side of the spine, built out (the user asked): each a flat plate lying on the ribs,
  // its inner edge a ridge down beside the spine, its lower corner a point, and its own spine a ridge up and out
  // toward the shoulder; the back hollow between the two.
  { c: [0.078, 1.335, -0.1], r: [0.055, 0.08, 0.07], push: [0.001, 0, -0.017], round: 1.2 },
  { c: [0.05, 1.33, -0.1], r: [0.02, 0.066, 0.07], push: [0, 0, -0.008], round: 1.2 },
  { c: [0.063, 1.272, -0.1], r: [0.03, 0.04, 0.07], push: [0, 0, -0.005], round: 1.5 },
  { c: [0.078, 1.386, -0.1], r: [0.032, 0.013, 0.07], push: [0, 0, -0.005], round: 1 },
  { c: [0.112, 1.402, -0.1], r: [0.03, 0.013, 0.07], push: [0, 0, -0.005], round: 1 },
  { c: [0, 1.34, -0.1], r: [0.032, 0.09, 0.07], push: [0, 0, 0.008], round: 1.2 },
];
/**
 * A character's chest, from under the bust to the shoulders (the user boxed it: 'thinner and rounded at the top
 * more', and nothing outside the box changed, the hips and lower torso being right): its width against the
 * crowd's by height, a little narrower up through the ribs and more at the shoulders, so the shoulders slope round
 * into the arms instead of standing square (the arms come in with it: ARM_IN_FINE).
 */
const CHEST_FINE: readonly (readonly [number, number])[] = [[1.13, 1], [1.2, 0.965], [1.29, 0.94], [1.36, 0.93], [1.41, 0.905], [1.44, 0.87], [1.468, 0.95], [1.492, 1]];
const ARM_IN_FINE = 0.013;
/**
 * The rib cage under her skin (the user asked for its definition): the edge of the ribs, a ridge each side from
 * under the breastbone down and out, with the hollow under the breastbone between, and the ribs' round at the side
 * of the chest. All above the waist's narrowest.
 */
const RIB_CAGE: readonly Bulge[] = [
  { c: [0, 1.135, 0.085], r: [0.026, 0.03, 0.05], push: [0, 0, -0.0045], round: 1.2 },
  { c: [0.04, 1.145, 0.085], r: [0.026, 0.016, 0.05], push: [0, 0, 0.0035], round: 1 },
  { c: [0.075, 1.128, 0.07], r: [0.028, 0.017, 0.06], push: [0.001, 0, 0.0035], round: 1 },
  { c: [0.112, 1.2, 0.01], r: [0.03, 0.07, 0.07], push: [0.0035, 0, 0], round: 1.4 },
];
/** Her collar bones (a ridge each side from the hollow at the base of the throat out to the shoulder) and that hollow. */
const COLLAR_BONES: readonly Bulge[] = [
  { c: [0.09, 1.436, 0.055], r: [0.09, 0.021, 0.058], push: [0, 0.0015, 0.013], round: 1 },
  { c: [0, 1.445, 0.07], r: [0.02, 0.024, 0.05], push: [0, 0, -0.011], round: 1.2 },
  // The trapezius, rounding from beside the neck down and out over the top of the shoulder to the arm (TRAPEZIUS
  // was tried as a line of its own and merged in here: one slope reads better than two bulges meeting).
  { c: [0.125, 1.415, 0.01], r: [0.055, 0.045, 0.065], push: [0.004, 0.006, 0.003], round: 1.4 },
  { c: [0.155, 1.395, -0.01], r: [0.04, 0.035, 0.06], push: [0.005, 0.003, 0.002], round: 1.3 },
];
/** How much longer a character's neck is than the crowd's, whose chin sits on the shoulders (the man's metres). */
const NECK_LONGER = 0.032;
/** The cords of her neck: from behind each ear down and in to the hollow of the throat. */
const NECK_CORDS: readonly Bulge[] = [
  { c: [0.021, 1.488, 0.04], r: [0.015, 0.036, 0.03], push: [0.0015, 0, 0.0055], round: 1 },
  { c: [0.04, 1.54, 0.014], r: [0.017, 0.04, 0.03], push: [0.004, 0, 0.003], round: 1 },
];
const SPINE_FURROW: Bulge = { c: [0, 1.2, -0.1], r: [0.02, 0.25, 0.09], push: [0, 0, 0.011], round: 1 };
/** Round her chest for it: as BARE_ANGLES in front, and points close together either side of the spine behind. */
const DETAIL_ANGLES: readonly number[] = [...Array.from({ length: 31 }, (_, i) => ((15 + i * 5) * Math.PI) / 180), ...[188, 197, 206, 214, 222, 229, 236, 242, 248, 253, 258, 262, 266, 270, 274, 278, 282, 287, 292, 298, 304, 311, 318, 326, 334, 343, 352].map((d) => (d * Math.PI) / 180)];
const NECK: readonly Row[] = [
  [1.455, 0.06, 0.056, -0.012],
  [1.5, 0.05, 0.05, -0.008],
  [1.545, 0.047, 0.048, -0.002],
  [1.585, 0.046, 0.046, 0.002],
];
/**
 * Where a character's thigh folds at the hip (the man's heights): the line's height in front (a little over the hip's
 * joint) and behind (the joint's, half-way up the buttock), from the middle of the thigh out; and how tall the band
 * is that the skin goes over in, in front (short: a crease) and behind (tall: the buttock is drawn with the thigh).
 */
const HIP_CREASE = [0.925, 0.9, 0.06, 0.17] as const;
/** A character's leg has sections close together down to the ankle (m), so it bends there as the foot's own skin over it does. */
const ANKLE_ROWS = [0.072, 0.086, 0.098, 0.125, 0.15, 0.185] as const;
/** A character's hand toward the rigged reference's: the palm's length from the wrist against how it was first built, and each finger's. */
const HAND_FIT = [0.82, 1.3] as const;
/** A character's bare arm between shoulder and wrist against how it was first built, toward the rigged reference's length. */
const ARM_FIT = 0.88;
/** A character's collar bone: how far out from the middle its inner end is, and how far over the shoulder's joint (the body's units). */
const COLLAR = [0.035, 0.012] as const;
/**
 * Whether a character's bare arms are welded to the chest (`weld`). Tried 2026-10-06 and left off: at rest it is one
 * clean surface, but the opening it cuts is ragged (it follows the two meshes' own faces), its points are at every
 * height from the armpit to the top of the shoulder, and the shoulder's skin goes over to the arm by height, so a
 * raised arm crumples the join behind and draws a web out of the armpit; spreading the pull over the chest's skin
 * tore it. What it wants before it is turned on: the opening cut along a smooth ring (the arm's own ring at the
 * armpit, the chest opened to match it), and the shoulder's weights laid as one smooth field over arm and chest.
 * Without it the arm still moves as one with the shoulder (SHOULDER_BEND).
 */
const WELD_ARMS: boolean = false;
/** Whether a character's four fingers are made one surface with the palm (buildShaped; the thumb is not: it is on the palm's side). */
const WELD_FINGERS: boolean = true;
/** How many rings a character's finger is built of, and how many points round each ring (buildShaped's `finger`; FINGER_SEG was 8: an octagon, which showed as flats down a finger's length and round a bent knuckle). One more point at the tip. */
const FINGER_RINGS = 12, FINGER_SEG = 10;
/** How far round the thumb's root its join to the palm is looked for (the body's units). */
const THUMB_WELD = 0.05;
/**
 * A character's bare arms welded to the chest along a smooth seam (buildShaped, `seams`): the seam's plane, upright
 * and running front to back, goes through the arm's innermost point this far under the shoulder's joint (the armpit)
 * and through the top of the arm. WELD_SEAM: that depth; how far behind the plane the chest is still opened; how much
 * bigger than the arm's edge the chest's opening is; and the weights down the arm from the seam (which itself stays
 * with the chest, so the faces that join the two never move): all the arm's this far down under the armpit, and this
 * far down over the top of the shoulder; how near the opening the chest's own skin goes with the seam (the body's
 * units); and how much of the arm's turning the seam takes under the armpit (none at the top of the shoulder).
 */
const WELD_RING: boolean = true;
const WELD_SEAM = [0.085, 0.045, 1.0, 0.04, 0.125, 0.06, 0] as const;
/** How far under the shoulder's joint a character's arm is made one surface with the chest (the body's units): to about the armpit. */
const WELD_SHOULDER = 0.1;
/** A character's shoulder: how far over the joint the arm's skin is all the chest's, and how far under it all the arm's (the body's units); and how far from the join the chest's own skin goes with it. */
const SHOULDER_BEND = [0.03, 0.085, 0.07] as const;
/** How far down the leg a character's hips run on over it, from where the legs part (the body's units): SEAT_SKIRT. */
const SEAT_SKIRT = 0.04;
/**
 * A character's ankle: how far under the joint the skin is all the foot's and how far over it all the shin's (the
 * body's units), and how far forward of the joint that holds, and the way it eases back to the foot's own (m).
 */
const ANKLE_BEND = [0.045, 0.065, 0.035, 0.04] as const;
/**
 * A character's further spine joints (mobRig.ts spineBone): the lower chest's height (the bottom of the ribs) and the
 * upper chest's (over the bust, under the shoulders), in the body's units; the head's above the neck's joint, in the
 * head's; and half the height each is eased across.
 */
const SPINE_JOINTS = [1.19, 1.335, 0.06, 0.035] as const;
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
  // (The uncensored edition's detail on a bare woman: src/poc3d/real/mobBare.ts.)
  const bareHooks = bareDetail();
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
  /** (A character's chest and arms as runs of points, to be made one surface: `weld`.) */
  let chestRun: [number, number] | null = null;
  const armRuns: [number, number, number][] = [];
  /** (Each finger's run of points: its side, its bone at the knuckle, where its points begin.) */
  const fingerRuns: [number, number, number][] = [];
  const mark = (): number => tb.pos.length / 3;

  // ---- Torso ----
  const waist = 1.06 * ys;
  const hipY = 0.9 * ys;
  // (A figure's own hips: wider or narrower below the waist, and the tops of the thighs with them.)
  const hipK = woman ? (figure?.hips ?? 1) : 1;
  const hipAt = (y: number): number => {
    const k = clamp01((1.07 - y) / 0.14);
    return 1 + (hipK - 1) * k * k * (3 - 2 * k);
  };
  // (A character's chest: CHEST_FINE, from under the bust up; nothing below it changes.)
  const fine = figure?.detail === true && woman;
  const chestAt = (y: number): number => (fine ? table(CHEST_FINE, y) : 1);
  const T = smooth(S.torso).map(([y, a, b, z]): Row => [y * ys, a * xs * hipAt(y) * chestAt(y), b * xs * (1 + (hipAt(y) - 1) * 0.5), z * xs]);
  // (A schoolgirl's bust is less: the bulges on the front of the chest.)
  const bust = (b: Bulge): number => (body === 'woman' && b.c[1] > 1.15 && b.c[2] > 0 ? (figure?.bust ?? 1) * (isTeen(body, outfit) ? TEEN_BUST : 1) : 1);
  // (A woman's bottom: in full, with its cleft, only in what's skin-tight or with nothing on; round, the two sides
  // run together, in everything else; a teen's always the plain seat.)
  const skirted = woman && SKIRTED.includes(outfit);
  const unclothed = outfit === 'nude' || outfit === 'nude_heels';
  const fitted = FORM_FITTING.includes(outfit);
  const cheeks = !woman || isTeen(body, outfit) ? 0 : fitted ? 1 : skirted ? ROUND_SEAT : (ROUND_SEAT);
  const cheek: Bulge[] = cheeks > 0 ? [{ ...CHEEK, r: woman && unclothed ? [CHEEK.r[0], BARE_CHEEK_LOW, CHEEK.r[2]] : CHEEK.r, push: [CHEEK.push[0] * cheeks, CHEEK.push[1] * cheeks, CHEEK.push[2] * cheeks] }] : [];
  // What's worn over the body takes `field`; the body itself `bodyField`, the same but for the cleft (never more).
  const cleft = fitted;
  // (Where her legs part, and where above it the hips start to draw in to them.)
  const crotch = CROTCH;
  const hipsPart = HIPS_PART;
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
  // A woman with nothing on: her breasts as they are without clothes (bareBreast, in place of the clothed bust and
  // the cloth across it), and the cleft behind runs deeper (BARE_CLEFT).
  const bareWoman = woman && unclothed;
  const frontLook = FRONT_LOOKS[0];
  const cleftLook = CLEFT_LOOKS[0];
  // (Her bare breast, at the height asked for: BUST_LOOKS.)
  const bustRise = BUST_LOOKS[0].rise / ys;
  const bareBreast: Bulge = { ...BARE_BREAST, c: [BARE_BREAST.c[0], BARE_BREAST.c[1] + bustRise, BARE_BREAST.c[2]], lower: UNDER_LOOKS[0].lower };
  const onChest = (b: Bulge): boolean => b.c[1] > 1.15 && b.c[2] > 0;
  const detail = figure?.detail === true;
  const shaped: readonly Bulge[] = detail && woman ? [...S.field, ...BACK_CURVE] : S.field;
  const bones: readonly Bulge[] = detail && woman ? [...COLLAR_BONES, ...RIB_CAGE] : [];
  const form: readonly Bulge[] = bareWoman ? [...shaped.filter((b) => !onChest(b)), bareBreast, ...bones] : [...shaped, ...bones];
  const field: Bulge[] = [...form, ...cheek].map(scaled);
  const bodyField: Bulge[] = cleft ? [...field.map((b, i): Bulge => (i >= form.length ? { ...b, cleft: true } : b)), ...(bareWoman ? [...(detail ? [scaled(SPINE_FURROW)] : []), scaled(BARE_CLEFT), ...(frontLook.tall > 0 ? BARE_FRONT.map((b): Bulge => scaled({ ...b, c: [b.c[0], b.c[1] - b.r[1] * (1 - frontLook.tall), b.c[2]], r: [b.r[0], b.r[1] * frontLook.tall, b.r[2]] })) : [])] : [])] : field;
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
  /**
   * The same on a woman's chest, all the way round, with its points where her chest's are (CHEST_ANGLES): evenly
   * spaced ones cut across between her breasts and over them differently from the body's, and it showed through.
   */
  const overChest = (rows: readonly Row[], weight: (r: Row) => Weight, shade: number): void => {
    const from = mark();
    loftAt(tb, rows, CHEST_ANGLES, weight, shade, 2.4);
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
    // dancer, in her heels. A mannequin's body, smooth; a woman's has her breasts' own shape (bareBreast) and her navel (NAVEL);
    // the uncensored edition adds more: mobBare.ts.)
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
    return ((fineHips ? BARE_THIGH_GAP : THIGH_GAP) / 2) * k * k * (3 - 2 * k);
  };
  const thighK = (y: number): number => 1 + (hipK - 1) * clamp01((y / ys - 0.45) / 0.4);
  const legRows0 = L.rows.map(([y, a, b, z]): Row => [y * ys, a * P.leg * limb - apart(y * ys) / 2, b * P.leg * limb, z * P.leg]);
  const legRows = hipK === 1 ? legRows0 : legRows0.map(([y, a, b, z]): Row => [y, a * thighK(y), b * (1 + (thighK(y) - 1) * 0.5), z]);
  const legX = (s: number, y: number): number => {
    if (!woman) return s * P.hipX * (0.86 + 0.14 * Math.min(1, y / (0.92 * ys)));
    // A woman's legs run in from the hips to knees and ankles close together.
    const k = clamp01((y / ys - 0.45) / 0.45);
    // (Wider thighs grow outward: the space between them stays.)
    return s * (0.052 + 0.036 * k * k * (3 - 2 * k) + apart(y) / 2 + (hipK === 1 ? 0 : rowAt(legRows0, y)[0] * (thighK(y) - 1)));
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
        const more = BREAST_ROWS.map((t) => (bareBreast.c[1] - t * bareBreast.r[1]) * ys).filter((y) => chestRows.every((r) => Math.abs(r[0] - y) > 0.0006));
        chestRows = [...chestRows, ...more.map((y): Row => [y, ...rowAt(T, y)])].sort((p, q) => p[0] - q[0]);
      }
      const chestAngles = bareWoman ? (detail ? DETAIL_ANGLES : BARE_ANGLES) : CHEST_ANGLES;
      loftAt(tb, chestRows, chestAngles, hips, topShade, 2.4);
      chestRun = [t0, mark()];
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
            const between = 1 / (uz > 0 ? Math.hypot(ux / (fineHips ? BARE_HALF_FRONT : PART_HALF_FRONT), uz / PART_FRONT) : Math.hypot(ux / PART_HALF_BACK, uz / (fineHips ? BARE_PART_BACK : PART_BACK)));
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
        bareHooks?.nipples({ tb, xs, ys, T, bodyField, bareBreast });
      }
      // The cleft's line, a little darker down the middle of the seat.
      if (cleft) {
        const shadow = hipAngles.map((a) => (cleftLook.spread > 0 ? Math.exp(-(((a - hipAngles[hipBack]) / ((cleftLook.spread * Math.PI) / 180)) ** 2)) : 0));
        HIP_ROWS.forEach((hy, k) => {
          const deep = clamp01((1.0 - hy) / 0.1);
          hipAngles.forEach((_, j) => {
            const dark = cleftLook.shade * shadow[j] + (j === hipBack ? (cleftLook.column ?? 0) : 0);
            if (dark > 0.004) tb.shade[hipRing + k * M + j] -= dark * deep * deep * (3 - 2 * deep);
          });
        });
      }
    } else {
      over(T, hips, topShade, S.seg, 2.4);
      if (trousers && !unclothed) for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys < hem + 0.01) tb.shade[i] = bottomShade;
    }
    // The waistband of a woman's trousers, where her top goes into them.
    if (woman && trousers && !unclothed && !skirted && outfit !== 'police' && outfit !== 'bosozoku') over([wrap(0.997, 0.001), wrap(1.0, 0.005), wrap(1.03, 0.005), wrap(1.033, 0.001)], hips, bottomShade - 0.12, 18, 2.4);
    // An evening dress is off the shoulders: skin above the bust.
    if (outfit === 'gown') for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys > 1.365) tb.shade[i] = SKIN;
    // A tattooed man's chest and shoulders are bare above his undershirt (its straps are lofted over them): inked,
    // as his arms are.
    if (outfit === 'irezumi') for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys > 1.24) tb.shade[i] = INK;
    // A biker's chest is bare over the cloth bound round the belly (a woman's bound over the bust).
    if (outfit === 'bosozoku') for (let i = t0; i < mark(); i++) if (tb.pos[i * 3 + 1] / ys > (woman ? 1.365 : 1.14)) tb.shade[i] = SKIN;
  }

  // ---- Neck and head ----
  // (A character's neck is longer, so it shows under the chin: the head, and its joint, that much higher.)
  if (detail) for (let b = BONES; b < ALL_BONES; b++) pivot[b] = [0, 0, 0];
  const neckUp = detail ? NECK_LONGER * ys : 0;
  const neckY = 1.5 * ys + neckUp;
  if (neckUp) pivot[HEAD] = [pivot[HEAD][0], pivot[HEAD][1] + neckUp, pivot[HEAD][2]];
  const teen = isTeen(body, outfit);
  const hk = P.head * HEAD_K[body] * headScale * (teen ? TEEN_HEAD : 1);
  const nk = P.arm * 0.9 * (heavy ? 1.2 : 1);
  const neck = NECK.map(([y, a, b, z]): Row => [y * ys + (y > 1.47 ? neckUp : 0), a * nk, b * nk, z * nk]);
  const n0 = mark();
  tb.loft(neck, () => 0, (_, i) => (i === 0 ? one(SPINE) : i === 1 ? blend(HEAD, SPINE, 0.4) : i === 2 ? blend(HEAD, SPINE, 0.8) : one(HEAD)), SKIN, detail ? 16 : 8);
  if (detail && woman) displace(tb, n0, NECK_CORDS.map(scaled));
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
    const extra = [...(legCut === null ? [] : [legCut - 0.005 * ys, legCut]), ...(fineHips ? BARE_LEG_ROWS.map((d) => y0 + d * ys) : []), ...(detail ? ANKLE_ROWS : []), y0].filter((y, i, all) => all.indexOf(y) === i && fine.every((r) => Math.abs(r[0] - y) > 0.002 * ys)).map(at);
    rows = [...fine, ...extra].sort((p, q) => p[0] - q[0]);
  }
  /** (The points where a woman's legs part, on the middle: the first leg's, which the second shares.) */
  let parting: number[] | null = null;
  /** (With fine hips: each leg's top ring, left then right.) */
  const legTops: number[] = [];
  let underBack = -1;
  for (const [s, thigh, shin, foot] of [[-1, THIGH_L, SHIN_L, FOOT_L], [1, THIGH_R, SHIN_R, FOOT_R]] as const) {
    const x = (r: Row): number => legX(s, r[0]);
    const l0 = mark();
    const i0 = tb.idx.length;
    /** (The leg's top ring and the hips' lowest it is joined to, as they were zipped.) */
    let joined: [number[], number[]] | null = null;
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
      // (Only the three innermost: with five, the inner quarters of the thigh's top, front and back, were one flat
      // face each from the thigh to the middle, which crumpled where the buttocks' cleft comes down into it.)
      const inner = s < 0 ? [1, 0, 11] : [5, 6, 7];
      const outer = s < 0 ? [2, 3, 4, 5, 6, 7, 8, 9, 10] : [4, 3, 2, 1, 0, 11, 10, 9, 8];
      const ring = hipAngles.length;
      if (fineHips) {
        // (With nothing on: the leg keeps its inner points, the crease where the thigh meets the skin between the
        // legs, which is built once both legs are: BARE_UNDER. Its outer ones join the hips' ring from the outermost
        // of the fine points in front round to the middle behind.)
        legTops.push(top);
        const from = hipSide;
        const half = s < 0 ? Array.from({ length: hipBack - hipFront - from + 1 }, (_, n) => hipFront + from + n) : Array.from({ length: ring - (hipBack - hipFront) - from + 1 }, (_, n) => (hipFront - from - n + ring) % ring);
        // (Its inner point in front goes under the ring's point it joins, the outermost of the fine ones, not 3 cm
        // behind it under a ledge; its inner point behind is on the middle, one point for both legs, as the others' is.)
        const r0 = (hipRing + half[0]) * 3, f = (top + inner[0]) * 3;
        tb.pos[f] = tb.pos[r0] * 0.95;
        tb.pos[f + 2] = tb.pos[r0 + 2] - 0.006;
        const b = top + inner[2];
        if (underBack < 0) {
          underBack = b;
          tb.pos.splice(b * 3, 3, 0, crotch * ys + BARE_CLEFT_UP, rows[rows.length - 1][3] - BARE_PART_BACK);
          tb.b0[b] = tb.b1[b] = PELVIS;
          tb.w[b] = 1;
          if (cleft) tb.shade[b] -= cleftLook.shade + (cleftLook.column ?? 0);
        } else {
          for (let q = i0; q < tb.idx.length; q++) if (tb.idx[q] === b) tb.idx[q] = underBack;
          tb.pos.splice(b * 3, 3, 0, crotch * ys + 0.05, 0);
        }
        zip(tb, [top + inner[0], ...outer.map((j) => top + j), underBack], half.map((j) => hipRing + j), false, s > 0);
        joined = [[top + inner[0], ...outer.map((j) => top + j), underBack], half.map((j) => hipRing + j)];
      } else {
        const y0 = crotch * ys, zc = rows[rows.length - 1][3];
        // (Its front end well behind the hips' smooth front, tucked in between the thighs: further forward it stood out
        // as a flap when a thigh was raised or the legs parted.)
        const line: V3[] = [[0, y0, zc + PART_TUCK], [0, y0 - 0.007, zc + 0.002], [0, y0, zc - PART_BACK]];
        if (!parting) {
          parting = inner.map((j) => top + j);
          parting.forEach((i, n) => {
            tb.pos.splice(i * 3, 3, ...line[n]);
            tb.b0[i] = tb.b1[i] = PELVIS;
            tb.w[i] = 1;
          });
          if (cleft) tb.shade[parting[2]] -= cleftLook.shade + (cleftLook.column ?? 0);
        } else {
          const same = new Map(inner.map((j, n) => [top + j, parting![n]]));
          for (let q = i0; q < tb.idx.length; q++) tb.idx[q] = same.get(tb.idx[q]) ?? tb.idx[q];
          // (Left behind, used by nothing: out of the way, inside the body.)
          for (const i of same.keys()) tb.pos.splice(i * 3, 3, 0, y0 + 0.05, 0);
        }
        const half = s < 0 ? Array.from({ length: hipBack - hipFront + 1 }, (_, n) => hipFront + n) : Array.from({ length: ring - (hipBack - hipFront) + 1 }, (_, n) => (hipFront - n + ring) % ring);
        zip(tb, [parting[0], ...outer.map((j) => top + j), parting[2]], half.map((j) => hipRing + j), false, s > 0);
        joined = [[parting[0], ...outer.map((j) => top + j), parting[2]], half.map((j) => hipRing + j)];
      }
    }
    // (The buttocks run on into the thighs.)
    displace(tb, l0, bodyField);
    if (detail && joined) {
      // A character's hips run on down over the top of the leg (SEAT_SKIRT). The hips' lowest ring has several points
      // to each of the leg's top ring's twelve, on the same outline: between the leg's points it stands a few
      // millimetres proud of the leg's flat sides, and a little above its top, so the two met in a ledge all round the
      // top of the thigh (the edge under the buttock, the dent across the front of the thigh, at rest). From each of
      // the ring's points a strip now goes down to the leg's own surface a few centimetres lower, where it lies flush:
      // the ledge is spread out over that height and can't be seen, and the old join is inside it.
      const Q = tb.pos;
      const ring = joined[1];
      const rowY = (k: number): number => Q[(l0 + k * LEG_SEG) * 3 + 1];
      // (The leg's section at a height: between its rings; the top ring's inner points have been moved, so from the next down.)
      const last = rows.length - 2;
      const section = (y: number): [number, number][] => {
        let k = last;
        while (k > 0 && rowY(k) > y) k--;
        const up = Math.min(k + 1, last);
        const f = up === k ? 0 : clamp01((y - rowY(k)) / (rowY(up) - rowY(k)));
        return Array.from({ length: LEG_SEG }, (_, j): [number, number] => {
          const a = (l0 + k * LEG_SEG + j) * 3, b = (l0 + up * LEG_SEG + j) * 3;
          return [Q[a] + (Q[b] - Q[a]) * f, Q[a + 2] + (Q[b + 2] - Q[a + 2]) * f];
        });
      };
      // (Not the ring's points nearest the body's middle: the forms between the legs are as they were built.)
      const part = ring.filter((v) => Math.abs(Q[v * 3]) > 0.05);
      const base = mark();
      let lx = 0, lz = 0;
      part.forEach((v, q) => {
        const u = part.length > 1 ? q / (part.length - 1) : 0.5;
        const y = Math.min(Q[v * 3 + 1] - SEAT_SKIRT * ys * (0.4 + 0.6 * clamp01(Math.min(u, 1 - u) / 0.2)), rowY(last));
        const pg = section(y);
        const cx = pg.reduce((sum, c) => sum + c[0], 0) / LEG_SEG, cz = pg.reduce((sum, c) => sum + c[1], 0) / LEG_SEG;
        [lx, lz] = [cx, cz];
        // Out from the leg's middle toward the ring's point, to the leg's side.
        const dx = Q[v * 3] - cx, dz = Q[v * 3 + 2] - cz;
        let hit: [number, number] = [Q[v * 3], Q[v * 3 + 2]];
        for (let j = 0; j < LEG_SEG; j++) {
          const [ax, az] = pg[j], [bx, bz] = pg[(j + 1) % LEG_SEG];
          const ex = bx - ax, ez = bz - az;
          const den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((ax - cx) * ez - (az - cz) * ex) / den, at = ((ax - cx) * dz - (az - cz) * dx) / den;
          if (t <= 0 || at < -1e-6 || at > 1 + 1e-6) continue;
          hit = [cx + dx * t, cz + dz * t];
          break;
        }
        tb.pos.push(hit[0], y, hit[1]);
        tb.b0.push(thigh);
        tb.b1.push(PELVIS);
        tb.w.push(1);
        tb.shade.push(tb.shade[v]);
      });
      for (let q = 0; q + 1 < part.length; q++) {
        const a = part[q], b = part[q + 1], c = base + q + 1, d = base + q;
        // (Facing out of the leg, whichever way round the ring is listed.)
        const ux = Q[b * 3] - Q[a * 3], uy = Q[b * 3 + 1] - Q[a * 3 + 1], uz = Q[b * 3 + 2] - Q[a * 3 + 2];
        const vx = Q[d * 3] - Q[a * 3], vy = Q[d * 3 + 1] - Q[a * 3 + 1], vz = Q[d * 3 + 2] - Q[a * 3 + 2];
        const out = (uy * vz - uz * vy) * (Q[a * 3] - lx) + (ux * vy - uy * vx) * (Q[a * 3 + 2] - lz);
        if (out > 0) tb.idx.push(a, b, c, a, c, d);
        else tb.idx.push(a, c, b, a, d, c);
      }
    }
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
      if (detail) {
        // A character's foot: its own form, and toes (the big toe on the inside).
        const fk = P.leg * k;
        tb.loft(FOOT_FINE.map(([z, a, h, y]): Row => [z * fk, a * fk, h * fk, y * fk]), () => fx, () => one(foot), SKIN, 12, 2.6, 'z');
        // The ankle: a collar from the top of the foot up onto the leg's own section, so the leg rises out of the foot
        // (it stood on it, a ring round the join).
        const collar = [0.03, 0.05, 0.068, 0.084, 0.1].map((y, n): Row => {
          const [la, lb, lz] = rowAt(rows, Math.max(y * fk, rows[1][0]));
          const k = [1, 0.62, 0.3, 0.08, 0][n];
          // (Its top is just inside the leg, so it comes out through the leg's skin at a shallow angle: no step.)
          const off = 0.001 * k - 0.0014 * (1 - k);
          return [y * fk, la + off + (0.031 * fk - la) * k, lb + off + (0.05 * fk - lb) * k, lz + (0.01 * fk - lz) * k];
        });
        tb.loft(collar, () => fx, (r) => blend(shin, foot, clamp01((r[0] / fk - 0.05) / 0.04)), SKIN, 12, 2);
        TOES.forEach(([across, len, r], toe) => {
          // (Side by side across the forefoot, each rooted inside it where the foot is taller than the toe, lying on
          // the floor with its top under the line of the foot's, and reaching a centimetre or two past the foot's
          // front: so the toes are the foot's own front, parted, not things stuck out of it. Two earlier builds had
          // them as thin stubs in a blunt forefoot, and then as rolls hung under it, taller than its front.)
          const x = fx + s * across * fk, yc = (r * TOE_FLAT + 0.0012) * fk, tip = len * fk;
          const path: V3[] = [[x, yc + 0.003 * fk, TOE_ROOT * fk], [x, yc, (TOE_ROOT + (len - TOE_ROOT) * 0.5) * fk], [x, yc, tip - r * 1.1 * fk], [x, yc - 0.0005, tip - r * 0.45 * fk]];
          // (Each toe on a bone of its own, at its root, on top of the one that turns them all at the ball of the foot.)
          const own = toeDigit(s < 0 ? 0 : 1, toe);
          pivot[own] = [x, yc, (TOE_ROOT + 0.006) * fk];
          tube(tb, path, [r * fk, r * fk, r * 0.97 * fk, r * 0.8 * fk], 8, [one(foot), one(own)], SKIN, TOE_FLAT);
        });
        // (The toes' joint: the ball of the foot.)
        pivot[toeBone(s < 0 ? 0 : 1)] = [fx, 0.012 * fk, 0.094 * fk];
        // (The ankle's knob, on the outside.)
        displace(tb, l0, [{ c: [Math.abs(fx) + ANKLE_KNOB.at[0] * fk, ANKLE_KNOB.at[1] * fk, ANKLE_KNOB.at[2] * fk], r: [ANKLE_KNOB.r[0], ANKLE_KNOB.r[1], ANKLE_KNOB.r[2]], push: [ANKLE_KNOB.out, 0, 0], round: 1.3 }]);
      } else shoe(BARE_ROWS.map(([z, a, h, y]): Row => [z, a, h, y - BARE_DROP]), k, k, SKIN);
    }
    else shoe(SHOE_ROWS, 1, 1, shoeShade);
    shoes.push([s0, mark()]);
  }
  const cleftFoot = fineHips ? underBack : (parting?.[2] ?? -1);
  if (cleft && cleftFoot >= 0) {
    // The cleft's line (CLEFT_LOOKS) and, with nothing on, what the uncensored edition adds (mobBare.ts): up the
    // middle of the seat from where the legs part behind.
    const P = tb.pos;
    const M = hipAngles.length;
    const idx = [cleftFoot, ...HIP_ROWS.map((hy, k) => (hy < CLEFT_LINE.top ? hipRing + k * M + hipBack : -1)).filter((i) => i >= 0)];
    const pts = idx.map((i): V3 => [0, P[i * 3 + 1], P[i * 3 + 2]]);
    // (The skin's own shade beside the cleft at each: a few points round from the middle, past its shading.)
    const base = idx.map((i, n) => tb.shade[n === 0 ? hipRing + hipBack + 5 : i + 5]);
    const dist = pts.map((q, n) => (n ? Math.hypot(q[1] - pts[n - 1][1], q[2] - pts[n - 1][2]) : 0));
    for (let n = 1; n < dist.length; n++) dist[n] += dist[n - 1];
    const total = dist[dist.length - 1];
    /** Out of the skin at a point of the path: square to it in the middle plane, backward and down. */
    const outAt = (n: number): [number, number] => {
      const a = pts[Math.max(0, n - 1)], b = pts[Math.min(pts.length - 1, n + 1)];
      let ty = b[1] - a[1], tz = b[2] - a[2];
      const l = Math.hypot(ty, tz) || 1;
      ty /= l;
      tz /= l;
      let ny = tz, nz = -ty;
      if (-0.5 * ny - nz < 0) {
        ny = -ny;
        nz = -nz;
      }
      return [ny, nz];
    };
    const put = (x: number, y: number, z: number, shade: number): number => {
      tb.pos.push(x, y, z);
      tb.b0.push(PELVIS);
      tb.b1.push(PELVIS);
      tb.w.push(1);
      tb.shade.push(shade);
      return mark() - 1;
    };
    /** A face turned to face out of the skin (n). */
    const face = (a: number, b: number, c: number, n: [number, number]): void => {
      const fy = (P[b * 3 + 2] - P[a * 3 + 2]) * (P[c * 3] - P[a * 3]) - (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]);
      const fz = (P[b * 3] - P[a * 3]) * (P[c * 3 + 1] - P[a * 3 + 1]) - (P[b * 3 + 1] - P[a * 3 + 1]) * (P[c * 3] - P[a * 3]);
      if (fy * n[0] + fz * n[1] >= 0) tb.idx.push(a, b, c);
      else tb.idx.push(a, c, b);
    };
    if (cleftLook.stroke > 0) {
      const strip = pts.map((q, n) => {
        const u = dist[n] / total;
        const half = Math.max(0.00012, cleftLook.stroke * Math.pow(1 - u, 0.55) * (0.55 + 0.45 * clamp01(u / 0.12)));
        const [ny, nz] = outAt(n);
        const shade = base[n] - cleftLook.dark * clamp01((1 - u) / 0.25);
        return [put(-half, q[1] + ny * CLEFT_LINE.off, q[2] + nz * CLEFT_LINE.off, shade), put(half, q[1] + ny * CLEFT_LINE.off, q[2] + nz * CLEFT_LINE.off, shade)];
      });
      for (let n = 0; n + 1 < strip.length; n++) {
        face(strip[n][0], strip[n][1], strip[n + 1][1], outAt(n));
        face(strip[n][0], strip[n + 1][1], strip[n + 1][0], outAt(n));
      }
    }
    bareHooks?.anus({ tb, bareWoman, pts, idx, dist, outAt, put, face, scaled });
  }
  if (bareWoman && legTops.length === 2) {
    // The skin under her, between the legs (BARE_UNDER): columns from the hips' lowest ring in front back to its
    // middle point behind, the outermost each side the crease along that leg's inner points; with the pelvis.
    let underMid = 0;
    let underCol: number[] = [];
    {
      const P = tb.pos;
      const at = (i: number): V3 => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
      const backV = underBack, back = at(backV);
      const U = { ...BARE_UNDER, to: frontLook.to, depth: frontLook.depth };
      // (The crease each side, front to back: the ring's outermost fine point, the leg's inner points, the middle behind.)
      const [topL, topR] = legTops;
      const creaseL = [hipRing + hipFront + hipSide, topL + 1, topL, backV], creaseR = [hipRing + hipFront - hipSide, topR + 5, topR + 6, backV];
      /** How far from the middle the crease is at a depth z (the two sides' mean). */
      const creaseX = (z: number): number => {
        const pts = creaseR.map((i, n) => [(Math.abs(P[i * 3]) + Math.abs(P[creaseL[n] * 3])) / 2, P[i * 3 + 2]]);
        for (let n = 0; n + 1 < pts.length; n++) if (z >= pts[n + 1][1]) return pts[n][0] + (pts[n + 1][0] - pts[n][0]) * clamp01((pts[n][1] - z) / Math.max(1e-6, pts[n][1] - pts[n + 1][1]));
        return 0;
      };
      const x0 = creaseX(1);
      const column = (j: number): number[] => {
        const r = at(hipRing + j);
        const col = [hipRing + j];
        for (const v of U.rows) {
          const z = r[2] + (back[2] - r[2]) * v;
          // (Between the creases as it is between the ring's outermost fine points; it hangs by how far out it is:
          // a round arc from the middle to `wide`, short of the thigh so it turns up again there, the middle held up
          // at the notch.)
          const x = (r[0] / x0) * creaseX(z);
          const t = Math.abs(x) / U.wide;
          const arc = t >= 1 ? 0 : Math.pow(Math.sin(Math.PI * t), 0.75);
          // (Its inner side comes down quickly from the notch, so the notch is narrow and each form round.)
          const hang = (t < 0.5 ? U.notch + (1 - U.notch) * Math.pow(Math.sin(Math.PI * t), 0.45) : arc) * Math.pow(Math.sin(Math.PI * clamp01(v / U.to)), 0.7);
          tb.pos.push(x, r[1] + (back[1] - r[1]) * v - U.sag * Math.sin(Math.PI * v) - U.depth * hang, z);
          tb.b0.push(PELVIS);
          tb.b1.push(PELVIS);
          tb.w.push(1);
          tb.shade.push(SKIN);
          col.push(mark() - 1);
        }
        col.push(backV);
        return col;
      };
      // (From her right, x < 0, to her left.)
      const cols: number[][] = [creaseL];
      for (let j = hipFront + hipSide - 1; j >= hipFront - hipSide + 1; j--) {
        cols.push(column(j));
        if (j === hipFront) {
          underCol = cols[cols.length - 1];
          underMid = underCol[1];
        }
      }
      cols.push(creaseR);
      // Faces between neighbouring columns (a zipper, as zip). The columns run from her right to her left and each
      // from the front back, so a face listed (this column, this column's next, the next column) faces out: down
      // under her, forward where the skin comes down off the hips' front. (Turning each to face away from a point
      // inside the body got the steep sides of a round form wrong, and they weren't drawn.)
      const tri = (a: number, b: number, c: number): void => {
        if (a !== b && b !== c && a !== c) tb.idx.push(a, b, c);
      };
      const along = (col: readonly number[]): number[] => {
        const f = [0];
        for (let i = 1; i < col.length; i++) f.push(f[i - 1] + Math.hypot(P[col[i] * 3] - P[col[i - 1] * 3], P[col[i] * 3 + 1] - P[col[i - 1] * 3 + 1], P[col[i] * 3 + 2] - P[col[i - 1] * 3 + 2]));
        return f.map((d) => d / (f[f.length - 1] || 1));
      };
      for (let c = 0; c + 1 < cols.length; c++) {
        const A = cols[c], B = cols[c + 1];
        const fa = along(A), fb = along(B);
        let i = 0, k = 0;
        while (i < A.length - 1 || k < B.length - 1) {
          const stepA = k === B.length - 1 || (i < A.length - 1 && fa[i + 1] <= fb[k + 1]);
          if (stepA) tri(A[i], A[i + 1], B[k]);
          else tri(A[i], B[k + 1], B[k]);
          if (stepA) i++;
          else k++;
        }
      }
    }
    bareHooks?.pubic({ tb, mark, frontLook, hipAngles, hipRing, hipFront, hipSide, baseRing, underMid });
  }

  // ---- Arms and hands ----
  // (A woman's arms hang a little inside the joints: narrower shoulders.)
  const armIn = (woman ? 0.014 : 0) + (detail && woman ? ARM_IN_FINE : 0);
  const ax = (y: number): number =>
    (y >= 1.42 ? P.shoulderX * 0.97 : y >= 1.13 ? P.elbowX + ((y - 1.13) / 0.29) * (P.shoulderX - P.elbowX) : P.wristX + ((y - 0.865) / 0.265) * (P.elbowX - P.wristX)) - armIn;
  // (A tattooed man's are inked to the wrist; a jacket's or a coat's sleeves; a politician's white gloves.)
  const armShade = BARE_ARMS.includes(outfit) ? SKIN : outfit === 'irezumi' ? INK : (coatShade ?? (outfit === 'doctor' ? WHITES : outfit === 'long' && !woman ? TAN : topShade));
  const handShade = politician ? WHITES : SKIN;
  for (const [s, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) {
    const ak = P.arm * (woman ? 0.88 : 1) * limb;
    if (detail) {
      // A character's arm and hand, one surface from the knuckles to the shoulder; fingers and a thumb on the palm.
      const hl = woman || body === 'child' ? 1 : 1.14;
      const hk = P.arm * limb;
      const handY = (y: number): number => (0.868 - (0.868 - y) * hl) * ys;
      const curl = (y: number): number => 0.012 * Math.pow(clamp01((0.868 - y / ys) / (0.14 * hl)), 2);
      const handX = (y: number): number => P.wristX + 0.003 * clamp01((0.868 * ys - y) / (0.03 * ys)) - armIn - curl(y);
      const lean = (y: number): number => {
        const k = clamp01((y / ys - 1.37) / 0.087);
        return ARM_LEAN * k * k;
      };
      const upper = ARM_FINE.map(([y, a, b, z]): Row => [y * ys, a * ak, b * ak, z * ak]);
      // (The palm shorter from the wrist and the fingers longer, toward the rigged reference's hand: HAND_FIT.)
      const inPalm = (y: number): number => 0.868 - (0.868 - y) * HAND_FIT[0];
      const palm = PALM.map(([y, a, b, z]): Row => [handY(inPalm(y)), a * hk, b * hk, z * hk]);
      // (A ring just under the wrist, the wrist's own section: where a sleeve ends, the hand's skin starts on a line.)
      const cuff: Row = [upper[0][0] - 0.003 * ys, upper[0][1], upper[0][2], upper[0][3]];
      // (The hand's own bone, at the wrist: the palm's, and the fingers' parent.)
      const wrist = handBone(s < 0 ? 0 : 1);
      pivot[wrist] = [s * (ax(upper[0][0] / ys) - lean(upper[0][0])), upper[0][0], upper[0][3]];
      const a0 = mark();
      tb.loft([...palm, cuff, ...upper], (r) => s * (r[0] >= upper[0][0] - 1e-6 ? ax(r[0] / ys) - lean(r[0]) : handX(r[0])), (r) => (r[0] < cuff[0] - 1e-6 ? one(wrist) : r[0] < upper[0][0] - 1e-6 ? blend(wrist, fore, 0.6) : r[0] < upper[0][0] + 1e-6 ? one(fore) : r[0] > 1.4 * ys ? blend(arm, SPINE, 0.6) : blend(arm, fore, clamp01((r[0] - 1.08 * ys) / (0.1 * ys)))), armShade, 10, 2.2);
      for (let i = a0; i < mark(); i++) if (tb.pos[i * 3 + 1] < upper[0][0] - 1e-6) tb.shade[i] = handShade;
      armRuns.push([a0, mark(), s]);
      /**
       * A finger (or the thumb) along its four points (root, middle joint, last joint, tip), bound to its three bones
       * (the root's, the middle joint's and the last joint's, which follows the middle one: mobRig.ts fingerTip):
       * rings close either side of each joint and between, the joint's own ring half each bone's, so it bends round
       * a corner instead of folding flat at one ring (which left the tip looking like a piece come off).
       */
      const finger = (path: readonly V3[], radii: readonly number[], j0: number, j1: number, j2: number): void => {
        const at = (seg: number, t: number): V3 => [0, 1, 2].map((k) => path[seg][k] + (path[seg + 1][k] - path[seg][k]) * t) as V3;
        const rad = (seg: number, t: number): number => radii[seg] + (radii[seg + 1] - radii[seg]) * t;
        const rings: [number, number, Weight][] = [
          [0, 0, blend(j0, wrist, 0.5)], [0, 0.22, one(j0)], [0, 0.6, one(j0)], [0, 0.85, blend(j0, j1, 0.8)],
          [1, 0, blend(j1, j0, 0.5)], [1, 0.18, blend(j1, j0, 0.8)], [1, 0.55, one(j1)], [1, 0.85, blend(j1, j2, 0.8)],
          [2, 0, blend(j2, j1, 0.5)], [2, 0.2, blend(j2, j1, 0.8)], [2, 0.6, one(j2)], [2, 1, one(j2)],
        ];
        if (rings.length !== FINGER_RINGS) throw new Error('a finger is FINGER_RINGS rings');
        pivot[j0] = path[0];
        pivot[j1] = path[1];
        pivot[j2] = path[2];
        fingerRuns.push([s, j0, mark()]);
        // (FINGER_SEG, not 8: at a finger's width, an 8-sided tube showed as faceted lines down its length and
        // round each bent knuckle, which read as creases (the user, 2026-10-07, against the reference models).)
        tube(tb, rings.map(([g, t]) => at(g, t)), rings.map(([g, t]) => rad(g, t)), FINGER_SEG, rings.map((q) => q[2]), handShade);
      };
      // Fingers from the knuckles, hanging and curling in toward the thigh, each a little more than the last.
      const yk = handY(inPalm(0.767)), X = handX(yk), zc = 0.004 * hk, half = 0.041 * hk;
      for (const [across, len, r, more] of FINGERS) {
        const path: V3[] = [[s * X, yk + 0.008 * ys, zc + half * across]];
        [[0.42, 10], [0.32, 28], [0.26, 50]].forEach(([share, angle]) => {
          const t = ((angle + more) * Math.PI) / 180, q = path[path.length - 1];
          path.push([q[0] - s * Math.sin(t) * len * HAND_FIT[1] * share * hk, q[1] - Math.cos(t) * len * HAND_FIT[1] * share * hk * hl, q[2]]);
        });
        const digit = 1 + FINGERS.findIndex((f) => f[0] === across);
        finger(path, [r * hk, r * 0.96 * hk, r * 0.88 * hk, r * 0.74 * hk], digitBone(s < 0 ? 0 : 1, digit, 0), digitBone(s < 0 ? 0 : 1, digit, 1), fingerTip(s < 0 ? 0 : 1, digit));
      }
      // The thumb, from the heel of the hand forward and down.
      const yt = handY(inPalm(0.835)), Xt = handX(yt);
      const thumb: V3[] = [[s * Xt, yt, 0.03 * hk], [s * (Xt - 0.004), yt - 0.03 * hk * hl, 0.053 * hk], [s * (Xt - 0.008), yt - 0.058 * hk * hl, 0.062 * hk], [s * (Xt - 0.011), yt - 0.078 * hk * hl, 0.064 * hk]];
      finger(thumb, [0.0125 * hk, 0.0115 * hk, 0.0095 * hk, 0.0075 * hk], digitBone(s < 0 ? 0 : 1, 0, 0), digitBone(s < 0 ? 0 : 1, 0, 1), fingerTip(s < 0 ? 0 : 1, 0));
      continue;
    }
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
    const chest = woman ? [1.12, 1.17, 1.21, 1.25, 1.29, 1.33, 1.375] : [1.12, 1.2, 1.28, 1.35];
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
    // The bib up the chest, a frill along its top, and straps over the shoulders to the back. (The bib's points are
    // the chest's own, every ten degrees from 55 to 125: others cut across between the breasts under the dress.)
    const BIB = (35 * Math.PI) / 180;
    over([1.08, 1.12, 1.16, 1.2, 1.23, 1.26, 1.29, 1.32, 1.34].map((y) => wrap(y, 0.012)), () => one(SPINE), WHITES, 7, 2.4, [F - BIB, F + BIB]);
    over([wrap(1.34, 0.012), wrap(1.365, 0.026)], () => one(SPINE), WHITES - 0.1, 7, 2.4, [F - BIB, F + BIB]);
    for (const c of [F - 0.55, F + 0.55, -F + 0.5, -F - 0.5]) over([1.33, 1.37, 1.42, 1.455].map((y) => wrap(y, 0.011)), () => one(SPINE), WHITES, 2, 2.4, [c - 0.07, c + 0.07]);
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
    if (woman) overChest([1.0, 1.06, 1.12, 1.16, 1.2, 1.23, 1.26, 1.29, 1.32, 1.35, 1.38].map((y) => wrap(y, 0.012)), hips, HIVIS);
    else over([1.0, 1.1, 1.2, 1.3, 1.38].map((y) => wrap(y, 0.012)), hips, HIVIS, S.seg, 2.4);
    for (const y of [1.1, 1.24]) {
      if (woman) overChest([wrap(y, 0.017), wrap(y + 0.0175, 0.017), wrap(y + 0.035, 0.017)], () => one(SPINE), LENS);
      else over([wrap(y, 0.016), wrap(y + 0.035, 0.016)], () => one(SPINE), LENS, S.seg, 2.4);
    }
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
    if (woman) overChest([wrap(0.868, 0.004), ...[0.875, 0.91, 0.95, 1.0, 1.06, 1.12, 1.16, 1.2, 1.23, 1.26, 1.29, 1.32, 1.35, 1.38, 1.43].map((y) => wrap(y, 0.016))], hips, topShade);
    else over([wrap(0.868, 0.004), ...[0.875, 1.0, 1.1, 1.2, 1.3, 1.38, 1.43].map((y) => wrap(y, 0.016))], hips, topShade, S.seg, 2.4);
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
    const by = (woman ? 1.36 : 1.34) * ys;
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
    const chest = woman ? [1.12, 1.16, 1.2, 1.23, 1.26, 1.29, 1.32, 1.35, 1.38] : [1.2, 1.34];
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
    bareHooks?.areola({ tb, mark, xs, ys, T, bareBreast, disc });
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
  if (detail) {
    // A character's arms brought toward the rigged reference's length (ARM_FIT; refs/models,
    // scripts/refs/measure_upper.py): shorter between the shoulder and the wrist, the hand moved up whole with the
    // wrist, as it was built. (Shortening or stretching the hand's own parts was tried: a palm 0.8 as long and fingers
    // half as long again, stretched along each finger's line, pinched the fingers at their joints and made them sticks.)
    const Q = tb.pos;
    for (const [from, to, side] of armRuns) {
      const h = side < 0 ? 0 : 1;
      const arm = h ? ARM_R : ARM_L, fore = h ? FORE_R : FORE_L, wrist = handBone(h);
      const digits = [0, 1, 2, 3, 4].flatMap((d) => [digitBone(h, d, 0), digitBone(h, d, 1), fingerTip(h, d)]);
      const sy = pivot[arm][1], wy = pivot[wrist][1], lift = (ARM_FIT - 1) * (wy - sy);
      // (Whatever goes with the arm, its hand or its fingers: the arm itself and a sleeve over it alike.)
      const limb = [arm, fore, wrist];
      for (let v = 0; v < tb.b0.length; v++) {
        const finger = digits.includes(tb.b0[v]) || digits.includes(tb.b1[v]);
        if (!finger && !limb.includes(tb.b0[v]) && !limb.includes(tb.b1[v]) && (v < from || v >= to)) continue;
        if (finger || Q[v * 3 + 1] < wy) Q[v * 3 + 1] += lift;
        else if (Q[v * 3 + 1] < sy) Q[v * 3 + 1] = sy + (Q[v * 3 + 1] - sy) * ARM_FIT;
      }
      pivot[fore] = [pivot[fore][0], sy + (pivot[fore][1] - sy) * ARM_FIT, pivot[fore][2]];
      for (const b of [wrist, ...digits]) pivot[b] = [pivot[b][0], pivot[b][1] + lift, pivot[b][2]];
    }
  }
  if (WELD_FINGERS && detail) {
    // A character's four fingers and palm made one surface. The palm's loft ends open at the knuckles in one ring, and
    // each finger was a tube pushed up into it. Each finger's own first ring (inside the palm) goes; its second is its
    // base. The four bases are gone round as one line (across the back of the hand from the index to the little
    // finger, and back across the palm's side), which is joined to the palm's ring going round both together by
    // length; and the gap between each two fingers is closed with a web. Every new face is turned to face out.
    const Q = tb.pos, RING = FINGER_SEG, PALM_SEG = 10;
    const at = (v: number): V3 => [Q[v * 3], Q[v * 3 + 1], Q[v * 3 + 2]];
    for (const [from, , side] of armRuns) {
      const mine = fingerRuns.filter((f) => f[0] === side && (f[1] - BONES) % 10 >= 2).map((f) => f[2]);
      if (mine.length !== 4) continue;
      // (From the palm's second ring: its lowest goes too, so the join is a slope down from the knuckles into the
      // fingers and not the square end the palm's loft had.)
      const palm = Array.from({ length: PALM_SEG }, (_, j) => from + PALM_SEG + j);
      const dead = new Set([...mine.flatMap((st) => Array.from({ length: RING }, (_, j) => st + j)), ...Array.from({ length: PALM_SEG }, (_, j) => from + j)]);
      // Each finger's base ring: its middle, and its two halves (back of the hand, palm's side), each across the hand.
      const bases = mine.map((st) => {
        const ring = Array.from({ length: RING }, (_, j) => st + RING + j);
        const mid = ring.reduce((m, v) => [m[0] + Q[v * 3] / RING, m[1] + Q[v * 3 + 1] / RING, m[2] + Q[v * 3 + 2] / RING], [0, 0, 0]);
        const back = ring.filter((v) => (Q[v * 3] - mid[0]) * side >= 0).sort((p, q) => Q[p * 3 + 2] - Q[q * 3 + 2]);
        const front = ring.filter((v) => (Q[v * 3] - mid[0]) * side < 0).sort((p, q) => Q[q * 3 + 2] - Q[p * 3 + 2]);
        return { mid, back, front };
      }).sort((p, q) => p.mid[2] - q.mid[2]);
      if (bases.some((b) => !b.back.length || !b.front.length)) continue;
      let line = [...bases.flatMap((b) => b.back), ...bases.slice().reverse().flatMap((b) => b.front)];
      const all = [...palm, ...line];
      const mid: V3 = [0, 0, 0];
      for (const v of all) for (let c = 0; c < 3; c++) mid[c] += Q[v * 3 + c] / all.length;
      const faces: number[] = [];
      /** A face, turned to face away from a point (or, `down`, toward the fingertips). */
      const face = (a: number, b: number, c: number, down = false): void => {
        const A = at(a), B = at(b), C = at(c);
        const n: V3 = [(B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])];
        const out = down ? -n[1] : n[0] * ((A[0] + B[0] + C[0]) / 3 - mid[0]) + n[2] * ((A[2] + B[2] + C[2]) / 3 - mid[2]);
        if (out >= 0) faces.push(a, b, c);
        else faces.push(a, c, b);
      };
      // (Both the same way round, seen from above, and the fingers' line starting beside the palm's first point.)
      const turn = (loop: readonly number[]): number => loop.reduce((sum, v, n) => {
        const w = loop[(n + 1) % loop.length];
        return sum + (Q[v * 3] - mid[0]) * (Q[w * 3 + 2] - mid[2]) - (Q[w * 3] - mid[0]) * (Q[v * 3 + 2] - mid[2]);
      }, 0);
      if (Math.sign(turn(line)) !== Math.sign(turn(palm))) line = line.reverse();
      const far = (p: number, q: number): number => Math.hypot(Q[p * 3] - Q[q * 3], Q[p * 3 + 1] - Q[q * 3 + 1], Q[p * 3 + 2] - Q[q * 3 + 2]);
      let start = 0;
      for (let j = 1; j < line.length; j++) if (far(palm[0], line[j]) < far(palm[0], line[start])) start = j;
      line = [...line.slice(start), ...line.slice(0, start)];
      const along = (loop: readonly number[]): number[] => {
        const d = [0];
        for (let n = 0; n < loop.length; n++) d.push(d[n] + far(loop[n], loop[(n + 1) % loop.length]));
        return d.map((x) => x / d[loop.length]);
      };
      const da = along(palm), db = along(line);
      let i = 0, j = 0;
      while (i < palm.length || j < line.length) {
        const ai = palm[i % palm.length], bj = line[j % line.length];
        if (j >= line.length || (i < palm.length && da[i + 1] <= db[j + 1])) {
          face(ai, palm[(i + 1) % palm.length], bj);
          i++;
        } else {
          face(bj, line[(j + 1) % line.length], ai);
          j++;
        }
      }
      // The webs: between each two fingers, their facing sides' four points.
      for (let n = 0; n + 1 < bases.length; n++) {
        const p = bases[n], q = bases[n + 1];
        const a = p.back[p.back.length - 1], b = q.back[0], c = q.front[q.front.length - 1], d = p.front[0];
        face(a, b, c, true);
        face(a, c, d, true);
      }
      tb.idx = [...tb.idx.filter((_, n) => !dead.has(tb.idx[n - (n % 3)]) && !dead.has(tb.idx[n - (n % 3) + 1]) && !dead.has(tb.idx[n - (n % 3) + 2])), ...faces];
    }
  }
  if (WELD_FINGERS && detail) {
    // The thumb too (`weld`): it leaves the side of the palm, so what of each lies inside the other is cut away and the
    // two openings are joined, gone round as seen along the thumb. Where they don't meet in one clean line each it is
    // left as it was built (nothing is changed).
    for (const [from, to, side] of armRuns) {
      const thumb = fingerRuns.find((f) => f[0] === side && (f[1] - BONES) % 10 < 2);
      if (!thumb) continue;
      const r = pivot[thumb[1]], q = pivot[thumb[1] + 1];
      const len = Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) || 1;
      weld(tb, [thumb[2], thumb[2] + FINGER_RINGS * FINGER_SEG + 1], [from, to], (x, y, z) => Math.hypot(x - r[0], y - r[1], z - r[2]) < THUMB_WELD * ys, [(q[0] - r[0]) / len, (q[1] - r[1]) / len, (q[2] - r[2]) / len]);
    }
  }
  const welded = new Map<number, number>();
  /** (Each welded shoulder's seam, by side: its arm's run, a point of the seam, the way out of the body square to it.) */
  const seams = new Map<number, { from: number; to: number; near: Map<number, number>; down: Map<number, readonly [number, number, number]>; ay: number; high: number }>();
  if (WELD_RING && detail && chestRun && Math.floor(tb.shade[chestRun[0]] / 100) === 1) {
    // A character's bare arm and chest made one surface, along a smooth seam: an upright plane (running front to back)
    // through the armpit and the top of the arm, as a sleeve's seam lies. The arm is cut off at it: up each of its
    // lines of points the first point past the plane is put on the plane and the rest above goes, so its edge is one
    // point a line, all on the plane. The chest is opened where that edge stands against it, and the two are joined.
    const SEG = 10, Q = tb.pos;
    for (const [from, to, side] of armRuns) {
      const rowsN = (to - from) / SEG;
      const arm = side < 0 ? ARM_L : ARM_R;
      const at = (k: number, j: number): number => from + k * SEG + j;
      let kp = 0, top = from;
      for (let k = 0; k < rowsN; k++) if (Math.abs(Q[at(k, 0) * 3 + 1] - (pivot[arm][1] - WELD_SEAM[0] * ys)) < Math.abs(Q[at(kp, 0) * 3 + 1] - (pivot[arm][1] - WELD_SEAM[0] * ys))) kp = k;
      for (let v = from; v < to; v++) if (Q[v * 3 + 1] > Q[top * 3 + 1]) top = v;
      let ax = Infinity;
      for (let j = 0; j < SEG; j++) ax = Math.min(ax, Q[at(kp, j) * 3] * side);
      const ay = Q[at(kp, 0) * 3 + 1];
      let dx = Q[top * 3] * side - ax, dy = Q[top * 3 + 1] - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.03 || dy <= 0) continue;
      dx /= len;
      dy /= len;
      const nx = dy, ny = -dx;
      const out = (v: number): number => (Q[v * 3] * side - ax) * nx + (Q[v * 3 + 1] - ay) * ny;
      // The arm's edge: a point a line.
      const rim: number[] = [];
      for (let j = 0; j < SEG; j++) {
        let r = rowsN - 1;
        // (From the armpit's ring up: under it the arm is never cut, though its inner side may stand a hair inside the plane.)
        for (let k = kp; k + 1 < rowsN; k++) {
          const t0 = out(at(k, j)), t1 = out(at(k + 1, j));
          if (t1 >= 0) continue;
          const f = t0 <= 0 ? 0 : t0 / (t0 - t1), a = at(k, j) * 3, b = at(k + 1, j) * 3;
          for (let c = 0; c < 3; c++) Q[b + c] = Q[a + c] + (Q[b + c] - Q[a + c]) * f;
          r = k + 1;
          break;
        }
        rim.push(r);
      }
      const edge = rim.map((r, j) => at(r, j));
      // The chest's opening: what of it stands inside that edge, seen square to the plane, and isn't far behind it.
      const flat = (v: number): [number, number] => [Q[v * 3 + 2], (Q[v * 3] * side - ax) * dx + (Q[v * 3 + 1] - ay) * dy];
      const ring = edge.map(flat);
      const mu = ring.reduce((sum, q) => sum + q[0], 0) / SEG, mv = ring.reduce((sum, q) => sum + q[1], 0) / SEG;
      const within = ([u, v]: [number, number]): boolean => {
        let odd = false;
        for (let i = 0, j = SEG - 1; i < SEG; j = i++) {
          const [ui, vi] = ring[i], [uj, vj] = ring[j];
          if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) odd = !odd;
        }
        return odd;
      };
      const gone = new Set<number>();
      for (let v = chestRun[0]; v < chestRun[1]; v++) {
        if (Q[v * 3] * side < 0.02 || out(v) < -WELD_SEAM[1] * ys) continue;
        const [u, w] = flat(v);
        if (within([mu + (u - mu) / WELD_SEAM[2], mv + (w - mv) / WELD_SEAM[2]])) gone.add(v);
      }
      if (!gone.size) continue;
      const hole = openingOf(tb, chestRun, gone);
      if (!hole) continue;
      // The faces: the arm's above its edge go, the gaps between its lines' ends are filled; the chest's on the opening go.
      const I = tb.idx, kept: number[] = [];
      for (let t = 0; t < I.length; t += 3) {
        const f = [I[t], I[t + 1], I[t + 2]];
        if (f.every((v) => v >= from && v < to) && f.some((v) => Math.floor((v - from) / SEG) > rim[(v - from) % SEG])) continue;
        if (f.every((v) => v >= chestRun![0] && v < chestRun![1]) && f.some((v) => gone.has(v))) continue;
        kept.push(...f);
      }
      for (let j = 0; j < SEG; j++) {
        const j1 = (j + 1) % SEG;
        if (rim[j1] > rim[j]) for (let q = rim[j]; q < rim[j1]; q++) kept.push(at(rim[j], j), at(q + 1, j1), at(q, j1));
        else for (let q = rim[j1]; q < rim[j]; q++) kept.push(at(q, j), at(q + 1, j), at(rim[j1], j1));
      }
      const angle = (v: number): number => {
        const [u, w] = flat(v);
        return Math.atan2(w - mv, u - mu);
      };
      kept.push(...stitchRings(edge, hole.slice().reverse(), angle));
      tb.idx = kept;
      // (The chest's points close by the opening, and how close: only they take any of the arm's turning.)
      const near = new Map<number, number>();
      for (let v = chestRun[0]; v < chestRun[1]; v++) {
        if (Q[v * 3] * side < 0.02 || gone.has(v)) continue;
        let off = Infinity;
        for (const q of hole) off = Math.min(off, Math.hypot(Q[v * 3] - Q[q * 3], Q[v * 3 + 1] - Q[q * 3 + 1], Q[v * 3 + 2] - Q[q * 3 + 2]));
        if (off < WELD_SEAM[5] * ys) near.set(v, 1 - off / (WELD_SEAM[5] * ys));
      }
      // (And each of the arm's points, how far down its own line from the edge it is, as a share of the way to where
      // the skin is all the arm's: a short way under the armpit, where the edge is low, so the arm lifts clear of
      // the ribs there and no web is drawn out under it; a long way over the top of the shoulder.)
      const down = new Map<number, readonly [number, number, number]>();
      const high = Q[top * 3 + 1] - ay;
      for (let j = 0; j < SEG; j++) {
        let d = 0;
        const reach = (WELD_SEAM[3] + (WELD_SEAM[4] - WELD_SEAM[3]) * clamp01((Q[at(rim[j], j) * 3 + 1] - ay) / high)) * ys;
        // (What the seam itself takes of the arm's turning where this line meets it: WELD_SEAM's last under the
        // armpit, which rises with a raised arm, to none at the top of the shoulder.)
        const base = WELD_SEAM[6] * (1 - clamp01((Q[at(rim[j], j) * 3 + 1] - ay) / high));
        down.set(at(rim[j], j), [0, base, reach]);
        for (let k = rim[j] - 1; k >= 0 && d < 0.3; k--) {
          const a = at(k, j) * 3, b = at(k + 1, j) * 3;
          d += Math.hypot(Q[a] - Q[b], Q[a + 1] - Q[b + 1], Q[a + 2] - Q[b + 2]);
          down.set(at(k, j), [d / reach, base, reach]);
        }
      }
      seams.set(side, { from, to, near, down, ay, high });
    }
  }
  if (WELD_ARMS && detail && chestRun && Math.floor(tb.shade[chestRun[0]] / 100) === 1) {
    // A character's bare arms and chest made one surface (`weld`): the arm is a shape of its own pushed into the
    // shoulder, its join only shaded over. About the shoulder and no lower than the armpit: down the ribs the arm
    // hangs against the body and is no part of it. OFF (WELD_ARMS): see there.
    for (const [from, to, side] of armRuns) {
      const arm = side < 0 ? ARM_L : ARM_R;
      const low = pivot[arm][1] - WELD_SHOULDER * ys;
      const joined = weld(tb, [from, to], chestRun, (x, y) => y > low && x * side > 0.03);
      if (!joined) continue;
      // (The chest's skin about the join goes with the arm as the arm's own does there, less with distance from
      // the join, to nothing SHOULDER_BEND's third away: the pull of a raised arm is spread over the chest and the
      // back beside it, not taken up in the join's own faces.)
      const edge = [...joined[0], ...joined[1]];
      for (let v = chestRun[0]; v < chestRun[1]; v++) {
        if (tb.pos[v * 3] * side < 0.03 || tb.pos[v * 3 + 1] < low - 0.08 * ys) continue;
        let off = Infinity;
        for (const q of edge) off = Math.min(off, Math.hypot(tb.pos[v * 3] - tb.pos[q * 3], tb.pos[v * 3 + 1] - tb.pos[q * 3 + 1], tb.pos[v * 3 + 2] - tb.pos[q * 3 + 2]));
        if (off < SHOULDER_BEND[2] * ys) welded.set(v, 1 - off / (SHOULDER_BEND[2] * ys));
      }
    }
  }
  if (detail) {
    // More joints up a character's spine (mobRig.ts spineBone): what went with the one bone from the waist up goes,
    // by its height, with the waist's, the lower chest's or the upper chest's (eased across each joint), and what
    // was built as the head (and everything on it) with the head's own bone on top of the neck's.
    const ribs = spineBone(0), upper = spineBone(1), skull = spineBone(2);
    const y1 = SPINE_JOINTS[0] * ys, y2 = SPINE_JOINTS[1] * ys, y3 = neckY + SPINE_JOINTS[2] * hk, band = SPINE_JOINTS[3] * ys;
    pivot[ribs] = [0, y1, -0.012];
    pivot[upper] = [0, y2, -0.018];
    pivot[skull] = [0, y3, -0.006];
    const ease = (t: number): number => {
      const k = Math.max(0, Math.min(1, t));
      return k * k * (3 - 2 * k);
    };
    for (let i = 0; i < tb.b0.length; i++) {
      const y = tb.pos[i * 3 + 1];
      const a = tb.w[i] < 0.001 ? tb.b1[i] : tb.b0[i], b = tb.w[i] > 0.999 ? tb.b0[i] : tb.b1[i];
      if (a !== SPINE && a !== HEAD && b !== SPINE && b !== HEAD) continue;
      let b0 = a, b1 = b, w = tb.w[i];
      if (i >= h0) {
        if (a === HEAD) b0 = skull;
        if (b === HEAD) b1 = skull;
      } else if (a === HEAD && b === HEAD) {
        // (The neck's own top: onto the head.)
        [b0, b1, w] = [skull, HEAD, ease((y - (y3 - band)) / (2 * band))];
      }
      if (a === SPINE && b === SPINE) {
        if (y >= y2 - band) [b0, b1, w] = [upper, ribs, ease((y - (y2 - band)) / (2 * band))];
        else if (y >= y1 - band) [b0, b1, w] = [ribs, SPINE, ease((y - (y1 - band)) / (2 * band))];
      } else {
        const at = y >= y2 ? upper : y >= y1 ? ribs : SPINE;
        if (a === SPINE) b0 = at;
        if (b === SPINE) b1 = at;
      }
      tb.b0[i] = b0;
      tb.b1[i] = b1;
      tb.w[i] = w;
    }
    // Where a character's hips and ankles bend (HIP_CREASE, ANKLE_BEND; the crowd's are as they were: its legs only
    // walk). The hips' skin went over to the thigh well under the hip's joint, in front and behind alike, so a thigh
    // raised carried a shelf out in front and left the buttock standing over it behind; and a foot was one stiff
    // piece on a shin that ended inside it, so a foot turned showed a step behind the ankle.
    const skinOnly = SKIRTED.includes(outfit);
    pivot[hipHalf(0)] = pivot[THIGH_L];
    pivot[hipHalf(1)] = pivot[THIGH_R];
    pivot[shoulderHalf(0)] = pivot[ARM_L];
    pivot[shoulderHalf(1)] = pivot[ARM_R];
    for (const sd of [0, 1] as const) {
      const arm = sd === 0 ? ARM_L : ARM_R;
      pivot[armSwing(sd)] = pivot[arm];
      // (A collar bone turns about its inner end, by the breastbone, a little over the shoulder's height.)
      pivot[clavicle(sd)] = [Math.sign(pivot[arm][0]) * COLLAR[0] * ys, pivot[arm][1] + COLLAR[1] * ys, pivot[arm][2] + 0.02];
    }
    const [creaseF, creaseB, bandF, bandB] = HIP_CREASE;
    for (let i = 0; i < tb.b0.length; i++) {
      const x = tb.pos[i * 3], y = tb.pos[i * 3 + 1], z = tb.pos[i * 3 + 2];
      const right = x > 0;
      const thigh = right ? THIGH_R : THIGH_L, shin = right ? SHIN_R : SHIN_L, foot = right ? FOOT_R : FOOT_L;
      const a = tb.w[i] < 0.001 ? tb.b1[i] : tb.b0[i], b = tb.w[i] > 0.999 ? tb.b0[i] : tb.b1[i];
      const wa = a === b ? 1 : tb.w[i];
      const arm = right ? ARM_R : ARM_L;
      const seam = seams.get(right ? 1 : -1);
      if (seam) {
        // A welded shoulder: the skin goes over to the arm by how far down the arm from the seam it is (along the
        // arm's own lines of points, so it is the same all round the seam and the faces that join arm and chest
        // aren't pulled askew), through the shoulder's half-way bone; the chest's own skin right by the seam takes
        // what the seam has, less with distance.
        const inArm = i >= seam.from && i < seam.to && seam.down.has(i) && (a === arm || b === arm) && (a === arm || a === upper) && (b === arm || b === upper);
        const inChest = seam.near.has(i);
        if (inArm || inChest) {
          // (The arm's: from what the seam has where its line meets it, to all the arm's. The chest's by the seam:
          // what the seam has at its height, less with distance, so the faces across the seam move as one and a
          // raised arm draws the armpit up with it instead of a web out of it.)
          const sd = right ? 1 : 0, collar = clavicle(sd), plain = armSwing(sd), half = shoulderHalf(sd);
          if (!inArm) {
            // (The chest's skin by the seam: with the collar bone, less with distance, so the shoulder rises with a raised arm.)
            [tb.b0[i], tb.b1[i], tb.w[i]] = [collar, upper, ease(seam.near.get(i)!)];
            continue;
          }
          // (The arm's: at the seam the collar bone's; down from it, over to the arm without its twist, through the
          // half-way bone; and from there the arm's twist comes on evenly down to the elbow.)
          const [way, , reach] = seam.down.get(i)!;
          const share = ease(way);
          if (share < 0.999 || a !== arm || b !== arm) [tb.b0[i], tb.b1[i], tb.w[i]] = share < 0.5 ? [half, collar, share * 2] : [plain, half, share * 2 - 1];
          else [tb.b0[i], tb.b1[i], tb.w[i]] = [arm, plain, clamp01(((way - 1) * reach) / Math.max(0.02, pivot[arm][1] - pivot[right ? FORE_R : FORE_L][1] - 1.4 * reach))];
          continue;
        }
      }
      if (welded.has(i)) {
        const k = welded.get(i)!;
        const share = k * k * (3 - 2 * k) * ease((pivot[arm][1] - y + SHOULDER_BEND[0] * ys) / ((SHOULDER_BEND[0] + SHOULDER_BEND[1]) * ys)), half = shoulderHalf(right ? 1 : 0);
        if (share > 0.005) {
          [tb.b0[i], tb.b1[i], tb.w[i]] = share < 0.5 ? [half, upper, share * 2] : [arm, half, share * 2 - 1];
          continue;
        }
      }
      if ((a === arm || b === arm) && (a === arm || a === upper) && (b === arm || b === upper)) {
        // The shoulder (SHOULDER_BEND): the arm is a shape of its own whose top leans in over the chest, and all of
        // it turned with the arm (its top six parts in ten), so a raised arm lifted its top out of the shoulder and
        // stood beside the body. Now what is over the joint stays on the chest, and down from there the skin goes
        // over to the arm through the shoulder's half-way bone: the top stays in the shoulder and the arm bends out
        // of it. (A sleeve over it the same, by its place.)
        const down = pivot[arm][1] - y;
        const share = ease((down + SHOULDER_BEND[0] * ys) / ((SHOULDER_BEND[0] + SHOULDER_BEND[1]) * ys)), half = shoulderHalf(right ? 1 : 0);
        [tb.b0[i], tb.b1[i], tb.w[i]] = share < 0.5 ? [half, upper, share * 2] : [arm, half, share * 2 - 1];
        continue;
      }
      if ((a === shin || a === foot) && (b === shin || b === foot)) {
        // The ankle: by height through a band about the joint, the shin's skin, the foot's and what joins them
        // alike (so none comes through another); forward of the instep the foot is as it was.
        const was = (a === shin ? wa : 0) + (b === shin && a !== b ? 1 - wa : 0);
        const low = pivot[foot][1] - ANKLE_BEND[0] * ys, top = pivot[foot][1] + ANKLE_BEND[1] * ys;
        const up = ease((y - low) / (top - low));
        const near = 1 - ease((z - pivot[foot][2] - ANKLE_BEND[2]) / ANKLE_BEND[3]);
        [tb.b0[i], tb.b1[i], tb.w[i]] = [shin, foot, was + (up - was) * near];
      } else if ((a === PELVIS || a === thigh) && (b === PELVIS || b === thigh) && (!skinOnly || Math.floor(tb.shade[i] / 100) === 1)) {
        // The hip: in front the line the thigh folds at runs from where the legs part up to the joint's height by
        // the middle of the thigh, and the skin goes over in a short way (a crease); behind, half-way up the
        // buttock, over a tall band (a raised thigh draws the buttock down round it). Near the middle as it was.
        const was = (a === thigh ? wa : 0) + (b === thigh && a !== b ? 1 - wa : 0);
        const out = clamp01(Math.abs(x) / 0.16), front = clamp01((z + 0.03) / 0.06);
        const rise = ease((out - 0.1) / 0.35);
        const lineF = crotch + (creaseF - crotch) * rise, lineB = crotch + (creaseB - crotch) * ease(out / 0.45);
        const line = (lineB + (lineF - lineB) * front) * ys;
        const band = (bandB + (0.09 + (bandF - 0.09) * rise - bandB) * front) * ys;
        const now = ease((line + band / 2 - y) / band);
        // (Through the hip's half-way bone: the pelvis to it over the first half of the way, it to the thigh over the rest.)
        const share = was + (now - was) * clamp01((Math.abs(x) - 0.02) / 0.03), half = hipHalf(right ? 1 : 0);
        [tb.b0[i], tb.b1[i], tb.w[i]] = share < 0.5 ? [half, PELVIS, share * 2] : [thigh, half, share * 2 - 1];
      }
    }
  }
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
  const tall = figure?.height ?? 1;
  if (tall !== 1) for (let i = 0; i < tb.pos.length; i++) tb.pos[i] *= tall;
  const done = built(tb.build(tall === 1 ? pivot : pivot.map((v): V3 => [v[0] * tall, v[1] * tall, v[2] * tall]), armOut));
  if (detail) {
    // (Where the arms meet the shoulders and the legs the feet: one surface to the light.)
    const sx = (P.shoulderX * 0.97 - armIn - 0.02) * tall, fx = (woman ? 0.052 : P.hipX * 0.88) * tall;
    const hx = (P.wristX - armIn) * tall;
    softenNormals(done, [-1, 1].flatMap((sd): [V3, number][] => [[[sd * sx, 1.43 * ys * tall, -0.01], 0.075 * tall], [[sd * fx, 0.06 * tall, -0.01], 0.05 * tall], [[sd * hx, 0.775 * ys * tall, 0.005], 0.06 * tall]]));
  }
  return done;
}
