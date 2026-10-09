/**
 * Manila's soundscape, as numbers (pure, no WebAudio: tests/manilaSound.test.ts). real/audio.ts plays it, and
 * district/main.ts feeds it: which bell strikes when, what a place sounds like at a time of day, the notes of a
 * jeepney's novelty horn. Nothing here is heard by Claude: all of it is a design on paper until the user listens.
 */

/** What kind of ground a district is, for the sound: its areas by name (content/manila/zones/*.yaml `area`). */
export interface ManilaPlace {
  /** Barangay: the dense residential districts, where the courts, karaoke and tin roofs are. */
  readonly barangay: boolean;
  /** Nightlife strips (Ermida-Malaya, Poblado): videoke bars and loud nights. */
  readonly nightlife: boolean;
  /** The old walled town (Muralya) and Binundo: the church bells are close. */
  readonly oldTown: boolean;
}

const BARANGAY = new Set(['Pasko', 'Pandalan', 'Santa Resa', 'Tundo', 'Sampaluan']);
const NIGHTLIFE = new Set(['Ermida-Malaya', 'Poblado']);
const OLD_TOWN = new Set(['Muralya', 'Binundo']);

/** The kind of place for a district area name (`district.districtAt`); null or an unknown name (the open sea, a bridge)
 * is a plain one. The L0 residential cells with no zone of their own count as barangays too (`residentialCell`). */
export function manilaPlace(area: string | null, residentialCell = false): ManilaPlace {
  return {
    barangay: (area !== null && BARANGAY.has(area)) || (area === null && residentialCell),
    nightlife: area !== null && NIGHTLIFE.has(area),
    oldTown: area !== null && OLD_TOWN.has(area),
  };
}

/** A bell's strikes: seconds after the first, for the hour or the Angelus. */
export interface BellRing {
  readonly kind: 'hour' | 'angelus';
  readonly at: readonly number[];
}

/** Seconds between the strikes of an hour, within a group of the Angelus, and between its groups. */
export const BELL_GAP = 2.8;
export const ANGELUS_GAP = 1.9;
export const ANGELUS_REST = 4.6;
/** The tolling hours (a parish bell doesn't strike at night). */
export const TOLL_FROM = 5;
export const TOLL_TO = 21;

/** The Angelus hours (6:00, 12:00 and 18:00). */
export const isAngelus = (hour: number): boolean => hour === 6 || hour === 12 || hour === 18;

/**
 * The bell at the start of this hour (0-23), if it rings: the Angelus at 6, 12 and 18 (three groups of three strikes
 * with a rest between, then a short peal), the other hours from `TOLL_FROM` to `TOLL_TO` a bell struck that hour's
 * number on the twelve-hour clock, in the first 12 (the day-time tolling is kept short: more would be a nuisance).
 */
export function bellRing(hour: number): BellRing | null {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (isAngelus(h)) {
    const at: number[] = [];
    for (let g = 0; g < 3; g++) for (let i = 0; i < 3; i++) at.push(g * (2 * ANGELUS_GAP + ANGELUS_REST) + i * ANGELUS_GAP);
    // The peal after the three threes: nine quicker strikes.
    const peal = at[8] + ANGELUS_REST;
    for (let i = 0; i < 9; i++) at.push(peal + i * 0.9);
    return { kind: 'angelus', at };
  }
  if (h < TOLL_FROM || h > TOLL_TO) return null;
  const n = h % 12 || 12;
  return { kind: 'hour', at: Array.from({ length: n }, (_, i) => i * BELL_GAP) };
}

/**
 * The hour whose bell is due, if the clock has just crossed into a new one: `prev` and `now` are minutes (any
 * origin; the clock's total), compared by whole hours of the day. Null when no hour boundary was crossed or the
 * clock has jumped (a long skip, from the debug menu: never a peal of every bell it passed).
 */
export function hourCrossed(prev: number, now: number): number | null {
  if (!(now > prev) || now - prev > 90) return null;
  const a = Math.floor(prev / 60);
  const b = Math.floor(now / 60);
  return b > a ? ((b % 24) + 24) % 24 : null;
}

