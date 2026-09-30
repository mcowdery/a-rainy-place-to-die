import type { RaceDef, RaceState } from './cityRace';

/**
 * The city race's screens (district/cityRace.ts): the host's challenge (the races on offer, 1-9 to pick, Esc to
 * leave it), the countdown, the race line at the top (time, 1ST or 2ND, the gap, the distance left), a flash at each
 * checkpoint, and the result (Enter or Esc to close).
 */
const clock = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

export class RaceHud {
  private readonly card: HTMLDivElement;
  private readonly top: HTMLDivElement;
  private readonly big: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private flashT = 0;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  open = false;

  constructor() {
    const box = (css: Partial<CSSStyleDeclaration>): HTMLDivElement => {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'fixed', zIndex: '40', display: 'none', color: '#f0ecf8', fontFamily: "'Segoe UI', 'Yu Gothic', sans-serif", ...css });
      document.body.append(d);
      return d;
    };
    this.card = box({ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(10, 10, 18, 0.94)', border: '1px solid #5a4a70', borderRadius: '10px', padding: '18px 20px', minWidth: '340px', maxWidth: '480px', fontSize: '14px', boxShadow: '0 10px 40px rgba(0,0,0,0.55)' });
    this.top = box({ left: '50%', top: '14px', transform: 'translateX(-50%)', background: 'rgba(8, 8, 14, 0.7)', borderRadius: '8px', padding: '6px 16px', fontSize: '16px', fontWeight: '600', letterSpacing: '0.04em', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' });
    this.big = box({ left: '50%', top: '38%', transform: 'translate(-50%, -50%)', fontSize: '96px', fontWeight: '900', textShadow: '0 0 24px rgba(255, 80, 160, 0.8)' });
    this.flashEl = box({ left: '50%', top: '22%', transform: 'translateX(-50%)', fontSize: '22px', fontWeight: '800', textShadow: '0 2px 10px rgba(0,0,0,0.8)' });
  }

  private keys(fn: ((e: KeyboardEvent) => void) | null): void {
    if (this.onKey) window.removeEventListener('keydown', this.onKey, true);
    this.onKey = fn;
    if (fn) window.addEventListener('keydown', fn, true);
  }

  private closeCard(): void {
    this.card.style.display = 'none';
    this.open = false;
    this.keys(null);
  }

  /** The host's challenge: the races on offer. */
  challenge(host: string, races: readonly RaceDef[], carName: string, wrecked: boolean, pick: (r: RaceDef) => void): void {
    const lines = races.map((r, i) => {
      const dist = r.length === 'lap' ? `${r.laps} lap${r.laps > 1 ? 's' : ''}` : `${(r.length / 1000).toFixed(1)} km`;
      return `<div style="margin:10px 0;padding:8px 10px;border:1px solid #3a3050;border-radius:6px;background:#1a1626">
        <div style="font-weight:700">${i + 1} · ${r.name} <span style="opacity:.6;font-weight:400">· ${dist}</span></div>
        <div style="opacity:.75;margin:3px 0">${r.blurb}</div>
        <div style="opacity:.85">vs ${r.rival.name} · win ¥${r.pay.win.toLocaleString('en-US')}</div></div>`;
    });
    this.card.innerHTML = `<div style="font-weight:800;letter-spacing:.1em">${host}</div>
      <div style="opacity:.7;margin-top:2px">"Want to run? Pick one."</div>${lines.join('')}
      <div style="opacity:.6;font-size:12px;margin-top:8px">${wrecked ? '<span style="color:#ff7a7a">Your car is wrecked: the garage first.</span>' : `Your car: ${carName}`} · 1-${races.length} to race · Esc: not now</div>`;
    this.card.style.display = 'block';
    this.open = true;
    this.keys((e) => {
      e.stopImmediatePropagation();
      if (e.code === 'Escape') return this.closeCard();
      const n = Number(e.key);
      if (!wrecked && n >= 1 && n <= races.length) {
        this.closeCard();
        pick(races[n - 1]);
      }
    });
  }

  /** The line at the top, and the countdown in the middle. */
  update(dt: number, st: RaceState | null, name: string): void {
    this.flashT = Math.max(0, this.flashT - dt);
    this.flashEl.style.display = this.flashT > 0 ? 'block' : 'none';
    if (!st) {
      this.top.style.display = 'none';
      this.big.style.display = 'none';
      return;
    }
    this.top.style.display = 'block';
    const gap = st.you - st.rival;
    const pos = st.leading ? '<span style="color:#7cffb0">1ST</span>' : '<span style="color:#ff8a8a">2ND</span>';
    const left = Math.max(0, st.path.length - st.you);
    this.top.innerHTML = `${name} · ${clock(st.t)} · ${pos} · ${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(0)} m · ${(left / 1000).toFixed(2)} km to go`;
    if (st.phase === 'countdown') {
      this.big.style.display = 'block';
      this.big.textContent = String(Math.max(1, Math.ceil(st.countdown - 0.5)));
    } else if (st.phase === 'racing' && st.t < 0.8) {
      this.big.style.display = 'block';
      this.big.textContent = 'GO';
    } else this.big.style.display = 'none';
  }

  flash(text: string, color = '#ffffff'): void {
    this.flashEl.textContent = text;
    this.flashEl.style.color = color;
    this.flashT = 2.2;
  }

  /** The result card; close() when it's dismissed. */
  result(st: RaceState, pay: number, rivalName: string, close: () => void): void {
    const r = st.result!;
    const t = (x: number | null): string => (x === null ? '—' : clock(x));
    this.card.innerHTML = `<div style="font-size:30px;font-weight:900;color:${r.won ? '#7cffb0' : '#ff8a8a'}">${r.won ? 'YOU WIN' : 'YOU LOSE'}</div>
      <div style="opacity:.8;margin:4px 0 12px">${r.why}</div>
      <div>You · ${t(r.you)}</div><div>${rivalName} · ${t(r.rival)}</div>
      <div style="margin-top:10px;font-weight:700">+ ¥${pay.toLocaleString('en-US')}</div>
      <div style="opacity:.6;font-size:12px;margin-top:10px">Enter or Esc</div>`;
    this.card.style.display = 'block';
    this.open = true;
    this.keys((e) => {
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      this.closeCard();
      close();
    });
  }
}
