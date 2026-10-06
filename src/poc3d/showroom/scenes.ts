import { edition } from '@edition';
import { addKey, adjustHold, castChoices, clone, cm, copyHoldEverywhere, copyPose, deg, emptyScene, HANDLE_PART, holdCorners, holdTurnAt, holdTurnLead, itemAtDepth, itemBox, itemParams, itemWith, moveKey, nudgeItem, onHold, outfitsFor, PART_BONES, PART_LABEL, poseAt, ringAngle, ringPoints, ringSlide, setFigDepth, turned, type RingPoint, removeHoldEverywhere, removeKey, resetHold, sceneKeys, setSceneKeys, undress, undressed, withHeels, type KeyPose, type SceneDoc } from '../real/sceneEdit';
import { adultOnly, isBuiltIn, placeFor, SCENE_ID, sceneFileFor, sceneText, type ScenePlace } from '../real/sceneFiles';
import { handleJoint, HANDLES, mirrorFig, reach, swapSides, turnHead, type Handle } from '../real/sceneIk';
import { JOINTS, placeFigure, placePart, scenePainter, type JointName, type PlacedFigure, type PlacedPart } from '../real/windowAtlas';
import { isBare } from '../district/peopleMix';
import type { Body } from '../real/mobRig';
import { CAST, CATS, catsOf, checkScene, depthPoint, depthScale, goOf, holdAt, HOLD_REACH, HOLD_SCALE, isShopKind, itemParts, LIMB_REST, MAX_DEPTH, PART_STEPS, PARTS, poseValue, poseWith, isWindowScene, ITEMS, MAX_SCENES, MIN_PERIOD, periodOf, posesOf, PROPS, SCENES, sceneOverrides, SHOP_KINDS, WHEN, WINDOW_ATLAS, windowLayout, type Fig, type Hold, type HoldAt, type Item, type ItemName, type PartName, type PartStep, type Pose, type PropName, type Scene } from '../real/windowScenes';

/**
 * The scene editor (scenes.html): the rooms behind the windows (real/windowScenes.ts has their format) adjusted by
 * hand. Pick a scene, take hold of a figure or a piece of furniture in the room and move it, or set any number of
 * it in the panel; step through its poses, play it as the city will, and save it as a file.
 *
 * What is drawn is the painter's own work (real/windowAtlas.ts: the same posing, placing and rasterising the atlas
 * gets), and a hand or a foot dragged is solved in the scene's own angles (real/sceneIk.ts), so the page holds
 * nothing but the scene's plain object: what you see is what is saved, and what is saved is what the city reads.
 * The preview under the room is the atlas's cell at its own size, played with the wall shader's blending
 * (real/sceneEdit.ts poseAt) and the same floor on how fast a room may move (MIN_PERIOD).
 *
 * In the room: a dot drags a joint (solved in the limb's own angles); a click on a limb takes that part in hand,
 * with a ring for each of its turns drawn where that turn's axis lies now (windowAtlas.ts placePart: the rings are
 * the pose's own numbers, in the order the painter applies them), the same numbers as X, Y and Z in the panel; a
 * held thing is moved, turned and sized where it's drawn; Alt-drag stands a figure or a piece further back; poses
 * are copied over one another whole, a figure at a time or a part at a time.
 *
 * Saving goes through the dev server (scripts/debugShots.mjs `/__scene`; real/sceneFiles.ts says what may go where):
 * a built-in scene's edited copy and new standard scenes to content/world3d/windows/<id>.json, the uncensored
 * edition's to adult/content/windows/<id>.json. Without the dev server, Save downloads the file instead. Unsaved
 * work is kept in the browser (a refresh brings it back) and leaving with it unsaved asks first.
 */

// ---- the scenes there are ----

interface Entry {
  readonly id: string;
  /** Where it lives: in windowScenes.ts (and not edited), or as a file in one of the two folders. */
  place: 'builtin' | ScenePlace;
  /** Its object as the file (or the module) holds it; null where a file couldn't be read. */
  scene: SceneDoc | null;
  errors: string[];
  /** A file's edited copy of a built-in scene. */
  overrides?: boolean;
  /** Why it can't be saved over (a scene inside a list file, or a file not named by its id). */
  locked?: string;
  /** Not saved yet. */
  isNew?: boolean;
}

interface SceneFile {
  place: ScenePlace;
  name: string;
  text: string;
}
interface Draft {
  id: string;
  place: ScenePlace;
  isNew: boolean;
  text: string;
  saved: string;
}

const entries: Entry[] = [];
let server = false;

function check(scene: unknown): string[] {
  const errors: string[] = [];
  checkScene(scene, errors, '');
  return errors.map((e) => e.replace(/^\s*'[^']*':\s*|^:\s*/, ''));
}

async function loadEntries(): Promise<void> {
  entries.length = 0;
  for (const s of SCENES) entries.push({ id: s.id, place: 'builtin', scene: clone(s) as unknown as SceneDoc, errors: [] });
  let files: SceneFile[] | null = null;
  try {
    const r = await fetch('/__scene');
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) files = ((await r.json()) as { files: SceneFile[] }).files;
  } catch {
    files = null;
  }
  server = files !== null;
  const add = (place: ScenePlace, raw: unknown, name: string | null, inList: boolean): void => {
    const id = (raw as { id?: unknown } | null)?.id;
    const errors = check(raw);
    if (typeof id !== 'string') {
      entries.push({ id: name ?? '(a scene)', place, scene: null, errors: errors.length ? errors : ['no id'] });
      return;
    }
    const locked = inList ? `it is one of several scenes in ${name}: duplicate it to edit` : name !== null && name !== `${id}.json` ? `its file is ${name}, not ${id}.json: duplicate it to edit` : undefined;
    const e: Entry = { id, place, scene: raw as SceneDoc, errors, locked };
    const at = entries.findIndex((x) => x.id === id);
    // (An edited copy of a built-in scene: the repository's, or adult/'s, which is the one the uncensored edition plays.)
    if (at >= 0 && isBuiltIn(id) && (entries[at].place === 'builtin' || (place === 'adult' && entries[at].place === 'content' && raw !== null && (raw as { adult?: unknown }).adult === true))) entries[at] = { ...e, overrides: true };
    else if (at >= 0) entries.push({ ...e, errors: [...errors, 'that id is taken'] });
    else entries.push(e);
  };
  if (files) {
    for (const f of files) {
      let raw: unknown;
      try {
        raw = JSON.parse(f.text);
      } catch (err) {
        entries.push({ id: f.name, place: f.place, scene: null, errors: [`not JSON: ${String(err).slice(0, 120)}`] });
        continue;
      }
      if (Array.isArray(raw)) for (const one of raw) add(f.place, one, f.name, true);
      else add(f.place, raw, f.name, false);
    }
  } else {
    // (No dev server: what the build itself holds.)
    for (const raw of sceneOverrides()) add('content', clone(raw), null, false);
    for (const raw of (edition.windowScenes ?? []).flatMap((s) => (Array.isArray(s) ? (s as unknown[]) : [s]))) add('adult', clone(raw), null, false);
  }
}

// ---- what is being edited ----

// (A figure, something figure `i` holds (its `hold` list's entry `h`), or a piece of furniture.)
// (A figure may have one of its parts in hand: its rings are shown, and the arrows turn it.)
type Sel = { kind: 'fig'; deep: boolean; i: number; part?: PartName } | { kind: 'hold'; deep: boolean; i: number; h: number } | { kind: 'item'; list: 'back' | 'front' | 'aItems'; i: number } | null;

let entry: Entry | null = null;
let doc: SceneDoc = emptyScene('new_scene', 'home');
let place: ScenePlace = 'content';
let savedText = '';
let frame = 0;
let sel: Sel = null;
let working = true;
/** Onion skin: the pose before (blue) and the pose after (red), each shown or not. */
let onionPrev = true;
let onionNext = true;
let problems: string[] = [];
const undo: string[] = [];
const redo: string[] = [];
let lastEdit = '';
let lastEditAt = 0;

const DRAFT = 'citypop.scenes.draft';
const dirty = (): boolean => sceneText(doc) !== savedText;
const keys = (): KeyPose[] => sceneKeys(doc);
const figs = (): Fig[] => keys()[Math.min(frame, keys().length - 1)].a;
const deepFigs = (): Fig[] => (doc.deep as Fig[] | undefined) ?? [];
/** The figure in hand: the one selected, or the one whose held thing is. */
const figSel = (): { deep: boolean; i: number } | null => (sel?.kind === 'fig' || sel?.kind === 'hold' ? sel : null);
const inHand = (deep: boolean, i: number): boolean => {
  const fs = figSel();
  return !!fs && fs.deep === deep && fs.i === i;
};
const selFig = (): Fig | null => {
  const fs = figSel();
  return fs ? ((fs.deep ? deepFigs() : figs())[fs.i] ?? null) : null;
};
const selPart = (): PartName | null => (sel?.kind === 'fig' ? (sel.part ?? null) : null);
/** Which of the part in hand's turns the arrow keys nudge (the ring last touched). */
let axis = 0;
/** The part in hand as the painter has it, from the last draw. */
let placedPart: PlacedPart | null = null;
const selHold = (): Hold | null => (sel?.kind === 'hold' ? (selFig()?.hold?.[sel.h] ?? null) : null);
/** A selection of something that's gone falls back: a held thing to its figure, a figure to nothing. */
function tidySel(): void {
  if (sel?.kind === 'hold' && !selHold()) sel = selFig() ? { kind: 'fig', deep: sel.deep, i: sel.i } : null;
  if (sel?.kind === 'fig' && !selFig()) sel = null;
  if (sel?.kind === 'item' && !selItem()) sel = null;
}
/** Puts a changed hold back in a figure's list. */
function putHold(f: Fig, n: number, hold: Hold): void {
  const list = [...(f.hold ?? [])];
  list[n] = hold;
  (f as { hold?: readonly Hold[] }).hold = list;
}
const itemList = (list: 'back' | 'front' | 'aItems'): Item[] => {
  if (list !== 'aItems') return (doc[list] as Item[] | undefined) ?? [];
  return keys()[Math.min(frame, keys().length - 1)].aItems ?? [];
};
const selItem = (): Item | null => (sel?.kind === 'item' ? (itemList(sel.list)[sel.i] ?? null) : null);
/** The items list of the scene, made if it isn't there (the people's: on the pose shown). */
function itemsFor(list: 'back' | 'front' | 'aItems'): Item[] {
  if (list !== 'aItems') return (doc[list] ??= []) as Item[];
  const k = keys();
  const key = k[Math.min(frame, k.length - 1)];
  if (!key.aItems) {
    key.aItems = [];
    setSceneKeys(doc, k);
  }
  return key.aItems;
}

/** Before a change: what it was, for undo. Changes of one thing in quick succession (a slider dragged) are one step. */
function checkpoint(what = ''): void {
  const now = performance.now();
  if (what && what === lastEdit && now - lastEditAt < 900) {
    lastEditAt = now;
    return;
  }
  lastEdit = what;
  lastEditAt = now;
  const snap = JSON.stringify({ doc, frame });
  if (undo[undo.length - 1] !== snap) undo.push(snap);
  if (undo.length > 300) undo.shift();
  redo.length = 0;
}
function restore(snap: string): void {
  const s = JSON.parse(snap) as { doc: SceneDoc; frame: number };
  doc = s.doc;
  frame = Math.min(s.frame, sceneKeys(doc).length - 1);
  tidySel();
  lastEdit = '';
  changed(true);
}
function stepBack(from: string[], to: string[]): void {
  const snap = from.pop();
  if (!snap) return;
  to.push(JSON.stringify({ doc, frame }));
  restore(snap);
}

/** After a change: check it, draw it, keep it. `panels`: the side's fields are rebuilt too. */
function changed(panels: boolean): void {
  // (Empty lists are left out of the file.)
  for (const k of ['back', 'front', 'deep', 'aItems', 'bItems'] as const) if (Array.isArray(doc[k]) && (doc[k] as unknown[]).length === 0) delete doc[k];
  tidySel();
  validate();
  fieldsStale = true;
  draw();
  if (panels) renderSide();
  else renderStatus();
  renderTimeline();
  try {
    if (dirty()) localStorage.setItem(DRAFT, JSON.stringify({ id: entry?.id ?? doc.id, place, isNew: entry?.isNew === true, text: sceneText(doc), saved: savedText }));
    else localStorage.removeItem(DRAFT);
  } catch {
    // (No storage: nothing to keep it in.)
  }
}

function validate(): void {
  problems = check(doc);
  if (entry?.isNew && entries.some((e) => e !== entry && e.id === doc.id)) problems.push(`id: '${doc.id}' is taken`);
  // (A built-in scene's edited copy goes where what it now is sends it: adult/ once it's adult, else the repository.)
  if (entry && !entry.isNew && problems.length === 0) place = placeFor(doc as unknown as Scene, entry.place);
  const plan = sceneFileFor(doc, place);
  if ('error' in plan && problems.length === 0) problems.push(plan.error);
  if (entry?.locked) problems.push(entry.locked);
}

function open(e: Entry, from?: { text: string; saved: string }): void {
  if (!e.scene) return;
  entry = e;
  doc = from ? (JSON.parse(from.text) as SceneDoc) : clone(e.scene);
  place = e.place === 'builtin' ? 'content' : e.place;
  savedText = from ? from.saved : e.isNew ? '' : sceneText(e.scene);
  frame = 0;
  sel = doc.a.length ? { kind: 'fig', deep: false, i: 0 } : null;
  undo.length = redo.length = 0;
  playing = false;
  history.replaceState(null, '', `#${e.id}`);
  renderList();
  changed(true);
}

// ---- the page ----

const $ = (id: string): HTMLElement => document.getElementById(id)!;
type Props = Record<string, unknown>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') e.setAttribute('style', String(v));
    else if (k.startsWith('data-')) e.setAttribute(k, String(v));
    else (e as unknown as Props)[k] = v;
  }
  for (const k of kids) e.append(k);
  return e;
}

