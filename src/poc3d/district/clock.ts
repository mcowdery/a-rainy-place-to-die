import type { TimeOfDay } from '../../atmosphere/rules';

/**
 * The game's clock (the whole-city plan's time passing): the story's day and the time of day, kept in the flags as
 * minutes since the story began (`world.clock`, so saves carry it). Hybrid: it runs while you're out and about (an
 * hour every two real minutes), stands still in scenes, and jumps: waiting (T, a Skyrim-style wait), sleeping at
 * home, a taxi's ride, and a story flag asking for a time of day (a scene that needs night sets `time_night`).
 * Pure: the time of day's phase (the `world.time` flag the atmosphere, nodes and scenes read), the light's blend
 * between the atmosphere's four looks, the sun's direction, and the last train follow from the minute.
 */

export const DAY = 24 * 60;
/** Game minutes per real second while the clock runs (an hour every two minutes). */
export const RATE = 0.5;
/** The story's first day starts at this minute (22:00: the city's at its best), on a Friday. */
export const START_MINUTE = 22 * 60;
export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'] as const;
export const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const FIRST_WEEKDAY = 4;

/** Named times a wait or a story flag can ask for (minute of the day). */
export const TIMES_OF_DAY = {
  morning: 7 * 60,
  noon: 12 * 60,
  evening: 18 * 60,
  night: 22 * 60,
  late: 60 + 30,
} as const;
export type NamedTime = keyof typeof TIMES_OF_DAY;

/**
 * The light's looks (the 3D atmosphere's `time:`): the story's four times of day, and three more for the light
 * between them: morning (the crisp hour or two after sunrise), golden (the hour before sunset) and blue hour (the
 * twilight after sunset and before dawn). Each extra look starts from its base's rules (atmosphere.ts LOOK_BASE)
 * and changes what its own rules set.
 */
export const LIGHT_LOOKS = ['dawn', 'day', 'dusk', 'night', 'morning', 'golden', 'bluehour'] as const;
export type LightLook = (typeof LIGHT_LOOKS)[number];

/**
 * The day's length by season, from Tokyo's sky (sunrise and sunset in minutes, the sun's height at noon in
 * radians): April, July, October and January. The light's keyframes and the sun's path follow them, so winter
 * evenings are dark by five and summer's light lasts till seven.
 */
export interface DayLight {
  readonly rise: number;
  readonly set: number;
  readonly noon: number;
}
export const DAYLIGHT: Readonly<Record<'spring' | 'summer' | 'autumn' | 'winter', DayLight>> = {
  spring: { rise: 5 * 60 + 15, set: 18 * 60 + 10, noon: 1.08 },
  summer: { rise: 4 * 60 + 35, set: 18 * 60 + 58, noon: 1.33 },
  autumn: { rise: 5 * 60 + 45, set: 17 * 60 + 15, noon: 0.86 },
  winter: { rise: 6 * 60 + 50, set: 16 * 60 + 45, noon: 0.58 },
};
/** The turn of the sun's and moon's path about the vertical (rad) for a city whose sea or compass isn't Tōto's (cityConfig.ts `sunYaw`). */
let SUN_YAW = 0;
/** Sets the city's day lengths (in place, so everything holding `DAYLIGHT` sees them) and the sun's turn. Once, at startup. */
export function configureSky(daylight: Readonly<Record<'spring' | 'summer' | 'autumn' | 'winter', DayLight>> | undefined, sunYaw: number): void {
  SUN_YAW = sunYaw;
  if (daylight) for (const s of ['spring', 'summer', 'autumn', 'winter'] as const) Object.assign(DAYLIGHT[s], daylight[s]);
}
/** A direction turned about the vertical by the city's `sunYaw` (x east, z south). */
function turned(v: [number, number, number]): [number, number, number] {
  if (SUN_YAW === 0) return v;
  const c = Math.cos(SUN_YAW);
  const s = Math.sin(SUN_YAW);
  return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
}
/** (The story begins in spring; the functions below take a season's daylight and default to spring's.) */
const SPRING = DAYLIGHT.spring;

/**
 * The light's keyframes through a day (minute, look), round sunrise and sunset: night, the blue hour before dawn,
 * dawn as the sun rises, morning, the long day, golden hour, dusk as it sets, the blue hour after, night. Between
 * two keyframes the atmosphere blends from one look to the next.
 */
