import type { Cap, HairKit } from './mobHair';
import type { MenHair } from './mobMenHairKinds';

/**
 * Men's hairstyles (the geometry; names in mobMenHairKinds.ts). Each is a cap (a hairline by angle, as mobShape.ts's
 * `HairStyle`) and, for most, what stands on or hangs from it, built with the kit buildShaped lends (`lock`, `onHead`,
 * `loft`: head units from the neck joint, y up, z negative at the back, angles from the front round to the back, pi).
 * Nothing here is random: the variety between strands is a fixed fraction of their index.
 */
const PI = Math.PI;
const frac = (i: number): number => (i * 0.618) % 1;

export interface MenCut {
  readonly cap: Cap;
  /** Bald on top: the cap stops at the pate and is sunk under the skin above it (as the boss's comb-over's). */
  readonly pate?: boolean;
  readonly build?: (k: HairKit) => void;
}

// ---- Caps (hairline by angle: [angle, height]; the ear is at about 0.09, the nape at about 0.03) ----
const SHORT: Cap = { line: [[0, 0.17], [0.6, 0.168], [0.95, 0.152], [1.25, 0.122], [1.45, 0.104], [1.75, 0.106], [2.05, 0.06], [2.45, 0.032], [PI, 0.026]], thick: [0.007, 0.022] };
const CREW: Cap = { line: [[0, 0.176], [0.6, 0.174], [0.95, 0.156], [1.25, 0.124], [1.45, 0.108], [1.75, 0.11], [2.05, 0.066], [2.45, 0.04], [PI, 0.034]], thick: [0.004, 0.012] };
const PART: Cap = { line: [[0, 0.168], [0.6, 0.166], [0.95, 0.15], [1.25, 0.12], [1.45, 0.1], [1.75, 0.102], [2.05, 0.056], [2.45, 0.03], [PI, 0.024]], thick: [0.008, 0.028] };
/** Short sides, the top kept: a hairline far up the sides. */
const UNDER: Cap = { line: [[0, 0.176], [0.5, 0.18], [0.9, 0.17], [1.15, 0.15], [1.45, 0.138], [1.8, 0.135], [2.2, 0.1], [PI, 0.08]], thick: [0.004, 0.02] };
const PERM: Cap = { line: [[0, 0.172], [0.6, 0.17], [0.95, 0.15], [1.25, 0.112], [1.45, 0.09], [1.75, 0.09], [2.05, 0.05], [2.45, 0.02], [PI, 0.01]], thick: [0.03, 0.05], spike: 0.01, spikeBack: 1 };
const BOWL: Cap = { line: [[0, 0.118], [0.6, 0.118], [0.95, 0.112], [1.25, 0.106], [1.5, 0.1], [2.2, 0.08], [PI, 0.07]], thick: [0.012, 0.036] };
const LONG: Cap = { line: [[0, 0.17], [0.6, 0.166], [0.95, 0.13], [1.25, 0.1], [1.5, 0.09], [2.0, 0.04], [PI, 0.0]], thick: [0.016, 0.026], spike: 0.01, spikeBack: 1 };
const MULLET: Cap = { line: [[0, 0.172], [0.6, 0.17], [0.95, 0.15], [1.25, 0.116], [1.5, 0.1], [2.0, 0.07], [PI, 0.05]], thick: [0.01, 0.024], spike: 0.01, spikeBack: 1 };
const BACK: Cap = { line: [[0, 0.19], [0.4, 0.2], [0.75, 0.18], [0.95, 0.152], [1.25, 0.116], [1.45, 0.1], [1.75, 0.1], [2.1, 0.05], [PI, 0.03]], thick: [0.008, 0.016] };
/** Bald on top: hair only from the ears round the back (the hairline above the skull's crown at the front). */
const SIDES: Cap = { line: [[0, 0.3], [0.5, 0.3], [0.8, 0.2], [1.1, 0.138], [1.45, 0.108], [1.75, 0.11], [2.05, 0.066], [2.45, 0.036], [PI, 0.03]], thick: [0.008, 0.012] };
/** Receding: the front back to the temples, thin on top. */
const RECEDE: Cap = { line: [[0, 0.215], [0.4, 0.222], [0.7, 0.2], [1.0, 0.16], [1.25, 0.122], [1.45, 0.104], [1.75, 0.106], [2.05, 0.06], [2.45, 0.032], [PI, 0.026]], thick: [0.008, 0.016] };

