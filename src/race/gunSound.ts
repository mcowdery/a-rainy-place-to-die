import type * as THREE from 'three';
import type { ShotEvent } from './shooting';

/**
 * The shooting's sounds, synthesised (WebAudio; starts on the first key or click): the pistol's crack and
 * thump with a slap-back off the mountainside, the paintball marker's pneumatic thup, a dry click, the
 * reload, and the hits: a steel plate's ring, paper's snap, paint's splat, a round into the ground. Hits
 * fade with distance from the listener.
 */
export class GunSound {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private echo!: DelayNode;
  private noiseBuf!: AudioBuffer;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(ctx.destination);
    // The slap-back: a delayed, darker copy (the pistol feeds it).
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.23;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    this.echo.connect(lp).connect(fb).connect(this.echo);
    lp.connect(this.out);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  play(events: readonly ShotEvent[], listener: THREE.Vector3): void {
    if (!this.ctx) return;
    for (const e of events) {
      const d = e.at.distanceTo(listener);
      const k = 1 / (1 + d / 12);
      switch (e.kind) {
        case 'pistol':
          this.noise(0.18, 'lowpass', 3200, 0.9, 0.002, true);
          this.noise(0.012, 'highpass', 4000, 0.6, 0.0005);
          this.tone(120, 38, 0.18, 0.7, 'sine');
          break;
        case 'paint':
          this.noise(0.05, 'bandpass', 700, 0.45, 0.002);
          this.noise(0.09, 'highpass', 3000, 0.08, 0.01);
          break;
        case 'dry':
          this.noise(0.015, 'highpass', 2500, 0.3, 0.0005);
          break;
        case 'reload':
          for (const t of [0, 0.35, 0.8]) this.noise(0.02, 'bandpass', 1800, 0.25, 0.001, false, t);
          break;
        case 'ding':
          for (const [f, g] of [[880, 0.3], [2350, 0.14], [4120, 0.07]] as const) this.tone(f, f, 1.1, g * k, 'sine', 0.001);
          break;
        case 'paper':
          this.noise(0.03, 'bandpass', 1500, 0.35 * k, 0.001);
          break;
        case 'splat':
          this.noise(0.08, 'lowpass', 900, 0.5 * k, 0.003);
          break;
        case 'ground':
          this.noise(0.06, 'lowpass', 600, 0.3 * k, 0.002);
          break;
      }
    }
  }

  private noise(len: number, type: BiquadFilterType, freq: number, gain: number, attack: number, echo = false, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + len);
    s.connect(f).connect(g).connect(this.out);
    if (echo) g.connect(this.echo);
    s.start(t, Math.random() * 0.5);
    s.stop(t + attack + len + 0.05);
  }

  private tone(f0: number, f1: number, len: number, gain: number, type: OscillatorType, attack = 0.002): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + len);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + attack + len + 0.05);
  }
}
