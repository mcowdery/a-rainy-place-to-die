import { CELL } from './plan';
import type { Node3 } from './stamps';
import type { District } from './world';
import type { ZoneMap } from './zones';

/**
 * Fast travel: a map of the district (zones, streets, buildings, named places) with destinations you
 * click to jump to. Destinations are every named spawn node (stamps: the crossing, Bar Kanpai, Yoru Mart,
 * the shrine...) plus one street spot per zone. M opens it, Esc or M closes it. The map fills the screen;
 * the wheel zooms about the cursor and dragging pans.
 */
export interface Destination {
  readonly id: string;
  readonly name: string;
  readonly group: 'Places' | 'Zones' | 'Expressway';
  readonly x: number;
  readonly z: number;
  /** Camera yaw / pitch in degrees. */
  readonly yaw: number;
  readonly pitch: number;
  /** Floor height (a station platform is raised). */
  readonly floor: number;
}

const YAW: Record<string, number> = { north: 0, south: 180, east: -90, west: 90 };

export function destinations(district: District, nodes: readonly Node3[], zones: ZoneMap): Destination[] {
  const out: Destination[] = [];
  for (const n of nodes) {
    if (n.kind !== 'spawn' || !n.name) continue;
    out.push({ id: n.id, name: n.name, group: 'Places', x: n.x, z: n.z, yaw: n.view?.[0] ?? YAW[n.facing ?? 'north'], pitch: n.view?.[1] ?? 4, floor: n.floor });
  }
  // Zones: the free street spot nearest the middle of the zone's cells, looking along the street.
  for (const zone of zones.zones) {
    const cells = district.cells.filter(([mx, my]) => zones.at(mx, my) === zone);
    if (cells.length === 0) continue;
    const cx = (cells.reduce((t, [mx]) => t + mx, 0) / cells.length + 0.5) * CELL;
    const cz = (cells.reduce((t, [, my]) => t + my, 0) / cells.length + 0.5) * CELL;
    let best: Destination | null = null;
    let bestD = Infinity;
    for (const [mx, my] of cells) {
      for (const r of district.plan(mx, my)?.roads ?? []) {
        if (r.kind === 'coast' || r.kind === 'alley') continue;
        const q = r.rect;
        // Walk along the road's centre line in steps; keep the free point nearest the zone's middle.
        const len = r.vertical ? q.h : q.w;
        for (let s = 4; s < len - 4; s += 6) {
          const x = r.vertical ? q.x + q.w / 2 : q.x + s;
          const z = r.vertical ? q.y + s : q.y + q.h / 2;
          if (Math.floor(x / CELL) !== mx || Math.floor(z / CELL) !== my) continue;
          const d = Math.hypot(x - cx, z - cz);
          if (d >= bestD || district.blocked(x, z, 0.6)) continue;
          bestD = d;
          const yaw = r.vertical ? (z > cz ? 0 : 180) : x > cx ? 90 : -90;
          best = { id: `zone.${zone.id}`, name: zone.name, group: 'Zones', x, z, yaw, pitch: 6, floor: 0 };
        }
      }
    }
    if (best) out.push(best);
  }
  return out;
}

const ZONE_COLORS = ['#ff5fc8', '#4fe3ff', '#ffe45f', '#6bff8a', '#ff9a40', '#b48cff', '#ff4f4f', '#ffffff'];

/** A railway line on the map: its colour, letter and stations (in order). */
export interface MapLine {
  readonly name: string;
  readonly color: number;
  readonly letter: string;
  readonly stops: readonly { readonly x: number; readonly z: number; readonly code: string; readonly name: string }[];
}

/** Pixels per metre of the pre-drawn district image (zoomed views sample it). */
export const BASE_RES = 2;
/** Zoom limits: the whole district fitted, down to this many screen pixels per metre. */
const MAX_ZOOM = 8;

