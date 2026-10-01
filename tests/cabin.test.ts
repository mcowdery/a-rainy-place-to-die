import { describe, expect, it } from 'vitest';
import { CAR, carBenches, carBlocked, carExit, carSeats, carStanding, seatNear, type CarEnds } from '../src/poc3d/district/cabin';
import { dwellDoors, RideTimeline, START, type RideStop } from '../src/poc3d/district/rideTimeline';
import { BUS, busLayout } from '../src/poc3d/district/busCabin';

const MID: CarEnds = { back: 'gangway', front: 'gangway' };
const LEAD: CarEnds = { back: 'gangway', front: 'cab' };
const R = 0.4;

describe('a commuter car inside', () => {
  it('lets you walk the aisle end to end and through the gangways, not into the benches or walls', () => {
    for (let z = -CAR.H + 0.6; z < CAR.H - 0.6; z += 0.25) expect(carBlocked(0, z, R, MID, 0)).toBe(false);
    // The gangways go on past the ends.
    expect(carBlocked(0, CAR.H + 0.1, R, MID, 0)).toBe(false);
    expect(carExit(0, CAR.H + CAR.GAP / 2 + 0.01, MID, 0)).toBe('front');
    expect(carExit(0, -CAR.H - CAR.GAP / 2 - 0.01, MID, 0)).toBe('back');
    // Benches and walls.
    for (const b of carBenches(MID)) expect(carBlocked(b.side * 1.1, (b.z0 + b.z1) / 2, R, MID, 0)).toBe(true);
    expect(carBlocked(1.2, CAR.DOORS[1], R, MID, 0)).toBe(true);
    // Beside the gangway, at the end wall.
    expect(carBlocked(0.8, CAR.H - 0.2, R, MID, 0)).toBe(true);
  });

  it('keeps you out of the cab', () => {
    expect(carBlocked(0, CAR.H - CAR.CAB - 0.5, R, LEAD, 0)).toBe(false);
    expect(carBlocked(0, CAR.H - CAR.CAB + 0.3, R, LEAD, 0)).toBe(true);
    expect(carExit(0, CAR.H + 1, LEAD, 0)).toBe(null);
  });

  it('opens the doors on one side only, and lets you out through them', () => {
    const d = CAR.DOORS[2];
    expect(carBlocked(1.3, d, R, MID, 0)).toBe(true);
    expect(carBlocked(1.3, d, R, MID, -1)).toBe(true);
    expect(carBlocked(1.3, d, R, MID, 1)).toBe(false);
    expect(carBlocked(-1.3, d, R, MID, -1)).toBe(false);
    // Between the doors the wall stays.
    expect(carBlocked(1.3, (CAR.DOORS[1] + CAR.DOORS[2]) / 2, R, MID, 1)).toBe(true);
    let x = 0;
    while (!carBlocked(x + 0.05, d, R, MID, 1) && carExit(x, d, MID, 1) === null && x < 3) x += 0.05;
    expect(carExit(x, d, MID, 1)).toBe('door');
  });

  it('has seats to sit on, each reachable from the aisle, and places to stand', () => {
    const seats = carSeats(MID);
    expect(seats.length).toBeGreaterThan(20);
    for (const s of seats) expect(seatNear(s.side * 0.55, s.z, MID, 0.8)).not.toBe(null);
    expect(seats.some((s) => s.priority)).toBe(true);
    for (const [x, z] of carStanding(MID)) expect(carBlocked(x, z, 0.25, MID, 0)).toBe(false);
  });
});

describe('a ride timeline', () => {
  const stops: RideStop[] = [0, 400, 900].map((s, i) => ({ s, key: `st${i}`, jp: `駅${i}`, en: `St ${i}` }));
  const run = (d: number) => ({ T: d / 10, at: (t: number) => Math.min(d, t * 10) });

  it('closes the doors, stops between with the doors open, and holds at the end until you get off', () => {
    const r = new RideTimeline(stops, run, 12);
    expect(r.state().doors).toBe(1);
    const seen: string[] = [];
    let openBetween = false;
    for (let t = START; t < r.T + 5; t += 0.1) {
      for (const e of r.advance(0.1)) if (e.kind !== 'doors') seen.push(`${e.kind}:${e.stop.key}`);
      const st = r.state();
      if (st.at?.key === 'st1' && st.doors > 0.9) openBetween = true;
    }
    expect(seen).toEqual(['depart:st0', 'arrive:st1', 'depart:st1', 'arrive:st2']);
    expect(openBetween).toBe(true);
    const st = r.state();
    expect(st.arrived).toBe(true);
    expect(st.at?.key).toBe('st2');
    // It waits.
    r.advance(60);
    expect(r.state().arrived).toBe(true);
    // Off: the doors shut and it pulls away, then it's gone.
    r.alight();
    r.advance(1);
    expect(r.state().leaving).toBe(true);
    for (let i = 0; i < 40; i++) r.advance(1);
    expect(r.state().doors).toBe(0);
    expect(r.state().s).toBeGreaterThan(900 + 50);
    expect(r.state().gone).toBe(true);
  });

  it('skips to the arrival', () => {
    const r = new RideTimeline(stops, run, 12);
    r.advance(1);
    r.skip();
    r.advance(3);
    expect(r.state().arrived).toBe(true);
  });

  it('opens a dwelling train’s doors after it stops and shuts them before it goes', () => {
    expect(dwellDoors(0, 16)).toBe(0);
    expect(dwellDoors(4, 16)).toBe(1);
    expect(dwellDoors(15.9, 16)).toBe(0);
  });
});

describe('a city bus inside', () => {
  const bus = busLayout();
  it('lets you walk from the front door down the aisle to the back bench, up the steps', () => {
    // From inside the front door, past the fare box, down the aisle.
    let x = 0.72;
    let z = 4.15;
    const path: [number, number][] = [[0.6, 3.6], [0.15, 3.2], [0.0, 2.5], [0.0, 0.0], [0.0, -2.0], [0.0, -4.3]];
    for (const [tx, tz] of path) {
      for (let k = 0; k < 200 && Math.hypot(tx - x, tz - z) > 0.05; k++) {
        const d = Math.hypot(tx - x, tz - z);
        const nx = x + ((tx - x) / d) * 0.05;
        const nz = z + ((tz - z) / d) * 0.05;
        expect(bus.blocked(nx, nz, 0.4, 0), `blocked at ${nx.toFixed(2)}, ${nz.toFixed(2)}`).toBe(false);
        x = nx;
        z = nz;
      }
    }
    expect(bus.floor(0, 3)).toBeLessThan(bus.floor(0, -3));
  });

  it('lets you out of the doors only when they are open', () => {
    expect(bus.blocked(1.2, 0.3, 0.4, 0)).toBe(true);
    expect(bus.blocked(1.2, 0.3, 0.4, 1)).toBe(false);
    expect(bus.exit(BUS.W + 0.6, 0.3, 1)).toBe('door');
    expect(bus.exit(BUS.W + 0.6, 0.3, 0)).toBe(null);
    expect(bus.exit(BUS.W + 0.6, 4.2, 1)).toBe('door');
  });

  it('has a seat in reach from the aisle all the way down', () => {
    for (let z = 2.5; z > -4.8; z -= 0.5) if (!(z < 0.9 && z > -1.7)) expect(bus.seatNear(0, z, 1.0), `z ${z}`).not.toBe(null);
  });
});
