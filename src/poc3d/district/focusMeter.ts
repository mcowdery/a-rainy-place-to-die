/** The focus meter: a thin pale bar low in the middle, the slow-motion veil's blue, shown while slow motion is on or the focus is refilling. */
export class FocusMeter {
  private readonly el: HTMLDivElement;
  private readonly fill: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, { position: 'fixed', zIndex: '17', display: 'none', pointerEvents: 'none', left: '50%', bottom: '38px', transform: 'translateX(-50%)', width: '168px', textAlign: 'center', letterSpacing: '0.2em', font: "600 10px 'Segoe UI', 'Yu Gothic', sans-serif", color: '#aab8ee', textShadow: '0 1px 4px #000' });
    this.el.textContent = 'FOCUS 集中';
    const track = document.createElement('div');
    Object.assign(track.style, { marginTop: '4px', height: '3px', background: 'rgba(240,236,248,0.16)', boxShadow: '0 0 6px rgba(0,0,0,0.8)' });
    this.fill = document.createElement('div');
    Object.assign(this.fill.style, { height: '100%', width: '100%', background: '#9fb4ff', boxShadow: '0 0 6px rgba(120,150,255,0.8)' });
    track.append(this.fill);
    this.el.append(track);
    document.body.append(this.el);
  }

  /** `active`: slow motion is on; `focus` 0-1 is what's left; `here`: this mode (car or foot) is the one in play. */
  update(here: boolean, active: boolean, focus: number): void {
    this.el.style.display = here && (active || focus < 0.999) ? 'block' : 'none';
    this.fill.style.width = `${(focus * 100).toFixed(1)}%`;
  }
}
