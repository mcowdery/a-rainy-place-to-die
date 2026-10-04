import { kaburoArt } from './art';
import { characters } from './characters';
import { story } from './story';
import { type Edition, NO_STORY } from './types';

/** The standard (censored) edition: the story, no overlays. What `@edition` is in dev, tests and `vite build`. */
export const edition: Edition = { name: 'standard', narrative: true, ageGate: () => Promise.resolve(), story, overlay: NO_STORY, kaburoArt, characters };
