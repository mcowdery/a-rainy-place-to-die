import type { PhoneApp } from '../../phone/ui';
import { nextTurn, onRoute, type NavMode } from './gps';
import type { Guide, GuideDest } from './guide';
import { BASE_RES, type Destination } from './travel';

/**
 * The phone's Maps app: the GPS in your hand. A map that follows you (heading up is left to the M map: this
 * one keeps north up, your arrow turning), the route drawn on it, and the next turn called out at the top
 * ("Turn left in 40 m") with the distance and time left, for walking or driving. Tap the map to set the
 * destination (a place's dot names it), or pick a place from the list; Clear drops it. Drag pans (the
 * locate button follows you again), the wheel or +/- zoom. It shares the GPS with the M map and the arrows
 * in the street (guide.ts). At the wheel of your own car a second row offers auto drive (district/autoDrive.ts):
 * off, or one of its ways of driving.
 */
export interface MapsAuto {
  /** The ways of driving it offers. */
  readonly options: readonly { readonly id: string; readonly label: string }[];
  /** Whether it can be offered now (you're at the wheel of your own car), and which is on (null: off). */
  available(): boolean;
  current(): string | null;
  pick(id: string | null): void;
}

export class PhoneMaps implements PhoneApp {
  readonly id = 'maps';
  readonly name = 'Maps';
  readonly icon = '📍';
  readonly color = '#2a7fd8';
  private canvas: HTMLCanvasElement | null = null;
  private card: HTMLDivElement | null = null;
  private places: HTMLDivElement | null = null;
  private modeChip: HTMLSpanElement | null = null;
  private autoBar: HTMLDivElement | null = null;
  /** Pixels per metre, the view centre, and whether it follows you. */
  private zoom = 1.6;
  private cx = 0;
  private cz = 0;
  private follow = true;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private redraw = 0;

  constructor(
    private readonly base: () => HTMLCanvasElement,
    private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    private readonly dests: readonly Destination[],
    private readonly guide: Guide,
    /** Where you are, which way you face (yaw: 0 looks north, -z), and how you're getting about. */
    private readonly me: () => { x: number; z: number; yaw: number; mode: NavMode },
    private readonly setDest: (d: GuideDest | null) => void,
    private readonly zoneAt: (x: number, z: number) => string | null,
    private readonly auto: MapsAuto | null = null,
  ) {}

