import type * as THREE from 'three';
import { DEFAULT_GUN_VOICE, type GunVoice } from './gunVoices';
import type { ShotEvent } from './shooting';

/**
 * The shooting's sounds (WebAudio; starts on the first key or click): the pistol's report, the paintball marker's
 * pneumatic thup, a dry click, the reload, and the hits: a steel plate's ring, paper's snap, paint's splat, a round
 * into the ground. Hits fade with distance from the listener.
 *
 * **The pistol's report is a recording** (the user's word, 2026-10-05: the synthesised one "doesn't sound like a
 * pistol at all"): real shots in assets/audio/guns (its CREDITS.md; CC0; the shotgun's too, `shotgunVoice`, and the
 * handling: the magazine out and in, the slide, a dry click, the lever), a few of each `voice` from a close
 * microphone and from mid distance. A shot plays one of them, never the same twice running, a few percent
 * faster or slower; a shooter further off is heard more and more from the mid-distance set (the range's own
 * echoes are in it), quieter and duller. The close ones are dry, as a shot in the open is, so a little of each
 * goes into the space below (`echo`: streets have walls). `voice` 'synth' is the old synthesised report, and
 * what plays until the recordings have loaded.
 *
 * The synthesised report is in layers, as a recording of one is: the muzzle's crack (a millisecond of everything at
 * once), the blast's body (a band round 1-2 kHz gone in under a tenth of a second), its weight (a low thump
 * falling in pitch) and a duller tail, then the action (the slide back and home, the spent case on the road). The
 * shot's layers go through a soft clip together, which is most of what makes it sound loud rather than merely
 * hissy, and into the space round it: a slap-back and a short reverb of early echoes off walls and a second or so
 * of tail. Each shot is a few percent different from the last. Far shots lose their top and their weight and
 * keep the echo. `start(into)` plays into any context: an offline one, to measure it and write it out
 * (`node scripts/gunSounds.mjs`: tune by measurement, then by ear).
 */

/** The reverb's tail (s to -60 dB) and how much of a shot goes into it. */
const TAIL = 1.3;
const WET = 0.34;
/** A recorded shot: how much of it goes into the reverb at `echo` 1, and from how far the mid-distance set takes over (m: none of it, all of it). */
const RECORDED_WET = 0.5;
const FAR = [18, 75] as const;

