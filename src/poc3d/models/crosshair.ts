/**
 * The shotgun's crosshair, a screen overlay at the centre of the view (where a raised gun points:
 * models/firstPerson.ts aims it at AIM_RANGE along the view): a small dim dot with ticks while the gun is
 * out, a brighter ring with the spread's size when it's raised, a flash on firing. With no line of fire (a car's
 * driver aiming through his own windscreen) it's a red cross in a red ring instead, pulsing: nothing will fire.
 */
const RED = '#ff2b3a';
export class Crosshair {
  private readonly el: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly dot: HTMLDivElement;
  private readonly ticks: HTMLDivElement[] = [];
  private readonly cross: HTMLDivElement;
  private flash = 0;
  private pulse = 0;

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, { position: 'fixed', left: '50%', top: '50%', width: '0', height: '0', pointerEvents: 'none', zIndex: '3', display: 'none' });
    this.ring = document.createElement('div');
    Object.assign(this.ring.style, {
      position: 'absolute', borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.85)', boxShadow: '0 0 2px rgba(0,0,0,0.9), inset 0 0 2px rgba(0,0,0,0.9)',
      transform: 'translate(-50%, -50%)', transition: 'width 0.12s, height 0.12s, opacity 0.12s',
    });
    this.dot = document.createElement('div');
    Object.assign(this.dot.style, { position: 'absolute', width: '3px', height: '3px', borderRadius: '50%', background: '#fff', boxShadow: '0 0 2px #000', transform: 'translate(-50%, -50%)' });
    this.el.append(this.ring, this.dot);
    // Four short ticks round the dot.
    for (const [x, y, w, h] of [[-14, 0, 7, 1.5], [7, 0, 7, 1.5], [0, -14, 1.5, 7], [0, 7, 1.5, 7]]) {
      const t = document.createElement('div');
      Object.assign(t.style, { position: 'absolute', left: `${x - (w > h ? 0 : w / 2)}px`, top: `${y - (h > w ? 0 : h / 2)}px`, width: `${w}px`, height: `${h}px`, background: 'rgba(255,255,255,0.8)', boxShadow: '0 0 2px #000' });
      this.el.append(t);
      this.ticks.push(t);
    }
    // No line of fire: a cross of two bars.
    this.cross = document.createElement('div');
    Object.assign(this.cross.style, { position: 'absolute', left: '0', top: '0', display: 'none', filter: 'drop-shadow(0 0 3px #000)' });
    for (const turn of [45, -45]) {
      const bar = document.createElement('div');
      Object.assign(bar.style, { position: 'absolute', left: '-17px', top: '-2px', width: '34px', height: '4px', borderRadius: '2px', background: RED, transform: `rotate(${turn}deg)` });
      this.cross.append(bar);
    }
    this.el.append(this.cross);
    parent.append(this.el);
  }

  /** Each frame: whether the gun is out, how far raised (0..1), and dt for the shot's flash. `blocked`: there's no line of fire. */
  update(out: boolean, raised: number, dt: number, blocked = false): void {
    this.el.style.display = out ? 'block' : 'none';
    if (!out) return;
    if (this.caption) this.caption.style.display = 'none';
    if (this.icons) this.icons.style.display = 'none';
    this.flash = Math.max(0, this.flash - dt * 6);
    this.cross.style.display = blocked ? 'block' : 'none';
    this.dot.style.display = blocked ? 'none' : 'block';
    for (const t of this.ticks) t.style.display = blocked ? 'none' : 'block';
    if (blocked) {
      this.pulse += dt * 9;
      this.ring.style.width = this.ring.style.height = '46px';
      this.ring.style.borderColor = RED;
      this.ring.style.borderWidth = '3px';
      this.ring.style.opacity = '1';
      this.el.style.opacity = String(0.8 + 0.2 * Math.sin(this.pulse));
      return;
    }
    this.ring.style.borderWidth = '1.5px';
    // Raised, the ring tightens to the spread's size; at the hip a little wider and fainter.
    const size = 26 + (1 - raised) * 12 + this.flash * 14;
    this.ring.style.width = this.ring.style.height = `${size}px`;
    this.ring.style.opacity = String(0.35 + 0.6 * raised);
    this.el.style.opacity = String(0.55 + 0.45 * raised);
    this.ring.style.borderColor = this.flash > 0.05 ? 'rgba(255,200,120,0.95)' : 'rgba(255,255,255,0.85)';
  }

  /**
   * Unarmed, the same aim as a looking reticule: an eye for observing, a hand for something he can use (`icon`),
   * larger as it's raised and warming amber, with a caption, as the view settles on something (`progress` 0..1;
   * a hand is always warm).
   */
  look(on: boolean, raised: number, dt: number, label: string | null = null, progress = 0, icon: 'eye' | 'hand' = 'eye'): void {
    this.el.style.display = on ? 'block' : 'none';
    if (!on) return;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.cross.style.display = 'none';
    this.dot.style.display = 'none';
    this.ring.style.opacity = '0';
    for (const t of this.ticks) t.style.display = 'none';
    if (!this.icons) {
      this.icons = document.createElement('div');
      Object.assign(this.icons.style, { position: 'absolute', left: '0', top: '0', filter: 'drop-shadow(0 0 2px #000)' });
      this.icons.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block">
        <g class="eye"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle class="pupil" cx="12" cy="12" r="3.2"/></g>
        <g class="hand"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5V4a1.5 1.5 0 0 1 3 0v5.5m0-3a1.5 1.5 0 0 1 3 0V13m0-4a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1.5a7 7 0 0 1-5.6-2.8L4 15.5a1.6 1.6 0 0 1 2.4-2L8 15"/></g></svg>`;
      this.el.append(this.icons);
    }
    this.icons.style.display = 'block';
    const hand = icon === 'hand';
    (this.icons.querySelector('.eye') as SVGElement).style.display = hand ? 'none' : 'block';
    (this.icons.querySelector('.hand') as SVGElement).style.display = hand ? 'block' : 'none';
    const warm = hand ? 1 : progress;
    this.icons.style.color = warm > 0 ? `rgb(255,${Math.round(255 - 55 * warm)},${Math.round(255 - 135 * warm)})` : '#fff';
    // (The pupil opens as the view settles on something.)
    (this.icons.querySelector('.pupil') as SVGElement).setAttribute('r', String(3.2 + progress * 1.2));
    this.icons.style.transform = `translate(-50%, -50%) scale(${0.8 + 0.2 * raised})`;
    this.el.style.opacity = String(0.4 + 0.6 * raised);
    if (!this.caption) {
      this.caption = document.createElement('div');
      Object.assign(this.caption.style, { position: 'absolute', left: '0', top: '26px', transform: 'translateX(-50%)', whiteSpace: 'nowrap', font: "12px 'Consolas', monospace", color: '#ffd9a0', textShadow: '0 0 3px #000, 0 0 3px #000' });
      this.el.append(this.caption);
    }
    this.caption.textContent = label ?? '';
    this.caption.style.display = label && raised > 0.5 ? 'block' : 'none';
  }

  private caption: HTMLDivElement | null = null;
  private icons: HTMLDivElement | null = null;

  /** A shot: the ring opens and warms for a moment. */
  fired(): void {
    this.flash = 1;
  }

  dispose(): void {
    this.el.remove();
  }
}
