import { parseRaces, type RaceDef } from './cityRace';
import { ContentError } from '../../content/errors';
import { parseMacroMap, type MacroMap } from '../../gen/macro';
import { parseAtmosphere3, type AtmosphereTable3 } from './atmosphere';
import { parseStamp3, placeStamps3, type Placed3, type Stamp3 } from './stamps';
import { parseRails3, type RailLine3 } from './rail';
import { parseSubway3, type SubwayNet3 } from './subway';
import { parseTraffic3, type TrafficContent } from './traffic';
import { parseZones3, ZoneMap } from './zones';
import { parseBridges, parseRoads3, type Avenues, type Bridge3 } from './roads';
import { parseExpressway, rampEdges } from './expressway';
import { parseTerrain, Terrain } from './terrain';
import { CITIES, type CityId } from './cityConfig';
import { parseStreetRaces, type StreetRaceDef } from './streetRace';

/** Every city's content files as raw text, by folder under content/ then path in it (`l0.txt`, `stamps/x.yaml`). */
const RAW = import.meta.glob(['../../../content/world3d/**/*.{yaml,txt}', '../../../content/manila/**/*.{yaml,txt}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FILES = new Map<string, Map<string, string>>();
for (const [path, text] of Object.entries(RAW)) {
  const m = /content\/([^/]+)\/(.+)$/.exec(path);
  if (!m) continue;
  if (!FILES.has(m[1])) FILES.set(m[1], new Map());
  FILES.get(m[1])!.set(m[2], text);
}

export interface DistrictContent {
  readonly macro: MacroMap;
  readonly placed: readonly Placed3[];
  readonly atmosphere: AtmosphereTable3;
  readonly zones: ZoneMap;
  /** The elevated lines (rail.yaml): the Toto Line first. */
  readonly rails: readonly RailLine3[];
  /** Races on the expressway (races.yaml, district/cityRace.ts). */
  readonly races: readonly RaceDef[];
  readonly traffic: TrafficContent;
  readonly subway: SubwayNet3;
  readonly avenues: Avenues;
  /** Street bridges over the water (roads.yaml `bridges`). */
  readonly bridges: readonly Bridge3[];
  /** The lie of the land (terrain.yaml). */
  readonly terrain: Terrain;
  /** Street races (streetraces.yaml, district/streetRace.ts): a field through gates over the streets. */
  readonly streetRaces: readonly StreetRaceDef[];
  /** The expressway's file (expressway.yaml) as text, parsed by the page; empty when the city has none. */
  readonly expresswayText: string;
  readonly city: CityId;
}

/** Loads and cross-validates a city's content (Tōto by default); throws ContentError listing every problem. */
export function loadDistrictContent(city: CityId = 'toto'): DistrictContent {
  const errors: string[] = [];
  const dir = CITIES[city].dir;
  const files = FILES.get(dir) ?? new Map<string, string>();
  const at = `content/${dir}`;
  /** A file of the city's, or `fallback` when a city has none (a city without trains has no rail.yaml). */
  const text = (name: string, fallback?: string): string => {
    const t = files.get(name) ?? fallback;
    if (t === undefined) errors.push(`${at}/${name}: missing`);
    return t ?? '';
  };
  const under = (prefix: string): [string, string][] => [...files].filter(([n]) => n.startsWith(prefix) && !n.slice(prefix.length).includes('/')).map(([n, t]) => [`${at}/${n}`, t]);
  const macro = parseMacroMap(`${at}/l0.txt`, text('l0.txt'), errors);
  const atmosphere = parseAtmosphere3(`${at}/atmosphere.yaml`, text('atmosphere.yaml'), errors);
  const stamps = new Map<string, Stamp3>();
  for (const [path, t] of under('stamps/')) {
    const s = parseStamp3(path, t, errors);
    if (s) stamps.set(s.id, s);
  }
  const placed = macro ? placeStamps3(`${at}/placements.yaml`, text('placements.yaml'), macro, stamps, errors) : [];
  const zones = macro ? ZoneMap.merge(under('zones/').map(([path, t]) => parseZones3(path, t, macro, errors))) : ZoneMap.EMPTY;
  const rails = macro ? parseRails3(`${at}/rail.yaml`, text('rail.yaml', 'lines: []\n'), macro, errors) : [];
  const traffic = macro ? parseTraffic3(`${at}/traffic.yaml`, text('traffic.yaml'), macro, errors) : { cars: [], buses: [], auto: null };
  const subway = parseSubway3(`${at}/subway.yaml`, text('subway.yaml', 'lines: []\n'), placed, errors, rails);
  const races = parseRaces(`${at}/races.yaml`, text('races.yaml', 'races: []\n'), errors);
  for (const r of races) if (!placed.some((p) => p.nodes.some((n) => n.id === r.host))) errors.push(`${at}/races.yaml: race ${r.id}: no node '${r.host}'`);
  const streetRaces = parseStreetRaces(`${at}/streetraces.yaml`, text('streetraces.yaml', 'races: []\n'), errors);
  for (const r of streetRaces) if (r.host && !placed.some((p) => p.nodes.some((n) => n.id === r.host))) errors.push(`${at}/streetraces.yaml: race ${r.id}: no node '${r.host}'`);
  const roadsText = text('roads.yaml');
  const avenues = macro ? parseRoads3(`${at}/roads.yaml`, roadsText, macro, errors) : new Map();
  // A city whose expressway has a slip lane (expressway.yaml `slipLane`): the roads under its ramps are that much wider.
  const exText = files.get('expressway.yaml');
  const exDef = macro && exText ? parseExpressway(`${at}/expressway.yaml`, exText, []) : null;
  if (exDef?.slipLane) {
    for (const key of rampEdges(exDef)) {
      const had = avenues.get(key);
      // Not where a set piece stands beside the road (a subway station is placed 10 m from its centre, the garage by the
      // station): that stretch keeps its width, and its ramp stays in the inner lane there.
      const [kx, ky, dir] = key.split(',');
      const w = (had?.width ?? 16) + exDef.slipLane;
      const road = dir === 'h' ? { x: +kx * 128, y: (+ky + 1) * 128 - w / 2, w: 128, h: w } : { x: (+kx + 1) * 128 - w / 2, y: +ky * 128, w, h: 128 };
      if (placed.some((p) => p.rect.x < road.x + road.w && p.rect.x + p.rect.w > road.x && p.rect.y < road.y + road.h && p.rect.y + p.rect.h > road.y)) continue;
      (avenues as Map<string, import('./roads').EdgeSpec>).set(key, { width: (had?.width ?? 16) + exDef.slipLane, median: had?.median ?? 0, slip: (had?.slip ?? 0) + exDef.slipLane, name: had?.name ?? 'Expressway', ...(had?.bridge ? { bridge: true } : {}) });
    }
  }
  const bridges = macro ? parseBridges(`${at}/roads.yaml`, roadsText, macro, errors) : [];
  const terrain = macro ? parseTerrain(`${at}/terrain.yaml`, text('terrain.yaml'), macro, errors) : Terrain.FLAT;
  const ids = zones.zones.map((z) => z.id);
  if (new Set(ids).size !== ids.length) errors.push(`${at}/zones: zone ids must be unique across districts`);
  if (errors.length > 0 || !macro || !atmosphere) throw new ContentError(errors);
  return { macro, placed, atmosphere, zones, rails, traffic, subway, avenues, bridges, terrain, races, streetRaces, expresswayText: files.get('expressway.yaml') ?? '', city };
}
