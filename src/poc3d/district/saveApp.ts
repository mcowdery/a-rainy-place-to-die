import type { PhoneApp } from '../../phone/ui';
import { listSaves, type SaveGame, type Slot } from '../../save/save';

/**
 * セーブ, the phone's save app: the autosave and three slots, each with where and when it was saved and how long
 * played; Save writes the game now into a slot (the autosave is kept by the game itself), Load reopens the city
 * from one. A second tap confirms anything that would overwrite or leave the game.
 */
export class SaveApp implements PhoneApp {
  readonly id = 'save';
  readonly name = 'セーブ';
  readonly icon = '💾';
  readonly color = '#5a4ad0';
  private list: HTMLDivElement | null = null;
  private armed: string | null = null;
  /** Why the last save didn't happen (shown under its slot), and which slot. */
  private problem: { slot: Slot; text: string } | null = null;

  constructor(
    /** Saves into the slot; the reason it couldn't, or null. */
    private readonly save: (slot: Slot) => string | null,
    private readonly load: (slot: Slot) => void,
  ) {}

  show(screen: HTMLElement): void {
    injectStyle();
    const root = document.createElement('div');
    root.className = 'sv-root';
    const head = document.createElement('div');
    head.className = 'sv-head';
    head.innerHTML = '<b>セーブ</b><span>Save and load</span>';
    const list = document.createElement('div');
    list.className = 'sv-list';
    root.append(head, list);
    screen.append(root);
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

  back(): boolean {
    if (!this.armed) return false;
    this.armed = null;
    this.render();
    return true;
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
  .sv-root { flex: 1; display: flex; flex-direction: column; min-height: 0; background: #0c0c14; color: #e8e6f0; }
  .sv-head { display: flex; flex-direction: column; gap: 2px; padding: 16px 16px 12px; background: #2a2360; }
  .sv-head b { font: 700 18px 'Yu Gothic', system-ui, sans-serif; }
  .sv-head span { font-size: 12px; color: #b8b0e8; }
  .sv-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px; }
  .sv-slot { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #16161f; border: 1px solid #2a2a3a; border-radius: 10px; }
  .sv-info { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .sv-info b { font-size: 14px; }
  .sv-info span { font-size: 11px; color: #9a98b0; overflow-wrap: anywhere; }
  .sv-actions { display: flex; flex-direction: column; gap: 6px; }
  .sv-btn { font: 600 12px system-ui, sans-serif; padding: 7px 12px; border-radius: 8px; border: 1px solid #5a4ad0; background: #2a2360; color: #fff; cursor: pointer; white-space: nowrap; }
  .sv-btn.armed { background: #d04a6a; border-color: #ff8aa8; }
  .sv-btn:disabled { opacity: 0.35; cursor: default; }
  `;
  document.head.append(s);
}
