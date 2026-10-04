import type { Footwear, Surface } from '../district/footing';

/**
 * Footsteps, synthesized as samples (pure: no WebAudio, so they can be measured, tested and written out as
 * files; real/audio.ts renders a few of each and plays them back). A step is modelled on what makes the sound,
 * and what tells one material from another is mostly how it's damped:
 *
 * - the **strike**: a shoe and a pavement are both dead things, so a heel on concrete is a burst of noise with a
 *   shape, not a note: each `Band` of it comes on at once and dies in milliseconds, the top faster than the
 *   bottom. How fast it comes on is how hard the two things are (a leather heel at once, a rubber sole a little
 *   slower, the pad of a bare foot slower still), and a soft surface slows it further and takes its top off
 *   (`bright`). The heel lands first and the sole a moment after (walking; running they nearly land together,
 *   the forefoot the harder).
 * - what **rings**: only floors that do. Boards knock (low resonances lasting tens of milliseconds), a
 *   vehicle's steel floor thunks, tile ticks; those are `modes`, struck by the same contact.
 * - the **weight**: a dull thud under it, more on anything that gives (boards, earth, carpet).
 * - the **roll**: the sole scuffing as the weight comes over it and again as the toe pushes off; barefoot, the
 *   slap of skin on a smooth floor and the faint peel of it coming away.
 * - **loose ground** under the whole stance: grit, stones, blades, straw and snow give way as the heel comes
 *   down, again under the sole, and once more at the push-off.
 *
 * Every render differs a little (the seed): bands, timing and grains move about, as no two steps are the same.
 */

/** A band of noise or a resonance: its frequency (Hz), the time it lasts (seconds to 1/e), and its strength. */
type Band = readonly [hz: number, tau: number, gain: number];

/** Something struck: its noise by band, how fast it comes on against a hard floor (s), and what it rings, if
 * anything does. */
interface Strike {
  readonly bands: readonly Band[];
  readonly attack: number;
  readonly modes?: readonly Band[];
  readonly level: number;
}

interface Wear {
  readonly heel: Strike;
  /** The sole (or the ball of a bare foot) coming down after the heel. */
  readonly toe: Strike;
  /** Heel to sole, walking (s). */
  readonly gap: number;
  /** How much weight is heard behind it, and how much the sole scuffs as it rolls. */
  readonly weight: number;
  readonly roll: number;
  readonly loud: number;
}

/**
 * Boots: a stacked heel and a thick rubber sole, a heavy low clomp with little top. Dress shoes: a hard heel
 * and a leather sole, a sharp clack and a lighter slap. Bare: the heel's pad and the ball of the foot, a soft
 * pat with almost nothing above a few hundred Hz (the slap of skin is the ground's: `slap`).
 */
const WEAR: Record<Footwear, Wear> = {
  boots: {
    heel: { bands: [[150, 0.02, 0.75], [340, 0.016, 1], [760, 0.011, 0.8], [1600, 0.007, 0.42], [3200, 0.0045, 0.16], [5500, 0.003, 0.05]], attack: 0.0018, level: 1 },
    toe: { bands: [[200, 0.016, 0.6], [480, 0.013, 0.9], [1100, 0.009, 0.6], [2300, 0.006, 0.25], [4200, 0.004, 0.08]], attack: 0.004, level: 0.55 },
    gap: 0.11,
    weight: 1,
    roll: 1,
    loud: 1,
  },
  shoes: {
    heel: { bands: [[240, 0.012, 0.55], [560, 0.011, 0.9], [1250, 0.009, 1], [2600, 0.0065, 0.5], [4800, 0.004, 0.12], [7500, 0.0025, 0.03]], attack: 0.0005, level: 1 },
    toe: { bands: [[300, 0.012, 0.6], [700, 0.009, 0.9], [1500, 0.007, 0.7], [3000, 0.005, 0.3], [5500, 0.003, 0.07]], attack: 0.002, level: 0.5 },
    gap: 0.095,
    weight: 0.55,
    roll: 0.8,
    loud: 0.9,
  },
  bare: {
    heel: { bands: [[110, 0.022, 1], [240, 0.016, 0.7], [520, 0.009, 0.25], [1100, 0.006, 0.06]], attack: 0.006, level: 1 },
    toe: { bands: [[150, 0.018, 0.8], [330, 0.012, 0.7], [700, 0.008, 0.3], [1500, 0.005, 0.1]], attack: 0.004, level: 0.8 },
    gap: 0.075,
    weight: 0.45,
    roll: 0,
    loud: 0.5,
  },
};

