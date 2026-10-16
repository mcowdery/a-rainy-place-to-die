import * as THREE from 'three';
import type { FaunaKind } from '../district/faunaMix';
import { ROW_KIND, type Row } from './faunaRows';
import { loadTemplate, type ModelInstance, type ModelTemplate, type SharedUniforms } from './faunaStatic';

/**
 * The approved animal models in the street (real/fauna.ts uses this when it has been given rows): for each simulated kind the
 * candidates of the city's rows that are models (not the shapes built in code), as variants, each loaded the first time one is
 * wanted and then cloned into a small pool. A variant is a ground one (it stands, walks, runs, pecks, sniffs, sits) or an air one
 * (a flying gull, a dragonfly: it flaps and glides); a skinned file brings its own clips, a static file just stands where it is put.
 * The files are fetched only when an animal needs them (`import.meta.glob` without `eager`), so a game with `?fauna=0` or none
 * downloads none of them.
 */
const CANDIDATES = import.meta.glob('../../../assets/animals/candidates/*.glb', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
const RIGGED = import.meta.glob('../../../assets/animals/rigged/*.glb', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;

const AIR_CLIPS: ReadonlySet<string> = new Set(['Flap', 'Glide', 'Hover']);
/** How many of one variant at most (bigger for the small ones). */
const POOL = 5;

interface Variant {
  readonly id: string;
  readonly from: string;
  readonly len: number;
  readonly yaw: number;
  readonly lift: number;
  readonly air: boolean;
  tpl: ModelTemplate | null;
  loading: boolean;
  failed: boolean;
  readonly pool: Slot[];
}

export interface Slot {
  readonly variant: Variant;
  readonly inst: ModelInstance;
  used: boolean;
}

const loaderOf = (from: string): (() => Promise<string>) | null => {
  const rigged = from.startsWith('rig:');
  const id = rigged ? from.slice(4) : from;
  const hit = Object.entries(rigged ? RIGGED : CANDIDATES).find(([k]) => k.endsWith(`/${id}.glb`));
  return hit ? hit[1] : null;
};

export class ModelSet {
  private readonly byKind = new Map<FaunaKind, { ground: Variant[]; air: Variant[] }>();
  readonly group = new THREE.Group();

  constructor(rows: readonly Row[], private readonly shared: SharedUniforms, parent: THREE.Object3D) {
    this.group.name = 'fauna:models';
    parent.add(this.group);
    for (const row of rows) {
      const kind = ROW_KIND[row.key];
      if (!kind) continue;
      const entry = this.byKind.get(kind) ?? { ground: [], air: [] };
      const animated = row.cands.filter((c) => c.from.startsWith('rig:'));
      for (const c of row.cands) {
        if (c.from === 'built') continue;
        // A static file that has a rigged version in the row (named 'X, animated: ...') is shown by the rigged one.
        if (!c.from.startsWith('rig:') && animated.some((r) => r.name.startsWith(`${c.name}, animated`))) continue;
        const air = (c.lift ?? 0) > 0 || (c.clip !== undefined && AIR_CLIPS.has(c.clip)) || row.group === 'In the air';
        const list = air ? entry.air : entry.ground;
        const id = `${c.from}|${c.len ?? 0.5}|${c.yaw ?? 0}`;
        if (list.some((v) => v.id === id)) continue;
        list.push({ id, from: c.from, len: c.len ?? 0.5, yaw: c.yaw ?? 0, lift: 0, air, tpl: null, loading: false, failed: false, pool: [] });
      }
      this.byKind.set(kind, entry);
    }
  }

  /** Whether the city has a model for this kind at all (else the shapes built in code, if there are any, stand in). */
  has(kind: FaunaKind): boolean {
    const e = this.byKind.get(kind);
    return !!e && e.ground.length + e.air.length > 0;
  }
  hasGround(kind: FaunaKind): boolean {
    return (this.byKind.get(kind)?.ground.length ?? 0) > 0;
  }
  hasAir(kind: FaunaKind): boolean {
    return (this.byKind.get(kind)?.air.length ?? 0) > 0;
  }

  private load(v: Variant): void {
    if (v.tpl || v.loading || v.failed) return;
    v.loading = true;
    const get = loaderOf(v.from);
    if (!get) {
      v.failed = true;
      return;
    }
    void get()
      .then((url) => loadTemplate(url, this.shared, { len: v.len, yaw: v.yaw, lift: v.lift }))
      .then((t) => {
        v.tpl = t;
        v.loading = false;
      })
      .catch((e) => {
        v.failed = true;
        console.warn('animal model', v.from, e);
      });
  }

  /** An animal of this kind (the `pick`th variant of its list), or null while its file loads or the pool is full. */
  acquire(kind: FaunaKind, air: boolean, pick: number): Slot | null {
    const e = this.byKind.get(kind);
    const list = e ? (air ? e.air : e.ground) : null;
    if (!list || list.length === 0) return null;
    const v = list[pick % list.length];
    if (v.failed) return null;
    this.load(v);
    if (!v.tpl) return null;
    let s = v.pool.find((x) => !x.used);
    if (!s) {
      if (v.pool.length >= POOL) return null;
      const inst = v.tpl.make();
      this.group.add(inst.group);
      s = { variant: v, inst, used: false };
      v.pool.push(s);
    }
    s.used = true;
    s.inst.group.visible = true;
    return s;
  }

  release(s: Slot): void {
    s.used = false;
    s.inst.group.visible = false;
  }

  update(dt: number): void {
    for (const e of this.byKind.values()) {
      for (const list of [e.ground, e.air]) for (const v of list) for (const s of v.pool) if (s.used) s.inst.update(dt);
    }
  }

  /** Starts loading what a city's animals will first want (the kinds in `kinds`, a ground and an air variant each), so none pops in late. */
  preload(kinds: readonly FaunaKind[]): void {
    for (const k of kinds) {
      const e = this.byKind.get(k);
      if (!e) continue;
      for (const v of [e.ground[0], e.air[0]]) if (v) this.load(v);
    }
  }
}
