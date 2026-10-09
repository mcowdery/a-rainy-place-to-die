import * as THREE from 'three';
import type { ChaseState } from './chase';

/**
 * A chase's screens (district/chase.ts): the countdown, the line at the
 * top (the job, the clock, what's left to do), each chase car's name, health and distance down the right with a
 * marker over it on the screen (off the edge: an arrow at the edge), your own health, a red flash when you're hit, a
 * word on each of your hits, and the result (Enter again, Esc done).
 */
const clock = (t: number): string => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
const yen = (n: number): string => `¥${n.toLocaleString('en-US')}`;

export interface ChaseMark {
  readonly name: string;
  readonly at: THREE.Vector3;
  readonly dist: number;
  readonly health: number;
  readonly max: number;
  readonly out: string | null;
  readonly gunman: boolean;
  readonly armed: boolean;
  readonly tyres: number;
}

export class ChaseHud {
  private readonly card: HTMLDivElement;
  private readonly top: HTMLDivElement;
  private readonly big: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly you: HTMLDivElement;
  private readonly hurt: HTMLDivElement;
  private readonly pops: HTMLDivElement;
  private readonly marks: HTMLDivElement[] = [];
  private popList: { text: string; t: number; color: string }[] = [];
  private hurtT = 0;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private readonly v = new THREE.Vector3();
  open = false;