/** A foot on the ground: when its sole comes down after the heel and when it pushes off (s; `push` under 0:
 * it doesn't, a landing), what's on it, and whether it's running. */
interface Stance {
  readonly gap: number;
  readonly push: number;
  readonly bare: boolean;
  readonly boots: boolean;
  readonly run: boolean;
}

interface Ground {
  /** How hard it is to the foot: 1 concrete; under it the strike comes on slower and loses its top. */
  readonly bright: number;
  /** How much of the shoe's own strike is heard (loose ground swallows it). */
  readonly strike: number;
  /** The weight's thud, and where it sits (Hz). */
  readonly thud: number;
  readonly thudHz: number;
  /** The sole's scuff as it rolls and pushes off, and its pitch. */
  readonly roll: number;
  readonly rollHz: number;
  /** A bare foot's slap on it and its pitch, and the peel of skin coming away from it. */
  readonly slap: number;
  readonly slapHz: number;
  readonly peel: number;
  readonly loud: number;
  /** What the ground itself does under a foot landing at `at` (s), `k` its share of the level. */
  readonly extra?: (r: Render, at: number, k: number, c: Stance) => void;
}

/** A tiled floor's glassy tick, a boarded floor's hollow knock, a vehicle's steel floor, a mat's give. */
const TILE: Strike = { bands: [], modes: [[2300, 0.0035, 1], [3700, 0.0022, 0.6]], attack: 0.0005, level: 1 };
const BOARDS: Strike = { bands: [], modes: [[130, 0.02, 0.4], [215, 0.018, 0.8], [340, 0.014, 1], [560, 0.01, 0.7], [900, 0.006, 0.4]], attack: 0.003, level: 1 };
const PLATE: Strike = { bands: [], modes: [[168, 0.03, 0.35], [392, 0.04, 0.5], [611, 0.03, 0.45], [1125, 0.02, 0.3], [1740, 0.014, 0.18]], attack: 0.0012, level: 1 };
const MAT: Strike = { bands: [[170, 0.014, 1], [340, 0.01, 0.6], [700, 0.006, 0.2]], attack: 0.006, level: 1 };

