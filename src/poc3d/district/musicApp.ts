import type { PhoneApp } from '../../phone/ui';
import { HEADPHONES, type MusicPlayer } from '../real/musicPlayer';
import { clockOf, LIKED, type Playlist, type Song, spanOf } from './musicQueue';

/**
 * NAMI 波, the phone's music app (an invented streaming service): the radio's music as playlists you play as you
 * like (district/musicQueue.ts), played by real/musicPlayer.ts through Mack's noise-cancelling headphones or the
 * phone's speaker. Three screens: the library (the headphones' card, the liked songs, a playlist per station), a
 * playlist (play, shuffle, its songs, a heart on each) and what's playing (the place in the song, which you can
 * click to move, back / play / next, shuffle, repeat, what's up next). A bar at the bottom of the first two
 * shows what's on. The music carries on with the phone put away.
 */
export class MusicApp implements PhoneApp {
  readonly id = 'nami';
  readonly name = 'NAMI';
  readonly icon = '🎵';
  readonly color = '#e8612c';
  private root: HTMLDivElement | null = null;
  private view: 'home' | 'list' | 'now' = 'home';
  /** The playlist open, and the screen `now` was opened from. */
  private open = '';
  private from: 'home' | 'list' = 'home';

  constructor(private readonly player: MusicPlayer) {
    player.onChange = () => this.render();
  }

  show(screen: HTMLElement): void {
    injectStyle();
    this.root = h('div', 'nm-root');
    screen.append(this.root);
    this.render();
  }

  hide(): void {
    this.root = null;
  }

  back(): boolean {
    if (this.view === 'home') return false;
    this.view = this.view === 'now' ? this.from : 'home';
    this.render(true);
    return true;
  }

  /** The place in the song moves without redrawing the screen. */
  tick(): void {
    const root = this.root;
    if (!root) return;
    const p = this.player;
    const at = p.position;
    const of = p.duration;
    for (const fill of root.querySelectorAll<HTMLElement>('.nm-fill')) fill.style.width = `${of > 0 ? Math.min(100, (100 * at) / of) : 0}%`;
    const now = root.querySelector('.nm-at');
    if (now) now.textContent = clockOf(at);
    const end = root.querySelector('.nm-of');
    if (end) end.textContent = clockOf(of);
  }

  private go(view: 'home' | 'list' | 'now', open = this.open): void {
    if (view === 'now' && this.view !== 'now') this.from = this.view;
    this.view = view;
    this.open = open;
    this.render(true);
  }

  private render(top = false): void {
    const root = this.root;
    if (!root) return;
    const scroll = top ? 0 : (root.querySelector('.nm-scroll')?.scrollTop ?? 0);
    root.innerHTML = '';
    if (this.view === 'now' && !this.player.current) this.view = this.from;
    if (this.view === 'list' && !this.player.playlist(this.open)) this.view = 'home';
    if (this.view === 'home') this.home(root);
    else if (this.view === 'list') this.list(root, this.player.playlist(this.open)!);
    else this.now(root);
    const s = root.querySelector('.nm-scroll');
    if (s) s.scrollTop = scroll;
    this.tick();
  }

  private home(root: HTMLElement): void {
    const p = this.player;
    const head = h('div', 'nm-head');
    head.append(h('b', '', 'NAMI'), h('span', 'nm-jp', '波'), h('span', 'nm-sub', 'Music'));
    const scroll = h('div', 'nm-scroll');
    scroll.append(this.device());
    for (const list of [p.playlist(LIKED)!, ...p.playlists]) {
      if (list.id !== LIKED && list.songs.length === 0) continue;
      const row = button('nm-row', () => this.go('list', list.id));
      const text = h('div', 'nm-text');
      text.append(h('b', '', list.name), h('span', '', `${list.jp ? `${list.jp} · ` : ''}${count(list)}`));
      row.append(cover(list, 46), text);
      if (p.queue.playlist === list.id && p.current) row.append(h('span', 'nm-live', p.playing ? '♪' : '‖'));
      scroll.append(row);
    }
    root.append(head, scroll, this.mini());
  }

