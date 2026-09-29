import { BODY, TYRES, WRECKED, type Parts, type Section } from './crash';

/**
 * The damage panel while you drive your own car (bottom left, over the speedo): the car from above, front
 * up, each part (the four sides of the body, the four tyres) coloured by its health and flashing when it
 * takes a hit; a bar for each part; and the overall condition bar with the damage just taken ticking off it.
 */

const NAMES: Record<Section, string> = { front: 'Front', rear: 'Rear', left: 'Left', right: 'Right', fl: 'FL', fr: 'FR', rl: 'RL', rr: 'RR' };

/** Health (0 to 1) as a colour: green, amber, red. */
function tone(h: number): string {
  const r = h > 0.5 ? Math.round(126 + (255 - 126) * (1 - h) * 2) : 255;
  const g = h > 0.5 ? Math.round(240 - (240 - 214) * (1 - h) * 2) : Math.round(80 + (214 - 80) * h * 2);
  const b = h > 0.5 ? Math.round(176 - (176 - 90) * (1 - h) * 2) : Math.round(80 + 10 * h * 2);
  return `rgb(${r},${g},${b})`;
}

export class DamageHud {
  readonly el: HTMLDivElement;
  private readonly zones = new Map<Section, SVGElement>();
  private readonly bars = new Map<Section, { fill: HTMLElement; num: HTMLElement }>();
  private readonly overallFill: HTMLElement;
  private readonly overallNum: HTMLElement;
  private readonly lost: HTMLElement;
  private readonly flash = new Map<Section, number>();
  private lostAmount = 0;
  private lostT = 0;

  constructor() {
    const el = document.createElement('div');
    this.el = el;
    Object.assign(el.style, {
      position: 'fixed',
      left: '24px',
      bottom: '76px',
      zIndex: '16',
      width: '250px',
      padding: '9px 12px 10px',
      background: 'rgba(8,8,14,0.72)',
      border: '1px solid #3a3850',
      color: '#c8cce0',
      font: "12px 'Consolas', monospace",
      display: 'none',
      pointerEvents: 'none',
    });
    const Z = (d: string, part: Section): string => `<path data-p="${part}" d="${d}" stroke="#0a0a12" stroke-width="1.5"/>`;
    const T = (x: number, y: number, part: Section): string => `<rect data-p="${part}" x="${x}" y="${y}" width="9" height="19" rx="2.5" stroke="#0a0a12" stroke-width="1"/>`;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;color:#e8e6f0">
        <b style="letter-spacing:1px">車体 CONDITION</b><span data-k="onum" style="font-weight:bold"></span>
      </div>
      <div style="position:relative;height:9px;margin:4px 0 8px;background:#241c28;border-radius:4px;overflow:hidden">
        <i data-k="ofill" style="position:absolute;left:0;top:0;bottom:0;border-radius:4px;transition:width .15s"></i>
      </div>
      <div style="display:flex;gap:12px;align-items:center">
        <svg viewBox="0 0 70 120" width="62" height="106" style="flex:none;overflow:visible">
          ${Z('M17 8 Q35 -2 53 8 L53 34 L17 34 Z', 'front')}
          ${Z('M17 86 L53 86 L53 110 Q35 120 17 110 Z', 'rear')}
          ${Z('M11 36 L33 36 L33 84 L11 84 Z', 'left')}
          ${Z('M37 36 L59 36 L59 84 L37 84 Z', 'right')}
          <rect x="22" y="40" width="26" height="36" rx="4" fill="rgba(10,10,20,0.55)"/>
          ${T(3, 16, 'fl')}${T(58, 16, 'fr')}${T(3, 86, 'rl')}${T(58, 86, 'rr')}
        </svg>
        <div data-k="bars" style="flex:1;display:grid;grid-template-columns:40px 1fr 26px;gap:3px 6px;align-items:center"></div>
      </div>
      <div data-k="lost" style="position:absolute;right:12px;top:-20px;color:#ff6a6a;font:bold 16px Consolas,monospace;opacity:0;text-shadow:0 0 8px rgba(255,60,60,.6)"></div>`;
    for (const z of el.querySelectorAll<SVGElement>('[data-p]')) this.zones.set(z.dataset.p as Section, z);
    const grid = el.querySelector<HTMLElement>('[data-k="bars"]')!;
    for (const part of [...BODY, ...TYRES]) {
      const label = document.createElement('span');
      label.textContent = NAMES[part];
      const track = document.createElement('i');
      Object.assign(track.style, { position: 'relative', height: '6px', background: '#241c28', borderRadius: '3px', overflow: 'hidden' });
      const fill = document.createElement('b');
      Object.assign(fill.style, { position: 'absolute', left: '0', top: '0', bottom: '0', borderRadius: '3px', transition: 'width .15s' });
      track.append(fill);
      const num = document.createElement('span');
      num.style.textAlign = 'right';
      grid.append(label, track, num);
      this.bars.set(part, { fill, num });
    }
    this.overallFill = el.querySelector<HTMLElement>('[data-k="ofill"]')!;
    this.overallNum = el.querySelector<HTMLElement>('[data-k="onum"]')!;
    this.lost = el.querySelector<HTMLElement>('[data-k="lost"]')!;
    document.body.append(el);
  }

  /** Show the car's parts (null hides the panel); `hits` is emptied into the flashes. */
  update(dt: number, car: { parts: Parts; condition: number; totaled: boolean; hits: { part: Section; amount: number }[] } | null): void {
    this.el.style.display = car ? 'block' : 'none';
    if (!car) return;
    for (const h of car.hits) {
      this.flash.set(h.part, Math.min(1, (this.flash.get(h.part) ?? 0) + 0.35 + h.amount / 8));
      this.lostAmount += h.amount;
      this.lostT = 1.6;
    }
    car.hits.length = 0;
    for (const part of [...BODY, ...TYRES]) {
      const health = 1 - car.parts[part] / WRECKED;
      const f = this.flash.get(part) ?? 0;
      const zone = this.zones.get(part)!;
      zone.setAttribute('fill', f > 0.02 ? `color-mix(in srgb, #ff3030 ${Math.round(f * 100)}%, ${tone(health)})` : tone(health));
      zone.setAttribute('opacity', health <= 0 ? '0.45' : '1');
      this.flash.set(part, Math.max(0, f - dt * 1.6));
      const bar = this.bars.get(part)!;
      bar.fill.style.width = `${Math.max(0, health * 100)}%`;
      bar.fill.style.background = tone(health);
      bar.num.textContent = health <= 0 ? '✕' : `${Math.round(health * 100)}`;
      bar.num.style.color = f > 0.05 ? '#ff6a6a' : '#8a90a8';
    }
    const o = 1 - car.condition / 100;
    this.overallFill.style.width = `${Math.max(0, o * 100)}%`;
    this.overallFill.style.background = tone(o);
    this.overallNum.textContent = car.totaled ? '大破 TOTALLED' : `${Math.round(o * 100)}%`;
    this.overallNum.style.color = car.totaled ? '#ff5a5a' : tone(o);
    // The damage just taken, gathered while hits keep coming, then fading.
    if (this.lostT > 0) {
      this.lostT -= dt;
      if (this.lostAmount >= 0.5) this.lost.textContent = `−${this.lostAmount.toFixed(this.lostAmount < 10 ? 1 : 0)}`;
      this.lost.style.opacity = this.lostAmount >= 0.5 ? String(Math.min(1, this.lostT)) : '0';
    } else {
      this.lostAmount = 0;
      this.lost.style.opacity = '0';
    }
  }
}
