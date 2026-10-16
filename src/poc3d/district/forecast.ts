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
 * - Typhoons (台風) in late summer and early autumn (its first TYPHOON_AUTUMN_DAYS days): now and then one passes
 *   over, about TYPHOON_HOURS long: outer rain bands and a rising wind as it comes, a downpour and a storm-force
 *   wind at its height (lightning with it), the wind swinging round as it goes, then the clear blue sky after it
 *   (台風一過) with a breeze.
 * - Autumn has its rain and its morning fogs; winter snows sometimes.
 * main.ts follows it unless the weather is held (world.weather_hold: ?weather=, the debug menu's picks, the story).
 */
export const BLOCK = 3 * 60;
export const TSUYU_DAYS = 6;
export const TYPHOON_HOURS = 30;
export const TYPHOON_AUTUMN_DAYS = 14;
/** One typhoon window every this many days; the chance one comes in it. */
const TYPHOON_WINDOW = 6;
const TYPHOON_CHANCE = 0.35;

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
  /** A typhoon passing: how strong it is here now (0-1), the wind it brings (0-1+, added to the setting's) and how
   * far it has turned the wind (degrees); after (台風一過). */
  readonly typhoon: number;
  readonly wind: number;
  readonly turn: number;
  readonly after: boolean;
  /** A tropical city in its monsoon after a day of heavy rain: how deep the streets stand in water (0-1; absent elsewhere). */
  readonly flood?: number;
}

/**
 * The story's (or the debug menu's) say: a typhoon that began at this minute, a heat wave until this minute, settled
 * weather (no heat wave and no typhoon of the forecast's own) until this minute. A forced heat wave or typhoon still
 * comes when settled.
 */
export interface ForecastForce {
  readonly typhoonAt?: number | null;
  readonly heatUntil?: number | null;
  readonly settledUntil?: number | null;
}
const settled = (total: number, force: ForecastForce): boolean => force.settledUntil != null && total < force.settledUntil;

/** When the typhoon over this minute began, if one is (or just was) passing: its start minute. */
function typhoonStart(total: number, season: Season, seasonStart: number, force: ForecastForce): number | null {
  const len = TYPHOON_HOURS * 60 * 1.5;
  if (force.typhoonAt != null && total >= force.typhoonAt && total < force.typhoonAt + len) return force.typhoonAt;
  const seasonDay = Math.floor((total - seasonStart) / DAY);
  const inSeason = (season === 'summer' && seasonDay >= TSUYU_DAYS) || (season === 'autumn' && seasonDay < TYPHOON_AUTUMN_DAYS);
  if (!inSeason || settled(total, force)) return null;
  // This window's and the one before (a typhoon can run on across the line).
  const w0 = Math.floor(total / (TYPHOON_WINDOW * DAY));
  for (const w of [w0, w0 - 1]) {
    if (rnd(w, 0, 0x7f00) >= TYPHOON_CHANCE) continue;
    const start = w * TYPHOON_WINDOW * DAY + Math.floor(rnd(w, 1, 0x7f00) * 3 * DAY);
    if (total >= start && total < start + len) return start;
  }
  return null;
}

const rnd = (a: number, b: number, c: number): number => hash(a, b, c, 0x3ea7) / 4294967296;

/**
 * A tropical city's weather (cityConfig.ts `tropical`: Manila): no winter and no snow, two seasons in a cycle of
 * `DRY_DAYS + WET_DAYS` days from the story's start: the hot dry season (clear, baking days of 30-38 °C, a thunder-
 * storm in the afternoon now and then) and the monsoon (habagat: grey days of steady rain from drizzle to a
 * downpour, typhoons passing through often, and after a day of heavy rain the streets flood). `tsuyu` in the Outlook
 * is the monsoon, `heat` the dry season's hot days.
 */
export const DRY_DAYS = 40;
export const WET_DAYS = 70;
const TROPIC_TYPHOON_WINDOW = 4;
const TROPIC_TYPHOON_CHANCE = 0.4;
export const isMonsoon = (total: number): boolean => (((Math.floor(total / DAY) % (DRY_DAYS + WET_DAYS)) + DRY_DAYS + WET_DAYS) % (DRY_DAYS + WET_DAYS)) >= DRY_DAYS;

/** The typhoon over this minute (its start), in the monsoon. */
function tropicTyphoon(total: number, force: ForecastForce): number | null {
  const len = TYPHOON_HOURS * 60 * 1.5;
  if (force.typhoonAt != null && total >= force.typhoonAt && total < force.typhoonAt + len) return force.typhoonAt;
  if (settled(total, force)) return null;
  const w0 = Math.floor(total / (TROPIC_TYPHOON_WINDOW * DAY));
  for (const w of [w0, w0 - 1]) {
    const start = w * TROPIC_TYPHOON_WINDOW * DAY + Math.floor(rnd(w, 1, 0x7f01) * 2 * DAY);
    if (!isMonsoon(start) || rnd(w, 0, 0x7f01) >= TROPIC_TYPHOON_CHANCE) continue;
    if (total >= start && total < start + len) return start;
  }
  return null;
}

