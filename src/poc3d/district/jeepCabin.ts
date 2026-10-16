import type { CabinLayout, SeatAt } from './cabin';

/**
 * Inside a jeepney (models/vehicles.ts builds the body from the same numbers: `addVehicle`'s jeepney block, in the
 * model's frame shifted back by half its length, so x across (+x its left, the kerb side), z along (+z the front),
 * y up from the road). Behind the cab the covered body is two long benches facing each other down the sides, a
 * narrow aisle between them, an open back with a step, and a grab rail up each rear post. The canopy is low (2 m
 * over a floor at 0.62), so nobody stands up in it: walking about is a stoop (the layout's floor is lowered so the
 * eye, 1.7 m over it, stays under the canopy), and you ride sitting on a bench. Boarding and getting off are at
 * the back. Pure.
 */

export const JEEP = {
  L: 6.9,
  /** The body's floor, bench cushion and canopy (the model's heights). */
  FLOOR: 0.62,
  BENCH: 1.0,
  CANOPY: 2.0,
  /** The walking floor the rider's eye is set from: the real floor less a stoop (eye = this + 1.7 = 1.82 m). */
  STOOP: 0.12,
  /** The rear step's top (0.29 under the floor) and where it spans (z), and its half-width. */
  STEP: 0.33,
  STEP_Z: [-3.95, -3.45] as readonly [number, number],
  STEP_HALF: 0.75,
  /** The passenger body: from its open back to the cab's partition (z), and the walls' inside face. */
  BODY_Z: [-3.45, 0.5] as readonly [number, number],
  INNER: 0.95,
  /** The aisle's half-width, and where the benches run (z). */
  AISLE: 0.36,
  BENCH_Z: [-3.15, 0.25] as readonly [number, number],
  /** Seats on each bench. */
  SEATS: 7,
  /** The grab rail's posts, either side of the opening. */
  RAIL_X: 0.91,
  /** Axles (z) and the wheels' radius. */
  AXLES: [-2.0, 2.27] as readonly number[],
} as const;

/** A seat: its middle on the bench, which side (+1 the left bench, facing across to the right), its cushion. */
export interface JeepSeat {
  readonly x: number;
  readonly z: number;
  readonly side: 1 | -1;
  readonly hw: number;
  readonly hd: number;
}

/** Every seat: seven along each bench. */
export function jeepSeats(): JeepSeat[] {
  const [z0, z1] = JEEP.BENCH_Z;
  const pitch = (z1 - z0) / JEEP.SEATS;
  const out: JeepSeat[] = [];
  for (const side of [1, -1] as const) {
    for (let i = 0; i < JEEP.SEATS; i++) out.push({ x: side * 0.655, z: z0 + (i + 0.5) * pitch, side, hw: 0.295, hd: pitch / 2 });
  }
  return out;
}

/** The walking floor at z (the stooped eye's reference): the body, or the step behind it. */
export function jeepFloor(z: number): number {
  return z < JEEP.BODY_Z[0] ? JEEP.STOOP - (JEEP.FLOOR - JEEP.STEP) : JEEP.STOOP;
}

/** The jeepney's layout (district/cabin.ts CabinLayout). */
export function jeepLayout(): CabinLayout {
  const seats = jeepSeats();
  const [zb0, zb1] = JEEP.BENCH_Z;
  return {
    floor: (_x, z) => jeepFloor(z),
    blocked: (x, z, r0, doors) => {
      const r = Math.min(r0, 0.2);
      // The cab's partition at the front; the open back is a way out only while it stands at a stop.
      if (z > JEEP.BODY_Z[1] - r) return true;
      if (z < JEEP.STEP_Z[0] + r) return doors === 0;
      const limit = z < JEEP.BODY_Z[0] ? JEEP.STEP_HALF : JEEP.INNER;
      if (Math.abs(x) > limit - r) return true;
      // The grab rails' posts at the corners of the opening.
      if (z < JEEP.BODY_Z[0] + 0.1 && z > JEEP.BODY_Z[0] - 0.1 && Math.abs(x) > JEEP.RAIL_X - 0.05 - r) return true;
      // The benches (a solid box each: the seat and the wall's lining behind it).
      if (Math.abs(x) > JEEP.AISLE - r && z > zb0 - r && z < zb1 + r) return true;
      for (const st of seats) if (Math.abs(x - st.x) < st.hw + r && Math.abs(z - st.z) < st.hd + r) return true;
      return false;
    },
    exit: (x, z, doors) => (doors > 0 && z < JEEP.STEP_Z[0] + 0.05 && Math.abs(x) < JEEP.STEP_HALF ? 'door' : null),
    seatNear: (x, z, reach): SeatAt | null => {
      let best: JeepSeat | null = null;
      let bd = reach;
      for (const st of seats) {
        const d = Math.hypot(st.x - x, st.z - z);
        if (d < bd) {
          bd = d;
          best = st;
        }
      }
      if (!best) return null;
      // The left bench (+x) faces -x: the camera's yaw +pi/2 (it looks along -z at yaw 0); the right faces +x: -pi/2.
      const face = best.side > 0 ? Math.PI / 2 : -Math.PI / 2;
      const eye: [number, number, number] = [best.x - best.side * 0.04, JEEP.BENCH + 0.75, best.z];
      return { x: best.x, z: best.z, face, eye, up: [0, best.z] };
    },
  };
}
