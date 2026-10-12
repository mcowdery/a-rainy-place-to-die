/**
 * Recorded engine loops for CarSound (assets/audio/engines/, CREDITS.md there): a loop played faster as the revs
 * rise. Two voices: `real`, one recorded four-cylinder loop (qubodup, CC BY 3.0) at about 1300 rpm, and `loops`,
 * six pitch steps of one engine (domasx2, CC0) crossfaded as the revs move through them. `synth` is the old
 * oscillators alone. `honda` is a Honda F20C's steady stretches (Tyler Riddle, CC BY 3.0), cut into a ladder by
 * scripts/audio/cut_engine_runs.mjs (the manifest `honda.json` gives each loop's measured pitch). Which one is the listener's to pick by ear: `?engine=real|loops|synth` (or localStorage
 * `rainyplace.engine`), default `honda`.
 */
export const ENGINE_VOICES = ['real', 'loops', 'honda', 'synth'] as const;
export type EngineVoice = (typeof ENGINE_VOICES)[number];

/**
 * What the listener can adjust (the debug menu's Sound tab; `?engine=` and the others in moodPanel.ts), shared by
 * every CarSound and read each frame: 1 is as built. `level` all the car's sounds, `engine` the engine alone, `tone`
 * how bright it is (the filter), `pitch` the engine's pitch overall, `curve` how closely the pitch follows the revs
 * (the power: 1 follows them fully, lower keeps the range narrow), `synth` how much of the oscillators sits under
 * the recording, `tyres`, `wind` and `whistle` the rest, `traffic` the level of the traffic's recorded engines (real/audio.ts).
 */
export const engineTune = { voice: 'honda' as EngineVoice, level: 1, engine: 1, tone: 1, pitch: 0.65, curve: 0.8, synth: 1, tyres: 2.01, wind: 1, whistle: 1, traffic: 1 };

const files = import.meta.glob('../../assets/audio/engines/*.ogg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** The rpm a loop at rate 1 stands for (the recorded loop idles near 1300), and each loop's measured pulse rate (Hz). */
export const SAMPLE_RPM = 1300;
const REAL_PULSE = 43.4;
const LOOP_PULSES = [43.2, 60.1, 65.1, 69.8, 72.7, 76.4];

const manifests = import.meta.glob('../../assets/audio/engines/*.json', { eager: true, import: 'default' }) as Record<string, { file: string; pulse: number }[]>;

/** A voice's loops, and what pitch (Hz) its loops hold at `refRpm`: the rest follows the revs from there. */
export interface Voice {
  layers: SampleLayer[];
  refPulse: number;
  refRpm: number;
}

export interface SampleLayer {
  /** The loop's own pulse rate in Hz at rate 1. */
  pulse: number;
  url: string;
}

/** The voice asked for on the page's address or kept in storage (the race page; the city's menu sets `engineTune.voice` itself). */
export function engineVoice(): EngineVoice {
  let v: string | null = null;
  try {
    v = new URLSearchParams(location.search).get('engine') ?? localStorage.getItem('rainyplace.engine');
  } catch {
    /* no URL or storage: the default */
  }
  return (ENGINE_VOICES as readonly string[]).includes(v ?? '') ? (v as EngineVoice) : 'honda';
}
engineTune.voice = engineVoice();

export function layersFor(voice: EngineVoice): Voice {
  const find = (name: string): string | undefined => Object.entries(files).find(([p]) => p.endsWith(`/${name}.ogg`))?.[1];
  let layers: SampleLayer[] = [];
  let refPulse = REAL_PULSE;
  let refRpm = SAMPLE_RPM;
  if (voice === 'real') {
    const url = find('real');
    layers = url ? [{ pulse: REAL_PULSE, url }] : [];
  } else if (voice === 'loops') {
    layers = LOOP_PULSES.flatMap((pulse, i) => {
      const url = find(`loop_${i}`);
      return url ? [{ pulse, url }] : [];
    });
  } else if (voice !== 'synth') {
    const list = Object.entries(manifests).find(([p]) => p.endsWith(`/${voice}.json`))?.[1] ?? [];
    layers = list.flatMap((m) => {
      const url = find(m.file.replace(/\.ogg$/, ''));
      return url ? [{ pulse: m.pulse, url }] : [];
    });
    // The lowest steady stretch stands for a light idle-and-a-bit; the ladder spans from there.
    if (layers.length) {
      refPulse = layers[0].pulse;
      refRpm = 1000;
    }
  }
  return { layers, refPulse, refRpm };
}

/** The loop files' bytes, fetched once and decoded for each audio context (every car has its own). */
const bytes = new Map<string, Promise<ArrayBuffer>>();
export function loadLayers(ctx: BaseAudioContext, layers: SampleLayer[]): Promise<AudioBuffer[]> {
  return Promise.all(
    layers.map((l) => {
      let p = bytes.get(l.url);
      if (!p) bytes.set(l.url, (p = fetch(l.url).then((r) => r.arrayBuffer())));
      return p.then((b) => ctx.decodeAudioData(b.slice(0)));
    }),
  );
}

/**
 * How the revs map to the loops: the pulse rate wanted (Hz, as the real loop's scale) and the rate each loop plays
 * at with its weight (triangular in log pitch between neighbours, so a pair at most is heard).
 * The pitch follows the revs at `curve` (0.8) power: a loop played 5x faster for 7000 rpm is a chipmunk, not an engine.
 */
export function mix(rpm: number, v: Voice, curve = 0.8, pitch = 1): { rate: number; weight: number }[] {
  const { layers } = v;
  const target = v.refPulse * Math.min(3.2, Math.max(0.5, Math.pow(rpm / v.refRpm, curve) * pitch));
  if (layers.length === 1) return [{ rate: target / layers[0].pulse, weight: 1 }];
  const out = layers.map((l) => ({ rate: target / l.pulse, weight: 0 }));
  const lt = Math.log(target);
  let k = 0;
  while (k < layers.length - 1 && Math.log(layers[k + 1].pulse) <= lt) k++;
  if (k >= layers.length - 1) {
    out[layers.length - 1].weight = 1;
  } else if (lt <= Math.log(layers[0].pulse)) {
    out[0].weight = 1;
  } else {
    const a = Math.log(layers[k].pulse);
    const b = Math.log(layers[k + 1].pulse);
    const w = (lt - a) / (b - a);
    out[k].weight = 1 - w;
    out[k + 1].weight = w;
  }
  return out;
}