/** How hard it rains in one block of the monsoon's (0 dry), without a typhoon's. */
function monsoonRain(block: number, total: number): number {
  if (!isMonsoon(total)) return 0;
  const u = rnd(block, 9, 1);
  return u < 0.5 ? 0.25 + 0.75 * rnd(block, 9, 2) ** 0.7 : 0;
}

function tropicalOutlook(total: number, force: ForecastForce): Outlook {
  const block = Math.floor(total / BLOCK);
  const day = Math.floor(total / DAY);
  const m = ((total % DAY) + DAY) % DAY;
  const wet = isMonsoon(total);
  const hot = !wet && !settled(total, force) && rnd(Math.floor(day / 2), 7, 0x4ea7) < 0.6 || (force.heatUntil != null && total < force.heatUntil);
  const lo = wet ? 24 : hot ? 28 : 26;
  const hi = wet ? 31 : hot ? 38 : 34;
  const swing = (rnd(day, 7, 0x7e3) - 0.5) * 3;
  const air = (lo + hi) / 2 + swing + ((hi - lo) / 2) * Math.cos((2 * Math.PI * (m / 60 - 14)) / 24);
  // The streets flood after a day of heavy rain (the last eight blocks' average, and a typhoon's rain at its height).
  let sum = 0;
  for (let k = 0; k < 8; k++) sum += monsoonRain(block - k, total - k * BLOCK);
  const ty = tropicTyphoon(total, force);
  const flood = Math.max(0, Math.min(1, (sum / 8) * 2.4 - 0.2));
  const calm = { typhoon: 0, wind: 0.05 + 0.1 * rnd(block, 7, 5), turn: 0, after: false };
  if (ty !== null) {
    const p = (total - ty) / (TYPHOON_HOURS * 60);
    const smooth = (a: number, b: number, v: number): number => {
      const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    if (p < 1) {
      const k = smooth(0, 0.45, p) * (1 - smooth(0.7, 1, p));
      const band = Math.sin(p * 55 + rnd(ty, 2, 0x7f00) * 6) > 0.1 - k;
      const raining = k > 0.4 || (k > 0.1 && band);
      return { weather: raining ? 'rain' : 'clear', amount: raining ? Math.min(1, 0.4 + 0.65 * k) : 0, shower: false, tsuyu: true, heat: false, temp: air - 2 * k, typhoon: k, wind: 0.12 + 1.0 * k, turn: (p - 0.5) * 140, after: false, flood: Math.max(flood, k * 0.95) };
    }
    return { weather: 'clear', amount: 0, shower: false, tsuyu: wet, heat: false, temp: air + 1.5, typhoon: 0, wind: 0.35 * (1.5 - p) * 2, turn: 70, after: true, flood: Math.max(flood, 0.5 * (1 - (p - 1) * 2)) };
  }
  const rain = monsoonRain(block, total);
  if (rain > 0) return { weather: 'rain', amount: rain, shower: false, tsuyu: true, heat: false, temp: air - 2, ...calm, flood };
  // The dry season's afternoon storm: a short, hard burst after the heat of the day.
  if (!wet && m >= 13 * 60 && m < 19 * 60 && rnd(day, 7, 0x51) < 0.22) {
    const start = 13 * 60 + 240 * rnd(day, 7, 0x52);
    const len = 25 + 35 * rnd(day, 7, 0x53);
    if (m >= start && m < start + len) return { weather: 'rain', amount: 0.8 + 0.2 * rnd(day, 7, 0x54), shower: true, tsuyu: false, heat: hot, temp: air - 5, ...calm, flood: 0 };
  }
  if (wet && rnd(block, 9, 3) < 0.12) {
    const len = 20 + 40 * rnd(block, 9, 4);
    const start = (BLOCK - len) * rnd(block, 9, 6);
    const at = total - block * BLOCK;
    if (at >= start && at < start + len) return { weather: 'rain', amount: 0.5 + 0.4 * rnd(block, 9, 7), shower: true, tsuyu: true, heat: false, temp: air - 2, ...calm, flood };
  }
  // A hazy, humid morning, now and then.
  if (m >= 5 * 60 && m < 8 * 60 && hash(day, 7, 0xf06) / 4294967296 < 0.12) return { weather: 'fog', amount: 0, shower: false, tsuyu: wet, heat: false, temp: air, ...calm, flood };
  return { weather: 'clear', amount: 0, shower: false, tsuyu: wet, heat: hot, temp: air, ...calm, flood };
}

export function outlookAt(total: number, season: Season, seasonStart = 0, force: ForecastForce = {}, tropical = false): Outlook {
  if (tropical) return tropicalOutlook(total, force);
  const block = Math.floor(total / BLOCK);
  const s = seasonIndex(season);
  const day = Math.floor(total / DAY);
  const seasonDay = Math.floor((total - seasonStart) / DAY);
  const tsuyu = season === 'summer' && seasonDay >= 0 && seasonDay < TSUYU_DAYS;
  // Heat waves in runs of three days, about half of high summer.
  const heat = (season === 'summer' && !tsuyu && !settled(total, force) && rnd(Math.floor(day / 3), s, 0x4ea7) < 0.5) || (force.heatUntil != null && total < force.heatUntil);
  const o = ODDS[tsuyu ? 'tsuyu' : heat ? 'heat' : season];
  const m = (((total % DAY) + DAY) % DAY);
  // The temperature: the day's low before dawn, its high at two in the afternoon, a little different each day.
  const swing = (rnd(day, s, 0x7e3) - 0.5) * 4;
  const mid = (o.temp[0] + o.temp[1]) / 2 + swing;
  const air = mid + ((o.temp[1] - o.temp[0]) / 2) * Math.cos((2 * Math.PI * (m / 60 - 14)) / 24);
  const calm = { typhoon: 0, wind: 0, turn: 0, after: false };
  // A typhoon passing takes over the weather.
  const ty = typhoonStart(total, season, seasonStart, force);
  if (ty !== null) {
    const p = (total - ty) / (TYPHOON_HOURS * 60);
    const smooth = (a: number, b: number, v: number): number => {
      const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    if (p < 1) {
      const k = smooth(0, 0.45, p) * (1 - smooth(0.7, 1, p));
      // Out in its bands: rain on and off; near its heart, a downpour.
      const band = Math.sin(p * 55 + rnd(ty, 2, 0x7f00) * 6) > 0.1 - k;
      const raining = k > 0.55 || (k > 0.12 && band);
      return { weather: raining ? 'rain' : 'clear', amount: raining ? Math.min(1, 0.35 + 0.7 * k) : 0, shower: false, tsuyu: false, heat: false, temp: air - 2 * k, typhoon: k, wind: 0.12 + 1.0 * k, turn: (p - 0.5) * 140, after: false };
    }
    // After it (台風一過): clear and fresh, the wind dropping.
    return { weather: 'clear', amount: 0, shower: false, tsuyu: false, heat: false, temp: air + 1.5, typhoon: 0, wind: 0.35 * (1.5 - p) * 2, turn: 70, after: true };
  }
  const u = rnd(block, s, 1);
  const hard = o.light + (o.heavy - o.light) * rnd(block, s, 2);
  if (u < o.snow) return { weather: 'snow', amount: 0.3 + 0.6 * rnd(block, s, 2), shower: false, tsuyu, heat, temp: Math.min(air, 0.5), ...calm };
  if (u < o.snow + o.rain) return { weather: 'rain', amount: hard, shower: false, tsuyu, heat, temp: air - 3, ...calm };
  if (u < o.snow + o.rain + o.shower) {
    // A shower: 20-60 minutes somewhere in the spell.
    const len = 20 + 40 * rnd(block, s, 3);
    const start = (BLOCK - len) * rnd(block, s, 4);
    const at = total - block * BLOCK;
    if (at >= start && at < start + len) {
      const cold = season === 'winter' && rnd(block, s, 5) < 0.5;
      return { weather: cold ? 'snow' : 'rain', amount: Math.min(1, hard + 0.15), shower: true, tsuyu, heat, temp: cold ? Math.min(air, 0.5) : air - 1.5, ...calm };
    }
  }
  // Morning fog (04:00 to 09:00), on some mornings.
  if (m >= 4 * 60 && m < 9 * 60 && hash(day, s, 0xf06) / 4294967296 < o.fog * 3) return { weather: 'fog', amount: 0, shower: false, tsuyu, heat, temp: air, ...calm };
  return { weather: 'clear', amount: 0, shower: false, tsuyu, heat, temp: air, ...calm };
}

/**
 * The air (°C) with the weather there really is: the forecast's, but snow set by hand (the debug menu, the story)
 * over a milder spell is freezing, as the forecast's own snow is.
 */
export function airWith(o: Outlook, weather: Weather): number {
  return weather === 'snow' ? Math.min(o.temp, 0.5) : o.temp;
}

/**
 * People's breath in the cold (real/emotes.ts draws it): it shows as the air cools from BREATH_AIR[1] °C to
 * BREATH_AIR[0] and below. Breath only mists in properly cold air: nothing at 10 °C (it started at 11, and showed
 * faintly on a mild spring night), so winter's mornings, evenings and nights, snow, and the coldest wet hours
 * before a spring dawn.
 */
export const BREATH_AIR: readonly [number, number] = [2, 7];
/** How much of people's breath shows (0 to 1) in air of `temp` °C. */
export function coldBreath(temp: number): number {
  const k = Math.min(1, Math.max(0, (BREATH_AIR[1] - temp) / (BREATH_AIR[1] - BREATH_AIR[0])));
  return k * k * (3 - 2 * k);
}

export function forecastAt(total: number, season: Season, seasonStart = 0, force: ForecastForce = {}): Weather {
  return outlookAt(total, season, seasonStart, force).weather;
}
