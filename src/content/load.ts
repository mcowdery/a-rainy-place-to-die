import YAML from 'yaml';
import { CONFIG } from '../config';
import { overlaps, type Rect } from '../core/coords';
import { AtmosphereTable, parseAtmosphere } from '../atmosphere/atmosphere';
import { MacroMap, isLand, parseMacroMap } from '../gen/macro';
import { DISTRICT_BOUNDARY_ROAD } from '../gen/styles';
import { NodeIndex, resolveNodes } from './nodes';
import { ID_PATTERN, parseStamp, type PlacedStamp, type Stamp } from './stamps';
import l0Text from '../../content/world/l0.txt?raw';
import placementsText from '../../content/world/placements.yaml?raw';
import atmosphereText from '../../content/world/atmosphere.yaml?raw';

export interface RawFile {
  readonly file: string;
  readonly text: string;
}

export interface RawContent {
  readonly l0: RawFile;
  readonly placements: RawFile;
  readonly atmosphere: RawFile;
  readonly stamps: readonly RawFile[];
}

export interface Content {
  readonly macro: MacroMap;
  readonly stamps: ReadonlyMap<string, Stamp>;
  readonly placements: readonly PlacedStamp[];
  readonly nodes: NodeIndex;
  readonly atmosphere: AtmosphereTable;
}

export class ContentError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`Content has ${errors.length} error(s):\n${errors.join('\n')}`);
  }
}

/** Everything under content/, bundled as raw text by Vite (also works under Vitest). */
export function bundledContent(): RawContent {
  const stamps = import.meta.glob('../../content/stamps/**/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  return {
    l0: { file: 'content/world/l0.txt', text: l0Text },
    placements: { file: 'content/world/placements.yaml', text: placementsText },
    atmosphere: { file: 'content/world/atmosphere.yaml', text: atmosphereText },
    stamps: Object.entries(stamps).map(([path, text]) => ({ file: path.replace(/^(\.\.\/)+/, ''), text })),
  };
}

/** Parses and cross-validates all content. Collects every error rather than stopping at the first. */
export function buildContent(raw: RawContent): { content: Content | null; errors: string[] } {
  const errors: string[] = [];
  const macro = parseMacroMap(raw.l0.file, raw.l0.text, errors);
  const atmosphere = parseAtmosphere(raw.atmosphere.file, raw.atmosphere.text, errors);

  const stamps = new Map<string, Stamp>();
  for (const f of raw.stamps) {
    const s = parseStamp(f.file, f.text, errors);
    if (!s) continue;
    const dup = stamps.get(s.id);
    if (dup) errors.push(`${f.file}: stamp id '${s.id}' already used by ${dup.file}`);
    else stamps.set(s.id, s);
  }

  const placements = macro ? parsePlacements(raw.placements, macro, stamps, errors) : [];
  const nodes = resolveNodes(placements, errors);
  if (!nodes.byId.has(CONFIG.startSpawn)) errors.push(`config: startSpawn '${CONFIG.startSpawn}' does not exist`);

  if (errors.length > 0 || !macro || !atmosphere) return { content: null, errors };
  return { content: { macro, stamps, placements, nodes, atmosphere }, errors };
}

export function loadContent(raw: RawContent = bundledContent()): Content {
  const { content, errors } = buildContent(raw);
  if (!content) throw new ContentError(errors);
  return content;
}

/**
 * placements.yaml: a list of
 *   - id: neon_station          # unique; prefixes node ids ("neon_station.gate")
 *     stamp: station             # stamp template id
 *     cell: [29, 11]             # L0 macro cell [col, row]
 *     offset: [40, 24]           # tiles from that cell's NW corner to the stamp's NW corner
 *     name: Yoimachi             # optional display name
 * Anchoring to a macro cell (not raw tile coords) keeps stamps in the right district when cell size is retuned.
 * A stamp must fit inside one cell, clear of its edge roads; local streets are routed around it.
 */
/** Stamps keep clear of the roads on macro-cell edges (the widest is DISTRICT_BOUNDARY_ROAD). */
const CELL_MARGIN = Math.ceil(DISTRICT_BOUNDARY_ROAD / 2) + 1;

function parsePlacements(f: RawFile, macro: MacroMap, stamps: ReadonlyMap<string, Stamp>, errors: string[]): PlacedStamp[] {
  const err = (m: string): void => void errors.push(`${f.file}: ${m}`);
  let doc: unknown;
  try {
    doc = YAML.parse(f.text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return [];
  }
  if (!Array.isArray(doc)) return err('expected a list of placements'), [];

  const out: PlacedStamp[] = [];
  const ids = new Set<string>();
  const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger);
  doc.forEach((p: Record<string, unknown>, i) => {
    const id = String(p.id);
    const at = `placement ${i} (${id})`;
    if (!ID_PATTERN.test(id)) return err(`${at}: id must match ${ID_PATTERN}`);
    if (ids.has(id)) return err(`${at}: duplicate placement id`);
    ids.add(id);
    const stamp = stamps.get(String(p.stamp));
    if (!stamp) return err(`${at}: unknown stamp '${String(p.stamp)}'`);
    if (!isPair(p.cell) || !isPair(p.offset)) return err(`${at}: cell and offset must be [x, y] integer pairs`);
    const [mx, my] = p.cell;
    if (!isLand(macro.kindAt(mx, my))) return err(`${at}: cell [${mx}, ${my}] is ${macro.kindAt(mx, my)}, not a district`);
    const rect: Rect = { x: mx * CONFIG.cellW + p.offset[0], y: my * CONFIG.cellH + p.offset[1], w: stamp.w, h: stamp.h };
    const [ox, oy] = p.offset;
    if (ox < CELL_MARGIN || oy < CELL_MARGIN || ox + stamp.w > CONFIG.cellW - CELL_MARGIN || oy + stamp.h > CONFIG.cellH - CELL_MARGIN) {
      return err(
        `${at}: ${stamp.w}x${stamp.h} stamp at offset [${ox}, ${oy}] must stay ${CELL_MARGIN} tiles inside its cell ` +
          `(offset x ${CELL_MARGIN}..${CONFIG.cellW - CELL_MARGIN - stamp.w}, y ${CELL_MARGIN}..${CONFIG.cellH - CELL_MARGIN - stamp.h}) to clear boundary roads`,
      );
    }
    const clash = out.find((o) => overlaps(o.rect, rect));
    if (clash) return err(`${at}: overlaps placement '${clash.id}'`);
    out.push({ id, stamp, rect, name: p.name === undefined ? null : String(p.name) });
  });
  return out;
}
