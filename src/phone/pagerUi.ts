import { PAGER_MEMORY, Phone, type Page, type PhoneEvent } from './engine';

/**
 * The pager (ポケベル: story/phone.md), drawn: the approved photograph of it (assets/phone/carry/pager.webp, cut out by
 * scripts/crop_carry.py) with what the device itself shows drawn over it: the digits in its window as seven-segment
 * figures, the memory's count, the red lamp. A pager of the period shows digits and nothing else, so who a page is from
 * is said under it only when he has their card (`Phone.pagedBy`); a number code is read out if its beat says how.
 *
 * It stays in his pocket. When a page comes it beeps and is held up for a few seconds, then put away, leaving a red dot
 * in the corner until he has looked. P takes it out and puts it away; out, [ and ] step through its memory and Backspace
 * erases the page shown.
 */

const PAGER_URL = new URL('../../assets/phone/carry/pager.webp', import.meta.url).href;

/**
 * Where the game draws on the pager's picture: its size, and areas as percentages of it [left, top, width, height].
 * A copy of the pager's entry in assets/phone/carry/layout.json (tests/phone.test.ts holds the two in step).
 */
export const PAGER_AREAS = {
  width: 443,
  height: 277,
  digits: [21.5, 42.5, 61, 13.5],
  lamp: [77.1, 71.5, 4.5, 7.2],
  maker: [9, 14, 34, 7],
} as const;

/** The places in the window. */
export const PAGER_COLS = 12;
/** Seconds the pager is held up when a page comes, before it's put away by itself. */
const HOLD = 9;

/** Which of a figure's seven segments are lit (a top, b upper right, c lower right, d bottom, e lower left, f upper left, g middle). */
const SEGMENTS: Readonly<Record<string, string>> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgecd', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
/** Each segment as a polygon in a 20 x 36 figure. */
const SHAPES: Readonly<Record<string, string>> = {
  a: '3,1 17,1 14.5,4.4 5.5,4.4',
  d: '3,35 17,35 14.5,31.6 5.5,31.6',
  g: '3.5,18 5.5,16.3 14.5,16.3 16.5,18 14.5,19.7 5.5,19.7',
  f: '1,3 4.4,6.2 4.4,15.4 2.2,17.2 1,16',
  b: '19,3 19,16 17.8,17.2 15.6,15.4 15.6,6.2',
  e: '1,20 2.2,18.8 4.4,20.6 4.4,29.8 1,33',
  c: '19,20 19,33 15.6,29.8 15.6,20.6 17.8,18.8',
};

/** The segments lit for a character (none for one a pager can't show). */
export const segmentsOf = (ch: string): string => SEGMENTS[ch] ?? '';

/** The window's figures as SVG: every segment drawn, the lit ones dark and the rest a ghost, as an LCD's are. */
export function digitsSvg(text: string, cols = PAGER_COLS): string {
  let s = `<svg viewBox="0 0 ${cols * 24 + 4} 38" role="img" aria-label="${text.trim() || 'empty'}"><g transform="skewX(-5) translate(5 0)">`;
  for (let i = 0; i < cols; i++) {
    const lit = segmentsOf(text.charAt(i));
    for (const [k, points] of Object.entries(SHAPES)) s += `<polygon points="${points}" transform="translate(${i * 24} 0)" fill="#10160f" opacity="${lit.includes(k) ? 0.88 : 0.06}"/>`;
  }
  return `${s}</g></svg>`;
}

export interface PagerHooks {
  /** The pager's beep (a page has come). */
  readonly beep: () => void;
  /** The pager can't be taken out now (a scene is playing, a menu is up). */
  readonly blocked: () => boolean;
}

const pct = (a: readonly number[]): string => `left:${a[0]}%;top:${a[1]}%;width:${a[2]}%;`;

export class PagerUI {
  private readonly root = document.createElement('div');
  private readonly dot = document.createElement('div');
  private readonly digits = document.createElement('div');
  private readonly lamp = document.createElement('i');
  private readonly memo = document.createElement('span');
  private readonly caption = document.createElement('div');
  /** The page shown (an index into the pager's memory). */
  private at = 0;
  /** Seconds until it's put away by itself (Infinity while he holds it up himself); 0 when it's away. */
  private hold = 0;
  /** A page has come that he hasn't looked at yet. */
  private fresh = false;

  constructor(
    private readonly phone: Phone,
    private readonly hooks: PagerHooks,
  ) {
    injectCss();
    this.root.className = 'pg-root';
    this.root.hidden = true;
    const body = document.createElement('div');
    body.className = 'pg-body';
    const img = document.createElement('img');
    img.src = PAGER_URL;
    img.alt = '';
    const maker = document.createElement('span');
    maker.className = 'pg-maker';
    maker.style.cssText = `left:${PAGER_AREAS.maker[0]}%;top:${PAGER_AREAS.maker[1]}%;`;
    maker.textContent = 'ポケットベル 東和通信';
    this.digits.className = 'pg-digits';
    this.digits.style.cssText = pct(PAGER_AREAS.digits);
    this.memo.className = 'pg-memo';
    this.lamp.className = 'pg-lamp';
    this.lamp.style.cssText = pct(PAGER_AREAS.lamp);
    body.append(img, maker, this.memo, this.digits, this.lamp);
    this.caption.className = 'pg-caption';
    this.root.append(body, this.caption);
    this.dot.className = 'pg-dot';
    this.dot.hidden = true;
    this.dot.textContent = 'P';
    document.body.append(this.root, this.dot);
    window.addEventListener('keydown', (e) => this.key(e));
    this.render();
  }

  /** Whether the pager is out. */
  get open(): boolean {
    return this.hold > 0;
  }

