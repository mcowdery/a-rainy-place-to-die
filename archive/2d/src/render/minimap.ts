import { CONFIG, walkSeconds } from '../config';
import type { WorldNode } from '../content/nodes';
import type { CellKind, MacroMap } from '../gen/macro';

const COLORS: Record<CellKind, string> = {
  residential: '#7a9a6a',
  tower: '#6a8ab8',
  neon: '#d05aa8',
  oldtown: '#b0845a',
  harbor: '#7a7a82',
  beach: '#d8c890',
  electric: '#e08a4a',
  campus: '#9a8ac8',
  water: '#1a3a5a',
  void: '#0b0b10',
};

const PX = 8;

/** Debug overview of the L0 map with the player and stations; also reports walk times for scale tuning. */
export function drawMinimap(canvas: HTMLCanvasElement, macro: MacroMap, player: { x: number; y: number }, stations: readonly WorldNode[]): void {
  canvas.width = macro.cols * PX;
  canvas.height = macro.rows * PX;
  const c = canvas.getContext('2d')!;
  for (let my = 0; my < macro.rows; my++) {
    for (let mx = 0; mx < macro.cols; mx++) {
      c.fillStyle = COLORS[macro.kindAt(mx, my)];
      c.fillRect(mx * PX, my * PX, PX, PX);
    }
  }
  const at = (x: number, y: number): [number, number] => [(x / CONFIG.cellW) * PX, (y / CONFIG.cellH) * PX];
  c.fillStyle = '#4fe3ff';
  for (const s of stations) {
    const [x, y] = at(s.x, s.y);
    c.fillRect(x - 2, y - 2, 4, 4);
  }
  const [x, y] = at(player.x, player.y);
  c.fillStyle = '#fff';
  c.fillRect(x - 2, y - 2, 5, 5);
}

/** Crossing times at walking pace, for the scale readout. */
export function scaleReport(macro: MacroMap): string {
  const land = (kind: CellKind): boolean => kind !== 'water' && kind !== 'void';
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let my = 0; my < macro.rows; my++) {
    for (let mx = 0; mx < macro.cols; mx++) {
      if (!land(macro.kindAt(mx, my))) continue;
      minX = Math.min(minX, mx); maxX = Math.max(maxX, mx);
      minY = Math.min(minY, my); maxY = Math.max(maxY, my);
    }
  }
  const t = walkSeconds((maxX - minX + 1) * CONFIG.cellW, (maxY - minY + 1) * CONFIG.cellH);
  const cell = walkSeconds(CONFIG.cellW, CONFIG.cellH);
  const m = (s: number): string => `${(s / 60).toFixed(1)} min`;
  return `city on foot: E-W ${m(t.x)}, N-S ${m(t.y)} · one cell: ${cell.x.toFixed(0)} s`;
}
