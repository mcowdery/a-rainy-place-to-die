import type { Edition } from './types';

/** The standard (censored) edition: no overlays. What `@edition` is in every build but the uncensored one. */
export const edition: Edition = { name: 'standard', ageGate: () => Promise.resolve(), vnScenes: {}, vnAssets: {}, phoneFiles: {}, phoneMedia: {} };
