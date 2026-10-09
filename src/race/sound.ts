/**
 * The car's sound, synthesised (WebAudio; starts on the first key or click): the engine (a four-cylinder's
 * firing note from the revs, two detuned saws through a filter that opens with the throttle, a dip on each
 * gear change), the tyres (band-passed noise, a squeal with the slide and a hiss with wheelspin), wind with
 * speed, and a thump for a knock.
 */
export class CarSound {
  private ctx: AudioContext | null = null;
  private engine: OscillatorNode[] = [];
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private squealGain!: GainNode;
  private squealFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private master!: GainNode;
  private lastGear = 1;
  /** The engine: redline, firing pulses per revolution, how buzzy (the square wave's share). */
  private profile = { maxRpm: 7300, fire: 2, buzz: 0.3 };
  private buzzGain: GainNode | null = null;
  private whistle: OscillatorNode | null = null;
  private whistleGain: GainNode | null = null;
  private lastBoost = 0;
  private lp!: BiquadFilterNode;
  /** Slow motion (0-1): the engine drops in pitch and everything goes muffled. */
  slow = 0;
  private dip = 0;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7 * this.volume * this.duck;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.master.connect(this.lp).connect(ctx.destination);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    for (const detune of [0, 7, -12]) {
      const o = ctx.createOscillator();
      o.type = detune === -12 ? 'square' : 'sawtooth';
      o.detune.value = detune * 10;
      const g = ctx.createGain();
      g.gain.value = detune === -12 ? 0.25 : 0.5;
      if (detune === -12) this.buzzGain = g;
      o.connect(g).connect(this.engineFilter);
      o.start();
      this.engine.push(o);
    }
    const noise = (): AudioBufferSourceNode => {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.Q.value = 9;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    noise().connect(this.squealFilter).connect(this.squealGain).connect(this.master);
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise().connect(wf).connect(this.windGain).connect(this.master);
    // A turbo's whistle, rising with the boost.
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle.connect(this.whistleGain).connect(this.master);
    this.whistle.start();
    this.configure(this.profile);
  }

  /** Overall volume (0 silences it: the engine off). */
  setVolume(v: number): void {
    if (this.ctx) this.master.gain.setTargetAtTime(0.7 * v * this.duck, this.ctx.currentTime, 0.15);
    this.volume = v;
  }

  /** How much of it the listener's ears let through (1 bare; less under headphones in the city). */
  setDuck(d: number): void {
    if (d === this.duck) return;
    this.duck = d;
    this.setVolume(this.volume);
  }

  private volume = 1;
  private duck = 1;

  /** The car's engine: its redline, firing pulses per revolution (four-cylinder 2, six 3, triple 1.5), buzz. */
  configure(p: { maxRpm: number; fire: number; buzz: number }): void {
    this.profile = { ...p };
    if (this.buzzGain) this.buzzGain.gain.value = 0.1 + p.buzz * 0.55;
  }

  /** Per frame: rev (0-1 in the gear), gear, throttle (0-1), speed (m/s), slide (rad), wheelspin (0-1). */
  update(dt: number, s: { rev: number; gear: number; throttle: number; speed: number; slide: number; spin: number; bump: number; boost?: number; turbo?: boolean }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (s.gear !== this.lastGear && s.gear > this.lastGear) this.dip = 0.18;
    this.lastGear = s.gear;
    this.dip = Math.max(0, this.dip - dt);
    const P = this.profile;
    const rpm = 900 + s.rev * (P.maxRpm - 900) - this.dip * 9000;
    const f = Math.max(28, (rpm / 60) * P.fire) * (1 - this.slow * 0.35);
    // Turbo: the whistle with the boost, and a blow-off puff when you lift off boost.
    const boost = s.turbo ? (s.boost ?? 0) : 0;
    this.whistle?.frequency.setTargetAtTime(2600 + boost * 3800, t, 0.05);
    this.whistleGain?.gain.setTargetAtTime(boost * s.throttle * 0.018, t, 0.05);
    if (s.turbo && this.lastBoost > 0.6 && s.throttle === 0) this.blowOff();
    this.lastBoost = s.throttle === 0 ? 0 : boost;
    this.lp.frequency.setTargetAtTime(20000 * Math.pow(0.045, this.slow), t, 0.05);
    for (const o of this.engine) o.frequency.setTargetAtTime(f, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(500 + s.throttle * 2200 + s.rev * 900, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.07 + s.throttle * 0.1, t, 0.05);
    const slip = Math.min(1, Math.max(0, (Math.abs(s.slide) - 0.08) * 3) * Math.min(1, s.speed / 6) + s.spin * 0.8);
    this.squealGain.gain.setTargetAtTime(slip * 0.16, t, 0.04);
    this.squealFilter.frequency.setTargetAtTime(1100 + slip * 900, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.25, (s.speed / 60) ** 2 * 0.3), t, 0.2);
    if (s.bump > 2) this.thump(Math.min(1, s.bump / 10));
  }

  private blowOff(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  private thump(k: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6 * k, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }
}
