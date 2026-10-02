import { MOB_LOOK_NAMES, type MobLook } from '../real/people';
import { GRADE_NAMES, type GradeName } from '../real/grade';
import { SKY_LOOKS, type SkyLook } from './atmosphere';
import { MOON_SHAPES, type MoonShape } from '../real/sky';

/**
 * Weather and lighting settings to play with, on top of the (district, time, weather) atmosphere: rain
 * strength, wind (up to a hurricane) and its direction, lightning, fog density, darkness, shadow-casting
 * lamps and the colour grade. K opens the panel. Every setting also reads from the URL
 * (?rain=0.8&wind=0.6&windDir=90&lightning=on&fog=1.5&dark=0.7&shadows=4&grade=noir&quality=medium; `auto` for the
 * settings that can follow the scene), and "copy link" puts the current ones in the address bar and on the
 * clipboard, to keep a look for a scene. Links list what differs from the built-in MOOD_DEFAULTS, so they
 * look the same in any browser.
 *
 * "save as default" keeps the current settings in this browser (localStorage): the page then starts from
 * them instead of MOOD_DEFAULTS (URL settings still override), and "reset" goes back to them.
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
  /** Glow round the big screens, 0 off to 1.5 (0.45 default). */
  screenGlow: number;
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
  /** Render resolution: auto (lowered while frames are slow, raised again when there's room) or a fixed share. */
  resolution: Resolution;
  /** How far the detail reaches (QUALITY): high is the full city; medium and low pull it in for slower machines. */
  quality: Quality;
  /** How the people in the streets look (real/people.ts MOB_LOOKS). */
  mob: MobLook;
  /** The sky's look (atmosphere.yaml `skies`): noir drains the colour from the night, deep is a city's ink-black one, citypop the violet one. */
  sky: SkyLook;
  /**
   * The sky's colours by day and through sunrise and sunset: computed from where the sun is (real/skyModel.ts), the
   * computed sky in the painted colours (tinted), half and half in the painted colours (mixed), or painted (the
   * atmosphere's own). Nights are painted either way.
   */
  skyColors: SkyColors;
  /** The moon's look (real/sky.ts MOON_SHAPE): the lunar calendar's, or full, a phase, hazy, or the old disc. */
  moonShape: MoonShape;
}

export const QUALITIES = ['high', 'medium', 'low'] as const;
export type Quality = (typeof QUALITIES)[number];
/**
 * What each quality level sets, in metres: full chunk detail (the building masses beyond), full props (parked cars,
 * trees, hedges; simplified beyond), traffic drawn, traffic cars full (their low model beyond), people shown.
 * Lamp shadows, resolution and the effects keep their own settings.
 */
export const QUALITY: Record<Quality, { detail: number; mid: number; traffic: number; carLod: number; people: number }> = {
  high: { detail: 300, mid: 140, traffic: 320, carLod: 80, people: 200 },
  medium: { detail: 230, mid: 100, traffic: 260, carLod: 60, people: 160 },
  low: { detail: 170, mid: 70, traffic: 200, carLod: 40, people: 120 },
};

export const SKY_COLORS = ['computed', 'tinted', 'mixed', 'painted'] as const;
export type SkyColors = (typeof SKY_COLORS)[number];
/**
 * What each sky colours setting takes from the computed sky (real/skyModel.ts): `sky`, how much of the sky's light
 * (its brightness round the sun, its gradient, the twilight); `light`, whether the light on the city takes its colours
 * too; `tint`, whether the computed sky is recoloured in the painted palette for the time of day (pink sunsets).
 */
export const SKY_COLOR_MODE: Record<SkyColors, { sky: number; light: number; tint: number }> = {
  computed: { sky: 1, light: 1, tint: 0 },
  tinted: { sky: 1, light: 0, tint: 1 },
  mixed: { sky: 0.5, light: 0, tint: 1 },
  painted: { sky: 0, light: 0, tint: 0 },
};

