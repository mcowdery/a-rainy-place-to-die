import type { Contact, MsgBody } from './format';
import { type Msg, Phone, type PhoneEvent } from './engine';

/**
 * The phone on screen: the KAIWA messenger (a LINE-style chat app). Tab opens it (the city keeps going; you can
 * still walk), Esc backs out. The chat list, then a thread: their bubbles on the left with their avatar, yours on
 * the right with 既読 once read, photos and videos inline (click for full screen), the typing dots, and your
 * replies as buttons at the bottom (or 1-4). A banner and a ping announce messages that arrive while you're
 * elsewhere; the corner chip shows the unread count.
 */
/**
 * An app on the phone besides KAIWA (the Maps app is one): it draws itself into the screen when opened, runs
 * per frame while showing, and handles Esc itself if it has somewhere to go back to.
 */
export interface PhoneApp {
  readonly id: string;
  readonly name: string;
  /** The icon: a glyph on a colour. */
  readonly icon: string;
  readonly color: string;
  show(screen: HTMLElement): void;
  hide?(): void;
  tick?(dt: number): void;
  /** Esc inside the app: true if it went back within itself, false to go to the home screen. */
  back?(): boolean;
  badge?(): number;
}

export class PhoneUI {
  private readonly root: HTMLDivElement;
  private readonly device: HTMLDivElement;
  private readonly screen: HTMLDivElement;
  private readonly clock: HTMLSpanElement;
  private readonly chip: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly lightbox: HTMLDivElement;
  private open = false;
  private thread: string | null = null;
  /** What's on the screen: the home screen, KAIWA, or another app (its id). */
  private mode = 'home';
  private readonly apps: PhoneApp[] = [];
  private bannerTimer = 0;
  private lastMinute = -1;

  constructor(
    private readonly phone: Phone,
    private readonly url: (path: string) => string,
    private readonly hooks: { onOpen(): void; onClose(): void; onMessage(): void; blocked(): boolean },
  ) {
    injectStyle();
    this.root = el('div', 'ph-root');
    this.device = el('div', 'ph-device');
    const bar = el('div', 'ph-status');
    this.clock = el('span', 'ph-clock');
    bar.append(this.clock, span('ph-icons', '▂▄▆ 4G ▮'));
    this.screen = el('div', 'ph-screen');
    const home = el('div', 'ph-home');
    home.title = 'Home';
    home.addEventListener('click', () => this.showHome());
    this.device.append(bar, this.screen, home);
    this.root.append(this.device);
    this.root.hidden = true;
    this.chip = el('div', 'ph-chip');
    this.banner = el('div', 'ph-banner');
    this.banner.hidden = true;
    this.lightbox = el('div', 'ph-lightbox');
    this.lightbox.hidden = true;
    this.lightbox.addEventListener('click', (e) => {
      if (e.target === this.lightbox) this.closeLightbox();
    });
    document.body.append(this.root, this.chip, this.banner, this.lightbox);
    // Clicks on the phone are the phone's: they mustn't reach the page's click-to-walk (which grabs the mouse).
    for (const e of [this.root, this.lightbox]) for (const type of ['click', 'mousedown', 'pointerdown']) e.addEventListener(type, (ev) => ev.stopPropagation());
    this.updateChip();
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.hooks.blocked()) return;
        if (e.code === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          this.toggle();
          return;
        }
        if (!this.open) return;
        if (e.code === 'Escape') {
          if (!this.lightbox.hidden) this.closeLightbox();
          else if (this.mode === 'kaiwa' && this.thread) this.showList();
          else if (this.mode === 'kaiwa') this.showHome();
          else if (this.mode !== 'home') {
            if (!this.app()?.back?.()) this.showHome();
          } else this.toggle();
        } else if (/^Digit[1-4]$/.test(e.code) && this.mode === 'kaiwa' && this.thread) {
          this.pick(Number(e.code.slice(5)) - 1);
        } else return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Put an app on the home screen. */
  register(app: PhoneApp): void {
    this.apps.push(app);
  }

  /** Open the phone on an app ('kaiwa' or a registered app's id). */
  openApp(id: string): void {
    if (!this.open) this.toggle();
    this.go(id);
  }

  private app(): PhoneApp | undefined {
    return this.apps.find((a) => a.id === this.mode);
  }

