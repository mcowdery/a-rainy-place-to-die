/**
 * The seasons (the whole-city plan: time passes, and the seasons turn with the story's chapters, not the days). The
 * season is the flag `world.season`; the story changes it by setting `season_spring`, `season_summer`,
 * `season_autumn` or `season_winter` (the game moves the season there and clears the flag). The story starts in
 * spring. What changes (main.ts applySeason): tree crowns (real/city.ts: cherry and dogwood blossom, fresh green,
 * deep summer green, autumn colour, bare deciduous trees in winter), lawns, the forest on the hills (real/edges.ts),
 * snow on the mountains (real/sky.ts), and what drifts down in the air (petals, leaves; snow in winter weather).
 */
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
export const FLAG_SEASON = 'world.season';

export const isSeason = (v: unknown): v is Season => typeof v === 'string' && (SEASONS as readonly string[]).includes(v);
export const seasonIndex = (s: Season): number => SEASONS.indexOf(s);

/** The season a story flag asks for (season_<name>), if the key is one. */
export function seasonFlag(key: string): Season | null {
  const m = /^season_(spring|summer|autumn|winter)$/.exec(key);
  return m ? (m[1] as Season) : null;
}

export const SEASON_NAMES: Readonly<Record<Season, string>> = { spring: '春 spring', summer: '夏 summer', autumn: '秋 autumn', winter: '冬 winter' };
