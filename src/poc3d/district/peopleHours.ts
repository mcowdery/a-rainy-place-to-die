import type { Outfit } from './peopleMix';

/**
 * When the city's people are out, and how they carry themselves (pure; real/people.ts packs it into each figure and
 * its material applies it). Every figure has `hours`, a pattern through the day: the share of such people who are out
 * at an hour (`outAt`), less in rain (`RAIN`); a figure is out while that share is above its own threshold (a number
 * in [0, 1) it keeps), so the streets thin and fill by themselves as the clock runs and the weather turns: school
 * uniforms by day, office workers at the rush hours, the nightlife after dark, the shady ones late. Where the night is
 * alive (`NIGHT_LIFE` by district, a zone's `night:`) more of the ordinary people keep evening hours, so Kaburo
 * doesn't sleep while the suburbs do. An outfit can also keep to its seasons (`seasonsOf`: shorts in summer, a down
 * jacket in winter). `manner` is how someone stands about and walks (the material's routine: `shady` people squat,
 * smoke and watch; a `drunk` staggers).
 */
export const HOURS = ['always', 'day', 'commute', 'school', 'evening', 'late'] as const;
export type Hours = (typeof HOURS)[number];
export const MANNERS = ['plain', 'shady', 'drunk', 'formal', 'young'] as const;
export type Manner = (typeof MANNERS)[number];

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** 1 between the hours a and b (b before a wraps past midnight), easing in and out over e hours. */
export function span(h: number, a: number, b: number, e: number): number {
  const d = (((h - a) % 24) + 24) % 24;
  const len = (((b - a) % 24) + 24) % 24;
  return smooth(0, e, d) * (1 - smooth(len - e, len, d));
}

/** The share of people keeping `hours` who are out at hour h (0-24). */
export function outAt(hours: Hours, h: number): number {
  switch (hours) {
    case 'always':
      return 0.3 + 0.7 * span(h, 6, 23.5, 2);
    case 'day':
      return 0.03 + 0.97 * span(h, 7, 20.5, 2);
    case 'commute':
      return Math.max(0.06, 0.4 * span(h, 7, 22, 1.5), span(h, 6.5, 10, 1.2), 0.7 * span(h, 11.5, 13.5, 0.5), span(h, 16.5, 21.5, 1.5));
    case 'school':
      return Math.max(span(h, 6.8, 9, 0.6), 0.3 * span(h, 11.5, 13.5, 0.5), span(h, 15, 18.8, 0.8));
    case 'evening':
      return Math.max(0.25 * span(h, 9, 18, 2), span(h, 17, 5, 2), 0.12);
    case 'late':
      return 0.12 + 0.88 * span(h, 20.5, 4.5, 1.5);
  }
}

/** How much of each kind stays in when it rains hard (the share lost at full rain). */
export const RAIN: Readonly<Record<Hours, number>> = { always: 0.55, day: 0.7, commute: 0.3, school: 0.45, evening: 0.3, late: 0.2 };

/** Whether a figure with threshold `out` keeping `hours` is on the street at hour h in rain (0-1). */
export const isOut = (hours: Hours, out: number, h: number, rain: number): boolean => outAt(hours, h) * (1 - RAIN[hours] * rain) > out;

/** How alive a district's streets are at night (0 asleep, 1 sleepless), unless its zone says (`night:`). */
export const NIGHT_LIFE: Readonly<Record<string, number>> = { neon: 0.85, electric: 0.35, tower: 0.1, residential: 0.08, oldtown: 0.2, campus: 0.1, harbor: 0.15 };
export const nightLife = (style: { readonly night?: number }, kind: string): number => style.night ?? NIGHT_LIFE[kind] ?? 0.15;

/** The seasons an outfit is worn in, as bits (1 spring, 2 summer, 4 autumn, 8 winter). */
export function seasonsOf(outfit: Outfit): number {
  if (outfit === 'shorts' || outfit === 'yukata' || outfit === 'irezumi') return 2;
  // (An aloha shirt: not in winter.)
  if (outfit === 'chinpira') return 1 | 2 | 4;
  if (outfit === 'puffer') return 8 | 4;
  if (outfit === 'gym') return 1 | 2 | 4;
  return 15;
}

