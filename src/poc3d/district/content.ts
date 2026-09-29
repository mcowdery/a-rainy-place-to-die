import { ContentError } from '../../content/load';
import { parseMacroMap, type MacroMap } from '../../gen/macro';
import { parseAtmosphere3, type AtmosphereTable3 } from './atmosphere';
import { parseStamp3, placeStamps3, type Placed3, type Stamp3 } from './stamps';
import { parseRail3, type RailLine3 } from './rail';
import { parseSubway3, type SubwayNet3 } from './subway';
import { parseTraffic3, type TrafficContent } from './traffic';
import { parseZones3, ZoneMap } from './zones';
import { parseBridges, parseRoads3, type Avenues, type Bridge3 } from './roads';
import roadsText from '../../../content/world3d/roads.yaml?raw';
import terrainText from '../../../content/world3d/terrain.yaml?raw';
import { parseTerrain, Terrain } from './terrain';
import l0Text from '../../../content/world3d/l0.txt?raw';
import placementsText from '../../../content/world3d/placements.yaml?raw';
import atmosphereText from '../../../content/world3d/atmosphere.yaml?raw';
import railText from '../../../content/world3d/rail.yaml?raw';
import trafficText from '../../../content/world3d/traffic.yaml?raw';
import subwayText from '../../../content/world3d/subway.yaml?raw';

export interface DistrictContent {
  readonly macro: MacroMap;
  readonly placed: readonly Placed3[];
  readonly atmosphere: AtmosphereTable3;
  readonly zones: ZoneMap;
  readonly rail: RailLine3 | null;
  readonly traffic: TrafficContent;
  readonly subway: SubwayNet3;
  readonly avenues: Avenues;
  /** Street bridges over the water (roads.yaml `bridges`). */
  readonly bridges: readonly Bridge3[];
  /** The lie of the land (terrain.yaml). */
  readonly terrain: Terrain;
}

/** Loads and cross-validates the 3D district content; throws ContentError listing every problem. */
export function loadDistrictContent(): DistrictContent {
  const errors: string[] = [];
  const macro = parseMacroMap('content/world3d/l0.txt', l0Text, errors);
  const atmosphere = parseAtmosphere3('content/world3d/atmosphere.yaml', atmosphereText, errors);
  const files = import.meta.glob('../../../content/world3d/stamps/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const stamps = new Map<string, Stamp3>();
  for (const [path, text] of Object.entries(files)) {
    const s = parseStamp3(path.replace(/^(\.\.\/)+/, ''), text, errors);
    if (s) stamps.set(s.id, s);
  }
  const placed = macro ? placeStamps3('content/world3d/placements.yaml', placementsText, macro, stamps, errors) : [];
  const zoneFiles = import.meta.glob('../../../content/world3d/zones/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const zones = macro ? ZoneMap.merge(Object.entries(zoneFiles).map(([path, text]) => parseZones3(path.replace(/^(\.\.\/)+/, ''), text, macro, errors))) : ZoneMap.EMPTY;
  const rail = macro ? parseRail3('content/world3d/rail.yaml', railText, macro, errors) : null;
  const traffic = macro ? parseTraffic3('content/world3d/traffic.yaml', trafficText, macro, errors) : { cars: [], buses: [], auto: null };
  const subway = parseSubway3('content/world3d/subway.yaml', subwayText, placed, errors, rail ? { id: rail.id, name: rail.name, nameEn: rail.nameEn, color: rail.color, x: rail.x } : null);
  const avenues = macro ? parseRoads3('content/world3d/roads.yaml', roadsText, macro, errors) : new Map();
  const bridges = macro ? parseBridges('content/world3d/roads.yaml', roadsText, macro, errors) : [];
  const terrain = macro ? parseTerrain('content/world3d/terrain.yaml', terrainText, macro, errors) : Terrain.FLAT;
  const ids = zones.zones.map((z) => z.id);
  if (new Set(ids).size !== ids.length) errors.push('content/world3d/zones: zone ids must be unique across districts');
  if (errors.length > 0 || !macro || !atmosphere) throw new ContentError(errors);
  return { macro, placed, atmosphere, zones, rail, traffic, subway, avenues, bridges, terrain };
}
