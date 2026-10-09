/**
 * The city's sound, in WebAudio: rain, wind, thunder and wet tyres. Everything is synthesized from noise
 * so it works with no files, but a recording dropped into assets/audio/ replaces its synthesized part
 * (see assets/audio/README.md): rain_loop, rain_roof_loop, wind_loop, tyre_hiss (loops), thunder_1..n and
 * step_<surface>[_<footwear>]_1..n (footsteps; a splash joins in on wet ground).
 *
 * - Rain: a bed of filtered noise (a distant hiss and a nearer body) whose level and brightness follow
 *   the rain, plus close patter (short random clicks, panned). Under a roof the bed is duller and a
 *   hollow drumming and drips join in; indoors (a shop, a basement) it's the rain through the walls: the hiss
 *   gone, the body of it left, quiet.
 * - Cover: the outside is heard three ways at once (as it is, from under a roof, through walls) and going in
 *   or out crossfades between them over `COVER_FADE` (no filter is swept: the top of the sound fades out), the
 *   close drops, the drumming and the drips moving with the same fade.
 * - Wind: band-passed noise following the gusts; a resonant howl on top in a gale.
 * - Thunder: a crack for close strikes, a long low roll for far ones, delayed by distance (340 m/s).
 * - Tyres and engines: for the nearest cars, a tyre hiss (loud on wet roads) and an engine whose pitch
 *   follows speed, gears and throttle, idling at the lights, with Doppler as they pass.
 * - Footsteps: one for each surface (district/footing.ts) in each kind of footwear, on the foot that lands,
 *   modelled in real/stepSynth.ts (rendered a few of each as they're first needed) with a little of the space
 *   round them.
 * - In a car's cabin the world outside is dulled and quieter, and the rain drums on the roof.
 * The context starts on the first click (browsers need a gesture).
 */

import type { Footwear, Surface } from '../district/footing';
import { renderSplash, renderStep } from './stepSynth';

