import type { PhoneApp } from './ui';
import { setWallpaper, wallpaper, WALLPAPERS } from './wallpapers';

/** 壁紙, the phone's wallpaper app: the pictures to choose from, and none; a tap puts one on the home screen. */
export class WallpaperApp implements PhoneApp {
  readonly id = 'wallpaper';
  readonly name = '壁紙';
  readonly icon = '🖼️';
  readonly color = '#c0507a';
  private grid: HTMLDivElement | null = null;

  show(screen: HTMLElement): void {
    injectStyle();
    const root = document.createElement('div');
    root.className = 'wp-root';
    const head = document.createElement('div');
    head.className = 'wp-head';
    head.innerHTML = '<b>壁紙</b><span>Wallpaper</span>';
    const grid = document.createElement('div');
    grid.className = 'wp-grid';
    root.append(head, grid);
    screen.append(root);
    this.grid = grid;
    this.render();
  }

  hide(): void {
    this.grid = null;
  }

  private render(): void {
    const grid = this.grid;
    if (!grid) return;
    grid.innerHTML = '';
    const current = wallpaper()?.id ?? null;
    for (const w of [...WALLPAPERS, null]) {
      const tile = document.createElement('button');
      tile.className = 'wp-tile';
      if ((w?.id ?? null) === current) tile.classList.add('wp-on');
      if (w) tile.style.backgroundImage = `url("${w.url}")`;
      else tile.textContent = 'なし · None';
      tile.addEventListener('click', () => {
        setWallpaper(w?.id ?? null);
        this.render();
      });
      grid.append(tile);
    }
  }
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .wp-root { flex: 1; display: flex; flex-direction: column; min-height: 0; background: #16171e; color: #fff; }
  .wp-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 16px 10px; background: #111218; border-bottom: 1px solid #262833; }
  .wp-head b { font-size: 17px; }
  .wp-head span { font-size: 11px; color: #8a8e9a; }
  .wp-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px; align-content: start; }
  .wp-tile { aspect-ratio: 736 / 1536; border: 2px solid transparent; border-radius: 10px; padding: 0; cursor: pointer; font: inherit; font-size: 11px; color: #cfcde0;
    background: radial-gradient(ellipse at 30% 0%, #5a2a6a, transparent 60%), radial-gradient(ellipse at 80% 100%, #1a4a6a, transparent 60%), #14121e; background-size: cover; background-position: center; }
  .wp-tile:hover { filter: brightness(1.12); }
  .wp-on { border-color: #ff7fa8; box-shadow: 0 0 0 1px #ff7fa8; }`;
  document.head.append(s);
}
