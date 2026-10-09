import type { Light } from '../real/lightmap';
import { EMIT, KIND, lin, type MeshBuilder } from '../real/meshBuilder';
import { signBox, type SignBuilder, type SignLayout } from '../real/signs';
import { addBike, BIKE_LENGTH, type BikeType } from './bikes';
import { hash } from '../../core/hash';
import { TAXI_ADS } from './ads';

/**
 * Vehicles, second generation (review in models.html before they replace real/cars.ts in the district).
 *
 * Bodies are lofted surfaces: at stations along the car's length a cross-section is built from the
 * design's profile curves (roof / bonnet / boot line, beltline, ground clearance), with rounded lower
 * edges, tumblehome above the beltline and rounded plan corners. Stations are joined into a smooth mesh
 * with per-vertex normals. The bottom edge follows the wheel arches, so the arches are real cut-outs.
 * Glass, pillars, trim, bumpers and seams come from classifying the loft's quads by position; lights,
 * grilles, plates, mirrors and type-specific parts (taxi andon, fender mirrors, kei-truck bed) are
 * added on top. Wheels are turned: rounded tyres with alloy spokes or steel hubcaps.
 *
 * Designs lean on real Japanese cars (alternate-world Japan) under invented names: a modern saloon, the
 * classic boxy taxi, a kei tall-wagon, a minivan and a kei truck; and the sports cars for the passes: the
 * coupe, an 80s light hatchback, a rotary coupe, a turbo all-wheel-drive coupe and a kei roadster.
 */

export type CarType =
  | 'sedan' | 'luxury' | 'sports' | 'taxi' | 'taxi2' | 'kei' | 'minivan' | 'keitruck' | 'hatch' | 'rotary' | 'awd' | 'roadster'
  | 'van' | 'keivan' | 'boxtruck' | 'police' | 'hardtop';
export type VehicleType = CarType | BikeType;
export const CAR_TYPES2: readonly CarType[] = ['sedan', 'luxury', 'sports', 'taxi', 'taxi2', 'kei', 'minivan', 'keitruck', 'hatch', 'rotary', 'awd', 'roadster', 'van', 'keivan', 'boxtruck', 'police', 'hardtop'];
/** The working vehicles and the patrol car (under review in the showroom, not yet in the district's mixes). */
export const WORK_TYPES: readonly CarType[] = ['van', 'keivan', 'boxtruck', 'police'];
/** The cars you can own and race (the garage). */
export const SPORT_TYPES: readonly CarType[] = ['sports', 'hatch', 'rotary', 'awd', 'roadster'];
export const BIKE_TYPES: readonly BikeType[] = ['scooter', 'motorcycle', 'delivery'];
export const VEHICLE_TYPES: readonly VehicleType[] = [...CAR_TYPES2, ...BIKE_TYPES];
const isTaxi = (t: VehicleType): boolean => t === 'taxi' || t === 'taxi2';

type V3 = [number, number, number];
type P2 = readonly [number, number];
type Range = readonly [number, number];

interface Design {
  readonly name: CarType;
  /** Length, half-width, plan corner radius, ground clearance. */
  readonly L: number;
  readonly W: number;
  readonly corner: number;
  readonly clear: number;
  /** Where the lofted body starts (the kei truck's loft is just the cab). */
  readonly x0: number;
  /** Top line (boot, rear glass, roof, windscreen, bonnet) and beltline, x from the rear. */
  readonly top: readonly P2[];
  readonly belt: readonly P2[];
  /** Tumblehome: the roof is this much narrower than the body (per side). */
  readonly roofInset: number;
  readonly windscreen: Range;
  readonly rearGlass: Range;
  readonly sideGlass: Range;
  readonly pillars: readonly Range[];
  readonly blackPillars: boolean;
  readonly wheelX: readonly number[];
  readonly wheelR: number;
  readonly tyreW: number;
  readonly rims: 'alloy' | 'steel';
  readonly seams: readonly number[];
  /** Front lights, grille and rear lights as [y0, y1, zInner, zOuter] (grille zInner = 0). */
  readonly head: readonly [number, number, number, number];
  readonly grille: readonly [number, number, number, number];
  readonly grilleChrome: boolean;
  readonly tail: readonly [number, number, number, number];
  readonly plateY: readonly [number, number];
  readonly plate: 'white' | 'yellow' | 'green';
  readonly bumper: 'body' | 'chrome' | 'black';
  /** Chrome strip along the beltline and window surround (luxury). */
  readonly chromeBelt?: boolean;
  /** Pop-up headlamps, raised (the `head` lamps are then small bumper lamps). */
  readonly popups?: boolean;
  /** A rear spoiler: a lip at the top of the hatch, a low hoop wing, or a tall wing on posts. */
  readonly wing?: 'lip' | 'hoop' | 'gt';
  /** A dark vent in the bonnet. */
  readonly hoodVent?: boolean;
  /** A black fabric roof behind the windscreen (a roadster's hood, up). */
  readonly softTop?: boolean;
  /** Two-tone: ring segments below this take paint2 (the 80s "panda": a black lower body under the colour). */
  readonly twoTone?: number;
  /** Mirrors out on the front wings instead of the doors (the classic taxi; a 70s saloon's are chrome). */
  readonly fenderMirrors?: 'black' | 'chrome';
}

/**
 * The noir saloon (under review in the showroom; yours through the debug menu's car picker as the Seika Kurofune,
 * race/catalog.ts; in no traffic mix): a late-70s Japanese four-door pillared hardtop, the big square saloon of the
 * detective dramas. Long, low and flat: a long level bonnet and boot, an upright squared-off roof on a thick rear
 * pillar with a near-vertical back window, a straight waistline, chrome bumpers, a wide chrome grille between
 * rectangular lamps, chrome wing mirrors far out on the front wings, steel wheels.
 */
const HARDTOP: Design = {
  name: 'hardtop', L: 4.86, W: 0.85, corner: 0.09, clear: 0.16, x0: 0,
  top: [[0, 0.62], [0.05, 0.92], [0.4, 0.95], [1.22, 0.965], [1.3, 1.0], [1.62, 1.36], [1.86, 1.395], [2.95, 1.4], [3.08, 1.37], [3.55, 1.0], [3.62, 0.965], [4.66, 0.93], [4.8, 0.88], [4.86, 0.64]],
  belt: [[0, 0.92], [4.86, 0.9]],
  roofInset: 0.13,
  windscreen: [3.09, 3.55], rearGlass: [1.31, 1.6], sideGlass: [1.86, 3.44], pillars: [[2.6, 2.67]], blackPillars: false,
  wheelX: [1.0, 3.72], wheelR: 0.325, tyreW: 0.2, rims: 'steel',
  seams: [1.74, 2.64, 3.5],
  head: [0.66, 0.8, 0.46, 0.82], grille: [0.6, 0.82, 0, 0.46], grilleChrome: true, tail: [0.68, 0.9, 0.34, 0.83],
  plateY: [0.4, 0.52], plate: 'white', bumper: 'chrome', chromeBelt: true, fenderMirrors: 'chrome',
};

const SEDAN: Design = {
  name: 'sedan', L: 4.9, W: 0.915, corner: 0.3, clear: 0.15, x0: 0,
  top: [[0, 0.64], [0.1, 0.9], [0.5, 0.99], [1.12, 1.02], [1.62, 1.3], [2.05, 1.43], [2.8, 1.45], [3.22, 1.36], [3.86, 0.98], [4.5, 0.86], [4.8, 0.76], [4.9, 0.6]],
  belt: [[0, 0.92], [1.2, 0.99], [3.8, 0.97], [4.9, 0.82]],
  roofInset: 0.2,
  windscreen: [3.24, 3.86], rearGlass: [1.14, 1.95], sideGlass: [1.45, 3.64], pillars: [[2.6, 2.72]], blackPillars: true,
  wheelX: [0.98, 3.86], wheelR: 0.335, tyreW: 0.225, rims: 'alloy',
  seams: [1.55, 2.66, 3.66],
  head: [0.66, 0.77, 0.34, 0.78], grille: [0.42, 0.66, 0, 0.4], grilleChrome: true, tail: [0.8, 0.92, 0.3, 0.8],
  plateY: [0.34, 0.46], plate: 'white', bumper: 'body',
};

const TAXI: Design = {
  name: 'taxi', L: 4.7, W: 0.85, corner: 0.1, clear: 0.17, x0: 0,
  top: [[0, 0.68], [0.05, 0.93], [0.95, 0.97], [1.06, 0.99], [1.32, 1.47], [2.75, 1.5], [3.26, 1.48], [3.56, 1.0], [4.58, 0.91], [4.7, 0.74]],
  belt: [[0, 0.96], [4.7, 0.93]],
  roofInset: 0.12,
  windscreen: [3.27, 3.56], rearGlass: [1.07, 1.32], sideGlass: [1.26, 3.5], pillars: [[2.28, 2.4]], blackPillars: false,
  wheelX: [0.9, 3.55], wheelR: 0.31, tyreW: 0.195, rims: 'steel',
  seams: [1.36, 2.34, 3.5],
  head: [0.7, 0.83, 0.46, 0.72], grille: [0.56, 0.84, 0, 0.44], grilleChrome: true, tail: [0.73, 0.9, 0.42, 0.78],
  plateY: [0.5, 0.62], plate: 'green', bumper: 'chrome',
};

const KEI: Design = {
  name: 'kei', L: 3.395, W: 0.737, corner: 0.17, clear: 0.15, x0: 0,
  top: [[0, 0.72], [0.03, 1.12], [0.1, 1.7], [0.26, 1.77], [2.35, 1.77], [2.95, 1.2], [3.3, 0.99], [3.395, 0.72]],
  belt: [[0, 1.03], [3.395, 0.99]],
  roofInset: 0.08,
  windscreen: [2.4, 2.95], rearGlass: [0.035, 0.13], sideGlass: [0.2, 2.9], pillars: [[1.44, 1.56], [0.72, 0.8]], blackPillars: true,
  wheelX: [0.5, 2.95], wheelR: 0.29, tyreW: 0.155, rims: 'steel',
  seams: [0.76, 1.5, 2.9],
  head: [0.84, 0.97, 0.26, 0.66], grille: [0.6, 0.8, 0, 0.34], grilleChrome: false, tail: [0.9, 1.36, 0.56, 0.7],
  plateY: [0.42, 0.54], plate: 'yellow', bumper: 'body',
};

const MINIVAN: Design = {
  name: 'minivan', L: 4.69, W: 0.85, corner: 0.2, clear: 0.16, x0: 0,
  top: [[0, 0.7], [0.03, 1.2], [0.12, 1.82], [0.35, 1.86], [3.3, 1.86], [3.8, 1.3], [4.35, 1.01], [4.62, 0.9], [4.69, 0.65]],
  belt: [[0, 1.09], [4.69, 1.02]],
  roofInset: 0.1,
  windscreen: [3.32, 3.85], rearGlass: [0.035, 0.13], sideGlass: [0.24, 3.7], pillars: [[1.33, 1.46], [2.44, 2.56]], blackPillars: true,
  wheelX: [0.85, 3.6], wheelR: 0.33, tyreW: 0.205, rims: 'alloy',
  seams: [1.4, 2.5, 3.72],
  head: [0.88, 1.0, 0.44, 0.78], grille: [0.5, 0.96, 0, 0.5], grilleChrome: true, tail: [0.95, 1.45, 0.64, 0.8],
  plateY: [0.38, 0.5], plate: 'white', bumper: 'body',
};

const KEITRUCK: Design = {
  name: 'keitruck', L: 3.395, W: 0.737, corner: 0.12, clear: 0.2, x0: 1.95,
  top: [[1.95, 1.0], [1.97, 1.78], [2.08, 1.85], [2.85, 1.86], [3.28, 1.2], [3.395, 0.95]],
  belt: [[1.95, 1.07], [3.395, 1.05]],
  roofInset: 0.07,
  windscreen: [2.87, 3.28], rearGlass: [1.96, 2.05], sideGlass: [2.1, 2.86], pillars: [], blackPillars: false,
  wheelX: [0.62, 2.92], wheelR: 0.27, tyreW: 0.145, rims: 'steel',
  seams: [2.1, 2.88],
  head: [0.82, 0.96, 0.36, 0.64], grille: [0.62, 0.8, 0, 0.3], grilleChrome: false, tail: [0.48, 0.62, 0.5, 0.7],
  plateY: [0.42, 0.54], plate: 'yellow', bumper: 'black',
};

/** 80s/90s JDM coupe: low, wide, long bonnet, raked screen, fastback hatch, slit lamps, full-width tail bar. */
const SPORTS: Design = {
  name: 'sports', L: 4.35, W: 0.88, corner: 0.2, clear: 0.12, x0: 0,
  top: [[0, 0.6], [0.06, 0.86], [0.35, 0.93], [0.95, 0.97], [1.55, 1.2], [2.05, 1.26], [2.5, 1.26], [2.95, 1.1], [3.3, 0.86], [4.15, 0.72], [4.35, 0.55]],
  belt: [[0, 0.86], [2.2, 0.84], [4.35, 0.74]],
  roofInset: 0.24,
  windscreen: [2.55, 3.28], rearGlass: [1.0, 2.0], sideGlass: [1.6, 3.08], pillars: [], blackPillars: true,
  wheelX: [0.86, 3.42], wheelR: 0.31, tyreW: 0.225, rims: 'alloy',
  seams: [1.62, 3.05],
  head: [0.6, 0.66, 0.36, 0.8], grille: [0.4, 0.5, 0, 0.5], grilleChrome: false, tail: [0.72, 0.82, 0.04, 0.84],
  plateY: [0.34, 0.46], plate: 'white', bumper: 'body',
};

