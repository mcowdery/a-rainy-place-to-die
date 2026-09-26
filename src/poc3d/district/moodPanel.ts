import { GRADE_NAMES, type GradeName } from '../real/grade';

/**
 * Weather and lighting settings to play with, on top of the (district, time, weather) atmosphere: rain
 * strength, wind (up to a hurricane) and its direction, lightning, fog density, darkness, shadow-casting
 * lamps and the colour grade. K opens the panel. Every setting also reads from the URL
 * (?rain=0.8&wind=0.6&windDir=90&lightning=on&fog=1.5&dark=0.7&shadows=4&grade=noir), and "copy link"
 * puts the current ones in the address bar and on the clipboard, to keep a look for a scene.
 */
export interface MoodSettings {
  /** 0-1, drizzle to downpour; null follows the weather (rain 0.45, otherwise none). */
  rain: number | null;
  /** 0-1: calm to hurricane. */
  wind: number;
  /** Degrees the wind blows toward: 0 north, 90 east. */
  windDir: number;
  /** Strikes: auto (in storms), off, occasional (~1/min) or storm (~6/min). */
  lightning: 'auto' | 'off' | 'occasional' | 'storm';
  /** Fog density multiplier (0.25 thin, 4 thick). */
  fog: number;
  /** Night only: the moon's strength, 0-1 (1 is the old default); null follows the atmosphere. */
  moon: number | null;
  /** 0-1: how far ambient light, the sky and lit windows drop, leaving only light sources. */
  darkness: number;
  /** Ground wetness 0-1; null follows the rain (wets over ~30 s, dries over a few minutes). */
  wetness: number | null;
  /** Depth of field: 0 off, 1 strong. */
  dof: number;
  /** Focus distance in metres; null focuses on the centre of the view. */
  focus: number | null;
  /** Street lamps nearest you that cast real shadows (each is a shadow-map render). */
  shadows: number;
  grade: GradeName;
  /** Weather cycle: rain builds to a storm, eases and clears on its own over ~6 minutes (rain and wind follow it). */
  cycle: boolean;
  /** 0-1 master volume (0 mutes). */
  volume: number;
}

export const MOOD_DEFAULTS: MoodSettings = { rain: null, wind: 0, windDir: 70, lightning: 'auto', fog: 1, moon: null, darkness: 0, wetness: null, dof: 0, focus: null, shadows: 0, grade: 'neutral', cycle: false, volume: 0.7 };
const SHADOW_COUNTS = [0, 2, 4, 8];

export function moodFromUrl(params: URLSearchParams): MoodSettings {
  const num = (k: string, lo: number, hi: number): number | undefined => {
    const v = params.get(k);
    if (v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
  };
  const m: MoodSettings = { ...MOOD_DEFAULTS };
  const rain = num('rain', 0, 1);
  if (rain !== undefined) m.rain = rain;
  m.wind = num('wind', 0, 1) ?? m.wind;
  m.windDir = num('windDir', 0, 360) ?? m.windDir;
  const l = params.get('lightning');
  if (l === 'on') m.lightning = 'storm';
  else if (l === 'off' || l === 'auto' || l === 'occasional' || l === 'storm') m.lightning = l;
  m.fog = num('fog', 0.25, 4) ?? m.fog;
  const moon = num('moon', 0, 1);
  if (moon !== undefined) m.moon = moon;
  m.darkness = num('dark', 0, 1) ?? m.darkness;
  const wet = num('wet', 0, 1);
  if (wet !== undefined) m.wetness = wet;
  m.dof = num('dof', 0, 1) ?? m.dof;
  const focus = num('focus', 1, 300);
  if (focus !== undefined) m.focus = focus;
  const s = num('shadows', 0, 8);
  if (s !== undefined) m.shadows = SHADOW_COUNTS.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a));
  m.volume = num('volume', 0, 1) ?? m.volume;
  m.cycle = params.get('cycle') === '1';
  const g = params.get('grade') as GradeName | null;
  if (g && GRADE_NAMES.includes(g)) m.grade = g;
  return m;
}

