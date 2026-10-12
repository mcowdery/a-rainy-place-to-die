/**
 * The start screen and the pause menu, one look (black, blood red, slanted condensed type, grain and rain, a huge dim 死: dark, urban, yakuza).
 * Start: the title over the loading screen (the city loads behind it), with Start and Credits; it goes when Start is
 * chosen. Skipped for the dev tools: any URL parameter (spawn, time, cam, bench...), `?start=0`, and automated browsers.
 * Pause: opens when the mouse is released (Esc) and freezes the world's clock (`PauseMenu.open`, read by the frame loop).
 * The credits are the ones CREDITS.md section 1 says the game must show, plus the code notices of section 2:
 * **when an entry is added there, add it here.**
 */
import { ANIMAL_CREDITS } from '../real/faunaCredits';
const animalLines = (): string[] => [
  'Models from poly.pizza, rigged and animated for this game',
  'Licensed under Creative Commons: By Attribution 3.0 License (CC0 for those marked)',
  ...ANIMAL_CREDITS.map((c) => `${c.author}${c.licence.startsWith('CC0') ? ' (CC0)' : ''}: ${c.works.join(', ')}`),
];

const CREDITS: { title: string; lines: string[]; link?: string }[] = [
  {
    title: 'Music',
    lines: [
      'Kevin MacLeod (incompetech.com)',
      'Licensed under Creative Commons: By Attribution 4.0 License',
      'Tracks re-encoded and level-adjusted for this game',
      'Tōto Jazz: Backed Vibes Clean · Comfortable Mystery · Cool Vibes · Covert Affair · Dances and Dames · Deadly Roulette · George Street Shuffle · Hard Boiled · I Knew a Guy · Just As Soon · Lobby Time · Shades of Spring · Slow Burn · Walking Along',
      'FM Shiomi: Aces High · AcidJazz · Airport Lounge · Bossa Antigua · Disco con Tutti · Feelin Good · Funkorama · Groove Grove · Late Night Radio · Local Forecast - Elevator · Protofunk · Smooth Lovin · Stringed Disco · Ultralounge',
    ],
    link: 'http://creativecommons.org/licenses/by/4.0/',
  },
  { title: 'Animals', lines: animalLines(), link: 'https://creativecommons.org/licenses/by/3.0/' },
  {
    title: 'Umbrella',
    lines: ['"Umbrella" by Poly by Google (poly.pizza/m/ez4MoDQFgXz)', 'Licensed under Creative Commons: By Attribution 3.0 License', 'Darkened and animated for this game'],
    link: 'https://creativecommons.org/licenses/by/3.0/',
  },
  {
    title: 'Engine sound',
    lines: ['"Car Engine Loop 96kHz, 4s" by qubodup (opengameart.org/content/car-engine-loop-96khz-4s)', '"2002-Honda-F20C" by Tyler Riddle (commons.wikimedia.org/wiki/File:2002-Honda-F20C.ogg)', 'Licensed under Creative Commons: By Attribution 3.0', "Changed: converted, and played at the engine's revs"],
    link: 'https://creativecommons.org/licenses/by/3.0/',
  },
  { title: 'The moon', lines: ["Moon imagery: NASA's Scientific Visualization Studio"] },
  {
    title: 'Motion',
    lines: ['Motion capture data from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.'],
  },
  {
    title: 'Code',
    lines: ['three.js: Copyright © 2010-2026 three.js authors (MIT)', 'yaml: Copyright Eemeli Aro (ISC)'],
  },
];

/** The keys, for the pause menu's Controls page. */
const CONTROLS: [string, string][] = [
  ['W A S D', 'walk'],
  ['Shift', 'run'],
  ['Space', 'jump'],
  ['Mouse', 'look (right button: look closer)'],
  ['E', 'interact'],
  ['H', 'hail a taxi'],
  ['T', 'wait for the time to pass'],
  ['Q', 'first / third person'],
  ['J', 'smoke'],
  ['C', 'squat'],
  ['I', 'invert mouse Y'],
  ['F3', 'the frame-rate text'],
  ['`', 'settings'],
  ['Esc', 'pause'],
];

