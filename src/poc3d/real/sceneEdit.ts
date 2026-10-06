import { isBare, OUTFITS, type Outfit } from '../district/peopleMix';
import type { Body, Hair } from './mobRig';
import { strictCast } from './sceneFiles';
import type { JointName, PlacedHold } from './windowAtlas';
import { CAST, checkScene, depthPoint, HOLD_REACH, HOLD_SCALE, holdAt, holdOf, itemOf, itemParts, ITEMS, MAX_DEPTH, PART_STEPS, poseValue, poseWith, PROPS, TEEN_OUTFITS, whoOf, type CastName, type Fig, type Hold, type HoldAt, type Item, type ItemName, type PartName, type PartStep, type Pen, type Pose, type PropName, type Who } from './windowScenes';

/**
 * What the scene editor (showroom/scenes.ts) does to a scene, apart from its page: pure, so it can be tested. A
 * scene being edited is the plain object its file holds (windowScenes.ts has the format), changed in place and only
 * where the user changes it, so a scene loaded and saved untouched is the same bytes.
 */

/** A scene as the editor holds it: the file's own object. */
export type SceneDoc = Record<string, unknown> & { id: string; a: Fig[] };

/** One of the people's key poses: its figures and the things that go with them. */
export interface KeyPose {
  a: Fig[];
  aItems?: Item[];
}

/** The scene's key poses in order: `a`, then `b`, then `frames`. */
export function sceneKeys(doc: SceneDoc): KeyPose[] {
  const keys: KeyPose[] = [{ a: doc.a, ...(doc.aItems ? { aItems: doc.aItems as Item[] } : {}) }];
  if (doc.b) keys.push({ a: doc.b as Fig[], ...(doc.bItems ? { aItems: doc.bItems as Item[] } : {}) });
  for (const f of (doc.frames as KeyPose[] | undefined) ?? []) keys.push(f);
  return keys;
}

/**
 * Writes the key poses back as `a`, `b` and `frames`. With one pose left the scene is still: `anim`, `tween` and
 * `slide` go. With a second and no `anim` yet, it gets an unhurried one.
 */
