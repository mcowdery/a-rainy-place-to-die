import type { CarType } from '../poc3d/models/vehicles';
import { COUPE, type CarSpec } from './vehicle';

/**
 * The cars you can own and race, and the parts for them. Every maker and name is invented (alternate-world
 * Japan); each car leans on a real type from the touge era. A car's handling is its base spec with its parts
 * applied (`tunedSpec`), pure, so the garage's stat bars and the race page agree.
 */

export interface SoundProfile {
  /** Redline (rpm), firing pulses per revolution (a four-cylinder 2, a six 3, a triple 1.5), and buzz 0-1. */
  readonly maxRpm: number;
  readonly fire: number;
  readonly buzz: number;
}

export interface Model {
  readonly type: CarType;
  readonly maker: string;
  readonly name: string;
  readonly year: number;
  readonly price: number;
  readonly blurb: string;
  readonly spec: CarSpec;
  readonly sound: SoundProfile;
  /** Its first paint (and the lower colour of a two-tone). */
  readonly paint: number;
  readonly paint2?: number;
}

export const MODELS: readonly Model[] = [
  {
    type: 'hatch',
    maker: 'Tōkai',
    name: 'Kestrel 86 GT',
    year: 1985,
    price: 90000,
    blurb: 'A light, skinny-tyred hatchback with a rev-happy twin-cam. Slow on paper, a legend on the pass: it goes sideways at a nudge and forgives everything.',
    spec: { ...COUPE, mass: 960, a: 1.12, b: 1.28, inertia: 0.95, power: 96000, maxDrive: 6800, brake: 0.95, drag: 0.6, rolling: 140, gripFront: 0.98, gripRear: 1.08, lock: 0.62, steerRate: 3.4, handbrakeGrip: 0.4, shift: [12, 20, 28, 37, 999] },
    sound: { maxRpm: 7600, fire: 2, buzz: 0.4 },
    paint: 0xf0f0ec,
    paint2: 0x121316,
  },
  {
    type: 'roadster',
    maker: 'Seika',
    name: 'Mame 660 Roadster',
    year: 1991,
    price: 120000,
    blurb: 'A 660 cc kei car with the engine behind your seat. Hopeless on the straights, a dart through hairpins, and it screams to 8,500 rpm.',
    spec: { ...COUPE, mass: 760, a: 1.3, b: 0.98, cgHeight: 0.42, inertia: 0.85, power: 50000, maxDrive: 5200, brake: 0.95, brakeFront: 0.58, drag: 0.48, rolling: 110, gripFront: 0.97, gripRear: 1.05, B: 10, C: 1.4, lock: 0.66, lockHalf: 24, steerRate: 3.8, shift: [10, 17, 24, 31, 999] },
    sound: { maxRpm: 8500, fire: 1.5, buzz: 0.7 },
    paint: 0xe8c020,
  },
  {
    type: 'sports',
    maker: 'Ōmi',
    name: 'Swallow Type-S',
    year: 1989,
    price: 280000,
    blurb: 'The all-rounder: a front-engined, rear-drive coupe with a turbo four. Balanced, lively, happy to hold a long drift.',
    spec: COUPE,
    sound: { maxRpm: 7300, fire: 2, buzz: 0.3 },
    paint: 0xf0f0ec,
  },
  {
    type: 'rotary',
    maker: 'Kaiun',
    name: 'Tatsumaki RS',
    year: 1993,
    price: 520000,
    blurb: 'Twin-rotor, twin-turbo, featherweight and perfectly balanced. The quickest thing through a bend, and twitchy if you lift at the wrong moment.',
    spec: { ...COUPE, mass: 1260, a: 1.2, b: 1.225, cgHeight: 0.46, inertia: 0.9, power: 190000, maxDrive: 9200, brake: 1.05, brakeFront: 0.6, drag: 0.66, rolling: 150, gripFront: 1.04, gripRear: 1.1, B: 9.5, C: 1.4, lockHalf: 28, steerRate: 3.5, shift: [14, 24, 34, 45, 999], turbo: 0.35 },
    sound: { maxRpm: 8000, fire: 2, buzz: 0.9 },
    paint: 0xe8c020,
  },
  {
    type: 'awd',
    maker: 'Ōmi',
    name: 'Raikō GT-4',
    year: 1990,
    price: 780000,
    blurb: 'A heavy twin-turbo six with all-wheel drive. Wait for the boost, then it catapults out of hairpins. It grips; it does not like to slide.',
    spec: { ...COUPE, mass: 1430, a: 1.25, b: 1.365, inertia: 1.15, power: 206000, maxDrive: 12500, brake: 1.1, brakeFront: 0.63, drag: 0.74, rolling: 170, gripFront: 1.08, gripRear: 1.1, lock: 0.58, steerRate: 3.1, handbrakeGrip: 0.5, shift: [14, 24, 35, 46, 999], awd: 0.45, turbo: 0.9 },
    sound: { maxRpm: 7500, fire: 3, buzz: 0.25 },
    paint: 0x5a5e66,
  },
];

