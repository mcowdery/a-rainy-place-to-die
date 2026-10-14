import { ITEMS, SLOTS, type Inventory, type ItemId } from './inventory';

/**
 * The inventory on screen: a panel on G with the nine quickslots (numbered as their keys, the one in hand lit) and
 * what each item is; click a slot, then another, to swap them. There is no hotbar: the keys work without one. Plain DOM like the wait panel; the keys themselves are main.ts's.
 */
const ICONS: Record<ItemId, string> = {
  // A canopy, a shaft and a hooked handle.
  umbrella:
    '<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15C3 8 9 4 16 4s13 4 13 11c-2.5-2-5-2-6.5 0-1.5-2-4.5-2-6.5 0-2-2-5-2-6.5 0C8 13 5.5 13 3 15z"/><path d="M16 4V2M16 15v11a3 3 0 0 1-6 0"/></svg>',
  // A torch: head, body and a beam.
  flashlight:
    '<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(-45 16 18)"><path d="M12 8h8l-1.5 5h-5z"/><rect x="13" y="13" width="6" height="16" rx="1.5"/></g><path d="M22 5l2.5-2.5M26 10l3.5-1M19 3l.5-2.5" opacity=".6"/></svg>',
  // A pistol in side view: slide, grip and trigger guard.
  pistol:
    '<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h25v6H15l-2 2H11l-1 8H5l1-10H3z"/><path d="M11 17h4"/></svg>',
};

export class InventoryHud {
  open = false;
  private readonly panel: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly info: HTMLDivElement;
  private picked: number | null = null;

  constructor(
    private readonly inv: Inventory,
    /** Called after the panel rearranges the slots (to save). */
    private readonly changed: () => void,
  ) {
    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: '40', display: 'none',
      background: 'rgba(12, 12, 20, 0.92)', color: '#e8e4f0', border: '1px solid #4a4460', borderRadius: '10px',
      padding: '16px 18px', font: "14px 'Segoe UI', 'Yu Gothic', sans-serif", boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
    });
    const title = document.createElement('div');
    title.textContent = '持ち物 INVENTORY';
    Object.assign(title.style, { fontWeight: '700', letterSpacing: '0.12em', marginBottom: '10px' });
    this.grid = document.createElement('div');
    Object.assign(this.grid.style, { display: 'grid', gridTemplateColumns: `repeat(${SLOTS}, 1fr)`, gap: '6px' });
    this.info = document.createElement('div');
    Object.assign(this.info.style, { minHeight: '38px', marginTop: '12px', opacity: '0.85' });
    const hint = document.createElement('div');
    hint.textContent = '1-9 take an item in hand, again to put it away · click a slot, then another, to swap · G or Esc to close';
    Object.assign(hint.style, { opacity: '0.55', fontSize: '12px', marginTop: '10px' });
    this.panel.append(title, this.grid, this.info, hint);
    document.body.append(this.panel);
    this.render();
  }

  show(): void {
    this.picked = null;
    this.panel.style.display = 'block';
    this.open = true;
    this.render();
  }

  hide(): void {
    this.panel.style.display = 'none';
    this.open = false;
  }

  /** Redraws the slots (after a key, a swap or a load). */
  render(): void {
    this.grid.replaceChildren(...Array.from({ length: SLOTS }, (_, i) => this.cell(i, true)));
    const shown = this.picked ?? this.inv.held;
    const item = shown === null ? null : this.inv.slots[shown];
    this.info.textContent = item ? `${ITEMS[item].name} ${ITEMS[item].jp} · ${ITEMS[item].blurb}` : '';
  }

  private cell(i: number, big: boolean): HTMLDivElement {
    const id = this.inv.slots[i];
    const held = this.inv.held === i;
    const size = big ? 56 : 46;
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'relative', width: `${size}px`, height: `${size}px`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: held ? 'rgba(90, 70, 40, 0.75)' : 'rgba(8, 8, 14, 0.7)', color: held ? '#ffd890' : '#cfc9e0',
      border: `1px solid ${big && this.picked === i ? '#9a8cff' : held ? '#e0b060' : '#3a3850'}`, borderRadius: '6px', boxSizing: 'border-box',
      cursor: big ? 'pointer' : 'default',
    });
    const n = document.createElement('span');
    n.textContent = String(i + 1);
    Object.assign(n.style, { position: 'absolute', left: '4px', top: '2px', font: "10px 'Consolas', monospace", opacity: '0.7' });
    el.append(n);
    if (id) {
      const icon = document.createElement('div');
      icon.innerHTML = ICONS[id];
      el.title = ITEMS[id].name;
      el.append(icon);
    }
    if (big) {
      el.addEventListener('click', () => {
        if (this.picked === null) this.picked = id ? i : null;
        else {
          this.inv.swap(this.picked, i);
          this.picked = null;
          this.changed();
        }
        this.render();
      });
    }
    return el;
  }
}
