import { describe, expect, it } from 'vitest';
import { cardFor, cardMarkup, dateText, kanjiNumber } from '../src/poc3d/district/eraCard';
import { ERAS } from '../src/poc3d/district/era';

describe('The date card', () => {
  it('writes numbers as kanji the way a date would', () => {
    expect([1, 9, 10, 11, 20, 39, 52].map(kanjiNumber)).toEqual(['一', '九', '十', '十一', '二十', '三十九', '五十二']);
  });
  it('dates each year in its Showa year (Showa began in 1926)', () => {
    expect(cardFor(ERAS['1977'])).toEqual({ year: '1977', jp: '昭和五十二年', date: '十月十四日 · 金曜' });
    expect(cardFor(ERAS['1964'])).toEqual({ year: '1964', jp: '昭和三十九年', date: '十月九日 · 金曜' });
    expect(dateText({ month: 1, day: 1, weekday: 0 })).toBe('一月一日 · 日曜');
    expect(cardFor(ERAS['1977'], 'Kaburo').note).toBe('Kaburo');
  });
  it('puts the day in the markup, and every placeholder date falls on the weekday it says', () => {
    expect(cardMarkup(cardFor(ERAS['1977']))).toContain('ec-date');
    for (const e of [ERAS['1977'], ERAS['1964']]) expect(new Date(Date.UTC(e.year, e.date!.month - 1, e.date!.day)).getUTCDay()).toBe(e.date!.weekday);
  });
  it('escapes what it is given and leaves the note out when there is none', () => {
    expect(cardMarkup({ year: '1977', jp: '昭和五十二年' })).not.toContain('ec-note');
    expect(cardMarkup({ year: '<b>', jp: 'x', note: 'a&b' })).toContain('&lt;b&gt;');
    expect(cardMarkup({ year: '1', jp: 'x', note: 'a&b' })).toContain('a&amp;b');
  });
});
