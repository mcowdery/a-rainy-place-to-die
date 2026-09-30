/**
 * The city's sound, in WebAudio: rain, wind, thunder and wet tyres. Everything is synthesized from noise
 * so it works with no files, but a recording dropped into assets/audio/ replaces its synthesized part
 * (see assets/audio/README.md): rain_loop, rain_roof_loop, wind_loop, tyre_hiss (loops), thunder_1..n and
 * step_<hard|grass|gravel>_1..n (footsteps; a splash joins in on wet ground).
 *
 * - Rain: a bed of filtered noise (a distant hiss and a nearer body) whose level and brightness follow
 *   the rain, plus close patter (short random clicks, panned). Under a roof the bed is low-passed and a
 *   hollow drumming and drips join in; fully indoors (a shop, a basement) it's heavily muffled.
 * - Wind: band-passed noise following the gusts; a resonant howl on top in a gale.
 * - Thunder: a crack for close strikes, a long low roll for far ones, delayed by distance (340 m/s).
 * - Tyres and engines: for the nearest cars, a tyre hiss (loud on wet roads) and an engine whose pitch
 *   follows speed, gears and throttle, idling at the lights, with Doppler as they pass.
 * The context starts on the first click (browsers need a gesture).
 */

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
  /** Summer: the cicadas' daytime chorus (0-1, louder in a heat wave and among trees), and the higurashi at dusk. */
  readonly cicadas?: number;
  readonly higurashi?: number;
}

const TYRE_VOICES = 3;