  /** The headphones: on or off, and their noise cancelling. */
  private device(): HTMLElement {
    const p = this.player;
    const card = h('div', 'nm-device');
    const text = h('div', 'nm-text');
    const name = h('b', 'nm-dev');
    name.innerHTML = ICONS.phones;
    name.append(HEADPHONES);
    text.append(name, h('span', '', p.headphones ? (p.nc ? 'On · noise cancelling while it plays' : 'On · noise cancelling off') : 'Off · playing from the phone’s speaker'));
    const wear = button(`nm-pill${p.headphones ? ' nm-lit' : ''}`, () => p.wear(!p.headphones), p.headphones ? 'On' : 'Off');
    wear.title = 'Put the headphones on, or take them off';
    const nc = button(`nm-pill${p.headphones && p.nc ? ' nm-lit' : ''}`, () => p.setNc(!p.nc), 'NC');
    nc.title = 'Noise cancelling';
    nc.disabled = !p.headphones;
    card.append(text, wear, nc);
    return card;
  }

  private list(root: HTMLElement, list: Playlist): void {
    const p = this.player;
    const head = h('div', 'nm-head');
    head.append(button('nm-back', () => this.go('home'), '‹'), h('b', '', list.name));
    const scroll = h('div', 'nm-scroll');
    const hero = h('div', 'nm-hero');
    const text = h('div', 'nm-text');
    text.append(h('b', '', list.name), h('span', '', list.blurb), h('span', '', `${count(list)} · ${spanOf(list.songs.reduce((a, s) => a + s.seconds, 0))}`));
    hero.append(cover(list, 84), text);
    const actions = h('div', 'nm-actions');
    const play = icon('nm-play', () => p.play(list.id, 0), 'play', 'Play', 'Play');
    const shuffle = icon(
      'nm-ghost',
      () => {
        p.setShuffle(true);
        p.play(list.id, -1);
      },
      'shuffle',
      'Shuffle',
      'Shuffle',
    );
    play.disabled = shuffle.disabled = list.songs.length === 0;
    actions.append(play, shuffle);
    scroll.append(hero, actions);
    if (list.songs.length === 0) scroll.append(h('div', 'nm-empty', list.id === LIKED ? 'Tap the heart on a song to keep it here.' : 'Nothing here.'));
    list.songs.forEach((song, i) => {
      const on = p.queue.playlist === list.id && p.current?.id === song.id;
      const row = h('div', `nm-song${on ? ' nm-on' : ''}`);
      const main = button('nm-songmain', () => p.play(list.id, i));
      const names = h('div', 'nm-text');
      names.append(h('b', '', song.title), h('span', '', song.artist));
      main.append(h('span', 'nm-num', on ? (p.playing ? '♪' : '‖') : String(i + 1)), names, h('span', 'nm-len', clockOf(song.seconds)));
      row.append(main, this.heart(song));
      scroll.append(row);
    });
    root.append(head, scroll, this.mini());
  }

  private heart(song: Song): HTMLButtonElement {
    const liked = this.player.isLiked(song.id);
    return icon(`nm-heart${liked ? ' nm-lit' : ''}`, () => this.player.like(song.id), liked ? 'liked' : 'like', liked ? 'Liked' : 'Like');
  }

  /** The bar at the bottom: what's on, play and next; a tap opens it. */
  private mini(): HTMLElement {
    const p = this.player;
    const song = p.current;
    const bar = h('div', 'nm-mini');
    if (!song) {
      bar.classList.add('nm-idle');
      bar.textContent = 'Pick something to play';
      return bar;
    }
    const main = button('nm-minimain', () => this.go('now'));
    const text = h('div', 'nm-text');
    text.append(h('b', '', song.title), h('span', '', `${song.artist}${p.headphones ? '' : ' · speaker'}`));
    main.append(cover(p.playlist(song.station) ?? p.playlists[0], 34), text);
    const line = h('div', 'nm-line');
    line.append(h('div', 'nm-fill'));
    bar.append(main, icon('nm-ctl', () => p.toggle(), p.playing ? 'pause' : 'play', p.playing ? 'Pause' : 'Play'), icon('nm-ctl', () => p.next(), 'next', 'Next'), line);
    return bar;
  }

