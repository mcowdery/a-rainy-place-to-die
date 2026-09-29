/**
 * Crashing your car in the city, forgiving: most knocks cost you speed and a little of the car, not the drive.
 *
 * What's in the way is `hard` (walls, poles, trees, parked and moving cars, vending machines, the expressway's
 * piers and ramp walls) or `soft` (hedges, potted plants, bikes, fences, the avenues' medians), or a person.
 * - Anything hard across the car's centre line (the nose, straight on) is a real hit: the car stops against it
 *   (only the speed into it: a glancing one scrapes along) and takes damage by that speed squared. Hard enough
 *   (about 80 km/h head-on) and the car is totalled.
 * - Anything hard only at a corner or along a side, and anything soft, you drive through: a knock on the way in
 *   (damage and a cut in speed), and drag while you're in it.
 * - People stop the car without damage.
 * Condition is 0 (like new) to 100 (totalled), kept with the car (race/profile.ts); the garage repairs it.
 */

export type HitKind = 'hard' | 'soft' | 'person';

/** Condition points at which the car is totalled. */
export const TOTALED = 100;

/** A real hit at `vn` m/s into it (the normal component of the speed). */
export const impactDamage = (vn: number): number => (vn < 1.5 ? 0 : 0.22 * vn * vn);

/** Driving into something you pass through: the damage, the share of speed lost, and the drag while inside. */
export function passThrough(kind: 'hard' | 'soft', speed: number): { damage: number; cut: number; drag: number } {
  const s = Math.abs(speed);
  if (s < 1) return { damage: 0, cut: 0, drag: kind === 'hard' ? 4 : 2 };
  return kind === 'hard' ? { damage: 3 + 0.3 * s, cut: 0.18, drag: 5 } : { damage: 1 + 0.08 * s, cut: 0.06, drag: 2.5 };
}

/** What a damaged car can still do: the share of its power (a wreck limps). */
export const powerLeft = (condition: number): number => 1 - 0.45 * Math.max(0, Math.min(1, (condition - 50) / 50));

/** The garage's bill: bodywork by the damage, plus the tow if it was totalled. */
export const repairCost = (condition: number): number => Math.round((Math.min(TOTALED, condition) * 250) / 100) * 100 + (condition >= TOTALED ? 15000 : 0);

/** The soft street props (by kind): you drive through them. */
export const SOFT_PROPS: ReadonlySet<string> = new Set(['pots', 'bike', 'hedge', 'fence']);
