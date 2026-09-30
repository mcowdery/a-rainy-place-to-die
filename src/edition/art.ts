import { byName } from './types';

/**
 * Kaburo's ad art, all of it (the standard and uncensored editions). The demo has its own set in demo.ts, and must
 * never import this module: its glob would bundle every file.
 */
const files = import.meta.glob('../../assets/ads/kaburo/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const kaburoArt = byName(files);