/** Executive saloon: longer, formal upright glasshouse, big chrome grille, chrome belt and window trim. */
const LUXURY: Design = {
  name: 'luxury', L: 5.25, W: 0.94, corner: 0.26, clear: 0.15, x0: 0,
  top: [[0, 0.68], [0.08, 0.96], [0.55, 1.04], [1.22, 1.07], [1.74, 1.43], [2.22, 1.5], [3.15, 1.51], [3.5, 1.44], [4.12, 1.03], [4.95, 0.93], [5.18, 0.83], [5.25, 0.64]],
  belt: [[0, 0.97], [5.25, 0.91]],
  roofInset: 0.18,
  windscreen: [3.52, 4.12], rearGlass: [1.24, 1.74], sideGlass: [1.66, 3.92], pillars: [[2.82, 2.98]], blackPillars: false,
  wheelX: [1.06, 4.12], wheelR: 0.35, tyreW: 0.235, rims: 'alloy',
  seams: [1.68, 2.9, 3.94],
  head: [0.68, 0.8, 0.4, 0.84], grille: [0.4, 0.76, 0, 0.38], grilleChrome: true, tail: [0.8, 0.95, 0.28, 0.86],
  plateY: [0.34, 0.46], plate: 'white', bumper: 'body', chromeBelt: true,
};

/** The modern Tokyo taxi: a tall, upright wagon in deep indigo (koiai), sliding rear door. */
const TAXI2: Design = {
  name: 'taxi2', L: 4.4, W: 0.85, corner: 0.2, clear: 0.15, x0: 0,
  top: [[0, 0.72], [0.05, 1.2], [0.15, 1.68], [0.4, 1.75], [3.0, 1.75], [3.45, 1.3], [3.9, 1.02], [4.3, 0.92], [4.4, 0.7]],
  belt: [[0, 1.05], [4.4, 1.0]],
  roofInset: 0.1,
  windscreen: [3.02, 3.5], rearGlass: [0.05, 0.16], sideGlass: [0.25, 3.36], pillars: [[1.4, 1.52], [2.45, 2.56]], blackPillars: true,
  wheelX: [0.8, 3.45], wheelR: 0.31, tyreW: 0.195, rims: 'alloy',
  seams: [1.46, 2.5, 3.38],
  head: [0.82, 0.98, 0.44, 0.76], grille: [0.5, 0.8, 0, 0.42], grilleChrome: true, tail: [0.95, 1.4, 0.64, 0.8],
  plateY: [0.42, 0.54], plate: 'green', bumper: 'body',
};

/** 80s light hatchback (the Hachi-roku): boxy wedge, pop-up lamps, a long hatch, black bumpers, panda two-tone. */
const HATCH: Design = {
  name: 'hatch', L: 4.2, W: 0.83, corner: 0.12, clear: 0.13, x0: 0,
  top: [[0, 0.62], [0.05, 0.9], [0.14, 0.99], [0.4, 1.06], [1.1, 1.3], [1.35, 1.33], [2.45, 1.33], [2.98, 1.02], [3.2, 0.86], [4.05, 0.74], [4.2, 0.56]],
  belt: [[0, 0.84], [4.2, 0.8]],
  roofInset: 0.17,
  windscreen: [2.47, 3.08], rearGlass: [0.42, 1.34], sideGlass: [1.2, 2.95], pillars: [[1.62, 1.74]], blackPillars: true,
  wheelX: [0.72, 3.12], wheelR: 0.29, tyreW: 0.185, rims: 'alloy',
  seams: [1.75, 2.98],
  head: [0.44, 0.5, 0.42, 0.74], grille: [0.5, 0.57, 0, 0.34], grilleChrome: false, tail: [0.72, 0.87, 0.05, 0.8],
  plateY: [0.3, 0.42], plate: 'white', bumper: 'black', popups: true, wing: 'lip', twoTone: 4,
};

/** Rotary coupe: low and curvy, a double-bubble roof, pop-up lamps, a wide mouth, a hoop wing on the tail. */
const ROTARY: Design = {
  name: 'rotary', L: 4.285, W: 0.88, corner: 0.32, clear: 0.11, x0: 0,
  top: [[0, 0.66], [0.04, 0.86], [0.3, 0.9], [0.8, 0.93], [1.42, 1.17], [1.82, 1.23], [2.35, 1.23], [2.82, 1.02], [3.15, 0.8], [3.8, 0.69], [4.2, 0.58], [4.285, 0.42]],
  belt: [[0, 0.84], [2.0, 0.82], [4.285, 0.66]],
  roofInset: 0.26,
  windscreen: [2.38, 3.12], rearGlass: [0.95, 1.78], sideGlass: [1.5, 2.95], pillars: [], blackPillars: true,
  wheelX: [0.8, 3.225], wheelR: 0.32, tyreW: 0.235, rims: 'alloy',
  seams: [1.55, 2.98],
  head: [0.46, 0.51, 0.34, 0.76], grille: [0.24, 0.42, 0, 0.46], grilleChrome: false, tail: [0.72, 0.8, 0.22, 0.76],
  plateY: [0.3, 0.42], plate: 'white', bumper: 'body', popups: true, wing: 'hoop',
};

/** Turbo all-wheel-drive coupe (the early-90s giant-killer): boxy and square-shouldered, a tall wing, a bonnet vent. */
const AWD: Design = {
  name: 'awd', L: 4.545, W: 0.88, corner: 0.14, clear: 0.13, x0: 0,
  top: [[0, 0.7], [0.06, 0.95], [0.4, 1.0], [0.95, 1.02], [1.36, 1.3], [1.76, 1.34], [2.66, 1.34], [3.06, 1.17], [3.42, 0.95], [4.35, 0.84], [4.545, 0.6]],
  belt: [[0, 0.95], [4.545, 0.88]],
  roofInset: 0.19,
  windscreen: [2.7, 3.42], rearGlass: [0.97, 1.74], sideGlass: [1.5, 3.2], pillars: [], blackPillars: true,
  wheelX: [0.86, 3.475], wheelR: 0.33, tyreW: 0.245, rims: 'alloy',
  seams: [1.55, 3.22],
  head: [0.62, 0.73, 0.36, 0.82], grille: [0.62, 0.72, 0, 0.34], grilleChrome: false, tail: [0.78, 0.9, 0.28, 0.8],
  plateY: [0.34, 0.46], plate: 'white', bumper: 'body', wing: 'gt', hoodVent: true,
};

/** Kei roadster (mid-engined, 660 cc): tiny, the black hood up, round lamps, yellow kei plates. */
const ROADSTER: Design = {
  name: 'roadster', L: 3.295, W: 0.698, corner: 0.2, clear: 0.12, x0: 0,
  top: [[0, 0.64], [0.05, 0.8], [0.5, 0.85], [0.82, 0.87], [1.0, 1.14], [1.55, 1.17], [1.86, 1.0], [2.12, 0.8], [3.2, 0.67], [3.295, 0.5]],
  belt: [[0, 0.78], [3.295, 0.72]],
  roofInset: 0.12,
  windscreen: [1.55, 2.12], rearGlass: [0.97, 1.06], sideGlass: [1.08, 2.02], pillars: [], blackPillars: true,
  wheelX: [0.5, 2.78], wheelR: 0.27, tyreW: 0.165, rims: 'alloy',
  seams: [1.1, 2.05],
  head: [0.58, 0.68, 0.34, 0.6], grille: [0.36, 0.46, 0, 0.3], grilleChrome: false, tail: [0.6, 0.7, 0.22, 0.62],
  plateY: [0.3, 0.42], plate: 'yellow', bumper: 'body', softTop: true,
};

/** The white work van (after the Hiace): semi-bonnet, a box to the back, glass in the doors only, black bumpers. */
const VAN: Design = {
  name: 'van', L: 4.695, W: 0.847, corner: 0.1, clear: 0.17, x0: 0,
  top: [[0, 0.68], [0.02, 1.3], [0.05, 1.92], [0.2, 1.98], [3.72, 1.98], [4.2, 1.42], [4.5, 1.12], [4.66, 1.0], [4.695, 0.72]],
  belt: [[0, 1.12], [4.695, 1.1]],
  roofInset: 0.07,
  windscreen: [3.74, 4.2], rearGlass: [0.02, 0.055], sideGlass: [0.3, 4.12], pillars: [[0.3, 1.98], [2.9, 3.02]], blackPillars: false,
  wheelX: [1.17, 3.74], wheelR: 0.31, tyreW: 0.195, rims: 'steel',
  seams: [1.98, 2.98],
  head: [0.92, 1.06, 0.36, 0.8], grille: [0.72, 0.98, 0, 0.36], grilleChrome: false, tail: [0.7, 1.2, 0.68, 0.8],
  plateY: [0.42, 0.54], plate: 'white', bumper: 'black',
};

/** Kei van (after the Every and the Hijet): a semi-cab-over box on the kei footprint, sliding doors, steel wheels. */
const KEIVAN: Design = {
  name: 'keivan', L: 3.395, W: 0.737, corner: 0.1, clear: 0.16, x0: 0,
  top: [[0, 0.7], [0.02, 1.25], [0.05, 1.83], [0.18, 1.88], [2.72, 1.88], [3.12, 1.32], [3.3, 1.08], [3.38, 0.95], [3.395, 0.72]],
  belt: [[0, 1.04], [3.395, 1.02]],
  roofInset: 0.06,
  windscreen: [2.74, 3.12], rearGlass: [0.02, 0.05], sideGlass: [0.22, 3.0], pillars: [[2.12, 2.24], [0.9, 1.0]], blackPillars: true,
  wheelX: [0.62, 2.95], wheelR: 0.27, tyreW: 0.145, rims: 'steel',
  seams: [1.08, 2.18],
  head: [0.86, 0.99, 0.28, 0.66], grille: [0.66, 0.84, 0, 0.26], grilleChrome: false, tail: [0.62, 1.12, 0.6, 0.71],
  plateY: [0.4, 0.52], plate: 'yellow', bumper: 'black',
};

/** Two-tonne box truck (after the Elf and the Canter): a flat-fronted cab over the front wheels, an aluminium box. */
const BOXTRUCK: Design = {
  name: 'boxtruck', L: 4.69, W: 0.85, corner: 0.08, clear: 0.45, x0: 3.08,
  top: [[3.08, 1.1], [3.1, 2.12], [3.2, 2.2], [4.3, 2.2], [4.42, 2.12], [4.56, 1.35], [4.66, 1.1], [4.69, 0.62]],
  belt: [[3.08, 1.42], [4.69, 1.38]],
  roofInset: 0.05,
  windscreen: [4.42, 4.56], rearGlass: [0, 0], sideGlass: [3.35, 4.5], pillars: [], blackPillars: false,
  wheelX: [1.12, 3.62], wheelR: 0.36, tyreW: 0.2, rims: 'steel',
  seams: [3.36],
  head: [0.62, 0.78, 0.48, 0.8], grille: [0.95, 1.3, 0, 0.5], grilleChrome: false, tail: [0, 0, 0, 0],
  plateY: [0.36, 0.48], plate: 'green', bumper: 'black',
};

/** The patrol car (after the Crown patrol cars): the saloon, white over black, steel wheels, a red light bar. */
const POLICE: Design = { ...SEDAN, name: 'police', rims: 'steel', twoTone: 4 };

const DESIGNS: Record<CarType, Design> = { hardtop: HARDTOP, van: VAN, keivan: KEIVAN, boxtruck: BOXTRUCK, police: POLICE, sedan: SEDAN, luxury: LUXURY, sports: SPORTS, taxi: TAXI, taxi2: TAXI2, kei: KEI, minivan: MINIVAN, keitruck: KEITRUCK, hatch: HATCH, rotary: ROTARY, awd: AWD, roadster: ROADSTER };

export const PAINTS: Record<VehicleType, readonly number[]> = {
  sedan: [0xe8e8e4, 0x121316, 0xb4b6ba, 0x1c2a44, 0x5a1a20],
  luxury: [0x07070a, 0x1a2032, 0x2a1418, 0xf0efe8],
  hardtop: [0x0a0a0c, 0x16181e, 0x2a1418, 0x3a3428, 0xd6d2c6],
  sports: [0xc01818, 0xf0f0ec, 0x121316, 0xb4b6ba, 0x1c3a7a, 0xe8c020],
  taxi: [0x121316, 0xe0a818, 0x1f5a36, 0x1c2438],
  taxi2: [0x1c2240, 0x121316],
  kei: [0xe8e8e4, 0xa8d4bc, 0xd8c09a, 0xe0b0b8, 0x8ab0d0],
  minivan: [0xe8e8e4, 0x121316, 0xb4b6ba, 0x3a3e44],
  keitruck: [0xe8e8e4, 0xe8e8e4, 0xb4b6ba],
  van: [0xf0f0ec, 0xf0f0ec, 0xf0f0ec, 0xb4b6ba, 0x121316, 0x1c2a44],
  keivan: [0xf0f0ec, 0xf0f0ec, 0xb4b6ba, 0x8ab0d0],
  // The truck's cab (its box is aluminium: paint2).
  boxtruck: [0xf0f0ec, 0xf0f0ec, 0x2a5a9a, 0x2a6a4a],
  police: [0xf2f2ee],
  hatch: [0xf0f0ec, 0xc01818, 0x121316, 0xb4b6ba],
  rotary: [0xe8c020, 0xc01818, 0x1c3a7a, 0xf0f0ec],
  awd: [0x5a5e66, 0x121316, 0xf0f0ec, 0x1a2c5a],
  roadster: [0xe8c020, 0xc01818, 0xf0f0ec, 0x3a8a5a],
  scooter: [0xe8e0c8, 0xa8d4bc, 0xe0b0b8, 0x8ab0d0, 0x121316],
  motorcycle: [0xb81818, 0x121316, 0x1c3a7a, 0xe8e8e4],
  delivery: [0xc81818, 0xe8e8e4],
};

/**
 * Taxi advertising (placeholder copy for review): a lit roof panel along the car and a vinyl wrap on the
 * rear doors with its own text. All brands are invented; some double as story hooks.
 */
export interface TaxiAd {
  /** Roof lightbox text (both sides). */
  readonly roof?: string;
  /** Rear-door wrap text (both sides), printed on the wrap colour. */
  readonly side?: string;
  readonly wrap?: number;
  /** Roof panel plate and text colours. */
  readonly plate?: number;
  readonly ink?: number;
  /** Photo ad: index into the ad atlas (VehicleSigns.photos); the photo layouts replace the text-only ones. */
  readonly photo?: number;
}

