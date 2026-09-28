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
  readonly group: 'Places' | 'Zones';
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

/** Pixels per metre of the pre-drawn district image (zoomed views sample it). */
const BASE_RES = 2;
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

  constructor(
    private readonly district: District,
    private readonly zones: ZoneMap,
    private readonly dests: readonly Destination[],
    private readonly go: (d: Destination) => void,
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
      if (!d || d.moved) return;
      let best: Destination | null = null;
      let bestD = 16;
      for (const t of this.dests) {
        const [sx, sy] = this.toScreen(t.x, t.z);
        const dd = Math.hypot(sx - e.offsetX, sy - e.offsetY);
        if (dd < bestD) [best, bestD] = [t, dd];
      }
      if (best) this.go(best);
    });
    this.list = document.createElement('div');
    Object.assign(this.list.style, { flex: '0 0 260px', overflowY: 'auto', background: '#0c0c14', border: '1px solid #3a3850', padding: '10px 12px' });
    const title = document.createElement('div');
    title.textContent = 'FAST TRAVEL  ·  M / Esc to close';
    Object.assign(title.style, { color: '#ff8ad8', marginBottom: '4px', letterSpacing: '1px' });
    const hint = document.createElement('div');
    hint.textContent = 'wheel zoom · drag pan · click a dot to go';
    Object.assign(hint.style, { color: '#8a88a0', marginBottom: '8px' });
    this.list.append(title, hint);
    for (const group of ['Places', 'Zones'] as const) {
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
        btn.addEventListener('click', () => this.go(d));
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
    g.font = "12px 'Consolas', monospace";
    g.textAlign = 'left';
    for (const d of this.dests) {
      const [x, y] = this.toScreen(d.x, d.z);
      g.fillStyle = d.group === 'Places' ? '#ff8ad8' : '#4fe3ff';
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
      // Secondary spots of a place ("Yoru Mart (inside)") get a dot, not a second label.
      if (d.group === 'Places' && !d.name.includes('(')) {
        g.fillStyle = '#ffffff';
        g.fillText(d.name, x + 8, y + 4);
      }
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
