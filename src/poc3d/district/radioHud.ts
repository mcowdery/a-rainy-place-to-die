import type { Readout } from '../real/radio';

/**
 * The radio's readout (bottom centre, like a car stereo's display): the station or the tape, and the track with
 * its artist (which is also where the music is credited as it plays). Shown for a few seconds whenever what's on
 * changes, then it fades.
 */
export class RadioHud {
  readonly el: HTMLDivElement;
  private readonly top: HTMLDivElement;
  private readonly bottom: HTMLDivElement;
  private timer = 0;

  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', left: '50%', bottom: '26px', transform: 'translateX(-50%)', zIndex: '15', padding: '7px 16px 8px', minWidth: '260px', maxWidth: '70vw',
      background: 'rgba(6, 10, 12, 0.82)', border: '1px solid #24484a', borderRadius: '3px', color: '#7fe6d8', textAlign: 'center',
      font: "13px 'Consolas', monospace", textShadow: '0 0 6px rgba(90, 230, 210, 0.55)', pointerEvents: 'none', opacity: '0', transition: 'opacity 0.35s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    } satisfies Partial<CSSStyleDeclaration>);
    this.top = document.createElement('div');
    Object.assign(this.top.style, { letterSpacing: '0.08em', fontSize: '12px', opacity: '0.8' });
    this.bottom = document.createElement('div');
    Object.assign(this.bottom.style, { marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis' });
    this.el.append(this.top, this.bottom);
    document.body.append(this.el);
  }

  show(r: Readout, seconds = 5): void {
    this.top.textContent = r.top;
    this.bottom.textContent = r.bottom;
    this.bottom.style.display = r.bottom ? 'block' : 'none';
    this.el.style.opacity = '1';
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.el.style.opacity = '0'), seconds * 1000);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.el.style.opacity = '0';
  }
}