/** Monotone cubic interpolation through (x, y) keys (no overshoot, so profiles stay clean). */
function curve(pts: readonly P2[]): (x: number) => number {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const within = (x: number, r: Range): boolean => x >= r[0] && x <= r[1];

export interface VehicleSpec {
  readonly x: number;
  readonly z: number;
  /** Unit vector the car points along (axis-aligned in the district). */
  readonly fx: number;
  readonly fz: number;
  readonly type: VehicleType;
  readonly paint: number;
  /** Second livery colour (taxi upper body / stripe); defaults per type. */
  readonly paint2?: number;
  /**
   * Station spacing in metres: 0.05 for close-ups, ~0.12 for the street; from 0.2 the wheels are simple too
   * (a parked car in a chunk: ~1,600 triangles instead of ~7,000).
   */
  readonly detail?: number;
  /** Taxi advertising (needs `signs` passed to addVehicle for the text). */
  readonly ad?: TaxiAd;
  /** false: a parked car, its lamps off (the head and tail lamps otherwise come on with the street lamps). */
  readonly lamps?: boolean;
  /** false leaves the wheels off, for a car whose wheels are drawn apart so they can turn (`wheelLayout`, `addWheel`). */
  readonly wheels?: boolean;
  /** Livery: twin racing stripes over the top (bonnet, roof, boot; not the glass), and a stripe along each side. */
  readonly livery?: { readonly stripes?: number | null; readonly side?: number | null };
  /**
   * Dresses a street vehicle from this seed (`addVehicleMarks`): a taxi's ad, a work vehicle's company lettering
   * (or none), a patrol car's unit on its roof.
   */
  readonly marks?: number;
  /** A work vehicle's company (index into WORK_LIVERIES), over the one `marks` would pick. */
  readonly company?: number;
  /**
   * The side windows into builders of their own (so they can roll down: race/carView.ts): `left` is the side
   * (fz, 0, -fx) points to (the car's left), `right` the other. The body keeps the openings.
   */
  readonly sideWindows?: { readonly left: MeshBuilder; readonly right: MeshBuilder };
  /**
   * The lamps into builders of their own (so they can be switched: race/carView.ts): the headlamps' lit lenses,
   * the tail lamps' night layer and the reversing lamps. The body keeps plain glass lenses and the dim red tail.
   */
  readonly lampParts?: { readonly head: MeshBuilder; readonly tail: MeshBuilder; readonly reverse: MeshBuilder };
}

/** Text geometry for vehicles that carry lettering (taxi ads, delivery boxes). */
export interface VehicleSigns {
  readonly sb: SignBuilder;
  readonly layout: SignLayout;
  /** Photo ads: their own builder (drawn with the ad atlas material) and the atlas's UVs. */
  readonly photos?: {
    readonly sb: SignBuilder;
    uv(i: number, part: 'roof' | 'door'): readonly [number, number, number, number];
    readonly blankUv: [number, number];
    readonly roofAspect: number;
    readonly doorAspect: number;
  };
}

/** Company lettering on the working vehicles (all invented): the name large, a line under it, and a band. */
export interface WorkLivery {
  readonly name: string;
  readonly sub: string;
  readonly ink: number;
  /** A stripe along the truck's box (and the vans' sides). */
  readonly band?: number;
  readonly on: readonly CarType[];
}
export const WORK_LIVERIES: readonly WorkLivery[] = [
  { name: '東都運輸', sub: 'TŌTO UNYU', ink: 0x1c3f8a, band: 0x1c3f8a, on: ['boxtruck', 'van'] },
  { name: 'つばめ急便', sub: 'TSUBAME EXPRESS', ink: 0x1e7a46, band: 0x1e7a46, on: ['boxtruck', 'keivan', 'van'] },
  { name: '若葉引越センター', sub: 'お引越しは若葉へ', ink: 0x2a8a3a, band: 0xe8a020, on: ['boxtruck'] },
  { name: '丸三水産', sub: '東都中央卸売市場', ink: 0x18346e, on: ['boxtruck', 'keivan'] },
  { name: '青葉電気工事', sub: '電気工事・空調', ink: 0xd0601a, band: 0xd0601a, on: ['van', 'keivan'] },
  { name: '鈴木工務店', sub: '住まいのリフォーム', ink: 0x2c2c30, on: ['van'] },
  { name: '酒の丸八', sub: '配達いたします', ink: 0xa01818, on: ['keivan'] },
  { name: '中村クリーニング', sub: '集配いたします', ink: 0x1a6ab0, on: ['keivan'] },
  { name: '花のさくら屋', sub: 'FLOWER SAKURAYA', ink: 0xc8407a, on: ['keivan'] },
  { name: '東都ガス', sub: 'ガス・暮らしのサービス', ink: 0x1c4a9a, band: 0x1c4a9a, on: ['van'] },
];
/** Share of each work vehicle that's plain (no lettering). */
const PLAIN: Partial<Record<CarType, number>> = { van: 0.45, keivan: 0.4, boxtruck: 0.2 };

/** The patrol car: the force on its doors, POLICE under it, its station and car number on the roof. */
export const POLICE_NAME = '警視庁';
export const POLICE_EN = 'POLICE';
const POLICE_UNITS = ['歌舞路', '朝霧', '霞町', '川端', '電光', '桜丘', '学園'];
const unitText = (u: number, n: number): string => `${POLICE_UNITS[u]}${n}`;

/** A taxi's ad from its seed: most carry one (the demo leaves out the love hotel's). */
const TAXI_AD_SHARE = 0.6;
export function taxiAdFor(seed: number): TaxiAd | undefined {
  const h = hash(seed, 0x7a8);
  if ((h % 1000) / 1000 >= TAXI_AD_SHARE) return undefined;
  const ads = TAXI_ADS.map((a, i) => ({ ...a, photo: i })).filter((a) => !(__EDITION__ === 'demo' && a.art === '06_hotel_paradise'));
  return ads[(h >>> 10) % ads.length];
}

/** A work vehicle's lettering: the one it was given, else from its seed (or none). */
export function liveryOf(spec: VehicleSpec): WorkLivery | null {
  if (spec.company !== undefined) return WORK_LIVERIES[spec.company] ?? null;
  const plain = PLAIN[spec.type as CarType];
  if (plain === undefined || spec.marks === undefined) return null;
  const h = hash(spec.marks, 0x11e);
  if ((h % 1000) / 1000 < plain) return null;
  const list = WORK_LIVERIES.filter((l) => l.on.includes(spec.type as CarType));
  return list[(h >>> 10) % list.length] ?? null;
}

/** The ad a vehicle carries: the one it was given, else a taxi's from its seed. */
const adOf = (spec: VehicleSpec): TaxiAd | undefined =>
  spec.ad ?? (spec.marks !== undefined && isTaxi(spec.type) ? taxiAdFor(spec.marks) : undefined);

/** What a vehicle's dressing comes to (its ad, company, patrol unit), for sharing models between vehicles dressed alike. */
export function marksKey(spec: VehicleSpec): string {
  const ad = adOf(spec) as (TaxiAd & { photo?: number }) | undefined;
  const l = liveryOf(spec);
  return `${ad ? (ad.photo ?? ad.roof ?? '?') : '-'}|${l ? WORK_LIVERIES.indexOf(l) : '-'}|${spec.type === 'police' ? hash(spec.marks ?? 0, 0x9011) % 42 : '-'}`;
}

/** Every text a vehicle can show (for the sign atlas / layout): the ads' copy and the lettering. */
export function vehicleTexts(ads: readonly TaxiAd[] = TAXI_ADS): { text: string; vertical: boolean }[] {
  const out = [{ text: DELIVERY_TEXT, vertical: false }, { text: POLICE_NAME, vertical: false }, { text: POLICE_EN, vertical: false }];
  for (const a of ads) {
    if (a.roof) out.push({ text: a.roof, vertical: false });
    if (a.side) out.push({ text: a.side, vertical: false });
  }
  for (const l of WORK_LIVERIES) out.push({ text: l.name, vertical: false }, { text: l.sub, vertical: false });
  for (let u = 0; u < POLICE_UNITS.length; u++) for (let n = 1; n <= 6; n++) out.push({ text: unitText(u, n), vertical: false });
  return out;
}
export const DELIVERY_TEXT = '出前 らーめん';

/** Overall length of a vehicle (for layout and collision). */
export const vehicleLength = (t: VehicleType): number => (t in DESIGNS ? DESIGNS[t as CarType].L : BIKE_LENGTH);

/**
 * Light a vehicle throws on the ground at night (for the lightmap): headlight beams spreading ahead and a
 * red glow behind.
 */
export function vehicleLights(spec: VehicleSpec): Light[] {
  const L = vehicleLength(spec.type);
  const bike = !(spec.type in DESIGNS);
  const w = bike ? 0.3 : DESIGNS[spec.type as CarType].W;
  const fx = spec.fx;
  const fz = spec.fz;
  const sx = fz;
  const sz = -fx;
  const front = { x: spec.x + fx * (L / 2 + 0.3), z: spec.z + fz * (L / 2 + 0.3) };
  const rear = { x: spec.x - fx * (L / 2 + 0.3), z: spec.z - fz * (L / 2 + 0.3) };
  const beams: Light[] = [];
  for (const k of bike ? [0] : [-1, 1]) {
    for (const [ahead, r, i] of [[2.2, 2.4, 0.55], [4.5, 3.4, 0.5], [7.5, 4.2, 0.35]] as const) {
      beams.push({ x: front.x + sx * k * (w - 0.25) + fx * ahead, z: front.z + sz * k * (w - 0.25) + fz * ahead, r: bike ? r * 0.7 : r, color: [1.0, 0.92, 0.78], i: bike ? i * 0.7 : i });
    }
  }
  beams.push({ x: rear.x, z: rear.z, r: bike ? 1.2 : 2.0, color: [1.0, 0.08, 0.05], i: 0.3 });
  return beams;
}

/** A box in a vehicle's frame (x from the back, z across), for its parts. */
const boxer = (mb: MeshBuilder, P: (x: number, y: number, z: number) => V3, N: (n: V3) => V3) => (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
  const faces: [V3, V3[]][] = [
    [[1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]]],
    [[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]],
    [[0, -1, 0], [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]]],
    [[0, 0, 1], [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]]],
    [[0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]],
  ];
  for (const [n, q] of faces) {
    const nw = N(n);
    mb.quadN(P(...q[0]), P(...q[1]), P(...q[2]), P(...q[3]), nw, nw, nw, nw);
  }
};

/** A car's body for what's fitted inside it (models/carInterior.ts). */
export interface BodyShape {
  readonly type: CarType;
  readonly L: number;
  readonly W: number;
  readonly x0: number;
  readonly windscreen: Range;
  readonly rearGlass: Range;
  readonly sideGlass: Range;
  readonly pillars: readonly Range[];
  readonly softTop: boolean;
  readonly roofInset: number;
  readonly wheelX: readonly number[];
  readonly wheelR: number;
  /** Ground clearance (m). */
  readonly clear: number;
  readonly top: (x: number) => number;
  readonly belt: (x: number) => number;
  readonly halfW: (x: number) => number;
  readonly bottom: (x: number) => number;
  /** The half cross-section at x, (y, z) from the underside's centre up the side to the roof's (11 points; no
   * wheel arches). */
  readonly section: (x: number) => [number, number][];
}

/**
 * A car's body: its design's glass, pillars and wheels and its shape as functions of x. x runs from the rear;
 * in the body's own frame (addVehicle at the origin facing +z) a point (x, y, z) is at (z, y, x - L / 2).
 */
export function bodyShape(type: CarType): BodyShape {
  const d = DESIGNS[type];
  return {
    type,
    L: d.L,
    W: d.W,
    x0: d.x0,
    windscreen: d.windscreen,
    rearGlass: d.rearGlass,
    sideGlass: d.sideGlass,
    pillars: d.pillars,
    softTop: !!d.softTop,
    roofInset: d.roofInset,
    wheelX: d.wheelX,
    wheelR: d.wheelR,
    clear: d.clear,
    // (Without the wheel arches cut out of its underside: the cabin's floor runs flat over them.)
    ...shapeOf(d, false),
  };
}

/** A design's body as functions of x: its top line, beltline, half-width, bottom edge and cross-section. */
function shapeOf(d: Design, arches = true): {
  top: (x: number) => number;
  belt: (x: number) => number;
  halfW: (x: number) => number;
  bottom: (x: number) => number;
  section: (x: number) => [number, number][];
} {
  const top = curve(d.top);
  const belt = curve(d.belt);
  const halfW = (x: number): number => {
    const e = Math.min(x - d.x0, d.L - x);
    if (e >= d.corner) return d.W;
    const c = d.corner - Math.max(0, e);
    return d.W - d.corner + Math.sqrt(Math.max(0, d.corner * d.corner - c * c));
  };
  const archR = d.wheelR + 0.05;
  const bottom = (x: number): number => {
    const e = Math.min(x - d.x0, d.L - x);
    let b = d.clear + Math.max(0, 0.3 - e) * 0.5;
    for (const wx of arches ? d.wheelX : []) {
      const dx = x - wx;
      if (Math.abs(dx) < archR) b = Math.max(b, d.wheelR + Math.sqrt(archR * archR - dx * dx));
    }
    return b;
  };

  /** Half cross-section (y, z) from the underside centre, up the side, to the roof centre. */
  // (Cached by x: finding the skin under a lamp or the grille steps through the same stations again and again.)
  const sections = new Map<number, [number, number][]>();
  const section = (x: number): [number, number][] => {
    let h = sections.get(x);
    if (!h) sections.set(x, (h = sectionAt(x)));
    return h;
  };
  const sectionAt = (x: number): [number, number][] => {
    const w = halfW(x);
    const b = bottom(x);
    const t = top(x);
    let bl = Math.min(belt(x), t - 0.02);
    const hood = t - bl < 0.14;
    if (hood) bl = Math.max(b + 0.06, t - 0.1);
    const rw = hood ? w * 0.92 : Math.max(0.2, w - d.roofInset);
    const lowR = Math.max(0.01, Math.min(0.07, (bl - b) * 0.25));
    const pts: [number, number][] = [
      [b, 0],
      [b, w * 0.8],
      [b + lowR * 0.5, w * 0.965],
      [b + lowR * 1.8, w],
      [b + (bl - b) * 0.6, w * 1.004],
      [bl, w * 0.995],
      [bl + 0.025, w * 0.975],
      hood ? [t - 0.05, w * 0.94] : [t - 0.07, rw],
      hood ? [t - 0.015, w * 0.86] : [t - 0.02, rw - 0.05],
      [t, hood ? w * 0.6 : rw * 0.7],
      [t, 0],
    ];
    for (let i = 1; i < pts.length; i++) pts[i][0] = Math.max(pts[i][0], pts[i - 1][0] + 0.0005);
    return pts;
  };
  return { top, belt, halfW, bottom, section };
}

