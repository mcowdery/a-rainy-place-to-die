import { clockAt, clockLabel, DAY, hhmm, TIMES_OF_DAY, untilMinute, type DayLight, type NamedTime } from './clock';

/**
 * Waiting (T, like Skyrim's): a small panel to let time pass, by hours or until a time of day (the story's scenes
 * often want a time: morning, noon, evening, night, late after the last train), or until sunrise or sunset (the
 * season's: clock.ts DAYLIGHT). Picking one fades out, runs the clock on, fades back in (main.ts waitFor). 1-9 and 0
 * pick, Esc closes.
 */
type Named = NamedTime | 'sunrise' | 'sunset';
const NAMED: readonly [Named, string][] = [
  ['sunrise', 'Sunrise 日の出'],
  ['morning', 'Morning 朝'],
  ['noon', 'Noon 昼'],
  ['sunset', 'Sunset 日没'],
  ['evening', 'Evening 夕方'],
  ['night', 'Night 夜'],
  ['late', 'Late night 深夜'],
];

export class WaitPanel {
  open = false;
  private readonly root: HTMLDivElement;
  private readonly now: HTMLDivElement;
  private choices: { label: () => string; minutes: () => number }[] = [];
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(
    private readonly clock: () => number,
    private readonly pick: (minutes: number) => void,
    /** The season's sunrise and sunset. */
    private readonly daylight: () => DayLight,
  ) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: '40', display: 'none',
      background: 'rgba(12, 12, 20, 0.92)', color: '#e8e4f0', border: '1px solid #4a4460', borderRadius: '10px',
      padding: '16px 18px', font: "14px 'Segoe UI', 'Yu Gothic', sans-serif", minWidth: '280px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
    });
    const title = document.createElement('div');
    title.textContent = '待つ WAIT';
    Object.assign(title.style, { fontWeight: '700', letterSpacing: '0.12em', marginBottom: '4px' });
    this.now = document.createElement('div');
    Object.assign(this.now.style, { opacity: '0.75', marginBottom: '12px' });
    this.root.append(title, this.now);
    const hours = [1, 3, 6];
    const at = (k: Named): number => (k === 'sunrise' ? this.daylight().rise : k === 'sunset' ? this.daylight().set : TIMES_OF_DAY[k]);
    this.choices = [
      ...hours.map((h) => ({ label: () => `${h} hour${h > 1 ? 's' : ''}`, minutes: () => h * 60 })),
      ...NAMED.map(([k, label]) => ({ label: () => `${label} · ${hhmm(at(k))}`, minutes: () => untilMinute(this.clock(), at(k)) })),
    ];
    const list = document.createElement('div');
    Object.assign(list.style, { display: 'grid', gap: '6px' });
    this.choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.textContent = `${(i + 1) % 10}  ${c.label()}`;
      this.buttons.push(b);
      Object.assign(b.style, {
        textAlign: 'left', background: '#221e30', color: 'inherit', border: '1px solid #3a3450', borderRadius: '6px',
        padding: '7px 10px', font: 'inherit', cursor: 'pointer',
      });
      b.addEventListener('click', () => this.choose(i));
      list.append(b);
    });
    const hint = document.createElement('div');
    hint.textContent = '1-9, 0 to choose · Esc to close';
    Object.assign(hint.style, { opacity: '0.55', fontSize: '12px', marginTop: '10px' });
    this.root.append(list, hint);
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Escape' || e.code === 'KeyT') {
        this.hide();
        e.stopImmediatePropagation();
        return;
      }
      const n = e.key === '0' ? 10 : Number(e.key);
      if (n >= 1 && n <= this.choices.length) {
        this.choose(n - 1);
        e.stopImmediatePropagation();
      }
    }, true);
  }

  show(): void {
    this.now.textContent = `Now: ${clockLabel(clockAt(this.clock()))}`;
    // (Sunrise and sunset move with the season.)
    this.buttons.forEach((b, i) => (b.textContent = `${(i + 1) % 10}  ${this.choices[i].label()}`));
    this.root.style.display = 'block';
    this.open = true;
  }

  hide(): void {
    this.root.style.display = 'none';
    this.open = false;
  }

  private choose(i: number): void {
    const m = this.choices[i].minutes();
    this.hide();
    this.pick(Math.min(DAY, m));
  }
}