  constructor() {
    const box = (css: Partial<CSSStyleDeclaration>): HTMLDivElement => {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'fixed', zIndex: '40', display: 'none', color: '#f0ecf8', fontFamily: "'Segoe UI', 'Yu Gothic', sans-serif", pointerEvents: 'none', ...css });
      document.body.append(d);
      return d;
    };
    this.card = box({ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(10, 10, 18, 0.94)', border: '1px solid #5a4a70', borderRadius: '10px', padding: '18px 20px', minWidth: '360px', maxWidth: '520px', fontSize: '14px', boxShadow: '0 10px 40px rgba(0,0,0,0.55)' });
    this.top = box({ left: '50%', top: '50px', transform: 'translateX(-50%)', background: 'rgba(8, 8, 14, 0.7)', borderRadius: '8px', padding: '6px 16px', fontSize: '16px', fontWeight: '600', letterSpacing: '0.04em', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' });
    this.big = box({ left: '50%', top: '38%', transform: 'translate(-50%, -50%)', fontSize: '96px', fontWeight: '900', textShadow: '0 0 24px rgba(255, 60, 60, 0.8)' });
    this.list = box({ right: '18px', top: '92px', fontSize: '13px', fontVariantNumeric: 'tabular-nums', textAlign: 'right', textShadow: '0 1px 4px #000' });
    this.you = box({ left: '50%', bottom: '64px', transform: 'translateX(-50%)', fontSize: '13px', fontWeight: '600', letterSpacing: '0.06em', textShadow: '0 1px 4px #000', textAlign: 'center' });
    this.hurt = box({ inset: '0', zIndex: '39', background: 'radial-gradient(ellipse at center, rgba(255,40,50,0) 45%, rgba(255,40,50,0.55) 100%)', opacity: '0' });
    this.pops = box({ left: '50%', top: '27%', transform: 'translateX(-50%)', fontSize: '20px', fontWeight: '800', textAlign: 'center', textShadow: '0 2px 10px rgba(0,0,0,0.85)' });
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

  /** A word on a hit (yours on them, or what's happened). */
  pop(text: string, color = '#ffe9a8', seconds = 1.6): void {
    this.popList.push({ text, t: seconds, color });
    if (this.popList.length > 4) this.popList.shift();
  }

  /** You were hit: the screen's edge flashes red. */
  hit(hard: boolean): void {
    this.hurtT = Math.max(this.hurtT, hard ? 0.8 : 0.5);
  }

  /** Each frame: `st` the job (null: none), the chase cars for the list and the markers, the camera they're seen from. */
  update(dt: number, st: ChaseState | null, cars: readonly ChaseMark[], camera: THREE.PerspectiveCamera, goal: { label: string; dist: number } | null): void {
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.hurt.style.display = this.hurtT > 0 ? 'block' : 'none';
    this.hurt.style.opacity = Math.min(1, this.hurtT * 2).toFixed(2);
    this.popList = this.popList.filter((p) => (p.t -= dt) > 0);
    this.pops.style.display = this.popList.length ? 'block' : 'none';
    this.pops.innerHTML = this.popList.map((p) => `<div style="color:${p.color};opacity:${Math.min(1, p.t * 2).toFixed(2)}">${p.text}</div>`).join('');
    const on = !!st && st.phase !== 'over';
    for (const el of [this.top, this.list, this.you]) el.style.display = on ? 'block' : 'none';
    if (!st || !on) {
      this.big.style.display = 'none';
      for (const m of this.marks) m.style.display = 'none';
      return;
    }
    const def = st.def;
    const live = st.live;
    const what =
      def.kind === 'hunt'
        ? `stop ${live > 1 ? `${live} cars` : 'the car'}${st.left < Infinity ? ` · ${clock(st.left)} left` : ''}${st.lostFor > 2 ? ' · <span style="color:#ff8a8a">LOSING HIM</span>' : ''}`
        : def.reach
          ? `get to ${goal?.label ?? 'safety'}${goal ? ` · ${goal.dist >= 1000 ? `${(goal.dist / 1000).toFixed(1)} km` : `${Math.round(goal.dist)} m`}` : ''} · ${live} on you${def.kind === 'gauntlet' ? ` · ${st.kills} down` : ''}`
          : `${live} on you: see them off or lose them${st.clearFor > 2 ? ` · <span style="color:#7cffb0">LOSING THEM ${Math.ceil(12 - st.clearFor)}</span>` : ''}`;
    this.top.innerHTML = `${def.name} · ${clock(st.t)} · ${what}`;
    this.list.innerHTML = cars
      .map((c) => {
        const bar = `<span style="display:inline-block;width:90px;height:7px;background:rgba(255,255,255,0.18);border-radius:3px;vertical-align:middle;margin-left:8px;overflow:hidden"><span style="display:block;height:100%;width:${Math.round((c.health / c.max) * 100)}%;background:${c.out ? '#555' : '#ff5a5a'}"></span></span>`;
        return `<div style="margin:3px 0;opacity:${c.out ? 0.5 : 1}">${c.name}${c.armed && !c.gunman && !c.out ? ' <span style="opacity:.6">(gunman down)</span>' : ''} · ${c.out ? c.out.toUpperCase() : `${c.tyres ? 'tyre out · ' : ''}${Math.round(c.dist)} m`}${bar}</div>`;
      })
      .join('');
    const hp = Math.round(st.health);
    this.you.innerHTML = `YOU <span style="display:inline-block;width:160px;height:8px;background:rgba(255,255,255,0.18);border-radius:4px;vertical-align:middle;margin:0 8px;overflow:hidden"><span style="display:block;height:100%;width:${Math.round((hp / st.maxHealth) * 100)}%;background:${hp > st.maxHealth / 2 ? '#7cffb0' : hp > st.maxHealth / 4 ? '#ffd27c' : '#ff5a5a'}"></span></span>${hp}`;
    if (st.phase === 'countdown') {
      this.big.style.display = 'block';
      this.big.textContent = String(Math.max(1, Math.ceil(st.countdown)));
    } else if (st.t < 0.8) {
      this.big.style.display = 'block';
      this.big.textContent = 'GO';
    } else this.big.style.display = 'none';
    // A marker over each car still running: where it is on the screen, or an arrow at the edge toward it.
    const W = window.innerWidth;
    const H = window.innerHeight;
    cars.forEach((c, i) => {
      let m = this.marks[i];
      if (!m) {
        m = document.createElement('div');
        Object.assign(m.style, { position: 'fixed', zIndex: '38', pointerEvents: 'none', color: '#ff6a6a', font: "700 12px 'Segoe UI', sans-serif", textShadow: '0 1px 3px #000', transform: 'translate(-50%, -100%)', whiteSpace: 'nowrap', textAlign: 'center' });
        document.body.append(m);
        this.marks[i] = m;
      }
      if (c.out) {
        m.style.display = 'none';
        return;
      }
      const p = this.v.copy(c.at).project(camera);
      const behind = p.z > 1;
      let x = (p.x * 0.5 + 0.5) * W;
      let y = (-p.y * 0.5 + 0.5) * H;
      const off = behind || x < 30 || x > W - 30 || y < 40 || y > H - 40;
      if (behind) {
        x = W - x;
        y = H - 60;
      }
      x = Math.max(34, Math.min(W - 34, x));
      y = Math.max(54, Math.min(H - 60, y));
      m.style.display = 'block';
      m.style.left = `${x}px`;
      m.style.top = `${y}px`;
      m.style.opacity = off ? '0.9' : c.dist < 25 ? '0.45' : '0.85';
      m.innerHTML = off ? `${behind ? '▼' : p.x < 0 ? '◀' : '▶'} ${Math.round(c.dist)} m` : `▼<br>${Math.round(c.dist)} m`;
    });
    for (let i = cars.length; i < this.marks.length; i++) this.marks[i].style.display = 'none';
  }

  /** The result; `again` starts the job over, `close` ends it. */
  result(st: ChaseState, pay: number, again: () => void, close: () => void): void {
    const r = st.result!;
    this.card.innerHTML = `<div style="font-size:30px;font-weight:900;color:${r.won ? '#7cffb0' : '#ff8a8a'}">${r.won ? 'DONE' : 'FAILED'}</div>
      <div style="opacity:.8;margin:4px 0 12px">${r.why}</div>
      <div>${st.def.name} · ${clock(st.t)}</div>
      ${st.def.kind === 'gauntlet' ? `<div style="opacity:.8">Cars put down · ${st.kills}</div>` : st.cars.map((c, i) => `<div style="opacity:.8">${st.defs[i].name} · ${c.out ?? `still running (${Math.round(c.health)})`}</div>`).join('')}
      <div style="opacity:.8">You · ${Math.round(st.health)} left</div>
      ${pay > 0 ? `<div style="margin-top:10px;font-weight:700">+ ${yen(pay)}</div>` : ''}
      <div style="opacity:.6;font-size:12px;margin-top:10px">Enter: again · Esc: done</div>`;
    this.card.style.display = 'block';
    this.open = true;
    this.keys((e) => {
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      this.closeCard();
      if (e.code === 'Enter') again();
      else close();
    });
  }

  /** Put every screen away (the job's been ended from outside). */
  clear(): void {
    this.closeCard();
    this.popList = [];
    this.hurtT = 0;
  }
}
