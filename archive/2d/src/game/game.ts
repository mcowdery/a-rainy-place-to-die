import { CONFIG } from '../config';
import type { Vec } from '../core/coords';
import type { FlagStore } from '../core/flags';
import { FLAG_TIME, FLAG_WEATHER, TIMES, WEATHERS, type Atmosphere, type TimeOfDay, type Weather } from '../atmosphere/atmosphere';
import type { Content } from '../content/load';
import type { WorldNode } from '../content/nodes';
import type { Facing } from '../content/stamps';
import type { CellKind } from '../gen/macro';
import { drawMinimap, scaleReport } from '../render/minimap';
import type { Renderer } from '../render/renderer';
import type { World } from '../world/world';
import type { VnBridge } from './bridge';
import { chooseStation } from './transit';

export interface GameUi {
  readonly hud: HTMLElement;
  readonly minimap: HTMLCanvasElement;
  readonly transit: HTMLElement;
}

const MOVE_KEYS: Readonly<Record<string, Vec>> = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

const FACING: Readonly<Record<Facing, Vec>> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/**
 * Walk mode: real-time grid movement, interaction, and handing off to VN mode / transit.
 * Horizontal and vertical steps have separate timers so diagonal movement and the 1:2 cell aspect
 * (half as many vertical tiles per second) both fall out naturally.
 */
export class Game {
  private mode: 'walk' | 'away' = 'walk';
  private x = 0;
  private y = 0;
  private facing: Vec = [0, 1];
  private held = new Set<string>();
  private nextStepX = 0;
  private nextStepY = 0;
  private fly = false;
  private frames = 0;
  private fps = 0;
  private lastHud = 0;
  private readonly scale: string;

