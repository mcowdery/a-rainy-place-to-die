import { hash } from '../../core/hash';
import type { Station } from './radio';

/**
 * NAMI, the phone's music app (pure: the library and what plays next; real/musicPlayer.ts plays it,
 * district/musicApp.ts draws it). The library is the radio's own music (content/radio/stations.yaml), each
 * station's tracks as a playlist you play in any order, plus the songs you've liked. Unlike a station, which
 * broadcasts on the clock, a queue starts where you say and goes where you send it.
 */

export interface Song {
  /** '<station>/<file>': also its key in the liked list. */
  readonly id: string;
  readonly station: string;
  readonly file: string;
  readonly title: string;
  readonly artist: string;
  readonly seconds: number;
}

export interface Playlist {
  readonly id: string;
  readonly name: string;
  readonly jp: string;
  readonly blurb: string;
  readonly songs: readonly Song[];
}

/** The liked songs' playlist id. */
export const LIKED = 'liked';

/** A playlist per station, in the dial's order. */
export function playlistsOf(stations: readonly Station[]): Playlist[] {
  return stations.map((s) => ({
    id: s.id,
    name: s.name,
    jp: s.jp,
    blurb: s.blurb,
    songs: s.tracks.map((t) => ({ id: `${s.id}/${t.file}`, station: s.id, file: t.file, title: t.title, artist: t.artist, seconds: t.seconds })),
  }));
}

/** The liked songs as a playlist, newest first (`liked` is in the order they were liked). */
export function likedPlaylist(playlists: readonly Playlist[], liked: readonly string[]): Playlist {
  const all = new Map(playlists.flatMap((p) => p.songs).map((s) => [s.id, s]));
  const songs = [...liked].reverse().flatMap((id) => all.get(id) ?? []);
  return { id: LIKED, name: 'Liked Songs', jp: 'お気に入り', blurb: 'The ones you kept.', songs };
}

export type Repeat = 'off' | 'all' | 'one';
export const REPEATS: readonly Repeat[] = ['off', 'all', 'one'];

/** m:ss. */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A playlist's length: '1 h 12 min', '48 min'. */
export function spanOf(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/**
 * What's playing and what comes next: a list of songs played in order or shuffled, repeating the list, one song
 * or nothing. Shuffling keeps the song that's on and deals the rest after it; turning it off carries on down the
 * list from that song.
 */
export class PlayQueue {
  /** The playlist the songs came from, and the songs as it lists them. */
  playlist = '';
  songs: readonly Song[] = [];
  shuffle = false;
  repeat: Repeat = 'all';
  /** Indexes into `songs` in the order they play, and where in that the queue is. */
  private order: number[] = [];
  private at = 0;

  get current(): Song | null {
    return this.songs[this.order[this.at]] ?? null;
  }

  /** Starts a list at one of its songs (`seed` deals the shuffle). */
  start(playlist: string, songs: readonly Song[], index: number, seed: number): void {
    this.playlist = playlist;
    this.songs = songs;
    this.deal(Math.min(Math.max(0, index), Math.max(0, songs.length - 1)), seed);
  }

  setShuffle(on: boolean, seed: number): void {
    const now = this.order[this.at] ?? 0;
    this.shuffle = on;
    this.deal(now, seed);
  }

  private deal(first: number, seed: number): void {
    const n = this.songs.length;
    if (!this.shuffle) {
      this.order = Array.from({ length: n }, (_, i) => i);
      this.at = n ? first : 0;
      return;
    }
    const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = hash(seed, i) % (i + 1);
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.order = n ? [first, ...rest] : [];
    this.at = 0;
  }

  /**
   * On to the next song: `ended` when the one playing ran out (repeat-one plays it again, and with no repeat the
   * list stops at its end: null, back at its start), else your own skip, which always goes on and wraps round.
   */
  next(ended: boolean): Song | null {
    if (!this.order.length) return null;
    if (ended && this.repeat === 'one') return this.current;
    if (this.at + 1 < this.order.length) this.at++;
    else {
      this.at = 0;
      if (ended && this.repeat === 'off') return null;
    }
    return this.current;
  }

  /** Back a song (round to the last from the first). */
  prev(): Song | null {
    if (!this.order.length) return null;
    this.at = (this.at - 1 + this.order.length) % this.order.length;
    return this.current;
  }

  /** The next few songs, as they'll play. */
  upNext(count: number): Song[] {
    const out: Song[] = [];
    for (let k = 1; k <= count && k < this.order.length; k++) {
      const i = this.at + k;
      if (i >= this.order.length && this.repeat === 'off') break;
      out.push(this.songs[this.order[i % this.order.length]]);
    }
    return out;
  }
}