function moodToUrl(m: MoodSettings): string {
  const p = new URLSearchParams(location.search);
  const set = (k: string, v: string | null): void => void (v === null ? p.delete(k) : p.set(k, v));
  set('rain', m.rain === null ? null : m.rain.toFixed(2));
  set('wind', m.wind ? m.wind.toFixed(2) : null);
  set('windDir', m.wind ? String(Math.round(m.windDir)) : null);
  set('lightning', m.lightning === 'auto' ? null : m.lightning);
  set('fog', m.fog === 1 ? null : m.fog.toFixed(2));
  set('moon', m.moon === null ? null : m.moon.toFixed(2));
  set('dark', m.darkness ? m.darkness.toFixed(2) : null);
  set('wet', m.wetness === null ? null : m.wetness.toFixed(2));
  set('dof', m.dof ? m.dof.toFixed(2) : null);
  set('focus', m.dof && m.focus !== null ? m.focus.toFixed(1) : null);
  set('shadows', m.shadows ? String(m.shadows) : null);
  set('grade', m.grade === MOOD_DEFAULTS.grade ? null : m.grade);
  set('volume', m.volume === MOOD_DEFAULTS.volume ? null : m.volume.toFixed(2));
  set('cycle', m.cycle ? '1' : null);
  const q = p.toString();
  return `${location.pathname}${q ? `?${q}` : ''}`;
}

export class MoodPanel {
  readonly root: HTMLDivElement;
  private readonly rows = new Map<string, () => void>();

  constructor(
    readonly settings: MoodSettings,
    private readonly changed: () => void,
  ) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed', right: '12px', top: '12px', width: '300px', padding: '12px 14px', display: 'none', zIndex: '21',
      background: 'rgba(10, 10, 16, 0.9)', border: '1px solid #3a3850', color: '#e8e6f0', font: "12px 'Consolas', monospace",
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.addEventListener('click', (e) => e.stopPropagation());
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    const title = document.createElement('div');
    title.textContent = 'WEATHER & LIGHT  ·  K to close';
    Object.assign(title.style, { color: '#ff8ad8', marginBottom: '10px', letterSpacing: '1px' });
    this.root.append(title);

    const s = this.settings;
    this.slider('volume', 'Sound', 0, 1, 0.01, () => s.volume, (v) => (s.volume = v), (v) => (v < 0.01 ? 'muted' : `${Math.round(v * 100)}%`));
    this.choice('cycle', 'Weather cycle', ['off', 'on'], () => (s.cycle ? 'on' : 'off'), (v) => (s.cycle = v === 'on'));
    this.slider('rain', 'Rain', 0, 1, 0.01, () => s.rain ?? -1, (v) => (s.rain = v), (v) => (v < 0 ? 'from weather' : v < 0.2 ? `drizzle ${v.toFixed(2)}` : v < 0.6 ? `rain ${v.toFixed(2)}` : `downpour ${v.toFixed(2)}`), () => (s.rain = null));
    this.slider('wind', 'Wind', 0, 1, 0.01, () => s.wind, (v) => (s.wind = v), (v) => (v < 0.05 ? 'calm' : v < 0.35 ? `breeze ${v.toFixed(2)}` : v < 0.7 ? `gale ${v.toFixed(2)}` : `hurricane ${v.toFixed(2)}`));
    this.slider('windDir', 'Wind toward', 0, 360, 5, () => s.windDir, (v) => (s.windDir = v), (v) => `${Math.round(v)}° ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(v / 45) % 8]}`);
    this.choice('lightning', 'Lightning', ['auto', 'off', 'occasional', 'storm'], () => s.lightning, (v) => (s.lightning = v as MoodSettings['lightning']));
    this.slider('fog', 'Fog', 0.25, 4, 0.05, () => s.fog, (v) => (s.fog = v), (v) => `x${v.toFixed(2)}`);
    this.slider('moon', 'Moonlight (night)', 0, 1, 0.01, () => s.moon ?? -1, (v) => (s.moon = v), (v) => (v < 0 ? 'from time of day' : v.toFixed(2)), () => (s.moon = null));
    this.slider('dark', 'Darkness', 0, 1, 0.01, () => s.darkness, (v) => (s.darkness = v), (v) => (v < 0.05 ? 'normal' : `${Math.round(v * 100)}%`));
    this.slider('wet', 'Wet streets', 0, 1, 0.01, () => s.wetness ?? -1, (v) => (s.wetness = v), (v) => (v < 0 ? 'follows the rain' : v < 0.35 ? `damp ${v.toFixed(2)}` : `puddles ${v.toFixed(2)}`), () => (s.wetness = null));
    this.slider('dof', 'Depth of field', 0, 1, 0.01, () => s.dof, (v) => (s.dof = v), (v) => (v < 0.01 ? 'off' : v.toFixed(2)));
    // Focus on a log scale (1 m to 300 m), or auto (the centre of the view).
    const toM = (v: number): number => Math.exp(Math.log(1) + v * (Math.log(300) - Math.log(1)));
    const fromM = (m: number): number => Math.log(m) / Math.log(300);
    this.slider('focus', 'Focus', 0, 1, 0.005, () => (s.focus === null ? -1 : fromM(s.focus)), (v) => (s.focus = toM(v)), (v) => (v < 0 ? 'auto (centre of view)' : `${toM(v) < 10 ? toM(v).toFixed(1) : Math.round(toM(v))} m`), () => (s.focus = null));
    this.choice('shadows', 'Lamp shadows', SHADOW_COUNTS.map(String), () => String(s.shadows), (v) => (s.shadows = Number(v)));
    this.choice('grade', 'Grade', GRADE_NAMES, () => s.grade, (v) => (s.grade = v as GradeName));

