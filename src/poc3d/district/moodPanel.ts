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
  lightning: 'auto' | 'on' | 'off';
  /** Fog density multiplier (0.25 thin, 4 thick). */
  fog: number;
  /** 0-1: how far ambient light, the sky and lit windows drop, leaving only light sources. */
  darkness: number;
  /** Street lamps nearest you that cast real shadows (each is a shadow-map render). */
  shadows: number;
  grade: GradeName;
}

export const MOOD_DEFAULTS: MoodSettings = { rain: null, wind: 0, windDir: 70, lightning: 'auto', fog: 1, darkness: 0, shadows: 0, grade: 'neutral' };
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
  if (l === 'on' || l === 'off' || l === 'auto') m.lightning = l;
  m.fog = num('fog', 0.25, 4) ?? m.fog;
  m.darkness = num('dark', 0, 1) ?? m.darkness;
  const s = num('shadows', 0, 8);
  if (s !== undefined) m.shadows = SHADOW_COUNTS.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a));
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
  set('dark', m.darkness ? m.darkness.toFixed(2) : null);
  set('shadows', m.shadows ? String(m.shadows) : null);
  set('grade', m.grade === MOOD_DEFAULTS.grade ? null : m.grade);
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
    this.slider('rain', 'Rain', 0, 1, 0.01, () => s.rain ?? -1, (v) => (s.rain = v), (v) => (v < 0 ? 'from weather' : v < 0.2 ? `drizzle ${v.toFixed(2)}` : v < 0.6 ? `rain ${v.toFixed(2)}` : `downpour ${v.toFixed(2)}`), () => (s.rain = null));
    this.slider('wind', 'Wind', 0, 1, 0.01, () => s.wind, (v) => (s.wind = v), (v) => (v < 0.05 ? 'calm' : v < 0.35 ? `breeze ${v.toFixed(2)}` : v < 0.7 ? `gale ${v.toFixed(2)}` : `hurricane ${v.toFixed(2)}`));
    this.slider('windDir', 'Wind toward', 0, 360, 5, () => s.windDir, (v) => (s.windDir = v), (v) => `${Math.round(v)}° ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(v / 45) % 8]}`);
    this.choice('lightning', 'Lightning', ['auto', 'on', 'off'], () => s.lightning, (v) => (s.lightning = v as MoodSettings['lightning']));
    this.slider('fog', 'Fog', 0.25, 4, 0.05, () => s.fog, (v) => (s.fog = v), (v) => `x${v.toFixed(2)}`);
    this.slider('dark', 'Darkness', 0, 1, 0.01, () => s.darkness, (v) => (s.darkness = v), (v) => (v < 0.05 ? 'normal' : `${Math.round(v * 100)}%`));
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