const GROUND: Record<Surface, Ground> = {
  paving: { bright: 1, strike: 1, thud: 0.08, thudHz: 90, roll: 0.07, rollHz: 1400, slap: 0.5, slapHz: 1900, peel: 0.04, loud: 1 },
  asphalt: {
    bright: 0.7, strike: 1, thud: 0.08, thudHz: 90, roll: 0.1, rollHz: 1100, slap: 0.35, slapHz: 1700, peel: 0, loud: 0.95,
    // Grit turning under the sole, and again as it pushes off.
    extra: (r, at, k, c) => {
      r.crunch(at, k * (c.bare ? 0.08 : 0.16), 9, c.gap + 0.03, 2500, 7000, 0.0008, 0.0025, 2);
      if (c.push > 0) r.crunch(at + c.push, k * (c.bare ? 0.03 : 0.07), 4, 0.05, 2500, 7000, 0.0008, 0.0025, 2);
    },
  },
  tile: {
    bright: 1.35, strike: 1, thud: 0.05, thudHz: 95, roll: 0.04, rollHz: 1800, slap: 0.55, slapHz: 2400, peel: 0.05, loud: 1.05,
    extra: (r, at, k, c) => {
      r.impact(at, k * (c.bare ? 0.05 : 0.25), TILE, 1);
      r.impact(at + c.gap, k * (c.bare ? 0.03 : 0.12), TILE, 1);
    },
  },
  wood: {
    bright: 0.8, strike: 0.8, thud: 0.1, thudHz: 80, roll: 0.05, rollHz: 1000, slap: 0.4, slapHz: 1700, peel: 0.06, loud: 1.05,
    // One board under the heel, its neighbour under the sole.
    extra: (r, at, k, c) => {
      r.impact(at, k * (c.bare ? 0.55 : 0.7), BOARDS, 1);
      r.impact(at + c.gap, k * (c.bare ? 0.3 : 0.4), BOARDS, 1, 1.12);
    },
  },
  tatami: {
    bright: 0.3, strike: 0.8, thud: 0.15, thudHz: 85, roll: 0.04, rollHz: 900, slap: 0.12, slapHz: 1200, peel: 0, loud: 0.6,
    extra: (r, at, k, c) => {
      r.impact(at, k * 0.5, MAT, 1);
      // The straw, under the heel and the sole.
      r.crunch(at, k * 0.18, 14, c.gap + 0.03, 900, 2600, 0.001, 0.003, 2);
      if (c.push > 0) r.crunch(at + c.push, k * 0.06, 5, 0.05, 900, 2600, 0.001, 0.003, 2);
    },
  },
  carpet: {
    bright: 0.16, strike: 0.9, thud: 0.3, thudHz: 85, roll: 0, rollHz: 500, slap: 0, slapHz: 1000, peel: 0, loud: 0.5,
    // The pile under the foot.
    extra: (r, at, k, c) => {
      r.scuff(at, k * 0.3, 350, 0.7, 0.008, 0.03);
      r.scuff(at + c.gap, k * 0.2, 500, 0.7, 0.008, 0.025);
    },
  },
  metal: {
    bright: 0.95, strike: 0.9, thud: 0.18, thudHz: 95, roll: 0.05, rollHz: 1500, slap: 0.35, slapHz: 2000, peel: 0.05, loud: 1,
    extra: (r, at, k, c) => {
      r.impact(at, k * (c.bare ? 0.25 : 0.4), PLATE, 1);
      r.impact(at + c.gap, k * (c.bare ? 0.12 : 0.2), PLATE, 1, 1.07);
    },
  },
  grass: {
    bright: 0.25, strike: 0.3, thud: 0.22, thudHz: 80, roll: 0, rollHz: 800, slap: 0, slapHz: 1000, peel: 0, loud: 0.7,
    extra: (r, at, k, c) => {
      // Blades pressed down under the heel and the sole, and brushing the foot as it leaves.
      r.scuff(at, k * 0.3, 1500, 0.8, 0.03, c.run ? 0.045 : 0.07);
      r.scuff(at, k * 0.45, 600, 0.6, 0.012, 0.05);
      r.crunch(at, k * 0.3, 16, c.run ? 0.09 : 0.14, 800, 2800, 0.0015, 0.005, 1.5);
      if (c.push > 0) r.scuff(at + c.push, k * 0.16, 1600, 0.8, 0.02, 0.04);
    },
  },
  gravel: {
    bright: 0.5, strike: 0.35, thud: 0.12, thudHz: 90, roll: 0, rollHz: 900, slap: 0, slapHz: 1000, peel: 0, loud: 1.1,
    extra: (r, at, k, c) => {
      // Stones shifting under the heel, again as the sole comes down and as it pushes off; lower and heavier
      // under a boot.
      const top = c.bare ? 3400 : c.boots ? 3900 : 4400;
      r.crunch(at, k * (c.bare ? 0.6 : 0.9), c.bare ? 20 : 26, c.run ? 0.07 : 0.11, 700, top, 0.0012, 0.006, 2.5);
      r.crunch(at + c.gap, k * (c.bare ? 0.35 : 0.55), 14, 0.09, 800, top, 0.0012, 0.005, 2.5);
      r.scuff(at, k * 0.4, 520, 0.8, 0.012, 0.07);
      if (c.push > 0) r.crunch(at + c.push, k * (c.bare ? 0.2 : 0.32), 10, 0.08, 800, top, 0.0012, 0.005, 2.5);
    },
  },
  earth: {
    bright: 0.35, strike: 0.6, thud: 0.3, thudHz: 85, roll: 0, rollHz: 700, slap: 0, slapHz: 1000, peel: 0, loud: 0.8,
    extra: (r, at, k, c) => {
      r.scuff(at, k * 0.5, 420, 0.6, 0.006, 0.04);
      r.scuff(at + c.gap * 0.5, k * 0.3, 800, 0.6, 0.01, 0.04);
      r.crunch(at, k * 0.2, c.bare ? 4 : 8, c.gap + 0.03, 1200, 3500, 0.001, 0.003, 2);
      if (c.push > 0) r.scuff(at + c.push, k * 0.14, 900, 0.6, 0.015, 0.03);
    },
  },
  snow: {
    bright: 0.15, strike: 0.25, thud: 0.12, thudHz: 85, roll: 0, rollHz: 700, slap: 0, slapHz: 1000, peel: 0, loud: 0.8,
    extra: (r, at, k, c) => {
      // Snow packing down: a slow dense crunch, the creak of it, and a little more as the foot leaves.
      r.crunch(at, k * 0.8, 55, c.run ? 0.15 : 0.24, 350, 1900, 0.003, 0.011, 1.5, 0.35);
      r.scuff(at, k * 0.3, 450, 0.7, 0.02, 0.08);
      r.scuff(at + 0.02, k * 0.12, 1300, 4, 0.05, 0.08);
      if (c.push > 0 && !c.run) r.crunch(at + c.push + 0.04, k * 0.2, 10, 0.07, 350, 1900, 0.003, 0.009, 1.5);
    },
  },
};

