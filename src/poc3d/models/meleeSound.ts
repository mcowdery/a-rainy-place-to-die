/**
 * The fights' sounds, synthesised (WebAudio, started on a click): a swing's whoosh (a blade's thinner and
 * higher), a punch landing (a low thump and a slap), a kick (heavier), a blade cutting (a hiss with a wet tail
 * when there's blood), a blocked blow, the sword drawn (steel on the saya's mouth, a ring) and sheathed.
 */
export class MeleeSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.7;

  /** Starts the audio (call from a click or key). */
  resume(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.out = this.ctx.createGain();
      this.out.gain.value = this.volume;
      this.out.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private burst(dur: number, filter: BiquadFilterType, f0: number, f1: number, q: number, gain: number, attack = 0.005, delay = 0): void {
    const c = this.ctx;
    if (!c || !this.out || !this.noise) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dur: number, f0: number, f1: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    const c = this.ctx;
    if (!c || !this.out) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A swing through the air. */
  whoosh(blade: boolean, strength = 1): void {
    if (blade) this.burst(0.28, 'bandpass', 900, 3200, 2.2, 0.35 * strength, 0.08);
    else this.burst(0.18, 'bandpass', 500, 1300, 1.4, 0.18 * strength, 0.04);
  }

  /** A fist or foot landing; `heavy` 0..1. */
  thud(heavy: number): void {
    this.tone(0.16 + 0.1 * heavy, 110 + 30 * Math.random(), 45, 0.7 + 0.3 * heavy);
    this.burst(0.07, 'lowpass', 2400, 600, 0.7, 0.5 + 0.3 * heavy);
  }

  /** A blade cutting; `wet` with blood. */
  cut(wet: boolean): void {
    this.burst(0.2, 'highpass', 2500, 5000, 0.8, 0.45);
    this.tone(0.1, 180, 70, 0.4);
    if (wet) {
      this.burst(0.35, 'lowpass', 900, 200, 4, 0.5, 0.01, 0.03);
      this.burst(0.25, 'bandpass', 400, 160, 6, 0.3, 0.01, 0.12);
    }
  }

  /** A blow met by a guard. */
  block(blade: boolean): void {
    if (blade) {
      this.tone(0.6, 2300, 2200, 0.25, 'triangle');
      this.tone(0.5, 3400, 3300, 0.12, 'sine');
    }
    this.tone(0.12, 160, 70, 0.55);
    this.burst(0.06, 'bandpass', 1200, 500, 1, 0.35);
  }

  /** The sword out of the saya (or back in). */
  draw(out: boolean): void {
    this.burst(0.32, 'bandpass', out ? 2200 : 3800, out ? 4200 : 1800, 6, 0.22, 0.05);
    if (out) this.tone(0.9, 3100, 3050, 0.08, 'sine', 0.28);
    else this.tone(0.08, 300, 120, 0.4, 'sine', 0.3);
  }

  /** An enemy winding up to hit you: a sharp breath and a rustle, from where he is (`pan` -1 left to 1 right,
   * `gain` by distance), so one behind you is heard coming. */
  tell(pan: number, gain: number): void {
    const c = this.ctx;
    if (!c || !this.out || !this.noise) return;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.out);
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(380, t);
    f.frequency.exponentialRampToValueAtTime(1100, t + 0.22);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * gain, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    src.connect(f).connect(g).connect(p);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.3);
  }

  /** A neck breaking. */
  crack(): void {
    this.burst(0.05, 'highpass', 1800, 2600, 0.7, 0.9);
    this.burst(0.07, 'bandpass', 900, 500, 3, 0.6, 0.002, 0.035);
    this.tone(0.08, 220, 90, 0.3, 'square', 0.01);
  }

  /** A skull against something hard, or under a heel. */
  crunch(): void {
    this.tone(0.22, 95, 38, 1);
    this.burst(0.12, 'lowpass', 3000, 400, 0.8, 0.8);
    this.burst(0.18, 'bandpass', 1400, 600, 2.5, 0.5, 0.003, 0.02);
    this.burst(0.3, 'lowpass', 700, 150, 3, 0.4, 0.01, 0.06);
  }

  /** A shotgun going off close. */
  blast(): void {
    this.tone(0.35, 70, 30, 1);
    this.burst(0.5, 'lowpass', 6000, 300, 0.5, 1);
    this.burst(0.9, 'lowpass', 900, 120, 0.7, 0.35, 0.02, 0.08);
  }

  /** A blow turned aside at the last moment: a bright ring of steel (or a sharp slap of forearms). */
  deflect(blade: boolean): void {
    if (blade) {
      this.tone(0.9, 3100, 3050, 0.35, 'triangle');
      this.tone(0.7, 4700, 4650, 0.18, 'sine');
      this.tone(0.5, 1900, 1880, 0.15, 'sine');
    }
    this.burst(0.05, 'highpass', 3000, 6000, 0.7, 0.8);
    this.tone(0.08, 240, 120, 0.4);
  }

  /** A guard broken: a heavy clash and a grunt of air. */
  guardBreak(): void {
    this.tone(0.35, 120, 50, 1);
    this.burst(0.3, 'lowpass', 2500, 300, 0.8, 0.8);
    this.tone(1.0, 1500, 1400, 0.12, 'triangle', 0.02);
  }

  /** You're hit. */
  hurt(): void {
    this.tone(0.2, 90, 40, 0.9);
    this.burst(0.1, 'lowpass', 1500, 300, 0.7, 0.5);
  }
}