  /** Switch what's on the screen, letting the app that was showing go. */
  private go(mode: string): void {
    if (mode !== this.mode) this.app()?.hide?.();
    this.mode = mode;
    if (mode === 'home') this.renderHome();
    else if (mode === 'kaiwa') {
      if (this.thread) this.showThread(this.thread);
      else this.showList();
    } else {
      this.screen.innerHTML = '';
      this.app()?.show(this.screen);
    }
    this.updateChip();
  }

  private showHome(): void {
    this.go('home');
  }

  /** Per frame (with the game's time step): the app on screen, if it runs. */
  tick(dt: number): void {
    if (this.open && this.mode !== 'home' && this.mode !== 'kaiwa') this.app()?.tick?.(dt);
  }

  /** The home screen: the time, then the apps with their badges. */
  private renderHome(): void {
    this.screen.innerHTML = '';
    const home = el('div', 'ph-homescreen');
    const now = Phone.time(this.phone.clock);
    home.append(wrap('div', 'ph-bigclock', [span('ph-bigtime', now), span('ph-bigdate', '東都 · TOTO')]));
    const grid = el('div', 'ph-apps');
    const tiles: { id: string; name: string; icon: string; color: string; badge: number }[] = [
      { id: 'kaiwa', name: 'KAIWA', icon: '💬', color: '#2fbf71', badge: this.phone.totalUnread + this.phone.awaiting },
      ...this.apps.map((a) => ({ id: a.id, name: a.name, icon: a.icon, color: a.color, badge: a.badge?.() ?? 0 })),
    ];
    for (const t of tiles) {
      const b = el('button', 'ph-app');
      const ic = span('ph-app-icon', t.icon);
      ic.style.background = t.color;
      b.append(ic, span('ph-app-name', t.name));
      if (t.badge > 0) b.append(span('ph-badge ph-app-badge', String(t.badge)));
      b.addEventListener('click', () => this.go(t.id));
      grid.append(b);
    }
    home.append(grid);
    this.screen.append(home);
  }

  toggle(): void {
    this.open = !this.open;
    this.root.hidden = !this.open;
    if (this.open) {
      this.hooks.onOpen();
      this.banner.hidden = true;
      clearTimeout(this.bannerTimer);
      this.go(this.mode);
    } else {
      this.closeLightbox();
      this.app()?.hide?.();
      this.hooks.onClose();
    }
    this.updateChip();
  }

  /** Per frame: the clock, and whatever the phone delivered. */
  update(events: readonly PhoneEvent[]): void {
    const minute = Math.floor(this.phone.clock);
    if (minute !== this.lastMinute) {
      this.lastMinute = minute;
      this.clock.textContent = Phone.time(this.phone.clock);
    }
    if (events.length === 0) {
      // The typing dots come and go between deliveries.
      if (this.open && this.thread) this.syncTyping();
      return;
    }
    for (const ev of events) {
      if (ev.kind !== 'message' || ev.msg.from !== 'them') continue;
      const here = this.open && this.mode === 'kaiwa' && this.thread === ev.contact.id;
      const onList = this.open && this.mode === 'kaiwa' && !this.thread;
      if (here) this.phone.markRead(ev.contact.id);
      else if (!onList) {
        // Closed, or reading someone else: a banner. (Open on the chat list, the list shows it.)
        this.hooks.onMessage();
        this.notify(ev.contact, ev.msg);
      }
    }
    if (this.open && this.mode === 'kaiwa') {
      if (this.thread) this.showThread(this.thread);
      else this.showList();
    } else if (this.open && this.mode === 'home') this.renderHome();
    this.updateChip();
  }

