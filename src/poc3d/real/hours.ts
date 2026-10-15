import { TRADE, TRADE_COUNT } from './shops';

/**
 * Shops' hours (2026-10-15): a sign is lit, a shop's light on inside and on the pavement, while it's open by the story
 * clock (`CityUniforms.uHour`). One table for the shaders (signs.ts, city.ts: `HOURS_GLSL`) and the lightmap (the chunk
 * workers paint a closed shop's glow out: chunkBuild.ts, `openHours`), so the sign, its shop and the light under them
 * go out together.
 *
 * Classes: 0 always (stamps' signs, hotels, love hotels, the konbini, a coin laundry), 1 the night trades (17:00 to
 * 5:00), 2 izakaya, noodles, pachinko, game centres (11:00 to midnight), 3 shops and cafés (10:00 to 22:00), 4 the
 * grocer's, the barber's, the baker's (8:00 to 20:00), 5 banks, clinics, offices (9:00 to 19:00). Each place closes
 * within 45 minutes of its class's time (`seed`: a sign's id, a building's), so a street goes dark one at a time.
 */
export const HOURS = { always: 0, night: 1, late: 2, shops: 3, day: 4, office: 5 } as const;

/** [opens, closes] by class, in hours (a close past 24 is the next morning). */
const SPANS: readonly (readonly [number, number])[] = [[0, 48], [17, 29], [11, 24], [10, 22], [8, 20], [9, 19]];

const HOURS_OF: Readonly<Partial<Record<number, number>>> = {
  [TRADE.bar]: HOURS.night, [TRADE.snack]: HOURS.night, [TRADE.lounge]: HOURS.night, [TRADE.mahjong]: HOURS.night, [TRADE.karaoke]: HOURS.night,
  [TRADE.izakaya]: HOURS.late, [TRADE.noodles]: HOURS.late, [TRADE.pachinko]: HOURS.late, [TRADE.arcade]: HOURS.late,
  [TRADE.cafe]: HOURS.shops, [TRADE.fashion]: HOURS.shops, [TRADE.electronics]: HOURS.shops, [TRADE.hobby]: HOURS.shops, [TRADE.maid]: HOURS.shops,
  [TRADE.books]: HOURS.shops, [TRADE.drugstore]: HOURS.shops, [TRADE.general]: HOURS.shops, [TRADE.gym]: HOURS.shops,
  [TRADE.grocer]: HOURS.day, [TRADE.bakery]: HOURS.day, [TRADE.salon]: HOURS.day, [TRADE.florist]: HOURS.day, [TRADE.craft]: HOURS.day,
  [TRADE.bank]: HOURS.office, [TRADE.clinic]: HOURS.office, [TRADE.estate]: HOURS.office, [TRADE.lobby]: HOURS.office, [TRADE.warehouse]: HOURS.office,
};

/** A shop's hours class by its trade. */
export const hoursOf = (trade: number): number => HOURS_OF[trade] ?? HOURS.always;

/** A sign id (under 100000) with its hours class in its hundred-thousands (the sign shader reads it from there). */
export const withHours = (id: number, hours: number): number => hours * 100000 + (Math.abs(Math.floor(id)) % 100000);

/** How far from its class's closing time a place closes, -0.5 to 0.5 of 1.5 h: the same on the GPU (small integers only). */
const jitter = (seed: number): number => {
  const k = (Math.abs(Math.floor(seed)) % 997) * 0.618034;
  return k - Math.floor(k) - 0.5;
};

/** Whether a place of this class is open at this hour (0 to 24). */
export function openHours(cls: number, seed: number, hour: number): boolean {
  if (!cls) return true;
  const [a, b0] = SPANS[cls] ?? SPANS[0];
  const b = b0 + jitter(seed) * 1.5;
  return (hour >= a && hour < b) || (hour + 24 >= a && hour + 24 < b);
}

/**
 * What's open at this hour, as far as the lightmap can tell (district/world.ts paints it again when this changes): each
 * class closed, open, or in the hour and a half its places shut in (a quarter of an hour at a time there).
 */
export function hoursPhase(hour: number): string {
  return SPANS.slice(1)
    .map(([a, b]) => {
      const h = hour < a - 0.01 && hour + 24 < b + 0.75 ? hour + 24 : hour;
      if (h < a) return 'c';
      if (h < b - 0.75) return 'o';
      if (h < b + 0.75) return `t${Math.floor(h * 4)}`;
      return 'c';
    })
    .join('');
}

/** The shaders' side: `uniform float uHour` must be declared before it. */
export const HOURS_GLSL = /* glsl */ `
  const float TRADE_HOURS[${TRADE_COUNT}] = float[${TRADE_COUNT}](${Array.from({ length: TRADE_COUNT }, (_, t) => hoursOf(t).toFixed(1)).join(', ')});
  float hoursJitter(float seed) { float k = mod(floor(abs(seed)), 997.0) * 0.618034; return fract(k) - 0.5; }
  float openHours(float cls, float seed) {
    if (cls < 0.5) return 1.0;
    vec2 o = cls < 1.5 ? vec2(${SPANS[1].map((v) => v.toFixed(1)).join(', ')}) : cls < 2.5 ? vec2(${SPANS[2].map((v) => v.toFixed(1)).join(', ')}) : cls < 3.5 ? vec2(${SPANS[3].map((v) => v.toFixed(1)).join(', ')}) : cls < 4.5 ? vec2(${SPANS[4].map((v) => v.toFixed(1)).join(', ')}) : vec2(${SPANS[5].map((v) => v.toFixed(1)).join(', ')});
    o.y += hoursJitter(seed) * 1.5;
    float h = uHour;
    return (h >= o.x && h < o.y) || (h + 24.0 >= o.x && h + 24.0 < o.y) ? 1.0 : 0.0;
  }
`;
