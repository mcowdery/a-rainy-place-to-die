/**
 * Mack's inventory: nine quickslots on the number keys 1-9 (pure, `tests/inventory.test.ts`; the hotbar and the
 * panel are `inventoryHud.ts`, what each item does in the city is main.ts). A slot holds one item or nothing; a
 * number key takes the item in that slot in hand, the same key again puts it away. One item is in hand at a time.
 */
export type ItemId = 'umbrella' | 'flashlight' | 'pistol';

export interface ItemDef {
  readonly id: ItemId;
  readonly name: string;
  readonly jp: string;
  readonly blurb: string;
}

export const ITEMS: Readonly<Record<ItemId, ItemDef>> = {
  umbrella: { id: 'umbrella', name: 'Umbrella', jp: '傘', blurb: 'Holds the rain off you. Useless indoors.' },
  flashlight: { id: 'flashlight', name: 'Flashlight', jp: '懐中電灯', blurb: 'A beam where you look. For alleys, tunnels and the small hours.' },
  pistol: { id: 'pistol', name: 'Type 54', jp: '黒星', blurb: 'The black-market pistol. Eight rounds. Right button aims, left fires, R reloads.' },
};

export const SLOTS = 9;

/** What he starts with, in slot order (a key's number is its slot + 1). */
export const STARTING: readonly ItemId[] = ['umbrella', 'flashlight', 'pistol'];

export class Inventory {
  readonly slots: (ItemId | null)[] = Array.from({ length: SLOTS }, () => null);
  /** The quickslot in hand (0-based), or null with empty hands. */
  held: number | null = null;

  constructor(items: readonly ItemId[] = STARTING) {
    for (const id of items) this.add(id);
  }

  /** The item in hand. */
  get heldItem(): ItemId | null {
    return this.held === null ? null : this.slots[this.held];
  }

  has(id: ItemId): boolean {
    return this.slots.includes(id);
  }

  /** Puts an item in the first free slot (one of each kind); the slot, or -1 if it's full or he has it. */
  add(id: ItemId): number {
    if (this.has(id)) return -1;
    const i = this.slots.indexOf(null);
    if (i >= 0) this.slots[i] = id;
    return i;
  }

  remove(id: ItemId): boolean {
    const i = this.slots.indexOf(id);
    if (i < 0) return false;
    this.slots[i] = null;
    if (this.held === i) this.held = null;
    return true;
  }

  /** A number key: takes the slot's item in hand, or puts it away if it's already there. An empty slot does nothing. */
  press(slot: number): ItemId | null {
    if (slot < 0 || slot >= SLOTS || !this.slots[slot]) return this.heldItem;
    this.held = this.held === slot ? null : slot;
    return this.heldItem;
  }

  /** Puts whatever is in hand away. */
  stow(): void {
    this.held = null;
  }

  /** Swaps two slots (the panel's drag), the held one going with its item. */
  swap(a: number, b: number): void {
    if (a === b || a < 0 || b < 0 || a >= SLOTS || b >= SLOTS) return;
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    if (this.held === a) this.held = b;
    else if (this.held === b) this.held = a;
  }

  serialize(): string {
    return JSON.stringify(this.slots);
  }

  /** Restores a saved layout, ignoring anything it doesn't know; nothing is in hand after. */
  restore(text: string | null): void {
    if (!text) return;
    try {
      const data: unknown = JSON.parse(text);
      if (!Array.isArray(data)) return;
      const seen = new Set<string>();
      for (let i = 0; i < SLOTS; i++) {
        const id = data[i];
        const ok = typeof id === 'string' && id in ITEMS && !seen.has(id);
        this.slots[i] = ok ? (id as ItemId) : null;
        if (ok) seen.add(id);
      }
      this.held = null;
    } catch {
      /* a bad save: keep what we have */
    }
  }
}