export class CityAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private clicks: AudioBuffer[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private thunderBuffers: AudioBuffer[] = [];
  private stepBuffers = new Map<string, AudioBuffer[]>();
  // Rain bed.
  private bedGain!: GainNode;
  private bedHiss!: BiquadFilterNode;
  private bedBody!: BiquadFilterNode;
  private bedHissGain!: GainNode;
  private bedBodyGain!: GainNode;
  private cover!: BiquadFilterNode;
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
    this.master.connect(comp).connect(ctx.destination);
    // A few seconds of white noise, and short click grains of different lengths.
    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = this.noise.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    for (const ms of [6, 10, 16, 26]) {
      const n = Math.round((ctx.sampleRate * ms) / 1000);
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-i / n) * 5);
      this.clicks.push(b);
    }
    // Everything rainy goes through the cover filter (open: bright; roof: dull; enclosed: very dull).
    this.cover = ctx.createBiquadFilter();
    this.cover.type = 'lowpass';
    this.cover.frequency.value = 18000;
    this.cover.connect(this.master);
    // Rain bed: two filtered noise layers.
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    this.bedGain.connect(this.cover);
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
    this.patterBus.connect(this.cover);
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
    this.windBand.frequency.value = 400;
    this.windBand.Q.value = 0.7;
    this.loop(this.noise, 2.1).connect(this.windBand).connect(this.windGain).connect(this.master);
    this.howlGain = ctx.createGain();
    this.howlGain.gain.value = 0;
    this.howlBand = ctx.createBiquadFilter();
    this.howlBand.type = 'bandpass';
    this.howlBand.frequency.value = 600;
    this.howlBand.Q.value = 9;
    this.loop(this.noise, 3.3).connect(this.howlBand).connect(this.howlGain).connect(this.master);
    // Train: a low rumble with the rail joints' rhythm.
    // Cicadas. The aburazemi: a bright sizzle, noise through a narrow band near 4.5 kHz, buzzed at ~50 Hz.
    this.cicadaGain = ctx.createGain();
    this.cicadaGain.gain.value = 0;
    this.cicadaGain.connect(this.master);
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
      this.loop(this.noise, 0.4 + i).connect(band).connect(gain).connect(pan).connect(this.cover);
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
    for (const surface of ['hard', 'grass', 'gravel']) {
      const list: AudioBuffer[] = [];
      for (const [k, url] of Object.entries(recordings)) {
        if (!new RegExp(`/step_${surface}_\\d+\\.\\w+$`).test(k)) continue;
        const b = await load(url);
        if (b) list.push(b);
      }
      if (list.length) this.stepBuffers.set(surface, list);
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
   * A footstep (or a landing, land > 0: the fall speed in m/s). Hard ground is a heel-toe scuff with a
   * soft thump; grass a dull brush; gravel a crunch of small grains; on wet ground a splash joins in.
   * Indoors (enclosed) it's closer and duller. Recordings step_<surface>_1..n replace the synthesis.
   */
  step(surface: 'hard' | 'grass' | 'gravel', o: { run: boolean; wet: number; cover: 'open' | 'roof' | 'enclosed'; volume: number; land?: number }): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const land = o.land ?? 0;
    const level = o.volume * (o.run ? 0.42 : 0.3) * (land > 0 ? 1.4 + Math.min(1, land / 6) : 1) * (0.85 + Math.random() * 0.3);
    const out = ctx.createGain();
    out.gain.value = level;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.25;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = o.cover === 'enclosed' ? 3200 : 9000;
    out.connect(tone).connect(pan).connect(this.master);
    const files = this.stepBuffers.get(surface);
    if (files?.length) {
      const s = ctx.createBufferSource();
      s.buffer = files[Math.floor(Math.random() * files.length)];
      s.playbackRate.value = 0.92 + Math.random() * 0.16;
      s.connect(out);
      s.start(t);
    } else {
      // Noise through a band, with an envelope: a grain of the step.
      const burst = (at: number, f: number, q: number, peak: number, len: number, type: BiquadFilterType = 'bandpass'): void => {
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = f;
        b.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(peak, at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        s.connect(b).connect(g).connect(out);
        s.start(at, Math.random() * 3);
        s.stop(at + len + 0.02);
      };
      // The body of the step: a short low thump.
      const o1 = ctx.createOscillator();
      o1.frequency.setValueAtTime(land > 0 ? 70 : 95, t);
      o1.frequency.exponentialRampToValueAtTime(40, t + 0.08);
      const g1 = ctx.createGain();
      g1.gain.setValueAtTime(0, t);
      g1.gain.linearRampToValueAtTime(surface === 'hard' ? 0.5 : 0.35, t + 0.005);
      g1.gain.exponentialRampToValueAtTime(0.0001, t + (land > 0 ? 0.16 : 0.09));
      o1.connect(g1).connect(out);
      o1.start(t);
      o1.stop(t + 0.2);
      if (surface === 'hard') {
        // Heel, then toe.
        burst(t, 2400 + Math.random() * 900, 1.2, 0.9, 0.045);
        burst(t + (o.run ? 0.03 : 0.05), 3200 + Math.random() * 900, 1.4, 0.5, 0.035);
      } else if (surface === 'grass') {
        burst(t, 700 + Math.random() * 300, 0.6, 0.6, 0.12, 'lowpass');
        burst(t + 0.03, 1800, 0.8, 0.25, 0.08);
      } else {
        for (let i = 0; i < 7; i++) burst(t + Math.random() * 0.08, 3000 + Math.random() * 3000, 3, 0.35 + Math.random() * 0.3, 0.012 + Math.random() * 0.012);
        burst(t, 900, 0.7, 0.3, 0.09);
      }
    }
    if (o.wet > 0.3 && o.cover === 'open' && surface !== 'grass') {
      // A splash: bright noise with a little tail.
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + 0.01);
      g.gain.linearRampToValueAtTime(0.5 * Math.min(1, o.wet), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      s.connect(hp).connect(g).connect(out);
      s.start(t + 0.01, Math.random() * 3);
      s.stop(t + 0.2);
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
    lp.connect(p).connect(this.master);
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
    n.connect(bp).connect(g).connect(pn).connect(this.cover);
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
    o.connect(g).connect(pn).connect(this.master);
    o.start(t);
    o.stop(t + pulses / rate + 0.3);
  }

  /** A message on the phone: a soft rising two-note ping, close to the ear. */
  ping(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    const out = this.speaker();
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
    pan.connect(this.cover);
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
    const r = f.rain;
    const enclosed = f.cover === 'enclosed' || f.train;
    const roof = f.cover === 'roof';
    // Cover: out in the open everything is bright; under a roof dull; inside walls very dull.
    set(this.cover.frequency, enclosed ? 420 : roof ? 2600 : 16000, 0.15);
    const bedLevel = r <= 0 ? 0 : (0.12 + 0.55 * r) * (enclosed ? 0.35 : 1);
    set(this.bedGain.gain, bedLevel);
    set(this.bedHissGain.gain, 0.5 + 0.5 * r);
    set(this.bedBodyGain.gain, 0.25 + 0.9 * r * r);
    set(this.bedHiss.frequency, 3200 - 1400 * r);
    this.levels.bed = bedLevel;
    // Patter: drops close by, more of them in heavy rain; none indoors, fewer under a roof.
    const patterRate = r <= 0 || enclosed ? 0 : (20 + 160 * r) * (roof ? 0.25 : 1);
    this.patterDebt += patterRate * f.dt;
    this.levels.patter = patterRate;
    while (this.patterDebt >= 1) {
      this.patterDebt -= 1;
      this.grain(this.patterBus, 0.05 + Math.random() * 0.12 * (0.5 + r), 0.6 + Math.random() * 1.2, Math.random() * 1.8 - 0.9);
    }
    // Roof drumming and drips under cover.
    const drumRate = roof && r > 0 ? 30 + 90 * r : 0;
    set(this.roofGain.gain, roof && r > 0 ? 0.6 + 0.6 * r : 0, 0.2);
    this.levels.roof = drumRate;
    this.roofDebt += drumRate * f.dt;
    while (this.roofDebt >= 1) {
      this.roofDebt -= 1;
      this.grain(this.roofGain, 0.15 + Math.random() * 0.25, 0.3 + Math.random() * 0.35, Math.random() * 1.4 - 0.7);
    }
    this.dripDebt += (roof || (enclosed && f.cover === 'enclosed')) && r > 0 ? (roof ? 1.4 : 0.3) * f.dt : 0;
    while (this.dripDebt >= 1) {
      this.dripDebt -= 1;
      this.drip(roof ? 0.08 : 0.03);
    }
    // Wind: level and pitch with the gusts; the howl only in a gale.
    const w = f.wind * f.gust;
    const windLevel = w <= 0.01 ? 0 : (0.05 + 0.5 * w * w) * (enclosed ? 0.25 : 1);
    set(this.windGain.gain, windLevel, 0.4);
    set(this.windBand.frequency, 250 + 700 * w, 0.4);
    set(this.howlGain.gain, Math.max(0, w - 0.45) * 0.35 * (enclosed ? 0.3 : 1), 0.5);
    set(this.howlBand.frequency, 380 + 520 * w + 60 * Math.sin(t * 0.7), 0.3);
    this.levels.wind = windLevel;
    // Cicadas: the chorus swells and ebbs; muffled indoors, quiet in the rain.
    // (Kept low, a background to the day: it comes in waves with lulls between, never a constant whine.)
    const cic = (f.cicadas ?? 0) * (enclosed ? 0.15 : roof ? 0.6 : 1) * (1 - Math.min(1, r * 2));
    const wave = Math.max(0, Math.sin(t * 0.13) * 0.6 + Math.sin(t * 0.047 + 1.1) * 0.5 + 0.15);
    set(this.cicadaGain.gain, cic * 0.012 * Math.min(1, wave), 2.5);
    const hig = (f.higurashi ?? 0) * (enclosed ? 0.25 : 1) * (1 - Math.min(1, r * 2));
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
      set(v.engine.gain, (c.bus ? 0.16 : 0.1) * near * (0.35 + 0.65 * throttle) * (f.cover === 'enclosed' ? 0.3 : 1), 0.1);
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
