/**
 * Inside a commuter car (real/trainCar.ts builds it from the same numbers): what you can walk on and into, where
 * the seats are and where people would stand, in the car's own frame: x across (+x the car's left), z along (+z
 * its front), y up from the rail top. Pure, so the riding (real/cabinRider.ts) and the tests share it.
 *
 * A car has four doors a side, long benches between them (and short ones at the ends), poles, and at each end
 * a gangway to the next car or the driver's cab behind a partition. Elevated and subway cars are the same car.
 */

export const CAR = {
  /** Length, half-length, half-width (outside), gap between cars. */
  L: 18,
  H: 9,
  W: 1.45,
  GAP: 0.4,
  /** Floor, window sill and head, door head, ceiling and roof, above the rail top. */
  FLOOR: 0.9,
  SILL: 1.72,
  HEAD: 2.82,
  DOOR_TOP: 2.78,
  CEIL: 3.22,
  TOP: 3.5,
  /** The inside face of the walls (the lining). */
  INNER: 1.38,
  /** Door centres along the car (the same each side), and a door's half-width. */
  DOORS: [-6.9, -2.3, 2.3, 6.9] as readonly number[],
  DOOR_HALF: 0.65,
  /** Clear floor either side of a door (no bench). */
  VESTIBULE: 0.85,
  /** The seat cushion's front edge, its height and the backrest. */
  SEAT_X: 0.98,
  SEAT_Y: 0.44,
  BACK_X: 1.3,
  /** A seat's width on a bench. */
  SEAT_W: 0.46,
  /** Gangway half-width (the opening to the next car). */
  GANG_HALF: 0.45,
  /** Depth of a driver's cab, from the car's end to its partition. */
  CAB: 1.7,
} as const;

export type CarEnd = 'gangway' | 'cab';
export interface CarEnds {
  readonly back: CarEnd;
  readonly front: CarEnd;
}

/** A bench: one side (+1 left, -1 right) from z0 to z1, priority seats or not. */
export interface Bench {
  readonly side: 1 | -1;
  readonly z0: number;
  readonly z1: number;
  readonly priority: boolean;
}

/** A seat: where you sit (the cushion's middle) and which way you face (a unit x: across the car). */
export interface Seat {
  readonly x: number;
  readonly z: number;
  readonly side: 1 | -1;
  readonly priority: boolean;
}

/** Where the benches are. A cab end has no end bench (the wheelchair space is there); one gangway end, on the right, either. */
export function carBenches(ends: CarEnds): Bench[] {
  const { H, DOORS, VESTIBULE } = CAR;
  const out: Bench[] = [];
  for (const side of [1, -1] as const) {
    // Between the doors.
    for (let i = 0; i + 1 < DOORS.length; i++) out.push({ side, z0: DOORS[i] + VESTIBULE, z1: DOORS[i + 1] - VESTIBULE, priority: false });
    // The ends: short priority benches by a gangway; none by a cab (its partition is too close), and the right
    // side's back end is the free space for wheelchairs and buggies.
    const back0 = -H + 0.25;
    const back1 = DOORS[0] - VESTIBULE;
    const front0 = DOORS[DOORS.length - 1] + VESTIBULE;
    const front1 = H - 0.25;
    if (ends.back === 'gangway' && !(side === -1)) out.push({ side, z0: back0, z1: back1, priority: true });
    if (ends.front === 'gangway') out.push({ side, z0: front0, z1: front1, priority: true });
  }
  return out;
}

/** Every seat: benches divided into seats of about SEAT_W. */
export function carSeats(ends: CarEnds): Seat[] {
  const out: Seat[] = [];
  for (const b of carBenches(ends)) {
    const n = Math.max(1, Math.round((b.z1 - b.z0) / CAR.SEAT_W));
    const w = (b.z1 - b.z0) / n;
    for (let i = 0; i < n; i++) out.push({ x: b.side * (CAR.SEAT_X + 0.18), z: b.z0 + w * (i + 0.5), side: b.side, priority: b.priority });
  }
  return out;
}