/** When someone is out and how they carry themselves, from what they are: `night` how alive the place is at night, r in [0, 1). */
export function whenOf(outfit: Outfit, body: 'man' | 'woman' | 'child' | 'elder', night: number, r: number): { hours: Hours; manner: Manner } {
  // The shady ones: the gangs and the hooded after dark, a street thug at any hour, school toughs after school.
  if (outfit === 'drunk') return { hours: 'late', manner: 'drunk' };
  if (outfit === 'yakuza' || outfit === 'bosozoku' || outfit === 'hood') return { hours: 'late', manner: 'shady' };
  if (outfit === 'chinpira') return { hours: r < 0.5 ? 'evening' : 'always', manner: 'shady' };
  if (outfit === 'irezumi' || outfit === 'yankee') return { hours: 'evening', manner: 'shady' };
  if (body === 'child') return { hours: 'day', manner: 'young' };
  if (outfit === 'school' || outfit === 'track' || outfit === 'gym') return { hours: 'school', manner: 'young' };
  if (body === 'elder' || outfit === 'kimono') return { hours: 'day', manner: 'plain' };
  if (outfit === 'gown' || outfit === 'mini' || outfit === 'maid') return { hours: 'evening', manner: 'plain' };
  // (A fat cat: at the office by day where there are offices, at dinners and clubs where the night is alive.)
  if (outfit === 'boss' || outfit === 'suit' || outfit === 'office') return { hours: r < night ? 'evening' : 'commute', manner: 'formal' };
  if (outfit === 'work' || outfit === 'apron' || outfit === 'nurse' || outfit === 'doctor') return { hours: 'day', manner: 'plain' };
  if (outfit === 'police') return { hours: 'always', manner: 'formal' };
  // Everyone else: where the night is alive they're out in the evening, else by day and thinner after dark.
  return { hours: r < night ? 'evening' : 'always', manner: 'plain' };
}

const f = (v: number): string => v.toFixed(3);
/**
 * GLSL: `mobOut(hours, hour, rain)`, the share of people keeping `hours` (its index in HOURS) who are out, as
 * `outAt` and `RAIN` give it.
 */
export const HOURS_GLSL = /* glsl */ `
      float hourSpan(float h, float a, float b, float e) {
        float d = mod(h - a + 48.0, 24.0);
        float len = mod(b - a + 48.0, 24.0);
        return smoothstep(0.0, e, d) * (1.0 - smoothstep(len - e, len, d));
      }
      float mobOut(float hours, float h, float rain) {
        float o;
        float wet;
        if (hours < 0.5) { o = 0.3 + 0.7 * hourSpan(h, 6.0, 23.5, 2.0); wet = ${f(RAIN.always)}; }
        else if (hours < 1.5) { o = 0.03 + 0.97 * hourSpan(h, 7.0, 20.5, 2.0); wet = ${f(RAIN.day)}; }
        else if (hours < 2.5) { o = max(max(0.06, 0.4 * hourSpan(h, 7.0, 22.0, 1.5)), max(max(hourSpan(h, 6.5, 10.0, 1.2), 0.7 * hourSpan(h, 11.5, 13.5, 0.5)), hourSpan(h, 16.5, 21.5, 1.5))); wet = ${f(RAIN.commute)}; }
        else if (hours < 3.5) { o = max(max(hourSpan(h, 6.8, 9.0, 0.6), 0.3 * hourSpan(h, 11.5, 13.5, 0.5)), hourSpan(h, 15.0, 18.8, 0.8)); wet = ${f(RAIN.school)}; }
        else if (hours < 4.5) { o = max(max(0.25 * hourSpan(h, 9.0, 18.0, 2.0), hourSpan(h, 17.0, 5.0, 2.0)), 0.12); wet = ${f(RAIN.evening)}; }
        else { o = 0.12 + 0.88 * hourSpan(h, 20.5, 4.5, 1.5); wet = ${f(RAIN.late)}; }
        return o * (1.0 - wet * rain);
      }
`;
