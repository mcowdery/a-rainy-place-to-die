import { era, type Era } from './era';

/**
 * The date card: a title that comes up over the picture when a telling begins ("1977", in the film's own era name
 * beneath it), holds, and fades. Shown once, at the start of a memory sequence, not after every load (the user,
 * 2026-10-13: "just start of the memory sequence, but I want to see how it'd look"). **A first look at it:** for now
 * the sequence is the older city's page load, once the title screen has gone (main.ts); when the tellings exist they
 * call `show()` as each begins ([story/threads/the-old-case.md](../../../story/threads/the-old-case.md)).
 *
 * `?eracard=0` turns it off. `__eraCard.show()` (with `?debug=1`) plays it again.
 */

/** What a card says. */
export interface EraCardText {
  /** The big line: the year as it is written in Western numerals. */
  readonly year: string;
  /** Under it: the Japanese era's name and year (昭和五十二年 for 1977), the way a Japanese film would date it. */
  readonly jp: string;
  /** The day, under the year: 十月十四日 · 金曜, as a Japanese date is written. */
  readonly date?: string;
  /** A small line at the foot, if any (a place, a month, a name): the telling's own. */
  readonly note?: string;
}

const NUMERALS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 52 as 五十二, 39 as 三十九: the kanji a date card would use. */
export function kanjiNumber(n: number): string {
  if (n < 10) return NUMERALS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? '' : NUMERALS[tens]}十${ones ? NUMERALS[ones] : ''}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
/** 10, 14, 5 as 十月十四日 · 金曜. */
export function dateText(d: { month: number; day: number; weekday: number }): string {
  return `${kanjiNumber(d.month)}月${kanjiNumber(d.day)}日 · ${WEEKDAYS[d.weekday]}曜`;
}

/** The card for an era: its year, and the Showa year (Showa began in 1926, so 1977 is Showa 52 and 1964 Showa 39), and its day. */
export function cardFor(e: Era, note?: string): EraCardText {
  return { year: String(e.year), jp: `昭和${kanjiNumber(e.year - 1925)}年`, ...(e.date ? { date: dateText(e.date) } : {}), ...(note ? { note } : {}) };
}

/** Seconds: in, held, out. */
export const CARD_TIMES = { in: 1.6, hold: 3.4, out: 2.2 } as const;

/** The card's markup (pure, for the tests and the preview). */
export function cardMarkup(t: EraCardText): string {
  const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `<div class="ec-year">${esc(t.year)}</div><div class="ec-rule"></div><div class="ec-jp">${esc(t.jp)}</div>${t.date ? `<div class="ec-date">${esc(t.date)}</div>` : ''}${t.note ? `<div class="ec-note">${esc(t.note)}</div>` : ''}`;
}

export const CARD_CSS = `
.ec-root { position: fixed; inset: 0; z-index: 18; pointer-events: none; display: flex; align-items: flex-end; justify-content: flex-start; padding: 0 0 12vh 9vw; opacity: 0; }
.ec-root[hidden] { display: none; }
.ec-root::before { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.0) 40%, rgba(0,0,0,.55) 100%), radial-gradient(ellipse at 20% 85%, rgba(0,0,0,.5), transparent 60%); }
.ec-box { position: relative; text-align: left; color: #efe6d2; text-shadow: 0 2px 14px rgba(0,0,0,.85), 0 0 3px rgba(0,0,0,.9); filter: contrast(1.05); }
.ec-year { font: 700 clamp(56px, 11vw, 148px)/0.95 'Yu Mincho', 'MS Mincho', 'Shippori Mincho', serif; letter-spacing: .06em; font-variant-numeric: lining-nums; }
.ec-rule { width: min(260px, 40vw); height: 3px; margin: 14px 0 12px; background: #e6a55a; box-shadow: 0 0 10px rgba(230,165,90,.55); transform: skewX(-30deg); }
.ec-jp { font: 500 clamp(18px, 2.6vw, 34px)/1.2 'Yu Mincho', 'MS Mincho', 'Shippori Mincho', serif; letter-spacing: .5em; color: #e6d6b4; }
.ec-date { margin-top: 8px; font: 500 clamp(15px, 2vw, 26px)/1.2 'Yu Mincho', 'MS Mincho', 'Shippori Mincho', serif; letter-spacing: .4em; color: #d6c39c; }
.ec-note { margin-top: 10px; font: 400 clamp(12px, 1.3vw, 17px)/1.3 'Yu Gothic', 'Meiryo', sans-serif; letter-spacing: .3em; text-transform: uppercase; color: #b9ad95; }
@media (prefers-reduced-motion: reduce) { .ec-root { transition: none !important; } }
`;

export class EraCard {
  private readonly root = document.createElement('div');
  private readonly box = document.createElement('div');
  private timers: number[] = [];
  private styled = false;

  constructor() {
    this.root.className = 'ec-root';
    this.root.hidden = true;
    this.box.className = 'ec-box';
    this.root.append(this.box);
    document.body.append(this.root);
  }

  /** Plays the card for the era being built (or the text given): in, held, out. Nothing for 1992. */
  show(text?: EraCardText): void {
    const e = era();
    const t = text ?? (e.year === 1992 ? null : cardFor(e));
    if (!t) return;
    if (!this.styled) {
      const s = document.createElement('style');
      s.textContent = CARD_CSS;
      document.head.append(s);
      this.styled = true;
    }
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    this.box.innerHTML = cardMarkup(t);
    this.root.hidden = false;
    this.root.style.transition = `opacity ${CARD_TIMES.in}s ease-out`;
    this.root.style.opacity = '0';
    // (A frame for the browser to see it at zero, so the fade in is a fade.)
    this.timers.push(window.setTimeout(() => (this.root.style.opacity = '1'), 40));
    this.timers.push(
      window.setTimeout(() => {
        this.root.style.transition = `opacity ${CARD_TIMES.out}s ease-in`;
        this.root.style.opacity = '0';
      }, (CARD_TIMES.in + CARD_TIMES.hold) * 1000),
    );
    this.timers.push(window.setTimeout(() => (this.root.hidden = true), (CARD_TIMES.in + CARD_TIMES.hold + CARD_TIMES.out) * 1000 + 100));
  }

  get showing(): boolean {
    return !this.root.hidden;
  }
}