/** The title picture (assets/title/title.jpg, from art the user approved for the title screen). */
const TITLE_ART = new URL('../../../assets/title/title.jpg', import.meta.url).href;

const CSS = `
.noir { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: flex-start; padding: 0 9vw; text-align: left;
  font-family: 'Arial Narrow', 'Bahnschrift Condensed', Impact, 'Yu Gothic', sans-serif; color: #cfc8c0; overflow: hidden;
  background:
    radial-gradient(ellipse at 78% 50%, rgba(120,12,18,.30) 0%, transparent 55%),
    linear-gradient(180deg, #0b0a0a 0%, #050404 100%); }
.noir.pause { background: radial-gradient(ellipse at 78% 50%, rgba(120,12,18,.22) 0%, transparent 55%), rgba(4,3,3,.88); }
.noir[hidden] { display: none; }
/* grime: film grain, a rain of thin streaks, and a dark vignette */
.noir::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .22; mix-blend-mode: screen;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>");
  animation: noirGrain .5s steps(4) infinite; }
@keyframes noirGrain { 0% { background-position: 0 0; } 25% { background-position: -40px 30px; } 50% { background-position: 30px -50px; } 75% { background-position: -20px -20px; } }
.noir::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(103deg, transparent 0 9px, rgba(255,255,255,.045) 9px 10px); background-size: 140px 100%;
  animation: noirRain .8s linear infinite;
  box-shadow: inset 0 0 22vw rgba(0,0,0,.95); }
@keyframes noirRain { to { background-position: -50px 240px; } }
.noir > div.art { position: absolute; right: 0; top: 0; bottom: 0; width: min(100vh, 70vw); z-index: 0; pointer-events: none;
  background: url("${TITLE_ART}") center / cover no-repeat; filter: saturate(.9) contrast(1.05);
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 38%); mask-image: linear-gradient(90deg, transparent 0%, #000 38%); }
.noir::before { z-index: 1; }
.noir .kanji { position: absolute; right: 7vw; top: 50%; transform: translateY(-50%); z-index: 0; font-size: min(62vh, 38vw); line-height: 1; font-weight: 900;
  color: rgba(150,14,22,.20); font-family: 'Yu Mincho', 'MS Mincho', serif; pointer-events: none; text-shadow: 0 0 40px rgba(150,14,22,.25); }
.noir .tate { position: absolute; right: 3vw; top: 12vh; z-index: 1; writing-mode: vertical-rl; letter-spacing: .5em; font-size: 20px; color: #8e1118;
  font-family: 'Yu Mincho', 'MS Mincho', serif; font-weight: 700; pointer-events: none; }
.noir > div { position: relative; z-index: 2; }
.noir > div.kanji, .noir > div.tate { position: absolute; }
.noir h1 { margin: 0; font-size: clamp(34px, 7.2vw, 96px); line-height: .92; font-weight: 900; letter-spacing: .02em; color: #e6dfd6; text-transform: uppercase;
  transform: skewX(-6deg); text-shadow: 3px 3px 0 #000; }
.noir h1 em { font-style: normal; color: #b0121c; text-shadow: 0 0 14px rgba(176,18,28,.75), 3px 3px 0 #000; animation: noirBuzz 5s infinite; }
@keyframes noirBuzz { 0%, 92%, 96%, 100% { opacity: 1; } 93% { opacity: .35; } 94% { opacity: .9; } 95% { opacity: .25; } }
.noir h1.small { font-size: clamp(26px, 4.4vw, 52px); }
.noir .rule { width: min(360px, 60vw); height: 5px; margin: 16px 0 10px; background: #b0121c; transform: skewX(-30deg); box-shadow: 0 0 12px rgba(176,18,28,.6); }
.noir .sub { margin: 0 0 40px; letter-spacing: .6em; color: #7d756d; font-size: 13px; text-transform: uppercase; min-height: 1em; }
.noir .menu { counter-reset: item; }
.noir button { counter-increment: item; display: block; width: 300px; margin: 4px 0; padding: 10px 14px 10px 12px; font: inherit; font-size: 22px; font-weight: 700;
  letter-spacing: .22em; text-align: left; color: #a9a199; background: transparent; border: 0; border-left: 4px solid #2a2524; cursor: pointer;
  text-transform: uppercase; transform: skewX(-6deg); transition: padding-left .12s, color .12s; }
.noir button::before { content: '0' counter(item); margin-right: 14px; font-size: 12px; color: #6c1015; letter-spacing: .1em; vertical-align: middle; }
.noir button:hover, .noir button:focus-visible { color: #fff; background: linear-gradient(90deg, #8e1118, rgba(142,17,24,.15)); border-left-color: #e02a35;
  padding-left: 26px; outline: none; }
.noir button:hover::before, .noir button:focus-visible::before { color: #f0b0b4; }
.noir button:disabled { opacity: .4; cursor: default; background: transparent; color: #a9a199; padding-left: 12px; }
/* the city's loading, under the menu: its bar moves on the compositor, so it still moves while the page is busy building */
.noir .load { margin-top: 26px; width: 300px; font-size: 12px; letter-spacing: .3em; color: #7d756d; text-transform: uppercase; }
.noir .load i { display: block; position: relative; height: 2px; margin-top: 8px; overflow: hidden; background: rgba(176,18,28,.25); }
.noir .load i::after { content: ''; position: absolute; top: 0; bottom: 0; width: 40%; background: #b0121c; box-shadow: 0 0 8px rgba(176,18,28,.8); animation: noirLoad 1.2s ease-in-out infinite; }
@keyframes noirLoad { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.noir .load.ready { color: #a9a199; }
.noir .load.ready i { display: none; }
.noir .page { max-width: min(640px, 82vw); max-height: 62vh; overflow: auto; margin: 20px 0 14px; padding: 0 22px 0 14px; line-height: 1.55;
  border-left: 1px solid #3a1518; scrollbar-color: #5a1015 transparent; }
.noir .page h2 { margin: 18px 0 4px; font-size: 13px; letter-spacing: .35em; color: #b0121c; font-weight: 700; text-transform: uppercase; }
.noir .page p { margin: 2px 0; color: #a39b92; font-family: Consolas, 'Cascadia Mono', monospace; font-size: 13px; }
.noir .page a { color: #d8d0c6; }
.noir .keys { display: grid; grid-template-columns: 7em 1fr; gap: 3px 16px; font-family: Consolas, 'Cascadia Mono', monospace; font-size: 13px; }
.noir .keys b { font-weight: 700; color: #e6dfd6; letter-spacing: .1em; }
.noir .keys span { color: #a39b92; }
`;