export function setSceneKeys(doc: SceneDoc, keys: readonly KeyPose[]): void {
  const put = (k: string, v: unknown): void => {
    if (v === undefined || (Array.isArray(v) && v.length === 0 && k !== 'a')) delete doc[k];
    else doc[k] = v;
  };
  doc.a = keys[0].a;
  put('aItems', keys[0].aItems);
  put('b', keys[1]?.a);
  put('bItems', keys[1]?.aItems);
  put('frames', keys.length > 2 ? keys.slice(2).map((k) => ({ a: k.a, ...(k.aItems?.length ? { aItems: k.aItems } : {}) })) : undefined);
  if (keys.length < 2) {
    delete doc.anim;
    delete doc.tween;
    delete doc.slide;
  } else if (!doc.anim) {
    doc.anim = [4, 0.6];
    delete doc.deep;
  }
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A new key pose after pose `i`, a copy of it. */
export function addKey(doc: SceneDoc, i: number): void {
  const keys = sceneKeys(doc);
  keys.splice(i + 1, 0, clone(keys[i]));
  setSceneKeys(doc, keys);
}
/** Removes key pose `i` (never the only one). */
export function removeKey(doc: SceneDoc, i: number): void {
  const keys = sceneKeys(doc);
  if (keys.length < 2) return;
  keys.splice(i, 1);
  setSceneKeys(doc, keys);
}
/** Moves key pose `i` one place earlier (-1) or later (1). */
export function moveKey(doc: SceneDoc, i: number, by: -1 | 1): number {
  const keys = sceneKeys(doc);
  const j = i + by;
  if (j < 0 || j >= keys.length) return i;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  setSceneKeys(doc, keys);
  return j;
}

/**
 * Copies one key pose over others: the whole of it (every figure as it is here, and the things that go with the
 * people), one figure, or one part of a figure (that part's turns only). Figures are matched by their order: where
 * a pose has fewer, what matches is copied. Gives how many poses it changed and how many figures had no match.
 */
export function copyPose(doc: SceneDoc, from: number, to: readonly number[], what: { fig?: number; part?: PartName } = {}): { poses: number; unmatched: number } {
  const keys = sceneKeys(doc);
  const src = keys[from];
  let poses = 0, unmatched = 0;
  if (!src) return { poses, unmatched };
  for (const j of to) {
    const dst = keys[j];
    if (!dst || j === from) continue;
    const before = JSON.stringify(dst);
    const which = what.fig === undefined ? src.a.map((_, i) => i) : [what.fig];
    for (const i of which) {
      const f = src.a[i], g = dst.a[i] as { pose: Pose } | undefined;
      if (!f) continue;
      if (!g) unmatched++;
      else if (what.part === undefined) dst.a[i] = clone(f);
      else for (const st of PART_STEPS[what.part]) if (st.fixed === undefined) g.pose = poseWith(g.pose, st, poseValue(f.pose, st));
    }
    if (what.fig === undefined) {
      // (The whole pose: what's with the people too; and a figure the other pose has that this one hasn't is left.)
      if (src.aItems?.length) dst.aItems = clone(src.aItems);
      else delete dst.aItems;
      unmatched += Math.max(0, dst.a.length - src.a.length);
    }
    if (JSON.stringify(dst) !== before) poses++;
  }
  setSceneKeys(doc, keys);
  return { poses, unmatched };
}

const round = (v: number, step: number): number => Math.round(v / step) * step;
/** A length in metres to the centimetre, an angle to a tenth of a degree (no -0, no float dust). */
export const cm = (v: number): number => Number(round(v, 0.01).toFixed(2)) || 0;
export const deg = (v: number): number => Number(round(v, 0.1).toFixed(1)) || 0;

/** A scene with an empty room: one person standing in the middle. */
export function emptyScene(id: string, cat: string, adult = false): SceneDoc {
  return { id, label: 'a new scene', cat, ...(adult ? { adult: true } : {}), a: [{ who: adult || cat.startsWith('v_') || cat.startsWith('g_') ? 'suit' : 'man', x: 0, pose: {} }] } as SceneDoc;
}

// ---- who may be in it ----

const BODIES: readonly Body[] = ['man', 'woman', 'elder', 'child'];
const HAIRS: readonly Hair[] = ['short', 'long', 'bun', 'hat', 'cap', 'none', 'bob', 'ponytail', 'twin'];

/** Whether checkScene keeps a prop to adult scenes (asked of it, so the editor's list can't drift from the rule). */
const adultProps = new Map<PropName, boolean>();
function adultProp(p: PropName): boolean {
  let v = adultProps.get(p);
  if (v === undefined) {
    const errors: string[] = [];
    checkScene({ id: 'probe', label: 'probe', cat: 'home', a: [{ who: 'man', x: 0, pose: {}, hold: [['R', p]] }] }, errors);
    adultProps.set(p, (v = errors.length > 0));
  }
  return v;
}

/**
 * What the pickers offer for a scene, by the rule the checks hold every scene to: in an adult scene or a vice room
 * (or a ground-floor one), adults in adult clothes only (no child body, none of the teen-sized outfits); the nude
 * outfit, and anything else the checks keep to adult scenes, only where the scene is marked adult.
 */
export function castChoices(scene: { adult?: unknown; cat?: unknown }): { bodies: Body[]; outfits: Outfit[]; hair: Hair[]; cast: CastName[]; props: PropName[] } {
  const strict = strictCast(scene);
  const adult = scene.adult === true;
  const bodies = BODIES.filter((b) => !strict || b !== 'child');
  const outfits = OUTFITS.filter((o) => (!strict || !TEEN_OUTFITS.includes(o)) && (!isBare(o) || adult));
  const cast = (Object.keys(CAST) as CastName[]).filter((n) => bodies.includes(CAST[n].body) && outfits.includes(CAST[n].outfit));
  const props = (Object.keys(PROPS) as PropName[]).filter((p) => adult || !adultProp(p));
  return { bodies, outfits, hair: [...HAIRS], cast, props };
}

/**
 * Whether a figure may be in a scene as the checks see it (asked of checkScene itself, on a scene of that kind with
 * only that figure in it, so the pickers can't drift from the rule).
 */
export function whoAllowed(scene: { adult?: unknown; cat?: unknown }, who: CastName | Who): boolean {
  const errors: string[] = [];
  checkScene({ id: 'probe', label: 'probe', cat: scene.cat, ...(scene.adult === true ? { adult: true } : {}), a: [{ who, x: 0, pose: {} }] }, errors);
  return !errors.some((e) => e.includes('a[0]'));
}
/** The outfits a body may wear in a scene (the nude one only an adult scene's woman or man). */
export const outfitsFor = (scene: { adult?: unknown; cat?: unknown }, body: Body): Outfit[] => castChoices(scene).outfits.filter((outfit) => whoAllowed(scene, { body, outfit, hair: 'short' }));

/**
 * A figure with nothing on: its own body and hair in the nude outfit, barefoot (heels are a choice afterwards:
 * withHeels). Null where that isn't allowed (the scene isn't marked adult, or the body is an elder's or a child's),
 * or it has nothing on already.
 */
export function undressed(scene: { adult?: unknown; cat?: unknown }, who: CastName | Who): Who | null {
  const w = whoOf(who);
  if (!w || isBare(w.outfit)) return null;
  const bare: Who = { body: w.body, outfit: 'nude', hair: w.hair };
  return scene.adult === true && whoAllowed(scene, bare) ? bare : null;
}
/** A figure with nothing on, barefoot or in high heels (a woman's only): null if it isn't one, or can't be. */
export function withHeels(scene: { adult?: unknown; cat?: unknown }, who: CastName | Who, heels: boolean): Who | null {
  const w = whoOf(who);
  if (!w || !isBare(w.outfit)) return null;
  const next: Who = { body: w.body, outfit: heels ? 'nude_heels' : 'nude', hair: w.hair };
  return whoAllowed(scene, next) ? next : null;
}

/**
 * Undresses figure `i`: in the pose given, or (no pose) in every pose, where each pose's figure is its own object
 * and keeps its own body and hair. Gives how many it changed.
 */
export function undress(doc: SceneDoc, i: number, pose?: number): number {
  let n = 0;
  sceneKeys(doc).forEach((key, k) => {
    if (pose !== undefined && k !== pose) return;
    const f = key.a[i] as { who: CastName | Who } | undefined;
    const bare = f && undressed(doc as { adult?: unknown; cat?: unknown }, f.who);
    if (!bare) return;
    f.who = bare;
    n++;
  });
  return n;
}

// ---- what the hands hold ----

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** A hold with some of its numbers changed: kept in range, to the centimetre, the tenth of a degree and the hundredth of a size. */
export function adjustHold(h: Hold, patch: Partial<HoldAt>): Hold {
  const a = { ...holdAt(h), ...patch };
  return holdOf({
    hand: a.hand,
    prop: a.prop,
    rot: a.rot === undefined ? undefined : deg(clamp(a.rot, -360, 360)),
    dx: cm(clamp(a.dx, -HOLD_REACH, HOLD_REACH)),
    dy: cm(clamp(a.dy, -HOLD_REACH, HOLD_REACH)),
    scale: cm(clamp(a.scale, HOLD_SCALE[0], HOLD_SCALE[1])),
  });
}
/** A hold back where it goes by itself: in the hand, along the forearm, its own size. */
export const resetHold = (h: Hold): Hold => [h[0], h[1]];
const sameHold = (a: Hold, b: Hold): boolean => a[0] === b[0] && a[1] === b[1];

/** Takes what figure `i` holds in that hand out of every pose. Gives how many poses had it. */
export function removeHoldEverywhere(doc: SceneDoc, i: number, hold: Hold): number {
  let n = 0;
  for (const key of sceneKeys(doc)) {
    const f = key.a[i] as Mutable<Fig> | undefined;
    if (!f?.hold?.some((h) => sameHold(h, hold))) continue;
    const rest = f.hold.filter((h) => !sameHold(h, hold));
    if (rest.length) f.hold = rest;
    else delete f.hold;
    n++;
  }
  return n;
}
/** Gives figure `i` this hold in every pose, as it is here (replacing the same thing in the same hand). Gives how many poses it changed. */
export function copyHoldEverywhere(doc: SceneDoc, i: number, hold: Hold): number {
  let n = 0;
  for (const key of sceneKeys(doc)) {
    const f = key.a[i] as Mutable<Fig> | undefined;
    if (!f) continue;
    const list = [...(f.hold ?? [])];
    const at = list.findIndex((h) => sameHold(h, hold));
    if (at >= 0 && JSON.stringify(list[at]) === JSON.stringify(hold)) continue;
    if (at >= 0) list[at] = [...hold] as unknown as Hold;
    else list.push([...hold] as unknown as Hold);
    f.hold = list;
    n++;
  }
  return n;
}

/** What a prop's drawing covers about its own origin: [x0, y0, x1, y1]. */
export function propBox(prop: PropName): [number, number, number, number] {
  const b = new Bounds();
  (PROPS[prop] as (p: Pen) => void)(b);
  return [b.x0, b.y0, b.x1, b.y1];
}
/** The four corners in the room of what a held thing covers, as it's drawn (placeFigure's `holds`). */
export function holdCorners(prop: PropName, at: PlacedHold): [number, number][] {
  const [x0, y0, x1, y1] = propBox(prop);
  const c = Math.cos(at.angle) * at.scale, s = Math.sin(at.angle) * at.scale;
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const).map(([x, y]): [number, number] => [at.at[0] + x * c - y * s, at.at[1] + x * s + y * c]);
}
/**
 * The handle that turns a held thing stands out past its far end: which way that is in the prop's own drawing
 * (radians from its +x: a bat runs along x, a bottle stands along y), and how far out.
 */