  private now(root: HTMLElement): void {
    const p = this.player;
    const song = p.current!;
    const head = h('div', 'nm-head');
    head.append(button('nm-back', () => this.back(), '‹'), h('span', 'nm-sub', `Playing from ${p.playlist(p.queue.playlist)?.name ?? 'NAMI'}`));
    const scroll = h('div', 'nm-scroll nm-now');
    const title = h('div', 'nm-title');
    const text = h('div', 'nm-text');
    text.append(h('b', '', song.title), h('span', '', song.artist));
    title.append(text, this.heart(song));
    const seek = h('div', 'nm-seek');
    seek.append(h('div', 'nm-fill'));
    seek.addEventListener('click', (e) => {
      const r = seek.getBoundingClientRect();
      p.seek((e.clientX - r.left) / r.width);
    });
    const times = h('div', 'nm-times');
    times.append(h('span', 'nm-at', '0:00'), h('span', 'nm-of', clockOf(song.seconds)));
    const ctl = h('div', 'nm-ctls');
    const shuffle = icon(`nm-small${p.queue.shuffle ? ' nm-lit' : ''}`, () => p.setShuffle(!p.queue.shuffle), 'shuffle', 'Shuffle');
    const repeat = icon(`nm-small${p.queue.repeat !== 'off' ? ' nm-lit' : ''}`, () => p.cycleRepeat(), p.queue.repeat === 'one' ? 'repeatOne' : 'repeat', `Repeat: ${p.queue.repeat}`);
    ctl.append(shuffle, icon('nm-big', () => p.prev(), 'prev', 'Back'), icon('nm-big nm-main', () => p.toggle(), p.playing ? 'pause' : 'play', p.playing ? 'Pause' : 'Play'), icon('nm-big', () => p.next(), 'next', 'Next'), repeat);
    scroll.append(cover(p.playlist(song.station) ?? p.playlists[0], 180), title, seek, times, ctl, this.device());
    const next = p.queue.upNext(3);
    if (next.length) {
      scroll.append(h('div', 'nm-label', 'Up next'));
      for (const s of next) {
        const row = h('div', 'nm-upnext');
        row.append(h('b', '', s.title), h('span', '', s.artist));
        scroll.append(row);
      }
    }
    root.append(head, scroll);
  }
}

const count = (list: Playlist): string => `${list.songs.length} ${list.songs.length === 1 ? 'song' : 'songs'}`;

function h(tag: string, cls: string, text?: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, click: () => void, text?: string): HTMLButtonElement {
  const b = h('button', cls, text) as unknown as HTMLButtonElement;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    click();
  });
  return b;
}

const svg = (d: string, extra = ''): string => `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" ${extra}><path d="${d}"/></svg>`;
const HEART = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
const REPEAT = 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z';
/** The controls' icons, drawn (emoji come out in colour, and differently in every font). */
const ICONS = {
  play: svg('M8 5v14l11-7z'),
  pause: svg('M6 5h4v14H6zM14 5h4v14h-4z'),
  next: svg('M6 6l8.5 6L6 18zM16 6h2v12h-2z'),
  prev: svg('M18 6l-8.5 6L18 18zM6 6h2v12H6z'),
  shuffle: svg('M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z'),
  repeat: svg(REPEAT),
  repeatOne: svg(`${REPEAT}M13 15V9h-1l-2 1v1h1.5v4H13z`),
  liked: svg(HEART),
  like: svg(HEART, 'style="fill:none;stroke:currentColor;stroke-width:2"'),
  phones: svg('M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z'),
} as const;

/** A button that's an icon, with a label beside it if given. */
function icon(cls: string, click: () => void, name: keyof typeof ICONS, title: string, label?: string): HTMLButtonElement {
  const b = button(`nm-icon ${cls}`, click);
  b.innerHTML = ICONS[name];
  b.title = title;
  if (label) b.append(label);
  return b;
}