/**
 * Adds a vehicle to the builder (city material: gloss / glass / chrome / emit kinds). `brake`, if given, gets
 * the brake lights: panels just proud of the tail lights, for a mesh shown while braking (real/traffic.ts).
 */
export function addVehicle(mb: MeshBuilder, spec: VehicleSpec, signs?: VehicleSigns, brake?: MeshBuilder): void {
  if (!(spec.type in DESIGNS)) return addBike(mb, spec as VehicleSpec & { type: BikeType }, signs);
  const d = DESIGNS[spec.type as CarType];
  const f: V3 = [spec.fx, 0, spec.fz];
  const s: V3 = [spec.fz, 0, -spec.fx];
  const half = d.L / 2;
  const P = (x: number, y: number, z: number): V3 => [spec.x + f[0] * (x - half) + s[0] * z, y, spec.z + f[2] * (x - half) + s[2] * z];
  const N = (n: V3): V3 => [f[0] * n[0] + s[0] * n[2], n[1], f[2] * n[0] + s[2] * n[2]];
  const paint = lin(spec.paint);
  const paint2 = lin(spec.paint2 ?? (spec.type === 'police' ? 0x101012 : spec.type === 'boxtruck' ? 0xc4c7ca : spec.type === 'hatch' ? 0x121316 : spec.type === 'taxi' ? (spec.paint === 0xe0a818 ? 0x121316 : spec.paint === 0x1f5a36 ? 0xe07818 : spec.paint) : spec.paint));
  const wrap = adOf(spec)?.wrap !== undefined ? lin(adOf(spec)!.wrap!) : null;
  // The wrap covers the rear doors: between the first two door seams, from the sill to the beltline.
  const wrapX: Range = [d.seams[0] + 0.02, d.seams[1] - 0.02];
  const BLACK: V3 = [0.012, 0.012, 0.013];
  const CHROME: V3 = [0.85, 0.86, 0.88];
  const TRIM: V3 = [0.02, 0.02, 0.022];

  const { top, belt, halfW, bottom, section } = shapeOf(d);
  const isHood = (x: number): boolean => top(x) - Math.min(belt(x), top(x) - 0.02) < 0.14;

  // Stations and the full ring (right half then the mirrored left half).
  const step = spec.detail ?? 0.05;
  // Stations every `step`, and at the profile's keys and the glass's ends, so a coarse body keeps its
  // silhouette (a van's upright back, a windscreen's foot).
  const keys = [...d.top.map((p) => p[0]), ...d.windscreen, ...d.rearGlass].filter((x) => x > d.x0 + 0.004 && x < d.L - 0.004);
  const regular = Array.from({ length: Math.ceil((d.L - d.x0) / step - 1e-6) }, (_, i) => d.x0 + i * step);
  const xs: number[] = [];
  for (const x of [...regular, ...keys].sort((a, b) => a - b)) {
    if (!xs.length || x - xs[xs.length - 1] > 0.008) xs.push(x);
  }
  if (d.L - xs[xs.length - 1] < 0.008) xs.pop();
  xs.push(d.L);
  const H = 11;
  const ringOf = (x: number): V3[] => {
    const h = section(x);
    const ring: V3[] = h.map(([y, z]) => [x, y, z]);
    for (let k = H - 2; k >= 1; k--) ring.push([x, h[k][0], -h[k][1]]);
    return ring;
  };
  const grid = xs.map(ringOf);
  const R = grid[0].length;
  const centre = (i: number): V3 => {
    const g = grid[i];
    return [xs[i], (g[0][1] + g[H - 1][1]) / 2, 0];
  };
  const normals = grid.map((ring, i) =>
    ring.map((p, j) => {
      const a = grid[Math.min(i + 1, grid.length - 1)][j];
      const b = grid[Math.max(i - 1, 0)][j];
      const c = ring[(j + 1) % R];
      const e = ring[(j - 1 + R) % R];
      const t1: V3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const t2: V3 = [c[0] - e[0], c[1] - e[1], c[2] - e[2]];
      let n: V3 = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
      const o = centre(i);
      const out: V3 = [0, p[1] - o[1], p[2]];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      return [n[0] / l, n[1] / l, n[2] / l] as V3;
    }),
  );

  /** Material for the loft quad between stations at xm, half-ring segment k (0 = underside). */
  const classify = (xm: number, k: number, hood: boolean): void => {
    const e = Math.min(xm - d.x0, d.L - xm);
    mb.kind = KIND.gloss;
    mb.color = paint;
    mb.style = [0, 0, 0, 0];
    if (k === 0) {
      mb.kind = KIND.plain;
      mb.color = BLACK;
      return;
    }
    if (k <= 3 && e < 0.22 && d.bumper !== 'body') {
      mb.kind = d.bumper === 'chrome' ? KIND.chrome : KIND.gloss;
      mb.color = d.bumper === 'chrome' ? CHROME : BLACK;
      return;
    }
    if (spec.type === 'keitruck' && k <= 2) {
      mb.color = BLACK;
      return;
    }
    if (wrap && k >= 2 && k <= 4 && within(xm, wrapX)) {
      mb.color = wrap;
      return;
    }
    if (d.chromeBelt && k === 5 && within(xm, [d.rearGlass[0], d.windscreen[1]])) {
      mb.kind = KIND.chrome;
      mb.color = CHROME;
      return;
    }
    if (spec.type === 'police' && (xm > d.windscreen[1] || xm < d.rearGlass[0])) {
      // The patrol car's bonnet, boot and both ends are black; the cabin white over black.
      mb.color = paint2;
      return;
    }
    if (d.twoTone && k < d.twoTone) {
      mb.color = paint2;
      return;
    }
    if (hood) return;
    if (d.softTop && xm < d.windscreen[0] && k >= 6) {
      mb.kind = k === 6 && within(xm, d.sideGlass) ? KIND.glass : KIND.plain;
      if (mb.kind === KIND.plain) mb.color = [0.022, 0.022, 0.025];
      return;
    }
    if (k >= 5 && !d.twoTone) mb.color = paint2;
    if (k === 6) {
      if (within(xm, d.sideGlass) && !d.pillars.some((p) => within(xm, p))) {
        mb.kind = KIND.glass;
      } else if (d.blackPillars && within(xm, d.sideGlass)) {
        mb.color = BLACK;
      }
      return;
    }
    if (k >= 8 && (within(xm, d.windscreen) || within(xm, d.rearGlass))) mb.kind = KIND.glass;
  };

  // The loft.
  for (let i = 0; i + 1 < grid.length; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2;
    const hood = isHood(xm);
    for (let j = 0; j < R; j++) {
      const j1 = (j + 1) % R;
      const k = j < H - 1 ? j : R - j - 1; // mirror the segment index for the left half
      classify(xm, k, hood);
      // A side window into its own builder, when asked (the body keeps the opening).
      const out = spec.sideWindows && k === 6 && mb.kind === KIND.glass ? (grid[i][j][2] + grid[i][j1][2] > 0 ? spec.sideWindows.left : spec.sideWindows.right) : mb;
      if (out !== mb) {
        out.kind = mb.kind;
        out.color = mb.color;
        out.style = mb.style;
        out.flags = mb.flags;
        out.id = mb.id;
      }
      out.quadN(P(...grid[i][j]), P(...grid[i + 1][j]), P(...grid[i + 1][j1]), P(...grid[i][j1]), N(normals[i][j]), N(normals[i + 1][j]), N(normals[i + 1][j1]), N(normals[i][j1]));
    }
  }
  // End caps (the rear of the kei truck's cab, the front and rear faces of the others).
  for (const [i, dir] of [[0, -1], [grid.length - 1, 1]] as const) {
    const ring = grid[i];
    const c = centre(i);
    const nn: V3 = N([dir, 0, 0]);
    mb.kind = d.bumper === 'chrome' ? KIND.gloss : KIND.gloss;
    mb.color = spec.type === 'police' ? paint2 : paint;
    for (let j = 0; j < R; j++) {
      const a = ring[j];
      const b = ring[(j + 1) % R];
      mb.quadN(P(...c), P(...a), P(...b), P(...b), nn, nn, nn, nn);
    }
  }

  /** Does the body contain the point? (the loft's cross-section at x, by height) */
  const inside = (x: number, y: number, z: number): boolean => {
    const h = section(x);
    if (y < h[0][0] || y > h[H - 1][0]) return false;
    let zmax = -1;
    for (let k = 0; k + 1 < H; k++) {
      const [ya, za] = h[k];
      const [yb, zb] = h[k + 1];
      if (y >= Math.min(ya, yb) && y <= Math.max(ya, yb)) zmax = Math.max(zmax, yb === ya ? Math.max(za, zb) : za + ((zb - za) * (y - ya)) / (yb - ya));
    }
    return Math.abs(z) <= zmax;
  };
  /** x of the front (dir 1) or rear (dir -1) skin at (y, z): step in from the end, then bisect. */
  const skinX = (y: number, z: number, dir: number): number => {
    const start = dir > 0 ? d.L : d.x0;
    let out = start;
    let inn = start;
    for (let t = 0; t <= 1.2; t += 0.02) {
      const x = start - dir * t;
      if (inside(x, y, z)) {
        inn = x;
        break;
      }
      out = x;
    }
    for (let i = 0; i < 12; i++) {
      const m = (out + inn) / 2;
      if (inside(m, y, z)) inn = m;
      else out = m;
    }
    return inn;
  };
  /**
   * A detail panel (lights, grille, plate) conforming to the front (dir 1) or rear (dir -1) skin over
   * y0..y1 x z0..z1, lifted a few millimetres off it; subdivided so it follows the curvature.
   */
  const panelX = (lift: number, y0: number, y1: number, z0: number, z1: number, dir: number, into: MeshBuilder = mb): void => {
    const nu = 4;
    const nv = 3;
    // (Each corner is shared by up to four cells: find it once.)
    const pts: ({ p: V3; n: V3 } | undefined)[] = [];
    const pt = (i: number, j: number): { p: V3; n: V3 } => (pts[i * (nv + 1) + j] ??= ptAt(i, j));
    const ptAt = (i: number, j: number): { p: V3; n: V3 } => {
      const y = y0 + ((y1 - y0) * j) / nv;
      const z = z0 + ((z1 - z0) * i) / nu;
      const x = skinX(y, z, dir);
      const e = 0.01;
      const dxdy = (skinX(y + e, z, dir) - skinX(y - e, z, dir)) / (2 * e);
      const dxdz = (skinX(y, z + e, dir) - skinX(y, z - e, dir)) / (2 * e);
      const nn: V3 = [dir, -dxdy * dir, -dxdz * dir];
      const l = Math.hypot(nn[0], nn[1], nn[2]);
      const n: V3 = [nn[0] / l, nn[1] / l, nn[2] / l];
      const off = 0.004 + lift;
      return { p: P(x + n[0] * off, y + n[1] * off, z + n[2] * off), n: N(n) };
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = pt(i, j);
        const b = pt(i + 1, j);
        const c = pt(i + 1, j + 1);
        const e2 = pt(i, j + 1);
        into.quadN(a.p, b.p, c.p, e2.p, a.n, b.n, c.n, e2.n);
      }
    }
  };
  const boxL = boxer(mb, P, N);

  /** The brush for a headlamp's lens: lit on the lamp channel, or (a parked car, or one whose lamps are apart) plain glass. */
  const lens = (): void => {
    const on = spec.lamps !== false && !spec.lampParts;
    mb.kind = on ? KIND.emit : KIND.gloss;
    mb.style = [on ? EMIT.lamp : 0, 0, 0, 0];
    mb.color = on ? [0.95, 0.9, 0.8] : [0.5, 0.5, 0.48];
  };

  // Front: grille (chrome surround and dark slats), headlights, plate.
  const [gy0, gy1, , gz] = d.grille;
  mb.kind = d.grilleChrome ? KIND.chrome : KIND.gloss;
  mb.color = d.grilleChrome ? CHROME : TRIM;
  panelX(0, gy0, gy1, -gz, gz, 1);
  mb.kind = KIND.gloss;
  mb.color = TRIM;
  const slats = Math.max(2, Math.round((gy1 - gy0) / 0.06));
  for (let i = 0; i < slats; i++) {
    const y = gy0 + 0.025 + ((gy1 - gy0 - 0.05) * (i + 0.2)) / slats;
    panelX(0.002, y, y + ((gy1 - gy0 - 0.05) / slats) * 0.55, -gz + 0.03, gz - 0.03, 1);
  }
  const [hy0, hy1, hz0, hz1] = d.head;
  for (const sd of [-1, 1]) {
    mb.kind = KIND.chrome;
    mb.color = [0.9, 0.9, 0.92];
    panelX(0, hy0, hy1, sd * hz0, sd * hz1, 1);
    // Lens: emissive on the lamp channel, so headlights are on at night and dark glass by day.
    lens();
    panelX(0.002, hy0 + (hy1 - hy0) * 0.25, hy1 - (hy1 - hy0) * 0.25, sd * (hz0 + 0.04), sd * (hz0 + 0.04 + (hz1 - hz0) * 0.35), 1);
    if (spec.lampParts) panelX(0.004, hy0 + (hy1 - hy0) * 0.25, hy1 - (hy1 - hy0) * 0.25, sd * (hz0 + 0.04), sd * (hz0 + 0.04 + (hz1 - hz0) * 0.35), 1, spec.lampParts.head);
    mb.style = [0, 0, 0, 0];
    // Amber indicator at the outer end.
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = [0.12, 0.05, 0.0];
    panelX(0.002, hy0 + 0.01, hy0 + 0.035, sd * (hz1 - 0.08), sd * (hz1 - 0.01), 1);
    mb.style = [0, 0, 0, 0];
  }
  const plateColor: V3 = d.plate === 'yellow' ? lin(0xe8c020) : d.plate === 'green' ? lin(0x1e5a32) : lin(0xeeeee8);
  mb.kind = KIND.plain;
  mb.color = plateColor;
  panelX(0.004, d.plateY[0], d.plateY[1], -0.165, 0.165, 1);
  // Rear: tail lights, plate.
  const [ty0, ty1, tz0, tz1] = d.tail;
  // (The trucks' are on the frame at the back, below: `rearLamps`.)
  const truck = spec.type === 'keitruck' || spec.type === 'boxtruck';
  for (const sd of truck ? [] : [-1, 1]) {
    // Tail lights: dim red by day (always channel) with a brighter lamp layer at night.
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = [0.14, 0.004, 0.004];
    panelX(0, ty0, ty1, sd * tz0, sd * tz1, -1);
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = [0.3, 0.006, 0.004];
    if (spec.lampParts) panelX(0.003, ty0 + (ty1 - ty0) * 0.35, ty1 - (ty1 - ty0) * 0.15, sd * (tz0 + 0.02), sd * (tz1 - 0.02), -1, spec.lampParts.tail);
    else if (spec.lamps !== false) panelX(0.001, ty0 + (ty1 - ty0) * 0.35, ty1 - (ty1 - ty0) * 0.15, sd * (tz0 + 0.02), sd * (tz1 - 0.02), -1);
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = [0.1, 0.045, 0.0];
    panelX(0.002, ty0, ty0 + (ty1 - ty0) * 0.3, sd * tz0, sd * (tz0 + (tz1 - tz0) * 0.4), -1);
    mb.style = [0, 0, 0, 0];
    // The reversing lamp: in the lower strip, outboard of the amber.
    if (spec.lampParts) panelX(0.004, ty0, ty0 + (ty1 - ty0) * 0.3, sd * (tz0 + (tz1 - tz0) * 0.45), sd * (tz0 + (tz1 - tz0) * 0.75), -1, spec.lampParts.reverse);
    if (brake) panelX(0.012, ty0 + (ty1 - ty0) * 0.3, ty1, sd * tz0, sd * tz1, -1, brake);
  }
  mb.kind = KIND.plain;
  mb.color = plateColor;
  const rpy = spec.type === 'keitruck' ? [0.5, 0.62] : [d.plateY[0] + 0.18, d.plateY[1] + 0.18];
  if (!truck) panelX(0.004, rpy[0], rpy[1], -0.165, 0.165, -1);

  // Door seams and handles on both sides, following the body surface.
  for (const sx of d.seams) {
    const h = section(sx);
    for (const sd of [-1, 1]) {
      mb.kind = KIND.plain;
      mb.color = TRIM;
      for (let k = 2; k < 6; k++) {
        const [ya, za] = h[k];
        const [yb, zb] = h[k + 1];
        const n: V3 = N([0, za - zb, sd * (yb - ya)]);
        const o = 0.003;
        mb.quadN(P(sx - 0.005, ya, sd * (za + o)), P(sx + 0.005, ya, sd * (za + o)), P(sx + 0.005, yb, sd * (zb + o)), P(sx - 0.005, yb, sd * (zb + o)), n, n, n, n);
      }
      // Handle just behind the seam's front edge (the door it opens is ahead of it).
      if (sx < d.L - 0.5) {
        const hy = h[5][0] - 0.07;
        const hz = h[4][1] + 0.006;
        mb.kind = KIND.chrome;
        mb.color = CHROME;
        const n = N([0, 0, sd]);
        mb.quadN(P(sx + 0.1, hy, sd * hz), P(sx + 0.26, hy, sd * hz), P(sx + 0.26, hy + 0.03, sd * hz), P(sx + 0.1, hy + 0.03, sd * hz), n, n, n, n);
      }
    }
  }

  // Mirrors (`mirrorPlan`): door mirrors at the base of the A-pillar, or wing mirrors out on the front wings (the
  // classic taxi's, and a 70s saloon's in chrome). Each is a shell that tapers forward from its rim to a blunt nose,
  // swept in toward the car, on an arm or a stalk; in the rim a dark bezel, and the glass set back in it. (They were
  // two boxes with a pane stuck on the back, which the user called bad once he could see them from the cab.)
  for (const sd of [-1, 1]) {
    const M = mirrorPlan(d, spec.type as CarType, { top, halfW, section }, sd);
    const fine = (spec.detail ?? 0.1) <= 0.13;
    // A point of the head: `t` in from the rim (m), across (outboard) and up from its middle.
    const at = (t: number, x: number, y: number): V3 => [M.c[0] - M.b[0] * t + M.a[0] * x + M.u[0] * y, M.c[1] - M.b[1] * t + M.a[1] * x + M.u[1] * y, M.c[2] - M.b[2] * t + M.a[2] * x + M.u[2] * y];
    // A flat face through four points, turned to face `out`.
    const face = (p0: V3, p1: V3, p2: V3, p3: V3, out: V3): void => {
      const e1: V3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const e2: V3 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
      let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / len, n[1] / len, n[2] / len];
      const flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
      if (flip) n = [-n[0], -n[1], -n[2]];
      const w = N(n);
      if (flip) mb.quadN(P(...p0), P(...p3), P(...p2), P(...p1), w, w, w, w);
      else mb.quadN(P(...p0), P(...p1), P(...p2), P(...p3), w, w, w, w);
    };
    const { hw, hh, depth } = M;
    const c = 0.34 * Math.min(hw, hh);
    const outline: [number, number][] = fine
      ? [[hw, -(hh - c)], [hw, hh - c], [hw - c, hh], [-(hw - c), hh], [-hw, hh - c], [-hw, -(hh - c)], [-(hw - c), -hh], [hw - c, -hh]]
      : [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
    const n = outline.length;
    // The shell's sections from the rim forward: how far in, how big, and how far swept in toward the car.
    const rings: [number, number, number][] = fine ? [[0, 1, 0], [0.3 * depth, 1, 0], [0.72 * depth, 0.84, 0.14 * hw], [depth, 0.5, 0.34 * hw]] : [[0, 1, 0], [0.5 * depth, 0.95, 0.05 * hw], [depth, 0.55, 0.3 * hw]];
    const ringAt = (k: number): V3[] => outline.map(([x, y]) => at(rings[k][0], x * rings[k][1] - rings[k][2], y * rings[k][1]));
    const radial = (i: number): V3 => {
      const x = (outline[i][0] + outline[(i + 1) % n][0]) / 2;
      const y = (outline[i][1] + outline[(i + 1) % n][1]) / 2;
      return [M.a[0] * x + M.u[0] * y, M.a[1] * x + M.u[1] * y, M.a[2] * x + M.u[2] * y];
    };
    const body: V3 = M.wing ? (d.fenderMirrors === 'chrome' ? CHROME : BLACK) : spec.type === 'keitruck' ? BLACK : paint;
    mb.kind = M.wing && d.fenderMirrors === 'chrome' ? KIND.chrome : KIND.gloss;
    mb.color = body;
    for (let k = 0; k + 1 < rings.length; k++) {
      const r0 = ringAt(k);
      const r1 = ringAt(k + 1);
      for (let i = 0; i < n; i++) face(r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i], radial(i));
    }
    const nose = ringAt(rings.length - 1);
    const fwd: V3 = [-M.b[0], -M.b[1], -M.b[2]];
    if (fine) for (const q of [[0, 1, 2, 3], [0, 3, 4, 7], [4, 5, 6, 7]]) face(nose[q[0]], nose[q[1]], nose[q[2]], nose[q[3]], fwd);
    else face(nose[0], nose[1], nose[2], nose[3], fwd);
    // The rim's bezel, the well behind it, and the glass at its bottom.
    const well = fine ? 0.03 : 0.012;
    const inner = (t: number): V3[] => outline.map(([x, y]) => at(t, x * 0.86, y * 0.86));
    const rim = ringAt(0);
    const i0 = inner(0);
    const i1 = inner(well);
    mb.kind = KIND.plain;
    mb.color = TRIM;
    for (let i = 0; i < n; i++) {
      face(rim[i], rim[(i + 1) % n], i0[(i + 1) % n], i0[i], M.b);
      const r = radial(i);
      face(i0[i], i0[(i + 1) % n], i1[(i + 1) % n], i1[i], [-r[0], -r[1], -r[2]]);
    }
    mb.kind = KIND.chrome;
    mb.color = [0.5, 0.56, 0.62];
    if (fine) for (const q of [[0, 1, 2, 3], [0, 3, 4, 7], [4, 5, 6, 7]]) face(i1[q[0]], i1[q[1]], i1[q[2]], i1[q[3]], M.b);
    else face(i1[0], i1[1], i1[2], i1[3], M.b);
    // Its arm out of the door, or its stalk up from the wing.
    mb.kind = M.wing && d.fenderMirrors === 'chrome' ? KIND.chrome : KIND.gloss;
    mb.color = M.wing ? body : BLACK;
    mb.beam(P(...M.foot), P(...(M.wing ? at(0.5 * depth, 0, -hh * 0.8) : at(0.55 * depth, -hw * 0.7, -hh * 0.3))), M.wing ? 0.018 : 0.04);
  }

  if (isTaxi(spec.type)) {
    // Roof andon (lit company sign) and the red "vacant" sign low in the windscreen.
    const ax = adOf(spec)?.roof ? d.windscreen[0] - 0.25 : spec.type === 'taxi2' ? 2.6 : 2.45;
    const ay = top(ax);
    mb.kind = KIND.chrome;
    mb.color = CHROME;
    boxL(ax - 0.12, ax + 0.12, ay, ay + 0.025, -0.2, 0.2);
    // Lamp body: a tent-shaped prism across the roof, glowing front and back, with tinted end caps.
    const tent: [number, number][] = [[-0.1, 0.025], [0.1, 0.025], [0.05, 0.19], [-0.05, 0.19]];
    const glow: V3 = spec.paint === 0xe0a818 ? [0.62, 0.58, 0.5] : [0.62, 0.44, 0.08];
    for (let i = 0; i < 4; i++) {
      const [ua, va] = tent[i];
      const [ub, vb] = tent[(i + 1) % 4];
      // Front and back glow, except on a parked taxi (plain tinted plastic).
      const lit = (i === 1 || i === 3) && spec.lamps !== false;
      const face = i === 1 || i === 3;
      mb.kind = lit ? KIND.emit : KIND.gloss;
      mb.style = [lit ? EMIT.lamp : 0, 0, 0, 0];
      mb.color = face ? glow : BLACK;
      const nl = Math.hypot(vb - va, ub - ua) || 1;
      const n = N([(vb - va) / nl, -(ub - ua) / nl, 0]);
      mb.quadN(P(ax + ua, ay + va, -0.2), P(ax + ub, ay + vb, -0.2), P(ax + ub, ay + vb, 0.2), P(ax + ua, ay + va, 0.2), n, n, n, n);
    }
    mb.kind = KIND.gloss;
    mb.style = [0, 0, 0, 0];
    mb.color = glow;
    for (const zc of [-0.2, 0.2]) {
      const n = N([0, 0, Math.sign(zc)]);
      mb.quadN(P(ax - 0.1, ay + 0.025, zc), P(ax + 0.1, ay + 0.025, zc), P(ax + 0.05, ay + 0.19, zc), P(ax - 0.05, ay + 0.19, zc), n, n, n, n);
    }
    // The vacancy sign: lit while on the road, dark red plastic parked.
    const vacant = spec.lamps !== false;
    mb.kind = vacant ? KIND.emit : KIND.gloss;
    mb.style = [vacant ? EMIT.always : 0, 0, 0, 0];
    mb.color = vacant ? [0.5, 0.02, 0.02] : [0.22, 0.02, 0.02];
    const vx0 = d.windscreen[1] - 0.12;
    const vx1 = d.windscreen[1] - 0.04;
    const n = N([0.8, 0.6, 0]);
    mb.quadN(P(vx0, top(vx0) + 0.004, 0.2), P(vx1, top(vx1) + 0.004, 0.2), P(vx1, top(vx1) + 0.004, 0.45), P(vx0, top(vx0) + 0.004, 0.45), n, n, n, n);
    mb.style = [0, 0, 0, 0];
  }
  if (d.bumper === 'chrome') {
    mb.kind = KIND.chrome;
    mb.color = CHROME;
    boxL(d.L - 0.02, d.L + 0.08, 0.33, 0.47, -(d.W - 0.06), d.W - 0.06);
    boxL(d.x0 - 0.08, d.x0 + 0.02, 0.35, 0.49, -(d.W - 0.06), d.W - 0.06);
  }
  if (d.popups) {
    // Pop-up headlamps, raised: a pod each side at the nose, in the body colour, the lamp facing forward.
    for (const sd of [-1, 1]) {
      const x0 = d.L - 0.44;
      const x1 = d.L - 0.2;
      const z0 = sd * 0.4;
      const z1 = sd * (d.W - 0.1);
      const y = Math.min(top(x0), top(x1)) - 0.01;
      mb.kind = KIND.gloss;
      mb.color = paint;
      boxL(x0, x1, y, y + 0.16, Math.min(z0, z1), Math.max(z0, z1));
      mb.kind = KIND.gloss;
      mb.color = TRIM;
      boxL(x1, x1 + 0.006, y + 0.02, y + 0.145, Math.min(z0, z1) + 0.015, Math.max(z0, z1) - 0.015);
      lens();
      const n = N([1, 0, 0]);
      const za = Math.min(z0, z1) + 0.04;
      const zb = Math.max(z0, z1) - 0.04;
      mb.quadN(P(x1 + 0.008, y + 0.04, za), P(x1 + 0.008, y + 0.04, zb), P(x1 + 0.008, y + 0.125, zb), P(x1 + 0.008, y + 0.125, za), n, n, n, n);
      spec.lampParts?.head.quadN(P(x1 + 0.011, y + 0.04, za), P(x1 + 0.011, y + 0.04, zb), P(x1 + 0.011, y + 0.125, zb), P(x1 + 0.011, y + 0.125, za), n, n, n, n);
      mb.style = [0, 0, 0, 0];
    }
  }
  if (d.hoodVent) {
    // A dark vent in the middle of the bonnet.
    mb.kind = KIND.plain;
    mb.color = TRIM;
    const x0 = d.L - 1.25;
    const x1 = d.L - 0.85;
    const n = N([0, 1, 0]);
    mb.quadN(P(x0, top(x0) + 0.006, -0.24), P(x0, top(x0) + 0.006, 0.24), P(x1, top(x1) + 0.006, 0.24), P(x1, top(x1) + 0.006, -0.24), n, n, n, n);
  }
  if (d.wing) {
    mb.kind = KIND.gloss;
    if (d.wing === 'lip') {
      // A small visor at the top of the hatch, where the roof ends, standing out over the glass: level with
      // the roof at its front edge, the glass falling away beneath it.
      const x1 = d.rearGlass[1] - 0.04;
      const y = top(x1) - 0.012;
      mb.color = paint;
      boxL(x1 - 0.24, x1, y, y + 0.022, -(d.W - d.roofInset - 0.08), d.W - d.roofInset - 0.08);
    } else {
      // A blade across the tail on two posts (tall), or on end legs sweeping down to the flanks (hoop).
      const gt = d.wing === 'gt';
      const x0 = 0.06;
      const x1 = gt ? 0.36 : 0.32;
      const deck = top(0.25);
      const y = deck + (gt ? 0.2 : 0.09);
      const zw = d.W - 0.05;
      mb.color = paint;
      boxL(x0, x1, y, y + 0.035, -zw, zw);
      if (gt) {
        mb.color = BLACK;
        for (const zp of [-0.55, 0.55]) boxL(0.17, 0.25, deck - 0.02, y, zp - 0.02, zp + 0.02);
        mb.color = paint;
        for (const sd of [-1, 1]) boxL(x0 - 0.02, x1 + 0.02, y - 0.06, y + 0.07, sd * zw - 0.012, sd * zw + 0.012);
      } else {
        for (const sd of [-1, 1]) boxL(x0 + 0.02, x1 - 0.02, deck - 0.04, y + 0.02, sd * (zw - 0.05) - 0.03, sd * (zw - 0.05) + 0.03);
      }
    }
  }
  if (spec.type === 'minivan' || spec.type === 'van' || spec.type === 'keivan') {
    // Sliding-door rail along the rear quarter, back from the door.
    mb.kind = KIND.plain;
    mb.color = TRIM;
    const x1 = d.seams[0];
    for (const sd of [-1, 1]) {
      const y = section(1.0)[5][0] - 0.02;
      const n = N([0, 0, sd]);
      mb.quadN(P(0.3, y, sd * (d.W + 0.004)), P(x1, y, sd * (d.W + 0.004)), P(x1, y + 0.025, sd * (d.W + 0.004)), P(0.3, y + 0.025, sd * (d.W + 0.004)), n, n, n, n);
    }
  }
  /**
   * A truck's tail lamps, on the frame at the back (x: the face they stand on) over y0..y1 at the outer corners:
   * dim red by day, a lamp layer at night, and the brake lights for the traffic.
   */
  const rearLamps = (x: number, y0: number, y1: number): void => {
    for (const sd of [-1, 1]) {
      const [z0, z1] = [sd * (d.W - 0.3), sd * (d.W - 0.06)];
      const [zl, zh] = [Math.min(z0, z1), Math.max(z0, z1)];
      mb.kind = KIND.emit;
      mb.style = [EMIT.always, 0, 0, 0];
      mb.color = [0.14, 0.004, 0.004];
      boxL(x - 0.05, x, y0, y1, zl, zh);
      const back = N([-1, 0, 0]);
      const face = (into: MeshBuilder, fx: number, ya: number, yb: number): void =>
        into.quadN(P(fx, ya, zl + 0.02), P(fx, ya, zh - 0.02), P(fx, yb, zh - 0.02), P(fx, yb, zl + 0.02), back, back, back, back);
      if (spec.lamps !== false) {
        mb.style = [EMIT.lamp, 0, 0, 0];
        mb.color = [0.3, 0.006, 0.004];
        face(mb, x - 0.052, y0 + (y1 - y0) * 0.62, y1 - 0.015);
      }
      if (brake) face(brake, x - 0.06, y0 + 0.02, y1 - 0.01);
      mb.style = [0, 0, 0, 0];
    }
  };
  if (spec.type === 'keitruck') {
    // Flat bed with drop sides, a headboard guard behind the cab, chassis and mud flaps.
    mb.kind = KIND.plain;
    mb.color = BLACK;
    boxL(0.3, 1.95, 0.35, 0.62, -0.45, 0.45);
    mb.kind = KIND.gloss;
    mb.color = lin(0x6a6a6a);
    boxL(0.02, 1.93, 0.62, 0.68, -d.W + 0.01, d.W - 0.01);
    mb.color = paint;
    boxL(0.02, 1.93, 0.68, 0.93, d.W - 0.04, d.W);
    boxL(0.02, 1.93, 0.68, 0.93, -d.W, -d.W + 0.04);
    boxL(0.0, 0.04, 0.5, 0.93, -d.W, d.W);
    mb.kind = KIND.gloss;
    mb.color = BLACK;
    for (const z of [-0.6, -0.3, 0, 0.3, 0.6]) boxL(1.9, 1.93, 0.93, 1.95, z - 0.015, z + 0.015);
    boxL(1.9, 1.93, 1.92, 1.96, -d.W + 0.02, d.W - 0.02);
    boxL(1.9, 1.93, 1.3, 1.33, -d.W + 0.02, d.W - 0.02);
    // Rear plate on the tailgate.
    mb.kind = KIND.plain;
    mb.color = plateColor;
    const rear = N([-1, 0, 0]);
    mb.quadN(P(-0.004, 0.56, -0.165), P(-0.004, 0.56, 0.165), P(-0.004, 0.72, 0.165), P(-0.004, 0.72, -0.165), rear, rear, rear, rear);
    mb.kind = KIND.plain;
    mb.color = BLACK;
    for (const sd of [-1, 1]) boxL(0.25, 0.27, 0.12, 0.5, sd * (d.W - 0.25), sd * (d.W - 0.03));
    // Tail lamps low on the rear corners, under the tailgate.
    rearLamps(0.02, 0.36, 0.49);
  }
  if (spec.type === 'boxtruck') {
    // The box (aluminium, paint2) on a subframe, the chassis rails under it, the rear doors, a rub rail along
    // each side, side guards between the axles, the fuel tank, the rear bar with the lamps and plate.
    const bw = d.W + 0.03;
    const zs = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
    mb.kind = KIND.plain;
    mb.color = BLACK;
    boxL(-0.05, 3.6, 0.55, 0.88, -0.42, 0.42);
    mb.color = [0.05, 0.05, 0.055];
    boxL(0.05, 3.02, 0.88, 0.98, -bw + 0.06, bw - 0.06);
    mb.kind = KIND.gloss;
    mb.color = paint2;
    boxL(0.0, 3.02, 0.98, 3.05, -bw, bw);
    mb.color = lin(0x8a8d90);
    for (const sd of [-1, 1]) {
      boxL(0.02, 3.0, 1.02, 1.1, ...zs(sd * bw, sd * (bw + 0.02)));
      boxL(0.0, 3.02, 2.98, 3.05, ...zs(sd * bw, sd * (bw + 0.012)));
    }
    // Rear doors: the gap down the middle, the frame, four lock rods with their handles.
    const back = N([-1, 0, 0]);
    const rq = (x: number, y0: number, y1: number, z0: number, z1: number): void => mb.quadN(P(x, y0, z0), P(x, y0, z1), P(x, y1, z1), P(x, y1, z0), back, back, back, back);
    mb.kind = KIND.plain;
    mb.color = BLACK;
    rq(-0.003, 1.0, 3.0, -0.01, 0.01);
    mb.kind = KIND.gloss;
    mb.color = lin(0x9a9da0);
    rq(-0.004, 0.98, 1.06, -bw, bw);
    rq(-0.004, 2.96, 3.05, -bw, bw);
    for (const sd of [-1, 1]) rq(-0.004, 0.98, 3.05, ...zs(sd * bw, sd * (bw - 0.06)));
    mb.kind = KIND.chrome;
    mb.color = CHROME;
    for (const zr of [-0.62, -0.18, 0.18, 0.62]) {
      rq(-0.008, 1.08, 2.94, zr - 0.012, zr + 0.012);
      rq(-0.012, 1.7, 1.76, ...zs(zr, zr + (zr < 0 ? 0.12 : -0.12)));
    }
    mb.kind = KIND.plain;
    mb.color = BLACK;
    for (const sd of [-1, 1]) {
      boxL(1.55, 3.2, 0.45, 0.55, ...zs(sd * (d.W - 0.06), sd * (d.W - 0.02)));
      boxL(0.62, 0.66, 0.2, 0.6, ...zs(sd * (d.W - 0.3), sd * (d.W - 0.05)));
    }
    mb.kind = KIND.gloss;
    mb.color = lin(0x7a7d80);
    boxL(1.75, 2.35, 0.42, 0.78, -d.W + 0.06, -d.W + 0.36);
    mb.kind = KIND.plain;
    mb.color = BLACK;
    boxL(-0.06, 0.06, 0.38, 0.56, -(d.W - 0.02), d.W - 0.02);
    rearLamps(-0.06, 0.4, 0.54);
    mb.kind = KIND.plain;
    mb.color = plateColor;
    rq(-0.066, 0.4, 0.52, -0.165, 0.165);
  }
  if (spec.type === 'police') {
    // The gold emblem on the grille.
    mb.kind = KIND.chrome;
    mb.color = [0.78, 0.56, 0.16];
    const gm = (d.grille[0] + d.grille[1]) / 2;
    panelX(0.012, gm - 0.05, gm + 0.05, -0.05, 0.05, 1);
    // The light bar across the roof (red, glowing), an aerial on the boot.
    const ax = (d.rearGlass[1] + d.windscreen[0]) / 2;
    const ay = top(ax);
    mb.kind = KIND.gloss;
    mb.color = BLACK;
    boxL(ax - 0.13, ax + 0.13, ay, ay + 0.05, -0.56, 0.56);
    const bar = spec.lamps !== false;
    mb.kind = bar ? KIND.emit : KIND.gloss;
    mb.style = [bar ? EMIT.always : 0, 0, 0, 0];
    mb.color = bar ? [0.42, 0.02, 0.02] : [0.3, 0.02, 0.02];
    for (const sd of [-1, 1]) boxL(ax - 0.11, ax + 0.11, ay + 0.05, ay + 0.15, Math.min(sd * 0.16, sd * 0.55), Math.max(sd * 0.16, sd * 0.55));
    mb.style = [0, 0, 0, 0];
    mb.kind = KIND.gloss;
    mb.color = [0.3, 0.3, 0.32];
    boxL(ax - 0.1, ax + 0.1, ay + 0.05, ay + 0.13, -0.16, 0.16);
    mb.color = BLACK;
    boxL(0.4, 0.42, top(0.41), top(0.41) + 0.55, 0.3, 0.32);
  }

  if (signs) addVehicleMarks(mb, spec, signs);
  if (spec.type === 'sports') {
    // Ducktail spoiler on posts, and a louvred rear hatch strip.
    const sx = 0.22;
    const sy = top(sx);
    mb.kind = KIND.gloss;
    mb.color = BLACK;
    for (const z of [-0.5, 0.5]) boxL(sx - 0.03, sx + 0.03, sy - 0.02, sy + 0.05, z - 0.02, z + 0.02);
    mb.color = paint;
    boxL(sx - 0.12, sx + 0.08, sy + 0.05, sy + 0.075, -0.74, 0.74);
    mb.color = BLACK;
    for (let i = 0; i < 5; i++) {
      const x = 1.15 + i * 0.14;
      const y = top(x) + 0.006;
      const n = N([-(top(x + 0.02) - top(x - 0.02)) / 0.04, 1, 0]);
      mb.quadN(P(x, y, -0.55), P(x + 0.05, top(x + 0.05) + 0.006, -0.55), P(x + 0.05, top(x + 0.05) + 0.006, 0.55), P(x, y, 0.55), n, n, n, n);
    }
  }
  if (spec.type === 'luxury' || spec.type === 'hardtop') {
    // Stand-up bonnet ornament and chrome sills.
    const ox = d.L - 0.3;
    mb.kind = KIND.chrome;
    mb.color = CHROME;
    boxL(ox - 0.03, ox + 0.03, top(ox), top(ox) + 0.07, -0.006, 0.006);
    for (const sd of [-1, 1]) {
      const n = N([0, 0, sd]);
      const y = section(2.5)[3][0] + 0.02;
      mb.quadN(P(1.4, y, sd * (d.W + 0.006)), P(4.0, y, sd * (d.W + 0.006)), P(4.0, y + 0.03, sd * (d.W + 0.006)), P(1.4, y + 0.03, sd * (d.W + 0.006)), n, n, n, n);
    }
  }
  if (spec.type === 'taxi2') {
    // Sliding rear door rail.
    mb.kind = KIND.plain;
    mb.color = TRIM;
    for (const sd of [-1, 1]) {
      const y = section(1.0)[5][0] - 0.02;
      const n = N([0, 0, sd]);
      mb.quadN(P(0.3, y, sd * (d.W + 0.004)), P(1.44, y, sd * (d.W + 0.004)), P(1.44, y + 0.025, sd * (d.W + 0.004)), P(0.3, y + 0.025, sd * (d.W + 0.004)), n, n, n, n);
    }
  }

  // Livery.
  const lv = spec.livery;
  if (lv?.stripes != null) {
    // Twin stripes along the top, over the flat crown (bonnet, roof, boot), skipping the glass and a soft top.
    mb.kind = KIND.gloss;
    mb.color = lin(lv.stripes);
    const skip = (x: number): boolean => within(x, d.windscreen) || within(x, d.rearGlass) || (!!d.softTop && x > d.rearGlass[0] && x < d.windscreen[0]);
    for (let x = 0.02; x < d.L - 0.04; x += 0.05) {
      const xb = Math.min(d.L - 0.02, x + 0.05);
      if (skip(x) || skip(xb)) continue;
      const ya = top(x) + 0.005;
      const yb = top(xb) + 0.005;
      const n = N([-(yb - ya), xb - x, 0]);
      for (const [z0, z1] of [[0.05, 0.21], [-0.21, -0.05]]) mb.quadN(P(x, ya, z0), P(xb, yb, z0), P(xb, yb, z1), P(x, ya, z1), n, n, n, n);
    }
  }
  if (lv?.side != null) {
    // A band along each flank below the beltline, broken by the wheel arches.
    mb.kind = KIND.gloss;
    mb.color = lin(lv.side);
    for (let x = 0.2; x < d.L - 0.3; x += 0.05) {
      const xb = x + 0.05;
      const yb = Math.min(belt(x), belt(xb)) - 0.1;
      const ya = yb - 0.06;
      if (bottom(x) > ya - 0.02 || bottom(xb) > ya - 0.02) continue;
      for (const sd of [-1, 1]) {
        const n = N([0, 0, sd]);
        mb.quadN(P(x, ya, sd * (halfW(x) + 0.006)), P(xb, ya, sd * (halfW(xb) + 0.006)), P(xb, yb, sd * (halfW(xb) + 0.006)), P(x, yb, sd * (halfW(x) + 0.006)), n, n, n, n);
      }
    }
  }

  // Wheels.
  const lite = (spec.detail ?? 0.05) >= 0.2;
  if (spec.wheels !== false) for (const wx of d.wheelX) for (const sd of [-1, 1]) wheel(mb, P, N, wx, d.wheelR, d.tyreW, sd * (d.W - 0.035), sd, d.rims, lite);
}

