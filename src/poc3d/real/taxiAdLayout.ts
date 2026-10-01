/**
 * Where each taxi ad sits in the taxi ad atlas (real/adAtlas.ts AdAtlas): pure layout, no canvas or art, so the
 * chunk workers can give parked taxis their ads' UVs while the main thread draws the matching texture. Per ad,
 * a roof panel (square photo + brand) and a door wrap (tall photo + tagline and brand).
 */

export const TAXI_ROOF_W = 768;
export const TAXI_ROOF_H = 256;
export const TAXI_DOOR_W = 832;
export const TAXI_DOOR_H = 480;
export const TAXI_DOOR_PHOTO_W = 360;
export const TAXI_ATLAS_W = TAXI_ROOF_W + TAXI_DOOR_W * 2;
export const TAXI_ATLAS_H = 2048;

type Rect4 = readonly [number, number, number, number];

/** Pixel corner of an ad's roof panel or door wrap. */
export function taxiAdAt(i: number, part: 'roof' | 'door'): [number, number] {
  return part === 'roof' ? [0, i * TAXI_ROOF_H] : [TAXI_ROOF_W + (i % 2) * TAXI_DOOR_W, Math.floor(i / 2) * 512];
}

/** UV rect (u0, v0 top, u1, v1 bottom) of an ad's roof panel or door wrap. */
export function taxiAdUv(i: number, part: 'roof' | 'door'): Rect4 {
  const [x, y] = taxiAdAt(i, part);
  const [w, h] = part === 'roof' ? [TAXI_ROOF_W, TAXI_ROOF_H] : [TAXI_DOOR_W, TAXI_DOOR_H];
  return [(x + 1) / TAXI_ATLAS_W, (y + 1) / TAXI_ATLAS_H, (x + w - 1) / TAXI_ATLAS_W, (y + h - 1) / TAXI_ATLAS_H];
}

export const TAXI_ROOF_ASPECT = TAXI_ROOF_W / TAXI_ROOF_H;
export const TAXI_DOOR_ASPECT = TAXI_DOOR_W / TAXI_DOOR_H;
/** A plain spot for the panels' edges and backs (the gap under the first door row). */
export const TAXI_BLANK_UV: [number, number] = [(TAXI_ROOF_W + 40) / TAXI_ATLAS_W, 496 / TAXI_ATLAS_H];

/** The photos builder for `VehicleSigns.photos`, given its SignBuilder. */
export const taxiPhotos = <T>(sb: T): { sb: T; uv: typeof taxiAdUv; blankUv: [number, number]; roofAspect: number; doorAspect: number } => ({
  sb,
  uv: taxiAdUv,
  blankUv: TAXI_BLANK_UV,
  roofAspect: TAXI_ROOF_ASPECT,
  doorAspect: TAXI_DOOR_ASPECT,
});
