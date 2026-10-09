import { BLUSH_LOOKS, EMOTE_LOOKS, HEART_LOOKS, STAR_LOOKS, type EmoteLooks } from '../real/emotes';
import { MOB_LOOK_NAMES, type MobLook } from '../real/people';
import { GRADE_NAMES, type GradeName } from '../real/grade';
import { SKY_LOOKS, type SkyLook } from './atmosphere';
import { MOON_SHAPES, type MoonShape } from '../real/sky';
import { DEFAULT_GUN_VOICE, GUN_VOICES, type GunVoice } from '../../race/gunVoices';

/**
 * Settings to play with, on top of the (district, time, weather) atmosphere: rain strength, wind (up to a
 * hurricane) and its direction, lightning, fog density, darkness, shadow-casting lamps, the colour grade, how the
 * crowd looks, the sound's levels, the detail. Their rows are in the debug menu's tabs (` backquote,
 * district/debugMenu.ts: `MoodPanel.groups`). Every setting also reads from the URL
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
  /** The rooms behind the windows (real/windowScenes.ts): how many people are in them, and how much of the city's vice shows (multipliers; 0 none). */
  windowFolk: number;
  windowVice: number;
  /** Whether anyone is in those rooms at all (off: the rooms stay furnished, and empty). */
  windowPeople: boolean;
  /** Depth of field: 0 off, 1 strong. */
  dof: number;
  /** Focus distance in metres; null focuses on the centre of the view. */
  focus: number | null;
  /** Street lamps nearest you that cast real shadows (each is a shadow-map render). */
  shadows: number;
  grade: GradeName;
  /** Weather cycle: rain builds to a storm, eases and clears on its own over ~6 minutes (rain and wind follow it). */
  cycle: boolean;
  /** The people cast shadows (those near you). */
  mobShadows: boolean;
  /** People show emotes now and then (anime's symbols at the head: real/emotes.ts). */
  mobEmotes: boolean;
  /** How many of the street's smokers have one lit (0 none, 1 as the period was: real/smoke.ts). */
  smoking: number;
  /** How the emotes' blush, hearts and stars are drawn (real/emotes.ts EmoteLooks). */
  mobBlush: EmoteLooks['blush'];
  mobHearts: EmoteLooks['hearts'];
  mobStars: EmoteLooks['stars'];
  /** 0-1 master volume (0 mutes). */
  volume: number;
  /** In your car only (real/audio.ts `cabin`): how much the cabin shuts the outside out (0 none, 1 nearly all of
   * it), and how loud the rain drums on its roof (1 as built). */
  carDamp: number;
  carRoof: number;
  /** Footsteps' level against the rest (1 as built). */
  steps: number;
  /** The pistol's shot (race/gunVoices.ts: a set of recordings, or the synthesised one), the guns' level against the rest (1 as built), and how much street echo a recorded shot gets. */
  gun: GunVoice;
  shotgun: 'a' | 'b' | 'synth';
  guns: number;
  gunEcho: number;
  /** The car radio's level (real/radio.ts; 0 silences it). */
  music: number;
  /** Render resolution: auto (lowered while frames are slow, raised again when there's room) or a fixed share. */
  resolution: Resolution;
  /** The rear-view mirror's picture at the wheel of your car: none, in the cabin's own mirror only, or also as a mirror over the view from the other cameras. */
  mirror: 'off' | 'cockpit' | 'all';
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

