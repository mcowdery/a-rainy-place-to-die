import { describe, expect, it } from 'vitest';
import { Car, COUPE, DRIFT_ASSISTS, FLAT, type CarSpec, type Controls, type Ground } from '../src/race/vehicle';
import { MODELS } from '../src/race/catalog';
import { BIKES } from '../src/race/bikeRide';
import { CITY_ASSISTS } from '../src/poc3d/district/ownCar';

const idle = (): Controls => ({ throttle: 0, brake: 0, steer: 0, handbrake: false });
const drive = (car: Car, s: number, c: Partial<Controls>, ground: Ground = FLAT, each?: () => void): void => {
  const ctl = { ...idle(), ...c };
  for (let t = 0; t < s; t += 1 / 60) {
    car.update(1 / 60, ctl, ground);
    each?.();
  }
};
const deg = (r: number): number => (r * 180) / Math.PI;

describe('Car handling', () => {
  it('pulls away briskly, tops out, and stops in a sensible distance', () => {
    const car = new Car();
    let t100 = 0;
    for (let t = 0; t < 20 && car.u < 100 / 3.6; t += 1 / 60) {
      car.update(1 / 60, { ...idle(), throttle: 1 });
      t100 = t;
    }
    expect(t100).toBeGreaterThan(4.5);
    expect(t100).toBeLessThan(9);
    drive(car, 40, { throttle: 1 });
    expect(car.u * 3.6).toBeGreaterThan(170);
    expect(car.u * 3.6).toBeLessThan(260);
    // 100 km/h to a stop.
    const c2 = new Car();
    c2.u = 100 / 3.6;
    // (Holding the brake after the stop reverses: measure the furthest it got.)
    let far = 0;
    drive(c2, 5, { brake: 1 }, FLAT, () => (far = Math.max(far, c2.z)));
    expect(far).toBeGreaterThan(30);
    expect(far).toBeLessThan(55);
  });

  it('turns the way you steer, and holds a corner without sliding at a sane speed', () => {
    const car = new Car();
    car.u = 15;
    let maxSlide = 0;
    drive(car, 3, { throttle: 0.3, steer: 1 }, FLAT, () => (maxSlide = Math.max(maxSlide, Math.abs(car.slide))));
    // Facing +z at the start and steering left: toward +x (east is on the left facing south), heading up.
    expect(car.h).toBeGreaterThan(1);
    expect(car.x).toBeGreaterThan(5);
    expect(deg(maxSlide)).toBeLessThan(12);
  });

  it('kicks the rear out on the handbrake, and holds the drift on the throttle without spinning', () => {
    const car = new Car();
    car.u = 20;
    drive(car, 0.5, { throttle: 0.4, steer: 1, handbrake: true });
    expect(deg(Math.abs(car.slide))).toBeGreaterThan(12);
    let worst = 0;
    let sliding = 0;
    drive(car, 5, { throttle: 0.75, steer: 0.3 }, FLAT, () => {
      worst = Math.max(worst, Math.abs(car.slide));
      if (Math.abs(car.slide) > 0.17) sliding += 1 / 60;
    });
    expect(deg(worst)).toBeLessThanOrEqual(deg(DRIFT_ASSISTS.maxSlide) + 1);
    // Still going forward (not spun round), and it stayed sideways a good while.
    expect(car.u).toBeGreaterThan(5);
    expect(sliding).toBeGreaterThan(1);
  });

  it('does not spin on full throttle out of a slow corner (traction help), but a handbrake flick lets the power hold a slide', () => {
    const plain = new Car();
    plain.u = 9;
    let slid = 0;
    drive(plain, 2.5, { throttle: 1, steer: 1 }, FLAT, () => (slid = Math.max(slid, Math.abs(plain.slide))));
    expect(deg(slid)).toBeLessThan(12);
    const flick = new Car();
    flick.u = 12;
    drive(flick, 0.35, { throttle: 1, steer: 1, handbrake: true });
    let held = 0;
    drive(flick, 2, { throttle: 1, steer: 0.4 }, FLAT, () => Math.abs(flick.slide) > 0.2 && (held += 1 / 60));
    expect(held).toBeGreaterThan(1);
  });

  it('straightens up when you let go', () => {
    const car = new Car();
    car.u = 20;
    drive(car, 0.6, { throttle: 0.5, steer: 1, handbrake: true });
    drive(car, 3.5, {});
    expect(deg(Math.abs(car.slide))).toBeLessThan(5);
    expect(Math.abs(car.r)).toBeLessThan(0.2);
  });

  it('rolls downhill on a slope, and parks without creeping on the flat', () => {
    // Downhill toward +z: the normal leans +z.
    const s = Math.sin(0.08);
    const slope: Ground = { ...FLAT, normal: () => [0, Math.cos(0.08), s] };
    const car = new Car();
    drive(car, 4, {}, slope);
    expect(car.z).toBeGreaterThan(3);
    const flat = new Car();
    drive(flat, 3, {});
    expect(Math.hypot(flat.x, flat.z)).toBeLessThan(0.01);
  });

  it('reverses from a stop on the brake key', () => {
    const car = new Car();
    drive(car, 3, { brake: 1 });
    expect(car.u).toBeLessThan(-3);
    expect(car.u).toBeGreaterThanOrEqual(-COUPE.reverse - 0.1);
    expect(car.gear).toBe(0);
  });

  it('stops at a wall with a knock', () => {
    const wall: Ground = {
      ...FLAT,
      collide: (_x, z) => (z + 2.15 > 30 ? { px: 0, pz: 30 - (z + 2.15), nx: 0, nz: -1 } : null),
    };
    const car = new Car();
    let knock = 0;
    drive(car, 6, { throttle: 1 }, wall, () => (knock = Math.max(knock, car.bump)));
    expect(car.z + 2.15).toBeLessThanOrEqual(30.01);
    expect(knock).toBeGreaterThan(5);
  });
});