export function holdTurnLead(prop: PropName): { lead: number; reach: number } {
  const [x0, y0, x1, y1] = propBox(prop);
  const ends: [number, number][] = [[x1, 0], [y1, Math.PI / 2], [-x0, Math.PI], [-y0, -Math.PI / 2]];
  const [reach, lead] = ends.reduce((a, b) => (b[0] > a[0] + 1e-9 ? b : a));
  return { lead, reach: Math.max(reach, 0.06) };
}
/** Where that handle is in the room. */
export function holdTurnAt(prop: PropName, at: PlacedHold): [number, number] {
  const { lead, reach } = holdTurnLead(prop);
  const r = reach * at.scale + 0.07;
  return [at.at[0] + Math.cos(at.angle + lead) * r, at.at[1] + Math.sin(at.angle + lead) * r];
}
/** Whether a point of the room is on a held thing (a finger's breadth round it). */
export function onHold(prop: PropName, at: PlacedHold, x: number, y: number, pad = 0.025): boolean {
  const [x0, y0, x1, y1] = propBox(prop);
  const dx = x - at.at[0], dy = y - at.at[1];
  const c = Math.cos(at.angle), s = Math.sin(at.angle);
  const lx = (dx * c + dy * s) / at.scale, ly = (-dx * s + dy * c) / at.scale;
  const k = pad / at.scale;
  return lx >= x0 - k && lx <= x1 + k && ly >= y0 - k && ly <= y1 + k;
}

