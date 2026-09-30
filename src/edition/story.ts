import type { StoryFiles } from './types';

/**
 * The story content, for the editions that have it (standard.ts, uncensored.ts): each Studio export unzipped into
 * content/vn/<story>/ (scene.json, entry_points.json, assets/), and the phone's contacts and media in content/phone/.
 */
const vnScenes = import.meta.glob('../../content/vn/*/scene.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const vnEntries = import.meta.glob('../../content/vn/*/entry_points.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const vnAssets = import.meta.glob('../../content/vn/*/assets/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const phoneFiles = import.meta.glob('../../content/phone/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const phoneMedia = import.meta.glob('../../content/phone/media/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Files keyed by their path after `root` ("content/vn/s12/assets/x.jpg" under "content/vn/" -> "s12/assets/x.jpg"). */
export const after = <T>(root: string, files: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(files).map(([p, v]) => [p.slice(p.indexOf(root) + root.length), v]));
/** Files keyed by their folder ("content/vn/s12/scene.json" -> "s12"). */
export const byFolder = <T>(files: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(files).map(([p, v]) => [p.split('/').slice(-2, -1)[0], v]));

export const story: StoryFiles = {
  vnScenes: byFolder(vnScenes),
  vnEntries: byFolder(vnEntries),
  vnAssets: after('content/vn/', vnAssets),
  phoneFiles: after('content/phone/', phoneFiles),
  phoneMedia: after('content/phone/', phoneMedia),
};