  private notify(c: Contact, m: Msg): void {
    this.banner.innerHTML = '';
    this.banner.append(this.avatar(c, 'ph-av-s'), wrap('div', 'ph-banner-text', [span('ph-banner-name', c.name), span('ph-banner-body', preview(m.body))]));
    this.banner.hidden = false;
    this.banner.classList.remove('ph-in');
    void this.banner.offsetWidth;
    this.banner.classList.add('ph-in');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (this.banner.hidden = true), 5000);
    this.chip.classList.remove('ph-buzz');
    void this.chip.offsetWidth;
    this.chip.classList.add('ph-buzz');
  }

  private updateChip(): void {
    const n = this.phone.totalUnread + this.phone.awaiting;
    this.chip.innerHTML = '';
    this.chip.append(span('ph-chip-key', 'Tab'), span('ph-chip-icon', '📱'));
    if (n > 0) this.chip.append(span('ph-badge', String(n)));
    this.chip.classList.toggle('ph-hidden', this.open);
  }

  private showList(): void {
    this.mode = 'kaiwa';
    this.thread = null;
    this.screen.innerHTML = '';
    const head = el('div', 'ph-head');
    const home = el('button', 'ph-back');
    home.textContent = '‹';
    home.addEventListener('click', () => this.showHome());
    head.append(home, span('ph-title', 'KAIWA'), span('ph-sub', 'トーク'));
    const list = el('div', 'ph-list');
    const contacts = this.phone.contacts();
    if (contacts.length === 0) list.append(span('ph-empty', 'No messages yet.'));
    for (const c of contacts) {
      const msgs = this.phone.messages(c.id);
      const last = msgs[msgs.length - 1];
      const row = el('button', 'ph-row');
      const unread = this.phone.unread(c.id);
      const waiting = this.phone.replies(c.id).length > 0;
      const right = el('div', 'ph-row-right');
      right.append(span('ph-row-time', last ? Phone.time(last.at) : ''));
      if (unread) right.append(span('ph-badge', String(unread)));
      else if (waiting) right.append(span('ph-dot', ''));
      row.append(this.avatar(c, 'ph-av'), wrap('div', 'ph-row-mid', [span('ph-row-name', c.name), span('ph-row-last', this.phone.typing(c.id) ? 'typing…' : last ? preview(last.body, last.from === 'me') : waiting ? 'Say something…' : '')]), right);
      row.addEventListener('click', () => this.showThread(c.id));
      list.append(row);
    }
    this.screen.append(head, list);
  }

  private showThread(id: string): void {
    const c = this.phone.contacts().find((x) => x.id === id);
    if (!c) return this.showList();
    this.mode = 'kaiwa';
    const fresh = this.thread !== id;
    const old = this.screen.querySelector('.ph-msgs') as HTMLDivElement | null;
    const atBottom = !old || old.scrollTop + old.clientHeight >= old.scrollHeight - 30;
    this.thread = id;
    this.phone.markRead(id);
    this.screen.innerHTML = '';
    const head = el('div', 'ph-head ph-thread-head');
    const back = el('button', 'ph-back');
    back.textContent = '‹';
    back.addEventListener('click', () => this.showList());
    head.append(back, wrap('div', 'ph-thread-name', [span('ph-title-s', c.name), span('ph-sub', c.status ?? '')]));
    const box = el('div', 'ph-msgs');
    let day = '';
    const msgs = this.phone.messages(id);
    msgs.forEach((m, i) => {
      const stamp = Phone.time(m.at);
      if (!day) {
        day = 'today';
        box.append(span('ph-day', '今日 Today'));
      }
      const mine = m.from === 'me';
      const line = el('div', `ph-line ${mine ? 'ph-me' : 'ph-them'}`);
      const firstOfRun = i === 0 || msgs[i - 1].from !== m.from;
      if (!mine) line.append(firstOfRun ? this.avatar(c, 'ph-av-s') : el('div', 'ph-av-gap'));
      const content = this.body(m.body, mine);
      const meta = el('div', 'ph-meta');
      if (mine && m.seen) meta.append(span('ph-read', '既読'));
      meta.append(span('ph-time', stamp));
      if (mine) line.append(meta, content);
      else line.append(content, meta);
      box.append(line);
    });
    const typing = el('div', 'ph-line ph-them ph-typing-line');
    typing.append(this.avatar(c, 'ph-av-s'), wrap('div', 'ph-bubble ph-typing', [span('', ''), span('', ''), span('', '')]));
    typing.hidden = !this.phone.typing(id);
    box.append(typing);
    const foot = el('div', 'ph-foot');
    const replies = this.phone.replies(id);
    if (replies.length) {
      replies.forEach((r, i) => {
        const b = el('button', 'ph-reply');
        b.textContent = `${i + 1}  ${r.text}`;
        b.addEventListener('click', () => this.pick(i));
        foot.append(b);
      });
    } else foot.append(span('ph-input', this.phone.typing(id) ? '' : 'Aa'));
    this.screen.append(head, box, foot);
    if (fresh || atBottom) box.scrollTop = box.scrollHeight;
    else if (old) box.scrollTop = old.scrollTop;
    // Media loads late: keep the view on the newest message.
    box.querySelectorAll('img, video').forEach((m) => m.addEventListener(m.tagName === 'IMG' ? 'load' : 'loadedmetadata', () => (fresh || atBottom) && (box.scrollTop = box.scrollHeight), { once: true }));
    this.updateChip();
  }

  private syncTyping(): void {
    const t = this.screen.querySelector('.ph-typing-line') as HTMLElement | null;
    if (t && this.thread) t.hidden = !this.phone.typing(this.thread);
  }

  private pick(i: number): void {
    if (!this.thread || !this.phone.reply(this.thread, i)) return;
    this.showThread(this.thread);
  }

  private body(b: MsgBody, mine: boolean): HTMLElement {
    switch (b.kind) {
      case 'text':
        return wrap('div', `ph-bubble ${mine ? 'ph-bubble-me' : ''}`, [document.createTextNode(b.text)]);
      case 'sticker':
        return span('ph-sticker', b.text);
      case 'photo': {
        const img = document.createElement('img');
        img.className = 'ph-photo';
        img.src = this.url(b.media);
        img.addEventListener('click', () => this.openLightbox(b));
        return this.captioned(img, b.caption, mine);
      }
      case 'video': {
        const v = document.createElement('video');
        v.className = 'ph-photo';
        v.src = `${this.url(b.media)}#t=0.1`;
        if (b.poster) v.poster = this.url(b.poster);
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        const frame = wrap('div', 'ph-video', [v, span('ph-play', '▶')]);
        frame.addEventListener('click', () => this.openLightbox(b));
        return this.captioned(frame, b.caption, mine);
      }
    }
  }

  private captioned(media: HTMLElement, caption: string | null, mine: boolean): HTMLElement {
    const box = wrap('div', 'ph-media', [media]);
    if (caption) box.append(wrap('div', `ph-bubble ph-caption ${mine ? 'ph-bubble-me' : ''}`, [document.createTextNode(caption)]));
    return box;
  }

  private openLightbox(b: MsgBody): void {
    this.lightbox.innerHTML = '';
    if (b.kind === 'photo') {
      const img = document.createElement('img');
      img.src = this.url(b.media);
      this.lightbox.append(img);
    } else if (b.kind === 'video') {
      const v = document.createElement('video');
      v.src = this.url(b.media);
      v.controls = true;
      v.autoplay = true;
      v.loop = true;
      v.playsInline = true;
      this.lightbox.append(v);
    } else return;
    const x = el('button', 'ph-lb-close');
    x.textContent = '✕';
    x.addEventListener('click', () => this.closeLightbox());
    this.lightbox.append(x);
    this.lightbox.hidden = false;
  }

  private closeLightbox(): void {
    this.lightbox.querySelectorAll('video').forEach((v) => v.pause());
    this.lightbox.hidden = true;
    this.lightbox.innerHTML = '';
  }

  private avatar(c: Contact, cls: string): HTMLElement {
    const a = el('div', `ph-avatar ${cls}`);
    if (c.avatar) a.style.backgroundImage = `url("${this.url(c.avatar)}")`;
    else {
      a.textContent = [...c.name][0] ?? '?';
      a.style.background = `hsl(${[...c.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)}, 45%, 42%)`;
    }
    return a;
  }
}

