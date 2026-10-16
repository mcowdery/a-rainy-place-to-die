import { listSaves, type SaveGame, type Slot } from '../../save/save';

/**
 * セーブ, the save panel: the autosave and three slots, each with where and when it was saved and how long played;
 * Save writes the game now into a slot (the autosave is kept by the game itself), Load reopens the city from one. A
 * second click confirms anything that would overwrite or leave the game. It is a page of the pause menu
 * (startScreen.ts `PauseMenu`, Esc): saving is the game's, not something he does in the world with anything he carries
 * (the user, 2026-10-13; it was the phone's セーブ app, and the notebook's diary in the mock-up).
 */
export class SavePanel {
  private list: HTMLDivElement | null = null;
  private armed: string | null = null;
  /** Why the last save didn't happen (shown under its slot), and which slot. */
  private problem: { slot: Slot; text: string } | null = null;

  constructor(
    /** Saves into the slot; the reason it couldn't, or null. */
    private readonly save: (slot: Slot) => string | null,
    private readonly load: (slot: Slot) => void,
  ) {}

  /** Draws the slots into `page`. */
  show(page: HTMLElement): void {
    injectStyle();
    const list = document.createElement('div');
    list.className = 'sv-list';
    page.append(list);
    this.list = list;
    this.armed = null;
    this.problem = null;
    this.render();
  }

  hide(): void {
    this.list = null;
  }

  private render(): void {
    const list = this.list;
    if (!list) return;
    list.innerHTML = '';
    for (const { slot, save } of listSaves()) {
      const row = document.createElement('div');
      row.className = 'sv-slot';
      const info = document.createElement('div');
      info.className = 'sv-info';
      const title = document.createElement('b');
      title.textContent = slot === 'auto' ? 'Autosave' : `Slot ${slot}`;
      const meta = document.createElement('span');
      meta.textContent = this.problem?.slot === slot ? this.problem.text : save ? describe(save) : 'Empty';
      info.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'sv-actions';
      const button = (label: string, id: string, confirm: string | null, fn: () => void, disabled = false): void => {
        const b = document.createElement('button');
        b.className = 'sv-btn';
        const arm = `${id}:${slot}`;
        b.textContent = this.armed === arm && confirm ? confirm : label;
        if (this.armed === arm) b.classList.add('armed');
        b.disabled = disabled;
        b.addEventListener('click', () => {
          if (confirm && this.armed !== arm) {
            this.armed = arm;
            this.render();
            return;
          }
          this.armed = null;
          fn();
        });
        actions.append(b);
      };
      if (slot !== 'auto') {
        button('Save', 'save', save ? 'Overwrite?' : null, () => {
          const why = this.save(slot);
          this.problem = why ? { slot, text: `Couldn’t save: ${why}` } : null;
          this.render();
        });
      }
      button('Load', 'load', 'Leave and load?', () => this.load(slot), !save);
      row.append(info, actions);
      list.append(row);
    }
  }

}

function describe(s: SaveGame): string {
  const d = new Date(s.savedAt);
  const when = Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const h = Math.floor(s.played / 3600);
  const m = Math.floor((s.played % 3600) / 60);
  return `${s.place} · ${when} · ${h}h ${String(m).padStart(2, '0')}m`;
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .sv-list { display: flex; flex-direction: column; gap: 10px; }
  .sv-slot { display: flex; align-items: center; gap: 14px; padding: 12px 14px; background: rgba(20,14,14,.7); border: 1px solid #3a2a2a; }
  .sv-info { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .sv-info b { font-size: 14px; letter-spacing: .12em; text-transform: uppercase; color: #e6dfd6; }
  .sv-info span { font-size: 12px; color: #a39b92; overflow-wrap: anywhere; font-family: Consolas, 'Cascadia Mono', monospace; }
  .sv-actions { display: flex; gap: 8px; }
  /* (The pause menu's own button style, a big skewed numbered bar, is for its menu: these are small and plain.) */
  .noir .sv-btn { display: inline-block; width: auto; margin: 0; padding: 8px 14px; transform: none; counter-increment: none; font: 700 12px 'Segoe UI', sans-serif; letter-spacing: .14em;
    text-transform: uppercase; border: 1px solid #6a4040; background: transparent; color: #d8d0c6; cursor: pointer; white-space: nowrap; transition: none; }
  .noir .sv-btn::before { content: none; }
  .noir .sv-btn:hover:not(:disabled), .noir .sv-btn:focus-visible { padding: 8px 14px; border: 1px solid #c01822; background: #3a0a0e; color: #fff; }
  .noir .sv-btn.armed, .noir .sv-btn.armed:hover { background: #8e1118; border-color: #d0303a; color: #fff; }
  .noir .sv-btn:disabled { opacity: .3; cursor: default; background: transparent; padding: 8px 14px; }
  `;
  document.head.append(s);
}