  /** Per frame: pages that came, and the pager putting itself away. */
  update(events: readonly PhoneEvent[], dt: number): void {
    for (const ev of events) {
      if (ev.kind !== 'page') continue;
      this.at = this.phone.pages().length - 1;
      this.fresh = true;
      this.hooks.beep();
      if (!this.hooks.blocked()) this.show(this.hold === Infinity ? Infinity : HOLD);
      else this.render();
    }
    if (this.hold > 0 && this.hold !== Infinity && (this.hold -= dt) <= 0) this.put();
  }

  /** A page from nobody (a test, a wrong number). */
  test(digits: string, reads: string | null = null): void {
    this.update([this.phone.page(digits, reads)], 0);
  }

  private show(seconds: number): void {
    this.hold = seconds;
    this.root.hidden = false;
    this.render();
  }

  private put(): void {
    this.hold = 0;
    this.root.hidden = true;
    this.render();
  }

  private key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) return;
    if (e.code === 'KeyP') {
      if (this.open) this.put();
      else if (!this.hooks.blocked()) {
        this.fresh = false;
        this.show(Infinity);
      }
      return;
    }
    if (!this.open) return;
    const n = this.phone.pages().length;
    if (e.code === 'BracketLeft' && n) this.at = (this.at + n - 1) % n;
    else if (e.code === 'BracketRight' && n) this.at = (this.at + 1) % n;
    else if (e.code === 'Backspace' && n) {
      this.phone.erasePage(this.at);
      this.at = Math.max(0, Math.min(this.at, n - 2));
    } else return;
    // (He's looking at it: it stays out, and nothing is new to him any more.)
    this.fresh = false;
    this.hold = Infinity;
    this.render();
  }

  private render(): void {
    const pages = this.phone.pages();
    this.at = Math.max(0, Math.min(this.at, pages.length - 1));
    const p: Page | undefined = pages[this.at];
    this.digits.innerHTML = digitsSvg(p ? p.digits : '');
    this.memo.textContent = pages.length ? `${this.at + 1}/${pages.length}` : '';
    this.lamp.classList.toggle('pg-on', this.fresh);
    this.dot.hidden = this.open || !this.fresh;
    this.caption.replaceChildren();
    const line = (cls: string, text: string): void => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text;
      this.caption.append(d);
    };
    if (!p) line('pg-who', '受信なし · nothing in its memory');
    else {
      const who = this.phone.pagedBy(p);
      if (p.reads) line('pg-who', `${p.reads} · a number code`);
      else if (who) line('pg-who', `${who.name} · his card has this number`);
      else line('pg-who', '知らない番号 · a number he doesn\'t know');
      line('pg-hint', `${Phone.time(p.at)} · ring it from a telephone`);
    }
    line('pg-keys', `P put away · [ ] memory (${PAGER_MEMORY}) · ⌫ erase`);
  }
}

let cssDone = false;
function injectCss(): void {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
  .vn-on .pg-root, .vn-on .pg-dot { visibility: hidden; }
  .pg-root[hidden], .pg-dot[hidden] { display: none; }
  .pg-root { position: fixed; left: 22px; bottom: 22px; z-index: 24; width: min(30vw, 340px); pointer-events: none; font-family: 'Yu Gothic', 'Meiryo', 'Segoe UI', sans-serif; animation: pg-up 0.22s ease-out; }
  @keyframes pg-up { from { transform: translateY(40%); opacity: 0; } }
  .pg-body { position: relative; aspect-ratio: ${PAGER_AREAS.width} / ${PAGER_AREAS.height}; transform: rotate(-4deg); filter: drop-shadow(6px 12px 9px rgba(0,0,0,.8)); }
  .pg-body img { display: block; width: 100%; height: 100%; filter: brightness(.9) contrast(1.06) sepia(.14) saturate(.92); }
  .pg-digits { position: absolute; mix-blend-mode: multiply; }
  .pg-digits svg { display: block; width: 100%; height: auto; }
  .pg-memo { position: absolute; right: 17%; top: 39.9%; font: 700 7px 'Segoe UI', sans-serif; letter-spacing: .08em; color: #10160f; opacity: .7; }
  .pg-maker { position: absolute; font: 500 7px 'Yu Gothic', 'Meiryo', sans-serif; letter-spacing: .22em; color: #a5a198; opacity: .5; white-space: nowrap; }
  .pg-lamp { position: absolute; aspect-ratio: 1; border-radius: 50%; }
  .pg-lamp.pg-on { background: radial-gradient(circle, #ff8a6e 0 26%, rgba(255,60,40,.85) 44%, transparent 72%); box-shadow: 0 0 12px 4px rgba(255,70,48,.6); animation: pg-blink 0.9s steps(2) infinite; }
  @keyframes pg-blink { 50% { opacity: .25; } }
  .pg-caption { margin: 14px 0 0 6px; color: #e6dfd0; text-shadow: 0 1px 3px #000, 0 0 8px #000; font-size: 14px; line-height: 1.45; }
  .pg-hint { color: #e6a55a; font-size: 13px; }
  .pg-keys { color: #a39c8e; font-size: 11px; letter-spacing: .04em; margin-top: 2px; }
  .pg-dot { position: fixed; left: 22px; bottom: 22px; z-index: 24; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font: 700 12px 'Segoe UI', sans-serif; color: #fff; background: radial-gradient(circle, #ff6a50 0 40%, #a0180e 100%); box-shadow: 0 0 12px 3px rgba(255,70,48,.55); animation: pg-blink 0.9s steps(2) infinite; }
  @media (prefers-reduced-motion: reduce) { .pg-root, .pg-lamp.pg-on, .pg-dot { animation: none; } }
  `;
  document.head.append(s);
}