/**
 * Where a car's livery text goes, in its frame (the car at the origin pointing +z, +x its left): the door
 * roundel's centre on the left flank (mirror x for the right) and its radius, and the windscreen banner: the
 * top edge of the screen from (y0, z0) at the roof down to (y1, z1), and its half-width.
 */
export function liveryAnchors(type: CarType): { door: { x: number; y: number; z: number; r: number }; banner: { y0: number; z0: number; y1: number; z1: number; half: number } } {
  const d = DESIGNS[type];
  const top = curve(d.top);
  const belt = curve(d.belt);
  const half = d.L / 2;
  const dx = d.seams.length >= 2 ? (d.seams[0] + d.seams[1]) / 2 : d.L / 2;
  const bl = Math.min(belt(dx), top(dx) - 0.02);
  const b = d.clear;
  const r = Math.min(0.2, (bl - b) * 0.36);
  const [w0, w1] = d.windscreen;
  const x0 = w0 + 0.02;
  const x1 = w0 + (w1 - w0) * 0.26;
  return {
    door: { x: d.W + 0.008, y: b + (bl - b) * 0.55, z: dx - half, r },
    banner: { y0: top(x0) + 0.006, z0: x0 - half, y1: top(x1) + 0.006, z1: x1 - half, half: Math.max(0.3, d.W - d.roofInset - 0.12) },
  };
}

