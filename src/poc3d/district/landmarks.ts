import type { Rect } from '../../core/coords';
import { konbiniColliders, konbiniLights } from '../real/konbini';
import type { Light } from '../real/lightmap';
import { shrineColliders, shrineLights } from '../real/shrine';
import { loveHotelColliders, loveHotelLights } from '../real/loveHotel';
import { yokochoColliders, yokochoLights } from '../real/yokocho';
import { ryujinColliders, ryujinLights } from '../real/ryujin';
import { discountColliders, discountLights } from '../real/discount';
import { stationColliders, stationFloor, stationLights } from '../real/station';
import { ASAGIRI_KINDS, asagiriColliders, asagiriFloor, asagiriLights, asagiriShelters, type AsagiriKind } from '../real/asagiri';
import { localFrame, localRect } from '../real/localFrame';

const asagiri = (p: Placed3): AsagiriKind | null => ((ASAGIRI_KINDS as readonly string[]).includes(p.stamp.landmark ?? '') ? (p.stamp.landmark as AsagiriKind) : null);
import { liveHouseColliders, liveHouseFloor, liveHouseHoles, liveHouseLights } from '../real/liveHouse';
import type { Building3 } from './plan';
import type { Placed3 } from './stamps';

/**
 * What the chunk workers and collision need to know about landmarks (built on the main thread): their
 * street light, and, for ones you can walk into, their walls and fixtures instead of a solid footprint.
 */

/**
 * Collision rects for a landmark you can walk into or through, at a walker's floor height (street level
 * is 0, a basement is below -1); null means its footprint is solid.
 */
export function landmarkColliders(p: Placed3, floor = 0): Rect[] | null {
  const a = asagiri(p);
  if (a) return floor < -1 ? [] : asagiriColliders(a, p.building, floor);
  switch (p.stamp.landmark) {
    case 'live_house':
      return liveHouseColliders(p.building, floor);
    case 'konbini':
      return konbiniColliders(p.building);
    case 'shrine':
      return shrineColliders(p.building);
    case 'love_hotel':
      return loveHotelColliders(p.building);
    case 'yokocho':
      return yokochoColliders(p.building);
    case 'ryujin':
      return ryujinColliders(p.building);
    case 'discount':
      return discountColliders(p.building);
    case 'station':
      return stationColliders(p.building, floor);
    default:
      return null;
  }
}

/** Lightmap lights a landmark adds to its surroundings. */
export function landmarkLights(p: Placed3): Light[] {
  const a = asagiri(p);
  if (a) return asagiriLights(a, p.building);
  switch (p.stamp.landmark) {
    case 'mega_sign':
      return megaSignLights(p.building);
    case 'konbini':
      return konbiniLights(p.building);
    case 'shrine':
      return shrineLights(p.building);
    case 'love_hotel':
      return loveHotelLights(p.building);
    case 'live_house':
      return liveHouseLights(p.building);
    case 'yokocho':
      return yokochoLights(p.building);
    case 'ryujin':
      return ryujinLights(p.building);
    case 'discount':
      return discountLights(p.building);
    case 'station':
      return stationLights(p.building);
    default:
      return [];
  }
}

/** A covered volume: no rain falls inside it (a roof over your head, or walls round you). */
export interface Shelter {
  readonly rect: Rect;
  readonly y0: number;
  readonly y1: number;
  /** Walls all round (a shop, a basement, the observatory), not just a roof overhead: sound is muffled. */
  readonly enclosed?: boolean;
}

/** A landmark's covered volumes: walk-in interiors, canopies, the station, the observatory. */
export function landmarkShelters(p: Placed3): Shelter[] {
  const a = asagiri(p);
  if (a) return asagiriShelters(a, p.building);
  const b = p.building;
  const whole = { rect: { x: b.x - b.w / 2, y: b.z - b.d / 2, w: b.w, h: b.d }, y0: -10, y1: b.h, enclosed: true };
  const f = localFrame(b);
  switch (p.stamp.landmark) {
    case 'konbini':
      return [whole];
    case 'live_house':
      return [{ rect: localRect(f, 0, 3.4, 0, 22), y0: -6, y1: 3.0 }, { rect: localRect(f, 0, 10, 6, 22), y0: -6, y1: 0, enclosed: true }];
    case 'station':
      // The station building and the platforms under their canopy, out over the tracks.
      return [{ rect: localRect(f, 0, 60, -17.8, 24), y0: -1, y1: 16.6 }];
    case 'love_hotel':
      return [{ rect: localRect(f, 9, 15, 1.6, 4), y0: 0, y1: 3.3 }];
    default:
      return [];
  }
}

/** Openings in the pavement (a stairwell down to a basement). */
export function landmarkHoles(p: Placed3): Rect[] {
  return p.stamp.landmark === 'live_house' ? liveHouseHoles(p.building) : [];
}

/**
 * Floor height at a world point if it's on a landmark's stairs, platform or in its basement, else null
 * (street level). current: the walker's floor, to choose between levels that overlap.
 */
export function landmarkFloor(p: Placed3, x: number, z: number, current = 0): number | null {
  const a = asagiri(p);
  if (a) return asagiriFloor(a, p.building, x, z, current);
  switch (p.stamp.landmark) {
    case 'live_house':
      return liveHouseFloor(p.building, x, z);
    case 'station':
      return stationFloor(p.building, x, z, current);
    default:
      return null;
  }
}

/** Collision above street level (station stairs, concourse and platforms); null if the landmark has none. */
export function landmarkRaisedColliders(p: Placed3, floor: number): Rect[] | null {
  const a = asagiri(p);
  if (a) return asagiriColliders(a, p.building, floor);
  return p.stamp.landmark === 'station' ? stationColliders(p.building, floor) : null;
}

/** Street glow from the mega-sign's screens: its west and south faces (the corner is at the south-west). */
function megaSignLights(b: Building3): Light[] {
  const x0 = b.x - b.w / 2;
  const z1 = b.z + b.d / 2;
  const glow = (x: number, z: number, color: [number, number, number]): Light => ({ x, z, r: 16, color, i: 1.1 });
  return [
    glow(x0 - 4, b.z - b.d * 0.25, [1.0, 0.45, 0.8]),
    glow(x0 - 4, b.z + b.d * 0.25, [0.6, 0.8, 1.0]),
    glow(b.x - b.w * 0.25, z1 + 4, [1.0, 0.7, 0.5]),
    glow(b.x + b.w * 0.25, z1 + 4, [0.7, 0.6, 1.0]),
    glow(x0 - 3, z1 + 3, [1.0, 0.35, 0.7]),
  ];
}