/** How far the car strays (the larger side of the box round everywhere it's been) while `each` runs. */
const roam = (car: Car, s: number, c: Partial<Controls>): number => {
  let [x0, x1, z0, z1] = [car.x, car.x, car.z, car.z];
  drive(car, s, c, FLAT, () => {
    x0 = Math.min(x0, car.x);
    x1 = Math.max(x1, car.x);
    z0 = Math.min(z0, car.z);
    z1 = Math.max(z1, car.z);
  });
  return Math.max(x1 - x0, z1 - z0);
};

describe('Stunts', () => {
  const cars: [string, CarSpec][] = MODELS.map((m) => [m.name, m.spec]);

  it.each(cars)('%s: throttle against the brake is a burnout, the car held where it stands', (_n, spec) => {
    const car = new Car(spec, CITY_ASSISTS);
    let lit = 0;
    drive(car, 3, { throttle: 1, brake: 1 }, FLAT, () => (lit += car.spin > 0.9 ? 1 / 60 : 0));
    // (Both pedals have to be held a moment first: it isn't the brake coming off as the throttle goes on.)
    expect(lit).toBeGreaterThan(2.6);
    expect(car.stunt).toBe('burnout');
    expect(Math.hypot(car.x, car.z)).toBeLessThan(1);
    // The wheel over, the tail walks round the nose (which stays about where it was).
    const nose = (): [number, number] => [car.x + Math.sin(car.h) * spec.a, car.z + Math.cos(car.h) * spec.a];
    const [nx, nz] = nose();
    drive(car, 3, { throttle: 1, brake: 1, steer: 1 });
    expect(deg(car.h)).toBeGreaterThan(40);
    expect(Math.hypot(nose()[0] - nx, nose()[1] - nz)).toBeLessThan(1.5);
    // Let go, and it's an ordinary car again.
    drive(car, 2, {});
    expect(car.stunt).toBeNull();
    expect(car.spin).toBe(0);
  });

  it.each(cars.filter(([, s]) => !s.awd))('%s: out of a burnout with the wheel over it goes round and round on the spot', (_n, spec) => {
    const car = new Car(spec, CITY_ASSISTS);
    drive(car, 0.5, { throttle: 1, brake: 1, steer: 1 });
    const box = roam(car, 10, { throttle: 1, steer: 1 });
    // Two turns and more in ten seconds, in the space of a small car park.
    expect(deg(car.h)).toBeGreaterThan(720);
    expect(box).toBeLessThan(13);
    // Off the throttle it stops spinning and settles.
    drive(car, 3, {});
    expect(car.stunt).toBeNull();
    expect(Math.abs(car.r)).toBeLessThan(0.1);
  });

  it.each(cars)('%s: the handbrake held with the wheel over turns it right round', (_n, spec) => {
    for (const kmh of [50, 70, 90]) {
      const car = new Car(spec, CITY_ASSISTS);
      car.u = kmh / 3.6;
      // (Held past the turn: it's brought to rest facing back the way it came, not spun on.)
      drive(car, 1.5, { steer: 1, handbrake: true });
      drive(car, 0.6, {});
      const turned = deg(car.h);
      expect(turned).toBeGreaterThan(168);
      expect(turned).toBeLessThan(195);
      // Facing back the way it came, still rolling the way it was going (tail first), straight.
      expect(car.u).toBeLessThan(0);
      expect(Math.abs(car.r)).toBeLessThan(0.3);
      // And away: the throttle stops it and drives off the other way.
      drive(car, 3, { throttle: 1 });
      expect(car.u).toBeGreaterThan(5);
      expect(car.stunt).toBeNull();
    }
  });

  it.each(cars)('%s: a shorter pull on the handbrake is a quarter turn, and it drives on the way it then points', (_n, spec) => {
    for (const assists of [CITY_ASSISTS, DRIFT_ASSISTS]) {
      for (const kmh of [40, 60]) {
        const turns: number[] = [];
        for (const pull of [0.45, 0.55, 0.65, 0.75, 0.85, 0.95]) {
          const car = new Car(spec, assists);
          car.u = kmh / 3.6;
          drive(car, pull, { steer: 1, handbrake: true });
          drive(car, 2.5, { throttle: 1 });
          const turned = deg(car.h);
          turns.push(turned);
          // Further round the longer the pull; whatever it comes to, it's going forward again, straight, gripping.
          expect(turned).toBeGreaterThan(20);
          expect(car.u).toBeGreaterThan(1.5);
          expect(Math.abs(car.r)).toBeLessThan(0.2);
          expect(deg(Math.abs(car.slide))).toBeLessThan(6);
          expect(car.stunt).toBeNull();
          // (In town, half a second is never more than a corner; a pass's assists let the power carry it on round.)
          if (pull <= 0.55 && assists === CITY_ASSISTS) expect(turned).toBeLessThan(125);
        }
        // Somewhere in there is about a right angle.
        expect(turns.some((t) => t > 68 && t < 112)).toBe(true);
      }
    }
  });

  it.each(cars)('%s: none of it happens by accident in ordinary driving', (_n, spec) => {
    const watch = (car: Car, s: number, c: Partial<Controls>): { slide: number; stunt: number } => {
      const seen = { slide: 0, stunt: 0 };
      drive(car, s, c, FLAT, () => {
        seen.slide = Math.max(seen.slide, Math.abs(car.slide));
        if (car.stunt) seen.stunt += 1 / 60;
      });
      return seen;
    };
    // Braking to a junction, the throttle down before the brake's quite up, then away round the corner on full
    // lock and full throttle: an ordinary start and an ordinary corner.
    const a = new Car(spec, CITY_ASSISTS);
    a.u = 8;
    drive(a, 0.9, { brake: 1 });
    drive(a, 0.12, { brake: 1, throttle: 1 });
    const away = watch(a, 4, { throttle: 1, steer: 1 });
    expect(away.stunt).toBe(0);
    expect(a.u).toBeGreaterThan(8);
    // (As it is with the brake let go first: the most powerful of them step out a little on full lock, no more.)
    const b = new Car(spec, CITY_ASSISTS);
    b.u = 8;
    drive(b, 0.9, { brake: 1 });
    drive(b, 0.12, {});
    const plain = watch(b, 4, { throttle: 1, steer: 1 });
    expect(deg(away.slide)).toBeLessThan(deg(plain.slide) + 3);
    expect(deg(away.slide)).toBeLessThan(20);
    // The throttle held right through a pull of the handbrake round a corner at town speeds: a corner, not a spin.
    for (const kmh of [25, 40, 60]) {
      for (const pull of [0.25, 0.5, 0.7]) {
        const c = new Car(spec, CITY_ASSISTS);
        c.u = kmh / 3.6;
        drive(c, pull, { throttle: 1, steer: 1, handbrake: true });
        drive(c, 0.4, { throttle: 1, steer: 1 });
        drive(c, 2.6, { throttle: 1 });
        expect(deg(c.h)).toBeLessThan(140);
        expect(c.u).toBeGreaterThan(10);
        expect(c.stunt).toBeNull();
      }
    }
    // Out of a burnout and off down the road: the next corner, on the throttle, is a corner.
    const d = new Car(spec, CITY_ASSISTS);
    drive(d, 1.5, { throttle: 1, brake: 1 });
    expect(d.stunt).toBe('burnout');
    drive(d, 1, { throttle: 1 });
    expect(d.stunt).toBeNull();
    const corner = watch(d, 3, { throttle: 1, steer: 1 });
    expect(corner.stunt).toBe(0);
    expect(deg(corner.slide)).toBeLessThan(14);
    // A donut is over when the wheel's straightened, though the throttle's still down.
    const e = new Car(spec, CITY_ASSISTS);
    drive(e, 0.6, { throttle: 1, brake: 1, steer: 1 });
    drive(e, 3, { throttle: 1, steer: 1 });
    drive(e, 2.5, { throttle: 1 });
    expect(e.stunt).toBeNull();
    expect(Math.abs(e.r)).toBeLessThan(0.3);
    expect(e.u).toBeGreaterThan(8);
    // Backing out and going forward again with the wheel over (a three-point turn) is not a J-turn.
    const f = new Car(spec, CITY_ASSISTS);
    drive(f, 1.3, { brake: 1, steer: -1 });
    expect(f.u).toBeGreaterThan(-5.5);
    const three = watch(f, 3, { throttle: 1, steer: 1 });
    expect(three.stunt).toBe(0);
  });

  it('a tap of the handbrake is still only a flick (the slide stays capped)', () => {
    const car = new Car(COUPE, CITY_ASSISTS);
    car.u = 20;
    let worst = 0;
    drive(car, 0.25, { throttle: 0.4, steer: 1, handbrake: true });
    drive(car, 4, { throttle: 0.75, steer: 0.3 }, FLAT, () => (worst = Math.max(worst, Math.abs(car.slide))));
    expect(deg(worst)).toBeLessThanOrEqual(deg(CITY_ASSISTS.maxSlide) + 1);
    expect(car.u).toBeGreaterThan(5);
  });

  it.each(cars)('%s: backing up, it steers where you point it without the nose whipping round', (_n, spec) => {
    const car = new Car(spec, CITY_ASSISTS);
    drive(car, 2.5, { brake: 1 });
    let worst = 0;
    drive(car, 4, { brake: 1, steer: 1 }, FLAT, () => (worst = Math.max(worst, Math.abs(car.slide))));
    // A steady arc (steering left in reverse swings the tail left: the heading turns right), barely sliding.
    expect(deg(worst)).toBeLessThan(12);
    expect(deg(car.h)).toBeLessThan(-60);
    expect(car.u).toBeLessThan(-5);
    // Feet off, the engine slows it: a tap of reverse is a short move.
    drive(car, 4, {});
    expect(Math.abs(car.u)).toBeLessThan(2.5);
  });

  it.each(cars)('%s: backing up, the wheel over and the throttle down is a J-turn', (_n, spec) => {
    const car = new Car(spec, CITY_ASSISTS);
    drive(car, 2.6, { brake: 1 });
    const back = car.u;
    expect(back).toBeLessThan(-6);
    drive(car, 1.3, { throttle: 1, steer: 1 });
    drive(car, 1.2, { throttle: 1 });
    // Round to face the way it was going, and driving on that way (it kept going -z throughout).
    expect(Math.abs(Math.abs(deg(car.h)) - 180)).toBeLessThan(35);
    expect(car.u).toBeGreaterThan(8);
    expect(car.z).toBeLessThan(-25);
    expect(car.stunt).toBeNull();
  });

  it('a motorcycle keeps its rear brake through a bend without spinning round', () => {
    const bike = new Car(BIKES.hayate.spec, CITY_ASSISTS);
    bike.u = 18;
    let worst = 0;
    drive(bike, 2, { steer: 1, handbrake: true }, FLAT, () => (worst = Math.max(worst, Math.abs(bike.slide))));
    expect(deg(worst)).toBeLessThanOrEqual(deg(CITY_ASSISTS.maxSlide) + 1);
    expect(bike.stunt).toBeNull();
    expect(bike.u).toBeGreaterThanOrEqual(0);
  });
});