/** A playlist's cover: its own two colours and its first character (there's no album art). */
function cover(list: Playlist, size: number): HTMLElement {
  const c = h('div', 'nm-cover', list.id === LIKED ? '♥' : [...(list.jp || list.name)][0]);
  const hue = [...list.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 11);
  c.style.background = list.id === LIKED ? 'linear-gradient(135deg, #5a2bd0, #e8612c)' : `linear-gradient(135deg, hsl(${hue}, 45%, 30%), hsl(${(hue + 50) % 360}, 55%, 14%))`;
  Object.assign(c.style, { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.5)}px`, borderRadius: `${Math.max(4, Math.round(size * 0.08))}px` });
  return c;
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .nm-root { flex: 1; display: flex; flex-direction: column; min-height: 0; background: linear-gradient(#22150f, #121218 38%); color: #fff; }
  .nm-root button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
  .nm-root button:disabled { opacity: 0.35; cursor: default; }
  .nm-icon { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
  .nm-head { display: flex; align-items: baseline; gap: 8px; padding: 14px 16px 10px; }
  .nm-head b { font-size: 17px; letter-spacing: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm-jp { color: #e8612c; font-size: 15px; }
  .nm-sub { font-size: 11px; color: #9a96a4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm-root .nm-back { font-size: 28px; line-height: 18px; padding: 0 8px 2px 0; }
  .nm-scroll { flex: 1; overflow-y: auto; padding: 2px 12px 12px; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
  .nm-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; text-align: left; }
  .nm-text b { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm-text span { font-size: 11px; color: #a09cab; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm-text .nm-dev { display: flex; align-items: center; gap: 6px; overflow: visible; }
  .nm-cover { flex: none; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.86); font-weight: 700; box-shadow: 0 4px 14px rgba(0,0,0,0.45); }
  .nm-device { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px; margin: 2px 0 8px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); }
  .nm-root .nm-pill { flex: none; min-width: 40px; padding: 5px 10px; border-radius: 14px; border: 1px solid #5a5664; font-size: 11px; color: #cfcbd8; }
  .nm-root .nm-pill.nm-lit { background: #e8612c; border-color: #e8612c; color: #fff; }
  .nm-root .nm-row { flex: none; display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px 4px; border-radius: 8px; }
  .nm-row:hover, .nm-song:hover { background: rgba(255,255,255,0.06); }
  .nm-live { color: #e8612c; font-size: 14px; padding-right: 6px; }
  .nm-hero { flex: none; display: flex; align-items: center; gap: 14px; padding: 4px 2px 10px; }
  .nm-hero .nm-text b { font-size: 17px; white-space: normal; }
  .nm-hero .nm-text span { white-space: normal; }
  .nm-actions { flex: none; display: flex; gap: 10px; padding: 0 2px 10px; }
  .nm-root .nm-play, .nm-root .nm-ghost { flex: 1; padding: 9px 0; border-radius: 20px; font-size: 13px; font-weight: 600; }
  .nm-root .nm-play { background: #e8612c; }
  .nm-root .nm-ghost { border: 1px solid #5a5664; }
  .nm-song { flex: none; display: flex; align-items: center; border-radius: 8px; }
  .nm-root .nm-songmain { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 7px 4px; }
  .nm-num { flex: none; width: 20px; text-align: center; font-size: 12px; color: #8a8694; }
  .nm-len { flex: none; font-size: 11px; color: #8a8694; }
  .nm-on .nm-text b, .nm-on .nm-num { color: #ff8a55; }
  .nm-root .nm-heart { flex: none; width: 34px; height: 30px; font-size: 17px; color: #8a8694; }
  .nm-root .nm-heart.nm-lit { color: #ff5f7a; }
  .nm-empty { padding: 26px 10px; text-align: center; font-size: 12px; color: #8a8694; }
  .nm-mini { flex: none; position: relative; display: flex; align-items: center; gap: 4px; margin: 0 8px 8px; padding: 7px 8px 9px; border-radius: 10px; background: #3a2318; }
  .nm-idle { justify-content: center; font-size: 11px; color: #a09cab; background: rgba(255,255,255,0.05); padding: 10px; }
  .nm-root .nm-minimain { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .nm-root .nm-ctl { flex: none; width: 34px; height: 34px; font-size: 22px; }
  .nm-line { position: absolute; left: 8px; right: 8px; bottom: 3px; height: 2px; border-radius: 1px; background: rgba(255,255,255,0.18); overflow: hidden; }
  .nm-fill { height: 100%; width: 0; background: #fff; }
  .nm-now { align-items: stretch; gap: 10px; padding-top: 6px; }
  .nm-now > .nm-cover { align-self: center; margin: 4px 0 6px; }
  .nm-title { flex: none; display: flex; align-items: center; gap: 8px; }
  .nm-title .nm-text b { font-size: 17px; }
  .nm-title .nm-text span { font-size: 12.5px; }
  .nm-seek { flex: none; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.2); overflow: hidden; cursor: pointer; margin-top: 4px; }
  .nm-seek:hover .nm-fill { background: #ff8a55; }
  .nm-times { flex: none; display: flex; justify-content: space-between; font-size: 10.5px; color: #a09cab; margin-top: -4px; }
  .nm-ctls { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 6px; }
  .nm-root .nm-big { width: 46px; height: 46px; font-size: 30px; }
  .nm-root .nm-main { width: 58px; height: 58px; border-radius: 50%; background: #fff; color: #16161c; font-size: 30px; }
  .nm-root .nm-small { width: 34px; height: 34px; font-size: 19px; opacity: 0.45; }
  .nm-root .nm-small.nm-lit { opacity: 1; color: #ff8a55; }
  .nm-label { flex: none; font-size: 11px; letter-spacing: 1px; color: #8a8694; text-transform: uppercase; margin-top: 4px; }
  .nm-upnext { flex: none; display: flex; flex-direction: column; gap: 1px; padding: 3px 0; }
  .nm-upnext b { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm-upnext span { font-size: 11px; color: #a09cab; }`;
  document.head.append(s);
}