let styled = false;
function addStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: HTMLElement, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** The dressing behind a screen: a huge dim 死 (the title picture on the title screen), and a line down the edge. */
const decorate = (root: HTMLElement, art = false): void => {
  if (art) el('div', undefined, root, 'art');
  else el('div', '死', root, 'kanji');
  el('div', '雨の街に死す', root, 'tate');
};

const button = (box: HTMLElement, label: string, onClick: () => void): HTMLButtonElement => {
  const b = el('button', label, box);
  b.onclick = onClick;
  return b;
};

/** A page of text (credits, controls) with a Back button, replacing what's in `root`. */
function showPage(root: HTMLElement, title: string, fill: (page: HTMLElement) => void, back: () => void): void {
  root.replaceChildren();
  decorate(root);
  const box = el('div', undefined, root);
  el('h1', title, box, 'small');
  el('div', undefined, box, 'rule');
  fill(el('div', undefined, box, 'page'));
  button(box, 'Back', back).focus();
}

function creditsPage(page: HTMLElement): void {
  for (const c of CREDITS) {
    el('h2', c.title, page);
    for (const l of c.lines) el('p', l, page);
    if (c.link) {
      const a = el('a', c.link, el('p', undefined, page));
      a.href = c.link;
      a.target = '_blank';
      a.rel = 'noopener';
    }
  }
}

