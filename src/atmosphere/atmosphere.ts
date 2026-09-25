import YAML from 'yaml';
import { CELL_CHARS, type CellKind } from '../gen/macro';
import { EMISSIVE, PALETTE_NAMES, isPaletteName, type PaletteName } from '../world/tiles';

/**
 * (district, time of day, weather) -> how the world looks. A pure lookup: nothing runs a clock or a
 * forecast. The story sets the world.time / world.weather flags; the renderer asks this table.
 *
 * Rules are layered by specificity: a rule matching nothing specific (the base) must define the full
 * palette; more specific rules override on top ({time: night} < {district: neon, time: night} < all three).
 * Ties go to file order. Tints stack and never affect EMISSIVE colours (lights stay bright).
 */

export const TIMES = ['dawn', 'day', 'dusk', 'night'] as const;
export const WEATHERS = ['clear', 'rain', 'fog'] as const;
export type TimeOfDay = (typeof TIMES)[number];
export type Weather = (typeof WEATHERS)[number];
export type NeonMode = 'off' | 'on' | 'flicker';

export const FLAG_TIME = 'world.time';
export const FLAG_WEATHER = 'world.weather';

interface Rule {
  match: { district?: CellKind; time?: TimeOfDay; weather?: Weather };
  palette: Partial<Record<PaletteName, string>>;
  tint: { color: string; amount: number } | null;
  windowLit?: number;
  neon?: NeonMode;
  rain?: number;
  fog?: string | null;
}

export interface Atmosphere {
  /** CSS colours indexed by palette index. */
  readonly colors: readonly string[];
  /** Fraction of window tiles lit. */
  readonly windowLit: number;
  readonly neon: NeonMode;
  /** Rain streaks per visible cell. */
  readonly rain: number;
  /** CSS colour laid over the whole view, or null. */
  readonly fog: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const DISTRICT_KINDS = new Set<string>(Object.values(CELL_CHARS));

export class AtmosphereTable {
  private cache = new Map<string, Atmosphere>();

  constructor(private readonly rules: readonly Rule[]) {}

  resolve(district: CellKind, time: TimeOfDay, weather: Weather): Atmosphere {
    const key = `${district}|${time}|${weather}`;
    let a = this.cache.get(key);
    if (!a) {
      a = this.compute(district, time, weather);
      this.cache.set(key, a);
    }
    return a;
  }

  private compute(district: CellKind, time: TimeOfDay, weather: Weather): Atmosphere {
    const matching = this.rules
      .map((r, order) => ({ r, order, spec: Object.keys(r.match).length }))
      .filter(({ r }) => (r.match.district ?? district) === district && (r.match.time ?? time) === time && (r.match.weather ?? weather) === weather)
      .sort((a, b) => a.spec - b.spec || a.order - b.order);
    const palette: Partial<Record<PaletteName, string>> = {};
    const tints: { color: string; amount: number }[] = [];
    let windowLit = 0;
    let neon: NeonMode = 'off';
    let rain = 0;
    let fog: string | null = null;
    for (const { r } of matching) {
      Object.assign(palette, r.palette);
      if (r.tint) tints.push(r.tint);
      if (r.windowLit !== undefined) windowLit = r.windowLit;
      if (r.neon !== undefined) neon = r.neon;
      if (r.rain !== undefined) rain = r.rain;
      if (r.fog !== undefined) fog = r.fog;
    }
    const colors = PALETTE_NAMES.map((name) => {
      let rgb = parseHex(palette[name] ?? '#ff00ff');
      if (!EMISSIVE.has(name)) for (const t of tints) rgb = blend(rgb, parseHex(t.color), t.amount);
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    });
    return { colors, windowLit, neon, rain, fog };
  }
}

type RGB = [number, number, number];
const parseHex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const blend = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

export function parseAtmosphere(file: string, text: string, errors: string[]): AtmosphereTable | null {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  const before = errors.length;
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return null;
  }
  const list = (doc as { rules?: unknown })?.rules;
  if (!Array.isArray(list)) return err('expected rules: [...]'), null;

  const rules: Rule[] = [];
  list.forEach((raw: Record<string, unknown>, i) => {
    const at = `rule ${i}`;
    const m = (raw.match ?? {}) as Record<string, string>;
    for (const k of Object.keys(m)) if (!['district', 'time', 'weather'].includes(k)) err(`${at}: unknown match key '${k}'`);
    if (m.district !== undefined && !DISTRICT_KINDS.has(m.district)) err(`${at}: unknown district '${m.district}'`);
    if (m.time !== undefined && !TIMES.includes(m.time as TimeOfDay)) err(`${at}: unknown time '${m.time}'`);
    if (m.weather !== undefined && !WEATHERS.includes(m.weather as Weather)) err(`${at}: unknown weather '${m.weather}'`);
    const palette = (raw.palette ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(palette)) {
      if (!isPaletteName(k)) err(`${at}: unknown palette colour '${k}'`);
      if (!HEX.test(String(v))) err(`${at}: palette '${k}' must be #rrggbb`);
    }
    const tint = raw.tint as Rule['tint'] | undefined;
    if (tint && (!HEX.test(String(tint.color)) || typeof tint.amount !== 'number')) err(`${at}: tint needs color: '#rrggbb' and amount: number`);
    if (raw.neon !== undefined && !['off', 'on', 'flicker'].includes(String(raw.neon))) err(`${at}: neon must be off | on | flicker`);
    rules.push({
      match: m as Rule['match'],
      palette: palette as Rule['palette'],
      tint: tint ?? null,
      windowLit: raw.windowLit as number | undefined,
      neon: raw.neon as NeonMode | undefined,
      rain: raw.rain as number | undefined,
      fog: raw.fog as string | null | undefined,
    });
  });

  const base = rules.find((r) => Object.keys(r.match).length === 0);
  if (!base) err('needs a base rule with an empty match');
  else for (const n of PALETTE_NAMES) if (!(n in base.palette)) err(`base rule is missing palette colour '${n}'`);
  return errors.length > before ? null : new AtmosphereTable(rules);
}
