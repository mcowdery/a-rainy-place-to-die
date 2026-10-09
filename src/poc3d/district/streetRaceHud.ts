import * as THREE from 'three';
import type { StreetRaceDef, StreetRaceState } from './streetRace';
import { money } from '../../money';

/**
 * The street race's screens (district/streetRace.ts): the marshal's challenge (the races on offer, 1-9 to pick, Esc
 * to leave it), the countdown, the standings down the left (place, name, gates or the gap), the line at the top (the
 * clock, your place, the next gate's distance), a flash at each gate and each knock-out, a name over every rival in
 * sight (off the edge: no arrow, they are on the list), and the results (Enter or Esc to close).
 */
const clock = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const yen = (n: number): string => money(n);
const ord = (n: number): string => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

export interface RaceMark {
  readonly name: string;
  readonly at: THREE.Vector3;
  readonly dist: number;
  readonly place: number;
  readonly armed: boolean;
  readonly out: string | null;
}

export class StreetRaceHud {
  private readonly card: HTMLDivElement;
  private readonly top: HTMLDivElement;
  private readonly big: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private readonly hurt: HTMLDivElement;
  private readonly marks: HTMLDivElement[] = [];
  private flashT = 0;
  private hurtT = 0;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private readonly v = new THREE.Vector3();
  open = false;

