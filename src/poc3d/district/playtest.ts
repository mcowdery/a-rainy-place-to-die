import { BUILD_LABEL } from '../../share';
import { TASK_COUNT, TASK_GROUPS, type Task, type TaskGo } from './playtestTasks';

/**
 * The playtest panel (F1, the shared build only): a list of things to try, each optional and in any order, with a
 * "Take me there" button that sets the place, hour, weather and season for it. It sits on the left so the debug menu
 * (right) can be open beside it. Ticks and the notes box are the tester's own, kept in localStorage; "Save notes"
 * downloads them as a text file to send back. The tasks themselves are playtestTasks.ts.
 */
const DONE_KEY = 'rainyplace.playtest.done';
const NOTES_KEY = 'rainyplace.playtest.notes';
const SEEN_KEY = 'rainyplace.playtest.seen';

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* no storage: ticks last until the page closes */
    }
  },
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: Partial<CSSStyleDeclaration> = {}, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e.style, css);
  if (text) e.textContent = text;
  return e;
};

const PINK = '#ff5fc8';

export class Playtest {
  open = false;
  private readonly root: HTMLDivElement;
  private readonly progress: HTMLSpanElement;
  private readonly notes: HTMLTextAreaElement;
  private readonly done: Set<string>;
  private readonly boxes = new Map<string, HTMLInputElement>();

