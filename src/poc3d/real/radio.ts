import durationsText from '../../../assets/radio/durations.json?raw';
import stationsText from '../../../content/radio/stations.yaml?raw';
import { nowPlaying, onAir, parseStations, type Station } from '../district/radio';
import { Tape } from './tape';

/**
 * The car's radio: the stations (district/radio.ts: each a function of the clock, so you join a song part way
 * through) and the tape deck (real/tape.ts: the player's own folder of music). The music is streamed through one
 * <audio> element (a track decoded whole would be ~90 MB in memory), into the page's audio graph through a car
 * stereo's tone (no deep bass, a little boom, the very top off), beside the city's sound rather than through its
 * cover and cabin filters. Changing station crackles for a moment. Heard only while `on` (at the wheel of a car);
 * off, the element is paused, so nothing streams.
 */

const files = import.meta.glob('../../../assets/radio/*/*.{ogg,opus,mp3}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlOf = (station: string, file: string): string | null => files[`../../../assets/radio/${station}/${file}`] ?? null;
/** Where a station's track is served from (the phone's music app plays the same files: real/musicPlayer.ts). */
export const trackUrl = urlOf;

/** The stations whose music this build has (content/radio/stations.yaml; tests/radio.test.ts checks the file). */
export function loadStations(city = 'toto'): Station[] {
  const errors: string[] = [];
  let durations: Record<string, number> = {};
  try {
    durations = JSON.parse(durationsText) as Record<string, number>;
  } catch {
    errors.push('assets/radio/durations.json: not JSON (npm run radio:index)');
  }
  const stations = parseStations('content/radio/stations.yaml', stationsText, durations, errors);
  for (const e of errors) console.error(e);
  return onAir(stations.filter((s) => (s.cities ?? ['toto']).includes(city)), (s, f) => urlOf(s, f) !== null);
}

/** What the radio can be tuned to besides a station's id. */
export const OFF = 'off';
export const TAPE = 'tape';

const KEY = 'rainyplace.radio';
/** The crackle on changing station (seconds), and how long after going quiet the stream is stopped. */
const BURST = 0.28;
const STOP_AFTER = 0.4;
/** A station's stream this far off its clock is put back on it (seconds). */
const DRIFT = 2;

export interface Readout {
  readonly top: string;
  readonly bottom: string;
}

export interface RadioFrame {
  readonly dt: number;
  /** Whether it's heard at all (at the wheel, in a taxi). */
  readonly on: boolean;
  /** 0-1: the music's level. */
  readonly level: number;
  /** Someone else's radio (a taxi driver's): this station whatever yours is tuned to. */
  readonly station?: string;
}

export class Radio {
  readonly tape = new Tape();
  /** A station's id, TAPE or OFF. */
  tuned: string;
  /** Called with what's on whenever it changes (the radio comes on, a new station, a new track). */
  onReadout: ((r: Readout) => void) | null = null;
  /** The clock the stations run on (seconds). */
  now: () => number = () => Date.now() / 1000;
  private readonly el = new Audio();
  private ctx: AudioContext | null = null;
  private gain!: GainNode;
  private hiss!: GainNode;
  /** What the element holds ('<station>/<file>', 'tape/<index>'), and whether it's still loading. */
  private playing = '';
  private loading = false;
  private offset: () => number = () => 0;
  private objectUrl = '';
  private heard = false;
  private last = OFF;
  private burst = 0;
  private quiet = 0;

  constructor(readonly stations: readonly Station[]) {
    let kept: string | null = null;
    try {
      kept = localStorage.getItem(KEY);
    } catch {
      /* no storage */
    }
    this.tuned = kept !== null && this.dial().includes(kept) ? kept : (stations[0]?.id ?? OFF);
    this.el.preload = 'auto';
    this.el.addEventListener('loadedmetadata', () => {
      const at = this.offset();
      if (at > 0.3 && Number.isFinite(this.el.duration)) this.el.currentTime = Math.min(at, Math.max(0, this.el.duration - 0.2));
      this.loading = false;
      if (this.heard) void this.el.play().catch(() => {});
    });
    this.el.addEventListener('error', () => (this.loading = false));
  }

  get attached(): boolean {
    return this.ctx !== null;
  }

  /** Joins the page's audio graph (once its context has started): the music goes into `out`. */
  attach(ctx: AudioContext, out: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 55;
    const boom = ctx.createBiquadFilter();
    boom.type = 'peaking';
    boom.frequency.value = 160;
    boom.Q.value = 0.8;
    boom.gain.value = 2.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 11000;
    ctx.createMediaElementSource(this.el).connect(hp).connect(boom).connect(lp).connect(this.gain).connect(out);
    // Between stations: a second of noise, looped, through a band.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2800;
    band.Q.value = 0.4;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    src.connect(band).connect(this.hiss).connect(out);
    src.start();
  }

  /** Everything the dial stops at, in order. */
  dial(): string[] {
    return [OFF, ...this.stations.map((s) => s.id), TAPE];
  }

  /** Turns the dial one stop. */
  step(dir: 1 | -1): void {
    const dial = this.dial();
    this.tune(dial[(Math.max(0, dial.indexOf(this.tuned)) + dir + dial.length) % dial.length]);
  }

  tune(to: string): void {
    if (!this.dial().includes(to)) return;
    this.tuned = to;
    try {
      localStorage.setItem(KEY, to);
    } catch {
      /* no storage */
    }
    this.announce(to);
  }

  /** The tape deck's button: the next track; with no cassette in (or `choose`), asks for a folder of music. Call
   * from a key press. */
  tapeButton(choose: boolean): void {
    if (this.tuned !== TAPE) return;
    const tape = this.tape;
    if (tape.loaded && !choose) {
      tape.skip(1);
      return;
    }
    // (A remembered folder the browser won't open again is forgotten, so the next press asks for one.)
    const got = !choose && tape.remembered ? tape.reopen() : tape.choose();
    void got.then((ok) => {
      if (ok) this.playing = '';
      this.announce(this.tuned);
    });
  }

  /** What a dial stop is playing, as the readout's two lines. */
  readout(tuned = this.tuned): Readout {
    if (tuned === OFF) return { top: 'RADIO OFF', bottom: '' };
    if (tuned === TAPE) {
      const tape = this.tape;
      const t = tape.current;
      if (t) return { top: `TAPE · ${tape.label}`, bottom: `♪ ${t.title}` };
      return { top: 'TAPE', bottom: tape.remembered ? `/ puts “${tape.label}” back in · Shift+/ another folder` : 'No cassette · / to put one in (a folder of your own music)' };
    }
    const s = this.stations.find((o) => o.id === tuned);
    if (!s) return { top: 'RADIO', bottom: '' };
    const t = nowPlaying(s, this.now()).track;
    return { top: `${s.freq} FM · ${s.name}${s.jp ? ` ${s.jp}` : ''}`, bottom: `♪ ${t.title}${t.artist ? ` — ${t.artist}` : ''}` };
  }

  private announce(tuned: string): void {
    this.onReadout?.(this.readout(tuned));
  }

  private load(key: string, url: string, offset: () => number): void {
    this.playing = key;
    this.loading = true;
    this.offset = offset;
    this.el.src = url;
  }

  update(f: RadioFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tuned = f.station && this.stations.some((s) => s.id === f.station) ? f.station : this.tuned;
    const on = f.on && tuned !== OFF;
    const el = this.el;
    // Leaving the tape (the radio off, or the dial moved): it stays where it was.
    if ((this.last === TAPE && tuned !== TAPE) || (!on && this.heard)) this.keepTape();
    if (tuned !== this.last && on) this.burst = BURST;
    this.last = tuned;
    this.burst = Math.max(0, this.burst - f.dt);
    const t = ctx.currentTime;
    this.gain.gain.setTargetAtTime(on ? f.level * (this.burst > 0 ? 0.15 : 1) : 0, t, 0.07);
    this.hiss.gain.setTargetAtTime(on && this.burst > 0 ? f.level * 0.09 : 0, t, 0.02);
    if (!on) {
      this.heard = false;
      this.quiet += f.dt;
      if (this.quiet > STOP_AFTER && !el.paused) el.pause();
      return;
    }
    this.quiet = 0;
    if (!this.heard) {
      this.heard = true;
      this.announce(tuned);
    }
    if (tuned === TAPE) {
      const tape = this.tape;
      const track = tape.current;
      if (!track) {
        if (!el.paused) el.pause();
        return;
      }
      const key = `tape/${tape.index}/${track.title}`;
      if (this.playing !== key) {
        this.playing = key;
        this.loading = true;
        const from = tape.position;
        void track
          .file()
          .then((file) => {
            if (this.playing !== key) return;
            if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = URL.createObjectURL(file);
            this.load(key, this.objectUrl, () => from);
          })
          .catch(() => (this.loading = false));
        this.announce(tuned);
      } else if (!this.loading) {
        if (el.ended || el.error) tape.skip(1);
        else if (el.paused) void el.play().catch(() => {});
      }
      return;
    }
    const s = this.stations.find((o) => o.id === tuned)!;
    const np = nowPlaying(s, this.now());
    const key = `${s.id}/${np.track.file}`;
    if (np.gap) {
      if (!el.paused) el.pause();
      return;
    }
    if (this.playing !== key) {
      this.load(key, urlOf(s.id, np.track.file)!, () => nowPlaying(s, this.now()).offset);
      this.announce(tuned);
    } else if (!this.loading && !el.ended && !el.error) {
      // Back on after a while, or the stream fell behind: onto the station's clock again.
      if (el.paused || Math.abs(el.currentTime - np.offset) > DRIFT) el.currentTime = Math.min(np.offset, Math.max(0, el.duration - 0.2));
      if (el.paused) void el.play().catch(() => {});
    }
  }

  private keepTape(): void {
    if (this.playing.startsWith('tape/') && !this.loading) this.tape.position = this.el.currentTime;
  }
}
