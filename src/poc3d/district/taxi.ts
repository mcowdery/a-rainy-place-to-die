import type { Destination } from './travel';

/**
 * Taxis: wave one down at the kerb (hold T), it pulls in; E gets you in the back, and you tell the driver
 * where to (a list of the city's places, with the fare on the meter: ¥500 flag fall for the first 1.1 km, then
 * ¥100 a 255 m, the fare charts of Tokyo in the 90s; +20% late at night). The ride: the back seat, the city
 * going by (sped up), the meter ticking; E skips to the end. You pay from your yen (race/profile.ts); if you're
 * short, the driver takes what you have.
 */

export const FARE = { flag: 500, flagKm: 1.1, step: 100, stepM: 255, night: 1.2 } as const;

/** The fare for a ride of `metres`, by day or late at night. */
export function fare(metres: number, late: boolean): number {
  const km = metres / 1000;
  let f: number = FARE.flag;
  if (km > FARE.flagKm) f += Math.ceil(((km - FARE.flagKm) * 1000) / FARE.stepM) * FARE.step;
  return Math.round((f * (late ? FARE.night : 1)) / 10) * 10;
}

/** How far a taxi goes to get there: along the grid's streets (the Manhattan distance), plus a little for the corners. */
export const rideMetres = (ax: number, az: number, bx: number, bz: number): number => (Math.abs(bx - ax) + Math.abs(bz - az)) * 1.08 + 60;

/** The list of where to: places by name, their distance and fare. */
export class TaxiPicker {
  readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private choose: ((d: Destination) => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(4, 4, 10, 0.72)', zIndex: '20', font: "13px 'Consolas', monospace", color: '#e8e6f0',
    } satisfies Partial<CSSStyleDeclaration>);
    this.list = document.createElement('div');
    Object.assign(this.list.style, { width: 'min(620px, 92vw)', maxHeight: '84vh', overflowY: 'auto', background: '#0c0c14', border: '1px solid #3a3850', padding: '14px 16px' });
    this.root.append(this.list);
    this.root.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === this.root) this.hide();
    });
    document.body.append(this.root);
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  show(from: { x: number; z: number }, places: readonly Destination[], wallet: number, late: boolean, choose: (d: Destination) => void): void {
    this.choose = choose;
    this.list.replaceChildren();
    const title = document.createElement('div');
    title.textContent = `TAXI · どちらまで? Where to? · you have ¥${wallet.toLocaleString('en-US')}${late ? ' · late-night fares (+20%)' : ''} · Esc to stay`;
    Object.assign(title.style, { color: '#ffd34f', marginBottom: '10px', letterSpacing: '1px' });
    this.list.append(title);
    const rows = places
      .map((d) => ({ d, m: rideMetres(from.x, from.z, d.x, d.z) }))
      .filter(({ m }) => m > 250)
      .sort((a, b) => (a.d.group === b.d.group ? a.d.name.localeCompare(b.d.name) : a.d.group === 'Zones' ? -1 : 1));
    let group = '';
    for (const { d, m } of rows) {
      if (d.group !== group) {
        group = d.group;
        const h = document.createElement('div');
        h.textContent = group === 'Zones' ? 'Districts' : 'Places';
        Object.assign(h.style, { color: '#c8c6d8', margin: '12px 0 6px' });
        this.list.append(h);
      }
      const btn = document.createElement('button');
      const f = fare(m, late);
      btn.textContent = d.name;
      const note = document.createElement('span');
      note.textContent = `${(m / 1000).toFixed(1)} km · ~¥${f.toLocaleString('en-US')}`;
      Object.assign(note.style, { float: 'right', color: f > wallet ? '#ff6a78' : '#8a88a0' });
      btn.append(note);
      Object.assign(btn.style, { display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', margin: '2px 0', background: '#14141e', border: '1px solid #26243a', color: '#e8e6f0', font: 'inherit', cursor: 'pointer' });
      btn.addEventListener('click', () => {
        const c = this.choose;
        this.hide();
        c?.(d);
      });
      this.list.append(btn);
    }
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.choose = null;
  }
}