  constructor(private readonly opts: { go: (g: TaskGo) => void; onOpen?: () => void; onClose?: () => void }) {
    let saved: string[] = [];
    try {
      saved = JSON.parse(store.get(DONE_KEY) ?? '[]') as string[];
    } catch {
      /* start fresh */
    }
    this.done = new Set(saved);

    this.root = el('div', {
      position: 'fixed', top: '12px', left: '12px', bottom: '12px', width: '440px', zIndex: '44', display: 'none', flexDirection: 'column',
      background: 'rgba(12, 10, 18, 0.95)', color: '#dcd8e4', border: `1px solid ${PINK}`, borderRadius: '8px', padding: '12px 14px',
      font: "12px/1.45 'Consolas', monospace", boxShadow: '0 8px 30px rgba(0,0,0,0.5), 0 0 24px rgba(255,95,200,0.25)', boxSizing: 'border-box',
    });
    for (const type of ['click', 'mousedown', 'wheel'] as const) this.root.addEventListener(type, (e) => e.stopPropagation());

    const head = el('div', { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '6px' });
    head.append(el('b', { color: PINK, letterSpacing: '0.08em', fontSize: '14px' }, 'THINGS TO TRY'));
    this.progress = el('span', { color: '#9a96a8' });
    const close = el('button', { marginLeft: 'auto' }, 'close (F1)');
    this.style(close);
    close.addEventListener('click', () => this.hide());
    head.append(this.progress, close);

    const body = el('div', { flex: '1', overflowY: 'auto', minHeight: '0', paddingRight: '4px' });
    body.append(this.intro());
    for (const g of TASK_GROUPS) {
      body.append(el('div', { color: PINK, fontWeight: '700', margin: '14px 0 2px', letterSpacing: '0.06em' }, g.title));
      if (g.blurb) body.append(el('div', { color: '#8a86a0', marginBottom: '4px' }, g.blurb));
      for (const t of g.tasks) body.append(this.row(t));
    }

    const foot = el('div', { borderTop: '1px solid #3a3450', marginTop: '8px', paddingTop: '8px' });
    foot.append(el('div', { color: '#9a96a8', marginBottom: '4px' }, 'Anything you liked, hated or would change? (Optional.)'));
    this.notes = el('textarea', { width: '100%', height: '56px', boxSizing: 'border-box', background: '#0b0a10', color: '#dcd8e4', border: '1px solid #3a3450', font: 'inherit', resize: 'vertical' });
    this.notes.value = store.get(NOTES_KEY) ?? '';
    this.notes.addEventListener('input', () => store.set(NOTES_KEY, this.notes.value));
    const save = el('button', { marginTop: '4px' }, 'Save notes to a file to send back');
    this.style(save);
    save.addEventListener('click', () => this.download());
    foot.append(this.notes, save);

    this.root.append(head, body, foot);
    document.body.append(this.root);
    this.count();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') {
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
      // Typing in the notes: theirs alone. The debug menu's key and the walking keys still reach the game.
      if (e.target === this.notes || e.code === 'Backquote' || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        if (e.target === this.notes) e.stopPropagation();
        return;
      }
      e.stopImmediatePropagation();
    }, true);
  }

  /** The first run opens the panel by itself (once per browser). */
  showFirstTime(): void {
    if (store.get(SEEN_KEY)) return;
    store.set(SEEN_KEY, '1');
    this.show();
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.style.display = 'flex';
    this.opts.onOpen?.();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.style.display = 'none';
    this.opts.onClose?.();
  }

  private style(b: HTMLButtonElement): void {
    Object.assign(b.style, { background: '#1a1626', color: '#e8e4f0', border: `1px solid ${PINK}`, borderRadius: '4px', padding: '3px 9px', font: 'inherit', cursor: 'pointer' });
  }

  private intro(): HTMLElement {
    const d = el('div', { border: '1px solid #3a3450', borderRadius: '6px', padding: '8px 10px', background: 'rgba(255,95,200,0.06)' });
    d.append(el('div', { fontWeight: '700', marginBottom: '4px' }, 'A Rainy Place to Die · work in progress'));
    for (const line of [
      'A noir, city-pop Japan you can walk, drive and ride through. Nothing here is required: pick what looks interesting, in any order.',
      '` opens the debug menu: it changes the time, season, weather, light, crowd and your car, and teleports anywhere. Most of what is worth seeing is in there.',
      'WASD walk · Shift run · Space jump · E use or talk · Q third person · M map · Tab phone · H taxi · F1 this list.',
      'It is a build in progress, so some things will be rough. Your ticks and notes stay in this browser.',
    ]) d.append(el('div', { marginBottom: '3px' }, line));
    return d;
  }

  private row(t: Task): HTMLElement {
    const r = el('div', { display: 'flex', gap: '8px', padding: '5px 0', borderBottom: '1px solid #1e1a2a' });
    const box = el('input');
    box.type = 'checkbox';
    box.checked = this.done.has(t.id);
    box.addEventListener('change', () => {
      if (box.checked) this.done.add(t.id);
      else this.done.delete(t.id);
      store.set(DONE_KEY, JSON.stringify([...this.done]));
      this.count();
    });
    this.boxes.set(t.id, box);
    const col = el('div', { flex: '1' });
    col.append(el('div', { fontWeight: '700', color: '#f0ecf8' }, t.title), el('div', { color: '#b0acc0' }, t.text));
    if (t.go || t.page) {
      const b = el('button', { marginTop: '4px' }, t.page ? 'Open page' : 'Take me there');
      this.style(b);
      b.addEventListener('click', () => {
        if (t.page) window.open(t.page, '_blank');
        else if (t.go) {
          this.opts.go(t.go);
          this.hide();
        }
      });
      col.append(b);
    }
    r.append(box, col);
    return r;
  }

  private count(): void {
    this.progress.textContent = `${this.done.size} / ${TASK_COUNT}`;
  }

  private download(): void {
    const lines = [`A Rainy Place to Die · playtest notes · build ${BUILD_LABEL}`, new Date().toString(), navigator.userAgent, ''];
    lines.push(`Tried (${this.done.size} of ${TASK_COUNT}):`);
    for (const g of TASK_GROUPS) for (const t of g.tasks) if (this.done.has(t.id)) lines.push(`  [x] ${t.title}`);
    lines.push('', 'Notes:', this.notes.value || '(none)', '');
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    a.download = 'rainy-place-notes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