// ---- furniture ----

/** The numbers an item takes after its x, by the names (and defaults) its drawing function gives them. */
export function itemParams(kind: ItemName): { name: string; def: number | undefined }[] {
  const src = String(ITEMS[kind]);
  const open = src.indexOf('(');
  let depth = 0, close = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) {
      close = i;
      break;
    }
  }
  return src.slice(open + 1, close).split(',').slice(2).map((part, i) => {
    const [name, def] = part.split('=').map((t) => t.trim());
    const d = def === undefined ? undefined : Number(def);
    return { name: name.replace(/:.*/, '').trim() || `n${i + 1}`, def: d !== undefined && Number.isFinite(d) ? d : undefined };
  }).filter((p) => p.name !== '');
}

/** A pen that only measures: what an item or a prop covers. */
class Bounds implements Pen {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  private add(x: number, y: number): void {
    if (x < this.x0) this.x0 = x;
    if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y;
    if (y > this.y1) this.y1 = y;
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.add(x, y);
    this.add(x + w, y + h);
  }
  rr(x: number, y: number, w: number, h: number): void {
    this.rect(x, y, w, h);
  }
  ell(cx: number, cy: number, rx: number, ry: number): void {
    this.rect(cx - Math.abs(rx), cy - Math.abs(ry), 2 * Math.abs(rx), 2 * Math.abs(ry));
  }
  poly(pts: readonly number[]): void {
    for (let i = 0; i < pts.length; i += 2) this.add(pts[i], pts[i + 1]);
  }
  line(xa: number, ya: number, xb: number, yb: number, t: number): void {
    this.rect(Math.min(xa, xb) - t / 2, Math.min(ya, yb) - t / 2, Math.abs(xb - xa) + t, Math.abs(yb - ya) + t);
  }
}
/** What an item covers in the room's picture: [x0, y0, x1, y1] (drawn smaller and higher if it stands further back). */
export function itemBox(item: Item): [number, number, number, number] {
  const b = new Bounds();
  const { kind, x, args, depth } = itemParts(item);
  (ITEMS[kind] as (p: Pen, x: number, ...a: number[]) => void)(b, x, ...args);
  const [x0, y0] = depthPoint(b.x0, b.y0, depth), [x1, y1] = depthPoint(b.x1, b.y1, depth);
  return [x0, y0, x1, y1];
}

