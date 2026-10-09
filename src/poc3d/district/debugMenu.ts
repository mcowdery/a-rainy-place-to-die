/**
 * The debug menu (` backquote): everything for testing and tuning under one key, in tabs by subject (the world, time
 * and weather, light and sky, people, the player, sound, graphics). main.ts supplies the tabs; a tab is blocks top to
 * bottom: sections of buttons and sliders (a button's `on` marks the current choice), elements of the page's own (the
 * settings' rows: district/moodPanel.ts), the search box that teleports to any place or node, and the story flag
 * toggle. The tab you were on is remembered. While it's open 1-9 pick a tab, ` or Esc close it, and keys other than
 * the walking ones (WASD, Shift) go to the menu, not the game. It is the only key testing takes: nothing in it has a
 * hotkey of its own, so the rest of the keyboard is the game's.
 */
export interface DebugItem {
  readonly label: string;
  readonly run: () => void;
  /** Marks the current choice (the season now, the weather now...). */
  readonly on?: () => boolean;
}
export interface DebugSlider {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly get: () => number;
  readonly set: (v: number) => void;
  /** The value as shown beside the label. */
  readonly format?: (v: number) => string;
}
export interface DebugSection {
  /** (A function for a title that changes: the clock.) */
  readonly title: string | (() => string);
  readonly items: () => readonly DebugItem[];
  /** Sliders under the buttons (double-click one to reset it to where it was when the menu drew). */
  readonly sliders?: () => readonly DebugSlider[];
}
/** Rows built elsewhere (the settings'), shown as they are under an optional title. */
export interface DebugPanel {
  readonly title?: string;
  readonly element: HTMLElement;
}
export type DebugBlock = DebugSection | DebugPanel | 'teleport' | 'flag';
export interface DebugTab {
  readonly label: string;
  readonly blocks: readonly DebugBlock[];
}
export interface DebugHit {
  readonly label: string;
  readonly detail?: string;
  readonly go: () => void;
}

const TAB_KEY = 'rainyplace.debugTab';
/** Keys the game keeps while the menu is open, so you can walk or drive on while you change things. */
const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']);

export class DebugMenu {
  open = false;
  private readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly results: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly flagIn: HTMLInputElement;
  private readonly flagOut: HTMLDivElement;
  /** Each tab's page, and its sections' content elements (redrawn; the rest of a page is built once). */
  private readonly pages: { page: HTMLDivElement; sections: { def: DebugSection; title: HTMLDivElement; content: HTMLDivElement }[] }[];
  private hits: readonly DebugHit[] = [];
  private current = 0;
  /** What the open tab shows that can change under it (titles, which button is on), brought up to date as it stays open. */
  private live: (() => void)[] = [];