  constructor() {
    const box = (css: Partial<CSSStyleDeclaration>): HTMLDivElement => {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'fixed', zIndex: '40', display: 'none', color: '#f0ecf8', fontFamily: "'Segoe UI', sans-serif", pointerEvents: 'none', ...css });
      document.body.append(d);
      return d;
    };
    this.card = box({ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(10, 10, 18, 0.94)', border: '1px solid #5a4a70', borderRadius: '10px', padding: '18px 20px', minWidth: '380px', maxWidth: '520px', fontSize: '14px', boxShadow: '0 10px 40px rgba(0,0,0,0.55)', pointerEvents: 'auto' });
    this.top = box({ left: '50%', top: '50px', transform: 'translateX(-50%)', background: 'rgba(8, 8, 14, 0.7)', borderRadius: '8px', padding: '6px 16px', fontSize: '16px', fontWeight: '600', letterSpacing: '0.04em', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' });
    this.big = box({ left: '50%', top: '38%', transform: 'translate(-50%, -50%)', fontSize: '96px', fontWeight: '900', textShadow: '0 0 24px rgba(255, 150, 60, 0.85)' });
    this.list = box({ left: '16px', top: '50px', fontSize: '13px', fontVariantNumeric: 'tabular-nums', textShadow: '0 1px 4px #000', background: 'rgba(8, 8, 14, 0.55)', borderRadius: '8px', padding: '6px 10px', lineHeight: '1.5' });
    this.flashEl = box({ left: '50%', top: '22%', transform: 'translateX(-50%)', fontSize: '22px', fontWeight: '800', textShadow: '0 2px 10px rgba(0,0,0,0.8)' });
    this.hurt = box({ inset: '0', zIndex: '39', background: 'radial-gradient(ellipse at center, rgba(255,40,50,0) 45%, rgba(255,40,50,0.55) 100%)', opacity: '0' });
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

  /** The marshal's challenge: the races on offer. */
  challenge(host: string, races: readonly StreetRaceDef[], carName: string, wrecked: boolean, pick: (r: StreetRaceDef) => void): void {
    const lines = races.map(
      (r, i) => `<div style="margin:10px 0;padding:8px 10px;border:1px solid #3a3050;border-radius:6px;background:#1a1626">
        <div style="font-weight:700">${i + 1} · ${r.name} <span style="opacity:.6;font-weight:400">· ${r.field.length + 1} cars · ${r.points.length - 1} gates${r.laps > 1 ? ` × ${r.laps}` : ''}</span></div>
        <div style="opacity:.75;margin:3px 0">${r.blurb}</div>
        <div style="opacity:.85">${r.field.filter((f) => f.gunman).length} armed · 1st ${yen(r.pay[0] ?? 0)}</div></div>`,
    );
    this.card.innerHTML = `<div style="font-weight:800;letter-spacing:.1em">${host}</div>
      <div style="opacity:.7;margin-top:2px">"Street race. No rules, no map but the gates: find your own way. Some of them carry guns."</div>${lines.join('')}
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

  flash(text: string, color = '#ffffff', seconds = 2): void {
    this.flashEl.textContent = text;
    this.flashEl.style.color = color;
    this.flashT = seconds;
  }

  /** A hit on you. */
  hit(): void {
    this.hurtT = 0.35;
  }

  clear(): void {
    this.top.style.display = this.big.style.display = this.list.style.display = this.flashEl.style.display = 'none';
    this.hurt.style.opacity = '0';
    for (const m of this.marks) m.style.display = 'none';
    this.closeCard();
  }

  /** Each frame: `toGate` is the metres from you to your next gate (null once you've finished). */
  update(dt: number, st: StreetRaceState | null, def: StreetRaceDef | null, marks: readonly RaceMark[], camera: THREE.Camera, toGate: number | null): void {
    this.flashT = Math.max(0, this.flashT - dt);
    this.flashEl.style.display = this.flashT > 0 ? 'block' : 'none';
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.hurt.style.display = this.hurtT > 0 ? 'block' : 'none';
    this.hurt.style.opacity = String(Math.min(1, this.hurtT * 3));
    if (!st || !def) {
      this.top.style.display = this.big.style.display = this.list.style.display = 'none';
      for (const m of this.marks) m.style.display = 'none';
      return;
    }
    const stand = st.standings();
    const me = stand.find((s) => s.who === 0)!;
    this.top.style.display = 'block';
    const left = toGate === null ? '' : ` · gate ${Math.min(st.passed[0] + 1, st.goals.length)}/${st.goals.length} · ${toGate >= 1000 ? `${(toGate / 1000).toFixed(2)} km` : `${Math.round(toGate)} m`}`;
    this.top.innerHTML = `${def.name} · ${clock(st.t)} · <span style="color:${me.place === 1 ? '#7cffb0' : '#ffe9a8'}">${ord(me.place)}</span> of ${st.names.length}${left}`;
    this.list.style.display = 'block';
    this.list.innerHTML = stand
      .map((s) => {
        const mine = s.who === 0;
        const note = s.out ? `<span style="color:#ff8a8a">${s.out}</span>` : s.finished !== null ? clock(s.finished) : `${s.gates}/${st.goals.length}`;
        return `<div style="${mine ? 'color:#ffe9a8;font-weight:800' : ''}">${s.place} · ${st.names[s.who]} <span style="opacity:.7;float:right;margin-left:14px">${note}</span></div>`;
      })
      .join('');
    if (st.phase === 'countdown') {
      this.big.style.display = 'block';
      this.big.textContent = String(Math.max(1, Math.ceil(st.countdown - 0.5)));
    } else if (st.phase === 'running' && st.t < 0.8) {
      this.big.style.display = 'block';
      this.big.textContent = 'GO';
    } else this.big.style.display = 'none';
    // The names over the rivals in sight.
    while (this.marks.length < marks.length) {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'fixed', zIndex: '38', display: 'none', color: '#fff', fontFamily: "'Segoe UI', sans-serif", fontSize: '12px', fontWeight: '700', textShadow: '0 1px 4px #000', pointerEvents: 'none', transform: 'translate(-50%, -100%)', whiteSpace: 'nowrap' });
      document.body.append(d);
      this.marks.push(d);
    }
    this.marks.forEach((el, i) => {
      const m = marks[i];
      if (!m || m.out || m.dist > 170) return void (el.style.display = 'none');
      this.v.copy(m.at).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1 || Math.abs(this.v.y) > 1) return void (el.style.display = 'none');
      el.style.display = 'block';
      el.style.left = `${((this.v.x + 1) / 2) * window.innerWidth}px`;
      el.style.top = `${((1 - this.v.y) / 2) * window.innerHeight}px`;
      el.style.opacity = String(Math.max(0.35, 1 - m.dist / 200));
      el.innerHTML = `<span style="color:${m.armed ? '#ff8a8a' : '#ffe9a8'}">${ord(m.place)}</span> ${m.name}${m.armed ? ' <span style="color:#ff6a6a">▲</span>' : ''} <span style="opacity:.7">${Math.round(m.dist)} m</span>`;
    });
  }

  /** The results: every racer's place and time, your pay; `again` restarts, `done` closes. */
  result(st: StreetRaceState, def: StreetRaceDef, pay: number, again: () => void, done: () => void): void {
    const stand = st.standings();
    const me = stand.find((s) => s.who === 0)!;
    const win = me.place === 1 && !me.out;
    const first = stand.find((s) => s.finished !== null);
    const rows = stand
      .map((s) => {
        const t = s.out ? `<span style="color:#ff8a8a">${s.out}</span>` : s.finished !== null ? (first && s.who !== first.who && first.finished !== null ? `+${(s.finished - first.finished).toFixed(2)} s` : clock(s.finished)) : 'still racing';
        return `<div style="display:flex;justify-content:space-between;gap:24px;${s.who === 0 ? 'color:#ffe9a8;font-weight:800' : ''}"><span>${s.place} · ${st.names[s.who]}</span><span style="opacity:.85">${t}</span></div>`;
      })
      .join('');
    const title = me.out ? 'OUT OF THE RACE' : win ? 'YOU WIN' : `${ord(me.place).toUpperCase()} PLACE`;
    this.card.innerHTML = `<div style="font-size:30px;font-weight:900;color:${win ? '#7cffb0' : me.out ? '#ff8a8a' : '#ffe9a8'}">${title}</div>
      <div style="opacity:.8;margin:4px 0 12px">${def.name}${me.out ? ` · ${me.out}` : ''}</div>${rows}
      <div style="margin-top:10px;font-weight:700">+ ${yen(pay)}</div>
      <div style="opacity:.6;font-size:12px;margin-top:10px">Enter: again · Esc: done</div>`;
    this.card.style.display = 'block';
    this.open = true;
    this.keys((e) => {
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      this.closeCard();
      if (e.code === 'Enter') again();
      else done();
    });
  }
}