/** A wheel's hub in its car's frame (the car at the origin pointing +z; +x is the car's left), and its side. */
export interface WheelSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly front: boolean;
  /** +1 on the left (+x) side, -1 on the right. */
  readonly sd: 1 | -1;
}

/**
 * A vehicle's lettering and ads (the sign builders in `signs`; a roof ad's rack in `mb`): a taxi's ad, a work
 * vehicle's company, the patrol car's markings. Apart from the body (`addVehicle`, which calls it when it's given
 * signs), so a parked car's body can be stamped from one built once and dressed on its own.
 */
/**
 * A car as a handful of faces for the middle distance (parked cars beyond ~130 m, real/props.ts): the body a box
 * to the beltline, the glasshouse a prism from the rear glass to the windscreen with its roof in the paint and
 * dark glass round it, and the wheels as dark blocks; a box truck's box, a kei truck's bed. ~60 triangles against
 * ~2,000 for the lofted car, and it keeps the size, the colour and the cabin's place.
 */
export function addVehicleLow(mb: MeshBuilder, spec: { x: number; z: number; fx: number; fz: number; type: CarType; paint: number }): void {
  const d = DESIGNS[spec.type];
  if (!d) return;
  const f: V3 = [spec.fx, 0, spec.fz];
  const s: V3 = [spec.fz, 0, -spec.fx];
  const half = d.L / 2;
  const P = (x: number, y: number, z: number): V3 => [spec.x + f[0] * (x - half) + s[0] * z, y, spec.z + f[2] * (x - half) + s[2] * z];
  const N = (x: number, y: number, z: number): V3 => [f[0] * x + s[0] * z, y, f[2] * x + s[2] * z];
  const face = (a: V3, b: V3, c: V3, e: V3, n: V3): void => mb.quadN(a, b, c, e, n, n, n, n);
  /** An oriented box: x along the car (from the rear), z across, y up. */
  const box = (x0: number, x1: number, y0: number, y1: number, w: number, top = true): void => {
    face(P(x0, y0, -w), P(x0, y1, -w), P(x0, y1, w), P(x0, y0, w), N(-1, 0, 0));
    face(P(x1, y0, -w), P(x1, y1, -w), P(x1, y1, w), P(x1, y0, w), N(1, 0, 0));
    face(P(x0, y0, -w), P(x1, y0, -w), P(x1, y1, -w), P(x0, y1, -w), N(0, 0, -1));
    face(P(x0, y0, w), P(x1, y0, w), P(x1, y1, w), P(x0, y1, w), N(0, 0, 1));
    if (top) face(P(x0, y1, -w), P(x1, y1, -w), P(x1, y1, w), P(x0, y1, w), N(0, 1, 0));
  };
  const paint = lin(spec.paint);
  const belt = d.belt.reduce((a, p) => a + p[1], 0) / d.belt.length;
  const roof = Math.max(...d.top.map((p) => p[1]));
  const W = d.W;
  mb.style = [0, 0, 0, 0];
  // Wheels first (dark), then the body over them.
  mb.kind = KIND.plain;
  mb.color = [0.02, 0.02, 0.022];
  for (const wx of d.wheelX) box(wx - d.wheelR * 0.9, wx + d.wheelR * 0.9, 0, d.wheelR * 1.6, W - 0.02, false);
  mb.kind = KIND.gloss;
  mb.color = paint;
  box(d.x0 > 0 ? d.x0 : 0, d.L, d.clear + 0.05, belt, W);
  if (spec.type === 'boxtruck') {
    mb.kind = KIND.plain;
    mb.color = lin(0xc4c7ca);
    box(0, d.x0 - 0.05, d.clear + 0.1, 2.6, W + 0.12);
  } else if (d.x0 > 0) {
    // A kei truck's bed behind the cab.
    box(0, d.x0 - 0.05, d.clear + 0.05, belt * 0.85, W);
  }
  // The glasshouse: rear base, rear top, front top, front base; narrower at the roof.
  const xr0 = Math.max(d.x0, d.rearGlass[0]);
  const xr1 = Math.max(d.x0, d.rearGlass[1]);
  const xf1 = d.windscreen[0];
  const xf0 = d.windscreen[1];
  const ri = W - d.roofInset;
  mb.kind = KIND.glass;
  mb.color = [0.012, 0.014, 0.018];
  // Sides (each a quad: the rear and front pillars meet the roof), the rear glass and the windscreen.
  for (const sg of [-1, 1]) face(P(xr0, belt, sg * W), P(xr1, roof, sg * ri), P(xf1, roof, sg * ri), P(xf0, belt, sg * W), N(0, 0.25, sg));
  face(P(xr0, belt, -W), P(xr1, roof, -ri), P(xr1, roof, ri), P(xr0, belt, W), N(-(roof - belt), xr1 - xr0, 0));
  face(P(xf0, belt, -W), P(xf1, roof, -ri), P(xf1, roof, ri), P(xf0, belt, W), N(roof - belt, xf0 - xf1, 0));
  mb.kind = KIND.gloss;
  mb.color = paint;
  face(P(xr1, roof, -ri), P(xf1, roof, -ri), P(xf1, roof, ri), P(xr1, roof, ri), N(0, 1, 0));
  mb.kind = KIND.plain;
}

