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
 * The light's keyframes through the day (minute, look): night until first light, dawn, the long day, dusk, night.
 * Between two keyframes the atmosphere blends from one look to the next.
 */
export const KEYFRAMES: readonly (readonly [number, TimeOfDay])[] = [
  [0, 'night'],
  [4 * 60 + 30, 'night'],
  [5 * 60 + 30, 'dawn'],
  [7 * 60, 'day'],
  [16 * 60 + 30, 'day'],
  [18 * 60, 'dusk'],
  [19 * 60 + 30, 'night'],
  [DAY, 'night'],
];

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

/** The time of day's look, for the flag the story reads: the nearest keyframe's (dawn and dusk round their peaks). */
export function phaseAt(minute: number): TimeOfDay {
  const m = ((minute % DAY) + DAY) % DAY;
  if (m >= 5 * 60 && m < 6 * 60 + 30) return 'dawn';
  if (m >= 6 * 60 + 30 && m < 17 * 60 + 15) return 'day';
  if (m >= 17 * 60 + 15 && m < 19 * 60) return 'dusk';
  return 'night';
}

/** The two looks to blend at a minute, and how far from the first to the second (0-1, eased). */
export function blendAt(minute: number): { a: TimeOfDay; b: TimeOfDay; f: number } {
  const m = ((minute % DAY) + DAY) % DAY;
  for (let i = 0; i + 1 < KEYFRAMES.length; i++) {
    const [m0, a] = KEYFRAMES[i];
    const [m1, b] = KEYFRAMES[i + 1];
    if (m >= m0 && m < m1) {
      const x = (m - m0) / (m1 - m0);
      return { a, b, f: a === b ? 0 : x * x * (3 - 2 * x) };
    }
  }
  return { a: 'night', b: 'night', f: 0 };
}

type V3 = readonly [number, number, number];
const MOON: V3 = [-0.35, 0.7, -0.55];

/** Toward the sun by day (up from the east at 06:00, high in the south at noon, down in the west at 18:00), the moon by night. */
export function sunDirAt(minute: number): [number, number, number] {
  const m = ((minute % DAY) + DAY) % DAY;
  const a = ((m - 6 * 60) / (12 * 60)) * Math.PI;
  const sun: V3 = [Math.cos(a) * 0.9, Math.max(0.12, Math.sin(a) * 0.85 + 0.12), 0.35 + Math.sin(a) * 0.1];
  // Handing over between the sun and the moon over two hours round dusk and dawn (they're far apart in the sky).
  const moonness = m >= 20 * 60 || m < 3 * 60 + 30 ? 1 : m >= 18 * 60 ? (m - 18 * 60) / 120 : m < 5 * 60 + 30 ? 1 - (m - (3 * 60 + 30)) / 120 : 0;
  const d = [0, 1, 2].map((i) => sun[i] * (1 - moonness) + MOON[i] * moonness) as [number, number, number];
  const l = Math.hypot(...d) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
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
