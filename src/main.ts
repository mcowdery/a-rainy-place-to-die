import { FlagStore } from './core/flags';
import { FLAG_TIME, FLAG_WEATHER } from './atmosphere/atmosphere';
import { ContentError, loadContent } from './content/load';
import { PlaceholderVnBridge } from './game/bridge';
import { Game } from './game/game';
import { Renderer } from './render/renderer';
import { World } from './world/world';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

try {
  const content = loadContent();
  const world = new World(content.macro, content.placements);
  // Dev/review shortcuts: ?spawn=bar_kanpai.out&time=dusk&weather=rain
  const params = new URLSearchParams(location.search);
  const flags = new FlagStore({ [FLAG_TIME]: params.get('time') ?? 'night', [FLAG_WEATHER]: params.get('weather') ?? 'clear' });
  const renderer = new Renderer($('view'));
  const game = new Game(content, world, flags, renderer, new PlaceholderVnBridge($('vn')), {
    hud: $('hud'),
    minimap: $('minimap'),
    transit: $('transit'),
  }, params.get('spawn') ?? undefined);
  game.start();
} catch (e) {
  const pre = $('errors');
  pre.hidden = false;
  pre.textContent = e instanceof ContentError ? e.message : String((e as Error).stack ?? e);
  throw e;
}
