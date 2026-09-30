/**
 * The (district, time, weather) rule-matching mechanism shared by the 2D and 3D atmosphere tables.
 * A rule applies when every field it specifies matches; applicable rules are returned least specific
 * first (ties in file order), so merging them in order lets specific rules override general ones.
 */

export const TIMES = ['dawn', 'day', 'dusk', 'night'] as const;
export const WEATHERS = ['clear', 'rain', 'fog', 'snow'] as const;
export type TimeOfDay = (typeof TIMES)[number];
export type Weather = (typeof WEATHERS)[number];

export const FLAG_TIME = 'world.time';
export const FLAG_WEATHER = 'world.weather';

export interface RuleMatch {
  readonly district?: string;
  readonly time?: TimeOfDay;
  readonly weather?: Weather;
}

export function applicableRules<R extends { readonly match: RuleMatch }>(
  rules: readonly R[],
  district: string,
  time: TimeOfDay,
  weather: Weather,
): R[] {
  return rules
    .map((r, order) => ({ r, order, spec: Object.keys(r.match).length }))
    .filter(({ r }) => (r.match.district ?? district) === district && (r.match.time ?? time) === time && (r.match.weather ?? weather) === weather)
    .sort((a, b) => a.spec - b.spec || a.order - b.order)
    .map(({ r }) => r);
}

/** Validates a rule's match block; reports problems through err. */
export function checkMatch(m: Record<string, unknown>, districts: ReadonlySet<string>, err: (msg: string) => void): void {
  for (const k of Object.keys(m)) if (!['district', 'time', 'weather'].includes(k)) err(`unknown match key '${k}'`);
  if (m.district !== undefined && !districts.has(String(m.district))) err(`unknown district '${String(m.district)}'`);
  if (m.time !== undefined && !TIMES.includes(m.time as TimeOfDay)) err(`unknown time '${String(m.time)}'`);
  if (m.weather !== undefined && !WEATHERS.includes(m.weather as Weather)) err(`unknown weather '${String(m.weather)}'`);
}