  constructor(
    private readonly tabs: readonly DebugTab[],
    private readonly opts: {
      /** The heading (DEBUG; a build without the debug tabs calls it SETTINGS). */
      title?: string;
      /** Places and nodes matching the text, best first. */
      find: (q: string) => readonly DebugHit[];
      /** A story flag's value, and setting it. */
      flag: { get: (k: string) => unknown; set: (k: string, v: boolean) => void };
      /** Shown under every tab (the settings' reset, save and link). */
      footer?: HTMLElement;
      onOpen?: () => void;
      onClose?: () => void;
    },
  ) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed', top: '12px', right: '12px', bottom: '12px', width: '380px', zIndex: '45', display: 'none',
      flexDirection: 'column', background: 'rgba(10, 12, 16, 0.94)', color: '#dfe6e2', border: '1px solid #2f4a3c',
      borderRadius: '8px', padding: '12px 14px', font: "12px 'Consolas', monospace", boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      boxSizing: 'border-box',
    });
    for (const type of ['click', 'mousedown', 'wheel'] as const) this.root.addEventListener(type, (e) => e.stopPropagation());
    const head = document.createElement('div');
    head.textContent = `${opts.title ?? 'DEBUG'}  ·  \` or Esc to close`;
    Object.assign(head.style, { color: '#7cffb0', fontWeight: '700', letterSpacing: '0.1em', marginBottom: '8px' });
    this.bar = document.createElement('div');
    Object.assign(this.bar.style, { display: 'flex', flexWrap: 'wrap', gap: '4px', paddingBottom: '8px', borderBottom: '1px solid #2f3c38' });
    this.body = document.createElement('div');
    Object.assign(this.body.style, { flex: '1', overflowY: 'auto', minHeight: '0', paddingRight: '4px' });

    // Teleport: type, Enter goes to the first hit (or click one).
    const tp = this.block('Teleport');
    this.search = this.input('place, zone or node id (kopo.room_201)...');
    this.results = document.createElement('div');
    Object.assign(this.results.style, { display: 'grid', gap: '3px', marginTop: '4px' });
    this.search.addEventListener('input', () => this.find());
    this.search.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.hits[0]) this.go(this.hits[0]);
    });
    tp.content.append(this.search, this.results);

    // A story flag: type its name, Enter toggles it.
    const fl = this.block('Story flag');
    this.flagIn = this.input('flag name, Enter toggles');
    this.flagOut = document.createElement('div');
    Object.assign(this.flagOut.style, { opacity: '0.7', marginTop: '4px', minHeight: '1em' });
    this.flagIn.addEventListener('input', () => this.showFlag());
    this.flagIn.addEventListener('keydown', (e) => {
      const k = this.flagIn.value.trim();
      if (e.code !== 'Enter' || !k) return;
      this.opts.flag.set(k, this.opts.flag.get(k) !== true);
      this.showFlag();
    });
    fl.content.append(this.flagIn, this.flagOut);

    this.pages = tabs.map((tab) => {
      const page = document.createElement('div');
      Object.assign(page.style, { display: 'none' });
      const sections: { def: DebugSection; title: HTMLDivElement; content: HTMLDivElement }[] = [];
      for (const b of tab.blocks) {
        if (b === 'teleport') page.append(tp.wrap);
        else if (b === 'flag') page.append(fl.wrap);
        else if ('element' in b) {
          const blk = this.block(b.title ?? '');
          if (!b.title) blk.title.style.display = 'none';
          blk.content.append(b.element);
          page.append(blk.wrap);
        } else {
          const blk = this.block('');
          Object.assign(blk.content.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' });
          sections.push({ def: b, title: blk.title, content: blk.content });
          page.append(blk.wrap);
        }
      }
      this.body.append(page);
      return { page, sections };
    });
    tabs.forEach((tab, i) => {
      const b = this.button(`${i + 1} ${tab.label}`, false);
      b.addEventListener('click', () => this.pick(i));
      this.bar.append(b);
    });
    try {
      this.current = Math.max(0, tabs.findIndex((t) => t.label === localStorage.getItem(TAB_KEY)));
    } catch {
      // Storage blocked: the first tab.
    }

    this.root.append(head, this.bar, this.body);
    if (opts.footer) {
      Object.assign(opts.footer.style, { borderTop: '1px solid #2f3c38', paddingTop: '8px', marginTop: '8px' });
      this.root.append(opts.footer);
    }
    document.body.append(this.root);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.toggle();
        return;
      }
      if (!this.open) return;
      if (e.code === 'Escape') {
        e.stopImmediatePropagation();
        this.hide();
        return;
      }
      // Typing in the menu's boxes: theirs alone (they stop it before the game's handlers see it).
      if (e.target === this.search || e.target === this.flagIn) return;
      if (WALK_KEYS.has(e.code)) return;
      e.stopImmediatePropagation();
      const n = /^Digit([1-9])$/.exec(e.code);
      if (n && Number(n[1]) <= this.tabs.length) this.pick(Number(n[1]) - 1);
    }, true);
    for (const el of [this.search, this.flagIn]) el.addEventListener('keydown', (e) => e.stopPropagation());
    // (Titles and which button is on can change under an open menu: the clock, the forecast's weather.)
    setInterval(() => {
      if (this.open) for (const f of this.live) f();
    }, 500);
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  /** Opens the menu, on the tab of that name if one is given. */
  show(tab?: string): void {
    const i = tab === undefined ? -1 : this.tabs.findIndex((t) => t.label === tab);
    if (i >= 0) this.current = i;
    this.open = true;
    this.root.style.display = 'flex';
    this.opts.onOpen?.();
    this.pick(this.current);
    this.find();
    this.showFlag();
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
    this.search.blur();
    this.flagIn.blur();
    this.opts.onClose?.();
  }

  /** Shows a tab. */
  private pick(i: number): void {
    this.current = i;
    try {
      localStorage.setItem(TAB_KEY, this.tabs[i].label);
    } catch {
      // Storage blocked: not remembered.
    }
    this.pages.forEach((p, k) => (p.page.style.display = k === i ? 'block' : 'none'));
    [...this.bar.children].forEach((b, k) => this.mark(b as HTMLButtonElement, k === i));
    this.body.scrollTop = 0;
    this.draw();
  }

  /** Redraws the open tab's buttons (called on each click). */
  draw(): void {
    if (!this.open) return;
    this.live = [];
    for (const s of this.pages[this.current].sections) {
      const def = s.def;
      const title = def.title;
      s.title.textContent = (typeof title === 'string' ? title : title()).toUpperCase();
      if (typeof title !== 'string') this.live.push(() => (s.title.textContent = title().toUpperCase()));
      const row: HTMLElement[] = [];
      for (const it of def.items()) {
        const b = this.button(it.label, it.on?.() ?? false);
        b.addEventListener('click', () => {
          it.run();
          this.draw();
        });
        if (it.on) this.live.push(() => this.mark(b, it.on!()));
        row.push(b);
      }
      for (const sl of def.sliders?.() ?? []) row.push(this.slider(sl));
      s.content.replaceChildren(...row);
    }
  }

  private find(): void {
    const q = this.search.value.trim();
    this.hits = q ? this.opts.find(q).slice(0, 14) : [];
    this.results.replaceChildren(
      ...this.hits.map((h) => {
        const b = this.button(h.detail ? `${h.label}  ·  ${h.detail}` : h.label, false);
        Object.assign(b.style, { textAlign: 'left', width: '100%' });
        b.addEventListener('click', () => this.go(h));
        return b;
      }),
    );
  }

  private go(h: DebugHit): void {
    this.hide();
    h.go();
  }

  private showFlag(): void {
    const k = this.flagIn.value.trim();
    this.flagOut.textContent = k ? `${k} = ${JSON.stringify(this.opts.flag.get(k) ?? null)}` : '';
  }

  /** A titled block: the block, its title and its content element. */
  private block(title: string): { wrap: HTMLDivElement; title: HTMLDivElement; content: HTMLDivElement } {
    const wrap = document.createElement('div');
    const t = document.createElement('div');
    t.textContent = title.toUpperCase();
    Object.assign(t.style, { opacity: '0.55', letterSpacing: '0.12em', marginBottom: '4px', fontSize: '11px' });
    const content = document.createElement('div');
    wrap.append(t, content);
    Object.assign(wrap.style, { marginTop: '12px' });
    return { wrap, title: t, content };
  }

  private input(placeholder: string): HTMLInputElement {
    const i = document.createElement('input');
    i.placeholder = placeholder;
    Object.assign(i.style, {
      width: '100%', boxSizing: 'border-box', background: '#161c1a', color: 'inherit', border: '1px solid #2f4a3c',
      borderRadius: '5px', padding: '6px 8px', font: 'inherit',
    });
    return i;
  }

  /** A labelled range input, full width; it sets as it moves and updates its own label (no redraw, so a drag holds). */
  private slider(sl: DebugSlider): HTMLDivElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { width: '100%', marginTop: '4px' });
    const label = document.createElement('div');
    const fmt = (v: number): string => `${sl.label}  ${sl.format ? sl.format(v) : v.toFixed(2)}`;
    label.textContent = fmt(sl.get());
    const r = document.createElement('input');
    r.type = 'range';
    r.min = String(sl.min);
    r.max = String(sl.max);
    r.step = String(sl.step);
    r.value = String(sl.get());
    const start = sl.get();
    Object.assign(r.style, { width: '100%', accentColor: '#7cffb0' });
    const apply = (v: number): void => {
      sl.set(v);
      label.textContent = fmt(v);
    };
    r.addEventListener('input', () => apply(Number(r.value)));
    r.addEventListener('dblclick', () => {
      r.value = String(start);
      apply(start);
    });
    wrap.append(label, r);
    return wrap;
  }

  private button(label: string, on: boolean): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, { borderRadius: '5px', padding: '4px 8px', font: 'inherit', cursor: 'pointer' });
    this.mark(b, on);
    return b;
  }

  private mark(b: HTMLButtonElement, on: boolean): void {
    Object.assign(b.style, { background: on ? '#1f5a3c' : '#1a2020', color: on ? '#eafff2' : 'inherit', border: `1px solid ${on ? '#7cffb0' : '#2f3c38'}` });
  }
}