export function keyframes(dl: DayLight = SPRING): readonly (readonly [number, LightLook])[] {
  const k: (readonly [number, LightLook])[] = [
    [dl.rise - 80, 'night'],
    [dl.rise - 40, 'bluehour'],
    [dl.rise, 'dawn'],
    [dl.rise + 70, 'morning'],
    [dl.rise + 160, 'day'],
    [dl.set - 150, 'day'],
    [dl.set - 60, 'golden'],
    [dl.set, 'dusk'],
    [dl.set + 35, 'bluehour'],
    [dl.set + 80, 'night'],
  ];
  return [[0, 'night'], ...k, [DAY, 'night']];
}

/** The last train leaves at 00:40; the first at 05:00 (終電 to 始発: stations shut between). */
export const LAST_TRAIN = 40;
export const FIRST_TRAIN = 5 * 60;

export interface ClockTime {
  /** The story's day (1 = the first). */
  readonly day: number;
  /** Minutes since midnight. */
  readonly minute: number;
}

/** A time from minutes since the story began (day 1 starts at midnight before START_MINUTE). */
export function clockAt(total: number): ClockTime {
  const t = Math.max(0, total);
  return { day: Math.floor(t / DAY) + 1, minute: t % DAY };
}

export const totalOf = (t: ClockTime): number => (t.day - 1) * DAY + t.minute;

/** Minutes from `total` forward to the next time the clock reads `minute` (a whole day if it reads it now). */
export function untilMinute(total: number, minute: number): number {
  const now = total % DAY;
  const d = (minute - now + DAY) % DAY;
  return d === 0 ? DAY : d;
}

/**
 * The time of day the story reads (the `world.time` flag; nodes' conditions and scenes), by the season's sunrise and
 * sunset: dawn from half an hour before sunrise to 45 minutes after, day until 45 minutes before sunset, dusk until
 * 50 minutes after it, then night. So a winter evening at half past five is already dusk going on night, and a summer
 * one still light.
 */
export function phaseAt(minute: number, dl: DayLight = SPRING): TimeOfDay {
  const m = ((minute % DAY) + DAY) % DAY;
  if (m >= dl.rise - 30 && m < dl.rise + 45) return 'dawn';
  if (m >= dl.rise + 45 && m < dl.set - 45) return 'day';
  if (m >= dl.set - 45 && m < dl.set + 50) return 'dusk';
  return 'night';
}

/** The two looks to blend at a minute (on a season's daylight), and how far from the first to the second (0-1, eased). */
export function blendAt(minute: number, dl: DayLight = SPRING): { a: LightLook; b: LightLook; f: number } {
  const m = ((minute % DAY) + DAY) % DAY;
  const frames = keyframes(dl);
  for (let i = 0; i + 1 < frames.length; i++) {
    const [m0, a] = frames[i];
    const [m1, b] = frames[i + 1];
    if (m >= m0 && m < m1) {
      const x = (m - m0) / (m1 - m0);
      return { a, b, f: a === b ? 0 : x * x * (3 - 2 * x) };
    }
  }
  return { a: 'night', b: 'night', f: 0 };
}

type V3 = readonly [number, number, number];
const MOON: V3 = [-0.35, 0.7, -0.55];

/** The synodic month: new moon to new moon, in days. */
export const SYNODIC = 29.530589;
/** The moon's age (days since new) when the story begins: full, for the first night. */
export const MOON_AGE_AT_START = SYNODIC / 2;

export interface MoonNow {
  /** Days since the new moon (0 to SYNODIC). */
  readonly age: number;
  /** Degrees from full, signed: waxing positive (lit from the right, the west), waning negative; ±180 new. */
  readonly phase: number;
  /** The share of the disc lit (0 new, 1 full). */
  readonly lit: number;
  /** Toward the moon (unit; below the horizon when it's set). */
  readonly dir: [number, number, number];
  /** How far it's up: 0 set, 1 clear of the horizon (eased over its rising and setting). */
  readonly up: number;
  /** Its light on the city as a share of a full moon's high up (the lit share, and a half moon is far dimmer than half a full one). */
  readonly light: number;
}

/**
 * The lunar calendar, from minutes since the story began: the moon's age and phase (full on the first night), and
 * where it is: it follows the sun's path round the sky (clock.ts sunDirAt) a share of a day behind by its age, so it
 * rises about 50 minutes later each day: a new moon travels with the sun (dark nights), a first quarter is high at
 * dusk and sets about midnight, a full moon rises at dusk and is highest at midnight, a last quarter rises about
 * midnight.
 */
