/**
 * Yūnagi Riverside Park's land (real/park.ts draws it): the unbuilt cells between the river and the Yūnagi headland, which
 * is open to walk and drive on like the city's own streets. Pure, so the chunk workers (the verge's rail and trees stop
 * short of it), the collision (world.ts: it is in the district, its ponds and headland are not walkable) and the page all
 * agree on where it is. Metres, world frame.
 */
export const PARK = { x0: 4864, x1: 5632, z0: 2304, z1: 2816 } as const;

/** Is (x, z) in the park, `margin` m out (a negative margin: in from its edge)? */
export const inPark = (x: number, z: number, margin = 0): boolean => x > PARK.x0 - margin && x < PARK.x1 + margin && z > PARK.z0 - margin && z < PARK.z1 + margin;

/** The park's ponds: centre and half-axes (m). */
export const PONDS = [
  { cx: 5060, cz: 2500, a: 58, b: 36 },
  { cx: 4985, cz: 2390, a: 24, b: 16 },
] as const;

/** How far out of a pond (in its own scale) the lawn still dips towards the water: walkers keep out of all of it. */
export const POND_BANK = 1.45;

/** Is a footprint of radius r at (x, z) in a pond or on its sloping bank? */
export const inPond = (x: number, z: number, r = 0): boolean => PONDS.some((p) => ((x - p.cx) / (p.a * POND_BANK + r)) ** 2 + ((z - p.cz) / (p.b * POND_BANK + r)) ** 2 < 1);