function controlsPage(page: HTMLElement): void {
  const grid = el('div', undefined, page, 'keys');
  for (const [k, what] of CONTROLS) {
    el('b', k, grid);
    el('span', what, grid);
  }
}

/** Whether the start screen is wanted for this load. */
function wanted(): boolean {
  if (navigator.webdriver) return false;
  return [...new URLSearchParams(location.search).keys()].length === 0;
}

/** `done`: Start was chosen. `ready()`: the city is built (the game waits for both before it runs). `progress`: the loading phase's name. */
type StartScreen = { shown: boolean; done: Promise<void>; ready: () => void; progress: (text: string) => void };
let made: StartScreen | null = null;

/**
 * Shows the start screen (once: boot.ts makes it before the game's code has loaded, main.ts asks for the same one);
 * `done` resolves when Start is chosen, `ready()` is called once the city has loaded.
 */
export function startScreen(): StartScreen {
  return (made ??= makeStartScreen());
}

function makeStartScreen(): StartScreen {
  if (!wanted()) return { shown: false, done: Promise.resolve(), ready: () => {}, progress: () => {} };
  addStyle();
  const root = el('div', undefined, document.body, 'noir');
  let isReady = false;
  let phase = 'loading the city...';
  let status: HTMLElement | null = null;
  const showStatus = (): void => {
    if (!status) return;
    status.className = isReady ? 'load ready' : 'load';
    status.replaceChildren(isReady ? 'Ready' : phase, ...(isReady ? [] : [document.createElement('i')]));
  };
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));

  const menu = (): void => {
    root.replaceChildren();
    decorate(root, true);
    const box = el('div', undefined, root);
    const h = el('h1', undefined, box);
    h.append('A Rainy Place', document.createElement('br'), 'to ');
    el('em', 'Die', h);
    el('div', undefined, box, 'rule');
    el('div', '雨の街 · Tōto', box, 'sub');
    // Start works at once: if the city isn't built yet, the loading screen (the phase and its bar) shows behind it.
    const start = button(box, 'Start', () => {
      root.hidden = true;
      resolve();
    });
    start.parentElement!.classList.add('menu');
    start.dataset.go = 'start';
    button(box, 'Credits', () => showPage(root, 'Credits', creditsPage, menu));
    status = el('div', undefined, box, 'load');
    showStatus();
    start.focus();
  };

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!root.hidden && e.key === 'Escape') menu();
  });

  // A click on the screen is the screen's; the page's click-to-look doesn't see it (Start takes the mouse itself).
  root.addEventListener('click', (e) => e.stopPropagation());
  menu();
  return {
    shown: true,
    done,
    ready: () => {
      isReady = true;
      showStatus();
    },
    progress: (text) => {
      phase = text;
      showStatus();
    },
  };
}

/**
 * The pause menu: Resume, Controls, Credits, Title screen. `open` is read by the frame loop (the clock and the
 * movement stop while it's up). `resume` is what Resume does (take the mouse again).
 */
export class PauseMenu {
  open = false;
  private root: HTMLElement;

  constructor(private resume: () => void) {
    addStyle();
    this.root = el('div', undefined, document.body, 'noir pause');
    this.root.hidden = true;
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.open && e.key === 'Escape') this.close(true);
    });
    // A click inside the menu is the menu's; the page's click-to-look doesn't see it.
    this.root.addEventListener('click', (e) => e.stopPropagation());
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.main();
  }

  close(resume: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    if (resume) this.resume();
  }

  private main(): void {
    const root = this.root;
    root.replaceChildren();
    decorate(root);
    const box = el('div', undefined, root);
    el('h1', 'Paused', box);
    el('div', undefined, box, 'rule');
    el('div', undefined, box, 'sub');
    box.classList.add('menu');
    button(box, 'Resume', () => this.close(true)).focus();
    button(box, 'Controls', () => showPage(root, 'Controls', controlsPage, () => this.main()));
    button(box, 'Credits', () => showPage(root, 'Credits', creditsPage, () => this.main()));
    button(box, 'Title screen', () => {
      location.href = location.pathname;
    });
  }
}
