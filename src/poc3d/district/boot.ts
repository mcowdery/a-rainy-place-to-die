/**
 * The page's entry: the start screen goes up at once, then the game's code (main.ts, which pulls in the whole
 * engine) loads behind it. If Start is chosen before the city is built, the loading screen shows until it is.
 * The uncensored edition asks its age check first (main.ts), so there the start screen waits for it.
 */
import { startScreen } from './startScreen';

/** The loading screen's picture: for now the start screen's title picture (the shuffled assets/loading/ pictures are set aside). */
const LOADING_ART = new URL('../../../assets/title/title.jpg', import.meta.url).href;
const loadbg = document.getElementById('loadbg');
if (loadbg) loadbg.style.setProperty('--art', `url("${LOADING_ART}")`);

if (__EDITION__ !== 'uncensored') startScreen();
void import('./main');
