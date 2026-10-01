import { hash } from '../../core/hash';
import { CITY_CARS, isTaxi, pickCar } from '../district/carMix';
import { addVehicle, addVehicleMarks, PAINTS, taxiAdFor, type CarType, type VehicleSigns } from '../models/vehicles';
import { KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * Parked cars: the vehicle models (models/vehicles.ts) at street detail, a coarser body and simple wheels
 * (~1,600 triangles), lamps off, for the kerbs, the open lots and the set pieces. Moving traffic builds its own
 * (real/traffic.ts), with the wheels apart so they turn.
 */
export interface CarSpec {
  readonly x: number;
  readonly z: number;
  /** Unit vector along the car (its front). */
  readonly fx: number;
  readonly fz: number;
  readonly variant: number;
  /** The model and paint; otherwise picked from the variant (the city's mix, district/carMix.ts). */
  readonly type?: CarType;
  readonly paint?: number;
  /** Station spacing (models/vehicles.ts `detail`): 0.25 by default; a set piece's close-up can ask for more. */
  readonly detail?: number;
}

/**
 * Each model and detail is lofted once (per worker: the loft is slow), in a placeholder paint, and stamped
 * into place from then on (`MeshBuilder.append`), repainted. Taxis are lofted per livery (their second colour
 * goes with the first), and a taxi with an ad in another placeholder for its door wrap. The lettering and
 * ads are added per car (`addVehicleMarks`), when there are signs to put them in.
 */
const built = new Map<string, MeshBuilder>();
const PLACEHOLDER = 0x010203;
const WRAP_PLACEHOLDER = 0x030201;

/** Adds a parked car to the builder; with `signs`, its lettering and ads too. */
export function addCar(mb: MeshBuilder, c: CarSpec, signs?: VehicleSigns): void {
  const picked = c.type ? { type: c.type, paint: PAINTS[c.type][hash(c.variant, 0x9a1) % PAINTS[c.type].length] } : pickCar(CITY_CARS, c.variant);
  const paint = c.paint ?? picked.paint;
  const detail = c.detail ?? 0.25;
  const livery = isTaxi(picked.type);
  const base = livery ? paint : PLACEHOLDER;
  // Only dressed cars wear an ad (its wrap is on the body).
  const ad = signs && livery ? taxiAdFor(c.variant) : undefined;
  const key = `${picked.type}:${base}:${detail}:${ad ? 'ad' : ''}`;
  let model = built.get(key);
  if (!model) {
    model = new MeshBuilder(4096);
    addVehicle(model, { x: 0, z: 0, fx: 0, fz: 1, type: picked.type, paint: base, detail, lamps: false, ad: ad ? { wrap: WRAP_PLACEHOLDER, roof: '-' } : undefined });
    built.set(key, model);
  }
  const from = mb.vertexCount;
  const l = Math.hypot(c.fx, c.fz) || 1;
  const [fx, fz] = [c.fx / l, c.fz / l];
  mb.append(model, c.x, c.z, fx, fz);
  if (!livery) mb.recolor(from, lin(PLACEHOLDER), lin(paint));
  if (ad) mb.recolor(from, lin(WRAP_PLACEHOLDER), lin(ad.wrap ?? paint));
  if (signs) addVehicleMarks(mb, { x: c.x, z: c.z, fx, fz, type: picked.type, paint, marks: c.variant, ad }, signs);
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
}
