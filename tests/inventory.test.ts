import { describe, expect, it } from 'vitest';
import { Inventory, SLOTS } from '../src/poc3d/district/inventory';

describe('the inventory', () => {
  it('starts with an umbrella in slot 1, a flashlight in slot 2 and the pistol in slot 3', () => {
    const inv = new Inventory();
    expect(inv.slots.slice(0, 4)).toEqual(['umbrella', 'flashlight', 'pistol', null]);
    expect(inv.slots).toHaveLength(SLOTS);
    expect(inv.heldItem).toBeNull();
  });

  it('a number key takes the item in hand, the same key puts it away, an empty slot does nothing', () => {
    const inv = new Inventory();
    expect(inv.press(1)).toBe('flashlight');
    expect(inv.press(0)).toBe('umbrella');
    expect(inv.press(0)).toBeNull();
    inv.press(1);
    expect(inv.press(5)).toBe('flashlight');
    expect(inv.press(99)).toBe('flashlight');
  });

  it('adds one of each kind into the first free slot, and removing the held item empties the hands', () => {
    const inv = new Inventory([]);
    expect(inv.add('flashlight')).toBe(0);
    expect(inv.add('flashlight')).toBe(-1);
    inv.press(0);
    expect(inv.remove('flashlight')).toBe(true);
    expect(inv.heldItem).toBeNull();
    expect(inv.remove('flashlight')).toBe(false);
  });

  it('swapping keeps the held item held', () => {
    const inv = new Inventory();
    inv.press(0);
    inv.swap(0, 4);
    expect(inv.slots[4]).toBe('umbrella');
    expect(inv.heldItem).toBe('umbrella');
  });

  it('round-trips through a save and ignores what it does not know', () => {
    const a = new Inventory();
    a.swap(1, 6);
    const b = new Inventory([]);
    b.restore(a.serialize());
    expect(b.slots).toEqual(a.slots);
    b.restore('["sword","umbrella","umbrella"]');
    expect(b.slots.slice(0, 3)).toEqual([null, 'umbrella', null]);
    b.restore('not json');
    expect(b.slots[1]).toBe('umbrella');
  });
});
