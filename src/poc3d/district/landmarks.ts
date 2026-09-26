import type { Rect } from '../../core/coords';
import { konbiniColliders, konbiniLights } from '../real/konbini';
import type { Light } from '../real/lightmap';
import { shrineColliders, shrineLights } from '../real/shrine';
import { loveHotelColliders, loveHotelLights } from '../real/loveHotel';
import { yokochoColliders, yokochoLights } from '../real/yokocho';
import { ryujinColliders, ryujinLights } from '../real/ryujin';
import { discountColliders, discountLights } from '../real/discount';
import { stationColliders, stationFloor, stationLights } from '../real/station';
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

/** Openings in the pavement (a stairwell down to a basement). */
export function landmarkHoles(p: Placed3): Rect[] {
  return p.stamp.landmark === 'live_house' ? liveHouseHoles(p.building) : [];
}

/**
 * Floor height at a world point if it's on a landmark's stairs, platform or in its basement, else null
 * (street level). current: the walker's floor, to choose between levels that overlap.
 */
export function landmarkFloor(p: Placed3, x: number, z: number, current = 0): number | null {
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