export const MOOD_DEFAULTS: MoodSettings = { rain: null, wind: 0, windDir: 70, lightning: 'auto', fog: 1, moon: 1, darkness: 0.08, wetness: null, screenGlow: 0.1, windowFolk: 1, windowVice: 1, windowPeople: true, dof: 0, focus: null, shadows: 8, grade: 'neutral', cycle: false, volume: 0.7, carDamp: 0.5, carRoof: 1, steps: 1, gun: DEFAULT_GUN_VOICE, shotgun: 'a', guns: 1, gunEcho: 0.3, music: 0.5, resolution: 'auto', mirror: 'all', quality: 'high', mob: 'ghost', mobShadows: true, mobEmotes: true, smoking: 1, mobBlush: EMOTE_LOOKS.blush, mobHearts: EMOTE_LOOKS.hearts, mobStars: EMOTE_LOOKS.stars, sky: 'deep', skyColors: 'painted', moonShape: 'calendar' };
const SHADOW_COUNTS = [0, 2, 4, 8];
const SAVED_KEY = 'rainyplace.district.mood';

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
  m.windowFolk = num('windowFolk', 0, 3) ?? m.windowFolk;
  m.windowVice = num('windowVice', 0, 4) ?? m.windowVice;
  m.dof = num('dof', 0, 1) ?? m.dof;
  m.focus = opt('focus', 1, 300, m.focus);
  const s = num('shadows', 0, 8);
  if (s !== undefined) m.shadows = SHADOW_COUNTS.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a));
  m.volume = num('volume', 0, 1) ?? m.volume;
  m.carDamp = num('carDamp', 0, 1) ?? m.carDamp;
  m.carRoof = num('carRoof', 0, 2) ?? m.carRoof;
  m.steps = num('steps', 0, 2) ?? m.steps;
  m.guns = num('guns', 0, 2) ?? m.guns;
  m.gunEcho = num('gunEcho', 0, 1) ?? m.gunEcho;
  const gv = params.get('gun') as GunVoice | null;
  if (gv && GUN_VOICES.includes(gv)) m.gun = gv;
  const sv = params.get('shotgun');
  if (sv === 'a' || sv === 'b' || sv === 'synth') m.shotgun = sv;
  m.music = num('music', 0, 1) ?? m.music;
  const c = params.get('cycle');
  if (c === '1' || c === '0') m.cycle = c === '1';
  const cast = params.get('mobShadows');
  if (cast === '1' || cast === '0') m.mobShadows = cast === '1';
  const wp = params.get('windowPeople');
  if (wp === '1' || wp === '0') m.windowPeople = wp === '1';
  m.smoking = num('smoking', 0, 1) ?? m.smoking;
  const em = params.get('emotes');
  if (em === '1' || em === '0') m.mobEmotes = em === '1';
  const bl = params.get('blush') as EmoteLooks['blush'] | null;
  if (bl && BLUSH_LOOKS.includes(bl)) m.mobBlush = bl;
  const he = params.get('hearts') as EmoteLooks['hearts'] | null;
  if (he && HEART_LOOKS.includes(he)) m.mobHearts = he;
  const st = params.get('stars') as EmoteLooks['stars'] | null;
  if (st && STAR_LOOKS.includes(st)) m.mobStars = st;
  const g = params.get('grade') as GradeName | null;
  if (g && GRADE_NAMES.includes(g)) m.grade = g;
  const mi = params.get('mirror');
  if (mi === 'off' || mi === 'cockpit' || mi === 'all') m.mirror = mi;
  else if (mi === '0' || mi === '1') m.mirror = mi === '1' ? 'all' : 'off';
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
  set('windowFolk', f(m.windowFolk), f(base.windowFolk));
  set('windowVice', f(m.windowVice), f(base.windowVice));
  set('windowPeople', m.windowPeople ? '1' : '0', base.windowPeople ? '1' : '0');
  set('dof', f(m.dof), f(base.dof));
  set('focus', f(m.focus, 1), f(base.focus, 1));
  set('shadows', String(m.shadows), String(base.shadows));
  set('grade', m.grade, base.grade);
  set('volume', f(m.volume), f(base.volume));
  set('carDamp', f(m.carDamp), f(base.carDamp));
  set('carRoof', f(m.carRoof), f(base.carRoof));
  set('steps', f(m.steps), f(base.steps));
  set('gun', m.gun, base.gun);
  set('shotgun', m.shotgun, base.shotgun);
  set('guns', f(m.guns), f(base.guns));
  set('gunEcho', f(m.gunEcho), f(base.gunEcho));
  set('music', f(m.music), f(base.music));
  set('cycle', m.cycle ? '1' : '0', base.cycle ? '1' : '0');
  set('mobShadows', m.mobShadows ? '1' : '0', base.mobShadows ? '1' : '0');
  set('emotes', m.mobEmotes ? '1' : '0', base.mobEmotes ? '1' : '0');
  set('smoking', f(m.smoking), f(base.smoking));
  set('blush', m.mobBlush, base.mobBlush);
  set('hearts', m.mobHearts, base.mobHearts);
  set('stars', m.mobStars, base.mobStars);
  set('res', m.resolution, base.resolution);
  set('mirror', m.mirror, base.mirror);
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

/** The settings' rows by subject: a tab of the debug menu shows one or more of them. */
export type MoodGroup = 'weather' | 'light' | 'crowd' | 'windows' | 'sound' | 'graphics';
const UI = { accent: '#7cffb0', value: '#ffd070', dim: '#8a9a92', label: '#b8c6c0', button: '#1a2020', line: '#2f3c38' };