/** What each field is, in the words of the format's own guide (windowScenes.ts). */
const HELP: Record<string, string> = {
  id: 'Letters, digits and _ only, unique. Edition scenes should start with their own prefix. The file is named by it.',
  label: 'A line saying what it is, for the contact sheet.',
  cat: 'Which rooms it goes in: a flat or house; one with the television on; an office; a hotel; a bar or club upstairs (den); the rooms where the city\'s vice shows (v_...); or a shady shop\'s room at street level (g_...: still, one room a kind).',
  weight: '1 to 4: how many chances it gets among its kind\'s scenes.',
  adult: 'Anything sexual or nude: left out of the demo edition, and saved only to adult/.',
  when: 'For vice scenes, which of the night\'s hours its people keep: evening from about six on, late from about ten (most from midnight to three), lovers from about nine to two.',
  low: 'It only reads through glass that reaches the floor (someone lying down, a bed): shown only behind curtain walls and balcony doors.',
  near: 'Stand the back furniture close behind the people (the sofa they sit on) instead of against the far wall.',
  slide: 'Metres a second (0.1 to 2): the people walk to and fro across the room, mirrored on the way back. Draw them facing the viewer\'s right at x about 0, the poses a stride.',
  tween: '0 to 3: in-between poses made between each pose and the next (the figures\' angles interpolated). Each takes a quarter of an atlas cell.',
  period: 'The cycle\'s length in seconds (0.3 to 20). Anything under 2.4 s plays at 2.4 s unless the people walk.',
  hold: 'The share of the cycle spent resting in the first pose (0.05 to 0.95).',
  go: 'Seconds the move from one pose to the next takes (0.1 to 2.5; blank: 0.45 and a little more for each in-between).',
  seat: 'The height of what they sit on (a chair 0.45, a sofa 0.42, a bar stool 0.75, a bed 0.5, the floor 0.02): the hips rest there.',
  floor: 'Without a seat, the figure\'s lowest point rests here (0 the floor; 0.5 lying on a bed; 0.28 on the little stage).',
  yaw: 'Which way they face: 0 the window, 90 the viewer\'s right, -90 the left, 180 the room.',
  pitch: 'The whole body tipped forward (+) or back (-): -90 lies on the back, 90 on the front.',
  roll: 'The whole body tipped sideways (90 lies on a side).',
  lean: 'The spine bent forward (a bow 50; leaning back -20).',
  bend: 'The spine bent sideways.',
  twist: 'The spine turned.',
  nod: 'The head down (+) or back (-).',
  tilt: 'The head to a shoulder.',
  turn: 'The head looking round.',
  arm: 'raise: forward and up from hanging (90 level in front, 180 overhead, negative behind); swing: that direction turned outward (90 out to the side); elbow: its bend; twist: the upper arm turned inward, so a bent forearm crosses the body.',
  leg: 'raise: the thigh forward (88 sitting); swing: outward; knee: its bend (88 sitting on a chair).',
  depth: 'Distance: metres further back in the room than its layer (0 to 2.5). It is drawn as that looks from the street: smaller and higher, toward the horizon at 1.5 m. Within a layer everything is one outline, so who overlaps whom doesn\'t matter: distance is about size, height in the frame and what the furniture in front hides.',
  setBack: 'Metres further from the window than a room\'s people stand by themselves (0 to 2.5): the whole scene stands deeper in its room, so from the street it is smaller and the window\'s frame hides more of it. Seen only in the city (the cell below is the same).',
};

// The room as drawn: the painter's raster, set in a view with a margin for the floor line and the rulers.
const RP = 160;
const S = 190;
const PADX = 0.16, PADT = 0.12, PADB = 0.24;
const ROOM_W = WINDOW_ATLAS.w, ROOM_H = WINDOW_ATLAS.h;
const VW = Math.round((ROOM_W + 2 * PADX) * S), VH = Math.round((ROOM_H + PADT + PADB) * S);
const sx = (x: number): number => (x + ROOM_W / 2 + PADX) * S;
const sy = (y: number): number => (ROOM_H + PADT - y) * S;
const mx = (px: number): number => px / S - ROOM_W / 2 - PADX;
const my = (py: number): number => ROOM_H + PADT - py / S;

let painter: ReturnType<typeof scenePainter>;
let cellPainter: ReturnType<typeof scenePainter>;
let raster: HTMLCanvasElement;
let rasterImg: ImageData;
let view: HTMLCanvasElement;
let atlas: HTMLCanvasElement;
let cell: HTMLCanvasElement;
let cellImg: ImageData;

const alphaCache = new Map<string, Uint8Array>();
function cached(p: typeof painter, tag: string, key: unknown, make: () => Uint8Array): Uint8Array {
  const k = `${tag}|${JSON.stringify(key)}`;
  let a = alphaCache.get(k);
  if (!a) {
    a = make().slice();
    alphaCache.set(k, a);
    if (alphaCache.size > 260) alphaCache.delete(alphaCache.keys().next().value as string);
  }
  void p;
  return a;
}
const figAlpha = (f: Fig): Uint8Array => cached(painter, 'f', f, () => painter.alpha([f]));
const itemsAlpha = (items: readonly Item[]): Uint8Array => cached(painter, 'i', items, () => painter.alpha(undefined, items));

const ROOM_RGB = (): [number, number, number] => {
  const cat = String(catsOf(doc as unknown as Scene)[0] ?? 'home');
  return cat === 'office' || cat === 'v_office' ? [185, 205, 210] : cat === 'den' || cat === 'v_den' || cat === 'v_love' || isShopKind(cat) ? [196, 168, 128] : [217, 192, 142];
};

function blend(al: Uint8Array, rgb: readonly [number, number, number], opacity = 1): void {
  const d = rasterImg.data;
  for (let i = 0, o = 0; i < al.length; i++, o += 4) {
    const a = al[i];
    if (a === 0) continue;
    const k = (a / 255) * opacity;
    d[o] += (rgb[0] - d[o]) * k;
    d[o + 1] += (rgb[1] - d[o + 1]) * k;
    d[o + 2] += (rgb[2] - d[o + 2]) * k;
  }
}

let placedFigs: PlacedFigure[] = [];
let placedDeep: PlacedFigure[] = [];
const safePlace = (f: Fig): PlacedFigure | null => {
  try {
    return placeFigure(f);
  } catch {
    return null;
  }
};
const NOWHERE: PlacedFigure = { joints: Object.fromEntries(JOINTS.map((j) => [j, [0, 0]])) as PlacedFigure['joints'], box: [0, 0, 0, 0], holds: [], scale: 1 };

const BONES: readonly (readonly [JointName, JointName])[] = [['pelvis', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['wristL', 'handL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'], ['wristR', 'handR'], ['hipL', 'kneeL'], ['kneeL', 'footL'], ['hipR', 'kneeR'], ['kneeR', 'footR'], ['footL', 'toeL'], ['footR', 'toeR'], ['shoulderL', 'shoulderR'], ['hipL', 'hipR']];

/** Whether the figures of a scene can be drawn at all (a who that isn't a body the painter knows would throw). */
const drawable = (): boolean => !problems.some((p) => /who is a name|no body|no outfit|no hair|is a figure|list of|is an object|is a list/.test(p));

function draw(): void {
  if (!view) return;
  const g = view.getContext('2d')!;
  const room = ROOM_RGB();
  const d = rasterImg.data;
  for (let o = 0; o < d.length; o += 4) {
    d[o] = room[0];
    d[o + 1] = room[1];
    d[o + 2] = room[2];
    d[o + 3] = 255;
  }
  const ok = drawable();
  placedFigs = [];
  placedDeep = [];
  if (ok) {
    try {
      const k = keys();
      const now = Math.min(frame, k.length - 1);
      if (doc.back) blend(itemsAlpha(doc.back as Item[]), working ? [96, 88, 76] : [77, 70, 60]);
      for (const f of deepFigs()) blend(figAlpha(f), [72, 66, 58]);
      if (!playing && k.length > 1) {
        // (The pose before is the one being worked from: a stronger blue. The pose after, a fainter red.)
        if (onionPrev && now > 0) for (const f of k[now - 1].a) blend(figAlpha(f), [30, 80, 210], 0.34);
        if (onionNext && now < k.length - 1) for (const f of k[now + 1].a) blend(figAlpha(f), [200, 60, 40], 0.2);
      }
      figs().forEach((f, i) => blend(figAlpha(f), working ? (inHand(false, i) ? [96, 82, 60] : [70, 72, 82]) : [22, 22, 26]));
      if (k[now].aItems?.length) blend(itemsAlpha(k[now].aItems!), [22, 22, 26]);
      if (doc.front) blend(itemsAlpha(doc.front as Item[]), [5, 5, 6], working ? 0.6 : 1);
      placedFigs = figs().map((f) => safePlace(f) ?? NOWHERE);
      placedDeep = deepFigs().map((f) => safePlace(f) ?? NOWHERE);
    } catch (err) {
      console.warn('scene editor: could not draw', err);
    }
  }
  raster.getContext('2d')!.putImageData(rasterImg, 0, 0);
  g.fillStyle = '#17181c';
  g.fillRect(0, 0, VW, VH);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(raster, sx(-ROOM_W / 2), sy(ROOM_H), ROOM_W * S, ROOM_H * S);

  // The rulers: metres across from the middle and up from the floor; the floor; an ordinary window's sill; where a
  // narrow room and a hotel room cut the scene off.
  g.lineWidth = 1;
  g.font = '11px Consolas, monospace';
  g.textBaseline = 'top';
  g.textAlign = 'center';
  for (let x = -2; x <= 2.001; x += 0.5) {
    g.strokeStyle = working ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.04)';
    g.beginPath();
    g.moveTo(Math.round(sx(x)) + 0.5, sy(ROOM_H));
    g.lineTo(Math.round(sx(x)) + 0.5, sy(0));
    g.stroke();
    g.fillStyle = '#9aa0b0';
    g.fillText(String(x), sx(x), sy(0) + 6);
  }
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (let y = 0; y <= 2.501; y += 0.5) {
    g.strokeStyle = working ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.04)';
    g.beginPath();
    g.moveTo(sx(-ROOM_W / 2), Math.round(sy(y)) + 0.5);
    g.lineTo(sx(ROOM_W / 2), Math.round(sy(y)) + 0.5);
    g.stroke();
    g.fillStyle = '#9aa0b0';
    g.fillText(String(y), sx(-ROOM_W / 2) - 4, sy(y));
  }
  g.strokeStyle = '#e8e4da';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(sx(-ROOM_W / 2), sy(0) + 1);
  g.lineTo(sx(ROOM_W / 2), sy(0) + 1);
  g.stroke();
  g.lineWidth = 1;
  g.textAlign = 'left';
  g.textBaseline = 'bottom';
  g.setLineDash([6, 5]);
  g.strokeStyle = doc.low ? 'rgba(160,40,40,0.35)' : 'rgba(160,40,40,0.75)';
  g.beginPath();
  g.moveTo(sx(-ROOM_W / 2), sy(0.9));
  g.lineTo(sx(ROOM_W / 2), sy(0.9));
  g.stroke();
  g.fillStyle = 'rgba(120,30,30,0.9)';
  g.fillText(doc.low ? 'sill 0.9 m (this scene is only shown behind glass to the floor)' : 'sill 0.9 m: an ordinary window hides what is below', sx(-ROOM_W / 2) + 4, sy(0.9) - 2);
  for (const [x, name] of [[-0.8, 'hotel room'], [0.8, ''], [-1.3, 'narrow room'], [1.3, '']] as const) {
    g.strokeStyle = 'rgba(30,60,140,0.55)';
    g.beginPath();
    g.moveTo(sx(x), sy(ROOM_H));
    g.lineTo(sx(x), sy(0));
    g.stroke();
    g.fillStyle = 'rgba(30,60,140,0.9)';
    if (name) g.fillText(name, sx(x) + 3, sy(ROOM_H) + 13);
  }
  g.setLineDash([]);
  if (working) {
    // The floor in perspective, as things further back than their layer are drawn (depthPoint): each half metre of
    // distance, and lines running back.
    g.strokeStyle = 'rgba(30,60,140,0.2)';
    g.beginPath();
    for (let d = 0.5; d <= MAX_DEPTH + 0.001; d += 0.5) {
      const a = depthPoint(-ROOM_W / 2, 0, d), b = depthPoint(ROOM_W / 2, 0, d);
      g.moveTo(sx(a[0]), Math.round(sy(a[1])) + 0.5);
      g.lineTo(sx(b[0]), Math.round(sy(b[1])) + 0.5);
    }
    for (let x = -2; x <= 2.001; x += 0.5) {
      const b = depthPoint(x, 0, MAX_DEPTH);
      g.moveTo(sx(x), sy(0));
      g.lineTo(sx(b[0]), sy(b[1]));
    }
    g.stroke();
    g.fillStyle = 'rgba(30,60,140,0.75)';
    g.font = '10px Consolas, monospace';
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    for (const d of [1, 2]) {
      const b = depthPoint(ROOM_W / 2, 0, d);
      g.fillText(`${d} m back`, sx(b[0]) + 4, sy(b[1]) + 4);
    }
    g.font = '11px Consolas, monospace';
  }

  // Furniture: what each piece covers.
  const box = (b: readonly number[], colour: string, dash: number[]): void => {
    g.strokeStyle = colour;
    g.setLineDash(dash);
    g.strokeRect(sx(b[0]) - 1, sy(b[3]) - 1, (b[2] - b[0]) * S + 2, (b[3] - b[1]) * S + 2);
    g.setLineDash([]);
  };
  for (const list of ['back', 'front', 'aItems'] as const) {
    itemList(list).forEach((it, i) => {
      const on = sel?.kind === 'item' && sel.list === list && sel.i === i;
      if (!on && !working) return;
      try {
        box(itemBox(it), on ? '#ffd070' : list === 'back' ? 'rgba(60,50,40,0.5)' : 'rgba(0,0,0,0.45)', on ? [] : [3, 3]);
      } catch {
        // (An item the format doesn't know: the checks say so.)
      }
    });
  }
  // The figures' joints; the one in hand with its handles.
  const skeleton = (p: PlacedFigure, on: boolean, deep: boolean): void => {
    if (!working && !on) return;
    g.strokeStyle = on ? 'rgba(255,255,255,0.85)' : deep ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.5)';
    g.lineWidth = on ? 1.5 : 1;
    g.beginPath();
    for (const [a, b] of BONES) {
      g.moveTo(sx(p.joints[a][0]), sy(p.joints[a][1]));
      g.lineTo(sx(p.joints[b][0]), sy(p.joints[b][1]));
    }
    g.stroke();
    g.lineWidth = 1;
    if (!on) return;
    const dot = (j: JointName, r: number, fill: string): void => {
      g.beginPath();
      g.arc(sx(p.joints[j][0]), sy(p.joints[j][1]), r, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      g.strokeStyle = '#101014';
      g.stroke();
    };
    dot('pelvis', 7, '#ffffff');
    for (const h of HANDLES) if (h !== 'head') dot(handleJoint(h), h.startsWith('hand') || h.startsWith('foot') ? 7 : 5, h.endsWith('L') ? '#60d0ff' : h.endsWith('R') ? '#ffa040' : '#f0e060');
    // (The head's is a diamond: it nods and tilts the head; with Shift, turns it.)
    const hx = sx(p.joints.head[0]), hy = sy(p.joints.head[1]);
    g.beginPath();
    g.moveTo(hx, hy - 8);
    g.lineTo(hx + 8, hy);
    g.lineTo(hx, hy + 8);
    g.lineTo(hx - 8, hy);
    g.closePath();
    g.fillStyle = '#ff80c0';
    g.fill();
    g.strokeStyle = '#101014';
    g.stroke();
    g.fillStyle = '#101014';
    g.font = 'bold 9px Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const h of ['handL', 'handR', 'footL', 'footR'] as const) g.fillText(h.slice(-1), sx(p.joints[h][0]), sy(p.joints[h][1]) + 0.5);
  };
  placedDeep.forEach((p, i) => skeleton(p, inHand(true, i), true));
  placedFigs.forEach((p, i) => skeleton(p, inHand(false, i), false));
  // The part in hand: its bone, its own axes, and a ring for each of its turns where that turn's axis is now.
  placedPart = null;
  const part = selPart(), partFig = selFig();
  if (part && partFig && ok) {
    try {
      placedPart = placePart(partFig, part);
    } catch {
      placedPart = null;
    }
    if (placedPart) drawGizmo(g, placedPart);
  }
  // What the figure in hand holds: each thing's outline; the one taken hold of with its handles (the square moves
  // it, the round one turns it) and a mark where it would be by itself.
  const fs = figSel();
  const pf = fs ? (fs.deep ? placedDeep : placedFigs)[fs.i] : null;
  const held = selFig()?.hold;
  if (pf && held) {
    held.forEach((h, n) => {
      const at = pf.holds[n];
      if (!at || !(h[1] in PROPS)) return;
      const on = sel?.kind === 'hold' && sel.h === n;
      g.strokeStyle = on ? '#ffd070' : 'rgba(255,208,112,0.6)';
      g.setLineDash(on ? [] : [3, 3]);
      g.lineWidth = on ? 1.5 : 1;
      g.beginPath();
      holdCorners(h[1], at).forEach(([x, y], k) => (k ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y))));
      g.closePath();
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 1;
      if (!on) return;
      if (at.anchor[0] !== at.at[0] || at.anchor[1] !== at.at[1]) {
        g.strokeStyle = 'rgba(255,208,112,0.7)';
        g.setLineDash([2, 3]);
        g.beginPath();
        g.moveTo(sx(at.anchor[0]), sy(at.anchor[1]));
        g.lineTo(sx(at.at[0]), sy(at.at[1]));
        g.stroke();
        g.setLineDash([]);
        g.beginPath();
        g.moveTo(sx(at.anchor[0]) - 4, sy(at.anchor[1]) - 4);
        g.lineTo(sx(at.anchor[0]) + 4, sy(at.anchor[1]) + 4);
        g.moveTo(sx(at.anchor[0]) - 4, sy(at.anchor[1]) + 4);
        g.lineTo(sx(at.anchor[0]) + 4, sy(at.anchor[1]) - 4);
        g.stroke();
      }
      const t = holdTurnAt(h[1], at);
      g.strokeStyle = '#ffd070';
      g.beginPath();
      g.moveTo(sx(at.at[0]), sy(at.at[1]));
      g.lineTo(sx(t[0]), sy(t[1]));
      g.stroke();
      g.fillStyle = '#ffd070';
      g.strokeStyle = '#101014';
      g.fillRect(sx(at.at[0]) - 5, sy(at.at[1]) - 5, 10, 10);
      g.strokeRect(sx(at.at[0]) - 5, sy(at.at[1]) - 5, 10, 10);
      g.beginPath();
      g.arc(sx(t[0]), sy(t[1]), 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    });
  }
  if (!ok) {
    g.fillStyle = '#e09090';
    g.font = '14px Consolas, monospace';
    g.textAlign = 'center';
    g.fillText('this scene can\'t be drawn until its errors are fixed', VW / 2, VH / 2);
  }
  drawCell();
}