export const RESOLUTIONS = ['auto', '100', '85', '70', '55'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const MOOD_DEFAULTS: MoodSettings = { rain: null, wind: 0, windDir: 70, lightning: 'auto', fog: 1, moon: 1, darkness: 0.08, wetness: null, screenGlow: 0.1, dof: 0, focus: null, shadows: 8, grade: 'neutral', cycle: false, volume: 0.7, resolution: 'auto', quality: 'high', mob: 'solid', sky: 'deep', skyColors: 'painted', moonShape: 'calendar' };
const SHADOW_COUNTS = [0, 2, 4, 8];
const SAVED_KEY = 'city-popper.district.mood';

/** Settings from a parameter list over a base: each present key replaces the base's value. */
function moodFromParams(params: URLSearchParams, base: MoodSettings): MoodSettings {
  const num = (k: string, lo: number, hi: number): number | undefined => {
    const v = params.get(k);
    if (v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
  };
  /** A setting that can be null (follow the scene): `auto` gives null. */
  const opt = (k: string, lo: number, hi: number, cur: number | null): number | null => (params.get(k) === 'auto' ? null : num(k, lo, hi) ?? cur);
  const m: MoodSettings = { ...base };
  m.rain = opt('rain', 0, 1, m.rain);
  m.wind = num('wind', 0, 1) ?? m.wind;
  m.windDir = num('windDir', 0, 360) ?? m.windDir;
  const l = params.get('lightning');
  if (l === 'on') m.lightning = 'storm';
  else if (l === 'off' || l === 'auto' || l === 'occasional' || l === 'storm') m.lightning = l;
  m.fog = num('fog', 0.25, 4) ?? m.fog;
  m.moon = opt('moon', 0, 1, m.moon);
  m.darkness = num('dark', 0, 1) ?? m.darkness;
  m.wetness = opt('wet', 0, 1, m.wetness);
  m.screenGlow = num('glow', 0, 1.5) ?? m.screenGlow;
  m.dof = num('dof', 0, 1) ?? m.dof;
  m.focus = opt('focus', 1, 300, m.focus);
  const s = num('shadows', 0, 8);
  if (s !== undefined) m.shadows = SHADOW_COUNTS.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a));
  m.volume = num('volume', 0, 1) ?? m.volume;
  const c = params.get('cycle');
  if (c === '1' || c === '0') m.cycle = c === '1';
  const g = params.get('grade') as GradeName | null;
  if (g && GRADE_NAMES.includes(g)) m.grade = g;
  const r = params.get('res') as Resolution | null;
  if (r && RESOLUTIONS.includes(r)) m.resolution = r;
  const q = params.get('quality') as Quality | null;
  if (q && QUALITIES.includes(q)) m.quality = q;
  const mb = params.get('mob') as MobLook | null;
  if (mb && MOB_LOOK_NAMES.includes(mb)) m.mob = mb;
  const sk = params.get('sky') as SkyLook | null;
  if (sk && SKY_LOOKS.includes(sk)) m.sky = sk;
  const sc = params.get('skyColors') as SkyColors | null;
  if (sc && SKY_COLORS.includes(sc)) m.skyColors = sc;
  const ms = params.get('moonShape') as MoonShape | null;
  if (ms && MOON_SHAPES.includes(ms)) m.moonShape = ms;
  return m;
}

/** The settings as parameters, only those that differ from `base` (null ones as `auto`). */
function moodParams(m: MoodSettings, base: MoodSettings, into = new URLSearchParams()): URLSearchParams {
  const set = (k: string, v: string | null, b: string | null): void => void (v === b ? into.delete(k) : into.set(k, v ?? 'auto'));
  const f = (v: number | null, d = 2): string | null => (v === null ? null : v.toFixed(d));
  set('rain', f(m.rain), f(base.rain));
  set('wind', f(m.wind), f(base.wind));
  set('windDir', String(Math.round(m.windDir)), String(Math.round(base.windDir)));
  set('lightning', m.lightning, base.lightning);
  set('fog', f(m.fog), f(base.fog));
  set('moon', f(m.moon), f(base.moon));
  set('dark', f(m.darkness), f(base.darkness));
  set('wet', f(m.wetness), f(base.wetness));
  set('glow', f(m.screenGlow), f(base.screenGlow));
  set('dof', f(m.dof), f(base.dof));
  set('focus', f(m.focus, 1), f(base.focus, 1));
  set('shadows', String(m.shadows), String(base.shadows));
  set('grade', m.grade, base.grade);
  set('volume', f(m.volume), f(base.volume));
  set('cycle', m.cycle ? '1' : '0', base.cycle ? '1' : '0');
  set('res', m.resolution, base.resolution);
  set('quality', m.quality, base.quality);
  set('mob', m.mob, base.mob);
  set('sky', m.sky, base.sky);
  set('skyColors', m.skyColors, base.skyColors);
  set('moonShape', m.moonShape, base.moonShape);
  return into;
}

/** The defaults saved in this browser, or null. */
function savedDefaults(): MoodSettings | null {
  try {
    const q = localStorage.getItem(SAVED_KEY);
    return q === null ? null : moodFromParams(new URLSearchParams(q), MOOD_DEFAULTS);
  } catch {
    return null;
  }
}

/** The page's starting settings: saved in this browser, otherwise MOOD_DEFAULTS. */
export function moodDefaults(): MoodSettings {
  return savedDefaults() ?? { ...MOOD_DEFAULTS };
}

export function moodFromUrl(params: URLSearchParams): MoodSettings {
  return moodFromParams(params, moodDefaults());
}

function moodToUrl(m: MoodSettings): string {
  const p = moodParams(m, MOOD_DEFAULTS, new URLSearchParams(location.search));
  const q = p.toString();
  return `${location.pathname}${q ? `?${q}` : ''}`;
}

