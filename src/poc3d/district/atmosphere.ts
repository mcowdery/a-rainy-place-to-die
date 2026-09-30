import YAML from 'yaml';
import { CELL_CHARS, type CellKind } from '../../gen/macro';
import { applicableRules, checkMatch, type RuleMatch, type TimeOfDay, type Weather } from '../../atmosphere/rules';

/**
 * 3D atmosphere: (district, time, weather) -> scene lighting and effects, using the same layered rule
 * lookup as the 2D table (atmosphere/rules.ts). The story sets world.time / world.weather; this is a pure
 * lookup, nothing runs a clock. The base rule (empty match) must set every key.
 */
export interface Atmosphere3 {
  /** Sky colour at the zenith. */
  readonly sky: number;
  /** Sky colour at the horizon (the city's light-pollution glow at night). */
  readonly horizon: number;
  readonly fog: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly hemi: number;
  /** Key light (sun by day, moon by night). */
  readonly sunColor: number;
  readonly sun: number;
  /** Fraction of windows lit. */
  readonly windowLit: number;
  readonly neon: 'off' | 'on' | 'flicker';
  /** Rain streaks per blank cell (0 = dry). */
  readonly rain: number;
  /** Street lamps: 0 off, 1 fully on (also scales shop and sign spill on the street). */
  readonly lamps: number;
  /** Camera exposure for tone mapping. */
  readonly exposure: number;
  /** Cloud cover 0-1; the clouds' lit underside and their dark parts (sRGB). */
  readonly clouds: number;
  readonly cloudLit: number;
  readonly cloudDark: number;
  /** Wet air 0-1: how much the street lamps' light cones show (rain, fog, mist). */
  readonly haze: number;
}

type Key = keyof Atmosphere3;
const COLOR_KEYS: readonly Key[] = ['sky', 'horizon', 'fog', 'hemiSky', 'hemiGround', 'sunColor', 'cloudLit', 'cloudDark'];
const NUMBER_KEYS: readonly Key[] = ['fogNear', 'fogFar', 'hemi', 'sun', 'windowLit', 'rain', 'lamps', 'exposure', 'clouds', 'haze'];
const ALL_KEYS: readonly Key[] = [...COLOR_KEYS, ...NUMBER_KEYS, 'neon'];

interface Rule3 {
  readonly match: RuleMatch;
  readonly set: Partial<Atmosphere3>;
}

export class AtmosphereTable3 {
  private cache = new Map<string, Atmosphere3>();

  constructor(private readonly rules: readonly Rule3[]) {}

  resolve(district: CellKind, time: TimeOfDay, weather: Weather): Atmosphere3 {
    const key = `${district}|${time}|${weather}`;
    let a = this.cache.get(key);
    if (!a) {
      a = Object.assign({}, ...applicableRules(this.rules, district, time, weather).map((r) => r.set)) as Atmosphere3;
      this.cache.set(key, a);
    }
    return a;
  }
}

export function parseAtmosphere3(file: string, text: string, errors: string[]): AtmosphereTable3 | null {
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
  const districts = new Set<string>(Object.values(CELL_CHARS));
  const rules: Rule3[] = list.map((raw: Record<string, unknown>, i) => {
    const at = `rule ${i}`;
    const match = (raw.match ?? {}) as Record<string, unknown>;
    checkMatch(match, districts, (m) => err(`${at}: ${m}`));
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries((raw.set ?? {}) as Record<string, unknown>)) {
      if (!ALL_KEYS.includes(k as Key)) err(`${at}: unknown key '${k}'`);
      else if (COLOR_KEYS.includes(k as Key)) {
        if (!/^#[0-9a-f]{6}$/i.test(String(v))) err(`${at}: ${k} must be '#rrggbb'`);
        set[k] = parseInt(String(v).slice(1), 16);
      } else if (NUMBER_KEYS.includes(k as Key)) {
        if (typeof v !== 'number') err(`${at}: ${k} must be a number`);
        set[k] = v;
      } else {
        if (!['off', 'on', 'flicker'].includes(String(v))) err(`${at}: neon must be off | on | flicker`);
        set[k] = v;
      }
    }
    return { match: match as RuleMatch, set: set as Partial<Atmosphere3> };
  });
  const base = rules.find((r) => Object.keys(r.match).length === 0);
  if (!base) err('needs a base rule with an empty match');
  else for (const k of ALL_KEYS) if (!(k in base.set)) err(`base rule is missing '${k}'`);
  return errors.length > before ? null : new AtmosphereTable3(rules);
}

/**
 * Part way from one look to another (f 0-1): colours and numbers blend (the clock's dusk fades into night rather
 * than switching), the neon's state switches half way.
 */
export function blendAtmosphere(a: Atmosphere3, b: Atmosphere3, f: number): Atmosphere3 {
  if (f <= 0) return a;
  if (f >= 1) return b;
  const out: Record<string, unknown> = {};
  const lerp = (x: number, y: number): number => x + (y - x) * f;
  for (const k of COLOR_KEYS) {
    const x = a[k] as number;
    const y = b[k] as number;
    out[k] = (Math.round(lerp((x >> 16) & 255, (y >> 16) & 255)) << 16) | (Math.round(lerp((x >> 8) & 255, (y >> 8) & 255)) << 8) | Math.round(lerp(x & 255, y & 255));
  }
  for (const k of NUMBER_KEYS) out[k] = lerp(a[k] as number, b[k] as number);
  out.neon = f < 0.5 ? a.neon : b.neon;
  return out as unknown as Atmosphere3;
}