// ---- What stands on a cap ----
/** Locks over the top from the brow, combed to one side (`side`): a side parting. */
const sweep = (k: HairKit, n: number, reach: number, side = 1): void => {
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const phi = -0.5 + f;
    const lift = 0.012 + 0.014 * Math.sin(f * PI);
    k.lock([k.onHead(phi * 0.9, 0.222, 0.018), k.onHead(phi, 0.212, 0.03 + lift), k.onHead(phi + side * reach, 0.18, 0.034), k.onHead(phi + side * reach * 1.5, 0.125, 0.016)], [0.016, 0.02, 0.018, 0], 0.014);
  }
};
/** Spikes: locks standing up and out from the crown. */
const spikes = (k: HairKit, n: number, h: number): void => {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * PI;
    const r = 0.03 + 0.05 * frac(i);
    const up = h * (0.7 + 0.5 * frac(i + 3));
    const from = k.onHead(a * 0.5 - 1.2, 0.22, 0.01);
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r * 0.8 - 0.01;
    k.lock([from, [bx * 0.7, 0.235 + up * 0.35, bz * 0.7], [bx, 0.235 + up * 0.8, bz], [bx * 1.25 + (frac(i) - 0.5) * 0.03, 0.235 + up, bz * 1.25]], [0.016, 0.02, 0.014, 0], 0.012, true);
  }
};
/**
 * Hair hanging down the back of the neck, in strands side by side across `half` (head units), each to its own length
 * (y under the neck joint, negative); the outer ones a little shorter. They lie behind the neck and over the back of the
 * shoulders and never come round it.
 */
const hang = (k: HairKit, n: number, half: number, len: number): void => {
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * 2 - 1;
    const x = f * half;
    const l = len * (1 - 0.35 * Math.abs(f)) * (0.9 + 0.2 * frac(i));
    const zb = -0.098 + 0.02 * Math.abs(f);
    k.lock([[x, 0.1, zb + 0.012], [x * 1.02, 0.03, zb], [x * 1.04, -0.04, zb - 0.004], [x * 1.04, l, zb - 0.012]], [0.02, 0.022, 0.022, 0], 0.012);
  }
};
/** A knot of hair: a lofted ball at (0, y, z). */
const knot = (k: HairKit, y: number, z: number, r: number): void => {
  k.loft([[y - r * 0.6, 0.003, 0.003, z], [y - r * 0.3, r * 0.7, r * 0.6, z], [y + r * 0.2, r, r * 0.9, z], [y + r * 0.7, r * 0.65, r * 0.55, z], [y + r * 0.9, 0.003, 0.003, z]], 0, 8);
};
/** Hair combed straight back from the brow over the crown to the nape, in strands side by side, ending at `tail` (head units, from the neck joint). */
const combBack = (k: HairKit, n: number, tail: number): void => {
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.0155;
    const e = 1 - Math.abs(x) * 3.2;
    k.lock([[x, 0.2, 0.082 * e], [x * 0.95, 0.245, 0.03], [x * 0.85, 0.248, -0.05], [x * 0.7, 0.205, -0.112], [x * 0.55, 0.12, -0.128], [x * 0.5, tail - 0.025 * frac(i), -0.118]], [0.014, 0.019, 0.02, 0.02, 0.018, 0], 0.014);
  }
};

export const MEN_CUTS: Readonly<Record<MenHair, MenCut>> = {
  m_side_part: { cap: PART, build: (k) => sweep(k, 9, 0.45) },
  m_crew: { cap: CREW },
  m_quiff: {
    cap: UNDER,
    build: (k) => {
      k.loft([[0.2, 0.05, 0.07, 0.03], [0.235, 0.072, 0.09, 0.05], [0.268, 0.066, 0.082, 0.07], [0.286, 0.04, 0.05, 0.088], [0.292, 0.003, 0.003, 0.09]], 0, 10);
      sweep(k, 5, 0.25);
    },
  },
  m_messy: { cap: SHORT, build: (k) => spikes(k, 14, 0.07) },
  m_perm: { cap: PERM },
  m_slick_long: { cap: BACK, build: (k) => combBack(k, 9, -0.04) },
  m_undercut: { cap: UNDER, build: (k) => combBack(k, 9, 0.14) },
  m_bowl: { cap: BOWL },
  m_long: { cap: LONG, build: (k) => hang(k, 9, 0.075, -0.17) },
  m_mullet: { cap: MULLET, build: (k) => hang(k, 7, 0.06, -0.12) },
  m_bun: {
    cap: BACK,
    build: (k) => {
      knot(k, 0.205, -0.098, 0.044);
      for (let i = 0; i < 7; i++) k.lock([k.onHead(-0.8 + i * 0.27, 0.19, 0.03), k.onHead(PI - 0.7 + i * 0.23, 0.2, 0.034), [(i - 3) * 0.008, 0.2, -0.09]], [0.02, 0.02, 0.008], 0.012);
    },
  },
  m_ponytail: {
    cap: BACK,
    build: (k) => {
      for (const [x, len] of [[-0.022, -0.12], [0, -0.17], [0.022, -0.13]] as const) k.lock([[0, 0.16, -0.1], [x * 0.5, 0.08, -0.13], [x, -0.02, -0.14], [x * 1.2, len, -0.13]], [0.02, 0.034, 0.03, 0], 0.024, true);
    },
  },
  m_topknot: {
    cap: SIDES,
    pate: true,
    build: (k) => {
      knot(k, 0.255, -0.02, 0.04);
      for (let i = 0; i < 6; i++) k.lock([k.onHead(-0.6 + i * 0.24, 0.17, 0.02), k.onHead(-0.3 + i * 0.12, 0.225, 0.034), [(i - 3) * 0.008, 0.245, -0.022]], [0.018, 0.018, 0.008], 0.012);
    },
  },
  m_receding: { cap: RECEDE },
  m_horseshoe: { cap: SIDES, pate: true },
};