/** Moves an item across the room, and up or down where it has a height to stand at (a `y` of its own). */
export function nudgeItem(item: Item, dx: number, dy: number): Item {
  const { kind, x, args, depth } = itemParts(item);
  if (dy !== 0) {
    const params = itemParams(kind);
    const k = params.findIndex((p) => p.name === 'y');
    if (k >= 0) {
      // (The numbers before it have to be there too: their defaults.)
      for (let i = 0; i <= k; i++) if (args[i] === undefined) args[i] = params[i].def ?? 0;
      args[k] = cm(args[k] + dy);
    }
  }
  return itemOf(kind, cm(x + dx), args, depth);
}

// ---- how far back ----

/** An item that much further back than its layer (0: in it, and no options written). */
export function itemAtDepth(item: Item, depth: number): Item {
  const { kind, x, args } = itemParts(item);
  return itemOf(kind, x, args, cm(clamp(depth, 0, MAX_DEPTH)));
}
/** One of an item's own numbers set (k from 0: its x; blank from there on where `value` is undefined), its options kept. */
export function itemWith(item: Item, k: number, value: number | undefined): Item {
  const { kind, x, args, depth } = itemParts(item);
  if (k === 0) return itemOf(kind, cm(value ?? 0), args, depth);
  if (value === undefined) return itemOf(kind, x, args.slice(0, k - 1), depth);
  const params = itemParams(kind);
  for (let j = 0; j < k - 1; j++) if (args[j] === undefined) args[j] = params[j]?.def ?? 0;
  args[k - 1] = cm(value);
  return itemOf(kind, x, args, depth);
}
/** Puts a figure that much further back than the people's layer (0: in it, and the field left out). */
export function setFigDepth(f: Fig, depth: number): void {
  const d = cm(clamp(depth, 0, MAX_DEPTH));
  if (d > 0) (f as { depth?: number }).depth = d;
  else delete (f as { depth?: number }).depth;
}

// ---- turning a part ----

export const PART_LABEL: Record<PartName, string> = { body: 'body', chest: 'chest', head: 'head', armL: 'upper arm L', foreL: 'forearm L', handL: 'hand L', armR: 'upper arm R', foreR: 'forearm R', handR: 'hand R', thighL: 'thigh L', shinL: 'shin L', footL: 'foot L', thighR: 'thigh R', shinR: 'shin R', footR: 'foot R' };
/** The part a handle's dot belongs to (the one its joint ends). */
export const HANDLE_PART: Record<string, PartName> = { handL: 'handL', handR: 'handR', elbowL: 'armL', elbowR: 'armR', footL: 'shinL', footR: 'shinR', kneeL: 'thighL', kneeR: 'thighR', head: 'head', chest: 'chest' };
/** The bones a click on a figure picks a part by: from a joint to a joint. */
export const PART_BONES: readonly (readonly [JointName, JointName, PartName])[] = [
  ['footL', 'toeL', 'footL'], ['footR', 'toeR', 'footR'],
  ['wristL', 'handL', 'handL'], ['wristR', 'handR', 'handR'], ['elbowL', 'wristL', 'foreL'], ['elbowR', 'wristR', 'foreR'], ['shoulderL', 'elbowL', 'armL'], ['shoulderR', 'elbowR', 'armR'],
  ['kneeL', 'footL', 'shinL'], ['kneeR', 'footR', 'shinR'], ['hipL', 'kneeL', 'thighL'], ['hipR', 'kneeR', 'thighR'],
  ['neck', 'head', 'head'], ['chest', 'neck', 'chest'], ['pelvis', 'chest', 'chest'], ['hipL', 'hipR', 'body'],
];

