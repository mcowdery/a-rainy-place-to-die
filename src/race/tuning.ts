import type { Assists, Car, CarSpec } from './vehicle';

/**
 * Driving tuning, for testing (the race page's ` key; the district's debug menu, Car: tune driving): the handling
 * model's numbers as multipliers on your car's own (so every model keeps its character) and the assists set
 * outright, for the race venues (`drift`) and the city (`road`) apart. Kept in the browser (localStorage
 * `rainyplace.tuning`) and applied to your car on both pages; rivals and traffic stay stock. `TuningPanel` is the
 * panel: sliders by group with the value each gives your car, reset, copy as JSON (to bake a setup in), and a
 * live readout of what the car is doing.
 */

type NumKey = { [K in keyof CarSpec]-?: CarSpec[K] extends number | undefined ? K : never }[keyof CarSpec];
export interface Tuning {
  /** Multipliers on the spec (1: as the car comes). */
  readonly spec: Partial<Record<NumKey, number>>;
  /** Assists set outright, by where you drive. */
  readonly assists: { readonly drift?: Partial<Assists>; readonly road?: Partial<Assists> };
}
export type AssistContext = 'drift' | 'road';

const KEY = 'rainyplace.tuning';

export const EMPTY: Tuning = { spec: {}, assists: {} };

