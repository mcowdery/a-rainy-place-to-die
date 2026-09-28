/**
 * The VN export format (schema 2), the contract with the VN asset generator (Krea Studio): see its
 * docs/vn-export-format.md. One export is one story: scene.json (frames keyed "<story>.<frame>", bubbles,
 * choices, hotspots, flags) and entry_points.json (the arrival frames it declares), plus assets/.
 * This file holds the types and a validator that collects every problem (like the content loader does).
 */

export type FrameKey = string;
/** A frame key, "exit:<location>.<exit>" (back to the world), or null. */
export type Target = string | null;

export interface Bubble {
  readonly id: string;
  readonly text: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly show: 'enter' | 'hotspot';
  readonly duration: number;
}

export interface Choice {
  readonly id: string;
  readonly text: string;
  readonly target: Target;
  readonly requires: readonly string[];
  readonly set: Readonly<Record<string, boolean>>;
}

export interface Hotspot {
  readonly id: string;
  readonly shape: 'rect' | 'circle' | 'polygon';
  readonly box: readonly [number, number, number, number];
  readonly points: readonly (readonly [number, number])[];
  readonly action: 'go' | 'inspect';
  readonly target: Target;
  readonly requires: readonly string[];
  readonly set: Readonly<Record<string, boolean>>;
  readonly text?: string;
  readonly bubble?: string | null;
}

export interface Frame {
  readonly entry_point: string | null;
  readonly image: string | null;
  readonly video: string | null;
  readonly size: readonly [number, number] | null;
  readonly title: string;
  readonly bubbles: readonly Bubble[];
  readonly on_enter: { readonly set: Readonly<Record<string, boolean>> };
  readonly next: Target;
  readonly choices: readonly Choice[];
  readonly hotspots: readonly Hotspot[];
}

export interface SceneFile {
  readonly schema: number;
  readonly story: { readonly id: string; readonly name: string };
  readonly start: FrameKey | null;
  readonly flags_referenced: readonly string[];
  readonly entry_points: Readonly<Record<string, FrameKey>>;
  readonly frames: Readonly<Record<FrameKey, Frame>>;
  readonly warnings?: readonly string[];
}

export interface EntryPointsFile {
  readonly schema: number;
  readonly scope?: string;
  readonly story_id?: string;
  readonly entry_points: Readonly<Record<string, { readonly story_id: string; readonly frame: FrameKey; readonly export_file?: string }>>;
}

const KEY = /^s\d+\.fr\d+$/;
const EXIT = /^exit:[a-z0-9_]+\.[a-z0-9_]+$/;
const FLAG = /^!?[a-z0-9_]{1,64}$/;
const ENTRY = /^[a-z0-9_]+\.[a-z0-9_]+$/;