export class MoodPanel {
  /** The rows, by subject. */
  readonly groups: Record<MoodGroup, HTMLDivElement>;
  /** Reset, save as default and copy link, which act on every group's settings, and which defaults reset goes back to. */
  readonly footer: HTMLDivElement;
  private readonly rows = new Map<string, () => void>();
  private readonly savedLine: HTMLDivElement;
  /** The group the rows being built go into. */
  private into: HTMLDivElement;

  constructor(
    readonly settings: MoodSettings,
    private readonly changed: () => void,
  ) {
    const group = (): HTMLDivElement => document.createElement('div');
    this.groups = { weather: group(), light: group(), crowd: group(), windows: group(), sound: group(), graphics: group() };
    const s = this.settings;
    const pct = (v: number): string => `${Math.round(v * 100)}%`;

    this.into = this.groups.weather;
    this.choice('cycle', 'Weather cycle', ['off', 'on'], () => (s.cycle ? 'on' : 'off'), (v) => (s.cycle = v === 'on'));
    this.slider('rain', 'Rain', 0, 1, 0.01, () => s.rain ?? -1, (v) => (s.rain = v), (v) => (v < 0 ? 'from weather' : v < 0.2 ? `drizzle ${v.toFixed(2)}` : v < 0.6 ? `rain ${v.toFixed(2)}` : `downpour ${v.toFixed(2)}`), () => (s.rain = null));
    this.slider('wet', 'Wet streets', 0, 1, 0.01, () => s.wetness ?? -1, (v) => (s.wetness = v), (v) => (v < 0 ? 'follows the rain' : v < 0.35 ? `damp ${v.toFixed(2)}` : `puddles ${v.toFixed(2)}`), () => (s.wetness = null));
    this.slider('wind', 'Wind', 0, 1, 0.01, () => s.wind, (v) => (s.wind = v), (v) => (v < 0.05 ? 'calm' : v < 0.35 ? `breeze ${v.toFixed(2)}` : v < 0.7 ? `gale ${v.toFixed(2)}` : `hurricane ${v.toFixed(2)}`));
    this.slider('windDir', 'Wind toward', 0, 360, 5, () => s.windDir, (v) => (s.windDir = v), (v) => `${Math.round(v)}° ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(v / 45) % 8]}`);
    this.choice('lightning', 'Lightning', ['auto', 'off', 'occasional', 'storm'], () => s.lightning, (v) => (s.lightning = v as MoodSettings['lightning']));
    this.slider('fog', 'Fog', 0.25, 4, 0.05, () => s.fog, (v) => (s.fog = v), (v) => `x${v.toFixed(2)}`);

    this.into = this.groups.light;
    this.slider('dark', 'Darkness', 0, 1, 0.01, () => s.darkness, (v) => (s.darkness = v), (v) => (v < 0.05 ? 'normal' : pct(v)));
    this.slider('moon', 'Moonlight (night)', 0, 1, 0.01, () => s.moon ?? -1, (v) => (s.moon = v), (v) => (v < 0 ? 'from time of day' : v.toFixed(2)), () => (s.moon = null));
    this.slider('glow', 'Screen glow', 0, 1.5, 0.01, () => s.screenGlow, (v) => (s.screenGlow = v), (v) => (v < 0.01 ? 'off' : v.toFixed(2)));
    this.choice('sky', 'Sky', SKY_LOOKS, () => s.sky, (v) => (s.sky = v as SkyLook));
    this.choice('skyColors', 'Sky colours', SKY_COLORS, () => s.skyColors, (v) => (s.skyColors = v as SkyColors));
    this.choice('moonShape', 'Moon', MOON_SHAPES, () => s.moonShape, (v) => (s.moonShape = v as MoonShape));
    this.choice('grade', 'Grade', GRADE_NAMES, () => s.grade, (v) => (s.grade = v as GradeName));

    // The crowd in the streets: the mob's look (ghost: all black and see-through; color: the figures in their
    // colours, lit by the scene), whether people cast shadows, whether they show emotes and how those are drawn.
    this.into = this.groups.crowd;
    this.choice('mob', 'Look', MOB_LOOK_NAMES, () => s.mob, (v) => (s.mob = v as MobLook));
    this.choice('mobShadows', 'Shadows they cast', ['off', 'on'], () => (s.mobShadows ? 'on' : 'off'), (v) => (s.mobShadows = v === 'on'));
    this.slider('smoking', 'Smoking', 0, 1, 0.05, () => s.smoking, (v) => (s.smoking = v), (v) => (v < 0.03 ? 'nobody' : v > 0.97 ? 'as it was (late Showa)' : `${Math.round(v * 100)}% of them`));
    this.choice('emotes', 'Emotes', ['off', 'on'], () => (s.mobEmotes ? 'on' : 'off'), (v) => (s.mobEmotes = v === 'on'));
    this.choice('blush', 'Blush', BLUSH_LOOKS, () => s.mobBlush, (v) => (s.mobBlush = v as EmoteLooks['blush']));
    this.choice('hearts', 'Hearts', HEART_LOOKS, () => s.mobHearts, (v) => (s.mobHearts = v as EmoteLooks['hearts']));
    this.choice('stars', 'Stars', STAR_LOOKS, () => s.mobStars, (v) => (s.mobStars = v as EmoteLooks['stars']));

    // The rooms behind the windows (real/windowScenes.ts).
    this.into = this.groups.windows;
    this.choice('windowPeople', 'Window scenes (people and furniture)', ['off', 'on'], () => (s.windowPeople ? 'on' : 'off'), (v) => (s.windowPeople = v === 'on'));
    this.slider('windowFolk', 'How many', 0, 3, 0.05, () => s.windowFolk, (v) => (s.windowFolk = v), (v) => (v < 0.03 ? 'none' : `x${v.toFixed(2)}`));
    this.slider('windowVice', 'Vice (and shady shops)', 0, 4, 0.05, () => s.windowVice, (v) => (s.windowVice = v), (v) => (v < 0.03 ? 'none' : `x${v.toFixed(2)}`));
    this.note('Off: the rooms stay lit and furnished, with nobody in them. The shady shops at street level follow Vice alone.');
    // (The crowd's notes come after the windows' rows, the People tab's last, so they don't push those down.)
    this.note('ghost: all black and see-through. color: in their colours, lit by the sky, the sun or moon and the street, dark in shadow. solid, rim, lit: black, near-opaque. Only people near you cast shadows, and only while the sun or moon casts any. Emotes: now and then someone near you shows what they feel, a mark at the head (a sweat drop, the anger mark, a blush, a heart, zzz). Blush: lines on the cheeks, the face flushed, or both. Hearts and stars: over the head, for eyes (over the head from behind), or small ones rising off or round the head. In the cold, breath shows.');

    this.into = this.groups.sound;
    this.slider('volume', 'Sound', 0, 1, 0.01, () => s.volume, (v) => (s.volume = v), (v) => (v < 0.01 ? 'muted' : pct(v)));
    this.slider('music', 'Music (radio, phone)', 0, 1, 0.01, () => s.music, (v) => (s.music = v), (v) => (v < 0.01 ? 'silent' : pct(v)));
    this.slider('steps', 'Footsteps', 0, 2, 0.01, () => s.steps, (v) => (s.steps = v), (v) => (v < 0.01 ? 'off' : pct(v)));
    this.choice('gun', 'Pistol shot', GUN_VOICES, () => s.gun, (v) => (s.gun = v as GunVoice));
    this.choice('shotgun', 'Shotgun shot', ['a', 'b', 'synth'], () => s.shotgun, (v) => (s.shotgun = v as MoodSettings['shotgun']));
    this.slider('guns', 'Gunshots', 0, 2, 0.01, () => s.guns, (v) => (s.guns = v), (v) => (v < 0.01 ? 'off' : pct(v)));
    this.slider('gunEcho', 'Gunshot echo', 0, 1, 0.01, () => s.gunEcho, (v) => (s.gunEcho = v), (v) => (v < 0.01 ? 'dry' : pct(v)));
    this.slider('carDamp', 'In-car damping', 0, 1, 0.01, () => s.carDamp, (v) => (s.carDamp = v), (v) => (v < 0.01 ? 'none (as outside)' : pct(v)));
    this.slider('carRoof', 'Rain on car roof', 0, 2, 0.01, () => s.carRoof, (v) => (s.carRoof = v), (v) => (v < 0.01 ? 'off' : pct(v)));

    this.into = this.groups.graphics;
    this.choice('res', 'Resolution %', RESOLUTIONS, () => s.resolution, (v) => (s.resolution = v as Resolution));
    this.choice('mirror', 'Rear-view mirror', ['off', 'cockpit', 'all'], () => s.mirror, (v) => (s.mirror = v as MoodSettings['mirror']));
    this.choice('quality', 'Detail', QUALITIES, () => s.quality, (v) => (s.quality = v as Quality));
    this.choice('shadows', 'Lamp shadows', SHADOW_COUNTS.map(String), () => String(s.shadows), (v) => (s.shadows = Number(v)));
    this.slider('dof', 'Depth of field', 0, 1, 0.01, () => s.dof, (v) => (s.dof = v), (v) => (v < 0.01 ? 'off' : v.toFixed(2)));
    // Focus on a log scale (1 m to 300 m), or auto (the centre of the view).
    const toM = (v: number): number => Math.exp(Math.log(1) + v * (Math.log(300) - Math.log(1)));
    const fromM = (m: number): number => Math.log(m) / Math.log(300);
    this.slider('focus', 'Focus', 0, 1, 0.005, () => (s.focus === null ? -1 : fromM(s.focus)), (v) => (s.focus = toM(v)), (v) => (v < 0 ? 'auto (centre of view)' : `${toM(v) < 10 ? toM(v).toFixed(1) : Math.round(toM(v))} m`), () => (s.focus = null));
    this.note('Lamp shadows: each lamp costs ~1.5 ms a frame at night (its shadow map redraws in turn, not every frame; none by day). Changing the count recompiles shaders (a short pause). Resolution auto lowers the render resolution while frames run slow. Detail: how far full detail, traffic and people reach (high is the full city; medium and low for slower machines).');

    this.footer = document.createElement('div');
    const buttons = document.createElement('div');
    Object.assign(buttons.style, { display: 'flex', gap: '6px' });
    const button = (label: string, act: () => void): HTMLButtonElement => {
      const b = this.button(label);
      Object.assign(b.style, { padding: '5px' });
      b.addEventListener('click', act);
      buttons.append(b);
      return b;
    };
    button('reset settings', () => {
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
    // Which defaults "reset" goes back to, and a way to forget the saved ones.
    this.savedLine = document.createElement('div');
    Object.assign(this.savedLine.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: UI.dim, marginTop: '6px' });
    const savedText = document.createElement('span');
    const forget = this.button('use built-in');
    Object.assign(forget.style, { flex: '', padding: '1px 6px' });
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
    this.footer.append(buttons, this.savedLine);
    this.showSaved();
    this.refresh();
  }

  /** Shows whether "reset" goes to defaults saved in this browser or the built-in ones. */
  private showSaved(): void {
    const saved = savedDefaults() !== null;
    (this.savedLine.firstElementChild as HTMLElement).textContent = saved ? 'defaults: saved in this browser' : 'defaults: built-in';
    (this.savedLine.lastElementChild as HTMLElement).style.display = saved ? '' : 'none';
  }

  /** Shows the settings as they are (after something else changed them). */
  refresh(): void {
    for (const r of this.rows.values()) r();
  }

  private button(label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, { flex: '1', padding: '3px 0', background: UI.button, color: 'inherit', border: `1px solid ${UI.line}`, borderRadius: '5px', cursor: 'pointer', font: 'inherit' });
    return b;
  }

