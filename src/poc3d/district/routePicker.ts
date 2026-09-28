import { rideSeconds } from '../real/subway';
import { subwayRoute, type SubwayNet3 } from './subway';

/**
 * Where to? The list you get pressing E on a subway platform: every station on every line, with how to
 * get there from here (stops, changes, roughly how long). Choosing one starts the ride; Esc closes.
 */
export class RoutePicker {
  readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private here: string | null = null;
  private choose: ((to: string) => void) | null = null;

  constructor(private readonly net: SubwayNet3) {
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

  show(here: string, choose: (to: string) => void): void {
    this.here = here;
    this.choose = choose;
    this.render();
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.choose = null;
  }

  private render(): void {
    const net = this.net;
    const here = net.stops.get(this.here!)!;
    const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
    this.list.replaceChildren();
    const title = document.createElement('div');
    title.textContent = `SUBWAY · from ${here.jp} ${here.en} (${here.code}) · Esc to close`;
    Object.assign(title.style, { color: '#ff8ad8', marginBottom: '10px', letterSpacing: '1px' });
    this.list.append(title);
    for (const line of net.lines) {
      const h = document.createElement('div');
      Object.assign(h.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '12px 0 6px', color: '#c8c6d8' });
      const chip = document.createElement('span');
      chip.textContent = line.letter;
      Object.assign(chip.style, { display: 'inline-block', width: '22px', height: '22px', lineHeight: '22px', textAlign: 'center', borderRadius: '50%', border: `3px solid ${hex(line.color)}`, background: '#fff', color: '#111', fontWeight: 'bold' });
      h.append(chip, document.createTextNode(`${line.name}  ${line.nameEn}`));
      this.list.append(h);
      for (const s of line.stops) {
        const btn = document.createElement('button');
        const route = subwayRoute(net, here.key, s.key);
        let info = 'you are here';
        if (s.key === here.key || (route?.length === 1 && route[0].kind === 'transfer')) info = s.key === here.key ? 'you are here' : 'change here (same station)';
        else if (route) {
          const rides = route.filter((l) => l.kind === 'ride');
          const stops = rides.reduce((n, l) => n + (l.kind === 'ride' ? Math.abs(l.to - l.from) : 0), 0);
          const secs = rides.reduce((t, l) => t + (l.kind === 'ride' ? rideSeconds(net.lines.find((x) => x.id === l.line)!, l.from, l.to) : 0), 0) + 60 * (route.length - rides.length);
          const change = route.find((l) => l.kind === 'transfer');
          info = `${stops} stop${stops === 1 ? '' : 's'} · ~${Math.max(1, Math.round(secs / 60))} min${change && change.kind === 'transfer' ? ` · change at ${net.stops.get(change.from)!.jp}` : ''}`;
        } else info = 'no route';
        const go = s.key !== here.key && route !== null && route.some((l) => l.kind === 'ride');
        btn.textContent = `${s.code}  ${s.jp}  ${s.en}`;
        const note = document.createElement('span');
        note.textContent = info;
        Object.assign(note.style, { float: 'right', color: go ? '#8a88a0' : '#5a5870' });
        btn.append(note);
        Object.assign(btn.style, {
          display: 'block', width: '100%', textAlign: 'left', margin: '2px 0', padding: '6px 8px', background: go ? '#1a1a28' : '#12121a',
          color: go ? '#e8e6f0' : '#6a6880', border: '1px solid #2e2c44', cursor: go ? 'pointer' : 'default', font: 'inherit',
        });
        if (go) {
          btn.addEventListener('mouseenter', () => (btn.style.borderColor = hex(line.color)));
          btn.addEventListener('mouseleave', () => (btn.style.borderColor = '#2e2c44'));
          btn.addEventListener('click', () => {
            const f = this.choose;
            this.hide();
            f?.(s.key);
          });
        }
        this.list.append(btn);
      }
    }
  }
}
