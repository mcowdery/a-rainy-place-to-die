/**
 * Crashing your car in the city: forgiving, so you keep driving fast, but mistakes cost you.
 *
 * What's in the way is a `wall` (buildings, set pieces, the expressway's piers, ramp walls and parapets, the
 * edge of the district), a `car` (traffic, parked cars), a `pole` (lamps, poles, signals, trees, vending
 * machines), something `soft` (hedges, pots, bikes, fences, the avenues' medians) or a `person`.
 * - Walls are solid: straight into one stops you; at an angle you slide along it, keeping your speed (a
 *   scrape). People stop you too, without damage.
 * - Cars and poles stop you only when hit head-on (the nose, nearly square, at speed: `DIRECT`). Anything
 *   else, and anything soft, you plough through: a knock on the way in (damage, a cut in speed) and drag
 *   while you're in it. At a crawl you nudge through them too, so you never get wedged.
 * - Damage goes to the part that took it: the front, the rear, either side, or a tyre (a hit near a wheel).
 *   A real hit costs `impactDamage` of the speed into it (nothing under ~20 km/h; a 100 km/h head-on wrecks
 *   the front; ~140 km/h head-on totals the car); drives-through and scrapes cost a little.
 * - Effects: a damaged front loses power and smokes; a damaged tyre grips less and pulls the car its way; a
 *   flat one (100) grips far less. The car is totalled when its front (the engine) is gone, or the whole body
 *   is. The condition is kept with the car (race/profile.ts `OwnedCar.sections`); the garage repairs it.
 */

export type HitKind = 'wall' | 'car' | 'pole' | 'soft' | 'person';

/** The parts of a car that take damage: the four sides of the body and the four tyres. */
export const SECTIONS = ['front', 'rear', 'left', 'right', 'fl', 'fr', 'rl', 'rr'] as const;
export type Section = (typeof SECTIONS)[number];
export type Parts = Record<Section, number>;
export const BODY: readonly Section[] = ['front', 'rear', 'left', 'right'];
export const TYRES: readonly Section[] = ['fl', 'fr', 'rl', 'rr'];

export const newParts = (): Parts => ({ front: 0, rear: 0, left: 0, right: 0, fl: 0, fr: 0, rl: 0, rr: 0 });

/** A car's parts as kept in the profile (a car saved before parts had one number for its body: spread round it). */
export function partsOf(c: { sections?: Partial<Parts>; damage?: number }): Parts {
  const p = { ...newParts(), ...(c.sections ?? {}) };
  if (!c.sections && (c.damage ?? 0) > 0) for (const k of BODY) p[k] = Math.min(WRECKED, c.damage!);
  return p;
}

/** A part at 100 is gone. */
export const WRECKED = 100;
/** The overall condition that counts as totalled (the garage's scale). */
export const TOTALED = 100;

/** Head-on enough to stop against a car or a pole: the cosine of the angle between travel and the impact. */
export const DIRECT = 0.85;
/** Under this speed (m/s) cars and poles don't stop you: you nudge through. */
export const NUDGE = 4;

/** A real hit at `vn` m/s into it (the speed along the impact's normal). */
export const impactDamage = (vn: number): number => 0.09 * Math.max(0, vn - 5.5) ** 2;

/** Driving into something you pass through: the damage (shared by the parts it touches), the share of speed lost, the drag while inside (m/s^2). */
export function passThrough(kind: 'car' | 'pole' | 'soft', speed: number): { damage: number; cut: number; drag: number } {
  const s = Math.abs(speed);
  if (kind === 'soft') return { damage: s < 2 ? 0 : 0.3 + 0.012 * s, cut: 0.04, drag: 1.5 };
  return { damage: s < 2 ? 0 : 1.2 + 0.06 * s, cut: s < NUDGE ? 0 : 0.12, drag: s < NUDGE ? 0.5 : 3 };
}

/** A scrape along a wall for dt seconds at `speed` m/s: damage to the side scraping. */
export const scrapeDamage = (speed: number, dt: number): number => 0.06 * Math.abs(speed) * dt;

