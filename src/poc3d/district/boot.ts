/**
 * The page's entry: the start screen goes up at once, then the game's code (main.ts, which pulls in the whole
 * engine) loads behind it. If Start is chosen before the city is built, the loading screen shows until it is.
 * The uncensored edition asks its age check first (main.ts), so there the start screen waits for it.
 */
import { startScreen } from './startScreen';

/** The loading screen's picture: one of the four loading pictures (assets/loading/), shuffled on each load. */
const LOADING_ART = Object.values(import.meta.glob('../../../assets/loading/*.jpg', { eager: true, query: '?url', import: 'default' })) as string[];
const loadbg = document.getElementById('loadbg');
if (loadbg && LOADING_ART.length) loadbg.style.setProperty('--art', `url("${LOADING_ART[Math.floor(Math.random() * LOADING_ART.length)]}")`);

if (__EDITION__ !== 'uncensored') startScreen();
void import('./main');