export class MoodPanel {
  readonly root: HTMLDivElement;
  private readonly rows = new Map<string, () => void>();
  private readonly savedLine: HTMLDivElement;

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
    this.slider('glow', 'Screen glow', 0, 1.5, 0.01, () => s.screenGlow, (v) => (s.screenGlow = v), (v) => (v < 0.01 ? 'off' : v.toFixed(2)));
    this.slider('dof', 'Depth of field', 0, 1, 0.01, () => s.dof, (v) => (s.dof = v), (v) => (v < 0.01 ? 'off' : v.toFixed(2)));
    // Focus on a log scale (1 m to 300 m), or auto (the centre of the view).
    const toM = (v: number): number => Math.exp(Math.log(1) + v * (Math.log(300) - Math.log(1)));
    const fromM = (m: number): number => Math.log(m) / Math.log(300);
    this.slider('focus', 'Focus', 0, 1, 0.005, () => (s.focus === null ? -1 : fromM(s.focus)), (v) => (s.focus = toM(v)), (v) => (v < 0 ? 'auto (centre of view)' : `${toM(v) < 10 ? toM(v).toFixed(1) : Math.round(toM(v))} m`), () => (s.focus = null));
    this.choice('shadows', 'Lamp shadows', SHADOW_COUNTS.map(String), () => String(s.shadows), (v) => (s.shadows = Number(v)));
    this.choice('sky', 'Sky', SKY_LOOKS, () => s.sky, (v) => (s.sky = v as SkyLook));
    this.choice('skyColors', 'Sky colours', SKY_COLORS, () => s.skyColors, (v) => (s.skyColors = v as SkyColors));
    this.choice('moonShape', 'Moon', MOON_SHAPES, () => s.moonShape, (v) => (s.moonShape = v as MoonShape));
    this.choice('grade', 'Grade', GRADE_NAMES, () => s.grade, (v) => (s.grade = v as GradeName));
    this.choice('res', 'Resolution %', RESOLUTIONS, () => s.resolution, (v) => (s.resolution = v as Resolution));
    this.choice('quality', 'Detail', QUALITIES, () => s.quality, (v) => (s.quality = v as Quality));
    this.choice('mob', 'People', MOB_LOOK_NAMES, () => s.mob, (v) => (s.mob = v as MobLook));

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
      Object.assign(this.settings, moodDefaults());
      this.refresh();
      this.changed();
    });
    const save = button('save as default', () => {
      try {
        localStorage.setItem(SAVED_KEY, moodParams(this.settings, MOOD_DEFAULTS).toString());
        save.textContent = 'saved ✓';
      } catch {
        save.textContent = 'not saved';
      }
      setTimeout(() => (save.textContent = 'save as default'), 1200);
      this.showSaved();
    });
    const copy = button('copy link', () => {
      const url = moodToUrl(this.settings);
      history.replaceState(null, '', url);
      void navigator.clipboard?.writeText(location.href).catch(() => undefined);
      copy.textContent = 'copied ✓';
      setTimeout(() => (copy.textContent = 'copy link'), 1200);
    });
    this.root.append(buttons);
    // Which defaults "reset" goes back to, and a way to forget the saved ones.
    this.savedLine = document.createElement('div');
    Object.assign(this.savedLine.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#8a88a0', marginTop: '8px' });
    const savedText = document.createElement('span');
    const forget = document.createElement('button');
    forget.textContent = 'use built-in';
    Object.assign(forget.style, { padding: '1px 6px', background: '#1a1a28', color: '#b8b6c8', border: '1px solid #2e2c44', cursor: 'pointer', font: 'inherit' });
    forget.addEventListener('click', () => {
      try {
        localStorage.removeItem(SAVED_KEY);
      } catch {
        // Storage blocked: nothing was saved.
      }
      Object.assign(this.settings, MOOD_DEFAULTS);
      this.refresh();
      this.changed();
      this.showSaved();
    });
    this.savedLine.append(savedText, forget);
    this.root.append(this.savedLine);
    this.showSaved();
    const note = document.createElement('div');
    note.textContent = 'Lamp shadows: each lamp costs ~1.5 ms a frame at night (its shadow map redraws in turn, not every frame; none by day). Changing the count recompiles shaders (a short pause). Resolution auto lowers the render resolution while frames run slow. Detail: how far full detail, traffic and people reach (high is the full city; medium and low for slower machines).';
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

  /** Shows whether "reset" goes to defaults saved in this browser or the built-in ones. */
  private showSaved(): void {
    const saved = savedDefaults() !== null;
    (this.savedLine.firstElementChild as HTMLElement).textContent = saved ? 'defaults: saved in this browser' : 'defaults: built-in';
    (this.savedLine.lastElementChild as HTMLElement).style.display = saved ? '' : 'none';
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
