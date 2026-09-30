import { hash } from '../../core/hash';
import type { Weather } from '../../atmosphere/rules';
import { DAY } from './clock';
import { seasonIndex, type Season } from './seasons';

/**
 * The weather forecast: the weather changes by itself as the clock runs, a spell at a time (BLOCK game minutes),
 * with the season's odds: spring rains often (the spring rains, 菜種梅雨), summer's showers are fewer, autumn has
 * its share and its fogs, winter snows sometimes. A pure function of the minute and the season, so a save or a wait
 * lands on the same weather. Fog only settles in the early morning. main.ts follows it unless the weather is held
 * (the story's flag world.weather_hold, set by ?weather=, R and the debug menu's picks).
 */
export const BLOCK = 3 * 60;

/** The chance of each kind of spell (the rest clear). */
export const ODDS: Readonly<Record<Season, { readonly rain: number; readonly snow: number; readonly fog: number }>> = {
  spring: { rain: 0.4, snow: 0, fog: 0.05 },
  summer: { rain: 0.22, snow: 0, fog: 0.03 },
  autumn: { rain: 0.26, snow: 0, fog: 0.1 },
  winter: { rain: 0.1, snow: 0.2, fog: 0.05 },
};

export function forecastAt(total: number, season: Season): Weather {
  const block = Math.floor(total / BLOCK);
  const s = seasonIndex(season);
  const u = hash(block, s, 0x3ea7) / 4294967296;
  const o = ODDS[season];
  if (u < o.snow) return 'snow';
  if (u < o.snow + o.rain) return 'rain';
  // Morning fog (04:00 to 09:00), on some mornings.
  const m = (((total % DAY) + DAY) % DAY);
  const day = Math.floor(total / DAY);
  if (m >= 4 * 60 && m < 9 * 60 && hash(day, s, 0xf06) / 4294967296 < o.fog * 3) return 'fog';
  return 'clear';
}
