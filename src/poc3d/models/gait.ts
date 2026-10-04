/**
 * Mack's walk as numbers (pure): the legs' angles through a stride, and when each foot lands. The rig
 * (models/firstPerson.ts) poses the legs from `legPose`, so the footfalls here are the feet you see: the step
 * sounds and the camera's bob follow them rather than a rhythm of their own.
 */

export type Foot = 'l' | 'r';

/** Strides a second (one leg's full cycle): a base and so much more per m/s. */
export const STRIDE_HZ = [0.5, 0.21];
/** The knee bends this much of the cycle ahead of the thigh's swing (radians), so it's bent as the leg comes
 * through and straight again once it's out in front. */
export const KNEE_LEAD = 1.3;
/** The thigh's angle ahead of the hip (radians) at which the straightened leg's foot is down: it lands a little
 * ahead of the body, the leg already coming back. */
export const PLANT = 0.34;
/** Under this much of a stride the feet only shuffle: no footfalls. */
export const MIN_STRIDE = 0.35;

/** How far the thigh swings either way, and how far the knee bends coming through (`run` 0..1). */
const swingOf = (run: number): number => 0.4 + 0.22 * run;
const kneeOf = (run: number): number => 0.55 + 0.5 * run;

/** A leg at the walk's `phase`: the thigh's angle forward of the hip and the knee's bend (radians, at a full
 * stride). The right leg is half a cycle behind the left. */
export function legPose(phase: number, run: number, foot: Foot): { thigh: number; knee: number } {
  const p = foot === 'l' ? phase : phase - Math.PI;
  return { thigh: swingOf(run) * Math.sin(p), knee: 0.15 + kneeOf(run) * Math.max(0, Math.sin(p + KNEE_LEAD)) };
}

/**
 * Where in a leg's own cycle its foot lands (radians; the thigh is furthest forward at pi/2): once the knee
 * has straightened and the thigh has come back to `PLANT`. A short stride (`stride` under 1) never swings that
 * far, and lands as the knee straightens.
 */
export function strikePhase(run: number, stride = 1): number {
  const reach = swingOf(run) * stride;
  return Math.max(Math.PI - KNEE_LEAD, Math.PI - Math.asin(Math.min(1, PLANT / Math.max(reach, 1e-6))));
}

const wrap = (a: number): number => a - Math.floor(a / (2 * Math.PI)) * 2 * Math.PI;

/** How the body rides the stride: -1 as each foot lands, 1 between (times the stride). */
export function gaitBob(phase: number, run: number, stride: number): number {
  return -Math.cos(2 * (phase - strikePhase(run, stride))) * stride;
}

/** Watches the walk's phase and says which feet land: each once a cycle, after it has swung forward. */
export class Footfalls {
  private readonly swung: Record<Foot, boolean> = { l: false, r: false };

  /** The feet that landed as the walk came to `phase` (none while the stride is only a shuffle). */
  step(phase: number, run: number, stride: number): Foot[] {
    const out: Foot[] = [];
    const strike = strikePhase(run, stride);
    for (const foot of ['l', 'r'] as const) {
      const p = wrap(foot === 'l' ? phase : phase - Math.PI);
      // Swinging forward (the thigh's angle rising), then down once it's past the strike.
      if (Math.cos(p) > 0) this.swung[foot] = true;
      else if (this.swung[foot] && p >= strike) {
        this.swung[foot] = false;
        if (stride >= MIN_STRIDE) out.push(foot);
      }
    }
    return out;
  }

  /** Standing, seated or in the air: the next footfall waits for a fresh swing. */
  reset(): void {
    this.swung.l = this.swung.r = false;
  }
}
