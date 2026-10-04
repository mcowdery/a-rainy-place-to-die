import type { GuardSide, Side } from './thug';

/**
 * The duel's screen (models/brawl.ts `duel`): his name with his health (red) and his posture (amber, filling out
 * from the middle; Sekiro's way) at the top; your posture at the bottom when it's up; and round the crosshair, a
 * three-way indicator (For Honor's): the side he's guarding lit white, and where his next blow comes from
 * flashing red (a dot in the middle for a straight one). DOM only; hidden when there's no duel.
 */

export interface DuelInfo {
  readonly name: string;
  readonly health: number;
  readonly max: number;
  /** 0..1. */
  readonly posture: number;
  readonly broken: boolean;
  readonly guard: GuardSide;
  readonly incoming: Side | null;
}

export class DuelHud {
  private readonly top: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly healthEl: HTMLDivElement;
  private readonly postureEl: HTMLDivElement;
  private readonly mine: HTMLDivElement;
  private readonly mineFill: HTMLDivElement;
  private readonly ring: HTMLCanvasElement;
  private t = 0;

  constructor(parent: HTMLElement) {
    const css = (el: HTMLElement, o: Partial<CSSStyleDeclaration>): void => void Object.assign(el.style, o);
    this.top = document.createElement('div');
    css(this.top, { position: 'fixed', top: '58px', left: '50%', transform: 'translateX(-50%)', width: '420px', pointerEvents: 'none', zIndex: '7', display: 'none', font: '13px sans-serif', color: '#eee', textShadow: '0 0 4px #000', textAlign: 'center' });
    this.nameEl = document.createElement('div');
    css(this.nameEl, { marginBottom: '4px', letterSpacing: '1px' });
    const bar = (h: string, bg: string): [HTMLDivElement, HTMLDivElement] => {
      const outer = document.createElement('div');
      css(outer, { height: h, background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.25)', marginBottom: '4px', position: 'relative' });
      const fill = document.createElement('div');
      css(fill, { height: '100%', background: bg, position: 'absolute', top: '0' });
      outer.appendChild(fill);
      return [outer, fill];
    };
    const [hOuter, hFill] = bar('8px', '#b3141c');
    const [pOuter, pFill] = bar('6px', 'linear-gradient(90deg, #c06010, #f4b030, #c06010)');
    this.healthEl = hFill;
    this.postureEl = pFill;
    this.top.append(this.nameEl, hOuter, pOuter);
    const [mOuter, mFill] = bar('6px', 'linear-gradient(90deg, #c06010, #f4b030, #c06010)');
    this.mine = mOuter;
    this.mineFill = mFill;
    css(this.mine, { position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)', width: '260px', pointerEvents: 'none', zIndex: '7', display: 'none' });
    this.ring = document.createElement('canvas');
    this.ring.width = this.ring.height = 160;
    css(this.ring, { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: '6', display: 'none' });
    parent.append(this.top, this.mine, this.ring);
  }

  update(dt: number, d: DuelInfo | null, myPosture: number, reeling: boolean): void {
    this.t += dt;
    // Your posture, whenever it's up.
    this.mine.style.display = myPosture > 0.02 || reeling ? 'block' : 'none';
    const mp = Math.min(1, myPosture);
    Object.assign(this.mineFill.style, { left: `${50 - mp * 50}%`, width: `${mp * 100}%`, background: reeling ? '#ff4020' : 'linear-gradient(90deg, #c06010, #f4b030, #c06010)' });
    if (!d) {
      this.top.style.display = 'none';
      this.ring.style.display = 'none';
      return;
    }
    this.top.style.display = 'block';
    this.ring.style.display = 'block';
    this.nameEl.textContent = d.broken ? `${d.name} · OPEN` : d.name;
    Object.assign(this.healthEl.style, { left: '0', width: `${(100 * d.health) / d.max}%` });
    const p = Math.min(1, d.posture);
    Object.assign(this.postureEl.style, { left: `${50 - p * 50}%`, width: `${p * 100}%`, background: d.broken ? '#ff3010' : 'linear-gradient(90deg, #c06010, #f4b030, #c06010)' });
    // The indicator: three arcs round the crosshair (his left on your right: he faces you).
    const g = this.ring.getContext('2d')!;
    const c = 80;
    g.clearRect(0, 0, 160, 160);
    const arc = (mid: number, color: string, w: number): void => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.beginPath();
      g.arc(c, c, 52, mid - 0.55, mid + 0.55);
      g.stroke();
    };
    // Angles on the canvas: 0 is right, -π/2 up. His left is on your right.
    const at: Record<GuardSide, number> = { left: 0, right: Math.PI, high: -Math.PI / 2 };
    for (const side of ['left', 'right', 'high'] as const) arc(at[side], 'rgba(255,255,255,0.14)', 4);
    if (!d.broken) arc(at[d.guard], 'rgba(255,255,255,0.85)', 6);
    if (d.incoming) {
      const pulse = 0.55 + 0.45 * Math.sin(this.t * 30);
      const red = `rgba(255,40,30,${pulse})`;
      // His blow at your left comes from your left: the arcs are your sides for his blows.
      const yours: Record<GuardSide, number> = { left: Math.PI, right: 0, high: -Math.PI / 2 };
      if (d.incoming === 'center') {
        g.fillStyle = red;
        g.beginPath();
        g.arc(c, c, 9, 0, Math.PI * 2);
        g.fill();
      } else arc(yours[d.incoming], red, 9);
    }
  }
}
