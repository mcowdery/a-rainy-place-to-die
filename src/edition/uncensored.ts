import { askAge } from './ageGate';
import type { Edition } from './types';

/**
 * The uncensored edition: the overlays in adult/ (see types.ts). Only the uncensored build imports this (through
 * the `@edition` alias), so only it bundles adult/. Without the folder every glob is empty and it plays as standard.
 */
const vnScenes = import.meta.glob('../../adult/content/vn/*/scene.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const vnAssets = import.meta.glob('../../adult/content/vn/*/assets/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const phoneFiles = import.meta.glob('../../adult/content/phone/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const phoneMedia = import.meta.glob('../../adult/content/phone/media/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const after = (root: string, files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([p, v]) => [p.slice(p.indexOf(root) + root.length), v]));

export const edition: Edition = {
  name: 'uncensored',
  ageGate: askAge,
  vnScenes: Object.fromEntries(Object.entries(vnScenes).map(([p, v]) => [p.split('/').slice(-2, -1)[0], v])),
  vnAssets: after('adult/content/vn/', vnAssets),
  phoneFiles: after('adult/content/phone/', phoneFiles),
  phoneMedia: after('adult/content/phone/', phoneMedia),
};