const recordings = import.meta.glob('../../../assets/audio/*.{ogg,mp3,wav,m4a}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const recording = (name: string): string | null => Object.entries(recordings).find(([k]) => k.split('/').pop()!.replace(/\.\w+$/, '') === name)?.[1] ?? null;
const thunderFiles = (): string[] =>
  Object.entries(recordings)
    .filter(([k]) => /\/thunder_\d+\.\w+$/.test(k))
    .map(([, v]) => v);

export interface AudioFrame {
  readonly dt: number;
  /** 0-1 rain strength (0 when none). */
  readonly rain: number;
  /** 0-1 wind strength and the current gust factor (~0.5-1.1). */
  readonly wind: number;
  readonly gust: number;
  /** Where the listener is: out in the open, under a roof, or enclosed (walls all round). */
  readonly cover: 'open' | 'roof' | 'enclosed';
  /** Riding the train. */
  readonly train: boolean;
  /** 0-1 master volume. */
  readonly volume: number;
  /** Listener position and the direction it faces (yaw, radians: 0 looks -z). */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Nearest vehicles (position, velocity, speed, acceleration, bus), nearest first; how wet the road is 0-1. */
  readonly cars: readonly { readonly x: number; readonly z: number; readonly vx: number; readonly vz: number; readonly speed: number; readonly acc: number; readonly bus: boolean }[];
  readonly wet: number;
  /** How far inside a car's cabin the listener is (0 out in the open, 1 shut in): the world outside is muffled. */
  readonly cabin?: number;
  /** The cabin's damping (0 none: as outside; 0.5 as built; 1 nearly everything shut out), and how loud the rain
   * drums on the car's roof (1 as built). Only the car: buildings have their own cover. */
  readonly cabinDamp?: number;
  readonly cabinRoof?: number;
  /** What's on the listener's ears (real/musicPlayer.ts): headphones shut some of the world out, and with their
   * noise cancelling on nearly all of it. The music and the phone's own sounds are heard in them. */
  readonly ears?: 'none' | 'worn' | 'nc';
  /** Summer: the cicadas' daytime chorus (0-1, louder in a heat wave and among trees), and the higurashi at dusk. */
  readonly cicadas?: number;
  readonly higurashi?: number;
}

const TYRE_VOICES = 3;
/** Going in under cover or back out, and getting into a car's cabin: seconds for the sound to cross over. */
const COVER_FADE = 0.9;
const CABIN_FADE = 0.6;
/** Headphones going on or off, and their noise cancelling: seconds to cross over, and how loud the world is
 * through the cups, and with the cancelling on. */
const EARS_FADE = 0.35;
const WORN_LEVEL = 0.6;
const NC_LEVEL = 0.13;
/** How loud the outside is through walls. */
const INDOOR_LEVEL = 0.4;

/** A filter in a chain: its type, frequency, Q and (shelves) its gain in dB. */
type Filter = readonly [type: BiquadFilterType, hz: number, q: number, db?: number];
/** A bus heard several ways at once (CityAudio.blend): what feeds it, and each way's level. */
interface Blend {
  readonly input: GainNode;
  readonly gains: readonly GainNode[];
}

/** A footstep: what's on the feet, which foot (panned a little its way), how much of a run it is (0..1), how full
 * the stride (0..1), how wet the ground, what's overhead, and for a landing the fall's speed (m/s). */
export interface StepOptions {
  readonly footwear: Footwear;
  readonly foot?: 'l' | 'r';
  readonly run: number;
  readonly weight?: number;
  readonly wet: number;
  /** How deep in a puddle this foot lands (0 none, 1 the middle of one: roadGrip.ts `puddleAt`). */
  readonly puddle?: number;
  readonly cover: 'open' | 'roof' | 'enclosed';
  readonly volume: number;
  readonly land?: number;
}

/** How many different steps of each kind are kept (rendered one at a time, as they're first wanted). */
const STEP_VARIANTS = 6;
/** A step's level against the rest of the city's sound, and how much of the space round it is heard with it. */
const STEP_LEVEL = 0.3;
const STEP_ROOM = { open: 0.07, roof: 0.16, enclosed: 0.3 } as const;

/** Recordings made before the surfaces were told apart: step_hard_* stands in for these. */
const HARD: ReadonlySet<Surface> = new Set(['asphalt', 'paving', 'tile']);
/** Ground that holds water: a step on it wet has a tsk of it, and in a puddle splashes. */
const PUDDLED: ReadonlySet<Surface> = new Set(['asphalt', 'paving', 'gravel', 'earth']);

export class CityAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  /** The world outside (weather, traffic, insects): as it is, or through a car's glass. */
  private world!: Blend;
  private noise!: AudioBuffer;
  private clicks: AudioBuffer[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private thunderBuffers: AudioBuffer[] = [];
  private stepBuffers = new Map<string, AudioBuffer[]>();
  /** Synthesized steps by kind (real/stepSynth.ts), the one last played, and the space a step sounds in. */
  private readonly stepRendered = new Map<string, AudioBuffer[]>();
  private stepLast: AudioBuffer | null = null;
  private stepRoom!: ConvolverNode;
  // Rain bed.
  private bedGain!: GainNode;
  private bedHiss!: BiquadFilterNode;
  private bedBody!: BiquadFilterNode;
  private bedHissGain!: GainNode;
  private bedBodyGain!: GainNode;
  /** Everything out of doors: as it is, from under a roof, or through walls. */
  private cover!: Blend;
  /** Where the listener is, each easing toward the frame's (0..1): inside walls, under any roof, in a cabin. */
  private indoorT = 0;
  private roofT = 0;
  private cabinT = 0;
  /** Everything the city makes, heard bare, through headphones' cups, or with their noise cancelling on. */
  private ears!: Blend;
  private wornT = 0;
  private ncT = 0;
  private patterBus!: GainNode;
  private roofGain!: GainNode;
  // Wind.
  private windGain!: GainNode;
  private windBand!: BiquadFilterNode;
  private howlGain!: GainNode;
  private howlBand!: BiquadFilterNode;
  // Train rumble.
  private trainGain!: GainNode;
  // Tyres.
  // Cicadas: the aburazemi's sizzle, and the higurashi's calls at dusk.
  private cicadaGain!: GainNode;
  private higurashiDebt = 0;
  private tyres: { gain: GainNode; pan: StereoPannerNode; band: BiquadFilterNode; engine: GainNode; osc: OscillatorNode[]; lp: BiquadFilterNode }[] = [];
  private patterDebt = 0;
  private roofDebt = 0;
  private dripDebt = 0;
  /** Current levels, for diagnostics. */
  readonly levels = { bed: 0, patter: 0, roof: 0, wind: 0, tyres: 0 };

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Where music joins the graph (real/radio.ts): under the master volume, beside the city's sound. Null until
   * the context has started. */
  musicOut(): { ctx: AudioContext; out: AudioNode } | null {
    return this.ctx ? { ctx: this.ctx, out: this.music } : null;
  }

  /** Creates the audio graph (call from a user gesture). Safe to call again (resumes). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    // On the way out, the listener's ears: bare; under headphones (the cups take the top off); and with their
    // noise cancelling on, which takes out the low drone as well, leaving a little of the middle.
    this.ears = this.blend(comp, [[], [['lowpass', 2600, 0.5], ['highshelf', 4200, 0, -8]], [['highpass', 240, 0.5], ['lowpass', 1300, 0.5], ['highshelf', 2200, 0, -12]]]);
    this.master.connect(this.ears.input);
    // Music (the car's radio) goes round the compressor: the city's sound mustn't pump it.
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(ctx.destination);
    this.world =this.blend(this.master, [[], [['lowpass', 1100, 0.5], ['highshelf', 3000, 0, -9]]]);
    // A few seconds of white noise, and short click grains of different lengths.
    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = this.noise.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    // The space round a footstep: a short dark echo (noise dying away over half a second, its top rolled off).
    this.stepRoom = ctx.createConvolver();
    const room = ctx.createBuffer(2, Math.round(ctx.sampleRate * 0.5), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = room.getChannelData(c);
      let low = 0;
      for (let i = Math.round(ctx.sampleRate * 0.006); i < d.length; i++) {
        low += ((Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.07)) - low) * 0.45;
        d[i] = low;
      }
    }
    this.stepRoom.buffer = room;
    this.stepRoom.connect(this.master);
    for (const ms of [6, 10, 16, 26]) {
      const n = Math.round((ctx.sampleRate * ms) / 1000);
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-i / n) * 5);
      this.clicks.push(b);
    }
    // Everything out of doors goes through the cover: bright in the open, duller under a roof, and through walls
    // only its middle (the rumble under it and the hiss over it taken off).
    this.cover = this.blend(this.world.input, [[], [['lowpass', 3200, 0.5]], [['highpass', 110, 0.5], ['lowpass', 950, 0.5], ['highshelf', 2600, 0, -14]]]);
    // Rain bed: two filtered noise layers.
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    this.bedGain.connect(this.cover.input);
    this.bedHiss = ctx.createBiquadFilter();
    this.bedHiss.type = 'highpass';
    this.bedHiss.frequency.value = 2200;
    this.bedBody = ctx.createBiquadFilter();
    this.bedBody.type = 'bandpass';
    this.bedBody.frequency.value = 700;
    this.bedBody.Q.value = 0.5;
    this.bedHissGain = ctx.createGain();
    this.bedBodyGain = ctx.createGain();
    this.loop(this.noise, 0).connect(this.bedHiss).connect(this.bedHissGain).connect(this.bedGain);
    this.loop(this.noise, 1.3).connect(this.bedBody).connect(this.bedBodyGain).connect(this.bedGain);
    // Patter (close drops) and roof drumming.
    this.patterBus = ctx.createGain();
    this.patterBus.connect(this.cover.input);
    this.roofGain = ctx.createGain();
    this.roofGain.gain.value = 0;
    const roofLp = ctx.createBiquadFilter();
    roofLp.type = 'lowpass';
    roofLp.frequency.value = 700;
    this.roofGain.connect(roofLp).connect(this.master);
    // Wind: a broad band and a resonant howl.
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windBand = ctx.createBiquadFilter();
    this.windBand.type = 'bandpass';
    this.windBand.frequency.value = 300;
    this.windBand.Q.value = 0.6;
    this.loop(this.noise, 2.1).connect(this.windBand).connect(this.windGain).connect(this.cover.input);
    this.howlGain = ctx.createGain();
    this.howlGain.gain.value = 0;
    this.howlBand = ctx.createBiquadFilter();
    this.howlBand.type = 'bandpass';
    this.howlBand.frequency.value = 600;
    this.howlBand.Q.value = 5;
    this.loop(this.noise, 3.3).connect(this.howlBand).connect(this.howlGain).connect(this.cover.input);
    // Train: a low rumble with the rail joints' rhythm.
    // Cicadas. The aburazemi: a bright sizzle, noise through a narrow band near 4.5 kHz, buzzed at ~50 Hz.
    this.cicadaGain = ctx.createGain();
    this.cicadaGain.gain.value = 0;
    this.cicadaGain.connect(this.cover.input);
    const sizzleBand = ctx.createBiquadFilter();
    sizzleBand.type = 'bandpass';
    sizzleBand.frequency.value = 4000;
    sizzleBand.Q.value = 1.2;
    // (Softened: the top taken off, so it sits back in the distance rather than in your ear.)
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 5200;
    const buzz = ctx.createGain();
    buzz.gain.value = 0.8;
    const buzzLfo = ctx.createOscillator();
    buzzLfo.frequency.value = 52;
    const buzzDepth = ctx.createGain();
    buzzDepth.gain.value = 0.2;
    buzzLfo.connect(buzzDepth).connect(buzz.gain);
    buzzLfo.start();
    this.loop(this.noise, 2.1).connect(sizzleBand).connect(soften).connect(buzz).connect(this.cicadaGain);
    this.trainGain = ctx.createGain();
    this.trainGain.gain.value = 0;
    const trainLp = ctx.createBiquadFilter();
    trainLp.type = 'lowpass';
    trainLp.frequency.value = 220;
    this.loop(this.noise, 0.7).connect(trainLp).connect(this.trainGain).connect(this.master);
    // Tyres: one voice per nearby car.
    for (let i = 0; i < TYRE_VOICES; i++) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2600;
      band.Q.value = 0.6;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      this.loop(this.noise, 0.4 + i).connect(band).connect(gain).connect(pan).connect(this.cover.input);
      // The engine: a low sawtooth and a detuned square an octave down (the firing rumble), filtered
      // brighter under load; pitch follows the revs, Doppler as it passes.
      const engine = ctx.createGain();
      engine.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300;
      lp.Q.value = 2;
      const osc = [ctx.createOscillator(), ctx.createOscillator()];
      osc[0].type = 'sawtooth';
      osc[1].type = 'square';
      for (const o of osc) {
        o.frequency.value = 40;
        o.connect(lp);
        o.start();
      }
      lp.connect(engine).connect(pan);
      this.tyres.push({ gain, pan, band, engine, osc, lp });
    }
    void this.loadRecordings();
    // The steps most likely to come first (the street, walking, and its wet), rendered while the page is idle, so
    // the first footfall doesn't wait on a render.
    const first: (() => void)[] = [];
    for (const footwear of ['boots', 'shoes', 'bare'] as const) for (const surface of ['paving', 'asphalt'] as const) first.push(() => void this.stepBuffer(surface, footwear, false, false));
    for (const depth of [0, 0.45, 1] as const) first.push(() => void this.splashBuffer(depth, false));
    const next = (): void => {
      first.shift()?.();
      if (first.length) setTimeout(next, 150);
    };
    setTimeout(next, 500);
  }

  /**
   * A bus heard several ways at once: its sound down each chain of filters in parallel (an empty chain: as it is),
   * each with its own level, into `out`; the first is on to begin with. Moving between them is a crossfade, so a
   * change of place fades the top of the sound out rather than sweeping a filter down through it.
   */
  private blend(out: AudioNode, chains: readonly (readonly Filter[])[]): Blend {
    const ctx = this.ctx!;
    const input = ctx.createGain();
    const gains = chains.map((chain, i) => {
      let node: AudioNode = input;
      for (const [type, hz, q, db] of chain) {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = hz;
        b.Q.value = q;
        if (db !== undefined) b.gain.value = db;
        node.connect(b);
        node = b;
      }
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0;
      node.connect(g).connect(out);
      return g;
    });
    return { input, gains };
  }

  /** A looping noise (or recording) source, started at an offset so layers don't line up. */
  private loop(buffer: AudioBuffer, offset: number): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.start(0, offset % buffer.duration);
    return s;
  }

  /** Recordings replace their synthesized layer when present. */
  private async loadRecordings(): Promise<void> {
    const ctx = this.ctx!;
    const load = async (url: string): Promise<AudioBuffer | null> => {
      try {
        return await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      } catch {
        return null;
      }
    };
    for (const name of ['rain_loop', 'rain_roof_loop', 'wind_loop', 'tyre_hiss']) {
      const url = recording(name);
      const b = url && (await load(url));
      if (b) this.buffers.set(name, b);
    }
    for (const url of thunderFiles()) {
      const b = await load(url);
      if (b) this.thunderBuffers.push(b);
    }
    // Footsteps: step_<surface>_<n>, or step_<surface>_<footwear>_<n> for one kind of footwear.
    for (const [k, url] of Object.entries(recordings)) {
      const name = /\/step_([a-z_]+)_\d+\.\w+$/.exec(k)?.[1];
      const b = name ? await load(url) : null;
      if (b) this.stepBuffers.set(name!, [...(this.stepBuffers.get(name!) ?? []), b]);
    }
    // Swap in: a recorded rain bed replaces both noise layers; wind and tyres replace their noise sources.
    const rain = this.buffers.get('rain_loop');
    if (rain) {
      this.bedHissGain.gain.value = 0;
      this.bedBodyGain.gain.value = 0;
      this.bedHissGain.disconnect();
      this.bedBodyGain.disconnect();
      const g = ctx.createGain();
      g.gain.value = 1.4;
      this.loop(rain, 0).connect(g).connect(this.bedGain);
    }
    const roof = this.buffers.get('rain_roof_loop');
    if (roof) this.loop(roof, 0).connect(this.roofGain);
    const wind = this.buffers.get('wind_loop');
    if (wind) {
      this.windBand.disconnect();
      const g = ctx.createGain();
      this.loop(wind, 0).connect(g).connect(this.windGain);
    }
    const tyre = this.buffers.get('tyre_hiss');
    if (tyre) for (const t of this.tyres) this.loop(tyre, Math.random() * tyre.duration).connect(t.gain);
  }

  /** One short grain (a drop, a drip on a roof), panned, through a bus. */
  private grain(bus: AudioNode, level: number, rate: number, pan: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.clicks[Math.floor(Math.random() * this.clicks.length)];
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    s.connect(g).connect(p).connect(bus);
    s.start();
  }

  /** A drip: a short falling sine plink. */
  private drip(level: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const f = 900 + Math.random() * 1400;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g).connect(p).connect(this.master);
    o.start(t);
    o.stop(t + 0.14);
  }

  /**
   * A synthesized step of this kind (real/stepSynth.ts: the strike ringing the shoe and the floor, the weight
   * behind it, the sole's roll, the ground's own texture). `STEP_VARIANTS` of each are kept: the first is rendered
   * when it's first wanted (up to ~10 ms, once a kind) and the rest one at a time while the page is idle; the
   * same one never plays twice running.
   */
  private stepBuffer(surface: Surface, footwear: Footwear, run: boolean, land: boolean): AudioBuffer {
    const ctx = this.ctx!;
    return this.rendered(`${surface}|${footwear}|${run ? 'run' : 'walk'}|${land ? 'land' : ''}`, (seed) => renderStep(surface, footwear, { run, land, seed, sampleRate: ctx.sampleRate }));
  }

  /** A foot in water (real/stepSynth.ts `renderSplash`): wet ground's tsk (depth 0), a shallow puddle, a deep one. */
  private splashBuffer(depth: 0 | 0.45 | 1, run: boolean): AudioBuffer {
    const ctx = this.ctx!;
    return this.rendered(`splash|${depth}|${run ? 'run' : 'walk'}`, (seed) => renderSplash({ depth, run, seed, sampleRate: ctx.sampleRate }));
  }

  private rendered(key: string, make: (seed: number) => Float32Array): AudioBuffer {
    const ctx = this.ctx!;
    let list = this.stepRendered.get(key);
    if (!list) {
      const made: AudioBuffer[] = (list = []);
      this.stepRendered.set(key, made);
      const render = (): void => {
        const data = make(Math.floor(Math.random() * 0xffffffff));
        const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
        b.getChannelData(0).set(data);
        made.push(b);
      };
      render();
      const idle = typeof requestIdleCallback === 'function' ? (f: () => void): unknown => requestIdleCallback(f, { timeout: 2000 }) : (f: () => void): unknown => setTimeout(f, 120);
      const more = (): void => {
        render();
        if (made.length < STEP_VARIANTS) idle(more);
      };
      idle(more);
    }
    let b = list[Math.floor(Math.random() * list.length)];
    if (list.includes(this.stepLast!) && b === this.stepLast && list.length > 1) b = list[(list.indexOf(b) + 1) % list.length];
    if (!key.startsWith('splash')) this.stepLast = b;
    return b;
  }

  /**
   * A footstep on a surface (district/footing.ts) in a kind of footwear, on one foot (panned a little its way),
   * or a landing (`land`: both feet, heavier). The sound is real/stepSynth.ts's, with a little of the space round
   * it (more under a roof, most in a room). Out on wet ground the water joins in: a faint tsk where it's only
   * wet, a splash where the foot lands in a puddle (`puddle`, bigger the deeper), the step under it dulled by the
   * water. Recordings replace the synthesis:
   * step_<surface>_<footwear>_<n>, else step_<surface>_<n> (step_hard_<n> for asphalt, paving and tile).
   */
  step(surface: Surface, o: StepOptions): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const land = o.land ?? 0;
    const bare = o.footwear === 'bare';
    const out = ctx.createGain();
    out.gain.value = o.volume * STEP_LEVEL * (0.5 + 0.5 * (o.weight ?? 1)) * (land > 0 ? 1 + 0.4 * Math.min(1, land / 6) : 1) * (0.85 + Math.random() * 0.3);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (o.foot === 'l' ? -0.14 : o.foot === 'r' ? 0.14 : 0) + (Math.random() - 0.5) * 0.12;
    out.connect(pan).connect(this.master);
    const send = ctx.createGain();
    send.gain.value = STEP_ROOM[o.cover];
    pan.connect(send).connect(this.stepRoom);
    const files = this.stepBuffers.get(`${surface}_${o.footwear}`) ?? this.stepBuffers.get(surface) ?? (HARD.has(surface) ? this.stepBuffers.get('hard') : undefined);
    const s = ctx.createBufferSource();
    s.buffer = files?.length ? files[Math.floor(Math.random() * files.length)] : this.stepBuffer(surface, o.footwear, o.run > 0.5, land > 0);
    // (A recording is the same every time, so it's varied more than a rendered step, which never is.)
    s.playbackRate.value = files?.length ? 0.92 + Math.random() * 0.16 : 0.97 + Math.random() * 0.06;
    const water = o.cover === 'open' && PUDDLED.has(surface);
    const puddle = water ? Math.min(1, o.puddle ?? 0) : 0;
    const dry = ctx.createGain();
    dry.gain.value = 1 - 0.5 * puddle;
    s.connect(dry).connect(out);
    s.start(t);
    if (water && (puddle > 0.15 || o.wet > 0.3)) {
      const w = ctx.createBufferSource();
      w.buffer = this.splashBuffer(puddle > 0.6 ? 1 : puddle > 0.15 ? 0.45 : 0, o.run > 0.5 || land > 0);
      w.playbackRate.value = (bare ? 1.06 : 1) * (0.95 + Math.random() * 0.1);
      const g = ctx.createGain();
      g.gain.value = puddle > 0.15 ? (0.8 + 0.6 * puddle) * (land > 0 ? 1.3 : 1) : 0.7 * Math.min(1, o.wet);
      w.connect(g).connect(out);
      w.start(t);
    }
  }

  /** A bell-like note through the station's speakers (band-limited), at time t. */
  private bell(t: number, f: number, len: number, level: number, out: AudioNode): void {
    const ctx = this.ctx!;
    for (const [mul, type, amp] of [[1, 'triangle', 1], [2, 'sine', 0.35], [3.01, 'sine', 0.12]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level * amp, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.05);
    }
  }

  /** The station's speakers: a band-pass (small speakers), panned to the middle. */
  private speaker(): AudioNode {
    const ctx = this.ctx!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.5;
    bp.connect(this.master);
    return bp;
  }

  /**
   * A car horn `distance` metres away, pan -1 (left) to 1 (right): two detuned reeds a third apart, a short
   * double blast (a bus's lower and longer), quieter and duller with distance.
   */
  horn(distance: number, pan: number, bus = false): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const near = 1 / (1 + distance / 9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + 2600 * near;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    lp.connect(p).connect(this.cover.input);
    const [f1, f2] = bus ? [311, 392] : [415, 523];
    const blasts: [number, number][] = bus ? [[0, 0.7]] : [[0, 0.28], [0.36, 0.42]];
    for (const [at, len] of blasts) {
      for (const f of [f1, f2]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.01);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + at);
        g.gain.linearRampToValueAtTime(0.09 * near, t + at + 0.015);
        g.gain.setValueAtTime(0.09 * near, t + at + len);
        g.gain.linearRampToValueAtTime(0, t + at + len + 0.04);
        o.connect(g).connect(lp);
        o.start(t + at);
        o.stop(t + at + len + 0.06);
      }
    }
  }

  /** A knock (the car you're driving hitting something): a dull thump and a rattle, louder the harder. */
  bump(speed: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const k = Math.min(1, speed / 10);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * k, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
    n.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.value = 0.35 * k;
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t);
  }

  /**
   * Water thrown up by a tyre through a puddle: a whoosh and a slap. strength 0-1 (speed and depth); pan -1..1;
   * how near (1 close, 0 far).
   */
  splash(strength: number, pan = 0, near = 1): void {
    if (!this.ctx || strength <= 0.02 || near <= 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const k = Math.min(1, strength) * near;
    const dur = 0.25 + 0.35 * Math.min(1, strength);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45 * k, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pn = ctx.createStereoPanner();
    pn.pan.value = Math.max(-0.9, Math.min(0.9, pan));
    n.connect(bp).connect(g).connect(pn).connect(this.cover.input);
    n.start(t, Math.random() * 3, dur + 0.05);
  }

  /** A higurashi's call: a clear, high, falling "kana-kana-kana", fading, somewhere off in the trees. */
  private higurashiCall(level: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 4300 + Math.random() * 500;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * 0.82, t + 3.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    const pulses = 18 + Math.floor(Math.random() * 10);
    const rate = 6.5 + Math.random() * 1.5;
    for (let i = 0; i < pulses; i++) {
      const at = t + i / rate;
      const a = level * 0.035 * Math.pow(1 - i / pulses, 1.3);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(a, at + 0.02);
      g.gain.linearRampToValueAtTime(a * 0.3, at + 0.08);
      g.gain.linearRampToValueAtTime(0, at + 0.13);
    }
    const pn = ctx.createStereoPanner();
    pn.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g).connect(pn).connect(this.cover.input);
    o.start(t);
    o.stop(t + pulses / rate + 0.3);
  }

  /** A message on the phone: a soft rising two-note ping, close to the ear. */
  ping(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    // (With headphones on, the phone's sounds are in them: clear, whatever they shut out.)
    const out = this.wornT > 0.5 ? this.music : this.speaker();
    this.bell(t, 1567.98, 0.25, 0.1, out);
    this.bell(t + 0.11, 2093.0, 0.4, 0.1, out);
  }

  /** The door chime as a train arrives: two falling notes. */
  chime(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    const out = this.speaker();
    this.bell(t, 1318.5, 0.6, 0.22, out);
    this.bell(t + 0.32, 1046.5, 0.9, 0.22, out);
  }

  /**
   * A departure melody (発車メロディ): a short phrase of a few seconds, different for every station (seed),
   * on a pentatonic scale so any seed sounds like one.
   */
  melody(seed: number): void {
    if (!this.ctx) return;
    const out = this.speaker();
    let s = seed >>> 0 || 1;
    const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    const root = 523.25 * 2 ** (Math.floor(rnd() * 5) / 12);
    const beat = 0.2 + rnd() * 0.08;
    let t = this.ctx.currentTime + 0.1;
    let step = Math.floor(rnd() * 4);
    const notes = 10 + Math.floor(rnd() * 5);
    for (let i = 0; i < notes; i++) {
      step = Math.max(0, Math.min(scale.length - 1, step + Math.floor(rnd() * 5) - 2));
      const long = i === notes - 1 || rnd() < 0.2;
      this.bell(t, root * 2 ** (scale[step] / 12), long ? 1.1 : 0.45, 0.16, out);
      t += beat * (long ? 2 : 1);
    }
  }

  /** Thunder for a strike `distance` metres away; pan -1 (left) to 1 (right) from where the listener looks. */
  thunder(distance: number, panTo: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + distance / 340;
    const near = Math.max(0, 1 - distance / 2500);
    const level = 0.35 + 0.65 * near;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.8, Math.min(0.8, panTo));
    pan.connect(this.cover.input);
    if (this.thunderBuffers.length) {
      const s = ctx.createBufferSource();
      s.buffer = this.thunderBuffers[Math.floor(Math.random() * this.thunderBuffers.length)];
      const g = ctx.createGain();
      g.gain.value = level;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600 + 6000 * near;
      s.connect(lp).connect(g).connect(pan);
      s.start(t0);
      return;
    }
    // A close strike opens with a crack (bright noise, very short).
    if (near > 0.4) {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(level * 0.9, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      s.connect(hp).connect(g).connect(pan);
      s.start(t0, Math.random() * 3);
      s.stop(t0 + 0.4);
    }
    // The roll: several overlapping low bursts over a few seconds (longer and duller when far).
    const dur = 3 + 5 * (1 - near) + Math.random() * 2;
    const bursts = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < bursts; i++) {
      const tb = t0 + (i === 0 ? 0.05 : Math.random() * dur * 0.6);
      const len = 0.8 + Math.random() * dur * 0.5;
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 90 + 180 * near + Math.random() * 60;
      lp.Q.value = 0.8;
      const g = ctx.createGain();
      const peak = level * (i === 0 ? 1.6 : 0.6 + Math.random() * 0.8);
      g.gain.setValueAtTime(0, tb);
      g.gain.linearRampToValueAtTime(peak, tb + 0.08 + Math.random() * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, tb + len);
      s.connect(lp).connect(g).connect(pan);
      s.start(tb, Math.random() * 3);
      s.stop(tb + len + 0.05);
    }
  }

  update(f: AudioFrame): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.25): void => void p.setTargetAtTime(v, t, tc);
    set(this.master.gain, f.volume * 0.9, 0.1);
    set(this.music.gain, f.volume, 0.1);
    // Where the listener is, eased: a change of place is one crossfade, and everything that depends on it (the
    // muffling, the close drops, the drumming overhead, the drips) moves with it.
    const ramp = (v: number, to: number, secs: number): number => v + THREE_clamp(to - v, -f.dt / secs, f.dt / secs);
    const ease = (x: number): number => x * x * (3 - 2 * x);
    const enclosed = f.cover === 'enclosed' || f.train;
    this.indoorT = ramp(this.indoorT, enclosed ? 1 : 0, COVER_FADE);
    this.roofT = ramp(this.roofT, enclosed || f.cover === 'roof' ? 1 : 0, COVER_FADE);
    this.cabinT = ramp(this.cabinT, THREE_clamp(f.cabin ?? 0, 0, 1), CABIN_FADE);
    // Inside walls; under a roof with its sides open; out in the open. (They sum to one: what all three ways
    // share, the low end, holds steady through a fade.)
    const indoor = ease(this.indoorT);
    const roof = ease(this.roofT) * (1 - indoor);
    const open = 1 - indoor - roof;
    set(this.cover.gains[0].gain, open, 0.03);
    set(this.cover.gains[1].gain, roof, 0.03);
    set(this.cover.gains[2].gain, indoor * INDOOR_LEVEL, 0.03);
    // In a car's cabin the world outside comes through the glass: its top taken off, and quieter.
    // (Its damping: up to a half, how much of the outside is heard through the glass rather than clear; and all
    // the way, how quiet it is through it: 0.6 at a half, 0.2 at full.)
    const damp = THREE_clamp(f.cabinDamp ?? 0.5, 0, 1);
    const cabin = ease(this.cabinT) * Math.min(1, damp * 2);
    set(this.world.gains[0].gain, 1 - cabin, 0.03);
    set(this.world.gains[1].gain, cabin * (1 - 0.8 * damp), 0.03);
    // Headphones: one more crossfade, over everything.
    this.wornT = ramp(this.wornT, f.ears && f.ears !== 'none' ? 1 : 0, EARS_FADE);
    this.ncT = ramp(this.ncT, f.ears === 'nc' ? 1 : 0, EARS_FADE);
    const worn = ease(this.wornT);
    const nc = worn * ease(this.ncT);
    set(this.ears.gains[0].gain, 1 - worn, 0.03);
    set(this.ears.gains[1].gain, (worn - nc) * WORN_LEVEL, 0.03);
    set(this.ears.gains[2].gain, nc * NC_LEVEL, 0.03);
    const r = f.rain;
    const bedLevel = r <= 0 ? 0 : 0.12 + 0.55 * r;
    set(this.bedGain.gain, bedLevel);
    set(this.bedHissGain.gain, 0.5 + 0.5 * r);
    set(this.bedBodyGain.gain, 0.25 + 0.9 * r * r);
    set(this.bedHiss.frequency, 3200 - 1400 * r);
    this.levels.bed = bedLevel;
    // Patter: drops close by, more of them in heavy rain; none indoors, fewer under a roof.
    const patterRate = r <= 0 ? 0 : (20 + 160 * r) * (open + 0.25 * roof) * (1 - cabin);
    this.patterDebt += patterRate * f.dt;
    this.levels.patter = patterRate;
    while (this.patterDebt >= 1) {
      this.patterDebt -= 1;
      this.grain(this.patterBus, 0.05 + Math.random() * 0.12 * (0.5 + r), 0.6 + Math.random() * 1.2, Math.random() * 1.8 - 0.9);
    }
    // Roof drumming and drips under cover (a car's roof too).
    const drum = Math.max(roof, ease(this.cabinT) * (1 - indoor) * (f.cabinRoof ?? 1));
    const drumRate = r > 0 ? (30 + 90 * r) * drum : 0;
    set(this.roofGain.gain, r > 0 ? (0.6 + 0.6 * r) * drum : 0, 0.2);
    this.levels.roof = drumRate;
    this.roofDebt += drumRate * f.dt;
    while (this.roofDebt >= 1) {
      this.roofDebt -= 1;
      this.grain(this.roofGain, 0.15 + Math.random() * 0.25, 0.3 + Math.random() * 0.35, Math.random() * 1.4 - 0.7);
    }
    // (Drips off the roof's edge; indoors a few, faint, not aboard a train.)
    this.dripDebt += r > 0 ? (1.4 * roof + (f.train ? 0 : 0.3 * indoor)) * f.dt : 0;
    while (this.dripDebt >= 1) {
      this.dripDebt -= 1;
      this.drip(roof > indoor ? 0.08 : 0.03);
    }
    // Wind: level and pitch with the gusts; the howl only in a gale. Low and soft, with no floor, so a
    // breeze is barely heard (not a constant hiss), and slow to follow the gusts, so it swells and ebbs
    // instead of fluttering with their quick wobble.
    const w = f.wind * f.gust;
    const windLevel = w <= 0.01 ? 0 : 0.32 * w * w;
    set(this.windGain.gain, windLevel, 1.2);
    set(this.windBand.frequency, 160 + 420 * w, 1.5);
    set(this.howlGain.gain, Math.max(0, w - 0.6) * 0.22, 1.2);
    set(this.howlBand.frequency, 340 + 420 * w + 40 * Math.sin(t * 0.4), 1);
    this.levels.wind = windLevel;
    // Cicadas: the chorus swells and ebbs; quiet in the rain (and, like the wind, shut out by the cover indoors).
    // (Kept low, a background to the day: it comes in waves with lulls between, never a constant whine.)
    const cic = (f.cicadas ?? 0) * (1 - 0.4 * roof) * (1 - Math.min(1, r * 2));
    const wave = Math.max(0, Math.sin(t * 0.13) * 0.6 + Math.sin(t * 0.047 + 1.1) * 0.5 + 0.15);
    set(this.cicadaGain.gain, cic * 0.012 * Math.min(1, wave), 2.5);
    const hig = (f.higurashi ?? 0) * (1 - 0.75 * indoor) * (1 - Math.min(1, r * 2));
    this.higurashiDebt += hig * f.dt * 0.12;
    if (this.higurashiDebt >= 1) {
      this.higurashiDebt = -Math.random() * 0.6;
      this.higurashiCall(hig);
    }
    // Train rumble.
    set(this.trainGain.gain, f.train ? 0.5 + 0.15 * Math.sin(t * 9.5) : 0, 0.2);
    // Tyres on wet roads: louder close, panned by where the car is relative to the view.
    let tyreSum = 0;
    this.tyres.forEach((v, i) => {
      const c = f.cars[i];
      if (!c) {
        set(v.gain.gain, 0);
        set(v.engine.gain, 0);
        return;
      }
      const dx = c.x - f.x;
      const dz = c.z - f.z;
      const d = Math.hypot(dx, dz);
      const near = Math.min(1, 6 / Math.max(d, 1)) * (d < 70 ? 1 : 0);
      // Tyre noise grows with speed, and a lot on a wet road.
      const level = (0.03 + 0.4 * f.wet) * near * Math.min(1, c.speed / 8);
      // Engine: revs from speed (a gear change every ~4 m/s) plus throttle; idle when standing.
      const gearSpeed = c.speed % 4.5;
      const revs = (c.bus ? 22 : 30) + gearSpeed * (c.bus ? 5 : 8) + Math.min(c.speed, 14) * 1.5;
      const throttle = THREE_clamp(0.25 + c.acc * 0.45, 0.12, 1);
      // Doppler: closing speed along the line to the listener.
      const closing = d > 0.1 ? -(c.vx * dx + c.vz * dz) / d : 0;
      const doppler = 343 / (343 - THREE_clamp(closing, -30, 30));
      set(v.osc[0].frequency, revs * doppler, 0.08);
      set(v.osc[1].frequency, revs * 0.5 * doppler * 1.01, 0.08);
      set(v.lp.frequency, 180 + 900 * throttle + c.speed * 20, 0.1);
      set(v.engine.gain, (c.bus ? 0.16 : 0.1) * near * (0.35 + 0.65 * throttle), 0.1);
      tyreSum += level;
      set(v.gain.gain, level, 0.1);
      // Pan: how far right of the view the car is (yaw 0 looks toward -z; the right is then +x).
      const right = (dx * Math.cos(f.yaw) - dz * Math.sin(f.yaw)) / Math.max(d, 0.1);
      set(v.pan.pan, Math.max(-0.9, Math.min(0.9, right)), 0.1);
      set(v.band.frequency, 1800 + 1600 * f.wet, 0.3);
    });
    this.levels.tyres = tyreSum;
  }
}

function THREE_clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}
