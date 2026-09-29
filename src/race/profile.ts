import type { Parts as DamageParts } from '../poc3d/district/crash';
import type { CarType } from '../poc3d/models/vehicles';
import { model, type Parts } from './catalog';
import type { Medal } from './trial';

/**
 * Your racing life, kept in the browser (localStorage `citypop.race.v1.profile`): your yen, the cars you own
 * (each with its paint, parts, livery and neon), and which one you're driving. What races pay is here too.
 * Pure except load/save, so the tests drive it.
 */

export interface Livery {
  /** Twin racing stripes over the bonnet, roof and boot; a stripe along each side; a door number; a windscreen banner. */
  readonly stripes: number | null;
  readonly side: number | null;
  readonly number: number | null;
  readonly banner: string | null;
}

export interface OwnedCar {
  readonly id: string;
  readonly type: CarType;
  paint: number;
  /** The lower colour of a two-tone body (the hatchback). */
  paint2: number | null;
  parts: Parts;
  livery: Livery;
  /** Neon underglow: fitted or not, and its colour. */
  neon: number | null;
  neonFitted: boolean;
  /** Its condition after crashes in the city: 0 like new to 100 totalled (district/crash.ts). */
  damage?: number;
  /** The damage by part (front, rear, sides, tyres: 0 to 100 each). */
  sections?: DamageParts;
}

export interface Profile {
  readonly v: 1;
  yen: number;
  cars: OwnedCar[];
  current: string;
  /** Lifetime earnings, for the garage's line. */
  earned: number;
}

const KEY = 'citypop.race.v1.profile';
export const START_YEN = 60000;

export const NO_LIVERY: Livery = { stripes: null, side: null, number: null, banner: null };

export function newCar(type: CarType, id: string): OwnedCar {
  const m = model(type);
  return { id, type, paint: m.paint, paint2: m.paint2 ?? null, parts: {}, livery: { ...NO_LIVERY }, neon: null, neonFitted: false };
}

/** A new profile: the hatchback in white over black, and a little money. */
export function freshProfile(): Profile {
  return { v: 1, yen: START_YEN, cars: [newCar('hatch', 'car1')], current: 'car1', earned: 0 };
}

/**
 * DEBUG: while this is on, your wallet is topped up to RICH every time the profile loads (every page, every
 * taxi fare), so money never runs out. Turn it off (false) for the real economy.
 */
export const DEBUG_RICH = true;
const RICH = 99_999_999;

export function loadProfile(): Profile {
  const rich = (p: Profile): Profile => {
    if (DEBUG_RICH) p.yen = Math.max(p.yen, RICH);
    return p;
  };
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const p = JSON.parse(s) as Profile;
      if (p.v === 1 && Array.isArray(p.cars) && p.cars.length && typeof p.yen === 'number') {
        if (!p.cars.some((c) => c.id === p.current)) p.current = p.cars[0].id;
        return rich(p);
      }
    }
  } catch {
    /* storage blocked or corrupt: start afresh */
  }
  return rich(freshProfile());
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: this session only */
  }
}

export const currentCar = (p: Profile): OwnedCar => p.cars.find((c) => c.id === p.current) ?? p.cars[0];

/** Spend yen if there's enough; true if it was spent. */
export function spend(p: Profile, yen: number): boolean {
  if (p.yen < yen) return false;
  p.yen -= yen;
  return true;
}

export function earn(p: Profile, yen: number): void {
  p.yen += yen;
  p.earned += yen;
}

/** Buy a model: a new car in the garage (and you're driving it). */
export function buyCar(p: Profile, type: CarType): OwnedCar | null {
  if (!spend(p, model(type).price)) return null;
  let n = p.cars.length + 1;
  while (p.cars.some((c) => c.id === `car${n}`)) n++;
  const c = newCar(type, `car${n}`);
  p.cars.push(c);
  p.current = c.id;
  return c;
}

/** What things pay (yen). */
export const PAY = {
  medal: { gold: 30000, silver: 18000, bronze: 10000 } as Record<Medal, number>,
  finish: 3000,
  newBest: 5000,
  battle: { gun: 45000, paint: 30000 },
  battleLoss: 3000,
  /** Per drift point, when a chain is banked. */
  drift: 20,
} as const;

export const trialPay = (medal: Medal | null, newBest: boolean): number => (medal ? PAY.medal[medal] : PAY.finish) + (newBest ? PAY.newBest : 0);

export const yen = (n: number): string => `¥${Math.round(n).toLocaleString('en-US')}`;