/**
 * Which parts a contact at (along, across) in the car's frame (metres from its centre: along forward, across to
 * the left) hits, as shares that sum to 1: the ends by how far along, the sides by how far across; a tyre too
 * when the contact is at a wheel. `wheels` are the wheels' along positions (rear, front) and the car's
 * half-length and half-width.
 */
export function sectionsAt(along: number, across: number, hl: number, hw: number, wheels: readonly [number, number]): Partial<Parts> {
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  const f = clamp((along - hl * 0.3) / (hl * 0.55));
  const r = clamp((-along - hl * 0.3) / (hl * 0.55));
  const s = clamp((Math.abs(across) - hw * 0.25) / (hw * 0.6));
  const side: Section = across >= 0 ? 'left' : 'right';
  let w = { front: f, rear: r, [side]: s } as Record<string, number>;
  let sum = f + r + s;
  if (sum < 1e-3) {
    w = along >= 0 ? { front: 1 } : { rear: 1 };
    sum = 1;
  }
  const out: Partial<Parts> = {};
  for (const [k, v] of Object.entries(w)) if (v > 0) out[k as Section] = v / sum;
  // A contact at a wheel (near its axle, out at the side) catches the tyre as well.
  if (Math.abs(across) > hw * 0.55) {
    const front = Math.abs(along - wheels[1]) < 0.6;
    const rear = Math.abs(along - wheels[0]) < 0.6;
    if (front || rear) out[`${front ? 'f' : 'r'}${across >= 0 ? 'l' : 'r'}` as Section] = 0.8;
  }
  return out;
}

/** Add damage `d` to the parts by their shares; returns how much the car took (for the HUD). */
export function applyDamage(p: Parts, shares: Partial<Parts>, d: number): number {
  let took = 0;
  for (const [k, v] of Object.entries(shares) as [Section, number][]) {
    const before = p[k];
    p[k] = Math.min(WRECKED, p[k] + d * v);
    took += p[k] - before;
  }
  return took;
}

/** The overall condition, 0 (like new) to 100 (totalled): the worst of the engine and the body as a whole. */
export function overall(p: Parts): number {
  const body = BODY.reduce((t, k) => t + p[k], 0) / BODY.length;
  const tyres = TYRES.reduce((t, k) => t + p[k], 0) / TYRES.length;
  if (p.front >= WRECKED || body >= 90) return TOTALED;
  return Math.min(99, body * 0.8 + tyres * 0.2);
}

export const totaled = (p: Parts): boolean => overall(p) >= TOTALED;

/** What a damaged front can still do: the share of its power (a wreck limps). */
export const powerLeft = (p: Parts): number => 1 - 0.55 * Math.max(0, Math.min(1, (p.front - 35) / 65));

/** Grip left at the front and rear axles from the tyres (a flat one grips about half). */
export function tyreGrip(p: Parts): [number, number] {
  const g = (d: number): number => 1 - 0.5 * Math.max(0, Math.min(1, (d - 30) / 70));
  return [(g(p.fl) + g(p.fr)) / 2, (g(p.rl) + g(p.rr)) / 2];
}

/** Steering pull toward the more damaged side (positive left, as the steering). */
export const tyrePull = (p: Parts): number => (((p.fl + p.rl) - (p.fr + p.rr)) / 200) * 0.18;

/** The garage's bill: bodywork and tyres by the damage, plus the tow if it was totalled. */
export function repairCost(p: Parts): number {
  const body = BODY.reduce((t, k) => t + p[k], 0);
  const tyres = TYRES.reduce((t, k) => t + p[k], 0);
  return Math.round((body * 60 + tyres * 25) / 100) * 100 + (totaled(p) ? 15000 : 0);
}

/** The soft street props (by kind): you drive through them. */
export const SOFT_PROPS: ReadonlySet<string> = new Set(['pots', 'bike', 'hedge', 'fence']);
/** Street props that are parked cars (the rest that are hard are poles). */
export const CAR_PROPS: ReadonlySet<string> = new Set(['car']);