const isTarget = (t: unknown): t is Target => t === null || (typeof t === 'string' && (KEY.test(t) || EXIT.test(t)));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Check a scene.json against schema 2; returns every problem found (empty if it's fine). */
export function validateScene(file: string, s: unknown): string[] {
  const errs: string[] = [];
  const err = (msg: string): void => void errs.push(`${file}: ${msg}`);
  if (typeof s !== 'object' || s === null) return [`${file}: not an object`];
  const sc = s as SceneFile;
  if (!isNum(sc.schema) || sc.schema < 2) err(`schema must be >= 2 (got ${String(sc.schema)})`);
  if (!sc.story || typeof sc.story.id !== 'string' || !/^s\d+$/.test(sc.story.id)) err('story.id must be like "s08"');
  if (typeof sc.frames !== 'object' || sc.frames === null) return [...errs, `${file}: frames missing`];
  if (sc.start !== null && !(sc.start in sc.frames)) err(`start ${String(sc.start)} is not a frame`);
  const flags = new Set<string>();
  const checkFlags = (where: string, req: unknown, set: unknown): void => {
    if (req !== undefined) {
      if (!Array.isArray(req)) err(`${where}: requires must be a list`);
      else for (const r of req) if (typeof r !== 'string' || !FLAG.test(r)) err(`${where}: bad flag in requires: ${String(r)}`);
      else flags.add(r.replace(/^!/, ''));
    }
    if (typeof set !== 'object' || set === null) err(`${where}: set must be a mapping`);
    else for (const [k, v] of Object.entries(set)) {
      if (!FLAG.test(k) || k.startsWith('!')) err(`${where}: bad flag name ${k}`);
      if (typeof v !== 'boolean') err(`${where}: flag ${k} must be true/false`);
      flags.add(k);
    }
  };
  const checkTarget = (where: string, t: unknown): void => {
    if (!isTarget(t)) err(`${where}: bad target ${JSON.stringify(t)}`);
    else if (t !== null && KEY.test(t) && t.startsWith(`${sc.story.id}.`) && !(t in sc.frames)) err(`${where}: target ${t} is not a frame of this story`);
  };
  for (const [key, f] of Object.entries(sc.frames)) {
    if (!KEY.test(key) || !key.startsWith(`${sc.story?.id}.`)) err(`frame key ${key} must be "${sc.story?.id}.frNN"`);
    if (f.entry_point !== null && (typeof f.entry_point !== 'string' || !ENTRY.test(f.entry_point))) err(`${key}: bad entry_point`);
    if (f.image !== null && typeof f.image !== 'string') err(`${key}: image must be a path or null`);
    if (f.size !== null && !(Array.isArray(f.size) && f.size.length === 2 && f.size.every(isNum))) err(`${key}: size must be [w, h] or null`);
    if (!Array.isArray(f.bubbles)) err(`${key}: bubbles must be a list`);
    else
      for (const b of f.bubbles) {
        if (typeof b.id !== 'string' || typeof b.text !== 'string') err(`${key}: bubble needs id and text`);
        if (!isNum(b.x) || !isNum(b.y) || b.x < 0 || b.x > 1 || b.y < 0 || b.y > 1) err(`${key}.${b.id}: x/y must be 0-1`);
        if (b.show !== 'enter' && b.show !== 'hotspot') err(`${key}.${b.id}: show must be enter or hotspot`);
      }
    checkFlags(`${key} on_enter`, undefined, f.on_enter?.set);
    checkTarget(`${key} next`, f.next);
    if (!Array.isArray(f.choices) || !Array.isArray(f.hotspots)) err(`${key}: choices and hotspots must be lists`);
    for (const c of f.choices ?? []) {
      if (typeof c.text !== 'string') err(`${key}.${c.id}: choice needs text`);
      checkTarget(`${key}.${c.id}`, c.target);
      checkFlags(`${key}.${c.id}`, c.requires, c.set);
    }
    for (const h of f.hotspots ?? []) {
      if (!['rect', 'circle', 'polygon'].includes(h.shape)) err(`${key}.${h.id}: bad shape`);
      if (!(Array.isArray(h.box) && h.box.length === 4 && h.box.every(isNum))) err(`${key}.${h.id}: box must be [x, y, w, h]`);
      if (h.action !== 'go' && h.action !== 'inspect') err(`${key}.${h.id}: action must be go or inspect`);
      if (h.action === 'inspect' && h.bubble && !f.bubbles.some((b) => b.id === h.bubble)) err(`${key}.${h.id}: bubble ${h.bubble} is not on the frame`);
      checkTarget(`${key}.${h.id}`, h.target);
      checkFlags(`${key}.${h.id}`, h.requires, h.set);
    }
  }
  for (const [entry, key] of Object.entries(sc.entry_points ?? {})) {
    if (!ENTRY.test(entry)) err(`entry point ${entry} must be "<location>.<name>"`);
    if (sc.frames[key]?.entry_point !== entry) err(`entry point ${entry} -> ${key}: that frame doesn't declare it`);
  }
  const listed = new Set(sc.flags_referenced ?? []);
  for (const f of flags) if (!listed.has(f)) err(`flag ${f} is used but not in flags_referenced`);
  return errs;
}