const AXIS_RGB = { x: '255,96,96', y: '112,224,112', z: '96,160,255' } as const;
/** A ring's size in the picture: each turn's a little larger than the last, so rings about one axis don't lie on one another. */
const ringR = (k: number, scale: number): number => (0.19 + 0.035 * k) * scale;
const ringsOf = (pp: PlacedPart): RingPoint[][] => pp.axes.map((a, k) => ringPoints(pp.joint, a.n, ringR(k, pp.scale)));
/** What a ring drag shows by the joint while it turns. */
let ringText = '';

function drawGizmo(g: CanvasRenderingContext2D, pp: PlacedPart): void {
  const jx = sx(pp.joint[0]), jy = sy(pp.joint[1]);
  // Its bone.
  g.strokeStyle = '#ffd070';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(jx, jy);
  g.lineTo(sx(pp.end[0]), sy(pp.end[1]));
  g.stroke();
  // Its own x, y and z as they point now (a ring where one points straight at the street or away).
  const L = 0.1 * pp.scale * S;
  g.font = 'bold 9px Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  (['x', 'y', 'z'] as const).forEach((name, k) => {
    const a = pp.frame[k];
    g.strokeStyle = g.fillStyle = `rgb(${AXIS_RGB[name]})`;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(jx, jy);
    g.lineTo(jx + a[0] * L, jy - a[1] * L);
    g.stroke();
    if (Math.abs(a[2]) > 0.85) {
      g.beginPath();
      g.arc(jx, jy, 4, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillText(name, jx + a[0] * (L + 7), jy - a[1] * (L + 7));
  });
  // The rings: the half toward the street drawn full, the far half faint.
  ringsOf(pp).forEach((pts, k) => {
    const rgb = AXIS_RGB[pp.axes[k].step.axis];
    g.lineWidth = k === axis ? 3 : 1.5;
    for (const front of [false, true]) {
      g.strokeStyle = `rgba(${rgb},${front ? 0.95 : 0.3})`;
      g.beginPath();
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length];
        if (a.front !== front) return;
        g.moveTo(sx(a.x), sy(a.y));
        g.lineTo(sx(b.x), sy(b.y));
      });
      g.stroke();
    }
    // (Its name and number in a column beside the rings.)
    const text = `${pp.axes[k].step.axis.toUpperCase()} ${pp.axes[k].step.name} ${pp.axes[k].value}°`;
    const tx = jx + ringR(2, pp.scale) * S + 10, ty = jy - 14 + 13 * k;
    g.font = `${k === axis ? 'bold ' : ''}11px Consolas, monospace`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(16,16,20,0.75)';
    g.fillRect(tx - 3, ty - 7, g.measureText(text).width + 6, 13);
    g.fillStyle = `rgb(${rgb})`;
    g.fillText(text, tx, ty);
  });
  g.textAlign = 'center';
  g.lineWidth = 1;
  if (ringText) {
    g.font = 'bold 13px Consolas, monospace';
    g.textBaseline = 'top';
    g.fillStyle = '#101014';
    g.fillText(ringText, jx + 1, jy + 15);
    g.fillStyle = '#ffffff';
    g.fillText(ringText, jx, jy + 14);
  }
  g.font = '11px Consolas, monospace';
}

/** Which of the part in hand's rings is under a point of the page's canvas (within a few pixels), and where on it. */
function ringAt(px: number, py: number): { k: number; pt: RingPoint } | null {
  if (!placedPart || !working) return null;
  let best: { k: number; pt: RingPoint; d: number } | null = null;
  ringsOf(placedPart).forEach((pts, k) => {
    for (const pt of pts) {
      // (The near half of a ring before the far half of another.)
      const d = Math.hypot(sx(pt.x) - px, sy(pt.y) - py) + (pt.front ? 0 : 2.5);
      if (d < 8 && (!best || d < best.d)) best = { k, pt, d };
    }
  });
  return best;
}
/** Which part of a placed figure is under a point of the room: its nearest bone, within a hand's breadth. */
function partAt(x: number, y: number, p: PlacedFigure): PartName | null {
  let best: { part: PartName; d: number } | null = null;
  for (const [a, b, part] of PART_BONES) {
    const d = segDist(x, y, p.joints[a], p.joints[b]);
    if (d < 0.09 * p.scale && (!best || d < best.d - 0.005)) best = { part, d };
  }
  return (best as { part: PartName } | null)?.part ?? null;
}
/** Sets one of the turns of the part in hand, and the fields that show it. */
function setTurn(k: number, value: number): void {
  const f = selFig() as { pose: Pose } | null;
  const ax = placedPart?.axes[k];
  if (!f || !ax) return;
  f.pose = turned(f.pose, ax.step, value);
  ringText = `${ax.step.name} ${poseValue(f.pose, ax.step)}°`;
}
/** The pose's numbers in the panel follow the room: every field bound to one (a slider, a limb's box, a part's X, Y or Z). */
function syncFields(): void {
  const f = selFig();
  if (!f) return;
  for (const node of document.querySelectorAll<HTMLInputElement>('#side [data-bind]')) {
    if (node === document.activeElement) continue;
    const [key, at] = node.dataset.bind!.split('.');
    const v = at === undefined ? ((f.pose as Record<string, number | undefined>)[key] ?? 0) : ((f.pose as Record<string, readonly number[] | undefined>)[key]?.[Number(at)] ?? LIMB_REST[key[0] as 'a' | 'l' | 'f' | 'h'][Number(at)]);
    const text = String(deg(v));
    if (node.value !== text) node.value = text;
  }
}

// ---- the atlas's cell, played as the city plays it ----

let playing = false;
let playT = 0;
let scrub: number | null = null;
let opening: 'room' | 'sill' | 'floor' | 'hotel' = 'sill';
let fieldsStale = true;
let fields: Uint8Array[] = [];
let backA: Uint8Array | null = null;
let frontA: Uint8Array | null = null;
let deepF: Uint8Array | null = null;

function cellFields(): void {
  if (!fieldsStale) return;
  fieldsStale = false;
  fields = [];
  backA = frontA = deepF = null;
  if (!drawable()) return;
  try {
    const poses = posesOf(doc as unknown as Scene);
    fields = poses.map((p) => cached(cellPainter, 'F', p, () => cellPainter.field(p.a, p.aItems)));
    if (doc.back) backA = cached(cellPainter, 'I', doc.back, () => cellPainter.alpha(undefined, doc.back as Item[]));
    if (doc.front) frontA = cached(cellPainter, 'I', doc.front, () => cellPainter.alpha(undefined, doc.front as Item[]));
    if (doc.deep && !doc.anim) deepF = cached(cellPainter, 'F', { a: doc.deep }, () => cellPainter.field(doc.deep as Fig[]));
  } catch (err) {
    console.warn('scene editor: could not paint the cell', err);
  }
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Where the play is: the two poses to blend and how far between them, and the walk's place and facing. */
function playState(): { p0: number; p1: number; t: number; shift: number; flip: boolean; phase: number } {
  const s = doc as unknown as Scene;
  const n = fields.length;
  if (n < 2 || !s.anim) return { p0: 0, p1: 0, t: 0, shift: 0, flip: false, phase: 0 };
  if (!playing && scrub === null) {
    // Paused: the key pose in hand.
    const per = Math.round((n - 1) / Math.max(1, keys().length - 1));
    const p = Math.min(frame * per, n - 1);
    return { p0: p, p1: p, t: 0, shift: 0, flip: false, phase: 0 };
  }
  const period = periodOf(s);
  const phase = scrub ?? (playT / period) % 1;
  const at = poseAt(phase, n, s.anim[1], goOf(s, n) / period);
  let shift = 0, flip = false;
  if (s.slide) {
    // (As the shader walks them: across the room and a little past its walls, and back the other way round.)
    const span = ROOM_W + 1.2;
    const pp = (((scrub !== null ? scrub * 2 * span / s.slide : playT) * s.slide) / (2 * span)) % 1 * 2;
    shift = (0.5 - Math.abs(pp - 1)) * span;
    flip = pp >= 1;
  }
  return { ...at, shift, flip, phase };
}

function drawCell(): void {
  if (!cell) return;
  cellFields();
  const W = WINDOW_ATLAS.cellW, H = WINDOW_ATLAS.cellH;
  const d = cellImg.data;
  const room = ROOM_RGB();
  const wall: [number, number, number] = [room[0] * 0.86, room[1] * 0.86, room[2] * 0.86];
  const ink = [24, 23, 26];
  const st = playState();
  const f0 = fields[st.p0], f1 = fields[st.p1];
  const shiftPx = Math.round(st.shift * WINDOW_ATLAS.ppm);
  const sw = 0.035;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4;
      let r = wall[0], gg = wall[1], b = wall[2];
      const over = (k: number, tint: number): void => {
        r += (ink[0] + wall[0] * tint - r) * k;
        gg += (ink[1] + wall[1] * tint - gg) * k;
        b += (ink[2] + wall[2] * tint - b) * k;
      };
      let k = backA ? sstep(0.3, 0.6, backA[i] / 255) : 0;
      if (deepF) k = Math.max(k, sstep(0.5 - sw, 0.5 + sw, deepF[i] / 255));
      if (k > 0) over(k, 0.2);
      if (f0) {
        // The people: one pose's outline blended into the next's, as the shader does with their distance fields.
        let px = x - shiftPx;
        if (st.flip) px = W - 1 - px;
        if (px >= 0 && px < W) {
          const j = y * W + px;
          const v = (f0[j] + (f1[j] - f0[j]) * st.t) / 255;
          const kp = sstep(0.5 - sw, 0.5 + sw, v);
          if (kp > 0) over(kp, 0.05);
        }
      }
      if (frontA) {
        const kf = sstep(0.3, 0.6, frontA[i] / 255);
        if (kf > 0) over(kf, 0);
      }
      d[o] = r;
      d[o + 1] = gg;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  cell.getContext('2d')!.putImageData(cellImg, 0, 0);
  const g = atlas.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.drawImage(cell, 0, 0, atlas.width, atlas.height);
  // The window's opening: what of the cell a window of that kind lets the street see.
  const k = atlas.width / ROOM_W;
  const shade = (x0: number, y0: number, x1: number, y1: number): void => {
    g.fillStyle = 'rgba(12,12,16,0.72)';
    g.fillRect((x0 + ROOM_W / 2) * k, (ROOM_H - y1) * k, (x1 - x0) * k, (y1 - y0) * k);
  };
  const half = opening === 'hotel' ? 0.8 : opening === 'room' ? 2 : 1.0;
  const bottom = opening === 'sill' || opening === 'hotel' ? 0.9 : 0;
  if (opening !== 'room') {
    shade(-2, 0, -half, ROOM_H);
    shade(half, 0, 2, ROOM_H);
    if (bottom > 0) shade(-half, 0, half, bottom);
    shade(-half, 2.35, half, ROOM_H);
  }
}

function tick(now: number): void {
  if (playing) {
    playT += Math.min(0.1, (now - lastTick) / 1000);
    drawCell();
    const ph = $('phase') as HTMLInputElement | null;
    if (ph && document.activeElement !== ph) ph.value = String(playState().phase);
  }
  lastTick = now;
  requestAnimationFrame(tick);
}
let lastTick = 0;

// ---- taking hold ----

type Drag =
  | { kind: 'handle'; handle: Handle }
  | { kind: 'body'; x0: number; h0: number; mx0: number; my0: number }
  | { kind: 'item'; mx0: number; my0: number; item0: Item }
  | { kind: 'hold'; mx0: number; my0: number; hold0: Hold }
  | { kind: 'holdTurn' }
  // (A ring of the part in hand: from the number it had, by how far round the pointer has gone.)
  | { kind: 'ring'; k: number; pt: RingPoint; mx0: number; my0: number; v0: number; last: number | null; acc: number }
  | { kind: 'headTurn'; mx0: number; t0: number; way: number }
  | { kind: 'depth'; my0: number; d0: number }
  | null;
let drag: Drag = null;
let moved = false;

const near = (p: readonly [number, number], x: number, y: number, r: number): boolean => Math.hypot(sx(p[0]) - x, sy(p[1]) - y) <= r;
function segDist(px: number, py: number, a: readonly number[], b: readonly number[]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}
/** Which figure is under a point of the room (by its bones, a hand's breadth either side). */
function figureAt(x: number, y: number): { deep: boolean; i: number } | null {
  for (const [list, deep] of [[placedFigs, false], [placedDeep, true]] as const) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (x < p.box[0] - 0.05 || x > p.box[2] + 0.05 || y < p.box[1] - 0.05 || y > p.box[3] + 0.05) continue;
      if (BONES.some(([a, b]) => segDist(x, y, p.joints[a], p.joints[b]) < 0.13) || Math.hypot(x - p.joints.head[0], y - p.joints.head[1]) < 0.16) return { deep, i };
    }
  }
  return null;
}

