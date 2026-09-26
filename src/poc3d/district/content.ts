import { ContentError } from '../../content/load';
import { parseMacroMap, type MacroMap } from '../../gen/macro';
import { parseAtmosphere3, type AtmosphereTable3 } from './atmosphere';
import { parseStamp3, placeStamps3, type Placed3, type Stamp3 } from './stamps';
import { parseZones3, ZoneMap } from './zones';
import l0Text from '../../../content/world3d/l0.txt?raw';
import placementsText from '../../../content/world3d/placements.yaml?raw';
import atmosphereText from '../../../content/world3d/atmosphere.yaml?raw';
import zonesText from '../../../content/world3d/zones.yaml?raw';

export interface DistrictContent {
  readonly macro: MacroMap;
  readonly placed: readonly Placed3[];
  readonly atmosphere: AtmosphereTable3;
  readonly zones: ZoneMap;
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
  const zones = macro ? parseZones3('content/world3d/zones.yaml', zonesText, macro, errors) : ZoneMap.EMPTY;
  if (errors.length > 0 || !macro || !atmosphere) throw new ContentError(errors);
  return { macro, placed, atmosphere, zones };
}