type V3 = readonly [number, number, number];
const cross = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Two directions square to an axis and to each other: from u to v is a positive (right-handed) turn about it. */
export function ringBasis(n: V3): [[number, number, number], [number, number, number]] {
  const u = unit(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return [u, cross(n, u)];
}
/** A point of a turn's ring in the picture: where it is, whether that side is toward the street, and which way a positive turn carries it (m a radian). */
export interface RingPoint {
  readonly x: number;
  readonly y: number;
  readonly front: boolean;
  readonly tx: number;
  readonly ty: number;
}
/** A turn's ring as it lies now: a circle of radius r about the joint, square to the turn's axis, seen from the street. */
export function ringPoints(joint: readonly [number, number], n: V3, r: number, count = 48): RingPoint[] {
  const [u, v] = ringBasis(n);
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    return { x: joint[0] + r * (c * u[0] + sn * v[0]), y: joint[1] + r * (c * u[1] + sn * v[1]), front: c * u[2] + sn * v[2] >= 0, tx: r * (-sn * u[0] + c * v[0]), ty: r * (-sn * u[1] + c * v[1]) };
  });
}
/**
 * Where round a ring the pointer is (radians, growing with a positive turn), from the point of the ring's plane
 * under it; null where the ring is seen nearly edge on (then ringSlide).
 */
export function ringAngle(joint: readonly [number, number], n: V3, x: number, y: number): number | null {
  if (Math.abs(n[2]) < 0.3) return null;
  const dx = x - joint[0], dy = y - joint[1], dz = -(n[0] * dx + n[1] * dy) / n[2];
  const [u, v] = ringBasis(n);
  return Math.atan2(dx * v[0] + dy * v[1] + dz * v[2], dx * u[0] + dy * u[1] + dz * u[2]);
}
/**
 * How far (radians) a pointer's move turns a ring seen edge on, taken on its near side (`front`) or its far side:
 * along the line the ring makes in the picture, its own radius of travel to a radian. (A positive turn carries the
 * near side of a ring one way along that line and the far side the other.)
 */
export function ringSlide(n: V3, front: boolean, r: number, dx: number, dy: number): number {
  const m = Math.hypot(n[0], n[1]) || 1;
  const way = front ? 1 : -1;
  return (way * (dx * n[1] - dy * n[0])) / m / r;
}
/** A pose with one of a part's turns set: within the joint's range, to the degree. */
export const turned = (pose: Pose, st: PartStep, value: number): Pose => poseWith(pose, st, Math.round(clamp(value, st.range[0], st.range[1])) || 0);

// ---- how it plays ----

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/**
 * Where among its poses a scene is at a phase of its cycle (0 to 1), as the wall shader works it out (city.ts): it
 * rests in the first for `hold` of the cycle, moves through the rest to the last over `go` (a share of the cycle),
 * rests there and comes back. Gives the two poses to blend and how far from the first to the second.
 */
export function poseAt(phase: number, poses: number, hold: number, go: number): { p0: number; p1: number; t: number } {
  if (poses < 2) return { p0: 0, p1: 0, t: 0 };
  const g = Math.max(Math.min(go, hold, 1 - hold), 1e-4);
  const at = (poses - 1) * (smooth(hold - g, hold, phase) - smooth(1 - g, 1, phase));
  const p0 = Math.min(Math.floor(at), poses - 2);
  return { p0, p1: Math.min(p0 + 1, poses - 1), t: at - p0 };
}
