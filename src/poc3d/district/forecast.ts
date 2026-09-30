import { hash } from '../../core/hash';
import type { Weather } from '../../atmosphere/rules';
import { DAY } from './clock';
import { seasonIndex, type Season } from './seasons';

/**
 * The weather forecast: the weather changes by itself as the clock runs, a spell at a time (BLOCK game minutes),
 * by the season's odds. A pure function of the minute, the season and when the season began, so a save or a wait
 * lands on the same weather, and the phone's weather app (district/weatherApp.ts) can look ahead.
 *
 * - A spell is dry, rain (all through it, from drizzle to a downpour), snow, or dry with a shower in it (a short
 *   burst of 20-60 minutes: spring's are the most common). Fog settles on some early mornings.
 * - Spring rains often, in spells and showers (the spring rains, 菜種梅雨).
 * - Summer opens with the rainy season (梅雨 tsuyu: its first TSUYU_DAYS days, grey, steady light rain), then
 *   turns hot: heat waves (猛暑) come in runs of days, clear and baking, with an evening downpour now and then
 *   (夕立 yūdachi).
 * - Autumn has its rain and its morning fogs; winter snows sometimes.
 * main.ts follows it unless the weather is held (world.weather_hold: ?weather=, R, the debug menu's picks, the story).
 */
export const BLOCK = 3 * 60;
export const TSUYU_DAYS = 6;

interface Odds {
  /** Chance of a spell of rain, of snow, of a shower in a dry spell; how hard the rain is (lightest, heaviest). */
  readonly rain: number;
  readonly snow: number;
  readonly shower: number;
  readonly fog: number;
  readonly light: number;
  readonly heavy: number;
  /** The day's low and high (°C). */
  readonly temp: readonly [number, number];
}

export const ODDS: Readonly<Record<Season | 'tsuyu' | 'heat', Odds>> = {
  spring: { rain: 0.22, snow: 0, shower: 0.35, fog: 0.05, light: 0.2, heavy: 0.6, temp: [9, 19] },
  tsuyu: { rain: 0.6, snow: 0, shower: 0.2, fog: 0.08, light: 0.15, heavy: 0.45, temp: [20, 26] },
  summer: { rain: 0.1, snow: 0, shower: 0.22, fog: 0.02, light: 0.4, heavy: 0.9, temp: [25, 32] },
  heat: { rain: 0.03, snow: 0, shower: 0.16, fog: 0, light: 0.6, heavy: 0.95, temp: [28, 37] },
  autumn: { rain: 0.2, snow: 0, shower: 0.12, fog: 0.1, light: 0.25, heavy: 0.7, temp: [13, 23] },
  winter: { rain: 0.08, snow: 0.2, shower: 0.06, fog: 0.05, light: 0.2, heavy: 0.6, temp: [1, 9] },
};

export interface Outlook {
  readonly weather: Weather;
  /** How hard it's raining or snowing (0-1; 0 when dry). */
  readonly amount: number;
  /** A shower (a short burst in a dry spell) rather than a spell of rain. */
  readonly shower: boolean;
  /** The rainy season (early summer). */
  readonly tsuyu: boolean;
  /** A heat wave (high summer). */
  readonly heat: boolean;
  /** The air temperature (°C). */
  readonly temp: number;
}

const rnd = (a: number, b: number, c: number): number => hash(a, b, c, 0x3ea7) / 4294967296;

export function outlookAt(total: number, season: Season, seasonStart = 0): Outlook {
  const block = Math.floor(total / BLOCK);
  const s = seasonIndex(season);
  const day = Math.floor(total / DAY);
  const seasonDay = Math.floor((total - seasonStart) / DAY);
  const tsuyu = season === 'summer' && seasonDay >= 0 && seasonDay < TSUYU_DAYS;
  // Heat waves in runs of three days, about half of high summer.
  const heat = season === 'summer' && !tsuyu && rnd(Math.floor(day / 3), s, 0x4ea7) < 0.5;
  const o = ODDS[tsuyu ? 'tsuyu' : heat ? 'heat' : season];
  const m = (((total % DAY) + DAY) % DAY);
  // The temperature: the day's low before dawn, its high at two in the afternoon, a little different each day.
  const swing = (rnd(day, s, 0x7e3) - 0.5) * 4;
  const mid = (o.temp[0] + o.temp[1]) / 2 + swing;
  const air = mid + ((o.temp[1] - o.temp[0]) / 2) * Math.cos((2 * Math.PI * (m / 60 - 14)) / 24);
  const u = rnd(block, s, 1);
  const hard = o.light + (o.heavy - o.light) * rnd(block, s, 2);
  if (u < o.snow) return { weather: 'snow', amount: 0.3 + 0.6 * rnd(block, s, 2), shower: false, tsuyu, heat, temp: Math.min(air, 0.5) };
  if (u < o.snow + o.rain) return { weather: 'rain', amount: hard, shower: false, tsuyu, heat, temp: air - 3 };
  if (u < o.snow + o.rain + o.shower) {
    // A shower: 20-60 minutes somewhere in the spell.
    const len = 20 + 40 * rnd(block, s, 3);
    const start = (BLOCK - len) * rnd(block, s, 4);
    const at = total - block * BLOCK;
    if (at >= start && at < start + len) {
      const cold = season === 'winter' && rnd(block, s, 5) < 0.5;
      return { weather: cold ? 'snow' : 'rain', amount: Math.min(1, hard + 0.15), shower: true, tsuyu, heat, temp: cold ? Math.min(air, 0.5) : air - 1.5 };
    }
  }
  // Morning fog (04:00 to 09:00), on some mornings.
  if (m >= 4 * 60 && m < 9 * 60 && hash(day, s, 0xf06) / 4294967296 < o.fog * 3) return { weather: 'fog', amount: 0, shower: false, tsuyu, heat, temp: air };
  return { weather: 'clear', amount: 0, shower: false, tsuyu, heat, temp: air };
}

export function forecastAt(total: number, season: Season, seasonStart = 0): Weather {
  return outlookAt(total, season, seasonStart).weather;
}
