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
  private dip = 0;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);
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
  }

  /** Per frame: rev (0-1 in the gear), gear, throttle (0-1), speed (m/s), slide (rad), wheelspin (0-1). */
  update(dt: number, s: { rev: number; gear: number; throttle: number; speed: number; slide: number; spin: number; bump: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (s.gear !== this.lastGear && s.gear > this.lastGear) this.dip = 0.18;
    this.lastGear = s.gear;
    this.dip = Math.max(0, this.dip - dt);
    const rpm = 900 + s.rev * 6400 - this.dip * 9000;
    const f = Math.max(28, rpm / 30);
    for (const o of this.engine) o.frequency.setTargetAtTime(f, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(500 + s.throttle * 2200 + s.rev * 900, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.07 + s.throttle * 0.1, t, 0.05);
    const slip = Math.min(1, Math.max(0, (Math.abs(s.slide) - 0.08) * 3) * Math.min(1, s.speed / 6) + s.spin * 0.8);
    this.squealGain.gain.setTargetAtTime(slip * 0.16, t, 0.04);
    this.squealFilter.frequency.setTargetAtTime(1100 + slip * 900, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.25, (s.speed / 60) ** 2 * 0.3), t, 0.2);
    if (s.bump > 2) this.thump(Math.min(1, s.bump / 10));
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