/** Which held thing is under a point of the room: the figures in front first. */
function heldAt(x: number, y: number): { deep: boolean; i: number; h: number } | null {
  for (const [list, people, deep] of [[placedFigs, figs(), false], [placedDeep, deepFigs(), true]] as const) {
    for (let i = list.length - 1; i >= 0; i--) {
      const hold = people[i]?.hold ?? [];
      for (let h = hold.length - 1; h >= 0; h--) {
        const at = list[i].holds[h];
        if (at && hold[h][1] in PROPS && onHold(hold[h][1], at, x, y)) return { deep, i, h };
      }
    }
  }
  return null;
}

function pointerDown(ev: PointerEvent): void {
  const r = view.getBoundingClientRect();
  const px = ((ev.clientX - r.left) * VW) / r.width, py = ((ev.clientY - r.top) * VH) / r.height;
  const x = mx(px), y = my(py);
  moved = false;
  const fs = figSel();
  const p = fs ? (fs.deep ? placedDeep : placedFigs)[fs.i] : null;
  // A ring of the part in hand before anything but a dot of the figure right under the pointer: it turns that one
  // number of the pose.
  const onDot = !!p && [...HANDLES].some((h) => near(p.joints[handleJoint(h)], px, py, h.startsWith('hand') || h.startsWith('foot') ? 7 : 5));
  const ring = ev.altKey || onDot ? null : ringAt(px, py);
  if (ring && placedPart) {
    axis = ring.k;
    const a = placedPart.axes[ring.k];
    drag = { kind: 'ring', k: ring.k, pt: ring.pt, mx0: x, my0: y, v0: a.value, last: ringAngle(placedPart.joint, a.n, x, y), acc: 0 };
  }
  // A held thing in hand next: its round handle turns it, the thing itself moves it (with Shift, turns it).
  if (!drag && p && sel?.kind === 'hold') {
    const h = selHold(), at = p.holds[sel.h];
    if (h && at && h[1] in PROPS) {
      if (near(holdTurnAt(h[1], at), px, py, 8)) drag = { kind: 'holdTurn' };
      else if (near(at.at, px, py, 8) || onHold(h[1], at, x, y)) drag = ev.shiftKey ? { kind: 'holdTurn' } : { kind: 'hold', mx0: x, my0: y, hold0: h };
    }
  }
  // Then the handles of the figure in hand.
  if (!drag && p && fs) {
    const hit = [...HANDLES].reverse().find((h) => near(p.joints[handleJoint(h)], px, py, h.startsWith('hand') || h.startsWith('foot') ? 9 : 7));
    const fig0 = selFig();
    // (The head's with Shift turns it, looking round: the nose goes the pointer's way.)
    if (hit === 'head' && ev.shiftKey && fig0) drag = { kind: 'headTurn', mx0: x, t0: fig0.pose.turn ?? 0, way: Math.cos((((fig0.pose.yaw ?? 0) + (fig0.pose.twist ?? 0)) * Math.PI) / 180) >= 0 ? 1 : -1 };
    else if (hit) drag = { kind: 'handle', handle: hit };
    else if (near(p.joints.pelvis, px, py, 9)) drag = bodyDrag(x, y);
    // (A dot takes its part in hand with it: the part its joint ends.)
    const part = hit ? HANDLE_PART[hit] : undefined;
    if (drag && (sel?.kind === 'hold' || (part && selPart() !== part))) {
      sel = { kind: 'fig', deep: fs.deep, i: fs.i, ...(part ?? selPart() ? { part: part ?? selPart()! } : {}) };
      axis = 0;
      renderSide();
    }
  }
  if (!drag) {
    // What anyone holds, before the figures themselves.
    const held = heldAt(x, y);
    const f = held ? null : figureAt(x, y);
    if (held) {
      sel = { kind: 'hold', ...held };
      const h = selHold();
      drag = !h ? null : ev.shiftKey ? { kind: 'holdTurn' } : { kind: 'hold', mx0: x, my0: y, hold0: h };
    } else if (f) {
      // (A click on a limb of the figure already in hand takes that part in hand.)
      const same = fs && fs.deep === f.deep && fs.i === f.i;
      const part = same ? (partAt(x, y, (f.deep ? placedDeep : placedFigs)[f.i]) ?? selPart()) : null;
      if (part !== selPart()) axis = 0;
      sel = { kind: 'fig', ...f, ...(part ? { part } : {}) };
      drag = bodyDrag(x, y);
    } else {
      // Furniture: the nearest layer first, the smallest piece under the pointer.
      let best: { list: 'back' | 'front' | 'aItems'; i: number; area: number } | null = null;
      for (const list of ['aItems', 'front', 'back'] as const) {
        itemList(list).forEach((it, i) => {
          try {
            const b = itemBox(it);
            const area = (b[2] - b[0]) * (b[3] - b[1]);
            if (x >= b[0] - 0.03 && x <= b[2] + 0.03 && y >= b[1] - 0.03 && y <= b[3] + 0.03 && (!best || area < best.area)) best = { list, i, area };
          } catch {
            // (Not an item the format knows.)
          }
        });
        if (best) break;
      }
      const hit = best as { list: 'back' | 'front' | 'aItems'; i: number } | null;
      if (hit) {
        sel = { kind: 'item', list: hit.list, i: hit.i };
        drag = { kind: 'item', mx0: x, my0: y, item0: [...itemList(hit.list)[hit.i]] as unknown as Item };
      } else sel = null;
    }
    renderSide();
  }
  // With Alt, the drag is how far back the figure or the piece stands: up is further.
  if (ev.altKey && (sel?.kind === 'fig' || sel?.kind === 'item')) drag = { kind: 'depth', my0: y, d0: depthNow() };
  if (drag) view.setPointerCapture(ev.pointerId);
  draw();
}
/** How far back than its layer the figure or the piece in hand stands. */
function depthNow(): number {
  const it = selItem();
  return sel?.kind === 'item' ? (it ? itemParts(it).depth : 0) : (selFig()?.depth ?? 0);
}
function setDepth(d: number): void {
  if (sel?.kind === 'item') {
    const it = selItem();
    if (it) itemList(sel.list)[sel.i] = itemAtDepth(it, d);
  } else {
    const f = selFig();
    if (f) setFigDepth(f, d);
  }
}
function bodyDrag(x: number, y: number): Drag {
  const f = selFig();
  return f ? { kind: 'body', x0: f.x, h0: f.seat ?? f.floor ?? 0, mx0: x, my0: y } : null;
}