/** How long a rendered step is (seconds): the longest of them (a landing in snow, a walk's push-off) fits. */
export const STEP_SECONDS = 0.5;
/** The level a step is brought to (its energy above the deep bass, as an amplitude) before its own loudness. */
const REF = 0.04;

export interface StepRender {
  /** Running (the forefoot lands hard on the heel's heels) or walking. */
  readonly run: boolean;
  /** A landing from a jump: both feet, a moment apart, heavier. */
  readonly land: boolean;
  /** Which of the endless slightly different steps this is. */
  readonly seed: number;
  readonly sampleRate: number;
}

/** One footstep on a surface in a kind of footwear, as samples (mono, within -1..1). */
export function renderStep(surface: Surface, footwear: Footwear, o: StepRender): Float32Array {
  const r = new Render(o.sampleRate, STEP_SECONDS, rngOf(o.seed));
  const W = WEAR[footwear];
  const S = GROUND[surface];
  const bare = footwear === 'bare';
  const jit = (v: number, spread: number): number => v * (1 + (r.rnd() - 0.5) * spread);
  for (const [at, k] of o.land ? [[0.004, 1], [0.042, 0.8]] : [[0.004, 1]]) {
    const gap = o.land ? 0.012 : o.run ? jit(0.03, 0.3) : jit(W.gap, 0.25);
    const push = o.land ? -1 : o.run ? jit(0.13, 0.2) : jit(0.27, 0.15);
    r.thud(at, k * S.thud * W.weight * (o.land ? 1.8 : 1), jit(S.thudHz, 0.12), 0.018);
    r.impact(at, k * S.strike * (o.run ? 0.75 : 1), W.heel, S.bright);
    r.impact(at + gap, k * S.strike * (o.run ? 1.1 : 1), W.toe, S.bright);
    if (W.roll > 0 && S.roll > 0 && !o.land) {
      r.scuff(at + gap * 0.25, k * S.roll * W.roll, jit(S.rollHz, 0.2), 0.6, gap * 0.4 + 0.006, 0.02 + gap * 0.25);
      r.scuff(at + push, k * S.roll * W.roll * 0.5, jit(S.rollHz * 1.2, 0.2), 0.7, 0.02, 0.03);
    }
    if (bare && S.slap > 0) r.scuff(at + gap + 0.004, k * S.slap, jit(S.slapHz, 0.15), 1, 0.0015, 0.012);
    if (bare && S.peel > 0 && push > 0) r.scuff(at + push, k * S.peel, jit(3000, 0.2), 1.5, 0.008, 0.012);
    S.extra?.(r, at, k, { gap, push, bare, boots: footwear === 'boots', run: o.run });
  }
  return r.finish(S.loud * W.loud * (o.land ? 1.35 : o.run ? 1.12 : 1));
}

