import type { CabinLayout, SeatAt } from './cabin';

/**
 * Inside a city bus (real/busModel.ts builds it from the same numbers): a Japanese non-step bus, in its own frame
 * (x across, +x its left, the kerb side with the doors; z along, +z its front; y up from the road). The front half
 * is a low floor (you board at the front door, pay beside the driver, and get off at the middle door); two steps
 * up to the back half's rows of forward-facing pairs and the bench across the back. Pure.
 */

export const BUS = {
  L: 10.5,
  H: 5.25,
  /** Outside half-width and the walls' inside face. */
  W: 1.245,
  INNER: 1.13,
  /** Floors: the low front half, the step, the raised back half; where the steps are (z). */
  FLOOR: 0.36,
  STEP: 0.53,
  REAR: 0.7,
  STEP_Z: [-1.0, -1.6] as readonly [number, number],
  SILL: 1.12,
  HEAD: 2.38,
  CEIL: 2.62,
  TOP: 2.95,
  /** Axles (z) and the wheels' radius. */
  AXLES: [-2.65, 2.65] as readonly number[],
  WHEEL_R: 0.48,
  /** Doors on the left (kerb) side: [z0, z1]. */
  FRONT_DOOR: [3.68, 4.68] as readonly [number, number],
  MID_DOOR: [-0.22, 0.82] as readonly [number, number],
  /** The driver's place (front right) and the fare box beside it. */
  DRIVER_Z: 3.3,
  FARE: [-0.36, 0.06, 3.74, 4.06] as readonly [number, number, number, number],
  /** The windscreen's foot (no further forward). */
  DASH_Z: 4.78,
  /** The back wall's inside. */
  BACK_Z: -5.08,
  SEAT_W: 0.42,
} as const;

/** A seat: its box on the floor (for collision), the cushion's height, which way it faces, and where you stand up to. */
export interface BusSeat {
  readonly x: number;
  readonly z: number;
  /** Half-width across, half-depth along. */
  readonly hw: number;
  readonly hd: number;
  readonly cushion: number;
  /** 'fwd' faces the front; 'in' faces across (+x: toward the doors), from the right-hand wall. */
  readonly face: 'fwd' | 'in';
  readonly priority: boolean;
  /** Raised on a wheel's housing. */
  readonly high?: boolean;
}

/** The floor's height at z (the low front, the step, the raised back). */
export function busFloor(z: number): number {
  return z > BUS.STEP_Z[0] ? BUS.FLOOR : z > BUS.STEP_Z[1] ? BUS.STEP : BUS.REAR;
}

/** Every seat. */
export function busSeats(): BusSeat[] {
  const out: BusSeat[] = [];
  const s = BUS.SEAT_W / 2;
  // The front half: on the wheel housings (high), single forward seats, the fold-ups by the wheelchair space.
  out.push({ x: 0.85, z: 2.55, hw: 0.24, hd: 0.26, cushion: 0.98, face: 'fwd', priority: true, high: true });
  out.push({ x: -0.85, z: 2.55, hw: 0.24, hd: 0.26, cushion: 0.98, face: 'fwd', priority: true, high: true });
  out.push({ x: 0.85, z: 1.5, hw: 0.24, hd: 0.25, cushion: BUS.FLOOR + 0.43, face: 'fwd', priority: true });
  out.push({ x: -0.85, z: 1.6, hw: 0.24, hd: 0.25, cushion: BUS.FLOOR + 0.43, face: 'fwd', priority: true });
  for (const z of [0.0, 0.5]) out.push({ x: -0.95, z, hw: 0.18, hd: s, cushion: BUS.FLOOR + 0.45, face: 'in', priority: true });
  // The back half: forward pairs both sides, then the bench across the back.
  for (const z of [-2.0, -2.8, -3.6, -4.35]) {
    for (const x of [0.5, 0.92, -0.5, -0.92]) out.push({ x, z, hw: s - 0.01, hd: 0.25, cushion: BUS.REAR + 0.43, face: 'fwd', priority: false, high: Math.abs(z + 2.65) < 0.5 });
  }
  for (const x of [-0.9, -0.45, 0, 0.45, 0.9]) out.push({ x, z: -4.88, hw: s - 0.01, hd: 0.22, cushion: BUS.REAR + 0.43, face: 'fwd', priority: false });
  return out;
}

/** Poles (x, z): by the doors, at the step, down the front half. */
export const BUS_POLES: readonly (readonly [number, number])[] = [
  [0.98, 3.48], [-0.42, 2.95], [0.55, 2.1], [-0.55, 2.1], [0.55, 1.05], [-0.55, 1.05], [0.55, -0.35], [-0.6, -0.55], [0.33, -1.05], [-0.33, -1.05],
];

/** The bus's layout (district/cabin.ts CabinLayout). Walkers are taken a little slimmer here: the aisle is narrow. */
export function busLayout(): CabinLayout {
  const seats = busSeats();
  const blocked = (x: number, z: number, r0: number, doors: number): boolean => {
    const r = Math.min(r0, 0.22);
    const atDoor = doors > 0 && x > 0 && [BUS.FRONT_DOOR, BUS.MID_DOOR].some(([z0, z1]) => z > z0 + r - 0.02 && z < z1 - r + 0.02);
    if (Math.abs(x) > BUS.INNER - r && !atDoor) return true;
    if (atDoor && x > BUS.INNER - r) return false;
    if (z > BUS.DASH_Z - r || z < BUS.BACK_Z + r) return true;
    // The driver's place and the fare box.
    if (x < -0.3 + r && z > BUS.DRIVER_Z - r) return true;
    const [fx0, fx1, fz0, fz1] = BUS.FARE;
    if (x > fx0 - r && x < fx1 + r && z > fz0 - r && z < fz1 + r) return true;
    for (const st of seats) if (Math.abs(x - st.x) < st.hw + r && Math.abs(z - st.z) < st.hd + r) return true;
    for (const [px, pz] of BUS_POLES) if (Math.hypot(x - px, z - pz) < r + 0.025) return true;
    return false;
  };
  return {
    floor: (_x, z) => busFloor(z),
    blocked,
    exit: (x, z, doors) => (doors > 0 && x > BUS.W + 0.45 && [BUS.FRONT_DOOR, BUS.MID_DOOR].some(([z0, z1]) => z > z0 - 0.3 && z < z1 + 0.3) ? 'door' : null),
    seatNear: (x, z, reach): SeatAt | null => {
      let best: BusSeat | null = null;
      let bd = reach;
      for (const st of seats) {
        const d = Math.hypot(st.x - x, st.z - z);
        if (d < bd) {
          bd = d;
          best = st;
        }
      }
      if (!best) return null;
      const fwd = best.face === 'fwd';
      // Facing the front: the camera's yaw pi (it looks along its -z); across toward +x: -pi/2.
      const face = fwd ? Math.PI : -Math.PI / 2;
      const eye: [number, number, number] = fwd ? [best.x, best.cushion + 0.78, best.z - 0.05] : [best.x - 0.08, best.cushion + 0.78, best.z];
      const aisle: [number, number] = fwd ? [Math.abs(best.x) < 0.7 && best.z < BUS.STEP_Z[1] ? 0 : best.x > 0 ? 0.3 : -0.25, best.z] : [best.x + 0.5, best.z];
      // Rear rows: get up into the aisle; the bench: in front of it.
      if (best.z < -4.6) aisle[1] = best.z + 0.5;
      return { x: best.x, z: best.z, face, eye, up: [aisle[0], aisle[1]] };
    },
  };
}