export function addVehicleMarks(mb: MeshBuilder, spec: VehicleSpec, signs: VehicleSigns): void {
  if (!(spec.type in DESIGNS)) return;
  const d = DESIGNS[spec.type as CarType];
  const { top, section } = shapeOf(d);
  const f: V3 = [spec.fx, 0, spec.fz];
  const s: V3 = [spec.fz, 0, -spec.fx];
  const half = d.L / 2;
  const P = (x: number, y: number, z: number): V3 => [spec.x + f[0] * (x - half) + s[0] * z, y, spec.z + f[2] * (x - half) + s[2] * z];
  const N = (n: V3): V3 => [f[0] * n[0] + s[0] * n[2], n[1], f[2] * n[0] + s[2] * n[2]];
  const boxL = boxer(mb, P, N);
  const paint = lin(spec.paint);
  const paint2 = lin(spec.paint2 ?? (spec.type === 'police' ? 0x101012 : spec.type === 'boxtruck' ? 0xc4c7ca : spec.paint));
  const wrapAd = adOf(spec);
  const wrap = wrapAd?.wrap !== undefined ? lin(wrapAd.wrap) : null;
  const wrapX: Range = [d.seams[0] + 0.02, d.seams[1] - 0.02];
  const CHROME: V3 = [0.85, 0.86, 0.88];
  const sb = signs.sb;

  /** The body's half-width at height y on station x (from its cross-section). */
  const sideAt = (x: number, y: number): number => {
    const h = section(x);
    for (let k = 1; k + 1 < h.length; k++) {
      const [ya, za] = h[k];
      const [yb, zb] = h[k + 1];
      if (y >= ya && y <= yb) return za + ((zb - za) * (y - ya)) / Math.max(1e-6, yb - ya);
    }
    return d.W;
  };
  /**
   * Lettering (decals) along both sides, centred at (xm, ym), h tall (the slot's height) and at most maxLen long, laid
   * on the body (tilted with the tumblehome), or on a flat side `flat` out from the middle (a truck's box).
   */
  const sideText = (text: string, xm: number, ym: number, h: number, maxLen: number, ink: V3, plate: V3, flat?: number): void => {
    const rect = signs.layout.rect(text, false);
    if (!rect) return;
    let w = h * (rect.w / rect.h);
    if (w > maxLen) {
      w = maxLen;
      h = w * (rect.h / rect.w);
    }
    sb.ink = ink;
    sb.plate = plate;
    // A decal: only the letters (the paint shows round them).
    sb.sign = [0, 3];
    const z0 = flat ?? sideAt(xm, ym - h / 2) + 0.007;
    const z1 = flat ?? sideAt(xm, ym + h / 2) + 0.007;
    for (const sd of [-1, 1]) {
      // Reads left to right from outside: along +f on the right side (sd = -1), -f on the left.
      const a0 = sd < 0 ? xm - w / 2 : xm + w / 2;
      const a1 = sd < 0 ? xm + w / 2 : xm - w / 2;
      const c0 = P(a0, ym - h / 2, sd * z0);
      const c1 = P(a1, ym - h / 2, sd * z0);
      const t0 = P(a0, ym + h / 2, sd * z1);
      sb.quad(c0, [c1[0] - c0[0], 0, c1[2] - c0[2]], [t0[0] - c0[0], h, t0[2] - c0[2]], [rect.u0, rect.v0, rect.u1, rect.v1]);
    }
  };
  /** A plain printed band along both sides (blank text), y0..y1 over x0..x1. */
  const band = (x0: number, x1: number, y0: number, y1: number, color: V3, flat: number): void => {
    const [bu, bv] = signs.layout.blankUv;
    sb.plate = color;
    sb.ink = color;
    sb.sign = [0, 2];
    for (const sd of [-1, 1]) {
      const a0 = sd < 0 ? x0 : x1;
      const a1 = sd < 0 ? x1 : x0;
      const c0 = P(a0, y0, sd * flat);
      const c1 = P(a1, y0, sd * flat);
      sb.quad(c0, [c1[0] - c0[0], 0, c1[2] - c0[2]], [0, y1 - y0, 0], [bu, bv, bu, bv]);
    }
  };

  const ad = adOf(spec);
  if (ad) {
    const toW = (x: number, z: number): [number, number, number] => P(x, 0, z);
    const photos = ad.photo !== undefined ? signs.photos : undefined;
    if (photos && ad.photo !== undefined) {
      // Photo roof panel: a lightbox along the car on a chrome rack, photo + brand on both sides.
      const len = 1.05;
      const h = len / photos.roofAspect;
      const ax = d.windscreen[0] - 0.95;
      const ay = top(ax) + 0.04;
      mb.kind = KIND.chrome;
      mb.color = CHROME;
      boxL(ax - len / 2 + 0.05, ax + len / 2 - 0.05, top(ax), ay, -0.04, 0.04);
      // A lightbox on the road; parked, its lamp is off (print).
      photos.sb.sign = [0, spec.lamps === false ? 2 : 1];
      for (const sd of [-1, 1]) {
        const n: [number, number, number] = [s[0] * sd, 0, s[2] * sd];
        const r: [number, number, number] = [n[2], 0, -n[0]];
        signBox(photos.sb, toW(ax, 0), r, n, -len / 2, len / 2, ay, ay + h, 0, 0.04, photos.blankUv, { n: photos.uv(ad.photo, 'roof') });
      }
      // Photo door wrap: fills the rear door, printed (no glow).
      const x0 = wrapX[0] + 0.01;
      const x1 = wrapX[1] - 0.01;
      const xm = (x0 + x1) / 2;
      const yLo = section(xm)[2][0] + 0.03;
      const yHi = section(xm)[5][0] - 0.03;
      let w = x1 - x0;
      let hh = w / photos.doorAspect;
      if (hh > yHi - yLo) {
        hh = yHi - yLo;
        w = hh * photos.doorAspect;
      }
      const ym = (yLo + yHi) / 2;
      photos.sb.sign = [0, 2];
      for (const sd of [-1, 1]) {
        const z = sd * (d.W + 0.012);
        // Reads left to right from outside: along +f on the right side (sd = -1), -f on the left.
        const a0 = sd < 0 ? xm - w / 2 : xm + w / 2;
        const a1 = sd < 0 ? xm + w / 2 : xm - w / 2;
        const c0 = P(a0, ym - hh / 2, z);
        const c1 = P(a1, ym - hh / 2, z);
        photos.sb.quad(c0, [c1[0] - c0[0], 0, c1[2] - c0[2]], [0, hh, 0], photos.uv(ad.photo, 'door'));
      }
    } else if (ad.roof) {
      // Roof ad: a lit panel along the car on a chrome rack, text on both sides.
      const rect = signs.layout.rect(ad.roof, false);
      const len = 1.0;
      const ax = d.windscreen[0] - 0.95;
      const ay = top(ax) + 0.04;
      mb.kind = KIND.chrome;
      mb.color = CHROME;
      boxL(ax - len / 2 + 0.05, ax + len / 2 - 0.05, top(ax), ay, -0.04, 0.04);
      if (rect) {
        const h = Math.min(0.36, len * (rect.h / rect.w) * 1.15);
        signs.sb.ink = lin(ad.ink ?? 0x141418);
        signs.sb.plate = lin(ad.plate ?? 0xf2f0e8);
        signs.sb.sign = [0, spec.lamps === false ? 2 : 1];
        const uv = [rect.u0, rect.v0, rect.u1, rect.v1] as const;
        for (const sd of [-1, 1]) {
          const n: [number, number, number] = [s[0] * sd, 0, s[2] * sd];
          const r: [number, number, number] = [n[2], 0, -n[0]];
          signBox(signs.sb, toW(ax, 0), r, n, -len / 2, len / 2, ay, ay + h, 0, 0.05, signs.layout.blankUv, { n: uv });
        }
      }
    }
    if (ad.side && !photos) {
      // Rear-door wrap text, printed flat just proud of the (near-vertical) door skin.
      const rect = signs.layout.rect(ad.side, false);
      if (rect) {
        const x0 = wrapX[0] + 0.06;
        const x1 = wrapX[1] - 0.06;
        const ym = (section((x0 + x1) / 2)[2][0] + section((x0 + x1) / 2)[5][0]) / 2;
        const w = x1 - x0;
        const h = Math.min(0.22, w * (rect.h / rect.w));
        signs.sb.ink = [0.95, 0.95, 0.92];
        signs.sb.plate = wrap ?? paint;
        signs.sb.sign = [0, 2];
        for (const sd of [-1, 1]) {
          const z = sd * (d.W + 0.012);
          // The text reads left to right from outside: along +f on the right side (sd = -1), -f on the left.
          const a0 = sd < 0 ? x0 : x1;
          const a1 = sd < 0 ? x1 : x0;
          const c0 = P(a0, ym - h / 2, z);
          const c1 = P(a1, ym - h / 2, z);
          signs.sb.quad(c0, [c1[0] - c0[0], 0, c1[2] - c0[2]], [0, h, 0], [rect.u0, rect.v0, rect.u1, rect.v1]);
        }
      }
    }
  }

  const liv = liveryOf(spec);
  if (liv) {
    const ink = lin(liv.ink);
    if (spec.type === 'boxtruck') {
      // On the box: the band low along it, the name large, the line under it.
      const flat = d.W + 0.03 + 0.004;
      if (liv.band !== undefined) band(0.05, 2.97, 1.16, 1.34, lin(liv.band), flat);
      sideText(liv.name, 1.51, 2.3, 0.66, 2.7, ink, paint2, flat);
      sideText(liv.sub, 1.51, 1.7, 0.26, 2.4, ink, paint2, flat);
    } else if (spec.type === 'van') {
      // On the blank rear quarter, above the beltline.
      sideText(liv.name, 1.14, 1.5, 0.34, 1.45, ink, paint);
      sideText(liv.sub, 1.14, 1.24, 0.13, 1.4, ink, paint);
    } else {
      // The kei van: below the windows, on the sliding door and the rear quarter.
      sideText(liv.name, 1.55, 0.86, 0.2, 1.1, ink, paint);
      sideText(liv.sub, 1.55, 0.68, 0.09, 1.0, ink, paint);
    }
  }
  if (spec.type === 'police') {
    // 警視庁 on the front doors (white), POLICE in reflective yellow under it (black), the unit on the roof.
    const xm = (d.seams[1] + d.seams[2]) / 2;
    sideText(POLICE_NAME, xm, 0.81, 0.2, 0.85, [0.02, 0.02, 0.025], paint);
    sideText(POLICE_EN, xm, 0.45, 0.13, 0.62, lin(0xf0c020), paint2);
    const h = hash(spec.marks ?? 0, 0x9011) % (POLICE_UNITS.length * 6);
    const rect = signs.layout.rect(unitText(h % POLICE_UNITS.length, 1 + Math.floor(h / POLICE_UNITS.length)), false);
    if (rect) {
      const x0 = d.rearGlass[1] + 0.05;
      const len = 0.42;
      const w = Math.min(1.1, len * (rect.w / rect.h));
      const y = top(x0 + len / 2) + 0.006;
      sb.ink = [0.02, 0.02, 0.025];
      sb.plate = paint;
      sb.sign = [0, 3];
      // Read from above and behind: across the car, its foot toward the boot.
      const c = P(x0, y, w / 2);
      const r = P(x0, y, -w / 2);
      const u = P(x0 + len, y, w / 2);
      sb.quad(c, [r[0] - c[0], 0, r[2] - c[2]], [u[0] - c[0], 0, u[2] - c[2]], [rect.u0, rect.v0, rect.u1, rect.v1]);
    }
  }
}