export interface SplashRender {
  /** How deep the water is under the foot: 0 only wet ground (a film squeezed out from under the sole), up to 1
   * the middle of a puddle. */
  readonly depth: number;
  readonly run: boolean;
  readonly seed: number;
  readonly sampleRate: number;
}

/**
 * A foot coming down in water, to go with the step under it. On wet ground that's a thin tsk and a drop or two.
 * In a puddle: the plunge, the slosh of the water it shoves aside, the spray thrown up (more of it, and longer,
 * the deeper and the faster), then the drops falling back, each a little rising plip, and a patter of fine ones.
 */
export function renderSplash(o: SplashRender): Float32Array {
  const r = new Render(o.sampleRate, STEP_SECONDS, rngOf(o.seed));
  const jit = (v: number, spread: number): number => v * (1 + (r.rnd() - 0.5) * spread);
  const at = 0.004;
  const d = Math.max(0, Math.min(1, o.depth));
  if (d <= 0) {
    r.scuff(at + 0.004, 0.5, jit(2800, 0.2), 0.8, 0.004, 0.018);
    r.scuff(at + 0.01, 0.4, jit(1200, 0.2), 0.8, 0.006, 0.02);
    r.crunch(at + 0.02, 0.12, 3, 0.08, 2000, 4500, 0.0008, 0.002, 3);
    return r.finish(0.3);
  }
  const hard = o.run ? 1.25 : 1;
  r.thud(at, 0.3 * d, jit(110, 0.15), 0.02);
  r.scuff(at, 0.9, jit(600, 0.2), 0.7, 0.006, 0.04 + 0.04 * d);
  r.scuff(at + 0.006, 0.6 * hard, jit(1700, 0.2), 0.7, 0.012, 0.05 + 0.05 * d);
  r.scuff(at + 0.01, 0.2 * hard, jit(3800, 0.2), 0.8, 0.015, 0.04 + 0.04 * d);
  const drops = Math.round((4 + 10 * d) * hard);
  for (let i = 0; i < drops; i++) r.plip(at + 0.05 + r.rnd() * (0.15 + 0.2 * d), 0.12 * (0.4 + 0.6 * r.rnd()), 900 + 2300 * r.rnd());
  r.crunch(at + 0.04, 0.18, Math.round(10 + 20 * d), 0.2 + 0.15 * d, 1500, 4500, 0.0008, 0.0025, 2.5, 0);
  return r.finish((0.55 + 0.5 * d) * hard);
}

/** A small seeded generator (mulberry32). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A second-order filter over samples, in place (the usual cookbook forms; the band-pass peaks at 1). */
function biquad(x: Float32Array, type: 'lowpass' | 'highpass' | 'bandpass', hz: number, q: number, sr: number): void {
  const w = (2 * Math.PI * Math.min(hz, sr * 0.45)) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const [b0, b1, b2] = type === 'lowpass' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : type === 'highpass' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [alpha, 0, -alpha];
  const [c0, c1, c2, d1, d2] = [b0 / a0, b1 / a0, b2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = c0 * v + c1 * x1 + c2 * x2 - d1 * y1 - d2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/** What a resonance does with a push: rings at `hz`, dying away over `tau` seconds. */
function resonate(x: Float32Array, hz: number, tau: number, sr: number): Float32Array {
  const y = new Float32Array(x.length);
  const rr = Math.exp(-1 / (tau * sr));
  const c1 = 2 * rr * Math.cos((2 * Math.PI * Math.min(hz, sr * 0.45)) / sr);
  const c2 = rr * rr;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] + c1 * y1 - c2 * y2;
    // (Less what it was two samples back: nothing at standstill, so the push itself doesn't come through as a thump.)
    y[i] = v - y2;
    y2 = y1;
    y1 = v;
  }
  return y;
}

/** A step being built: layers added into one buffer. */
class Render {
  readonly out: Float32Array;

  constructor(
    readonly sr: number,
    seconds: number,
    readonly rnd: () => number,
  ) {
    this.out = new Float32Array(Math.ceil(sr * seconds));
  }

