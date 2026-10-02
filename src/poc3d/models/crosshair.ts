/**
 * The shotgun's crosshair, a screen overlay at the centre of the view (where a raised gun points:
 * models/firstPerson.ts aims it at AIM_RANGE along the view): a small dim dot with ticks while the gun is
 * out, a brighter ring with the spread's size when it's raised, a flash on firing.
 */
export class Crosshair {
  private readonly el: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly dot: HTMLDivElement;
  private flash = 0;

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
    }
    parent.append(this.el);
  }

  /** Each frame: whether the gun is out, how far raised (0..1), and dt for the shot's flash. */
  update(out: boolean, raised: number, dt: number): void {
    this.el.style.display = out ? 'block' : 'none';
    if (!out) return;
    this.flash = Math.max(0, this.flash - dt * 6);
    // Raised, the ring tightens to the spread's size; at the hip a little wider and fainter.
    const size = 26 + (1 - raised) * 12 + this.flash * 14;
    this.ring.style.width = this.ring.style.height = `${size}px`;
    this.ring.style.opacity = String(0.35 + 0.6 * raised);
    this.el.style.opacity = String(0.55 + 0.45 * raised);
    this.ring.style.borderColor = this.flash > 0.05 ? 'rgba(255,200,120,0.95)' : 'rgba(255,255,255,0.85)';
  }

  /** A shot: the ring opens and warms for a moment. */
  fired(): void {
    this.flash = 1;
  }

  dispose(): void {
    this.el.remove();
  }
}
