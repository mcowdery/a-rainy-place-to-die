import { askAge } from './ageGate';
import { kaburoArt } from './art';
import { characters } from './characters';
import { after, byFolder, story } from './story';
import type { Edition } from './types';

/**
 * The uncensored edition: the story, with the overlays in adult/ (see types.ts). Only the uncensored build imports
 * this (through the `@edition` alias), so only it bundles adult/. Without the folder every glob is empty and it
 * plays as standard.
 */
const vnScenes = import.meta.glob('../../adult/content/vn/*/scene.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const vnAssets = import.meta.glob('../../adult/content/vn/*/assets/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const phoneFiles = import.meta.glob('../../adult/content/phone/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const phoneMedia = import.meta.glob('../../adult/content/phone/media/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
// (In file-name order, so the scenes keep their cells from build to build.)
const windowScenes = import.meta.glob('../../adult/content/windows/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export const edition: Edition = {
  name: 'uncensored',
  narrative: true,
  ageGate: askAge,
  story,
  overlay: {
    vnScenes: byFolder(vnScenes),
    vnEntries: {},
    vnAssets: after('adult/content/vn/', vnAssets),
    phoneFiles: after('adult/content/phone/', phoneFiles),
    phoneMedia: after('adult/content/phone/', phoneMedia),
  },
  kaburoArt,
  characters,
  windowScenes: Object.keys(windowScenes).sort().map((k) => windowScenes[k]),
};