/** How loud the bell is heard: the old town's near; elsewhere a far-off one, from the city's own churches. */
export const bellLevel = (place: ManilaPlace): number => (place.oldTown ? 1 : place.barangay ? 0.4 : 0.3);

/** Pitches (Hz) of a jeepney's novelty horn: a run of 3-5 notes up or down a major scale, ending on a longer one. */
export function jeepneyHornNotes(seed: number): { readonly hz: readonly number[]; readonly at: readonly number[]; readonly len: readonly number[] } {
  let s = (seed >>> 0) || 1;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const scale = [0, 2, 4, 5, 7, 9, 11, 12];
  const n = 3 + Math.floor(rnd() * 3);
  const up = rnd() < 0.55;
  const root = 261.63 * 2 ** (Math.floor(rnd() * 5) / 12);
  const start = Math.floor(rnd() * 3);
  const hz: number[] = [];
  const at: number[] = [];
  const len: number[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const step = up ? Math.min(scale.length - 1, start + i * 1) : Math.max(0, scale.length - 1 - start - i);
    hz.push(root * 2 ** (scale[step] / 12));
    at.push(t);
    const last = i === n - 1;
    len.push(last ? 0.5 : 0.16);
    t += last ? 0 : 0.2;
  }
  return { hz, at, len };
}

/** The street's sounds as levels 0-1: what's wanted at this minute in this place (a frame input for CityAudio). */
export interface ManilaFrame {
  /** A videoke set somewhere near: a ballad's chords and a singer's wobble, no words. */
  readonly videoke: number;
  /** A radio left on, far off. */
  readonly radio: number;
  /** A vendor's sing-song call (it rises on two notes). */
  readonly vendor: number;
  /** Roosters (a fighting cock's crow). */
  readonly rooster: number;
  /** Dogs barking off in the barangay. */
  readonly dog: number;
  /** A court: a ball being dribbled and a crowd round it. */
  readonly court: number;
  /** Rain on corrugated iron roofs (the barangays'), 0-1 on top of the rain's own. */
  readonly tin: number;
  /** A typhoon's extra wind, 0-1. */
  readonly typhoon: number;
}

export const NO_MANILA: ManilaFrame = { videoke: 0, radio: 0, vendor: 0, rooster: 0, dog: 0, court: 0, tin: 0, typhoon: 0 };

/** A smooth 0-1 window over the hours of the day: rises over `fade` hours before `from`, falls over `fade` after `to`. */
export function windowAt(hour: number, from: number, to: number, fade = 0.75): number {
  const h = ((hour % 24) + 24) % 24;
  const inside = (x: number): number => {
    if (from <= to) return (x >= from && x <= to) || (x + 24 >= from && x + 24 <= to) ? 1 : 0;
    return x >= from || x <= to ? 1 : 0;
  };
  if (inside(h)) return 1;
  for (let d = 0; d <= fade; d += fade / 6) {
    const k = 1 - d / fade;
    if (inside(h + d) || inside(h - d)) return Math.max(0, k * k);
  }
  return 0;
}

/**
 * What the street sounds like. `minute` is the minute of the day; `rain` 0-1; `typhoon` 0-1; `indoors` (underground
 * or enclosed) silences it; `courtNear` 0-1 how close a court is (a cell with one, its distance). The levels are
 * meant to be modest: the caller scales them.
 */
