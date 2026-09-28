import type { Choice, EntryPointsFile, Frame, FrameKey, Hotspot, SceneFile, Target } from './format';
import { validateScene } from './format';

/**
 * The VN library and its state machine, with no DOM: which frame is showing, what the player may pick, where
 * each pick leads, and the flags it sets. VnPlayer (player.ts) draws it; tests drive it directly.
 */

/** Every story the game ships, merged: frames by key, entry points by key, and asset URLs. */
export class VnLibrary {
  readonly frames = new Map<FrameKey, Frame>();
  readonly entries = new Map<string, FrameKey>();
  readonly stories = new Map<string, string>();
  readonly errors: string[] = [];

  /**
   * scenes: scene.json by story folder; entryFiles: entry_points.json by folder; asset: resolves a frame's
   * relative asset path ("assets/s08.fr01.png") in its folder to a URL.
   */
  constructor(
    scenes: Readonly<Record<string, unknown>>,
    entryFiles: Readonly<Record<string, unknown>>,
    private readonly asset: (folder: string, path: string) => string | null = () => null,
  ) {
    const folders = new Map<string, string>();
    for (const [folder, raw] of Object.entries(scenes)) {
      const problems = validateScene(`${folder}/scene.json`, raw);
      if (problems.length) {
        this.errors.push(...problems);
        continue;
      }
      const s = raw as SceneFile;
      this.stories.set(s.story.id, s.story.name);
      for (const [key, f] of Object.entries(s.frames)) {
        this.frames.set(key, f);
        folders.set(key, folder);
      }
    }
    this.folderOf = folders;
    // Entry points: the union of every export's rows; the same key twice is an error, never a silent pick.
    for (const [folder, raw] of Object.entries(entryFiles)) {
      const e = raw as EntryPointsFile;
      for (const [key, row] of Object.entries(e.entry_points ?? {})) {
        const had = this.entries.get(key);
        if (had !== undefined && had !== row.frame) this.errors.push(`${folder}/entry_points.json: entry point ${key} is also ${had}`);
        else if (!this.frames.has(row.frame)) this.errors.push(`${folder}/entry_points.json: entry point ${key} -> ${row.frame}, which isn't shipped`);
        else this.entries.set(key, row.frame);
      }
    }
  }

  private readonly folderOf: Map<FrameKey, string>;

  /** The URL of a frame's still, or null (no image: the frame plays over the paused world). */
  imageOf(key: FrameKey): string | null {
    const f = this.frames.get(key);
    const folder = this.folderOf.get(key);
    return f?.image && folder ? this.asset(folder, f.image) : null;
  }
}

export interface Flags {
  get(key: string): unknown;
  set(key: string, value: boolean): void;
}

/** Where a pick leads: another frame, back to the world at an exit, or the end of the scene. */
export type Step = { readonly kind: 'frame'; readonly key: FrameKey } | { readonly kind: 'exit'; readonly to: string } | { readonly kind: 'end' };

/** Using a hotspot: a step (go), or something to read (inspect). */
export type Use = Step | { readonly kind: 'inspect'; readonly text: string; readonly bubble: string | null; readonly box: readonly [number, number, number, number] };

export class VnEngine {
  key: FrameKey | null = null;

  constructor(
    readonly lib: VnLibrary,
    private readonly flags: Flags,
  ) {}

  get frame(): Frame | null {
    return this.key ? (this.lib.frames.get(this.key) ?? null) : null;
  }

  /** All the flags hold ("!name" must be false; a flag never set is false). */
  holds(requires: readonly string[]): boolean {
    return requires.every((r) => (r.startsWith('!') ? !this.flags.get(r.slice(1)) : !!this.flags.get(r)));
  }

  private apply(set: Readonly<Record<string, boolean>>): void {
    for (const [k, v] of Object.entries(set)) this.flags.set(k, v);
  }

  /** Start at an entry point (a world node's id); null if no story declares it. */
  enter(entry: string): Step | null {
    const key = this.lib.entries.get(entry);
    return key ? this.go(key) : null;
  }

  /** Follow a target: enter a frame (applying its on_enter flags), or leave. */
  go(target: Target): Step {
    if (target === null) {
      this.key = null;
      return { kind: 'end' };
    }
    if (target.startsWith('exit:')) {
      this.key = null;
      return { kind: 'exit', to: target.slice(5) };
    }
    const f = this.lib.frames.get(target);
    if (!f) {
      // A frame of a story that isn't shipped: end the scene rather than stall.
      this.key = null;
      return { kind: 'end' };
    }
    this.key = target;
    this.apply(f.on_enter.set);
    return { kind: 'frame', key: target };
  }

  /** The choices the player may pick now. */
  choices(): Choice[] {
    return (this.frame?.choices ?? []).filter((c) => this.holds(c.requires));
  }

  /** The hotspots the player may use now. */
  hotspots(): Hotspot[] {
    return (this.frame?.hotspots ?? []).filter((h) => this.holds(h.requires));
  }

  /** Continue: the frame's next (only when it has no choices to make). */
  next(): Step {
    return this.go(this.frame?.next ?? null);
  }

  pick(id: string): Step | null {
    const c = this.choices().find((x) => x.id === id);
    if (!c) return null;
    this.apply(c.set);
    return this.go(c.target);
  }

  use(id: string): Use | null {
    const h = this.hotspots().find((x) => x.id === id);
    if (!h) return null;
    this.apply(h.set);
    if (h.action === 'inspect') {
      const b = h.bubble ? this.frame?.bubbles.find((x) => x.id === h.bubble) : undefined;
      return { kind: 'inspect', text: b?.text ?? h.text ?? '', bubble: b?.id ?? null, box: h.box };
    }
    // A go hotspot with no target does nothing.
    return h.target === null ? null : this.go(h.target);
  }
}

/** Whether a 0-1 image point is inside a hotspot (rect and polygon by their points, circle as the ellipse in box). */
export function hitHotspot(h: Hotspot, x: number, y: number): boolean {
  const [bx, by, bw, bh] = h.box;
  if (h.shape === 'circle') {
    const dx = (x - (bx + bw / 2)) / (bw / 2);
    const dy = (y - (by + bh / 2)) / (bh / 2);
    return dx * dx + dy * dy <= 1;
  }
  const pts = h.points.length >= 3 ? h.points : [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
