import { LIKED, likedPlaylist, PlayQueue, type Playlist, playlistsOf, type Repeat, REPEATS, type Song } from '../district/musicQueue';
import type { Station } from '../district/radio';
import { type Readout, trackUrl } from './radio';

/**
 * NAMI's player (the phone's music app, district/musicApp.ts): the radio's music played on demand, on foot or
 * anywhere, through Mack's headphones or, with them off, the phone's own little speaker. One <audio> element
 * streams the track (as the radio does: a track decoded whole is ~90 MB) into the page's music bus two ways at
 * once, clean for the headphones and thin for the speaker, and wearing the headphones crossfades between them.
 * The headphones are a pair of noise-cancelling ones: `ears` says what the city's sound should do about them
 * (CityAudio's `AudioFrame.ears`). What's kept in the browser (localStorage `rainyplace.music`): the headphones, the
 * liked songs, shuffle and repeat, and the song that was on (it comes back paused).
 */

/** What's on Mack's ears: nothing, the headphones, or the headphones cancelling the noise. */
export type Ears = 'none' | 'worn' | 'nc';
/** The headphones (an invented make). */
export const HEADPHONES = 'OTOWA NC-7';

const KEY = 'rainyplace.music';
/** The phone's speaker against the headphones, and how long putting them on or off takes to cross over (s). */
const SPEAKER_LEVEL = 0.9;
const EARS_FADE = 0.12;
/** Back within this much of a song's start goes to the song before; later, to its start (seconds). */
const RESTART = 3;

interface Kept {
  headphones?: boolean;
  nc?: boolean;
  liked?: string[];
  shuffle?: boolean;
  repeat?: Repeat;
  playlist?: string;
  song?: string;
}

export interface MusicFrame {
  /** Whether the game lets it play (not in a scene). */
  readonly on: boolean;
  /** 0-1: the music's level. */
  readonly level: number;
}

export class MusicPlayer {
  readonly playlists: readonly Playlist[];
  readonly queue = new PlayQueue();
  /** Whether it's meant to be playing (the game may still hold it: a scene). */
  playing = false;
  headphones = true;
  nc = true;
  /** Liked songs' ids, in the order they were liked. */
  liked: string[] = [];
  /** Called when anything the app shows has changed. */
  onChange: (() => void) | null = null;
  /** Called with a new song, or what the headphones are doing, for the readout at the bottom of the view. */
  onReadout: ((r: Readout) => void) | null = null;
  private readonly el = new Audio();
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private phones!: GainNode;
  private speaker!: GainNode;
  private loaded = '';
  private held = false;
  private level = 0;

