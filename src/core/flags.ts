/**
 * Shared story state. Placeholder for the VN integration's shared-flag convention: the world only
 * ever reads flags through get(), so swapping this for the real store is a local change.
 * Time of day and weather live here too (see atmosphere.ts): the story sets them, the world reflects them.
 */
export type FlagValue = boolean | number | string;

export class FlagStore {
  private values = new Map<string, FlagValue>();
  private listeners = new Set<(key: string) => void>();

  constructor(initial: Record<string, FlagValue> = {}) {
    for (const [k, v] of Object.entries(initial)) this.values.set(k, v);
  }

  get = (key: string): FlagValue | undefined => this.values.get(key);

  set(key: string, value: FlagValue): void {
    if (this.values.get(key) === value) return;
    this.values.set(key, value);
    for (const fn of this.listeners) fn(key);
  }

  subscribe(fn: (key: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
