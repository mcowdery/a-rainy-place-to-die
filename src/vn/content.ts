import { edition } from '@edition';
import { applyVnOverlays } from '../edition/vnOverlay';
import { VnLibrary } from './engine';

/**
 * The VN stories the build ships: each Studio export (vn-<story>.zip, see format.ts), unzipped into
 * content/vn/<story>/ (scene.json, entry_points.json, assets/), which the edition provides (src/edition/: none in
 * the demo). The uncensored edition lays its overlays (adult/content/vn/, src/edition/vnOverlay.ts) over them.
 */
export function loadVnLibrary(): VnLibrary {
  const { story, overlay } = edition;
  const overlaid = applyVnOverlays(story.vnScenes, overlay.vnScenes);
  const asset = (dir: string, path: string): string | null => overlay.vnAssets[`${dir}/${path}`] ?? story.vnAssets[`${dir}/${path}`] ?? null;
  const lib = new VnLibrary(overlaid.scenes, story.vnEntries, asset);
  lib.errors.push(...overlaid.errors);
  return lib;
}