/**
 * The cars you can own that aren't for racing (the user asked for one that fits the noir, 2026-10-05: "not a race
 * car but a normal car"): the Seika Kurofune 3000 Brougham (黒船, the black ship), the big black saloon of late
 * Showa, the kind a detective, a fixer or a boss's driver has: long, heavy and soft, a lazy straight six, light
 * slow steering. Its body is its own (`hardtop` in models/vehicles.ts: a four-door pillared hardtop, under review in
 * the showroom's Cars row; the first version borrowed the traffic's `luxury` body, and the user asked for a
 * bespoke one); for now it's
 * yours through the debug menu's car picker (district/main.ts), not yet sold in the garage.
 */
export const SALOONS: readonly Model[] = [
  {
    type: 'hardtop',
    maker: 'Seika',
    name: 'Kurofune 3000 Brougham',
    year: 1979,
    price: 160000,
    blurb: 'The black ship: five metres of late-Showa saloon with a lazy straight six and lace on the seats. It wallows, it leans, it takes a while to stop, and nobody looks twice at it parked outside a mahjong parlour at three in the morning.',
    spec: { ...COUPE, mass: 1520, a: 1.38, b: 1.42, inertia: 1.25, power: 112000, maxDrive: 6600, brake: 0.88, drag: 0.78, rolling: 190, gripFront: 0.92, gripRear: 0.97, lock: 0.6, steerRate: 2.5, handbrakeGrip: 0.45, shift: [13, 24, 36, 999, 999] },
    sound: { maxRpm: 5600, fire: 3, buzz: 0.12 },
    paint: 0x0a0a0c,
  },
];

export const model = (type: CarType): Model => [...MODELS, ...SALOONS].find((m) => m.type === type) ?? MODELS[0];

/** Tuning parts: each has levels (0 stock) with a price and what it does to the spec. */
export type PartId = 'engine' | 'turbo' | 'weight' | 'tyres' | 'suspension' | 'brakes' | 'lsd';

export interface Part {
  readonly id: PartId;
  readonly label: string;
  readonly levels: readonly string[];
  /** Price of each level (index 0: stock, free). */
  readonly price: readonly number[];
  readonly apply: (s: CarSpec, level: number) => CarSpec;
}

const scale = (arr: readonly number[], l: number): number => arr[Math.max(0, Math.min(arr.length - 1, l))];

export const PARTS: readonly Part[] = [
  { id: 'engine', label: 'Engine', levels: ['Stock', 'Street tune', 'Sports tune', 'Full race'], price: [0, 40000, 100000, 220000], apply: (s, l) => ({ ...s, power: s.power * scale([1, 1.1, 1.22, 1.38], l), maxDrive: s.maxDrive * scale([1, 1.06, 1.12, 1.2], l) }) },
  {
    id: 'turbo',
    label: 'Turbo',
    levels: ['Stock', 'Bolt-on turbo', 'Big turbo', 'Race turbo'],
    price: [0, 60000, 130000, 260000],
    // A car without one gets one (and its lag); one with a turbo gets more boost, and a little more lag.
    apply: (s, l) => (l === 0 ? s : { ...s, power: s.power * scale([1, 1.16, 1.3, 1.45], l), turbo: (s.turbo ?? 0.5) * scale([1, 1.05, 1.15, 1.3], l) }),
  },
  { id: 'weight', label: 'Weight reduction', levels: ['Stock', 'Stage 1', 'Stage 2', 'Stripped'], price: [0, 30000, 70000, 140000], apply: (s, l) => ({ ...s, mass: s.mass * scale([1, 0.95, 0.9, 0.85], l) }) },
  { id: 'tyres', label: 'Tyres', levels: ['Street', 'Sport', 'Semi-slick', 'Slick'], price: [0, 25000, 60000, 120000], apply: (s, l) => ({ ...s, gripFront: s.gripFront * scale([1, 1.04, 1.09, 1.15], l), gripRear: s.gripRear * scale([1, 1.04, 1.09, 1.15], l) }) },
  {
    id: 'suspension',
    label: 'Suspension',
    levels: ['Stock', 'Lowered springs', 'Coilovers', 'Race coilovers'],
    price: [0, 30000, 80000, 160000],
    apply: (s, l) => ({ ...s, gripFront: s.gripFront * scale([1, 1.02, 1.04, 1.06], l), gripRear: s.gripRear * scale([1, 1.02, 1.04, 1.06], l), cgHeight: s.cgHeight * scale([1, 0.95, 0.9, 0.85], l), steerRate: s.steerRate * scale([1, 1.04, 1.08, 1.12], l) }),
  },
  { id: 'brakes', label: 'Brakes', levels: ['Stock', 'Sport pads', 'Big brake kit', 'Race brakes'], price: [0, 20000, 55000, 110000], apply: (s, l) => ({ ...s, brake: s.brake * scale([1, 1.1, 1.2, 1.32], l) }) },
  { id: 'lsd', label: 'LSD', levels: ['Open', '1-way', '1.5-way', '2-way'], price: [0, 35000, 60000, 90000], apply: (s, l) => ({ ...s, lsd: scale([s.lsd ?? 0, 0.4, 0.7, 1], l) }) },
];