  constructor(stations: readonly Station[]) {
    this.playlists = playlistsOf(stations);
    let kept: Kept = {};
    try {
      kept = (JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}) as Kept;
    } catch {
      /* no storage, or not ours */
    }
    this.headphones = kept.headphones ?? true;
    this.nc = kept.nc ?? true;
    const known = new Set(this.playlists.flatMap((p) => p.songs.map((s) => s.id)));
    this.liked = (Array.isArray(kept.liked) ? kept.liked : []).filter((id) => known.has(id));
    this.queue.shuffle = kept.shuffle ?? false;
    this.queue.repeat = REPEATS.includes(kept.repeat as Repeat) ? (kept.repeat as Repeat) : 'all';
    const list = this.playlist(kept.playlist ?? '');
    const index = list ? list.songs.findIndex((s) => s.id === kept.song) : -1;
    if (list && index >= 0) this.queue.start(list.id, list.songs, index, Date.now());
    this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this.advance(true));
    // (A file that won't play: on to the next, unless that was the only one.)
    this.el.addEventListener('error', () => {
      if (this.queue.songs.length > 1) this.advance(false);
      else this.stop();
    });
  }

  get attached(): boolean {
    return this.ctx !== null;
  }

  /** Joins the page's audio graph (once its context has started): the music goes into `out`. */
  attach(ctx: AudioContext, out: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = out;
    const src = ctx.createMediaElementSource(this.el);
    this.phones = ctx.createGain();
    this.phones.gain.value = 0;
    src.connect(this.phones).connect(out);
    // The phone's speaker: no bottom, a hard little middle, not much top.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    hp.Q.value = 0.7;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 2200;
    mid.Q.value = 0.9;
    mid.gain.value = 5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    this.speaker = ctx.createGain();
    this.speaker.gain.value = 0;
    src.connect(hp).connect(mid).connect(lp).connect(this.speaker).connect(out);
  }

  /** What the city's sound should do about what's on his ears: they shut it out only while music plays (paused,
   * the city comes back, so a quiet phone never leaves the game muffled). */
  get ears(): Ears {
    return !this.headphones || !this.audible ? 'none' : this.nc ? 'nc' : 'worn';
  }

  /** Really sounding now (the car's radio gives way to it). */
  get audible(): boolean {
    return this.playing && !this.held;
  }

  get current(): Song | null {
    return this.queue.current;
  }

  /** A playlist by id (the liked songs are one). */
  playlist(id: string): Playlist | null {
    if (id === LIKED) return likedPlaylist(this.playlists, this.liked);
    return this.playlists.find((p) => p.id === id) ?? null;
  }

  /** Seconds into the song, and its length. */
  get position(): number {
    return this.loaded === this.current?.id ? this.el.currentTime : 0;
  }

  get duration(): number {
    return Number.isFinite(this.el.duration) && this.loaded === this.current?.id ? this.el.duration : (this.current?.seconds ?? 0);
  }

  /** Plays a playlist from one of its songs (from a shuffled one with `index` -1). Call from a tap. */
  play(playlistId: string, index: number): void {
    const list = this.playlist(playlistId);
    if (!list || list.songs.length === 0) return;
    const seed = Date.now();
    this.queue.start(list.id, list.songs, index < 0 ? seed % list.songs.length : index, seed);
    this.playing = true;
    this.load(true);
  }

  /** Play or pause. Call from a tap. */
  toggle(): void {
    if (!this.current) return;
    this.playing = !this.playing;
    if (this.playing) this.load(false);
    else this.el.pause();
    this.changed();
  }

  next(): void {
    this.advance(false);
  }

  prev(): void {
    if (!this.current) return;
    if (this.position > RESTART) this.el.currentTime = 0;
    else {
      this.queue.prev();
      this.load(true);
    }
    this.changed();
  }

  /** To a place in the song (0-1). */
  seek(to: number): void {
    if (this.loaded !== this.current?.id || !Number.isFinite(this.el.duration)) return;
    this.el.currentTime = Math.min(Math.max(0, to), 0.999) * this.el.duration;
    this.changed();
  }

  setShuffle(on: boolean): void {
    this.queue.setShuffle(on, Date.now());
    this.changed();
  }

  cycleRepeat(): void {
    this.queue.repeat = REPEATS[(REPEATS.indexOf(this.queue.repeat) + 1) % REPEATS.length];
    this.changed();
  }

  isLiked(id: string): boolean {
    return this.liked.includes(id);
  }

  like(id: string): void {
    this.liked = this.isLiked(id) ? this.liked.filter((o) => o !== id) : [...this.liked, id];
    this.changed();
  }

  /** Puts the headphones on or takes them off; the music carries on, from them or from the phone's speaker. */
  wear(on: boolean): void {
    if (on === this.headphones) return;
    this.headphones = on;
    this.blip(on ? [660, 990] : [990, 660]);
    this.onReadout?.({ top: `🎧 ${HEADPHONES}`, bottom: on ? (this.nc ? 'On · noise cancelling' : 'On') : 'Off · the phone’s speaker' });
    this.changed();
  }

  setNc(on: boolean): void {
    if (on === this.nc) return;
    this.nc = on;
    if (this.headphones) {
      this.blip(on ? [520, 520, 780] : [780, 520]);
      this.onReadout?.({ top: `🎧 ${HEADPHONES}`, bottom: on ? 'Noise cancelling on' : 'Noise cancelling off' });
    }
    this.changed();
  }

  update(f: MusicFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.level = f.level;
    const t = ctx.currentTime;
    const sounding = this.playing && f.on;
    this.phones.gain.setTargetAtTime(sounding && this.headphones ? f.level : 0, t, EARS_FADE);
    this.speaker.gain.setTargetAtTime(sounding && !this.headphones ? f.level * SPEAKER_LEVEL : 0, t, EARS_FADE);
    // A scene holds the music, and lets it go on after.
    if (this.held !== !f.on) {
      this.held = !f.on;
      if (this.held) this.el.pause();
      else if (this.playing) this.load(false);
    }
    // (Started before the graph was there, or a play the browser turned down: again now.)
    if (sounding && this.el.paused && !this.el.ended && this.loaded === this.current?.id && this.el.readyState >= 2) void this.el.play().catch(() => {});
  }

  /** The song that's up, into the element (again from its start with `restart`), playing if it should be. */
  private load(restart: boolean): void {
    const song = this.current;
    if (!song) return;
    if (this.loaded !== song.id) {
      const url = trackUrl(song.station, song.file);
      if (!url) return;
      this.loaded = song.id;
      this.el.src = url;
      this.onReadout?.({ top: `NAMI · ${this.playlist(this.queue.playlist)?.name ?? ''}`, bottom: `♪ ${song.title}${song.artist ? ` — ${song.artist}` : ''}` });
    } else if (restart) this.el.currentTime = 0;
    // (Only once it's in the page's graph: before that the element would play straight out, at full level.)
    if (this.playing && !this.held && this.ctx) void this.el.play().catch(() => {});
    this.changed();
  }

  private advance(ended: boolean): void {
    if (!this.current) return;
    if (this.queue.next(ended)) this.load(true);
    else this.stop();
  }

  /** The end of the list with nothing to repeat: stopped, back at its first song. */
  private stop(): void {
    this.playing = false;
    this.el.pause();
    this.changed();
  }

  /** The headphones' own little tones, heard in them. */
  private blip(notes: readonly number[]): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    notes.forEach((hz, i) => {
      const t = ctx.currentTime + 0.02 + i * 0.09;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09 * Math.max(0.3, this.level), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(this.out!);
      o.start(t);
      o.stop(t + 0.2);
    });
  }

  private changed(): void {
    const kept: Kept = { headphones: this.headphones, nc: this.nc, liked: this.liked, shuffle: this.queue.shuffle, repeat: this.queue.repeat, playlist: this.queue.playlist, song: this.current?.id };
    try {
      localStorage.setItem(KEY, JSON.stringify(kept));
    } catch {
      /* no storage */
    }
    this.onChange?.();
  }
}