export function loadTuning(): Tuning {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Tuning | null;
    return t && typeof t === 'object' && t.spec && t.assists ? t : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveTuning(t: Tuning): void {
  try {
    if (!Object.keys(t.spec).length && !t.assists.drift && !t.assists.road) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* storage blocked */
  }
}

/** A spec with the tuning's multipliers. */
export function tunedBy(base: CarSpec, t: Tuning): CarSpec {
  const out: Record<string, unknown> = { ...base };
  for (const [k, m] of Object.entries(t.spec)) {
    const v = (base as unknown as Record<string, number | undefined>)[k];
    if (typeof m === 'number' && typeof v === 'number') out[k] = v * m;
    // (A turbo or AWD the car hasn't got can't be multiplied into being.)
  }
  return out as unknown as CarSpec;
}

/** Assists with the tuning's settings for where you drive. */
export function assistsBy(base: Assists, ctx: AssistContext, t: Tuning): Assists {
  return { ...base, ...(t.assists[ctx] ?? {}) };
}

/** Whether anything is tuned. */
export const isTuned = (t: Tuning): boolean => Object.values(t.spec).some((m) => m !== 1) || !!t.assists.drift || !!t.assists.road;

interface SpecSlider {
  readonly key: NumKey;
  readonly label: string;
  /** How to show the resulting value (and its unit). */
  readonly show: (v: number) => string;
  readonly hint: string;
}
const kmh = (v: number): string => `${Math.round(v * 3.6)} km/h`;
const GROUPS: readonly { readonly title: string; readonly sliders: readonly SpecSlider[] }[] = [
  {
    title: 'Engine',
    sliders: [
      { key: 'power', label: 'Power', show: (v) => `${Math.round(v / 735.5)} PS`, hint: 'top speed and pull at speed' },
      { key: 'maxDrive', label: 'Launch drive', show: (v) => `${Math.round(v)} N`, hint: 'shove off the line and out of slow corners; wheelspin' },
      { key: 'turbo', label: 'Turbo lag', show: (v) => `${v.toFixed(2)} s`, hint: 'time for the boost to build (turbo cars)' },
      { key: 'drag', label: 'Drag', show: (v) => v.toFixed(2), hint: 'air resistance: lower is a higher top speed' },
      { key: 'rolling', label: 'Rolling resistance', show: (v) => `${Math.round(v)} N`, hint: 'coasting slows the car' },
    ],
  },
  {
    title: 'Grip',
    sliders: [
      { key: 'gripFront', label: 'Front grip', show: (v) => v.toFixed(2), hint: 'more: turns in harder; less: understeer' },
      { key: 'gripRear', label: 'Rear grip', show: (v) => v.toFixed(2), hint: 'less: slides and drifts more easily' },
      { key: 'B', label: 'Tyre stiffness', show: (v) => v.toFixed(1), hint: 'how quickly grip builds with slip: sharper' },
      { key: 'C', label: 'Tyre shape', show: (v) => v.toFixed(2), hint: 'how grip falls away past its peak' },
      { key: 'lsd', label: 'LSD', show: (v) => v.toFixed(2), hint: 'rear holds its line while spinning' },
      { key: 'handbrakeGrip', label: 'Handbrake grip', show: (v) => v.toFixed(2), hint: 'rear grip left on the handbrake: less is a sharper flick' },
    ],
  },
  {
    title: 'Weight',
    sliders: [
      { key: 'mass', label: 'Mass', show: (v) => `${Math.round(v)} kg`, hint: 'heavier: slower to accelerate and brake' },
      { key: 'inertia', label: 'Yaw inertia', show: (v) => v.toFixed(2), hint: 'less: rotates quicker, twitchier' },
      { key: 'cgHeight', label: 'CG height', show: (v) => `${v.toFixed(2)} m`, hint: 'more weight transfer: lifting off rotates it' },
      { key: 'a', label: 'CG to front axle', show: (v) => `${v.toFixed(2)} m`, hint: 'longer: weight rearward, more oversteer' },
      { key: 'b', label: 'CG to rear axle', show: (v) => `${v.toFixed(2)} m`, hint: 'longer: weight forward, more understeer' },
    ],
  },
  {
    title: 'Brakes & steering',
    sliders: [
      { key: 'brake', label: 'Brakes', show: (v) => `${v.toFixed(2)} g`, hint: 'braking force' },
      { key: 'brakeFront', label: 'Brake bias', show: (v) => `${Math.round(v * 100)}% front`, hint: 'rearward: the tail steps out under braking' },
      { key: 'lock', label: 'Steering lock', show: (v) => `${Math.round((v * 180) / Math.PI)}°`, hint: 'full lock at a standstill' },
      { key: 'lockHalf', label: 'Lock at speed', show: (v) => `halved at ${kmh(v)}`, hint: 'higher: more lock at speed' },
      { key: 'steerRate', label: 'Steering speed', show: (v) => `${v.toFixed(1)} rad/s`, hint: 'how fast the wheel turns' },
    ],
  },
];
const ASSISTS: readonly { readonly key: keyof Assists; readonly label: string; readonly min: number; readonly max: number; readonly step: number; readonly deg?: boolean; readonly hint: string }[] = [
  { key: 'countersteer', label: 'Countersteer', min: 0, max: 1.5, step: 0.01, hint: 'the car steers into its own slide' },
  { key: 'maxSlide', label: 'Slide cap', min: 10, max: 90, step: 1, deg: true, hint: 'the most it slides before it is held (no spins)' },
  { key: 'maxYaw', label: 'Yaw cap', min: 1, max: 6, step: 0.05, hint: 'fastest it rotates (rad/s)' },
  { key: 'traction', label: 'Traction help', min: 0, max: 1, step: 0.01, hint: 'the throttle alone won’t spin a gripping car' },
];

/** The tuning panel: `open` it with the car it tunes; `onChange` applies a new tuning (the page re-specs the car). */
export class TuningPanel {
  open = false;
  private readonly root: HTMLDivElement;
  private readonly read: HTMLDivElement;
  private t: Tuning;
  private car: Car | null = null;
  private base: CarSpec | null = null;
  private assistBase: Assists | null = null;

  constructor(
    private readonly ctx: AssistContext,
    private readonly onChange: (t: Tuning) => void,
  ) {
    this.t = loadTuning();
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed', top: '10px', left: '10px', bottom: '10px', width: '380px', zIndex: '60', display: 'none', overflowY: 'auto',
      background: 'rgba(10, 12, 16, 0.95)', color: '#dfe6e2', border: '1px solid #3a4a60', borderRadius: '8px',
      padding: '10px 12px', font: "12px 'Consolas', monospace", boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
    });
    this.read = document.createElement('div');
    Object.assign(this.read.style, { background: '#161c24', borderRadius: '6px', padding: '6px 8px', margin: '6px 0 8px', lineHeight: '1.5', fontVariantNumeric: 'tabular-nums' });
    document.body.append(this.root);
    // Clicks in the panel stay there (they don't capture the mouse for driving); the keys go on to the car.
    for (const ev of ['click', 'mousedown', 'pointerdown', 'mouseup']) this.root.addEventListener(ev, (e) => e.stopPropagation());
  }

  get tuning(): Tuning {
    return this.t;
  }

  /** Opens (or refreshes) the panel for a car: its untuned spec and assists. */
  show(car: Car, base: CarSpec, assistBase: Assists): void {
    this.car = car;
    this.base = base;
    this.assistBase = assistBase;
    this.open = true;
    this.root.style.display = 'block';
    this.draw();
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }

  /** The live readout (call each frame while open). */
  tick(): void {
    const c = this.car;
    if (!this.open || !c) return;
    const g = 9.81;
    this.read.innerHTML = `<b>${kmh(c.speed)}</b> · gear ${c.gear} · revs ${Math.round(c.rev * 100)}%${c.spec.turbo ? ` · boost ${Math.round(c.boost * 100)}%` : ''}<br>slide ${Math.round((c.slide * 180) / Math.PI)}° · yaw ${c.r.toFixed(2)} rad/s · steer ${Math.round((c.steer * 180) / Math.PI)}°<br>lat ${(c.ay / g).toFixed(2)} g · long ${(c.ax / g).toFixed(2)} g · wheelspin ${Math.round(c.spin * 100)}%${c.handbrake ? ' · HANDBRAKE' : ''}`;
  }

  private set(t: Tuning): void {
    this.t = t;
    saveTuning(t);
    this.onChange(t);
  }

  private draw(): void {
    const base = this.base!;
    const r = this.root;
    r.replaceChildren();
    const head = document.createElement('div');
    head.innerHTML = `<b style="color:#8ac8ff;letter-spacing:.1em">DRIVING TUNING</b> <span style="opacity:.6">· ${this.ctx === 'drift' ? 'race venues' : 'the city'} · your car only</span>`;
    const bar = document.createElement('div');
    Object.assign(bar.style, { display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '6px 0' });
    const btn = (label: string, fn: () => void): void => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, { background: '#1e2430', color: 'inherit', border: '1px solid #3a4a60', borderRadius: '5px', padding: '3px 8px', font: 'inherit', cursor: 'pointer' });
      b.onclick = fn;
      bar.append(b);
    };
    btn('reset all', () => {
      this.set(EMPTY);
      this.draw();
    });
    btn('copy settings', () => {
      const text = JSON.stringify(this.t, null, 1);
      navigator.clipboard?.writeText(text).catch(() => undefined);
      prompt('Tuning (copied):', text);
    });
    btn('close', () => this.hide());
    r.append(head, bar, this.read);
    const slider = (label: string, value: number, min: number, max: number, step: number, show: (v: number) => string, hint: string, changed: boolean, set: (v: number) => void): HTMLDivElement => {
      const row = document.createElement('div');
      Object.assign(row.style, { margin: '5px 0' });
      const top = document.createElement('div');
      Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', gap: '6px' });
      const name = document.createElement('span');
      name.textContent = label;
      name.title = hint;
      if (changed) name.style.color = '#ffd27a';
      const val = document.createElement('span');
      val.style.opacity = '0.85';
      val.textContent = show(value);
      top.append(name, val);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      Object.assign(input.style, { width: '100%', accentColor: changed ? '#ffb040' : '#6aa8e8' });
      input.oninput = () => {
        const v = Number(input.value);
        val.textContent = show(v);
        set(v);
      };
      // (Let go: the keys go back to driving.)
      input.onchange = () => input.blur();
      input.ondblclick = () => {
        set(NaN);
        this.draw();
      };
      row.append(top, input);
      return row;
    };
    for (const g of GROUPS) {
      const h = document.createElement('div');
      h.textContent = g.title.toUpperCase();
      Object.assign(h.style, { opacity: '0.55', letterSpacing: '0.12em', marginTop: '10px', fontSize: '11px' });
      r.append(h);
      for (const s of g.sliders) {
        const v0 = (base as unknown as Record<string, number | undefined>)[s.key];
        // (Only what the car has: no turbo, no LSD, nothing to multiply.)
        if (typeof v0 !== 'number' || v0 === 0) continue;
        const m = this.t.spec[s.key] ?? 1;
        r.append(slider(s.label, m, 0.3, 2.5, 0.01, (x) => `×${x.toFixed(2)} → ${s.show(v0 * x)}`, s.hint, m !== 1, (x) => {
          const spec = { ...this.t.spec };
          if (Number.isNaN(x) || Math.abs(x - 1) < 0.005) delete spec[s.key];
          else spec[s.key] = x;
          this.set({ ...this.t, spec });
        }));
      }
    }
    const h = document.createElement('div');
    h.textContent = `ASSISTS (${this.ctx === 'drift' ? 'race venues' : 'the city'})`;
    Object.assign(h.style, { opacity: '0.55', letterSpacing: '0.12em', marginTop: '10px', fontSize: '11px' });
    r.append(h);
    const ab = this.assistBase!;
    for (const a of ASSISTS) {
      const own = this.t.assists[this.ctx]?.[a.key];
      const v = own ?? ab[a.key];
      const toUi = (x: number): number => (a.deg ? (x * 180) / Math.PI : x);
      const fromUi = (x: number): number => (a.deg ? (x * Math.PI) / 180 : x);
      r.append(slider(a.label, toUi(v), a.min, a.max, a.step, (x) => (a.deg ? `${Math.round(x)}°` : x.toFixed(2)), a.hint, own !== undefined, (x) => {
        const cur: Record<string, number> = { ...(this.t.assists[this.ctx] ?? {}) };
        if (Number.isNaN(x)) delete cur[a.key];
        else cur[a.key] = fromUi(x);
        this.set({ ...this.t, assists: { ...this.t.assists, [this.ctx]: Object.keys(cur).length ? cur : undefined } });
      }));
    }
    const foot = document.createElement('div');
    foot.textContent = 'Hover a name for what it does · double-click a slider to reset it · kept in this browser, for both pages';
    Object.assign(foot.style, { opacity: '0.5', marginTop: '10px' });
    r.append(foot);
  }
}