export type Parts = Partial<Record<PartId, number>>;

/** A model's spec with its parts fitted. */
export function tunedSpec(type: CarType, parts: Parts): CarSpec {
  let s = model(type).spec;
  for (const p of PARTS) s = p.apply(s, parts[p.id] ?? 0);
  return s;
}

/** Numbers for the garage's stat bars. */
export interface Stats {
  /** Horsepower (PS), weight (kg), top speed (km/h), grip (g), braking (g), drift (0-1: how readily it slides). */
  readonly ps: number;
  readonly kg: number;
  readonly top: number;
  readonly grip: number;
  readonly brake: number;
  readonly drift: number;
  readonly layout: string;
}

export function stats(s: CarSpec): Stats {
  // Top speed: where power meets drag and rolling resistance.
  let v = 20;
  for (let i = 0; i < 40; i++) v = Math.cbrt(Math.max(1, s.power - s.rolling * v) / s.drag);
  const grip = (s.gripFront * s.b + s.gripRear * s.a) / (s.a + s.b);
  // Drift: power to weight against rear grip, more for a light tail and an LSD, much less with AWD.
  const ptw = s.power / s.mass / 150;
  const drift = Math.max(0, Math.min(1, (ptw * 0.55 + (1.15 - s.gripRear) * 2 + (s.lsd ?? 0) * 0.2 + 0.25) * (s.awd ? 0.45 : 1)));
  const layout = `${s.a > s.b ? 'mid-engine, ' : 'front-engine, '}${s.awd ? 'all-wheel drive' : 'rear-wheel drive'}${s.turbo ? ', turbo' : ''}`;
  return { ps: Math.round(s.power / 735.5), kg: Math.round(s.mass), top: Math.round(v * 3.6), grip: Math.round(grip * 100) / 100, brake: Math.round(s.brake * 100) / 100, drift, layout };
}

/** Cosmetics. Paint colours on offer, the neon underglow colours, window banners. */
export const PAINT_PALETTE: readonly number[] = [0xf0f0ec, 0x121316, 0xb4b6ba, 0x5a5e66, 0xc01818, 0x7a1422, 0xe8c020, 0xe07818, 0x1c3a7a, 0x3a8adc, 0x1a2c5a, 0x2a6a3a, 0x7ac0a0, 0x6a3a8a, 0xe8a0c0, 0x8a6a3a];
export const NEON: readonly { name: string; color: number }[] = [
  { name: 'Hot pink', color: 0xff2fa0 },
  { name: 'Cyan', color: 0x20e8ff },
  { name: 'Violet', color: 0x8a3aff },
  { name: 'Acid green', color: 0x5aff3a },
  { name: 'Red', color: 0xff2020 },
  { name: 'Ice blue', color: 0x3a70ff },
  { name: 'White', color: 0xe8f0ff },
];
export const BANNERS: readonly string[] = ['KUROKAMI', 'MIDNIGHT', '夜光', 'CITY POP', '峠 TOUGE', 'NIGHT KIDS', '夕凪', 'NO LIMIT'];
export const PRICES = { paint: 12000, stripes: 15000, side: 10000, number: 5000, banner: 8000, neon: 30000, neonColour: 5000 } as const;
