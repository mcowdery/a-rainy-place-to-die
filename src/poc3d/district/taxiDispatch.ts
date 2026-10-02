/**
 * Called taxis (配車): when you hail (H) and no cruising taxi is coming your way (taxis cruise only the streets with
 * traffic loops: real/traffic.ts `hailTaxi`), one is sent. A taxi cruising out of sight is taken off its loop, set
 * down on the road network out of view, and driven here along the GPS's driving route (gps.ts), keeping left,
 * slowing for the corners and for the traffic ahead, and pulls in at the kerb beside you. It then waits like a
 * hailed one (the same `Hail`: E gets in). Walk off and it waits until it's out of sight, then goes back to its
 * loop. The approach and the driving are pure (tests/taxiDispatch.test.ts); main.ts wires them to the traffic.
 */

/** Keep left: the lane's centre this far left of the road's centreline, and the kerb it pulls in to at the end. */
const LANE = 1.8;
const KERB = 2.4;
/** Cruising speed and the comfortable deceleration, and the sideways pull it takes corners at (m/s, m/s^2). */
const CRUISE = 11;
const BRAKE = 2.5;
const PULL = 2.2;

export type Path = readonly (readonly [number, number])[];

/** A route's polyline as cumulative distances, and its position and heading at a distance along it. */
export class Polyline {
  readonly cum: number[] = [0];
  constructor(readonly pts: Path) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }

  get length(): number {
    return this.cum[this.cum.length - 1];
  }

  /** The point at distance d, and the unit direction of the segment it's on. */
  at(d: number): { x: number; z: number; dx: number; dz: number } {
    const c = Math.max(0, Math.min(this.length, d));
    let i = 1;
    while (i < this.pts.length - 1 && this.cum[i] < c) i++;
    const [ax, az] = this.pts[i - 1];
    const [bx, bz] = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const f = (c - this.cum[i - 1]) / seg;
    return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, dx: (bx - ax) / seg, dz: (bz - az) / seg };
  }

  /** The sharpest turn (radians) within [d, d + reach]. */
  turnAhead(d: number, reach: number): number {
    const h0 = this.at(d);
    let worst = 0;
    for (let s = d + 2; s <= Math.min(this.length, d + reach); s += 2) {
      const h = this.at(s);
      worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, h0.dx * h.dx + h0.dz * h.dz))));
    }
    return worst;
  }
}

/**
 * Where a called taxi sets out from: back along its route from the kerb by you to the first point you can't see
 * (far enough off, or well behind where you're looking), so it never appears in view. `seen(x, z)`: whether the
 * point is in view. Returns the route trimmed to start there, or null if all of it is in view.
 */
export function trimToUnseen(route: Path, seen: (x: number, z: number) => boolean, min = 60): Path | null {
  const line = new Polyline(route);
  if (line.length < min) return null;
  for (let d = line.length - min; d >= 0; d -= 4) {
    const p = line.at(d);
    if (!seen(p.x, p.z)) {
      // Cut there.
      let i = 1;
      while (i < route.length - 1 && line.cum[i] <= d) i++;
      return [[p.x, p.z], ...route.slice(i)];
    }
  }
  return null;
}

/** Which side of the road you're on, seen from the taxi's last stretch: +1 its left (the kerb it pulls in to). */
export function sideOf(route: Path, x: number, z: number): number {
  const n = route.length;
  const [ax, az] = route[Math.max(0, n - 2)];
  const [bx, bz] = route[n - 1];
  const l = Math.hypot(bx - ax, bz - az) || 1;
  const dx = (bx - ax) / l;
  const dz = (bz - az) / l;
  // Left of travel: (dz, -dx).
  return Math.sign((x - bx) * dz - (z - bz) * dx) || 1;
}

/** The taxi on its way: its place, heading and speed each step, until it has pulled in. */
export class Approach {
  readonly line: Polyline;
  /** Distance along the route (the body's centre). */
  d = 0;
  v = CRUISE * 0.6;
  acc = 0;
  /** Heading (unit), eased round the corners. */
  hx: number;
  hz: number;
  curv = 0;
  arrived = false;

  constructor(route: Path) {
    this.line = new Polyline(route);
    const h = this.line.at(0);
    this.hx = h.dx;
    this.hz = h.dz;
  }

  /** Where it is now: on the lane left of the centreline, easing in to the kerb over the last 25 m. */
  pose(): { x: number; z: number; dx: number; dz: number } {
    const c = this.line.at(this.d);
    const left = this.line.length - this.d < 25 ? LANE + (KERB - LANE) * (1 - (this.line.length - this.d) / 25) : LANE;
    // (Left of its eased heading, so the offset turns smoothly round a corner of the route.)
    return { x: c.x + this.hz * left, z: c.z - this.hx * left, dx: this.hx, dz: this.hz };
  }

  /** Advance dt seconds; `gap`: metres to the nearest vehicle ahead in its way (Infinity if none). */
  step(dt: number, gap = Infinity): void {
    if (this.arrived) {
      this.v = 0;
      this.acc = 0;
      return;
    }
    const left = this.line.length - this.d;
    // The speed it wants: cruising, the corner ahead's, stopping at the kerb, and short of whatever's ahead.
    const turn = this.line.turnAhead(this.d, 30);
    const corner = turn > 0.3 ? Math.sqrt((PULL * 8) / Math.max(turn, 0.3)) : CRUISE;
    // (Rolling the last metre in at a crawl, rather than easing toward the spot forever.)
    const want = Math.min(CRUISE, corner, Math.sqrt(2 * BRAKE * Math.max(0, left)) + (left > 0.3 ? 0.6 : 0), Math.sqrt(2 * BRAKE * Math.max(0, gap - 3)));
    const a = want > this.v ? Math.min(2, (want - this.v) * 2) : Math.max(-6, (want - this.v) * 3);
    this.v = Math.max(0, this.v + a * dt);
    this.acc = a;
    this.d = Math.min(this.line.length, this.d + this.v * dt);
    // The heading follows the road a few metres ahead (eased round the corners); curvature for the wheels.
    const ahead = this.line.at(this.d + 5);
    const want2 = Math.atan2(ahead.dx, ahead.dz);
    const now = Math.atan2(this.hx, this.hz);
    const diff = Math.atan2(Math.sin(want2 - now), Math.cos(want2 - now));
    const turnBy = diff * Math.min(1, dt * 4);
    const h = now + turnBy;
    this.hx = Math.sin(h);
    this.hz = Math.cos(h);
    // (Curvature: positive turning right, the traffic's sign: a left turn raises the heading angle.)
    this.curv = this.v > 0.1 ? -turnBy / Math.max(1e-3, this.v * dt) : 0;
    if (left < 0.3) {
      this.arrived = true;
      this.v = 0;
    }
  }
}
