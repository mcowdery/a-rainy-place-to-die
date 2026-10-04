import { byModel } from './types';

/**
 * The cast's models, all of them (the standard and uncensored editions). The demo has its own set in demo.ts, without
 * DEMO_HIDDEN_CHARACTERS (demoArt.ts), and must never import this module: its glob would bundle every file.
 */
const files = import.meta.glob('../../assets/characters/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const characters = byModel(files);
