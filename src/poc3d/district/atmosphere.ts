import YAML from 'yaml';
import { CELL_CHARS, type CellKind } from '../../gen/macro';
import { applicableRules, checkMatch, type RuleMatch, type TimeOfDay, type Weather } from '../../atmosphere/rules';
import { LIGHT_LOOKS, type LightLook } from './clock';
import { SEASONS, type Season } from './seasons';

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
  /**
   * How much of the star field shows on a clear night, 0-1: 1 is a dark sky's (about two thousand), a city's light
   * leaves only the brightest few dozen (~0.02), none low down where its glow is thickest.
   */
  readonly stars: number;
  /**
   * The glow on the horizon round the sun (sRGB, added to the sky on the sun's side, low down, and to the clouds
   * there: sunrise and sunset colour), with a faint band of it opposite; black for none.
   */
  readonly sunGlow: number;
  /**
   * How much of the sky (and the light's colours) is the physical sky's (real/skyModel.ts: computed from where the sun
   * is) rather than these colours: 1 clear by day and through sunrise and sunset, 0 at night (the city's own sky) and
   * mostly 0 under cloud; between at the blue hour.
   */
  readonly phys: number;
}

type Key = keyof Atmosphere3;
const COLOR_KEYS: readonly Key[] = ['sky', 'horizon', 'fog', 'hemiSky', 'hemiGround', 'sunColor', 'cloudLit', 'cloudDark', 'sunGlow'];
const NUMBER_KEYS: readonly Key[] = ['fogNear', 'fogFar', 'hemi', 'sun', 'windowLit', 'rain', 'lamps', 'exposure', 'clouds', 'haze', 'stars', 'phys'];
const ALL_KEYS: readonly Key[] = [...COLOR_KEYS, ...NUMBER_KEYS, 'neon'];

interface Rule3 {
  /** (Besides district, time and weather, a 3D rule can name a season: it applies only then.) */
  readonly match: RuleMatch & { readonly season?: Season };
  readonly set: Partial<Atmosphere3>;
}

/**
 * Looks for the sky (the K panel's Sky, ?sky=): `citypop` is the rules alone; any other is the file's `skies:` entry
 * of that name, rules laid over them (each by the same matching), so a look changes only what it sets.
 */
export const SKY_LOOKS = ['noir', 'deep', 'citypop'] as const;

/** The looks between the story's times of day (clock.ts LIGHT_LOOKS) and the time each starts from. */
export const LOOK_BASE: Partial<Record<LightLook, TimeOfDay>> = { morning: 'day', golden: 'day', bluehour: 'dusk' };
export type SkyLook = (typeof SKY_LOOKS)[number];

export class AtmosphereTable3 {
  private cache = new Map<string, Atmosphere3>();

  constructor(
    private readonly rules: readonly Rule3[],
    private readonly skies: ReadonlyMap<string, readonly Rule3[]> = new Map(),
  ) {}

  resolve(district: CellKind, time: LightLook, weather: Weather, sky: SkyLook = 'citypop', season: Season = 'spring'): Atmosphere3 {
    const key = `${district}|${time}|${weather}|${sky}|${season}`;
    let a = this.cache.get(key);
    if (!a) {
      const now = (rules: readonly Rule3[]): Rule3[] => rules.filter((r) => r.match.season === undefined || r.match.season === season);
      const base = LOOK_BASE[time];
      if (base) {
        // A look between the story's times: its base's atmosphere, then the rules naming it (the sky look's last).
        const own = (rules: readonly Rule3[]): Rule3[] => applicableRules(now(rules).filter((r) => r.match.time === time), district, time as TimeOfDay, weather);
        a = Object.assign({}, this.resolve(district, base, weather, sky, season), ...[...own(this.rules), ...own(this.skies.get(sky) ?? [])].map((r) => r.set)) as Atmosphere3;
      } else {
        const t = time as TimeOfDay;
        const over = applicableRules(now(this.skies.get(sky) ?? []), district, t, weather);
        a = Object.assign({}, ...[...applicableRules(now(this.rules), district, t, weather), ...over].map((r) => r.set)) as Atmosphere3;
      }
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
  const parseRules = (list: Record<string, unknown>[], prefix: string): Rule3[] => list.map((raw, i) => {
    const at = `${prefix}rule ${i}`;
    const match = (raw.match ?? {}) as Record<string, unknown>;
    // (A look between the story's times is a time here too, and a rule can name a season: both checked here, the
    // rest by the shared check.)
    if (match.time !== undefined && !LIGHT_LOOKS.includes(match.time as LightLook)) err(`${at}: unknown time '${String(match.time)}'`);
    if (match.season !== undefined && !SEASONS.includes(match.season as Season)) err(`${at}: unknown season '${String(match.season)}'`);
    const { time: _t, season: _s, ...rest } = match;
    checkMatch(rest, districts, (m) => err(`${at}: ${m}`));
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
    return { match: match as Rule3['match'], set: set as Partial<Atmosphere3> };
  });
  const rules = parseRules(list, '');
  const skies = new Map<string, Rule3[]>();
  const skyDoc = (doc as { skies?: unknown }).skies ?? {};
  if (typeof skyDoc !== 'object' || skyDoc === null || Array.isArray(skyDoc)) err('skies must map a look to its rules');
  else
    for (const [name, l] of Object.entries(skyDoc)) {
      if (!SKY_LOOKS.includes(name as SkyLook) || name === 'citypop') err(`skies: unknown look '${name}' (one of ${SKY_LOOKS.filter((n) => n !== 'citypop').join(', ')})`);
      else if (!Array.isArray(l)) err(`skies.${name}: expected a list of rules`);
      else skies.set(name, parseRules(l, `skies.${name} `));
    }
  const base = rules.find((r) => Object.keys(r.match).length === 0);
  if (!base) err('needs a base rule with an empty match');
  else for (const k of ALL_KEYS) if (!(k in base.set)) err(`base rule is missing '${k}'`);
  return errors.length > before ? null : new AtmosphereTable3(rules, skies);
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