  show(screen: HTMLElement): void {
    injectStyle();
    const root = document.createElement('div');
    root.className = 'mp-root';
    const card = document.createElement('div');
    card.className = 'mp-card';
    const canvas = document.createElement('canvas');
    canvas.className = 'mp-map';
    const bar = document.createElement('div');
    bar.className = 'mp-bar';
    const btn = (label: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'mp-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      bar.append(b);
      return b;
    };
    btn('◎', 'Follow me', () => {
      this.follow = true;
    });
    btn('−', 'Zoom out', () => (this.zoom = Math.max(0.25, this.zoom / 1.5)));
    btn('+', 'Zoom in', () => (this.zoom = Math.min(8, this.zoom * 1.5)));
    btn('Places', 'Pick a destination', () => this.togglePlaces());
    btn('Clear', 'Clear the destination', () => this.setDest(null));
    this.modeChip = document.createElement('span');
    this.modeChip.className = 'mp-mode';
    bar.append(this.modeChip);
    const places = document.createElement('div');
    places.className = 'mp-places';
    places.hidden = true;
    for (const group of ['Places', 'Zones', 'Expressway'] as const) {
      const h = document.createElement('div');
      h.className = 'mp-group';
      h.textContent = group === 'Places' ? 'PLACES' : group === 'Zones' ? 'AREAS' : 'EXPRESSWAY ENTRANCES';
      places.append(h);
      for (const d of this.dests.filter((x) => x.group === group && !x.name.includes('('))) {
        const b = document.createElement('button');
        b.className = 'mp-place';
        b.textContent = d.name;
        b.addEventListener('click', () => {
          this.setDest({ x: d.x, z: d.z, label: d.name });
          places.hidden = true;
          this.follow = true;
        });
        places.append(b);
      }
    }
    // Auto drive: off, or a way of driving (shown at the wheel of your own car).
    const autoBar = document.createElement('div');
    autoBar.className = 'mp-bar mp-auto';
    autoBar.hidden = true;
    if (this.auto) {
      const label = document.createElement('span');
      label.className = 'mp-autolabel';
      label.textContent = 'Auto drive';
      autoBar.append(label);
      for (const o of [{ id: '', label: 'Off' }, ...this.auto.options]) {
        const b = document.createElement('button');
        b.className = 'mp-btn';
        b.dataset.auto = o.id;
        b.textContent = o.label;
        b.addEventListener('click', () => this.auto!.pick(o.id || null));
        autoBar.append(b);
      }
    }
    this.autoBar = autoBar;
    root.append(card, canvas, autoBar, bar, places);
    screen.append(root);
    this.canvas = canvas;
    this.card = card;
    this.places = places;
    // Drag pans, wheel zooms, a tap sets the destination.
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (!d.moved) return;
      this.follow = false;
      this.cx = d.cx - dx / this.zoom;
      this.cz = d.cz - dy / this.zoom;
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved) return;
      const r = canvas.getBoundingClientRect();
      const wx = this.cx + (e.clientX - r.left - r.width / 2) / this.zoom;
      const wz = this.cz + (e.clientY - r.top - r.height / 2) / this.zoom;
      let best: Destination | null = null;
      let bestD = 14 / this.zoom;
      for (const t of this.dests) {
        const dd = Math.hypot(t.x - wx, t.z - wz);
        if (dd < bestD) [best, bestD] = [t, dd];
      }
      this.setDest(best ? { x: best.x, z: best.z, label: best.name } : { x: wx, z: wz, label: this.zoneAt(wx, wz) ?? 'Dropped pin' });
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(0.25, Math.min(8, this.zoom * Math.exp(-e.deltaY * 0.0015)));
      },
      { passive: false },
    );
    this.redraw = 0;
    this.tick(0);
  }

  hide(): void {
    this.canvas = this.card = this.places = this.modeChip = this.autoBar = null;
    this.drag = null;
  }

  back(): boolean {
    if (this.places && !this.places.hidden) {
      this.places.hidden = true;
      return true;
    }
    return false;
  }

  private togglePlaces(): void {
    if (this.places) this.places.hidden = !this.places.hidden;
  }

  tick(dt: number): void {
    const c = this.canvas;
    if (!c || !this.card) return;
    // About 20 redraws a second is plenty for a map in your hand.
    this.redraw -= dt;
    if (this.redraw > 0) return;
    this.redraw = 0.05;
    const me = this.me();
    if (this.follow) {
      this.cx = me.x;
      this.cz = me.z;
    }
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0c0c14';
    g.fillRect(0, 0, r.width, r.height);
    const S = (x: number, z: number): [number, number] => [r.width / 2 + (x - this.cx) * this.zoom, r.height / 2 + (z - this.cz) * this.zoom];
    const b = this.bounds;
    const [x0, y0] = S(b.minX, b.minZ);
    g.imageSmoothingEnabled = this.zoom < BASE_RES * 1.5;
    g.drawImage(this.base(), x0, y0, (b.maxX - b.minX) * this.zoom, (b.maxZ - b.minZ) * this.zoom);
    // Places, as small dots with names when zoomed in.
    g.font = "11px 'Segoe UI', 'Yu Gothic', sans-serif";
    g.textAlign = 'left';
    for (const d of this.dests) {
      if (d.group !== 'Places' || d.name.includes('(')) continue;
      const [px, py] = S(d.x, d.z);
      if (px < -20 || py < -20 || px > r.width + 20 || py > r.height + 20) continue;
      g.fillStyle = '#ff8ad8';
      g.beginPath();
      g.arc(px, py, 3.5, 0, Math.PI * 2);
      g.fill();
      if (this.zoom > 1.2) {
        g.fillStyle = '#f4eef8';
        g.fillText(d.name, px + 6, py + 4);
      }
    }
    // The route, the destination pin.
    const route = this.guide.route;
    const dest = this.guide.dest;
    if (route && route.length > 1) {
      g.strokeStyle = 'rgba(20, 60, 90, 0.9)';
      g.lineWidth = 9;
      g.lineJoin = g.lineCap = 'round';
      const path = (): void => {
        g.beginPath();
        route.forEach(([x, z], i) => {
          const [sx, sy] = S(x, z);
          if (i) g.lineTo(sx, sy);
          else g.moveTo(sx, sy);
        });
      };
      path();
      g.stroke();
      g.strokeStyle = '#5adcff';
      g.lineWidth = 5;
      path();
      g.stroke();
    }
    if (dest) {
      const [px, py] = S(dest.x, dest.z);
      g.fillStyle = '#ff4f6a';
      g.beginPath();
      g.moveTo(px, py);
      g.arc(px, py - 15, 8, Math.PI * 0.8, Math.PI * 0.2);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(px, py - 15, 3, 0, Math.PI * 2);
      g.fill();
    }
    // You: a blue dot with a heading cone.
    const [mx, my] = S(me.x, me.z);
    const a = (me.yaw * Math.PI) / 180;
    const fx = -Math.sin(a);
    const fz = -Math.cos(a);
    g.fillStyle = 'rgba(80, 160, 255, 0.25)';
    g.beginPath();
    g.moveTo(mx, my);
    g.arc(mx, my, 26, Math.atan2(fz, fx) - 0.5, Math.atan2(fz, fx) + 0.5);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(mx, my, 7.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a8cff';
    g.beginPath();
    g.arc(mx, my, 5.5, 0, Math.PI * 2);
    g.fill();
    this.renderCard(me);
  }

  /** The directions card: the next turn and what's left, or how to set a destination. */
  private renderCard(me: { x: number; z: number; mode: NavMode }): void {
    const card = this.card!;
    const drive = me.mode === 'drive';
    if (this.modeChip) this.modeChip.textContent = drive ? '🚗 Driving' : '🚶 Walking';
    if (this.autoBar && this.auto) {
      this.autoBar.hidden = !this.auto.available();
      const on = this.auto.current() ?? '';
      for (const b of this.autoBar.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('mp-on', b.dataset.auto === on);
    }
    const dest = this.guide.dest;
    const route = this.guide.route;
    if (!dest) {
      card.className = 'mp-card mp-idle';
      card.textContent = 'Tap the map or pick a place to get directions';
      return;
    }
    card.className = 'mp-card';
    let arrow = '⬆';
    let line = `Head for ${dest.label}`;
    let left = Math.hypot(dest.x - me.x, dest.z - me.z);
    if (route && route.length > 1) {
      // Only reading where you are: the main loop reroutes and handles arrival.
      const at = onRoute(route, me.x, me.z);
      {
        left = at.left;
        const t = nextTurn(route, at.seg, at.t);
        const arrows = { left: '⬅', right: '➡', 'sharp-left': '↰', 'sharp-right': '↱', arrive: '🏁' } as const;
        arrow = arrows[t.dir];
        const d = dist(t.dist);
        line = t.dir === 'arrive' ? `${dest.label} in ${d}` : t.dist < 12 ? `Turn ${t.dir.replace('-', ' ')} now` : `Turn ${t.dir.replace('-', ' ')} in ${d}`;
        // Straight on for a while first: say so.
        if (t.dir !== 'arrive' && t.dist > 120) line = `Continue ${d}, then turn ${t.dir.replace('-', ' ')}`;
      }
    }
    // Game pace: a brisk walk (4.5 m/s) or city driving (about 30 km/h with the lights).
    const mins = Math.max(1, Math.round(left / (drive ? 8.5 : 4.5) / 60));
    card.innerHTML = '';
    const big = document.createElement('div');
    big.className = 'mp-arrow';
    big.textContent = arrow;
    const text = document.createElement('div');
    text.className = 'mp-text';
    const l1 = document.createElement('div');
    l1.className = 'mp-line';
    l1.textContent = line;
    const l2 = document.createElement('div');
    l2.className = 'mp-sub';
    l2.textContent = `${dist(left)} · ${mins} min · ${dest.label}`;
    text.append(l1, l2);
    card.append(big, text);
  }

  badge(): number {
    return 0;
  }
}

function dist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(5, Math.round(m / 5) * 5)} m`;
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .mp-root { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; background: #0c0c14; }
  .mp-card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: #1a6a3a; color: #fff; min-height: 58px; box-sizing: border-box; }
  .mp-card.mp-idle { background: #1c1e28; color: #a8a6b8; font-size: 12.5px; justify-content: center; text-align: center; }
  .mp-arrow { font-size: 30px; width: 38px; text-align: center; }
  .mp-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .mp-line { font-size: 15px; font-weight: 700; }
  .mp-sub { font-size: 11.5px; color: #d8f4e0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mp-map { flex: 1; width: 100%; min-height: 0; display: block; cursor: grab; touch-action: none; }
  .mp-bar { display: flex; align-items: center; gap: 5px; padding: 7px 8px; background: #111218; border-top: 1px solid #262833; }
  .mp-btn { font: inherit; font-size: 12px; padding: 6px 9px; border-radius: 12px; border: 1px solid #34364a; background: #1e2030; color: #e0e4f4; cursor: pointer; }
  .mp-btn:hover { background: #2a2e44; }
  .mp-btn.mp-on { background: #1a6a3a; border-color: #3aa868; color: #fff; }
  .mp-auto[hidden] { display: none; }
  .mp-autolabel { font-size: 11px; color: #a8c8e8; margin-right: 2px; }
  .mp-mode { margin-left: auto; font-size: 11px; color: #a8c8e8; }
  .mp-places { position: absolute; left: 0; right: 0; top: 58px; bottom: 44px; overflow-y: auto; background: rgba(14,15,22,0.97); padding: 8px 10px; }
  .mp-places[hidden] { display: none; }
  .mp-group { color: #8a88a0; font-size: 11px; letter-spacing: 1px; margin: 10px 0 4px; }
  .mp-place { display: block; width: 100%; text-align: left; font: inherit; font-size: 13px; padding: 7px 10px; margin: 2px 0; border-radius: 8px; border: 0; background: #1e2030; color: #eceaf6; cursor: pointer; }
  .mp-place:hover { background: #2a3050; }
  `;
  document.head.append(s);
}