export class TravelMap {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly list: HTMLDivElement;
  private player: { x: number; z: number; yaw: number } = { x: 0, z: 0, yaw: 0 };
  /** The district pre-drawn once (roads, open ground, buildings, stamps) at BASE_RES px/m. */
  private base: HTMLCanvasElement | null = null;
  /** The view: world point at the canvas centre, and screen pixels (CSS) per metre. */
  private cx = 0;
  private cz = 0;
  private zoom = 1;
  private fit = 1;
  private dpr = 1;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  /** The GPS destination and its route, drawn on the map. */
  private gps: { x: number; z: number; label: string; route: readonly (readonly [number, number])[] | null } | null = null;

  constructor(
    private readonly district: District,
    private readonly zones: ZoneMap,
    private readonly dests: readonly Destination[],
    private readonly go: (d: Destination) => void,
    /**
     * Whether clicking a place's dot travels there (debug only), the lines drawn, and the GPS: a click anywhere
     * else (or a place in the list) marks a destination, a right click clears it (mark(null)).
     */
    private readonly opts: {
      readonly travel: boolean;
      readonly lines: readonly MapLine[];
      readonly mark?: (m: { x: number; z: number; label: string } | null) => void;
      /** The expressway's roads (centrelines, world x/z), drawn over the streets. */
      readonly expressway?: readonly { readonly x: ArrayLike<number>; readonly z: ArrayLike<number>; readonly closed: boolean }[];
    } = { travel: true, lines: [] },
  ) {
    this.root = document.createElement('div');
    this.root.id = 'travel';
    Object.assign(this.root.style, {
      position: 'fixed', inset: '0', display: 'none', alignItems: 'stretch', justifyContent: 'center', gap: '12px', padding: '20px',
      boxSizing: 'border-box', background: 'rgba(4, 4, 10, 0.8)', zIndex: '20', font: "13px 'Consolas', monospace", color: '#e8e6f0',
    } satisfies Partial<CSSStyleDeclaration>);
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { flex: '1 1 auto', minWidth: '0', border: '1px solid #3a3850', background: '#0c0c14', cursor: 'grab' });
    // Wheel zooms about the cursor; drag pans; a click (without dragging) travels to the nearest destination.
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [wx, wz] = this.toWorld(e.offsetX, e.offsetY);
      this.zoom = Math.max(this.fit, Math.min(MAX_ZOOM, this.zoom * Math.exp(-e.deltaY * 0.0015)));
      // Keep the point under the cursor fixed.
      const r = this.canvas.getBoundingClientRect();
      this.cx = wx - (e.offsetX - r.width / 2) / this.zoom;
      this.cz = wz - (e.offsetY - r.height / 2) / this.zoom;
      this.clamp();
      this.draw();
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (!d.moved) return;
      this.cx = d.cx - dx / this.zoom;
      this.cz = d.cz - dy / this.zoom;
      this.clamp();
      this.draw();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      this.canvas.style.cursor = 'grab';
      if (!d || d.moved || e.button !== 0) return;
      let best: Destination | null = null;
      let bestD = 16;
      for (const t of this.dests) {
        const [sx, sy] = this.toScreen(t.x, t.z);
        const dd = Math.hypot(sx - e.offsetX, sy - e.offsetY);
        if (dd < bestD) [best, bestD] = [t, dd];
      }
      // Debug: a place's dot travels there. Otherwise the click marks a GPS destination (named if on a place).
      if (best && this.opts.travel) return this.go(best);
      const [wx, wz] = best ? [best.x, best.z] : this.toWorld(e.offsetX, e.offsetY);
      this.opts.mark?.({ x: wx, z: wz, label: best?.name ?? this.district.zoneAt(wx, wz) ?? 'Marked spot' });
    });
    // A right click clears the destination.
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.opts.mark?.(null);
    });
    this.list = document.createElement('div');
    Object.assign(this.list.style, { flex: '0 0 260px', overflowY: 'auto', background: '#0c0c14', border: '1px solid #3a3850', padding: '10px 12px' });
    const title = document.createElement('div');
    title.textContent = opts.travel ? 'MAP + FAST TRAVEL (debug)  ·  M / Esc to close' : 'MAP  ·  M / Esc to close';
    Object.assign(title.style, { color: '#ff8ad8', marginBottom: '4px', letterSpacing: '1px' });
    const hint = document.createElement('div');
    hint.textContent = opts.travel
      ? 'wheel zoom · drag pan · click a dot to go · click elsewhere to set the GPS · right click clears it'
      : 'wheel zoom · drag pan · click to set the GPS (or pick a place below) · right click clears it';
    Object.assign(hint.style, { color: '#8a88a0', marginBottom: '8px' });
    this.list.append(title, hint);
    // The lines: a legend with their stations.
    for (const l of opts.lines) {
      const h = document.createElement('div');
      h.textContent = `${l.letter}  ${l.name}`;
      Object.assign(h.style, { color: `#${l.color.toString(16).padStart(6, '0')}`, margin: '10px 0 4px', fontWeight: 'bold' });
      this.list.append(h);
      for (const st of l.stops) {
        const row = document.createElement('div');
        row.textContent = `${st.code}  ${st.name}`;
        Object.assign(row.style, { color: '#c8c6d8', padding: '1px 8px' });
        this.list.append(row);
      }
    }
    const clear = document.createElement('button');
    clear.textContent = 'Clear GPS destination';
    Object.assign(clear.style, { display: 'block', width: '100%', textAlign: 'left', margin: '2px 0 6px', padding: '5px 8px', background: '#12202a', color: '#8adcff', border: '1px solid #2a4a5a', cursor: 'pointer', font: 'inherit' });
    clear.addEventListener('click', () => opts.mark?.(null));
    this.list.append(clear);
    for (const group of ['Places', 'Zones', 'Expressway'] as const) {
      const h = document.createElement('div');
      h.textContent = group.toUpperCase();
      Object.assign(h.style, { color: '#8a88a0', margin: '10px 0 4px' });
      this.list.append(h);
      for (const d of this.dests.filter((x) => x.group === group)) {
        const btn = document.createElement('button');
        btn.textContent = d.name;
        Object.assign(btn.style, { display: 'block', width: '100%', textAlign: 'left', margin: '2px 0', padding: '5px 8px', background: '#1a1a28', color: '#e8e6f0', border: '1px solid #2e2c44', cursor: 'pointer', font: 'inherit' });
        btn.addEventListener('mouseenter', () => (btn.style.borderColor = '#ff8ad8'));
        btn.addEventListener('mouseleave', () => (btn.style.borderColor = '#2e2c44'));
        // Debug: go there. Otherwise: the GPS takes you there.
        btn.addEventListener('click', () => (opts.travel ? this.go(d) : opts.mark?.({ x: d.x, z: d.z, label: d.name })));
        this.list.append(btn);
      }
    }
    this.root.append(this.canvas, this.list);
    // Clicks inside the map must not reach the page (which would grab the mouse for walking).
    this.root.addEventListener('click', (e) => e.stopPropagation());
    window.addEventListener('resize', () => {
      if (!this.open) return;
      this.resize();
      this.draw();
    });
    document.body.append(this.root);
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  /** Opens fitted to the whole district. */
  show(x: number, z: number, yaw: number): void {
    this.player = { x, z, yaw };
    this.root.style.display = 'flex';
    this.resize();
    const b = this.district.bounds;
    this.cx = (b.minX + b.maxX) / 2;
    this.cz = (b.minZ + b.maxZ) / 2;
    this.zoom = this.fit;
    this.draw();
  }

  /** The district drawn once (at BASE_RES px/m from bounds.min): the phone's Maps app draws from it too. */
  baseImage(): HTMLCanvasElement {
    return (this.base ??= this.drawBase());
  }

  /** The GPS destination and route to draw (null: none). */
  setGps(g: { x: number; z: number; label: string; route: readonly (readonly [number, number])[] | null } | null): void {
    this.gps = g;
    if (this.open) this.draw();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.drag = null;
  }

  /** Canvas backing size from its laid-out size (and the device pixel ratio); the fitted zoom. */
  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    const b = this.district.bounds;
    const M = 28;
    this.fit = Math.min((r.width - 2 * M) / (b.maxX - b.minX), (r.height - 2 * M) / (b.maxZ - b.minZ));
    this.zoom = Math.max(this.fit, this.zoom);
    this.clamp();
  }

  /** Keeps the district in view. */
  private clamp(): void {
    const b = this.district.bounds;
    this.cx = Math.max(b.minX, Math.min(b.maxX, this.cx));
    this.cz = Math.max(b.minZ, Math.min(b.maxZ, this.cz));
  }

  /** CSS pixels on the canvas from world metres, and back. */
  private toScreen(x: number, z: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [r.width / 2 + (x - this.cx) * this.zoom, r.height / 2 + (z - this.cz) * this.zoom];
  }

  private toWorld(sx: number, sy: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [this.cx + (sx - r.width / 2) / this.zoom, this.cz + (sy - r.height / 2) / this.zoom];
  }

  /** The district drawn once at BASE_RES px/m: zone tints, roads, open ground, buildings, stamps. */
  private drawBase(): HTMLCanvasElement {
    const b = this.district.bounds;
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.maxX - b.minX) * BASE_RES);
    c.height = Math.ceil((b.maxZ - b.minZ) * BASE_RES);
    const g = c.getContext('2d')!;
    g.setTransform(BASE_RES, 0, 0, BASE_RES, -b.minX * BASE_RES, -b.minZ * BASE_RES);
    const zoneColor = new Map(this.zones.zones.map((z, i) => [z, ZONE_COLORS[i % ZONE_COLORS.length]]));
    for (const [mx, my] of this.district.cells) {
      const z = this.zones.at(mx, my);
      g.fillStyle = z ? `${zoneColor.get(z)}22` : '#ffffff10';
      g.fillRect(mx * CELL, my * CELL, CELL, CELL);
    }
    for (const [mx, my] of this.district.cells) {
      const p = this.district.plan(mx, my);
      if (!p) continue;
      g.fillStyle = '#2c2c3a';
      for (const r of p.roads) g.fillRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
      // Open ground: parks and playgrounds green, plazas paved, car parks and vacant lots dark.
      for (const o of p.open) {
        g.fillStyle = o.kind === 'park' || o.kind === 'playground' ? '#1f4a2c' : o.kind === 'plaza' ? '#3a3a48' : '#1a1a24';
        g.fillRect(o.rect.x, o.rect.y, o.rect.w, o.rect.h);
      }
      g.fillStyle = '#4a4860';
      for (const q of p.buildings) g.fillRect(q.x - q.w / 2, q.z - q.d / 2, q.w, q.d);
    }
    g.fillStyle = '#ffd070';
    for (const p of this.district.placed) g.fillRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h);
    // The expressway: a green band over the streets it runs above, ramps and spurs thinner.
    for (const r of this.opts.expressway ?? []) {
      g.strokeStyle = r.closed ? '#2fb86a' : '#1f8a50';
      g.lineWidth = r.closed ? 9 : 5;
      g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < r.x.length; i += 4) (i ? g.lineTo(r.x[i], r.z[i]) : g.moveTo(r.x[i], r.z[i]));
      if (r.closed) g.closePath();
      else g.lineTo(r.x[r.x.length - 1], r.z[r.z.length - 1]);
      g.stroke();
    }
    // Railway lines: a band in each line's colour through its stations, a ring at each.
    for (const l of this.opts.lines) {
      const col = `#${l.color.toString(16).padStart(6, '0')}`;
      g.strokeStyle = col;
      g.lineWidth = 7;
      g.lineCap = 'round';
      g.beginPath();
      l.stops.forEach((st, i) => (i ? g.lineTo(st.x, st.z) : g.moveTo(st.x, st.z)));
      g.stroke();
      for (const st of l.stops) {
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(st.x, st.z, 9, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 4;
        g.stroke();
      }
    }
    return c;
  }

  private draw(): void {
    const g = this.canvas.getContext('2d')!;
    const r = this.canvas.getBoundingClientRect();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#0c0c14';
    g.fillRect(0, 0, r.width, r.height);
    this.base ??= this.drawBase();
    const b = this.district.bounds;
    const [x0, y0] = this.toScreen(b.minX, b.minZ);
    g.imageSmoothingEnabled = this.zoom < BASE_RES * 1.5;
    g.drawImage(this.base, x0, y0, (b.maxX - b.minX) * this.zoom, (b.maxZ - b.minZ) * this.zoom);
    // Zone names at the middle of their cells, then destinations and the player, at screen size.
    const zoneColor = new Map(this.zones.zones.map((z, i) => [z, ZONE_COLORS[i % ZONE_COLORS.length]]));
    g.font = "bold 13px 'Consolas', monospace";
    g.textAlign = 'center';
    for (const [z, color] of zoneColor) {
      const cells = this.district.cells.filter(([mx, my]) => this.zones.at(mx, my) === z);
      if (!cells.length) continue;
      const cx = (cells.reduce((t, [mx]) => t + mx, 0) / cells.length + 0.5) * CELL;
      const cz = (cells.reduce((t, [, my]) => t + my, 0) / cells.length + 0.5) * CELL;
      const [sx, sy] = this.toScreen(cx, cz);
      g.fillStyle = color;
      g.fillText(z.name.toUpperCase(), sx, sy - 16);
    }
    // Station labels (code and name).
    g.font = "bold 12px 'Consolas', monospace";
    g.textAlign = 'left';
    for (const l of this.opts.lines) {
      for (const st of l.stops) {
        const [sx, sy] = this.toScreen(st.x, st.z);
        g.fillStyle = `#${l.color.toString(16).padStart(6, '0')}`;
        g.fillText(st.code, sx + 9, sy - 6);
        g.fillStyle = '#e8e6f0';
        g.font = "11px 'Consolas', monospace";
        g.fillText(st.name, sx + 9, sy + 8);
        g.font = "bold 12px 'Consolas', monospace";
      }
    }
    g.font = "12px 'Consolas', monospace";
    g.textAlign = 'left';
    for (const d of this.opts.travel ? this.dests : []) {
      const [x, y] = this.toScreen(d.x, d.z);
      g.fillStyle = d.group === 'Places' ? '#ff8ad8' : d.group === 'Expressway' ? '#2fe38a' : '#4fe3ff';
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
      // Secondary spots of a place ("Yoru Mart (inside)") get a dot, not a second label.
      if (d.group === 'Places' && !d.name.includes('(')) {
        g.fillStyle = '#ffffff';
        g.fillText(d.name, x + 8, y + 4);
      }
    }
    // The GPS: the route in cyan, the destination pin.
    if (this.gps) {
      const G = this.gps;
      if (G.route && G.route.length > 1) {
        g.strokeStyle = 'rgba(90, 220, 255, 0.9)';
        g.lineWidth = 4;
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.beginPath();
        G.route.forEach(([rx, rz], i) => {
          const [sx, sy] = this.toScreen(rx, rz);
          if (i) g.lineTo(sx, sy);
          else g.moveTo(sx, sy);
        });
        g.stroke();
      }
      const [px, py] = this.toScreen(G.x, G.z);
      g.fillStyle = '#5adcff';
      g.beginPath();
      g.moveTo(px, py);
      g.arc(px, py - 16, 8, Math.PI * 0.8, Math.PI * 0.2);
      g.closePath();
      g.fill();
      g.fillStyle = '#0c0c14';
      g.beginPath();
      g.arc(px, py - 16, 3.2, 0, Math.PI * 2);
      g.fill();
      g.font = "bold 12px 'Consolas', monospace";
      g.textAlign = 'center';
      g.fillStyle = '#8adcff';
      g.fillText(G.label, px, py - 30);
    }
    const { x, z, yaw } = this.player;
    const a = (yaw * Math.PI) / 180;
    // Camera yaw: 0 looks north (-z), positive turns to the west.
    const fx = -Math.sin(a);
    const fz = -Math.cos(a);
    const [px, pz] = this.toScreen(x, z);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(px + fx * 11, pz + fz * 11);
    g.lineTo(px - fz * 6 - fx * 5, pz + fx * 6 - fz * 5);
    g.lineTo(px + fz * 6 - fx * 5, pz - fx * 6 - fz * 5);
    g.closePath();
    g.fill();
  }
}