const recordings = import.meta.glob('../../assets/audio/guns/*.ogg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export class GunSound {
  private ctx: BaseAudioContext | null = null;
  private out!: GainNode;
  private echo!: DelayNode;
  private noiseBuf!: AudioBuffer;
  private lp!: BiquadFilterNode;
  /** The shots' own bus: clipped softly, and sent to the reverb. */
  private shotBus!: GainNode;
  /** Which recordings the pistol is (or 'synth'), how loud the guns are (1 as built), how much street echo a recorded shot gets (0-1). */
  voice: GunVoice = DEFAULT_GUN_VOICE;
  /** The shotgun's shot: one of two recorded 12 gauges, or 'synth' (the page's own synthesised blast). */
  shotgunVoice: 'a' | 'b' | 'synth' = 'a';
  private readonly foley = new Map<string, AudioBuffer>();
  private level = 1;
  private echoAmount = 0.3;
  /** The recorded shots by `<voice>_<near|far>`, the last one played of each, and the buses they play into. */
  private readonly shots = new Map<string, AudioBuffer[]>();
  private readonly lastShot = new Map<string, number>();
  private recorded!: GainNode;
  private recordedWet!: GainNode;
  private slow = 0;
  /** Resolves once the recordings are decoded. */
  ready: Promise<void> = Promise.resolve();

  /** `into`: another context to play into (an offline one, for measuring); else the page's own, made on first use. */
  start(into?: BaseAudioContext): void {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext) void this.ctx.resume();
      return;
    }
    const ctx = into ?? new AudioContext();
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.out.connect(this.lp).connect(ctx.destination);
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
    // The shots: summed, pushed into a soft clip (tanh), then out; and a share into the reverb.
    this.shotBus = ctx.createGain();
    this.shotBus.gain.value = 0.5;
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 512 - 1) * 3.2));
    clip.curve = curve;
    clip.oversample = '2x';
    const level = ctx.createGain();
    level.gain.value = 0.75;
    this.shotBus.connect(clip).connect(level).connect(this.out);
    const verb = ctx.createConvolver();
    verb.buffer = this.space(ctx);
    const wet = ctx.createGain();
    wet.gain.value = WET;
    level.connect(wet).connect(verb).connect(this.out);
    // (The slap-back takes the shot as it's heard, after the clip.)
    const slap = ctx.createGain();
    slap.gain.value = 0.55;
    level.connect(slap).connect(this.echo);
    // The recorded shots: as they are, with a share into the same space.
    this.recorded = ctx.createGain();
    this.recorded.connect(this.out);
    this.recordedWet = ctx.createGain();
    this.recordedWet.gain.value = this.echoAmount * RECORDED_WET;
    this.recorded.connect(this.recordedWet).connect(verb);
    this.out.gain.value = 0.8 * this.level;
    this.ready = this.load(ctx);
  }

  private async load(ctx: BaseAudioContext): Promise<void> {
    await Promise.all(
      Object.entries(recordings).map(async ([path, url]) => {
        const m = /(pistol|shotgun)_(\w+)_(near|far)_(\d+)\.ogg$/.exec(path);
        const h = /foley_(\w+)\.ogg$/.exec(path);
        if (!m && !h) return;
        try {
          const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
          if (h) this.foley.set(h[1], buf);
          if (!m) return;
          const key = `${m[1]}_${m[2]}_${m[3]}`;
          this.shots.set(key, [...(this.shots.get(key) ?? []), buf]);
        } catch {
          /* a file that won't decode: the synthesised report stands in */
        }
      }),
    );
  }

  /** The guns' level (1 as built) and how much street echo a recorded shot gets (0-1). */
  setLevel(level: number, echo: number): void {
    if (level === this.level && echo === this.echoAmount) return;
    this.level = level;
    this.echoAmount = echo;
    if (!this.ctx) return;
    this.out.gain.setTargetAtTime(0.8 * level, this.ctx.currentTime, 0.03);
    this.recordedWet.gain.setTargetAtTime(echo * RECORDED_WET, this.ctx.currentTime, 0.03);
  }

  /** One of a set's recordings (not the one before), played `gain` loud through a low-pass at `top` Hz. */
  private sample(key: string, gain: number, top: number): boolean {
    const set = this.shots.get(key);
    if (!set?.length || gain < 0.004) return false;
    const ctx = this.ctx!;
    let i = Math.floor(Math.random() * set.length);
    if (set.length > 1 && i === this.lastShot.get(key)) i = (i + 1) % set.length;
    this.lastShot.set(key, i);
    const s = ctx.createBufferSource();
    s.buffer = set[i];
    // (No two alike; and lower in slow motion, as the world is.)
    s.playbackRate.value = (0.975 + Math.random() * 0.05) * (1 - 0.3 * this.slow);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = top;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = gain * (0.92 + Math.random() * 0.08);
    s.connect(f).connect(g).connect(this.recorded);
    s.start();
    return true;
  }

  /** A recorded shot of `set` (`pistol_9mm`, `shotgun_a`) `d` metres off; false if there's none (loaded yet). */
  private recordedShot(set: string, d: number, ks: number): boolean {
    if (set.endsWith('synth') || !this.shots.get(`${set}_near`)?.length) return false;
    const far = this.shots.get(`${set}_far`)?.length ? Math.min(1, Math.max(0, (d - FAR[0]) / (FAR[1] - FAR[0]))) : 0;
    const top = 19000 * Math.pow(0.22, Math.min(1, d / 120));
    this.sample(`${set}_near`, ks * Math.sqrt(1 - far), top);
    this.sample(`${set}_far`, ks * Math.sqrt(far) * 0.8, top);
    return true;
  }

  /** Whether the shotgun's shot is a recording (else the page has its own blast: models/meleeSound.ts). */
  get recordedShotgun(): boolean {
    return this.shotgunVoice !== 'synth' && !!this.shots.get(`shotgun_${this.shotgunVoice}_near`)?.length;
  }

  /** A recorded handling sound, `delay` seconds from now; false if it isn't there. */
  private handle(name: string, gain: number, delay = 0): boolean {
    const buf = this.foley.get(name);
    if (!buf) return false;
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = (0.97 + Math.random() * 0.06) * (1 - 0.3 * this.slow);
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(this.out);
    s.start(ctx.currentTime + delay);
    return true;
  }

  /** The space round a shot, as an impulse response: a few early echoes off walls, then a tail that darkens as it dies. */
  private space(ctx: BaseAudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(2, Math.floor(sr * (TAIL + 0.2)), sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        // (Nothing for the first few milliseconds: the shot itself is dry.)
        const env = t < 0.012 ? 0 : Math.pow(10, (-3 * t) / TAIL) * Math.min(1, (t - 0.012) / 0.03);
        // A one-pole low-pass that closes with time: the tail loses its top first.
        const a = Math.min(0.9, 0.25 + t * 0.6);
        low += (1 - a) * (Math.random() * 2 - 1 - low);
        d[i] = low * env * 0.5;
      }
      for (const [at, g] of [[0.021, 0.5], [0.037, -0.4], [0.058, 0.34], [0.083, -0.26], [0.121, 0.2], [0.166, 0.14]] as const) {
        const i = Math.floor((at + (ch ? 0.0045 : 0) + Math.random() * 0.004) * sr);
        for (let k = 0; k < 24 && i + k < d.length; k++) d[i + k] += g * (1 - k / 24) * (Math.random() * 0.6 + 0.4) * (k % 2 ? -1 : 1);
      }
    }
    return buf;
  }

  /** Slow motion (0-1): muffled, and the echo drawn out. */
  setSlow(k: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.slow = k;
    this.lp.frequency.setTargetAtTime(20000 * Math.pow(0.2, k), t, 0.05);
    this.echo.delayTime.setTargetAtTime(0.23 + k * 0.25, t, 0.1);
  }

  play(events: readonly ShotEvent[], listener: THREE.Vector3): void {
    if (!this.ctx) return;
    for (const e of events) {
      const d = e.at.distanceTo(listener);
      const k = 1 / (1 + d / 12);
      // Shots carry further than hits (the rival's, across the road).
      const ks = Math.min(1, 1 / (1 + Math.max(0, d - 4) / 30));
      switch (e.kind) {
        case 'pistol':
          if (!this.recordedShot(`pistol_${this.voice}`, d, ks)) this.pistol(ks, k);
          break;
        case 'shotgun':
          if (!this.recordedShot(`shotgun_${this.shotgunVoice}`, d, ks)) this.pistol(ks, k);
          break;
        case 'lever':
          // The lever thrown after a shot (a recorded action being worked), a moment after it.
          if (!this.handle('lever', 0.5 * k, 0.28)) for (const t of [0.28, 0.5]) this.noise(0.02, 'bandpass', 1800, 0.25 * k, 0.001, false, t);
          break;
        case 'paint':
          this.noise(0.05, 'bandpass', 700, 0.45 * ks, 0.002);
          this.noise(0.09, 'highpass', 3000, 0.08 * ks, 0.01);
          break;
        case 'clang':
          // A round into a car's panel: a hard knock and a short metallic ring.
          this.noise(0.04, 'bandpass', 2400, 0.6 * k, 0.001);
          for (const [f, g] of [[520, 0.2], [1370, 0.1]] as const) this.tone(f, f * 0.97, 0.25, g * k, 'triangle', 0.001);
          break;
        case 'dry':
          if (!this.handle('click', 0.5)) this.noise(0.015, 'highpass', 2500, 0.3, 0.0005);
          break;
        case 'reload':
          for (const t of [0, 0.35, 0.8]) this.noise(0.02, 'bandpass', 1800, 0.25, 0.001, false, t);
          break;
        case 'magazine':
          // His pistol's magazine changed (models/firstPerson.ts, 1.6 s): the catch and the empty one out, the
          // fresh one slapped home, the slide let go: recorded, each at its moment; else synthesised.
          if (this.handle('mag_out', 0.45, 0.11)) {
            this.handle('mag_in', 0.6, 0.9);
            this.handle('slide', 0.6, 1.04);
            break;
          }
          this.noise(0.012, 'bandpass', 2600, 0.22, 0.0005, false, 0.13);
          this.noise(0.03, 'bandpass', 900, 0.14, 0.002, false, 0.17);
          this.noise(0.022, 'bandpass', 1500, 0.4, 0.0006, false, 0.93);
          this.tone(210, 150, 0.04, 0.16, 'triangle', 0.001, this.out, 0.93);
          this.noise(0.016, 'bandpass', 3100, 0.34, 0.0004, false, 1.06);
          this.noise(0.02, 'bandpass', 1300, 0.3, 0.0006, false, 1.085);
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

  /** The pistol's report: `ks` how much of the shot carries to the listener (0-1), `k` how much of its small sounds. */
  private pistol(ks: number, k: number): void {
    const S = this.shotBus;
    // (No two alike: the pitch of each layer a few percent off, and its level.)
    const v = (): number => 0.94 + Math.random() * 0.12;
    const near = ks * ks;
    // The crack: everything at once, for a millisecond or two. Lost first with distance.
    this.noise(0.005, 'highpass', 1400, 2.4 * near, 0.0002, false, 0, S);
    this.noise(0.03, 'highpass', 3200 * v(), 1.5 * near, 0.0004, false, 0, S);
    // The blast's body.
    this.noise(0.075 * v(), 'bandpass', 1350 * v(), 6 * ks, 0.0006, false, 0, S, 0.7);
    this.noise(0.06, 'bandpass', 620 * v(), 3.6 * ks, 0.001, false, 0, S, 1);
    // Its weight: a thump that falls in pitch, and the air it moves after.
    this.tone(190 * v(), 52, 0.085, 0.5 * ks, 'sine', 0.0008, S);
    this.tone(88, 40, 0.16, 0.16 * near, 'sine', 0.002, S);
    // The duller tail of the report rolling away.
    this.noise(0.26, 'lowpass', 1900 * v(), 1.3 * ks, 0.004, false, 0.006, S);
    // The action: the slide back and home; the spent case on the ground a moment later.
    this.noise(0.009, 'bandpass', 3300, 0.2 * k, 0.0004, false, 0.042);
    this.noise(0.011, 'bandpass', 2300, 0.16 * k, 0.0004, false, 0.071);
    const land = 0.42 + Math.random() * 0.18;
    for (const [dt, f, g] of [[0, 5200, 0.05], [0.07, 6100, 0.035], [0.115, 5600, 0.02]] as const) this.tone(f * v(), f, 0.05, g * k, 'sine', 0.0005, this.out, land + dt);
  }

  private noise(len: number, type: BiquadFilterType, freq: number, gain: number, attack: number, echo = false, delay = 0, to: AudioNode = this.out, q = 1): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + len);
    s.connect(f).connect(g).connect(to);
    if (echo) g.connect(this.echo);
    s.start(t, Math.random() * 0.5);
    s.stop(t + attack + len + 0.05);
  }

  private tone(f0: number, f1: number, len: number, gain: number, type: OscillatorType, attack = 0.002, to: AudioNode = this.out, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + len);
    o.connect(g).connect(to);
    o.start(t);
    o.stop(t + attack + len + 0.05);
  }
}