export function manilaFrame(place: ManilaPlace, minute: number, rain: number, typhoon: number, courtNear: number): ManilaFrame {
  const hour = (((minute % 1440) + 1440) % 1440) / 60;
  const wet = 1 - Math.min(1, rain * 1.4);
  const district = place.barangay ? 1 : place.nightlife ? 0.8 : place.oldTown ? 0.45 : 0.25;
  const night = windowAt(hour, 18.5, 23.9) * 0.85 + windowAt(hour, 0, 1.5) * 0.4;
  const videoke = (place.barangay ? 0.8 : 0) * night + (place.nightlife ? 1 : 0) * windowAt(hour, 19, 25.5);
  return {
    videoke: Math.min(1, videoke) * (1 - 0.5 * typhoon),
    radio: district * windowAt(hour, 6, 21) * 0.55,
    vendor: district * Math.max(windowAt(hour, 5.5, 8.5), windowAt(hour, 16, 19.5)) * wet,
    rooster: (place.barangay ? 1 : 0.45) * Math.max(windowAt(hour, 3.5, 6.5, 1), 0.12 * windowAt(hour, 6.5, 17, 0.1)),
    dog: (place.barangay ? 1 : 0.4) * Math.max(windowAt(hour, 20, 29), 0.15) * (1 - 0.6 * typhoon),
    court: Math.max(0, Math.min(1, courtNear)) * (place.barangay ? 1 : 0.6) * windowAt(hour, 15.5, 22, 0.5) * wet,
    tin: place.barangay ? Math.min(1, rain * 1.3) : place.oldTown ? Math.min(1, rain) * 0.25 : 0,
    typhoon: Math.max(0, Math.min(1, typhoon)),
  };
}

/** An engine's voice for the tyre channel: what its oscillators do (real/audio.ts). */
export interface EngineVoice {
  /** The sawtooth's pitch (Hz), and the square's as a multiple of it (0.5: an octave down). */
  readonly revs: number;
  readonly sub: number;
  /** The low-pass's cutoff and the voice's level, before distance. */
  readonly lp: number;
  readonly gain: number;
}

/**
 * The engine voice of a vehicle type. Every type but the tricycle is the city's own car and bus engine, as it was
 * before (Tōto's sound is unchanged): revs from the speed and gear, a sawtooth over a square an octave down. A
 * tricycle (a motorcycle with a sidecar, Manila's) is a small two-stroke: much higher revs, the square a fifth
 * above rather than an octave below, brighter, a thin buzz that rises and falls with every gear.
 */
export function engineVoice(type: string | undefined, speed: number, acc: number, bus: boolean): EngineVoice {
  const throttle = Math.min(1, Math.max(0.12, 0.25 + acc * 0.45));
  if (type === 'tricycle') {
    return { revs: 72 + (speed % 3.2) * 11 + Math.min(speed, 10) * 5, sub: 1.5, lp: 650 + 1900 * throttle + speed * 40, gain: 0.07 * (0.4 + 0.6 * throttle) };
  }
  const gearSpeed = speed % 4.5;
  return { revs: (bus ? 22 : 30) + gearSpeed * (bus ? 5 : 8) + Math.min(speed, 14) * 1.5, sub: 0.5 * 1.01, lp: 180 + 900 * throttle + speed * 20, gain: (bus ? 0.16 : 0.1) * (0.35 + 0.65 * throttle) };
}

/**
 * How near a basketball court is, 0-1 (1 on it, 0 a hundred metres off): the barangays' open lots have courts, but
 * the lots aren't asked, so a court is a hashed stand-in: each barangay cell (`isBarangay`) has one with chance
 * `chance`, somewhere inside it, and the nearest of the nine cells round (x, z) counts.
 */
export function courtProximity(x: number, z: number, cell: number, isBarangay: (mx: number, mz: number) => boolean, hashOf: (mx: number, mz: number, k: number) => number, chance = 0.6): number {
  const mx0 = Math.floor(x / cell);
  const mz0 = Math.floor(z / cell);
  let best = 0;
  for (let mz = mz0 - 1; mz <= mz0 + 1; mz++) {
    for (let mx = mx0 - 1; mx <= mx0 + 1; mx++) {
      if (hashOf(mx, mz, 0) % 1000 >= chance * 1000 || !isBarangay(mx, mz)) continue;
      const cx = (mx + 0.2 + 0.6 * ((hashOf(mx, mz, 1) % 1000) / 1000)) * cell;
      const cz = (mz + 0.2 + 0.6 * ((hashOf(mx, mz, 2) % 1000) / 1000)) * cell;
      best = Math.max(best, 1 - Math.hypot(x - cx, z - cz) / 100);
    }
  }
  return Math.max(0, best);
}
