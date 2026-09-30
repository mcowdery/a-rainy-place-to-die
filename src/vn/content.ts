import { edition } from '@edition';
import { applyVnOverlays } from '../edition/vnOverlay';
import { VnLibrary } from './engine';

/**
 * The VN stories the game ships: each Studio export (vn-<story>.zip, see format.ts), unzipped into
 * content/vn/<story>/ (scene.json, entry_points.json, assets/). Bundled by Vite. The uncensored edition lays its
 * overlays (adult/content/vn/, src/edition/vnOverlay.ts) over them; the standard edition has none.
 */
const scenes = import.meta.glob('../../content/vn/*/scene.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const entries = import.meta.glob('../../content/vn/*/entry_points.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const assets = import.meta.glob('../../content/vn/*/assets/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const folder = (p: string): string => p.split('/').slice(-2, -1)[0];

export function loadVnLibrary(): VnLibrary {
  const byFolder = <T>(files: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(files).map(([p, v]) => [folder(p), v]));
  const overlaid = applyVnOverlays(byFolder(scenes), edition.vnScenes);
  const asset = (dir: string, path: string): string | null => edition.vnAssets[`${dir}/${path}`] ?? assets[`../../content/vn/${dir}/${path}`] ?? null;
  const lib = new VnLibrary(overlaid.scenes, byFolder(entries), asset);
  lib.errors.push(...overlaid.errors);
  return lib;
}