  /** A scratch buffer for a layer starting at `at` and lasting `seconds` (cut at the end of the step). */
  private scratch(at: number, seconds: number): { i0: number; buf: Float32Array } {
    const i0 = Math.max(0, Math.round(at * this.sr));
    return { i0, buf: new Float32Array(Math.max(0, Math.min(this.out.length - i0, Math.ceil(seconds * this.sr)))) };
  }

  /** Adds a layer at its own peak times `level`. */
  private add(i0: number, buf: Float32Array, level: number): void {
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    if (peak <= 0 || level <= 0) return;
    const k = level / peak;
    for (let i = 0; i < buf.length; i++) this.out[i0 + i] += buf[i] * k;
  }

  /**
   * Something struck. Its noise comes on over the strike's attack and each band of it dies away in its own
   * time; what it rings (if anything) is struck by the same contact. `bright` is how hard the ground is to it
   * (softer: it comes on slower and the upper bands are weaker); `tune` shifts it all (another board).
   */
  impact(at: number, level: number, s: Strike, bright: number, tune = 1): void {
    if (level <= 0) return;
    const attack = s.attack / Math.max(0.25, Math.min(1.4, bright));
    // Above a few hundred Hz a soft surface takes more and more off (a hard one adds a little).
    const top = (hz: number): number => {
      const octaves = Math.max(0, Math.log2(hz / 350));
      return Math.pow(bright, bright < 1 ? octaves : octaves * 0.5);
    };
    for (const [hz, tau, gain] of s.bands) {
      const g = gain * top(hz * tune);
      if (g < 0.01) continue;
      const len = tau * (0.85 + this.rnd() * 0.3);
      const { i0, buf } = this.scratch(at, attack + len * 7);
      for (let i = 0; i < buf.length; i++) buf[i] = this.rnd() * 2 - 1;
      biquad(buf, 'bandpass', hz * tune * (1 + (this.rnd() - 0.5) * 0.1), 1.1, this.sr);
      const na = Math.max(1, attack * this.sr);
      for (let i = 0; i < buf.length; i++) buf[i] *= i < na ? i / na : Math.exp(-(i - na) / (len * this.sr));
      this.add(i0, buf, level * s.level * g);
    }
    if (!s.modes?.length) return;
    // The contact itself: a smooth push, a little rough.
    const longest = Math.max(...s.modes.map((m) => m[1]));
    const { i0, buf: e } = this.scratch(at, attack * 4 + longest * 7 + 0.005);
    const nc = Math.max(2, Math.round(attack * this.sr));
    for (let i = 0; i < Math.min(e.length, nc * 4); i++) {
      const push = i < nc ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nc) : 0;
      e[i] = push * 0.75 + (this.rnd() * 2 - 1) * Math.exp(-i / nc) * 0.25;
    }
    for (const [hz, tau, gain] of s.modes) {
      const g = gain * top(hz * tune);
      if (g < 0.01) continue;
      this.add(i0, resonate(e, hz * tune * (1 + (this.rnd() - 0.5) * 0.06), tau * (0.85 + this.rnd() * 0.3), this.sr), level * s.level * g);
    }
  }

  /** The weight behind a step: a soft push ringing something low and dead. */
  thud(at: number, level: number, hz: number, tau: number): void {
    if (level <= 0) return;
    const { i0, buf: e } = this.scratch(at, 0.012 + tau * 7);
    const n = Math.round(0.008 * this.sr);
    for (let i = 0; i < Math.min(e.length, n); i++) e[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    this.add(i0, resonate(e, hz, tau, this.sr), level);
  }

  /** A drop landing in water: a short note that rises as it dies. */
  plip(at: number, level: number, hz: number): void {
    const { i0, buf } = this.scratch(at, 0.03);
    for (let i = 0; i < buf.length; i++) {
      const t = i / this.sr;
      buf[i] = Math.sin(2 * Math.PI * hz * (1 + 12 * t) * t) * Math.exp(-t / 0.005) * Math.min(1, i / 8);
    }
    this.add(i0, buf, level);
  }

  /** A scuff or a brush: noise in a band, rising over `attack` seconds and dying away over `len`. */
  scuff(at: number, level: number, hz: number, q: number, attack: number, len: number): void {
    if (level <= 0) return;
    const { i0, buf } = this.scratch(at, attack + len * 6);
    for (let i = 0; i < buf.length; i++) buf[i] = this.rnd() * 2 - 1;
    biquad(buf, 'bandpass', hz, q, this.sr);
    const na = Math.max(1, attack * this.sr);
    for (let i = 0; i < buf.length; i++) buf[i] *= i < na ? i / na : Math.exp(-(i - na) / (len * this.sr));
    this.add(i0, buf, level);
  }

  /**
   * Many small things giving way over `over` seconds (grit, stones, blades, snow): `n` grains, each a tick of
   * noise in its own band between `hz0` and `hz1`, lasting `g0`..`g1` seconds. `early` over 0 crowds them toward
   * the start (the weight coming on).
   */
  crunch(at: number, level: number, n: number, over: number, hz0: number, hz1: number, g0: number, g1: number, q: number, early = 0.6): void {
    if (level <= 0) return;
    const { i0, buf } = this.scratch(at, over + g1 * 7);
    for (let j = 0; j < n; j++) {
      const t = over * Math.pow(this.rnd(), 1 + early);
      const len = g0 + (g1 - g0) * this.rnd();
      const m = Math.ceil(len * 6 * this.sr);
      const grain = new Float32Array(m);
      for (let i = 0; i < m; i++) grain[i] = (this.rnd() * 2 - 1) * Math.exp(-i / (len * this.sr));
      biquad(grain, 'bandpass', hz0 * Math.pow(hz1 / hz0, this.rnd()), q, this.sr);
      const amp = (0.35 + 0.65 * this.rnd()) ** 2;
      const j0 = Math.round(t * this.sr);
      for (let i = 0; i < m && j0 + i < buf.length; i++) buf[j0 + i] += grain[i] * amp;
    }
    this.add(i0, buf, level);
  }

  /** The finished step: the rumble under hearing taken off, brought to its loudness, kept inside -1..1. */
  finish(loud: number): Float32Array {
    const out = this.out;
    biquad(out, 'highpass', 35, 0.7, this.sr);
    // Its level is its energy where it's heard (above the deep bass), so a thud and a crunch come out as loud.
    const heard = out.slice();
    biquad(heard, 'highpass', 120, 0.7, this.sr);
    let energy = 0;
    for (let i = 0; i < heard.length; i++) energy += heard[i] * heard[i];
    let k = energy > 0 ? (loud * REF) / Math.sqrt(energy / this.sr) : 0;
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak * k > 0.95) k = 0.95 / peak;
    const fade = Math.round(0.004 * this.sr);
    for (let i = 0; i < out.length; i++) out[i] *= k * Math.min(1, (out.length - 1 - i) / fade);
    return out;
  }
}

export interface StepStats {
  readonly peak: number;
  /** Seconds until it has died away 40 dB under its peak. */
  readonly seconds: number;
  /** Where its energy sits: the spectrum's centre (Hz), and the shares under 250 Hz, to 1 kHz, to 4 kHz, above. */
  readonly centroid: number;
  readonly bands: readonly [number, number, number, number];
}

/** A rendered step's measurements (for the tests and scripts/stepSounds.mjs). */
export function stepStats(x: Float32Array, sr: number): StepStats {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  let last = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak * 0.01) last = i;
  // The power spectrum, by a plain radix-2 transform of the whole step.
  let n = 1;
  while (n < x.length) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len *= 2) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k);
        const s = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  let total = 0;
  let weighted = 0;
  const bands: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 1; k < n / 2; k++) {
    const hz = (k * sr) / n;
    const p = re[k] * re[k] + im[k] * im[k];
    total += p;
    weighted += p * hz;
    bands[hz < 250 ? 0 : hz < 1000 ? 1 : hz < 4000 ? 2 : 3] += p;
  }
  return { peak, seconds: last / sr, centroid: total > 0 ? weighted / total : 0, bands: bands.map((b) => (total > 0 ? b / total : 0)) as [number, number, number, number] };
}