/** A one-line preview of a message for the chat list and banners. */
export function preview(b: MsgBody, mine = false): string {
  const you = mine ? 'You: ' : '';
  switch (b.kind) {
    case 'text':
      return you + b.text;
    case 'sticker':
      return `${you}${b.text} Sticker`;
    case 'photo':
      return `${you}📷 Photo`;
    case 'video':
      return `${you}🎥 Video`;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
function span(cls: string, text: string): HTMLSpanElement {
  const s = el('span', cls);
  s.textContent = text;
  return s;
}
function wrap(tag: 'div', cls: string, kids: Node[]): HTMLDivElement {
  const d = el(tag, cls);
  d.append(...kids);
  return d;
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .vn-on .ph-chip, .vn-on .ph-banner, .vn-on .ph-root { visibility: hidden; }
  .ph-root { position: fixed; right: 3vw; bottom: 3vh; z-index: 25; font-family: 'Yu Gothic', 'Meiryo', 'Segoe UI', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif; }
  .ph-root[hidden] { display: none; }
  .ph-device { width: min(360px, 44vh); height: min(740px, 90vh); background: #0c0b10; border-radius: 34px; padding: 12px; box-sizing: border-box;
    box-shadow: 0 0 0 2px #2a2830, 0 18px 60px rgba(0,0,0,0.7), 0 0 40px rgba(255,95,168,0.15); display: flex; flex-direction: column; animation: ph-up 0.22s ease-out; }
  @keyframes ph-up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  .ph-status { display: flex; justify-content: space-between; padding: 4px 16px 6px; color: #f0eef4; font-size: 12px; font-weight: 600; }
  .ph-icons { letter-spacing: 1px; opacity: 0.85; font-size: 10px; }
  .ph-screen { flex: 1; background: #1a1c24; border-radius: 22px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  .ph-home { width: 36%; height: 5px; border-radius: 3px; background: #5a5862; margin: 7px auto 1px; cursor: pointer; }
  .ph-home:hover { background: #8a8892; }
  .ph-homescreen { flex: 1; display: flex; flex-direction: column; background: radial-gradient(ellipse at 30% 0%, #5a2a6a, transparent 60%), radial-gradient(ellipse at 80% 100%, #1a4a6a, transparent 60%), #14121e; padding: 28px 22px; gap: 34px; }
  .ph-bigclock { display: flex; flex-direction: column; align-items: center; color: #fff; }
  .ph-bigtime { font-size: 58px; font-weight: 200; letter-spacing: 2px; line-height: 1; }
  .ph-bigdate { font-size: 12px; color: #d8c8e8; letter-spacing: 3px; margin-top: 6px; }
  .ph-apps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px 10px; }
  .ph-app { position: relative; background: none; border: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; font: inherit; padding: 0; }
  .ph-app-icon { width: 54px; height: 54px; border-radius: 15px; display: flex; align-items: center; justify-content: center; font-size: 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .ph-app:hover .ph-app-icon { filter: brightness(1.15); }
  .ph-app-name { color: #f0eef6; font-size: 11px; }
  .ph-app-badge { position: absolute; top: -5px; right: 4px; }
  .ph-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 16px 10px; background: #111218; color: #fff; border-bottom: 1px solid #262833; }
  .ph-title { font-weight: 800; font-size: 20px; letter-spacing: 0.08em; color: #7ef0b0; }
  .ph-sub { font-size: 11px; color: #9a98a8; }
  .ph-list { overflow-y: auto; flex: 1; }
  .ph-empty { display: block; color: #8a889a; text-align: center; margin-top: 40%; font-size: 13px; }
  .ph-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 14px; background: none; border: 0; border-bottom: 1px solid #22242e; cursor: pointer; text-align: left; font: inherit; }
  .ph-row:hover { background: #22242e; }
  .ph-row-mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .ph-row-name { color: #f4f2f8; font-size: 14px; font-weight: 600; }
  .ph-row-last { color: #9a98a8; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ph-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
  .ph-row-time { color: #7a788a; font-size: 10px; }
  .ph-badge { min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: #ff4f6a; color: #fff; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  .ph-dot { width: 9px; height: 9px; border-radius: 50%; background: #7ef0b0; }
  .ph-avatar { flex: none; border-radius: 42%; background-size: cover; background-position: center; color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .ph-av { width: 46px; height: 46px; font-size: 18px; }
  .ph-av-s { width: 32px; height: 32px; font-size: 13px; }
  .ph-av-gap { width: 32px; flex: none; }
  .ph-thread-head { align-items: center; }
  .ph-back { background: none; border: 0; color: #fff; font-size: 30px; line-height: 20px; cursor: pointer; padding: 0 6px 4px 0; }
  .ph-thread-name { display: flex; flex-direction: column; min-width: 0; }
  .ph-title-s { font-size: 15px; font-weight: 700; color: #fff; }
  .ph-msgs { flex: 1; overflow-y: auto; padding: 10px 10px 14px; background: linear-gradient(#2a3244, #242a3a); display: flex; flex-direction: column; gap: 8px; }
  .ph-day { align-self: center; font-size: 10px; color: #dfe4f0; background: rgba(0,0,0,0.25); padding: 2px 10px; border-radius: 10px; margin: 4px 0; }
  .ph-line { display: flex; align-items: flex-end; gap: 6px; }
  .ph-line[hidden] { display: none; }
  .ph-them { justify-content: flex-start; }
  .ph-me { justify-content: flex-end; }
  .ph-them .ph-av-s { align-self: flex-start; }
  .ph-bubble { max-width: 210px; padding: 8px 12px; border-radius: 16px; background: #f4f4f6; color: #1a1a20; font-size: 13.5px; line-height: 1.45; word-wrap: break-word; }
  .ph-them .ph-bubble:not(.ph-caption) { border-top-left-radius: 4px; }
  .ph-bubble-me { background: #7ef0b0; color: #0e2418; border-top-right-radius: 4px; }
  .ph-meta { display: flex; flex-direction: column; align-items: flex-end; font-size: 9.5px; color: #b8c0d4; gap: 1px; }
  .ph-them .ph-meta { align-items: flex-start; }
  .ph-sticker { font-size: 56px; line-height: 1.1; }
  .ph-media { display: flex; flex-direction: column; gap: 4px; max-width: 210px; }
  .ph-photo { width: 210px; max-height: 280px; object-fit: cover; border-radius: 14px; display: block; cursor: zoom-in; background: #111; }
  .ph-video { position: relative; cursor: pointer; }
  .ph-play { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 44px; height: 44px; border-radius: 50%; background: rgba(0,0,0,0.55);
    color: #fff; font-size: 18px; display: flex; align-items: center; justify-content: center; padding-left: 3px; box-sizing: border-box; border: 2px solid rgba(255,255,255,0.8); }
  .ph-typing { display: flex; gap: 4px; padding: 11px 14px; }
  .ph-typing span { width: 7px; height: 7px; border-radius: 50%; background: #8a8e9a; animation: ph-dots 1.1s infinite; }
  .ph-typing span:nth-child(2) { animation-delay: 0.18s; } .ph-typing span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes ph-dots { 0%, 60%, 100% { transform: none; opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
  .ph-foot { padding: 8px 10px 10px; background: #111218; border-top: 1px solid #262833; display: flex; flex-direction: column; gap: 6px; }
  .ph-input { display: block; background: #22242e; color: #6a6878; border-radius: 16px; padding: 7px 14px; font-size: 13px; }
  .ph-reply { font: inherit; font-size: 13px; text-align: left; padding: 8px 12px; border-radius: 16px; border: 1px solid #7ef0b0; background: rgba(126,240,176,0.08); color: #dff8ea; cursor: pointer; }
  .ph-reply:hover { background: rgba(126,240,176,0.22); }
  .ph-chip { position: fixed; right: 18px; bottom: 16px; z-index: 24; display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 16px;
    background: rgba(8,8,14,0.72); border: 1px solid #3a3850; color: #cfcde0; font: 12px 'Consolas', monospace; pointer-events: none; }
  .ph-chip.ph-hidden { display: none; }
  .ph-chip-icon { font-size: 16px; }
  .ph-buzz { animation: ph-buzz 0.5s; }
  @keyframes ph-buzz { 0%, 100% { transform: none; } 20% { transform: translateX(-3px) rotate(-3deg); } 40% { transform: translateX(3px) rotate(3deg); } 60% { transform: translateX(-2px); } 80% { transform: translateX(2px); } }
  .ph-banner { position: fixed; top: 16px; right: 16px; z-index: 26; width: min(340px, 80vw); display: flex; gap: 10px; align-items: center; padding: 10px 12px;
    border-radius: 14px; background: rgba(28,30,38,0.94); box-shadow: 0 8px 30px rgba(0,0,0,0.5); font-family: 'Yu Gothic', 'Meiryo', 'Segoe UI', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif; pointer-events: none; }
  .ph-banner[hidden] { display: none; }
  .ph-in { animation: ph-drop 0.3s ease-out; }
  @keyframes ph-drop { from { transform: translateY(-30px); opacity: 0; } to { transform: none; opacity: 1; } }
  .ph-banner-text { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
  .ph-banner-name { color: #fff; font-size: 13px; font-weight: 700; }
  .ph-banner-body { color: #c8c6d4; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ph-lightbox { position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; }
  .ph-lightbox[hidden] { display: none; }
  .ph-lightbox img, .ph-lightbox video { max-width: 92vw; max-height: 88vh; border-radius: 6px; }
  .ph-lb-close { position: absolute; top: 18px; right: 22px; background: none; border: 0; color: #fff; font-size: 26px; cursor: pointer; }
  `;
  document.head.append(s);
}