function pointerMove(ev: PointerEvent): void {
  if (!drag) return;
  const r = view.getBoundingClientRect();
  const x = mx(((ev.clientX - r.left) * VW) / r.width), y = my(((ev.clientY - r.top) * VH) / r.height);
  if (!moved) {
    checkpoint();
    moved = true;
  }
  const f = selFig() as { -readonly [K in keyof Fig]: Fig[K] } | null;
  if (drag.kind === 'handle' && f) {
    try {
      f.pose = reach(f, drag.handle, [x, y]).pose;
    } catch {
      // (A figure the painter can't pose: the checks say why.)
    }
  } else if (drag.kind === 'ring' && f && placedPart) {
    // Round the ring where it lies open to the eye; along it where it's seen edge on.
    const a = placedPart.axes[drag.k];
    const now = ringAngle(placedPart.joint, a.n, x, y);
    if (now !== null && drag.last !== null) {
      drag.acc += ((((now - drag.last + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
      drag.last = now;
      setTurn(drag.k, drag.v0 + (drag.acc * 180) / Math.PI);
    } else setTurn(drag.k, drag.v0 + (ringSlide(a.n, drag.pt.front, ringR(drag.k, placedPart.scale), x - drag.mx0, y - drag.my0) * 180) / Math.PI);
  } else if (drag.kind === 'headTurn' && f) {
    f.pose = turnHead(f, drag.t0 + drag.way * (x - drag.mx0) * 220).pose;
  } else if (drag.kind === 'depth') {
    setDepth(drag.d0 + (y - drag.my0) * 2.5);
  } else if (drag.kind === 'body' && f) {
    // (A figure further back is drawn smaller: the pointer's move is that much more of the room.)
    const sc = depthScale(f.depth);
    f.x = cm(Math.min(2, Math.max(-2, drag.x0 + (x - drag.mx0) / sc)));
    const h = cm(Math.min(1.5, Math.max(0, drag.h0 + (y - drag.my0) / sc)));
    // (Held with Shift, it only goes across.)
    if (!ev.shiftKey) {
      if (f.seat !== undefined) f.seat = h;
      else if (h > 0) f.floor = h;
      else delete f.floor;
    }
  } else if (drag.kind === 'item' && sel?.kind === 'item') {
    const sc = depthScale(itemParts(drag.item0).depth);
    itemList(sel.list)[sel.i] = nudgeItem(drag.item0, Math.min(2.5, Math.max(-2.5, drag.item0[1] + (x - drag.mx0) / sc)) - drag.item0[1], ev.shiftKey ? 0 : (y - drag.my0) / sc);
  } else if (drag.kind === 'hold' && sel?.kind === 'hold' && f) {
    // (From where it was when taken: how far the pointer has gone.)
    const a = holdAt(drag.hold0);
    const sc = depthScale(f.depth);
    putHold(f, sel.h, adjustHold(drag.hold0, { dx: a.dx + (x - drag.mx0) / sc, dy: a.dy + (y - drag.my0) / sc }));
  } else if (drag.kind === 'holdTurn' && sel?.kind === 'hold' && f) {
    // (Its far end follows the pointer round where it's drawn, to the degree.)
    const h = selHold();
    const at = (sel.deep ? placedDeep : placedFigs)[sel.i]?.holds[sel.h];
    if (h && at && Math.hypot(x - at.at[0], y - at.at[1]) > 0.01) {
      const turned = Math.round(((Math.atan2(y - at.at[1], x - at.at[0]) - holdTurnLead(h[1]).lead) * 180) / Math.PI);
      putHold(f, sel.h, adjustHold(h, { rot: ((((turned + 180) % 360) + 360) % 360) - 180 }));
    }
  }
  validate();
  fieldsStale = true;
  draw();
  renderStatus();
  syncFields();
}
function pointerUp(): void {
  ringText = '';
  if (drag && moved) changed(true);
  else if (drag) draw();
  drag = null;
}
/** A double click on a ring puts that turn back at rest; on the white dot at the hips, takes the whole body in hand. */
function doubleClick(ev: MouseEvent): void {
  const r = view.getBoundingClientRect();
  const px = ((ev.clientX - r.left) * VW) / r.width, py = ((ev.clientY - r.top) * VH) / r.height;
  const f = selFig() as { pose: Pose } | null;
  const ring = ringAt(px, py);
  const fs = figSel();
  if (ring && f && placedPart) {
    checkpoint();
    const st = placedPart.axes[ring.k].step;
    f.pose = poseWith(f.pose, st, st.def);
    axis = ring.k;
    changed(true);
  } else if (fs && sel?.kind === 'fig' && near(((fs.deep ? placedDeep : placedFigs)[fs.i] ?? NOWHERE).joints.pelvis, px, py, 10)) {
    sel = { kind: 'fig', deep: fs.deep, i: fs.i, part: 'body' };
    axis = 0;
    renderSide();
    draw();
  }
}
/** The wheel over the room sizes the held thing in hand. */
function wheel(ev: WheelEvent): void {
  // (With Alt: how far back the figure or the piece in hand stands.)
  if (ev.altKey && (sel?.kind === 'fig' || sel?.kind === 'item')) {
    ev.preventDefault();
    checkpoint('depth');
    setDepth(depthNow() + (ev.deltaY < 0 || ev.deltaX < 0 ? 0.05 : -0.05));
    changed(true);
    return;
  }
  const f = selFig(), h = selHold();
  if (sel?.kind !== 'hold' || !f || !h) return;
  ev.preventDefault();
  checkpoint('hold size');
  putHold(f, sel.h, adjustHold(h, { scale: holdAt(h).scale * (ev.deltaY < 0 ? 1.05 : 1 / 1.05) }));
  changed(true);
}

function keyDown(ev: KeyboardEvent): void {
  const t = ev.target as HTMLElement;
  const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    stepBack(ev.shiftKey ? redo : undo, ev.shiftKey ? undo : redo);
    return;
  }
  if (ctrl && ev.key.toLowerCase() === 'y') {
    ev.preventDefault();
    stepBack(redo, undo);
    return;
  }
  if (ctrl && ev.key.toLowerCase() === 's') {
    ev.preventDefault();
    void save();
    return;
  }
  // Ctrl+Shift+] and [: this pose over the next, or the one before, and on to it.
  if (ctrl && ev.shiftKey && (ev.code === 'BracketRight' || ev.code === 'BracketLeft')) {
    ev.preventDefault();
    const to = frame + (ev.code === 'BracketRight' ? 1 : -1);
    copyOver(frame, [to], {}, to >= 0 && to < keys().length ? to : undefined);
    return;
  }
  if (typing) return;
  // A part in hand: left and right turn its active ring a degree (Shift: five), up and down pick the ring, Esc lets go.
  const part = selPart();
  if (part && sel?.kind === 'fig' && ev.key.startsWith('Arrow')) {
    ev.preventDefault();
    const n = PART_STEPS[part].filter((st) => st.fixed === undefined).length;
    axis = Math.min(axis, n - 1);
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      axis = (axis + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
      renderSide();
      draw();
    } else if (placedPart) {
      checkpoint(`turn ${part} ${axis}`);
      setTurn(axis, placedPart.axes[axis].value + (ev.key === 'ArrowRight' ? 1 : -1) * (ev.shiftKey ? 5 : 1));
      ringText = '';
      changed(true);
    }
    return;
  }
  if (part && sel?.kind === 'fig' && ev.key === 'Escape') {
    sel = { kind: 'fig', deep: sel.deep, i: sel.i };
    renderSide();
    draw();
    return;
  }
  const step = ev.shiftKey ? 0.05 : 0.01;
  const arrow = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, [number, number]>)[ev.key];
  if (arrow && sel) {
    ev.preventDefault();
    checkpoint('nudge');
    const f = selFig() as { -readonly [K in keyof Fig]: Fig[K] } | null;
    const held = selHold();
    if (sel.kind === 'hold') {
      if (f && held) putHold(f, sel.h, adjustHold(held, { dx: holdAt(held).dx + arrow[0], dy: holdAt(held).dy + arrow[1] }));
    } else if (f) {
      f.x = cm(Math.min(2, Math.max(-2, f.x + arrow[0])));
      if (arrow[1]) {
        const h = cm(Math.min(1.5, Math.max(0, (f.seat ?? f.floor ?? 0) + arrow[1])));
        if (f.seat !== undefined) f.seat = h;
        else if (h > 0) f.floor = h;
        else delete f.floor;
      }
    } else if (sel.kind === 'item') itemList(sel.list)[sel.i] = nudgeItem(itemList(sel.list)[sel.i], arrow[0], arrow[1]);
    changed(true);
  } else if (ev.key === 'Delete' && sel) {
    ev.preventDefault();
    removeSelected();
  } else if (ev.key === ' ') {
    ev.preventDefault();
    togglePlay();
  } else if (ev.key === '[' || ev.key === ']') {
    frame = Math.min(keys().length - 1, Math.max(0, frame + (ev.key === ']' ? 1 : -1)));
    changed(true);
  } else if (ev.key.toLowerCase() === 'w') {
    working = !working;
    renderMid();
    draw();
  }
}

function removeSelected(): void {
  if (!sel) return;
  checkpoint();
  if (sel.kind === 'hold') {
    // (What's held goes from this pose; the panel's button takes it from every pose.)
    const f = selFig() as { hold?: readonly Hold[] } | null;
    const at = sel.h;
    if (f?.hold) {
      const rest = f.hold.filter((_, n) => n !== at);
      if (rest.length) f.hold = rest;
      else delete f.hold;
    }
    sel = { kind: 'fig', deep: sel.deep, i: sel.i };
    changed(true);
    return;
  }
  if (sel.kind === 'fig') {
    if (sel.deep) deepFigs().splice(sel.i, 1);
    else if (figs().length > 1) {
      // (A figure goes from every pose: the poses' figures run in step.)
      const k = keys();
      for (const key of k) key.a.splice(sel.i, 1);
      setSceneKeys(doc, k);
    } else {
      status('a scene keeps at least one figure');
      return;
    }
  } else itemList(sel.list).splice(sel.i, 1);
  sel = null;
  changed(true);
}

function togglePlay(): void {
  if (keys().length < 2) return;
  playing = !playing;
  scrub = null;
  draw();
  renderTimeline();
}

// ---- the panels ----

let statusText = '';
function status(text: string): void {
  statusText = text;
  renderStatus();
}

function renderList(): void {
  const list = $('list');
  const q = (($('search') as HTMLInputElement | null)?.value ?? '').toLowerCase();
  const kind = ($('kind') as HTMLSelectElement | null)?.value ?? 'all';
  list.innerHTML = '';
  const search = el('input', { id: 'search', type: 'text', placeholder: 'search id or label', value: q, oninput: () => renderList() });
  const kinds = el('select', { id: 'kind', onchange: () => renderList() }, ...['all', ...CATS, ...SHOP_KINDS, 'edited', 'adult/', 'invalid'].map((k) => el('option', { value: k, selected: k === kind }, k === 'all' ? 'every kind' : k === 'edited' ? 'edited built-ins and new' : k === 'adult/' ? 'the edition\'s (adult/)' : k)));
  list.append(
    el('h3', {}, 'Scenes'),
    search,
    el('div', { className: 'bar' }, kinds),
    el('div', { className: 'bar' }, el('button', { onclick: () => newScene(false), title: 'A new scene with one figure in an empty room.' }, 'new'), el('button', { onclick: () => newScene(true), title: 'A copy of the scene in hand, under a new id.', disabled: !entry }, 'duplicate')),
    el('div', { className: 'hint' }, server ? 'dev server: Save writes files' : 'no dev server: Save downloads the JSON'),
  );
  const box = el('div', { id: 'scenes' });
  list.append(box);
  const shown = entries.filter((e) => {
    const cats = e.scene ? catsOf(e.scene as unknown as Scene).map(String) : [];
    if (kind === 'invalid' ? e.errors.length === 0 : kind === 'edited' ? !(e.overrides || (e.place === 'content' && !e.overrides) || e.isNew) : kind === 'adult/' ? e.place !== 'adult' : kind !== 'all' && !cats.includes(kind)) return false;
    return !q || e.id.toLowerCase().includes(q) || String(e.scene?.label ?? '').toLowerCase().includes(q);
  });
  let last = '';
  for (const e of shown) {
    const group = e.scene ? String(catsOf(e.scene as unknown as Scene)[0] ?? '?') : 'unreadable';
    if (group !== last) box.append(el('div', { className: 'kind' }, group));
    last = group;
    const tag = e.isNew ? 'new' : e.overrides ? (e.place === 'adult' ? 'edited, adult/' : 'edited') : e.place === 'builtin' ? '' : e.place === 'adult' ? 'adult/' : 'content/';
    const b = el('button', { className: `${e === entry ? 'on' : ''} ${e.errors.length ? 'bad' : ''}`, title: e.errors.length ? e.errors.join('\n') : String(e.scene?.label ?? ''), onclick: () => pick(e) }, e.id, el('span', { className: 'tag' }, tag ? `  ${tag}` : ''));
    if (!e.scene) b.disabled = true;
    box.append(b);
  }
  // (The search box keeps the caret through the rebuild.)
  if (document.activeElement === document.body && q) {
    search.focus();
    search.setSelectionRange(q.length, q.length);
  }
}

function pick(e: Entry): void {
  if (e === entry) return;
  if (dirty() && !confirm(`'${doc.id}' has unsaved changes. Leave them?`)) return;
  open(e);
}

function newScene(copy: boolean): void {
  if (dirty() && !confirm(`'${doc.id}' has unsaved changes. Leave them?`)) return;
  const base = copy ? clone(doc) : null;
  const adult = base ? adultOnly(base as unknown as Scene) : false;
  const id = prompt('The new scene\'s id (lower-case letters, digits and _):', base ? `${doc.id}_2` : 'my_scene');
  if (!id) return;
  if (!SCENE_ID.test(id) || entries.some((e) => e.id === id)) {
    alert(SCENE_ID.test(id) ? `'${id}' is taken` : 'An id is lower-case letters, digits and _, starting with a letter.');
    return;
  }
  let to: ScenePlace = adult ? 'adult' : 'content';
  if (base && entry && entry.place === 'adult' && !adult) to = confirm('This copy is not marked adult. OK: keep it in the repository (content/world3d/windows). Cancel: keep it with the edition\'s (adult/), marked adult.') ? 'content' : 'adult';
  const scene = base ? ({ ...base, id } as SceneDoc) : emptyScene(id, 'home');
  if (to === 'adult') scene.adult = true;
  const e: Entry = { id, place: to, scene, errors: [], isNew: true };
  entries.push(e);
  open(e);
}

function renderMid(): void {
  const mid = $('mid');
  mid.innerHTML = '';
  view = el('canvas', { id: 'room', width: VW, height: VH });
  view.addEventListener('pointerdown', pointerDown);
  view.addEventListener('pointermove', pointerMove);
  view.addEventListener('pointerup', pointerUp);
  view.addEventListener('pointercancel', pointerUp);
  view.addEventListener('wheel', wheel, { passive: false });
  view.addEventListener('dblclick', doubleClick);
  atlas = el('canvas', { id: 'atlas', width: WINDOW_ATLAS.cellW * 2, height: WINDOW_ATLAS.cellH * 2, title: 'The atlas\'s cell (256 x 160) at twice its size, as the city draws it.' });
  mid.append(
    el('div', { className: 'bar' },
      el('button', { className: working ? 'on' : '', title: 'W. Figures in grey with their joints, furniture outlined.', onclick: () => ((working = true), renderMid(), draw()) }, 'working view'),
      el('button', { className: working ? '' : 'on', title: 'W. Dark shapes against the room\'s light, as the city shows them.', onclick: () => ((working = false), renderMid(), draw()) }, 'as the city draws it'),
      el('button', { className: onionPrev ? 'on' : '', style: 'color:#7fa8ff', title: 'Onion skin: the pose before this one, in blue, under the figures.', onclick: () => ((onionPrev = !onionPrev), renderMid(), draw()) }, 'onion: previous'),
      el('button', { className: onionNext ? 'on' : '', style: 'color:#ff9a80', title: 'Onion skin: the pose after this one, in red, under the figures.', onclick: () => ((onionNext = !onionNext), renderMid(), draw()) }, 'onion: next'),
      el('button', { title: 'Ctrl+Z', onclick: () => stepBack(undo, redo) }, 'undo'),
      el('button', { title: 'Ctrl+Y', onclick: () => stepBack(redo, undo) }, 'redo'),
      el('span', { className: 'hint' }, 'drag a figure, a dot (hand, foot, elbow, knee, chest; the pink diamond nods and tilts the head, Shift: turns it), a piece of furniture · click a limb for its rings: drag a ring to turn it, ← → nudge it, ↑ ↓ the next ring, double-click resets, Esc lets go · Alt-drag or Alt-wheel: distance · a held thing: click it, drag moves, Shift-drag or its round handle turns, the wheel sizes · arrows nudge (Shift: 5) · Del removes · [ ] poses · Space plays'),
    ),
    el('div', { id: 'stage' }, view),
    el('div', { id: 'timeline' }),
    el('div', { className: 'bar' },
      atlas,
      el('div', {},
        el('div', { className: 'hint' }, 'The cell the city reads, played with the shader\'s blending.'),
        el('div', { className: 'bar' }, 'opening ', el('select', { onchange: (ev: Event) => ((opening = (ev.target as HTMLSelectElement).value as typeof opening), drawCell()) }, ...([['sill', 'a window with a sill'], ['floor', 'glass to the floor'], ['hotel', 'a hotel room\'s window'], ['room', 'the whole cell']] as const).map(([v, t]) => el('option', { value: v, selected: v === opening }, t)))),
        el('div', { id: 'cells', className: 'hint' }),
      ),
    ),
  );
  renderTimeline();
}

const poseName = (i: number): string => (i === 0 ? 'A' : i === 1 ? 'B' : String(i + 1));
/**
 * Copies this pose (or, of it, the figure or the part in hand) over others, as one step to undo; `go` then shows
 * that pose, to adjust it from what it now is.
 */
function copyOver(from: number, to: number[], what: { fig?: number; part?: PartName } = {}, go?: number): void {
  const n = keys().length;
  to = to.filter((j) => j >= 0 && j < n && j !== from);
  if (!to.length) return;
  checkpoint();
  const got = copyPose(doc, from, to, what);
  if (go !== undefined) frame = go;
  const thing = what.part ? `the ${PART_LABEL[what.part]}` : what.fig !== undefined ? 'the figure' : `pose ${poseName(from)}`;
  status(`${thing} copied ${what.fig === undefined ? '' : `from pose ${poseName(from)} `}over ${to.length === 1 ? `pose ${poseName(to[0])}` : `${to.length} poses`}${got.poses < to.length ? ` (${to.length - got.poses} already the same)` : ''}${got.unmatched ? ` · the poses have different numbers of figures: ${got.unmatched} had no match and ${got.unmatched === 1 ? 'was' : 'were'} left` : ''}`);
  changed(true);
}

function renderTimeline(): void {
  const tl = document.getElementById('timeline');
  if (!tl) return;
  tl.innerHTML = '';
  const k = keys();
  const s = doc as unknown as Scene;
  const tween = typeof doc.tween === 'number' ? doc.tween : 0;
  const still = k.length < 2;
  const chips = el('div', { className: 'bar' }, 'poses ');
  k.forEach((_, i) => {
    chips.append(el('button', { className: `pose ${i === frame ? 'on' : ''}`, title: i === 0 ? 'The first pose (a): where the people rest.' : i === 1 ? 'The second pose (b).' : `A further pose (frames[${i - 2}]).`, onclick: () => ((frame = i), (sel = selFig() ? sel : null), changed(true)) }, i === 0 ? 'A' : i === 1 ? 'B' : String(i + 1)));
    if (i < k.length - 1) for (let j = 0; j < tween; j++) chips.append(el('span', { className: 'ghost', title: 'An in-between the painter makes (tween): not edited.' }, '◦'));
  });
  const edit = (what: string, fn: () => void): (() => void) => () => {
    checkpoint();
    fn();
    status(what);
    changed(true);
  };
  chips.append(
    el('button', { title: 'A new pose after this one, a copy of it.', onclick: edit('a pose added', () => (addKey(doc, frame), (frame += 1))) }, '+ pose'),
    el('button', { title: 'Remove this pose.', disabled: still, onclick: edit('a pose removed', () => (removeKey(doc, frame), (frame = Math.min(frame, keys().length - 1)))) }, '− pose'),
    el('button', { title: 'This pose one earlier.', disabled: frame === 0, onclick: edit('', () => (frame = moveKey(doc, frame, -1))) }, '◂'),
    el('button', { title: 'This pose one later.', disabled: frame >= k.length - 1, onclick: edit('', () => (frame = moveKey(doc, frame, 1))) }, '▸'),
  );
  tl.append(chips);
  if (!still) {
    const others = k.map((_, j) => j).filter((j) => j !== frame);
    tl.append(el('div', { className: 'bar' }, 'this pose ',
      el('button', { disabled: frame === 0, title: frame === 0 ? 'There is no pose before this one.' : `Replaces pose ${poseName(frame - 1)} with this one (every figure as it is here: who, where, how far back, every angle, what's held; and the things with the people), and shows it. Ctrl+Shift+[`, onclick: () => copyOver(frame, [frame - 1], {}, frame - 1) }, '◂ copy to previous'),
      el('button', { disabled: frame >= k.length - 1, title: frame >= k.length - 1 ? 'There is no pose after this one.' : `Replaces pose ${poseName(frame + 1)} with this one (every figure as it is here: who, where, how far back, every angle, what's held; and the things with the people), and shows it, to adjust from here. Ctrl+Shift+]`, onclick: () => copyOver(frame, [frame + 1], {}, frame + 1) }, 'copy to next ▸'),
      el('button', { disabled: frame === 0, title: frame === 0 ? 'There is no pose before this one.' : `Replaces THIS pose (${poseName(frame)}) with pose ${poseName(frame - 1)}, to adjust it from there.`, onclick: () => copyOver(frame - 1, [frame]) }, 'copy from previous'),
      el('button', { title: `Replaces every other pose (${others.map(poseName).join(', ')}) with this one.`, onclick: () => copyOver(frame, others) }, 'copy to all'),
    ));
  }
  if (!still && s.anim) {
    const anim = doc.anim as number[];
    const numIn = (key: string, value: number | '', min: number, max: number, step: number, set: (v: number | null) => void): HTMLElement =>
      el('label', { title: HELP[key] }, `${key} `, el('input', { type: 'number', min, max, step, value, 'data-field': key === 'period' || key === 'hold' || key === 'go' ? 'anim' : key, oninput: (ev: Event) => {
        const raw = (ev.target as HTMLInputElement).value;
        checkpoint(key);
        set(raw === '' ? null : Number(raw));
        changed(false);
      } }));
    const period = periodOf(s);
    tl.append(el('div', { className: 'bar' },
      numIn('period', anim[0], 0.3, 20, 0.1, (v) => (anim[0] = v ?? 4)),
      numIn('hold', anim[1], 0.05, 0.95, 0.05, (v) => (anim[1] = v ?? 0.5)),
      numIn('go', anim[2] ?? '', 0.1, 2.5, 0.05, (v) => (v === null ? anim.splice(2) : (anim[2] = v))),
      numIn('tween', tween, 0, 3, 1, (v) => (v ? (doc.tween = v) : delete doc.tween)),
      numIn('slide', typeof doc.slide === 'number' ? doc.slide : '', 0.1, 2, 0.05, (v) => (v ? (doc.slide = v) : delete doc.slide)),
      el('span', { className: 'hint', id: 'plays' }, `plays ${posesOf(s).length} poses in ${period} s${period > anim[0] ? ` (not ${anim[0]} s: nothing but a walk cycles under ${MIN_PERIOD} s)` : ''}, ${goOf(s, posesOf(s).length).toFixed(2)} s a move`),
    ));
    tl.append(el('div', { className: 'bar' },
      el('button', { className: playing ? 'on' : '', title: 'Space', onclick: togglePlay }, playing ? 'pause' : 'play'),
      el('input', { id: 'phase', type: 'range', min: 0, max: 1, step: 0.002, value: scrub ?? 0, style: 'width:360px', title: 'Scrub through one cycle.', oninput: (ev: Event) => ((playing = false), (scrub = Number((ev.target as HTMLInputElement).value)), drawCell()) }),
      el('button', { title: 'Back to the pose in hand.', onclick: () => ((scrub = null), (playing = false), draw(), renderTimeline()) }, 'stop'),
    ));
  } else tl.append(el('div', { className: 'hint' }, 'A still scene. Add a pose to make it move.'));
}

function renderStatus(): void {
  const er = document.getElementById('errors');
  if (er) {
    er.className = problems.length ? '' : 'ok';
    er.textContent = problems.length ? problems.join('\n') : 'no errors';
  }
  const st = document.getElementById('status');
  if (st) st.textContent = `${dirty() ? 'unsaved changes' : 'saved'}${statusText ? ` · ${statusText}` : ''}`;
  const sv = document.getElementById('save') as HTMLButtonElement | null;
  if (sv) sv.disabled = problems.length > 0 || !dirty();
  // The fields the errors name.
  for (const input of document.querySelectorAll<HTMLElement>('[data-field]')) {
    const f = input.getAttribute('data-field')!;
    input.classList.toggle('bad', problems.some((p) => new RegExp(`(^|\\b)${f}\\b`).test(p.split(':')[0]) || p.startsWith(`${f} `)));
  }
  const cells = document.getElementById('cells');
  if (cells) {
    try {
      const s = doc as unknown as Scene;
      const others = entries.filter((e) => e !== entry && e.scene && e.errors.length === 0 && !e.isNew).map((e) => e.scene as unknown as Scene).filter(isWindowScene);
      const mine = problems.length === 0 && isWindowScene(s);
      const std = others.filter((o) => !o.adult && entries.find((e) => e.scene === (o as unknown))?.place !== 'adult');
      const cost = mine ? Math.max(0, posesOf(s).length - 2) : 0;
      const usedAll = windowLayout(mine ? [...others, s] : others).cells;
      const usedStd = windowLayout(mine && place !== 'adult' ? [...std, s] : std).cells;
      cells.textContent = `${isWindowScene(s) ? `this scene: 1 cell${cost ? ` + ${cost} pose slot${cost > 1 ? 's' : ''} (${(cost / 4).toFixed(2)} cell)` : ''}` : 'a ground-floor room: no cell of the windows\' atlas'} · standard edition ${usedStd} of ${MAX_SCENES} cells · with adult/ ${usedAll} of ${MAX_SCENES} (${MAX_SCENES - usedAll} left)`;
    } catch {
      cells.textContent = '';
    }
  }
}

/** A slider with its number box: either sets the value, the other follows. */
function slider(name: string, help: string, value: number, min: number, max: number, set: (v: number) => void): HTMLElement {
  const num = el('input', { type: 'number', min, max, step: 1, value: deg(value), 'data-bind': name });
  const range = el('input', { type: 'range', min, max, step: 1, value, 'data-bind': name });
  const apply = (from: HTMLInputElement, to: HTMLInputElement): void => {
    const v = Number(from.value);
    if (!Number.isFinite(v)) return;
    to.value = from.value;
    checkpoint(name);
    set(deg(v));
    changed(false);
  };
  range.oninput = () => apply(range, num);
  num.oninput = () => apply(num, range);
  return el('div', { className: 'row', title: help }, name, range, num);
}

function renderSide(): void {
  const side = $('side');
  const keep = side.scrollTop;
  side.innerHTML = '';
  if (!entry) return;
  const s = doc as unknown as Scene;
  const text = (key: string, value: string, set: (v: string) => void, off = false): HTMLElement =>
    el('div', { className: 'row two', title: HELP[key] }, key, el('input', { type: 'text', value, disabled: off, 'data-field': key, oninput: (ev: Event) => {
      checkpoint(key);
      set((ev.target as HTMLInputElement).value);
      changed(false);
    } }));
  const tick = (key: string, on: boolean, set: (v: boolean) => void, label = key): HTMLElement =>
    el('label', { title: HELP[key], style: 'margin-right:10px' }, el('input', { type: 'checkbox', checked: on, 'data-field': key, onchange: (ev: Event) => {
      checkpoint();
      set((ev.target as HTMLInputElement).checked);
      changed(true);
    } }), ` ${label}`);
  const flag = (key: string): HTMLElement => tick(key, doc[key] === true, (v) => (v ? (doc[key] = true) : delete doc[key]));

  // ---- where it lives, and saving ----
  const where = entry.isNew ? `new: will be saved to ${place === 'adult' ? 'adult/content/windows' : 'content/world3d/windows'}/${doc.id}.json`
    : entry.place === 'builtin' || (entry.overrides && entry.place !== place)
      ? `built in (windowScenes.ts): an edited copy is saved as ${place === 'adult' ? 'adult/content/windows' : 'content/world3d/windows'}/${doc.id}.json${place === 'adult' ? ' (adult: the uncensored edition\'s own version of it; the others keep the built-in scene)' : ''}`
    : `${entry.place === 'adult' ? 'adult/content/windows' : 'content/world3d/windows'}/${doc.id}.json${entry.overrides ? ' (an edited copy of the built-in scene)' : ''}`;
  const city = isWindowScene(s) ? `district.html?debug=1&clock=23:00&vignette=${doc.id}` : 'district.html?debug=1&clock=23:00&windowVice=4&spawn=hotel_rouge.front';
  side.append(
    el('h3', {}, 'File'),
    el('div', { className: 'hint' }, where),
    el('div', { className: 'bar' },
      el('button', { id: 'save', title: 'Ctrl+S', onclick: () => void save() }, server ? 'Save' : 'Save (download)'),
      el('button', { title: 'The scene as its file would hold it, to the clipboard.', onclick: () => void navigator.clipboard.writeText(sceneText(doc)).then(() => status('JSON copied')) }, 'copy JSON'),
      el('button', { title: 'Throw away the unsaved changes.', onclick: () => entry && (dirty() ? confirm('Throw away the unsaved changes?') : true) && open(entry) }, 'reload'),
      el('button', { title: `Delete the edited copy (${entry.place === 'adult' ? 'adult/content/windows' : 'content/world3d/windows'}) and go back to the built-in scene.`, disabled: !entry.overrides, onclick: () => void revert() }, 'revert to built-in'),
      el('a', { className: 'btn', href: city, target: '_blank', title: 'Opens the city at night with the saved scene in every furnished room (a ground-floor room: every shop that can be a shady one is). The city reads the saved file; the edition\'s scenes need npm run dev:uncensored.' }, 'see it in the city'),
    ),
    el('div', { id: 'status' }),
    el('div', { id: 'errors' }),
  );

  // ---- the scene's own fields ----
  const cats = catsOf(s).map(String);
  const setCat = (c: string, on: boolean): void => {
    const next = [...CATS, ...SHOP_KINDS].filter((k) => (k === c ? on : cats.includes(k)));
    doc.cat = next.length === 1 ? next[0] : next;
  };
  side.append(
    el('h3', {}, 'Scene'),
    text('id', doc.id, (v) => (doc.id = v), !entry.isNew),
    text('label', String(doc.label ?? ''), (v) => (doc.label = v)),
    el('div', { className: 'cats', title: HELP.cat, 'data-field': 'cat' }, ...[...CATS, ...SHOP_KINDS].map((c) => el('label', {}, el('input', { type: 'checkbox', checked: cats.includes(c), onchange: (ev: Event) => {
      checkpoint();
      setCat(c, (ev.target as HTMLInputElement).checked);
      changed(true);
    } }), ` ${c}`))),
    el('div', { className: 'bar' },
      tick('adult', doc.adult === true, (v) => {
        if (v) doc.adult = true;
        else delete doc.adult;
        // (A new scene goes where its mark sends it; one that has a file stays in its folder.)
        if (entry?.isNew) place = v ? 'adult' : 'content';
      }),
      flag('low'),
      flag('near'),
      el('label', { title: HELP.weight }, 'weight ', el('input', { type: 'number', min: 1, max: 4, step: 1, value: typeof doc.weight === 'number' ? doc.weight : 1, 'data-field': 'weight', oninput: (ev: Event) => {
        const v = Number((ev.target as HTMLInputElement).value);
        checkpoint('weight');
        if (v > 1) doc.weight = v;
        else delete doc.weight;
        changed(false);
      } })),
      el('label', { title: HELP.setBack }, 'set back ', el('input', { type: 'number', min: 0, max: MAX_DEPTH, step: 0.05, value: typeof doc.setBack === 'number' ? doc.setBack : 0, 'data-field': 'setBack', oninput: (ev: Event) => {
        const v = cm(Number((ev.target as HTMLInputElement).value));
        checkpoint('setBack');
        if (v > 0) doc.setBack = v;
        else delete doc.setBack;
        changed(false);
      } })),
      el('label', { title: HELP.when }, 'when ', el('select', { 'data-field': 'when', onchange: (ev: Event) => {
        const v = (ev.target as HTMLSelectElement).value;
        checkpoint();
        if (v) doc.when = v;
        else delete doc.when;
        changed(false);
      } }, el('option', { value: '' }, '(default: late)'), ...WHEN.map((w) => el('option', { value: w, selected: doc.when === w }, w)))),
    ),
  );

  // ---- who and what is in it ----
  const choice = castChoices(doc as { adult?: unknown; cat?: unknown });
  const figLine = (f: Fig, i: number, deep: boolean): HTMLElement => {
    const on = inHand(deep, i);
    return el('div', { className: `line ${on ? 'sel' : ''}` }, el('span', { className: 'name', onclick: () => ((sel = { kind: 'fig', deep, i }), renderSide(), draw()) }, `${on ? '▸ ' : ''}${typeof f.who === 'string' ? f.who : `${f.who.body}/${f.who.outfit}`} @ ${f.x}`));
  };
  const newFig = (): Fig => ({ who: choice.cast.includes('man') ? 'man' : choice.cast[0], x: 0, pose: {} });
  side.append(
    el('h3', {}, `People · pose ${frame === 0 ? 'A' : frame === 1 ? 'B' : frame + 1}`),
    ...figs().map((f, i) => figLine(f, i, false)),
    el('div', { className: 'bar' },
      el('button', { title: 'Another figure, in every pose.', onclick: () => {
        checkpoint();
        const k = keys();
        for (const key of k) key.a.push(newFig());
        setSceneKeys(doc, k);
        sel = { kind: 'fig', deep: false, i: figs().length - 1 };
        changed(true);
      } }, '+ figure'),
      el('button', { title: 'Someone standing at the back of the room (only in a still scene).', disabled: !!doc.anim, onclick: () => {
        checkpoint();
        ((doc.deep ??= []) as Fig[]).push(newFig());
        sel = { kind: 'fig', deep: true, i: deepFigs().length - 1 };
        changed(true);
      } }, '+ at the back'),
    ),
    ...(deepFigs().length ? [el('div', { className: 'hint' }, 'at the back (deep):'), ...deepFigs().map((f, i) => figLine(f, i, true))] : []),
  );

  const f = selFig() as { -readonly [K in keyof Fig]: Fig[K] } | null;
  const here = figSel();
  if (f && here) {
    const named = typeof f.who === 'string';
    const who = named ? CAST[f.who as keyof typeof CAST] : (f.who as { body: string; outfit: string; hair: string });
    const pickOf = (list: readonly string[], value: string, set: (v: string) => void, field: string): HTMLElement =>
      el('select', { 'data-field': field, onchange: (ev: Event) => {
        checkpoint();
        set((ev.target as HTMLSelectElement).value);
        changed(true);
      } }, ...(list.includes(value) ? [] : [el('option', { value, selected: true }, `${value} (not allowed here)`)]), ...list.map((v) => el('option', { value: v, selected: v === value }, v)));
    const custom = (part: 'body' | 'outfit' | 'hair', v: string): void => {
      f.who = { ...(who as { body: never; outfit: never; hair: never }), [part]: v };
    };
    const sceneLike = doc as { adult?: unknown; cat?: unknown };
    side.append(
      el('h3', {}, 'The figure in hand'),
      el('div', { className: 'bar' },
        'who ', pickOf(['(custom)', ...choice.cast], named ? String(f.who) : '(custom)', (v) => (f.who = v === '(custom)' ? { ...(who as { body: never; outfit: never; hair: never }) } : (v as keyof typeof CAST)), `${here.deep ? 'deep' : frame === 0 ? 'a' : frame === 1 ? 'b' : 'frames'}`),
        ...(named
          ? [
              el('span', { className: 'hint' }, who ? `${who.body}, ${who.outfit}, ${who.hair}` : ''),
              el('button', { title: 'Choose the body, the clothes and the hair one by one (the same as picking (custom) in the list): a named figure is a fixed combination.', onclick: () => {
                checkpoint();
                f.who = { ...(who as { body: never; outfit: never; hair: never }) };
                changed(true);
              } }, 'change clothes…'),
            ]
          : [
              el('label', {}, 'body ', pickOf(choice.bodies, who.body, (v) => custom('body', v), 'who')),
              el('label', {}, 'outfit ', pickOf(outfitsFor(sceneLike, who.body as Body), who.outfit, (v) => custom('outfit', v), 'who')),
              el('label', {}, 'hair ', pickOf(choice.hair, who.hair, (v) => custom('hair', v), 'who')),
            ]),
      ),
    );
    // Undressing (only in a scene marked adult), and keeping a figure the same person in every pose.
    {
      const k = keys();
      const others = here.deep ? [] : k.filter((_, j) => j !== frame).map((key) => key.a[here.i]).filter((o): o is Fig => !!o);
      const bare = who ? undressed(sceneLike, f.who) : null;
      const bar = el('div', { className: 'bar' });
      if (doc.adult !== true) bar.append(el('span', { className: 'hint', title: 'A figure with nothing on (the body as a smooth mannequin) is allowed only in a scene marked adult, which is saved to adult/ and left out of the standard and demo editions.' }, 'undress: only in a scene marked adult (tick adult under Scene)'));
      else if (bare) {
        bar.append(el('button', { title: 'This figure with nothing on, in this pose: its own body and hair, the nude outfit.', onclick: () => {
          checkpoint();
          f.who = bare;
          changed(true);
        } }, 'undress'));
        if (others.length) bar.append(el('button', { title: 'This figure with nothing on in every pose (each pose keeps its own figure: they\'re matched by their order).', onclick: () => {
          checkpoint();
          const n = undress(doc, here.i);
          status(`undressed in ${n} pose${n === 1 ? '' : 's'}`);
          changed(true);
        } }, 'undress in every pose'));
      } else if (isBare(who?.outfit)) {
        // Nothing on: barefoot, or (a woman) in high heels.
        const heels = who?.outfit === 'nude_heels';
        const other = withHeels(sceneLike, f.who, !heels);
        bar.append(
          el('label', { title: 'Undressed is barefoot. High heels are a choice (a woman\'s): the foot on its heel, the ankle raised.' }, 'feet ', el('select', { 'data-field': 'who', disabled: !other, onchange: () => {
            if (!other) return;
            checkpoint();
            f.who = other;
            changed(true);
          } }, el('option', { selected: !heels }, 'barefoot'), el('option', { selected: heels }, 'high heels'))),
          ...(other && others.length ? [el('button', { title: 'The same feet for this figure in every pose.', onclick: () => {
            checkpoint();
            for (const key of keys()) {
              const g = key.a[here.i] as { who: Fig['who'] } | undefined;
              const same = g && withHeels(sceneLike, g.who, heels);
              if (g && same) g.who = same;
            }
            changed(true);
          } }, 'feet in every pose')] : []),
          el('span', { className: 'hint' }, named ? 'nothing on · to dress: change clothes…, then pick an outfit' : 'nothing on · to dress: pick an outfit above'),
        );
      }
      else bar.append(el('span', { className: 'hint' }, `no body without clothes for ${who?.body === 'child' ? 'a child' : 'an elder'}`));
      if (others.some((o) => JSON.stringify(o.who) !== JSON.stringify(f.who))) {
        bar.append(el('button', { title: 'In another pose this figure is dressed differently (or is someone else), so the move between those poses cuts instead of blending. Makes it who it is here in every pose.', onclick: () => {
          checkpoint();
          for (const key of keys()) if (key.a[here.i]) (key.a[here.i] as { who: Fig['who'] }).who = clone(f.who);
          status('the same figure in every pose');
          changed(true);
        } }, 'same in every pose'), el('span', { className: 'hint' }, 'differs between poses'));
      }
      side.append(bar);
    }
    side.append(
      el('div', { className: 'bar' },
        el('label', {}, 'x ', el('input', { type: 'number', min: -2, max: 2, step: 0.01, value: f.x, oninput: (ev: Event) => {
          checkpoint('x');
          f.x = cm(Number((ev.target as HTMLInputElement).value));
          changed(false);
        } })),
        el('label', { title: HELP.seat }, el('input', { type: 'checkbox', checked: f.seat !== undefined, onchange: (ev: Event) => {
          checkpoint();
          if ((ev.target as HTMLInputElement).checked) {
            f.seat = 0.45;
            delete f.floor;
          } else delete f.seat;
          changed(true);
        } }), ' seated'),
        el('label', { title: f.seat !== undefined ? HELP.seat : HELP.floor }, f.seat !== undefined ? 'seat ' : 'floor ', el('input', { type: 'number', min: 0, max: 1.5, step: 0.01, value: f.seat ?? f.floor ?? 0, oninput: (ev: Event) => {
          const v = cm(Number((ev.target as HTMLInputElement).value));
          checkpoint('height');
          if (f.seat !== undefined) f.seat = v;
          else if (v > 0) f.floor = v;
          else delete f.floor;
          changed(false);
        } })),
      ),
    );
    // How far back it stands.
    {
      const num = el('input', { type: 'number', min: 0, max: MAX_DEPTH, step: 0.05, value: f.depth ?? 0, 'data-field': 'depth' });
      const range = el('input', { type: 'range', min: 0, max: MAX_DEPTH, step: 0.05, value: f.depth ?? 0 });
      const apply = (from: HTMLInputElement, to: HTMLInputElement): void => {
        const v = Number(from.value);
        if (!Number.isFinite(v)) return;
        to.value = from.value;
        checkpoint('depth');
        setFigDepth(f, v);
        changed(false);
      };
      range.oninput = () => apply(range, num);
      num.oninput = () => apply(num, range);
      side.append(el('div', { className: 'row', title: HELP.depth }, 'distance', range, num));
    }

    // The part in hand, and its turns: one place for "this limb, three axes".
    const part = selPart();
    const partBar = el('div', { className: 'bar', style: 'margin-top:8px' });
    for (const name of PARTS) {
      partBar.append(el('button', { className: part === name ? 'on' : '', title: `Take the ${PART_LABEL[name]} in hand: its rings in the room, its turns below.`, onclick: () => {
        sel = { kind: 'fig', deep: here.deep, i: here.i, ...(part === name ? {} : { part: name }) };
        axis = 0;
        renderSide();
        draw();
      } }, PART_LABEL[name]));
    }
    side.append(el('div', { className: 'hint', style: 'margin-top:6px' }, 'a part to turn (or click a limb in the room):'), partBar);
    if (part) {
      const steps = PART_STEPS[part].filter((st) => st.fixed === undefined);
      const row = el('div', { className: 'bar' }, el('span', { style: 'color:#f3d9a0' }, `${PART_LABEL[part]} `));
      steps.forEach((st, k) => {
        row.append(el('label', { style: `color:rgb(${AXIS_RGB[st.axis]})${k === Math.min(axis, steps.length - 1) ? ';font-weight:bold' : ''}`, title: `${st.name}: ${st.range[0]} to ${st.range[1]} degrees (at rest ${st.def}). About the part's ${st.axis} as it lies after the turns before it. Double-click: back to rest.` }, `${st.axis.toUpperCase()} ${st.name} `, el('input', {
          type: 'number', min: st.range[0], max: st.range[1], step: 1, value: deg(poseValue(f.pose, st)), style: 'width:54px', 'data-bind': st.at === undefined ? String(st.key) : `${String(st.key)}.${st.at}`,
          onfocus: () => {
            if (axis !== k) {
              axis = k;
              draw();
            }
          },
          oninput: (ev: Event) => {
            const v = Number((ev.target as HTMLInputElement).value);
            if (!Number.isFinite(v)) return;
            checkpoint(`turn ${part} ${k}`);
            f.pose = turned(f.pose, st, v);
            changed(false);
            syncFields();
          },
          ondblclick: () => {
            checkpoint();
            f.pose = poseWith(f.pose, st, st.def);
            changed(true);
          },
        })));
      });
      side.append(row, el('div', { className: 'hint' }, steps.length < 3 ? 'a knee doesn\'t bend sideways: the shin has two turns' : part.startsWith('fore') ? 'the forearm\'s turn turns the hand with it; the hand\'s own joint is the wrist (hand L, hand R)' : part.startsWith('hand') ? 'the wrist: what the hand holds goes with it; the fingers don\'t move' : part.startsWith('foot') ? 'the ankle: pitch points the toes (+) or pulls them up, turn swings them out, roll tips the sole' : 'the rings in the room are these, each where its axis is now'));
    }

    const stepFor = (key: string, at?: number): PartStep | undefined => PARTS.flatMap((n) => PART_STEPS[n]).find((st) => st.key === key && st.at === at);
    for (const k of ['yaw', 'pitch', 'roll', 'lean', 'bend', 'twist', 'nod', 'tilt', 'turn'] as const) {
      const st = stepFor(k)!;
      side.append(slider(k, HELP[k], poseValue(f.pose, st), k === 'yaw' || k === 'pitch' || k === 'roll' ? -180 : -90, k === 'yaw' || k === 'pitch' || k === 'roll' ? 180 : 90, (v) => (f.pose = poseWith(f.pose, st, v))));
    }
    side.append(el('div', { className: 'hint' }, 'the head in silhouette: tilt reads when the figure faces you (or away), nod in profile; turn only moves the nose and the hair'));
    const limb = (key: 'aL' | 'aR' | 'lL' | 'lR' | 'fL' | 'fR', names: readonly string[], lo: number, hi: number): HTMLElement => {
      const row = el('div', { className: 'limb', title: key[0] === 'a' ? HELP.arm : key[0] === 'l' ? HELP.leg : 'pitch: toes pointed down (+) or pulled up; turn: toes outward; roll: tipped, its outer edge lifted.' }, key === 'aL' ? 'arm L' : key === 'aR' ? 'arm R' : key === 'lL' ? 'leg L' : key === 'lR' ? 'leg R' : key === 'fL' ? 'foot L' : 'foot R');
      names.forEach((n, i) => {
        const st = stepFor(key, i)!;
        row.append(el('input', { type: 'number', min: lo, max: hi, step: 1, value: deg(poseValue(f.pose, st)), title: n, 'data-bind': `${key}.${i}`, oninput: (ev: Event) => {
          const v = Number((ev.target as HTMLInputElement).value);
          if (!Number.isFinite(v)) return;
          checkpoint(key + n);
          f.pose = poseWith(f.pose, st, deg(v));
          changed(false);
        } }));
      });
      for (let i = names.length; i < 4; i++) row.append(el('span'));
      return row;
    };
    side.append(
      el('div', { className: 'limb' }, el('span'), ...['raise', 'swing', 'elbow / knee', 'twist'].map((t) => el('span', { className: 'head' }, t))),
      limb('aL', ['raise', 'swing', 'elbow', 'twist'], -180, 220),
      limb('aR', ['raise', 'swing', 'elbow', 'twist'], -180, 220),
      limb('lL', ['raise', 'swing', 'knee', 'twist'], -120, 160),
      limb('lR', ['raise', 'swing', 'knee', 'twist'], -120, 160),
      el('div', { className: 'hint' }, 'a forearm\'s side bend and turn, the wrists, a shin\'s turn and the ankles: take the part in hand above'),
    );
    // What the hands hold.
    const holds = [...(f.hold ?? [])] as Hold[];
    const setHolds = (h: Hold[]): void => {
      if (h.length) f.hold = h;
      else delete f.hold;
    };
    side.append(el('div', { className: 'hint', style: 'margin-top:6px' }, 'in the hands · click one in the room (or its ▹) to take hold of it'));
    holds.forEach((h, i) => {
      const a = holdAt(h);
      const on = sel?.kind === 'hold' && sel.h === i;
      const field = (name: string, title: string, value: number | '', min: number, max: number, step: number, set: (v: number | undefined) => Partial<HoldAt>): HTMLElement =>
        el('label', { title }, `${name} `, el('input', { type: 'number', min, max, step, value, style: 'width:58px', 'data-field': 'hold', oninput: (ev: Event) => {
          const raw = (ev.target as HTMLInputElement).value;
          if (raw !== '' && !Number.isFinite(Number(raw))) return;
          checkpoint(`hold ${name}`);
          holds[i] = adjustHold(holds[i], set(raw === '' ? undefined : Number(raw)));
          setHolds(holds);
          changed(false);
        } }));
      side.append(
        el('div', { className: `line ${on ? 'sel' : ''}` },
          el('span', { className: 'name', style: 'min-width:14px', title: 'Take hold of it in the room: drag moves it, Shift-drag or its round handle turns it, the wheel sizes it, arrows nudge it, Del removes it.', onclick: () => ((sel = on ? { kind: 'fig', deep: here.deep, i: here.i } : { kind: 'hold', deep: here.deep, i: here.i, h: i }), renderSide(), draw()) }, on ? '▸' : '▹'),
          pickOf(['L', 'R'], h[0], (v) => ((holds[i] = adjustHold(holds[i], { hand: v as 'L' | 'R' })), setHolds(holds)), 'hold'),
          pickOf(choice.props, h[1], (v) => ((holds[i] = adjustHold(holds[i], { prop: v as PropName })), setHolds(holds)), 'hold'),
          el('button', { title: 'Out of this pose.', onclick: () => (checkpoint(), holds.splice(i, 1), setHolds(holds), changed(true)) }, '×'),
        ),
        el('div', { className: 'line', style: 'margin-left:18px;flex-wrap:wrap' },
          field('angle', 'Degrees from level (90 upright). Blank: by itself (along the forearm).', a.rot ?? '', -360, 360, 5, (v) => ({ rot: v })),
          field('dx', 'Metres across the picture from where it goes by itself (the hand).', a.dx, -HOLD_REACH, HOLD_REACH, 0.01, (v) => ({ dx: v ?? 0 })),
          field('dy', 'Metres up the picture from where it goes by itself.', a.dy, -HOLD_REACH, HOLD_REACH, 0.01, (v) => ({ dy: v ?? 0 })),
          field('size', 'How many times its own size it is drawn.', a.scale, HOLD_SCALE[0], HOLD_SCALE[1], 0.05, (v) => ({ scale: v ?? 1 })),
        ),
        el('div', { className: 'line', style: 'margin-left:18px' },
          el('button', { title: 'Back where it goes by itself: at the hand, along the forearm, its own size.', disabled: h.length <= 2, onclick: () => (checkpoint(), (holds[i] = resetHold(h)), setHolds(holds), changed(true)) }, 'reset'),
          ...(!here.deep && keys().length > 1
            ? [
                el('button', { title: 'This thing as it is here, in this hand in every pose (what a pose already has of it is replaced).', onclick: () => {
                  checkpoint();
                  const n = copyHoldEverywhere(doc, here.i, holds[i]);
                  status(n ? `copied to ${n} other pose${n === 1 ? '' : 's'}` : 'every pose has it as it is here');
                  changed(true);
                } }, 'copy to every pose'),
                el('button', { title: 'Out of this hand in every pose.', onclick: () => {
                  checkpoint();
                  const n = removeHoldEverywhere(doc, here.i, h);
                  status(`removed from ${n} pose${n === 1 ? '' : 's'}`);
                  changed(true);
                } }, 'remove from every pose'),
              ]
            : []),
        ),
      );
    });
    const acts: [string, string, () => void][] = [
      ['+ hold', 'Something in a hand.', () => setHolds([...holds, ['R', choice.props.includes('glass' as PropName) ? 'glass' : choice.props[0]]])],
      ['mirror', 'Faces the other way across the room: its place, its facing, its sides.', () => Object.assign(f, mirrorFig(f))],
      ['swap L/R', 'Its left and right limbs\' poses swapped.', () => Object.assign(f, swapSides(f))],
      ['duplicate', 'A copy beside it (in every pose).', () => {
        if (here.deep) deepFigs().push({ ...clone(f), x: cm(Math.min(2, f.x + 0.4)) });
        else {
          const k = keys();
          for (const key of k) key.a.push({ ...clone(key.a[here.i] ?? f), x: cm(Math.min(2, (key.a[here.i] ?? f).x + 0.4)) });
          setSceneKeys(doc, k);
        }
      }],
      ['delete', 'Del', () => undefined],
    ];
    const bar = el('div', { className: 'bar' });
    for (const [name, help, fn] of acts) bar.append(el('button', { title: help, onclick: name === 'delete' ? removeSelected : () => (checkpoint(), fn(), changed(true)) }, name));
    side.append(bar);
    if (!here.deep && keys().length > 1) {
      const n = keys().length;
      const others = keys().map((_, j) => j).filter((j) => j !== frame);
      const row = (label: string, what: { fig: number; part?: PartName }, thing: string): HTMLElement =>
        el('div', { className: 'bar' }, label,
          el('button', { disabled: frame === 0, title: `Replaces ${thing} in pose ${frame > 0 ? poseName(frame - 1) : '-'} with how it is here.`, onclick: () => copyOver(frame, [frame - 1], what) }, '◂ previous'),
          el('button', { disabled: frame >= n - 1, title: `Replaces ${thing} in pose ${frame < n - 1 ? poseName(frame + 1) : '-'} with how it is here.`, onclick: () => copyOver(frame, [frame + 1], what) }, 'next ▸'),
          el('button', { disabled: frame === 0, title: `Replaces ${thing} HERE with how it is in pose ${frame > 0 ? poseName(frame - 1) : '-'}.`, onclick: () => copyOver(frame - 1, [frame], what) }, 'from previous'),
          el('button', { title: `Replaces ${thing} in every other pose with how it is here.`, onclick: () => copyOver(frame, others, what) }, 'all'),
        );
      side.append(row('copy this figure to ', { fig: here.i }, 'this figure (who, where, how far back, every angle, what it holds)'));
      const part = selPart();
      if (part) side.append(row(`copy its ${PART_LABEL[part]} to `, { fig: here.i, part }, `this figure's ${PART_LABEL[part]} (its turns only: the rest of the figure stays)`));
    }
  }

  // ---- furniture ----
  const LISTS = [['back', 'against the back wall (or close behind, with near)'], ['front', 'what the people are at, in front of them'], ['aItems', 'with the people (this pose)']] as const;
  side.append(el('h3', {}, 'Furniture and things'));
  for (const [list, what] of LISTS) {
    side.append(el('div', { className: 'hint' }, `${list}: ${what}`));
    itemList(list).forEach((it, i) => {
      const on = sel?.kind === 'item' && sel.list === list && sel.i === i;
      const line = el('div', { className: `line ${on ? 'sel' : ''}` }, el('span', { className: 'name', onclick: () => ((sel = { kind: 'item', list, i }), renderSide(), draw()) }, `${on ? '▸ ' : ''}${it[0]}`));
      const params = [{ name: 'x', def: 0 as number | undefined }, ...(it[0] in ITEMS ? itemParams(it[0]) : [])];
      const parts = itemParts(it);
      params.forEach((p, k) => line.append(el('input', { type: 'number', step: 0.01, value: (k === 0 ? parts.x : parts.args[k - 1]) ?? '', placeholder: p.def === undefined ? p.name : String(p.def), title: p.name, oninput: (ev: Event) => {
        const raw = (ev.target as HTMLInputElement).value;
        checkpoint(`${list}${i}${k}`);
        itemList(list)[i] = itemWith(itemList(list)[i], k, raw === '' ? undefined : Number(raw));
        changed(false);
      } })));
      line.append(el('input', { type: 'number', min: 0, max: MAX_DEPTH, step: 0.05, value: parts.depth || '', placeholder: 'dist', title: HELP.depth, style: 'width:46px', oninput: (ev: Event) => {
        checkpoint(`${list}${i}depth`);
        itemList(list)[i] = itemAtDepth(itemList(list)[i], Number((ev.target as HTMLInputElement).value) || 0);
        changed(false);
      } }));
      line.append(
        el('select', { title: 'Move it to another layer.', onchange: (ev: Event) => {
          const to = (ev.target as HTMLSelectElement).value as typeof list;
          checkpoint();
          const [moving] = itemList(list).splice(i, 1);
          itemsFor(to).push(moving);
          sel = { kind: 'item', list: to, i: itemList(to).length - 1 };
          changed(true);
        } }, ...LISTS.map(([l]) => el('option', { value: l, selected: l === list }, l))),
        el('button', { onclick: () => (checkpoint(), itemList(list).splice(i, 1), (sel = null), changed(true)) }, '×'),
      );
      side.append(line);
    });
    side.append(el('div', { className: 'line' }, el('select', { onchange: (ev: Event) => {
      const kind = (ev.target as HTMLSelectElement).value as ItemName;
      if (!kind) return;
      checkpoint();
      itemsFor(list).push([kind, 0] as unknown as Item);
      sel = { kind: 'item', list, i: itemList(list).length - 1 };
      changed(true);
    } }, el('option', { value: '' }, `+ add to ${list}…`), ...Object.keys(ITEMS).sort().map((k) => el('option', { value: k }, k)))));
  }
  side.append(el('details', {}, el('summary', {}, 'the JSON'), el('pre', { style: 'white-space:pre-wrap;color:#9aa0b0' }, sceneText(doc))));
  side.scrollTop = keep;
  renderStatus();
}

// ---- saving ----

async function save(): Promise<void> {
  validate();
  if (problems.length || !entry) {
    status('not saved: fix the errors first');
    return;
  }
  const text = sceneText(doc);
  let wrote = '';
  if (server) {
    try {
      const r = await fetch('/__scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'save', place, scene: doc }) });
      const body = (await r.json()) as { file?: string; error?: string };
      if (!r.ok || !body.file) {
        status(`not saved: ${body.error ?? r.status}`);
        return;
      }
      wrote = body.file;
    } catch (err) {
      status(`not saved: ${String(err)}`);
      return;
    }
  } else {
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: `${doc.id}.json` });
    a.click();
    wrote = `${doc.id}.json (downloaded: put it in ${place === 'adult' ? 'adult/content/windows' : 'content/world3d/windows'}/)`;
  }
  savedText = text;
  entry.scene = clone(doc);
  entry.errors = [];
  if (isBuiltIn(entry.id)) {
    entry.place = place;
    entry.overrides = true;
  }
  entry.isNew = false;
  try {
    localStorage.removeItem(DRAFT);
  } catch {
    // (Nothing kept.)
  }
  status(`saved ${wrote}`);
  renderList();
  renderSide();
}

async function revert(): Promise<void> {
  if (!entry?.overrides || entry.place === 'builtin') return;
  const from = entry.place;
  if (!confirm(`Delete ${from === 'adult' ? 'adult/content/windows' : 'content/world3d/windows'}/${entry.id}.json and go back to the built-in '${entry.id}'?`)) return;
  if (server) {
    const r = await fetch('/__scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'revert', id: entry.id, place: from }) });
    if (!r.ok) {
      status(`not reverted: ${((await r.json()) as { error?: string }).error ?? r.status}`);
      return;
    }
    // (There may be an edited copy in the other folder under it: read the folders again.)
    const id = entry.id;
    try {
      localStorage.removeItem(DRAFT);
    } catch {
      // (Nothing kept.)
    }
    await loadEntries();
    const back = entries.find((e) => e.id === id && e.scene);
    if (back) open(back);
    status(back?.overrides ? `the edited copy in ${from}/ is deleted: the one in ${back.place}/ is back` : 'the edited copy is deleted: the built-in scene is back');
    return;
  }
  const built = SCENES.find((b) => b.id === entry!.id);
  if (!built) return;
  entry.place = 'builtin';
  entry.overrides = false;
  entry.scene = clone(built) as unknown as SceneDoc;
  try {
    localStorage.removeItem(DRAFT);
  } catch {
    // (Nothing kept.)
  }
  open(entry);
  status(server ? 'the override is deleted: the built-in scene is back' : 'no dev server: delete the override file by hand');
}

// ---- start ----

async function start(): Promise<void> {
  painter = scenePainter(RP);
  cellPainter = scenePainter(WINDOW_ATLAS.ppm);
  raster = el('canvas', { width: painter.w, height: painter.h });
  rasterImg = raster.getContext('2d')!.createImageData(painter.w, painter.h);
  cell = el('canvas', { width: WINDOW_ATLAS.cellW, height: WINDOW_ATLAS.cellH });
  cellImg = cell.getContext('2d')!.createImageData(WINDOW_ATLAS.cellW, WINDOW_ATLAS.cellH);
  await loadEntries();
  renderMid();
  // Unsaved work from before a refresh comes back; else the scene the address names; else the first.
  let draft: Draft | null = null;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT) ?? 'null') as Draft | null;
  } catch {
    draft = null;
  }
  const wanted = decodeURIComponent(location.hash.slice(1));
  let e = entries.find((x) => x.id === wanted && x.scene) ?? null;
  if (draft && (!wanted || wanted === draft.id)) {
    e = entries.find((x) => x.id === draft!.id && x.scene) ?? null;
    if (!e && draft.isNew) {
      e = { id: draft.id, place: draft.place, scene: JSON.parse(draft.text) as SceneDoc, errors: [], isNew: true };
      entries.push(e);
    }
    if (e) {
      open(e, { text: draft.text, saved: e.isNew ? '' : sceneText(e.scene) });
      status('unsaved work from before the page was reloaded is back');
    }
  }
  if (!entry) open(e ?? entries.find((x) => x.scene)!);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('beforeunload', (ev) => {
    if (dirty()) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });
  requestAnimationFrame(tick);
  // For scripts (debug-shots/sceneeditor.mjs).
  (window as unknown as { __scenes: unknown }).__scenes = {
    entries,
    open: (id: string): boolean => {
      const x = entries.find((n) => n.id === id && n.scene);
      if (x) open(x);
      return !!x;
    },
    doc: () => doc,
    problems: () => problems,
    dirty,
    save,
    select: (i: number, deep = false): void => ((sel = { kind: 'fig', deep, i }), renderSide(), draw()),
    /** Takes hold of what figure `i` holds (entry `h` of its hold list). */
    selectHold: (i: number, h: number, deep = false): void => ((sel = { kind: 'hold', deep, i, h }), renderSide(), draw()),
    selected: () => sel,
    /** Takes a part of the figure in hand in hand. */
    selectPart: (part: PartName): void => {
      const fs = figSel();
      if (!fs) return;
      sel = { kind: 'fig', deep: fs.deep, i: fs.i, part };
      axis = 0;
      renderSide();
      draw();
    },
    /** A point on ring k of the part in hand, toward the street, and another a sixth of the way round it (client pixels). */
    ringOn: (k: number): { at: [number, number]; on: [number, number]; value: number } | null => {
      if (!placedPart?.axes[k]) return null;
      const pts = ringsOf(placedPart)[k];
      const i = Math.max(0, pts.findIndex((q) => q.front));
      const r = view.getBoundingClientRect();
      const on = (q: RingPoint): [number, number] => [r.left + (sx(q.x) * r.width) / VW, r.top + (sy(q.y) * r.height) / VH];
      return { at: on(pts[i]), on: on(pts[(i + 8) % pts.length]), value: placedPart.axes[k].value };
    },
    /** How far back the figure or the piece in hand stands. */
    depth: (d: number): void => (checkpoint(), setDepth(d), changed(true)),
    /** Where the held thing in hand, and its round handle, are on the page (client pixels). */
    holdOn: (): { at: [number, number]; turn: [number, number] } | null => {
      const h = selHold();
      const at = sel?.kind === 'hold' ? (sel.deep ? placedDeep : placedFigs)[sel.i]?.holds[sel.h] : null;
      if (!h || !at) return null;
      const r = view.getBoundingClientRect();
      const on = (p: readonly [number, number]): [number, number] => [r.left + (sx(p[0]) * r.width) / VW, r.top + (sy(p[1]) * r.height) / VH];
      return { at: on(at.at), turn: on(holdTurnAt(h[1], at)) };
    },
    frame: (i: number): void => ((frame = Math.min(i, keys().length - 1)), changed(true)),
    /** Where a joint of the figure in hand is on the page (client pixels), for a script to drag it. */
    jointAt: (j: JointName): [number, number] | null => {
      const fs = figSel();
      const p = fs ? (fs.deep ? placedDeep : placedFigs)[fs.i] : null;
      if (!p) return null;
      const r = view.getBoundingClientRect();
      return [r.left + (sx(p.joints[j][0]) * r.width) / VW, r.top + (sy(p.joints[j][1]) * r.height) / VH];
    },
    pointAt: (x: number, y: number): [number, number] => {
      const r = view.getBoundingClientRect();
      return [r.left + (sx(x) * r.width) / VW, r.top + (sy(y) * r.height) / VH];
    },
    working: (on: boolean): void => ((working = on), renderMid(), draw()),
    play: togglePlay,
  };
}

void start();