  private note(text: string): void {
    const note = document.createElement('div');
    note.textContent = text;
    Object.assign(note.style, { color: UI.dim, marginTop: '10px', lineHeight: '1.4' });
    this.into.append(note);
  }

  private row(label: string): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, { margin: '7px 0' });
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', color: UI.label, marginBottom: '3px' });
    const name = document.createElement('span');
    name.textContent = label;
    head.append(name);
    row.append(head);
    this.into.append(row);
    return row;
  }

  private slider(key: string, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, show: (v: number) => string, auto?: () => void): void {
    const row = this.row(label);
    const value = document.createElement('span');
    Object.assign(value.style, { color: UI.value });
    row.firstElementChild!.append(value);
    const line = document.createElement('div');
    Object.assign(line.style, { display: 'flex', gap: '6px', alignItems: 'center' });
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step) });
    Object.assign(input.style, { flex: '1', accentColor: UI.accent });
    input.addEventListener('input', () => {
      set(Number(input.value));
      value.textContent = show(Number(input.value));
      this.changed();
    });
    line.append(input);
    if (auto) {
      const b = this.button('auto');
      Object.assign(b.style, { flex: '', padding: '1px 6px' });
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
    Object.assign(line.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' });
    const buttons = options.map((o) => {
      const b = this.button(o);
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
      options.forEach((o, i) => Object.assign(buttons[i].style, { borderColor: o === v ? UI.accent : UI.line, background: o === v ? '#1f5a3c' : UI.button }));
    });
  }
}
