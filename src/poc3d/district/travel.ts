import { CELL } from './plan';
import type { Node3 } from './stamps';
import type { District } from './world';
import type { ZoneMap } from './zones';

/**
 * Fast travel: a map of the district (zones, streets, buildings, named places) with destinations you
 * click to jump to. Destinations are every named spawn node (stamps: the crossing, Bar Kanpai, Yoru Mart,
 * the shrine...) plus one street spot per zone. M opens it, Esc or M closes it.
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

export class TravelMap {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scale: number;
  private readonly ox: number;
  private readonly oz: number;
  private player: { x: number; z: number; yaw: number } = { x: 0, z: 0, yaw: 0 };
  private base: ImageData | null = null;

  constructor(
    private readonly district: District,
    private readonly zones: ZoneMap,
    private readonly dests: readonly Destination[],
    private readonly go: (d: Destination) => void,
  ) {
    const b = district.bounds;
    const W = 640;
    const H = 460;
    const M = 24;
    this.scale = Math.min((W - 2 * M) / (b.maxX - b.minX), (H - 2 * M) / (b.maxZ - b.minZ));
    this.ox = M + (W - 2 * M - (b.maxX - b.minX) * this.scale) / 2 - b.minX * this.scale;
    this.oz = M + (H - 2 * M - (b.maxZ - b.minZ) * this.scale) / 2 - b.minZ * this.scale;

    this.root = document.createElement('div');
    this.root.id = 'travel';
    Object.assign(this.root.style, {
      position: 'fixed', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center', gap: '16px',
      background: 'rgba(4, 4, 10, 0.72)', zIndex: '20', font: "13px 'Consolas', monospace", color: '#e8e6f0',
    } satisfies Partial<CSSStyleDeclaration>);
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    Object.assign(this.canvas.style, { border: '1px solid #3a3850', background: '#0c0c14', cursor: 'pointer', maxWidth: '62vw' });
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const py = ((e.clientY - r.top) / r.height) * H;
      let best: Destination | null = null;
      let bestD = 18;
      for (const d of this.dests) {
        const dd = Math.hypot(this.sx(d.x) - px, this.sz(d.z) - py);
        if (dd < bestD) [best, bestD] = [d, dd];
      }
      if (best) this.go(best);
    });
    const list = document.createElement('div');
    Object.assign(list.style, { width: '260px', maxHeight: '460px', overflowY: 'auto', background: '#0c0c14', border: '1px solid #3a3850', padding: '10px 12px' });
    const title = document.createElement('div');
    title.textContent = 'FAST TRAVEL  ·  M / Esc to close';
    Object.assign(title.style, { color: '#ff8ad8', marginBottom: '8px', letterSpacing: '1px' });
    list.append(title);
    for (const group of ['Places', 'Zones'] as const) {
      const h = document.createElement('div');
      h.textContent = group.toUpperCase();
      Object.assign(h.style, { color: '#8a88a0', margin: '10px 0 4px' });
      list.append(h);
      for (const d of this.dests.filter((x) => x.group === group)) {
        const btn = document.createElement('button');
        btn.textContent = d.name;
        Object.assign(btn.style, { display: 'block', width: '100%', textAlign: 'left', margin: '2px 0', padding: '5px 8px', background: '#1a1a28', color: '#e8e6f0', border: '1px solid #2e2c44', cursor: 'pointer', font: 'inherit' });
        btn.addEventListener('mouseenter', () => (btn.style.borderColor = '#ff8ad8'));
        btn.addEventListener('mouseleave', () => (btn.style.borderColor = '#2e2c44'));
        btn.addEventListener('click', () => this.go(d));
        list.append(btn);
      }
    }
    this.root.append(this.canvas, list);
    // Clicks inside the map must not reach the page (which would grab the mouse for walking).
    this.root.addEventListener('click', (e) => e.stopPropagation());
    document.body.append(this.root);
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  show(x: number, z: number, yaw: number): void {
    this.player = { x, z, yaw };
    this.root.style.display = 'flex';
    this.draw();
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private sx(x: number): number {
    return this.ox + x * this.scale;
  }

  private sz(z: number): number {
    return this.oz + z * this.scale;
  }

  private draw(): void {
    const g = this.canvas.getContext('2d')!;
    const k = this.scale;
    if (!this.base) {
      g.fillStyle = '#0c0c14';
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      const zoneColor = new Map(this.zones.zones.map((z, i) => [z, ZONE_COLORS[i % ZONE_COLORS.length]]));
      for (const [mx, my] of this.district.cells) {
        const z = this.zones.at(mx, my);
        g.fillStyle = z ? `${zoneColor.get(z)}22` : '#ffffff10';
        g.fillRect(this.sx(mx * CELL), this.sz(my * CELL), CELL * k, CELL * k);
      }
      for (const [mx, my] of this.district.cells) {
        const p = this.district.plan(mx, my);
        if (!p) continue;
        g.fillStyle = '#2c2c3a';
        for (const r of p.roads) g.fillRect(this.sx(r.rect.x), this.sz(r.rect.y), r.rect.w * k, r.rect.h * k);
        g.fillStyle = '#4a4860';
        for (const b of p.buildings) g.fillRect(this.sx(b.x - b.w / 2), this.sz(b.z - b.d / 2), b.w * k, b.d * k);
      }
      for (const p of this.district.placed) {
        g.fillStyle = '#ffd070';
        g.fillRect(this.sx(p.rect.x), this.sz(p.rect.y), p.rect.w * k, p.rect.h * k);
      }
      // Zone names at the middle of their cells.
      g.font = "bold 12px 'Consolas', monospace";
      g.textAlign = 'center';
      for (const [z, color] of zoneColor) {
        const cells = this.district.cells.filter(([mx, my]) => this.zones.at(mx, my) === z);
        const cx = (cells.reduce((t, [mx]) => t + mx, 0) / cells.length + 0.5) * CELL;
        const cz = (cells.reduce((t, [, my]) => t + my, 0) / cells.length + 0.5) * CELL;
        g.fillStyle = color;
        g.fillText(z.name.toUpperCase(), this.sx(cx), this.sz(cz) - 14);
      }
      this.base = g.getImageData(0, 0, this.canvas.width, this.canvas.height);
    } else {
      g.putImageData(this.base, 0, 0);
    }
    // Destinations and the player.
    g.font = "12px 'Consolas', monospace";
    g.textAlign = 'left';
    for (const d of this.dests) {
      const x = this.sx(d.x);
      const y = this.sz(d.z);
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
    const px = this.sx(x);
    const pz = this.sz(z);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(px + fx * 10, pz + fz * 10);
    g.lineTo(px - fz * 5 - fx * 4, pz + fx * 5 - fz * 4);
    g.lineTo(px + fz * 5 - fx * 4, pz - fx * 5 - fz * 4);
    g.closePath();
    g.fill();
  }
}