export function moonAt(total: number): MoonNow {
  const age = (((MOON_AGE_AT_START + (total - START_MINUTE) / DAY) % SYNODIC) + SYNODIC) % SYNODIC;
  const phase = 180 - (age / SYNODIC) * 360;
  const lit = (1 + Math.cos((phase * Math.PI) / 180)) / 2;
  const m = ((((total % DAY) - (age / SYNODIC) * DAY) % DAY) + DAY) % DAY;
  const a = ((m - 6 * 60) / (12 * 60)) * Math.PI;
  const y = Math.sin(a) * 0.85;
  const v = [Math.cos(a) * 0.9, y, 0.35 + Math.sin(a) * 0.1];
  const l = Math.hypot(v[0], v[1], v[2]);
  const t = Math.max(0, Math.min(1, (y + 0.02) / 0.12));
  const up = t * t * (3 - 2 * t);
  return { age, phase, lit, dir: turned([v[0] / l, v[1] / l, v[2] / l]), up, light: lit ** 1.5 * up };
}

/**
 * The sun's angle along its path (0 rising in the east, π/2 at noon, π setting in the west, on round below the
 * horizon through the night), from a season's sunrise and sunset.
 */
function sunAngle(minute: number, dl: DayLight): number {
  const m = ((minute % DAY) + DAY) % DAY;
  const dayLen = dl.set - dl.rise;
  const nightLen = DAY - dayLen;
  if (m >= dl.rise && m <= dl.set) return ((m - dl.rise) / dayLen) * Math.PI;
  const after = m > dl.set ? m - dl.set : m + DAY - dl.set;
  return Math.PI + (after / nightLen) * Math.PI;
}

/**
 * Where the sun really is (unit; below the horizon at night) and how far it's up (0 set, 1 risen), for its disc, the
 * sky's glow round it and how dark the night is: an arc from the east over the south (as high at noon as the
 * season's sun) to the west.
 */
export function sunAt(minute: number, dl: DayLight = SPRING): { dir: [number, number, number]; up: number } {
  const a = sunAngle(minute, dl);
  const y = Math.sin(a) * Math.sin(dl.noon);
  const dir = turned([Math.cos(a), y, Math.sin(a) * Math.cos(dl.noon)]);
  const t = Math.max(0, Math.min(1, (y + 0.02) / 0.1));
  return { dir, up: t * t * (3 - 2 * t) };
}

/** How far the light in the sky is the moon's (0-1): handing over as the sun goes down through the twilight, and back. */
export function moonnessAt(minute: number, dl: DayLight = SPRING): number {
  const y = sunAt(minute, dl).dir[1];
  const t = Math.max(0, Math.min(1, (0.1 - y) / 0.65));
  return t * t * (3 - 2 * t);
}

/**
 * Toward the sun by day, the moon by night (`moon`: moonAt's direction; a fixed one high in the north-west without
 * it), handing over through the twilight. The key light never comes from low down: the low sun and a moon below the
 * horizon still light the city from a little above it (the moon's strength is the caller's: MoonNow.light).
 */
export function sunDirAt(minute: number, moon: readonly number[] = MOON, dl: DayLight = SPRING): [number, number, number] {
  const s = sunAt(minute, dl).dir;
  const sun: V3 = [s[0] * 0.9, Math.max(0.12, s[1]), s[2] + 0.1];
  const moonness = moonnessAt(minute, dl);
  const ml = Math.hypot(moon[0], Math.max(0.2, moon[1]), moon[2]);
  const mn = [moon[0] / ml, Math.max(0.2, moon[1]) / ml, moon[2] / ml];
  const d = [0, 1, 2].map((i) => sun[i] * (1 - moonness) + mn[i] * moonness) as [number, number, number];
  const l = Math.hypot(...d) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** How dark the sky is for stars (0 day to 1 night): they come out as the sun sinks through the twilight. */
export function starsAt(minute: number, dl: DayLight = SPRING): number {
  const y = sunAt(minute, dl).dir[1];
  const t = Math.max(0, Math.min(1, (-0.1 - y) / 0.2));
  return t * t * (3 - 2 * t);
}

/** After the last train and before the first. */
export const lateAt = (minute: number): boolean => {
  const m = ((minute % DAY) + DAY) % DAY;
  return m >= LAST_TRAIN && m < FIRST_TRAIN;
};

export const weekdayOf = (day: number): number => (FIRST_WEEKDAY + day - 1) % 7;

/** 22:07 */
export const hhmm = (minute: number): string => {
  const m = Math.floor(((minute % DAY) + DAY) % DAY);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Day 3 · 金 22:07 */
export const clockLabel = (t: ClockTime): string => `Day ${t.day} · ${WEEKDAYS[weekdayOf(t.day)]} ${hhmm(t.minute)}`;

/** Where sleep takes you: 07:00 the next morning (or this morning, asleep before dawn). */
export function sleepUntil(total: number): number {
  return untilMinute(total, TIMES_OF_DAY.morning);
}
