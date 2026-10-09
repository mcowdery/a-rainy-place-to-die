import YAML from 'yaml';
import { hash } from '../../core/hash';

/**
 * The radio (content/radio/stations.yaml; pure): stations broadcast whether you listen or not. Each plays its
 * tracks round and round, a gap between them, in an order shuffled afresh every time round, and where a station
 * is in that is a function of the time alone (`nowPlaying`), so turning the radio on joins a song part way
 * through and every radio tuned to a station plays the same thing. The time is the real clock's, not the story's
 * (which runs thirty times as fast, and jumps).
 *
 * stations:
 *   - id: jazz                 # [a-z0-9_]+, and its folder under assets/radio/
 *     name: TŌTO JAZZ
 *     jp: 東都ジャズ             # optional
 *     freq: '79.5'
 *     blurb: Jazz through the night.
 *     tracks:
 *       - { file: bass_walker.ogg, title: Bass Walker, artist: Kevin MacLeod }
 *
 * A track's length comes from assets/radio/durations.json (`npm run radio:index`, which reads the files), keyed
 * `<station>/<file>`. The music's licences and credits: assets/radio/CREDITS.md.
 */

export interface Track {
  readonly file: string;
  readonly title: string;
  readonly artist: string;
  readonly seconds: number;
}

export interface Station {
  readonly id: string;
  readonly name: string;
  readonly jp: string;
  readonly freq: string;
  readonly blurb: string;
  readonly tracks: readonly Track[];
  /** The cities whose dial has it (cityConfig.ts ids): Tōto's when the file doesn't say. */
  readonly cities?: readonly string[];
}

/** Silence between one track and the next (seconds). */
export const GAP = 1.2;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseStations(file: string, text: string, durations: Readonly<Record<string, number>>, errors: string[]): Station[] {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return [];
  }
  if (!isObj(doc) || !Array.isArray(doc.stations)) return err('expected stations: [...]'), [];
  const out: Station[] = [];
  doc.stations.forEach((s: unknown, i: number) => {
    const at = `stations[${i}]`;
    if (!isObj(s)) return err(`${at} must be a mapping`);
    const id = String(s.id);
    if (!/^[a-z0-9_]+$/.test(id)) return err(`${at}: id must match [a-z0-9_]+`);
    if (out.some((o) => o.id === id)) return err(`${at}: station '${id}' is declared twice`);
    if (!Array.isArray(s.tracks)) return err(`${at} (${id}): tracks: [...]`);
    const tracks: Track[] = [];
    s.tracks.forEach((t: unknown, j: number) => {
      if (!isObj(t) || typeof t.file !== 'string' || typeof t.title !== 'string') return err(`${at} (${id}): tracks[${j}]: { file, title, artist }`);
      if (tracks.some((o) => o.file === t.file)) return err(`${at} (${id}): '${t.file}' is listed twice`);
      const seconds = durations[`${id}/${t.file}`];
      if (!(seconds > 1)) return err(`${at} (${id}): '${t.file}' has no length in assets/radio/durations.json (npm run radio:index)`);
      tracks.push({ file: t.file, title: t.title, artist: String(t.artist ?? ''), seconds });
    });
    out.push({ id, name: String(s.name ?? id), jp: String(s.jp ?? ''), freq: String(s.freq ?? ''), blurb: String(s.blurb ?? ''), tracks, cities: Array.isArray(s.cities) ? s.cities.map(String) : ['toto'] });
  });
  return out;
}

/** The stations with only the tracks whose files are there (a build without the music has no stations). */
export function onAir(stations: readonly Station[], has: (station: string, file: string) => boolean): Station[] {
  return stations.map((s) => ({ ...s, tracks: s.tracks.filter((t) => has(s.id, t.file)) })).filter((s) => s.tracks.length > 0);
}

/** How long a station takes to play all its tracks once (seconds). */
export const cycleLength = (s: Station): number => s.tracks.reduce((sum, t) => sum + t.seconds + GAP, 0);

function seedOf(id: string): number {
  let h = 0x7ad10;
  for (let i = 0; i < id.length; i++) h = hash(h, id.charCodeAt(i));
  return h;
}

/** The order a station plays its tracks in on one time round: a shuffle of its own, never opening with the
 * track the round before closed on (its first two change places then, which leaves what it closes on alone). */
export function playOrder(s: Station, cycle: number): number[] {
  const seed = seedOf(s.id);
  const shuffle = (c: number): number[] => {
    const order = s.tracks.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = hash(seed, c, i) % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  };
  const order = shuffle(cycle);
  if (order.length > 2) {
    const before = shuffle(cycle - 1);
    if (before[before.length - 1] === order[0]) [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

export interface NowPlaying {
  /** Index into the station's tracks, and how far into it (seconds). */
  readonly index: number;
  readonly track: Track;
  readonly offset: number;
  /** In the silence after it (offset is then past its end). */
  readonly gap: boolean;
  /** Seconds until the next track starts. */
  readonly left: number;
}

/** What a station is playing at a time (seconds on the real clock). Each station is offset by its id, so they
 * don't all change track together. */
export function nowPlaying(s: Station, seconds: number): NowPlaying {
  const length = cycleLength(s);
  const t = seconds + (seedOf(s.id) % 3600);
  const cycle = Math.floor(t / length);
  let at = t - cycle * length;
  const order = playOrder(s, cycle);
  for (const index of order) {
    const track = s.tracks[index];
    const span = track.seconds + GAP;
    if (at < span) return { index, track, offset: at, gap: at >= track.seconds, left: span - at };
    at -= span;
  }
  // (Only by rounding: the very end of the round is the last track's gap.)
  const index = order[order.length - 1];
  return { index, track: s.tracks[index], offset: s.tracks[index].seconds, gap: true, left: 0 };
}