    const buttons = document.createElement('div');
    Object.assign(buttons.style, { display: 'flex', gap: '8px', marginTop: '12px' });
    const button = (label: string, act: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, { flex: '1', padding: '5px', background: '#1a1a28', color: '#e8e6f0', border: '1px solid #2e2c44', cursor: 'pointer', font: 'inherit' });
      b.addEventListener('click', act);
      buttons.append(b);
      return b;
    };
    button('reset', () => {
      Object.assign(this.settings, MOOD_DEFAULTS);
      this.refresh();
      this.changed();
    });
    const copy = button('copy link', () => {
      const url = moodToUrl(this.settings);
      history.replaceState(null, '', url);
      void navigator.clipboard?.writeText(location.href).catch(() => undefined);
      copy.textContent = 'copied ✓';
      setTimeout(() => (copy.textContent = 'copy link'), 1200);
    });
    this.root.append(buttons);
    const note = document.createElement('div');
    note.textContent = 'Lamp shadows render the nearby scene once per lamp: 4 costs ~2 ms a frame, 8 about 12 ms (heavy). Changing the count recompiles shaders (a short pause).';
    Object.assign(note.style, { color: '#8a88a0', marginTop: '10px', lineHeight: '1.4' });
    this.root.append(note);
    document.body.append(this.root);
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  toggle(): void {
    this.root.style.display = this.open ? 'none' : 'block';
    if (this.open) this.refresh();
  }

  refresh(): void {
    for (const r of this.rows.values()) r();
  }

  private row(label: string): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, { margin: '7px 0' });
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', color: '#b8b6c8', marginBottom: '3px' });
    const name = document.createElement('span');
    name.textContent = label;
    head.append(name);
    row.append(head);
    this.root.append(row);
    return row;
  }

  private slider(key: string, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, show: (v: number) => string, auto?: () => void): void {
    const row = this.row(label);
    const value = document.createElement('span');
    Object.assign(value.style, { color: '#ffd070' });
    row.firstElementChild!.append(value);
    const line = document.createElement('div');
    Object.assign(line.style, { display: 'flex', gap: '6px', alignItems: 'center' });
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step) });
    Object.assign(input.style, { flex: '1', accentColor: '#ff8ad8' });
    input.addEventListener('input', () => {
      set(Number(input.value));
      value.textContent = show(Number(input.value));
      this.changed();
    });
    line.append(input);
    if (auto) {
      const b = document.createElement('button');
      b.textContent = 'auto';
      Object.assign(b.style, { padding: '1px 6px', background: '#1a1a28', color: '#b8b6c8', border: '1px solid #2e2c44', cursor: 'pointer', font: 'inherit' });
      b.addEventListener('click', () => {
        auto();
        this.refresh();
        this.changed();
      });
      line.append(b);
    }
    row.append(line);
    this.rows.set(key, () => {
      const v = get();
      input.value = String(Math.max(min, v));
      value.textContent = show(v);
    });
  }

  private choice(key: string, label: string, options: readonly string[], get: () => string, set: (v: string) => void): void {
    const row = this.row(label);
    const line = document.createElement('div');
    Object.assign(line.style, { display: 'flex', gap: '4px' });
    const buttons = options.map((o) => {
      const b = document.createElement('button');
      b.textContent = o;
      Object.assign(b.style, { flex: '1', padding: '3px 0', background: '#1a1a28', color: '#e8e6f0', border: '1px solid #2e2c44', cursor: 'pointer', font: 'inherit' });
      b.addEventListener('click', () => {
        set(o);
        this.refresh();
        this.changed();
      });
      line.append(b);
      return b;
    });
    row.append(line);
    this.rows.set(key, () => {
      const v = get();
      options.forEach((o, i) => (buttons[i].style.borderColor = o === v ? '#ff8ad8' : '#2e2c44'));
    });
  }
}