/** Where a car's four wheels are, and their size and rims, for drawing them apart (to spin and steer). */
/**
 * A mirror's head, in the design's frame (x from the rear, y up, z across): the middle of its rim, the way the rim
 * faces (back, toed in toward the car and tipped a little down), across (outboard) and up, its half size and its
 * depth, and where its arm or stalk meets the body. `wing`: out on the front wing (the classic taxi, a 70s saloon)
 * rather than on the door at the foot of the screen pillar.
 */
interface MirrorPlan {
  wing: boolean;
  c: V3;
  b: V3;
  a: V3;
  u: V3;
  hw: number;
  hh: number;
  depth: number;
  foot: V3;
}
function mirrorPlan(d: Design, type: CarType, S: { top: (x: number) => number; halfW: (x: number) => number; section: (x: number) => [number, number][] }, sd: number): MirrorPlan {
  const wing = type === 'taxi' || !!d.fenderMirrors;
  const bl = Math.hypot(1, 0.05, 0.3);
  const b: V3 = [-1 / bl, -0.05 / bl, (-sd * 0.3) / bl];
  const al = Math.hypot(0.3, 1);
  const a: V3 = [-0.3 / al, 0, sd / al];
  // (Up: square to both, whichever way round that comes out.)
  let u: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  if (u[1] < 0) u = [-u[0], -u[1], -u[2]];
  if (wing) {
    const mx = d.L - 0.55;
    return { wing, b, a, u, c: [mx - 0.02, S.top(mx) + 0.15, sd * (d.W - 0.12)], hw: 0.054, hh: 0.037, depth: 0.075, foot: [mx + 0.01, S.top(mx) - 0.005, sd * (d.W - 0.12)] };
  }
  const mx = d.windscreen[0] + 0.02;
  const my = S.section(mx)[5][0] + 0.02;
  const skin = S.halfW(mx);
  return { wing, b, a, u, c: [mx - 0.035, my + 0.07, sd * (skin + 0.115)], hw: 0.085, hh: 0.054, depth: 0.1, foot: [mx - 0.01, my + 0.03, sd * (skin - 0.03)] };
}

export function wheelLayout(type: CarType): { r: number; tw: number; rims: 'alloy' | 'steel'; spots: WheelSpot[] } {
  const d = DESIGNS[type];
  const spots: WheelSpot[] = [];
  for (const wx of d.wheelX) {
    for (const sd of [-1, 1] as const) spots.push({ x: sd * (d.W - 0.035 - d.tyreW / 2), y: d.wheelR, z: wx - d.L / 2, front: wx > d.L / 2, sd });
  }
  return { r: d.wheelR, tw: d.tyreW, rims: d.rims, spots };
}

function liteWheel(mb: MeshBuilder, P: (x: number, y: number, z: number) => V3, N: (n: V3) => V3, cx: number, r: number, tw: number, zOut: number, sd: number, rims: 'alloy' | 'steel'): void {
  const seg = 10;
  const rimR = r * 0.66;
  const at = (a: number, rad: number, depth: number): V3 => P(cx + Math.cos(a) * rad, r + Math.sin(a) * rad, zOut - sd * depth);
  const out = N([0, 0, sd]);
  mb.style = [0, 0, 0, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const rad = (a: number): V3 => N([Math.cos(a), Math.sin(a), 0]);
    mb.kind = KIND.plain;
    mb.color = [0.018, 0.018, 0.02];
    mb.quadN(at(a0, rimR, 0), at(a1, rimR, 0), at(a1, r, 0.03), at(a0, r, 0.03), out, out, out, out);
    mb.quadN(at(a0, r, 0.03), at(a1, r, 0.03), at(a1, r, tw), at(a0, r, tw), rad(a0), rad(a1), rad(a1), rad(a0));
    // The face: alternate segments are the spokes (or the hubcap's vents between its dome and the rim). From
    // the rim in: quadN takes its winding from the first corner's edges, and at the hub they'd have no length
    // (the face then faced one way on both sides of the car, and was culled on one).
    const dark = i % 2 === 1;
    mb.kind = dark ? KIND.plain : rims === 'steel' ? KIND.gloss : KIND.chrome;
    mb.color = dark ? [0.05, 0.05, 0.055] : rims === 'steel' ? [0.45, 0.46, 0.48] : [0.7, 0.71, 0.73];
    mb.quadN(at(a0, rimR, 0.02), at(a1, rimR, 0.02), at(a1, 0, 0.02), at(a0, 0, 0.02), out, out, out, out);
  }
}

/**
 * One wheel with its hub at the origin and its axle along x, the outer face toward +x (sd 1) or -x (sd -1):
 * rolling forward (+z) is a positive turn about +x.
 */
export function addWheel(mb: MeshBuilder, r: number, tw: number, sd: 1 | -1, rims: 'alloy' | 'steel'): void {
  // The same axes as a car built facing +z at the origin (its z across is our x), centred on the hub.
  wheel(mb, (x, y, z) => [z, y - r, x], (n) => [n[2], n[1], n[0]], 0, r, tw, (sd * tw) / 2, sd, rims);
}

/**
 * A turned wheel: rounded tyre, rim lip, and five alloy spokes (or a steel hubcap). `lite` is the street's
 * version (parked cars, ~60 triangles): ten sides, the sidewall and tread, a flat face with the spokes or the
 * hubcap painted on.
 */
export function wheel(mb: MeshBuilder, P: (x: number, y: number, z: number) => V3, N: (n: V3) => V3, cx: number, r: number, tw: number, zOut: number, sd: number, rims: 'alloy' | 'steel', lite = false): void {
  if (lite) return liteWheel(mb, P, N, cx, r, tw, zOut, sd, rims);
  const seg = 24;
  // Tyre profile: (radius, depth inward from the outer face).
  const prof: P2[] = [[r * 0.66, 0.0], [r * 0.9, 0.0], [r * 0.985, 0.025], [r, 0.06], [r, tw - 0.06], [r * 0.985, tw - 0.025], [r * 0.9, tw], [r * 0.66, tw]];
  const at = (a: number, rad: number, depth: number): V3 => P(cx + Math.cos(a) * rad, r + Math.sin(a) * rad, zOut - sd * depth);
  mb.kind = KIND.plain;
  mb.color = [0.018, 0.018, 0.02];
  mb.style = [0, 0, 0, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    for (let k = 0; k + 1 < prof.length; k++) {
      const [ra, da] = prof[k];
      const [rb, db] = prof[k + 1];
      // Profile normal in (radial, lateral-out) terms: the profile runs from the outer face (depth 0) round the
      // tread to the inner face, so outward is (d depth, -d radius) in (radial, depth), and lateral-out is -depth.
      const nr = db - da;
      const nl = rb - ra;
      const nlen = Math.hypot(nr, nl) || 1;
      const nOf = (a: number): V3 => N([(Math.cos(a) * nr) / nlen, (Math.sin(a) * nr) / nlen, (sd * nl) / nlen]);
      mb.quadN(at(a0, ra, da), at(a1, ra, da), at(a1, rb, db), at(a0, rb, db), nOf(a0), nOf(a1), nOf(a1), nOf(a0));
    }
  }
  const out = N([0, 0, sd]);
  // From the outer edge in, so a disc from the hub (r0 = 0) still has an edge to take its winding from.
  const disc = (r0: number, r1: number, depth: number, a0: number, a1: number): void => {
    mb.quadN(at(a0, r1, depth), at(a1, r1, depth), at(a1, r0, depth), at(a0, r0, depth), out, out, out, out);
  };
  const rimR = r * 0.66;
  for (let i = 0; i < seg * 2; i++) {
    const a0 = (i / (seg * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (seg * 2)) * Math.PI * 2;
    // Rim lip.
    mb.kind = KIND.chrome;
    mb.color = [0.7, 0.71, 0.73];
    disc(rimR * 0.9, rimR, 0.012, a0, a1);
    if (rims === 'steel') {
      // Steel wheel with a domed hubcap, and eight vent holes round it (so you can see it turn).
      mb.kind = KIND.gloss;
      mb.color = [0.42, 0.43, 0.45];
      disc(rimR * 0.2, rimR * 0.6, 0.03, a0, a1);
      disc(rimR * 0.78, rimR * 0.9, 0.03, a0, a1);
      const vent = Math.floor((((a0 + a1) / 2) / (Math.PI * 2)) * 16) % 2 === 0;
      if (vent) {
        mb.kind = KIND.plain;
        mb.color = [0.03, 0.03, 0.032];
      }
      disc(rimR * 0.6, rimR * 0.78, vent ? 0.07 : 0.03, a0, a1);
      mb.kind = KIND.chrome;
      mb.color = [0.8, 0.81, 0.83];
      disc(0, rimR * 0.55, 0.018, a0, a1);
    } else {
      // Five split spokes over a dark barrel.
      const spoke = Math.floor((((a0 + a1) / 2) / (Math.PI * 2)) * 10) % 2 === 0;
      mb.kind = spoke ? KIND.chrome : KIND.plain;
      mb.color = spoke ? [0.72, 0.73, 0.75] : [0.03, 0.03, 0.032];
      disc(rimR * 0.2, rimR * 0.9, spoke ? 0.02 : 0.07, a0, a1);
      mb.kind = KIND.chrome;
      mb.color = [0.6, 0.61, 0.63];
      disc(0, rimR * 0.2, 0.016, a0, a1);
    }
  }
}