/** Poles: the stanchion in the middle of each long bench, and at the bench ends by the doors. */
export function carPoles(ends: CarEnds): [number, number][] {
  const out: [number, number][] = [];
  for (const b of carBenches(ends)) {
    if (!b.priority) out.push([b.side * (CAR.SEAT_X - 0.03), (b.z0 + b.z1) / 2]);
  }
  return out;
}

/** Where people would stand: the door vestibules and down the aisle (for passengers, later). */
export function carStanding(ends: CarEnds): [number, number][] {
  const out: [number, number][] = [];
  for (const d of CAR.DOORS) for (const x of [-0.65, 0.65]) for (const dz of [-0.45, 0.45]) out.push([x, d + dz]);
  const lo = ends.back === 'cab' ? -CAR.H + CAR.CAB + 0.6 : -CAR.H + 0.6;
  const hi = ends.front === 'cab' ? CAR.H - CAR.CAB - 0.6 : CAR.H - 0.6;
  for (let z = lo; z <= hi; z += 1.1) if (!CAR.DOORS.some((d) => Math.abs(z - d) < 0.9)) out.push([0, z]);
  return out;
}

/** The ends of the walkable floor along the car: the cab partitions, or past the end into the gangway. */
function zLimits(ends: CarEnds): [number, number] {
  const back = ends.back === 'cab' ? -CAR.H + CAR.CAB + 0.05 : -CAR.H - CAR.GAP / 2 - 0.5;
  const front = ends.front === 'cab' ? CAR.H - CAR.CAB - 0.05 : CAR.H + CAR.GAP / 2 + 0.5;
  return [back, front];
}

/**
 * Is a walker of radius r at (x, z) blocked? doors: the side whose doors are open (+1 left, -1 right, 0 none);
 * the walker may step out through an open door (and is free beyond the wall there).
 */
export function carBlocked(x: number, z: number, r: number, ends: CarEnds, doors: number): boolean {
  const { H, INNER, DOORS, DOOR_HALF, GANG_HALF } = CAR;
  // Out through an open door.
  const atDoor = doors !== 0 && Math.sign(x) === doors && DOORS.some((d) => Math.abs(z - d) <= DOOR_HALF - r + 0.02);
  if (Math.abs(x) > INNER - r && !atDoor) return true;
  if (atDoor && Math.abs(x) > INNER - r) return false;
  // The ends: a cab's partition, or the end wall with its gangway.
  const [lo, hi] = zLimits(ends);
  if (z < lo + r || z > hi - r) return true;
  const endWall = H - 0.12;
  if (Math.abs(z) > endWall - r && Math.abs(x) > GANG_HALF - r + 0.02) {
    const end = z > 0 ? ends.front : ends.back;
    if (end === 'gangway') return true;
  }
  // Benches (the cushion's front edge out to the wall).
  for (const b of carBenches(ends)) {
    if (b.side * x > CAR.SEAT_X - r && z > b.z0 - r && z < b.z1 + r) return true;
  }
  // Poles.
  for (const [px, pz] of carPoles(ends)) if (Math.hypot(x - px, z - pz) < r + 0.025) return true;
  // The bench-end partitions by the doors stand out a little from the benches.
  for (const b of carBenches(ends)) {
    for (const ez of [b.z0, b.z1]) if (b.side * x > CAR.SEAT_X - 0.08 - r && Math.abs(z - ez) < 0.03 + r) return true;
  }
  return false;
}

/** Where a walker has gone: on into the next car (past a gangway), out a door, or still inside. */
export function carExit(x: number, z: number, ends: CarEnds, doors: number): 'front' | 'back' | 'door' | null {
  const { H, GAP, INNER } = CAR;
  if (ends.front === 'gangway' && z > H + GAP / 2) return 'front';
  if (ends.back === 'gangway' && z < -H - GAP / 2) return 'back';
  if (doors !== 0 && Math.sign(x) === doors && Math.abs(x) > INNER + 0.45) return 'door';
  return null;
}

/** The seat nearest (x, z) within reach, if any. */
export function seatNear(x: number, z: number, ends: CarEnds, reach = 1.0): Seat | null {
  let best: Seat | null = null;
  let bd = reach;
  for (const s of carSeats(ends)) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}
