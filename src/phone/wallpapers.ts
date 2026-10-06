/**
 * The phone's wallpapers: the pictures in assets/phone/wallpapers/ (made from approved art by
 * scripts/crop_wallpapers.py; a file's name is its id), and which one is on the home screen, kept in the browser
 * (localStorage `citypop.phone.wallpaper`; 'none' is the plain home screen).
 */
const files = import.meta.glob('../../assets/phone/wallpapers/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface Wallpaper {
  readonly id: string;
  readonly url: string;
}

export const WALLPAPERS: readonly Wallpaper[] = Object.entries(files)
  .map(([path, url]) => ({ id: path.slice(path.lastIndexOf('/') + 1, -4), url }))
  .sort((a, b) => a.id.localeCompare(b.id));

/** The one a phone starts with. */
export const DEFAULT_WALLPAPER = 'julie_ferry_1';
const KEY = 'citypop.phone.wallpaper';

/** The wallpaper chosen, or null for the plain home screen. */
export function wallpaper(): Wallpaper | null {
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
  } catch {
    // (No storage: the default.)
  }
  if (id === 'none') return null;
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS.find((w) => w.id === DEFAULT_WALLPAPER) ?? null;
}

export function setWallpaper(id: string | null): void {
  try {
    localStorage.setItem(KEY, id ?? 'none');
  } catch {
    // (No storage: it lasts until the page goes.)
  }
}