  constructor(
    private readonly content: Content,
    private readonly world: World,
    private readonly flags: FlagStore,
    private readonly renderer: Renderer,
    private readonly bridge: VnBridge,
    private readonly ui: GameUi,
    startSpawn: string = CONFIG.startSpawn,
  ) {
    this.teleport(startSpawn);
    this.scale = scaleReport(content.macro);
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  start(): void {
    const frame = (now: number): void => {
      if (this.mode === 'walk') this.update(now);
      this.renderer.draw({
        world: this.world,
        nodes: this.content.nodes,
        atmosphere: (k) => this.atmosphere(k),
        player: { x: this.x, y: this.y },
        isVisible: (n) => this.isVisible(n),
        now,
      });
      this.frames++;
      if (now - this.lastHud > 250) this.updateHud(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  get time(): TimeOfDay {
    return (this.flags.get(FLAG_TIME) as TimeOfDay | undefined) ?? 'night';
  }

  get weather(): Weather {
    return (this.flags.get(FLAG_WEATHER) as Weather | undefined) ?? 'clear';
  }

  private atmosphere(kind: CellKind): Atmosphere {
    return this.content.atmosphere.resolve(kind, this.time, this.weather);
  }

  private isVisible(n: WorldNode): boolean {
    return n.condition === null || n.condition(this.flags.get);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.mode !== 'walk') return;
    if (e.code in MOVE_KEYS || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    if (e.code in MOVE_KEYS) {
      this.held.add(e.code);
      // A fresh press steps immediately on that axis.
      if (MOVE_KEYS[e.code][0] !== 0) this.nextStepX = 0;
      else this.nextStepY = 0;
      return;
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.held.add(e.code);
    switch (e.code) {
      case 'KeyE': case 'Space': case 'Enter': return this.interact();
      case 'KeyT': return this.flags.set(FLAG_TIME, TIMES[(TIMES.indexOf(this.time) + 1) % TIMES.length]);
      case 'KeyR': return this.flags.set(FLAG_WEATHER, WEATHERS[(WEATHERS.indexOf(this.weather) + 1) % WEATHERS.length]);
      case 'KeyM': this.ui.minimap.hidden = !this.ui.minimap.hidden; return this.updateHud(performance.now());
      case 'KeyF': this.fly = !this.fly; return;
    }
  }

  private update(now: number): void {
    let dx = 0;
    let dy = 0;
    for (const k of this.held) {
      const v = MOVE_KEYS[k];
      if (v) (dx += v[0]), (dy += v[1]);
    }
    dx = Math.sign(dx);
    dy = Math.sign(dy);
    const mult = this.fly ? CONFIG.walk.flyMultiplier : this.held.has('ShiftLeft') || this.held.has('ShiftRight') ? CONFIG.walk.runMultiplier : 1;
    if (dx !== 0 && now >= this.nextStepX) {
      this.step(dx, 0);
      this.nextStepX = now + 1000 / (CONFIG.walk.tilesPerSecX * mult);
    }
    if (dy !== 0 && now >= this.nextStepY && this.mode === 'walk') {
      this.step(0, dy);
      this.nextStepY = now + 1000 / (CONFIG.walk.tilesPerSecY * mult);
    }
  }

  private step(dx: number, dy: number): void {
    this.facing = [dx, dy];
    const nx = this.x + dx;
    const ny = this.y + dy;
    if (!this.fly && !this.canEnter(nx, ny)) return;
    this.x = nx;
    this.y = ny;
    for (const n of this.content.nodes.at(nx, ny)) {
      if (n.trigger === 'step_on' && this.isVisible(n)) return void this.trigger(n);
    }
  }

  private canEnter(x: number, y: number): boolean {
    if (!this.world.isWalkable(x, y)) return false;
    return !this.content.nodes.at(x, y).some((n) => n.kind === 'npc' && this.isVisible(n));
  }

  /** The node the player would interact with: the one faced, else one underfoot. */
  private target(): WorldNode | null {
    const [fx, fy] = this.facing;
    const pick = (x: number, y: number): WorldNode | undefined =>
      this.content.nodes.at(x, y).find((n) => n.trigger === 'interact' && this.isVisible(n));
    return pick(this.x + fx, this.y + fy) ?? pick(this.x, this.y) ?? null;
  }

  private interact(): void {
    const n = this.target();
    if (n) void this.trigger(n);
  }

  private async trigger(n: WorldNode): Promise<void> {
    this.mode = 'away';
    this.held.clear();
    try {
      if (n.kind === 'station') {
        const stations = this.content.nodes.ofKind('station').filter((s) => this.isVisible(s));
        stations.sort((a, b) => (a.placementName ?? a.id).localeCompare(b.placementName ?? b.id));
        const dest = await chooseStation(this.ui.transit, n, stations);
        if (dest?.returnSpawn) this.teleport(dest.returnSpawn);
      } else {
        const result = await this.bridge.enter(n);
        const spawn = result.returnSpawn ?? n.returnSpawn;
        if (spawn) this.teleport(spawn);
      }
    } finally {
      this.mode = 'walk';
    }
  }

  private teleport(spawnId: string): void {
    const n = this.content.nodes.byId.get(spawnId);
    if (!n) throw new Error(`unknown spawn '${spawnId}'`);
    this.x = n.x;
    this.y = n.y;
    if (n.facing) this.facing = FACING[n.facing];
  }

  private updateHud(now: number): void {
    this.fps = Math.round((this.frames * 1000) / Math.max(1, now - this.lastHud));
    this.frames = 0;
    this.lastHud = now;
    const kind = this.world.kindAt(this.x, this.y);
    const mx = Math.floor(this.x / CONFIG.cellW);
    const my = Math.floor(this.y / CONFIG.cellH);
    const t = this.target();
    const verb = t ? ({ npc: 'Talk', door: 'Enter', station: 'Metro', hotspot: 'Use', spawn: '' } as const)[t.kind] : '';
    this.ui.hud.textContent = [
      `${kind.toUpperCase()}  ·  ${this.time} / ${this.weather}${this.fly ? '  ·  FLY' : ''}`,
      `tile [${this.x}, ${this.y}]  cell [${mx}, ${my}]  chunks ${this.world.cachedChunks} cached / ${this.world.chunksGenerated} generated  ·  ${this.fps} fps`,
      t ? `[E] ${verb}: ${t.name ?? t.id}` : ' ',
      'WASD/arrows move · Shift run · E interact · T time · R weather · M map · F fly (debug)',
      ...(this.ui.minimap.hidden ? [] : [this.scale]),
    ].join('\n');
    if (!this.ui.minimap.hidden) {
      drawMinimap(this.ui.minimap, this.content.macro, { x: this.x, y: this.y }, this.content.nodes.ofKind('station'));
    }
  }
}
