/**
 * The debug menu (` backquote; on the dev server, or with ?debug=1): sections of buttons for testing (the season,
 * the time, the weather, your car, races...), a search box that teleports to any place or node, and a story flag
 * toggle. main.ts supplies the sections; a button's `on` marks the current choice. The menu redraws on every
 * click and while open; keys other than ` and Esc go to its inputs, not the game.
 */
export interface DebugItem {
  readonly label: string;
  readonly run: () => void;
  /** Marks the current choice (the season now, the weather now...). */
  readonly on?: () => boolean;
}
export interface DebugSection {
  /** (A function for a title that changes: the clock.) */
  readonly title: string | (() => string);
  readonly items: () => readonly DebugItem[];
}
export interface DebugHit {
  readonly label: string;
  readonly detail?: string;
  readonly go: () => void;
}

export class DebugMenu {
  open = false;
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly results: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly flagIn: HTMLInputElement;
  private readonly flagOut: HTMLDivElement;
  private hits: readonly DebugHit[] = [];

  constructor(
    private readonly sections: readonly DebugSection[],
    private readonly opts: {
      /** Places and nodes matching the text, best first. */
      find: (q: string) => readonly DebugHit[];
      /** A story flag's value, and setting it. */
      flag: { get: (k: string) => unknown; set: (k: string, v: boolean) => void };
      onOpen?: () => void;
      onClose?: () => void;
    },
  ) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed', top: '12px', right: '12px', bottom: '12px', width: '360px', zIndex: '45', display: 'none',
      overflowY: 'auto', background: 'rgba(10, 12, 16, 0.94)', color: '#dfe6e2', border: '1px solid #2f4a3c',
      borderRadius: '8px', padding: '12px 14px', font: "12px 'Consolas', monospace", boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
    });
    const head = document.createElement('div');
    head.textContent = 'DEBUG  ·  ` or Esc to close';
    Object.assign(head.style, { color: '#7cffb0', fontWeight: '700', letterSpacing: '0.1em', marginBottom: '8px' });
    this.body = document.createElement('div');
    Object.assign(this.body.style, { display: 'grid', gap: '10px' });

    // Teleport: type, Enter goes to the first hit (or click one).
    const tp = this.section('Teleport');
    this.search = this.input('place, zone or node id (kopo.room_201)...');
    this.results = document.createElement('div');
    Object.assign(this.results.style, { display: 'grid', gap: '3px', marginTop: '4px' });
    this.search.addEventListener('input', () => this.find());
    this.search.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.hits[0]) this.go(this.hits[0]);
    });
    tp.append(this.search, this.results);

    // A story flag: type its name, Enter toggles it.
    const fl = this.section('Story flag');
    this.flagIn = this.input('flag name, Enter toggles (heard_room_303)');
    this.flagOut = document.createElement('div');
    Object.assign(this.flagOut.style, { opacity: '0.7', marginTop: '4px', minHeight: '1em' });
    this.flagIn.addEventListener('input', () => this.showFlag());
    this.flagIn.addEventListener('keydown', (e) => {
      const k = this.flagIn.value.trim();
      if (e.code !== 'Enter' || !k) return;
      this.opts.flag.set(k, this.opts.flag.get(k) !== true);
      this.showFlag();
    });
    fl.append(this.flagIn, this.flagOut);

    this.root.append(head, this.body, tp.parentElement!, fl.parentElement!);
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
      e.stopImmediatePropagation();
    }, true);
    for (const el of [this.search, this.flagIn]) el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    this.open = true;
    this.root.style.display = 'block';
    this.opts.onOpen?.();
    this.draw();
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

  /** Redraws the buttons (called on each click; main.ts also calls it now and then while open). */
  draw(): void {
    if (!this.open) return;
    this.body.replaceChildren(
      ...this.sections.map((s) => {
        const row = this.section(typeof s.title === 'string' ? s.title : s.title());
        Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' });
        for (const it of s.items()) {
          const on = it.on?.() ?? false;
          const b = this.button(it.label, on);
          b.addEventListener('click', () => {
            it.run();
            this.draw();
          });
          row.append(b);
        }
        return row.parentElement!;
      }),
    );
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

  /** A titled block; returns its content element (its parent is the block). */
  private section(title: string): HTMLDivElement {
    const wrap = document.createElement('div');
    const t = document.createElement('div');
    t.textContent = title.toUpperCase();
    Object.assign(t.style, { opacity: '0.55', letterSpacing: '0.12em', marginBottom: '4px', fontSize: '11px' });
    const content = document.createElement('div');
    wrap.append(t, content);
    Object.assign(wrap.style, { marginTop: '6px' });
    return content;
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

  private button(label: string, on: boolean): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      background: on ? '#1f5a3c' : '#1a2020', color: on ? '#eafff2' : 'inherit', border: `1px solid ${on ? '#7cffb0' : '#2f3c38'}`,
      borderRadius: '5px', padding: '4px 8px', font: 'inherit', cursor: 'pointer',
    });
    return b;
  }
}
