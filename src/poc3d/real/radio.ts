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
const VOLUME_KEY = 'rainyplace.radioVolume';
function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    if (localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(v)) return Math.min(1, Math.max(0, v));
  } catch {
    /* no storage */
  }
  return 0.7;
}
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
  /** Heard from outside, out of the car's speakers: -1 (left) to 1 (right) from where you face, and 0-1 how far off
   * and shut away it is (a car's body and the distance take the top off). Absent: at the wheel, as it is in the cabin. */
  readonly away?: { readonly pan: number; readonly far: number };
  /** Heard inside a cabin (the cockpit view, a taxi's back seat): the car stereo's own tone, band-limited, with the
   * cabin's short early reflections round it. */
  readonly cab?: boolean;
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
  private away!: BiquadFilterNode;
  private hp!: BiquadFilterNode;
  private lp!: BiquadFilterNode;
  private room!: GainNode;
  private pan!: StereoPannerNode;
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
    // Heard from outside the car: a low-pass that closes with distance, and a pan toward the car.
    this.away = ctx.createBiquadFilter();
    this.away.type = 'lowpass';
    this.away.frequency.value = 22000;
    this.away.Q.value = 0.5;
    this.pan = ctx.createStereoPanner();
    this.hp = hp;
    this.lp = lp;
    ctx.createMediaElementSource(this.el).connect(hp).connect(boom).connect(lp).connect(this.away).connect(this.pan).connect(this.gain).connect(out);
    // The cabin: two short reflections off the glass and the trim (a few metres of path, dulled), mixed in only inside.
    this.room = ctx.createGain();
    this.room.gain.value = 0;
    for (const [time, tone, level] of [[0.0065, 3200, 1], [0.0133, 2200, 0.6]] as const) {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = time;
      const dull = ctx.createBiquadFilter();
      dull.type = 'lowpass';
      dull.frequency.value = tone;
      const g = ctx.createGain();
      g.gain.value = level;
      lp.connect(delay).connect(dull).connect(g).connect(this.room);
    }
    this.room.connect(this.pan);
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

  /** The car stereo's own volume knob, 0-1 in ten steps (on top of the debug menu's music level). */
  volume = readVolume();

  /** Turns the knob one step and shows it. */
  turn(dir: 1 | -1): void {
    this.volume = Math.min(1, Math.max(0, Math.round((this.volume + dir * 0.1) * 10) / 10));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      /* no storage */
    }
    const n = Math.round(this.volume * 10);
    this.onReadout?.({ top: `VOLUME ${'▮'.repeat(n)}${'▯'.repeat(10 - n)} ${n}`, bottom: '' });
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
    // (The knob is the stereo's: a taxi driver's radio isn't on yours.)
    const level = f.level * (f.station ? 1 : this.volume / 0.7);
    this.gain.gain.setTargetAtTime(on ? level * (this.burst > 0 ? 0.15 : 1) : 0, t, 0.07);
    this.hiss.gain.setTargetAtTime(on && this.burst > 0 ? level * 0.09 : 0, t, 0.02);
    const far = f.away?.far ?? 0;
    this.away.frequency.setTargetAtTime(f.away ? 7000 - 5800 * far : 22000, t, 0.15);
    this.pan.pan.setTargetAtTime(f.away ? f.away.pan * 0.7 : 0, t, 0.1);
    // A car stereo's small speakers: the bottom and the very top off, and the cabin round it.
    this.hp.frequency.setTargetAtTime(f.cab ? 100 : 55, t, 0.15);
    this.lp.frequency.setTargetAtTime(f.cab ? 7500 : 11000, t, 0.15);
    this.room.gain.setTargetAtTime(f.cab ? 0.3 : 0, t, 0.15);
    if (!on) {
      this.heard = false;
      this.quiet += f.dt;
      if (this.quiet > STOP_AFTER && !el.paused) el.pause();
      return;
    }
    this.quiet = 0;
    if (!this.heard) {
      this.heard = true;
      if (!f.away) this.announce(tuned);
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
