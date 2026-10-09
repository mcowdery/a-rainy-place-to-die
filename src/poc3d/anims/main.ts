import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { animLibrary, type AnimInfo } from '../models/characterAnims';
import { Character, CHARACTERS, registerCharacters, setCharacterEnvironment } from '../models/characters';
import type { FirstPersonRig } from '../models/firstPerson';
import { CANDIDATES, HOP, VERDICT_LABELS, type Candidate, type NowState, type Part, type Review, type Verdict } from './candidates';

/**
 * The animation review page (anims.html): one of the cast on a studio floor, playing a clip from the animation
 * library (models/characterAnims.ts) fitted to their own skeleton, for judging the clips and the fit before any is
 * used in the city. Dev only: it isn't one of the builds' pages.
 *
 * `?char=<name>` (salaryman), `?clip=<name>` (Idle_Loop), `?speed=0.5`, `?hands=open`, `?extra=<a .glb's path>` (a take
 * that isn't in the library, e.g. /debug-shots/mocap/wave.glb from scripts/mocap/video_to_clip.py: its clips join the list), `?figure=<a .glb's path>` (a figure
 * that isn't one of the cast, e.g. a generated one from scripts/blender/rig_figure.py: shown as the character `figure`). Left-drag orbits, right-drag pans, the wheel
 * zooms; Space pauses, H leaves the hands open, `,` and `.` step a frame, `[` and `]` the clip before and after. The camera keeps with the
 * figure when a clip carries them off (the `_RM` clips do, and snap back when they repeat).
 *
 * **For the city** (the panel's first list; `?review=<id>`, or `?review=1` for the first one not yet judged): the
 * clips proposed for the city (candidates.ts), each a run of clips played in order on Mack, beside his own rig doing
 * what the city has him do there today where it would take something's place ("now", on the left), with a card
 * saying what it's for and what stands against it, and the verdict's buttons (1, 2, 3; N and P the next candidate and
 * the one before; Esc leaves). A verdict and its note are kept in scripts/anims/verdicts.json through the dev
 * server's /__anims (scripts/devEndpoints.mjs), so they outlast the page and the port it was opened on.
 */

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const query = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // (PCFSoftShadowMap is removed in three: it swaps this in at the first render, recompiling every shadowed shader)
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2c31);
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(2.2, 1.5, 4.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
// For scripted screenshots: __view(x, y, z, tx, ty, tz) puts the camera at (x, y, z) looking at (tx, ty, tz).
(window as unknown as { __view: (...v: number[]) => void }).__view = (x, y, z, tx, ty, tz) => {
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  controls.update();
};

scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x3a3630, 1.1));
const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
key.position.set(3, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 30 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x55585f, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
// A metre grid, so sliding feet and a clip's travel can be seen against something.
const grid = new THREE.GridHelper(60, 60, 0x8a8f9c, 0x3f424a);
grid.position.y = 0.002;
scene.add(floor, grid);

const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
setCharacterEnvironment(env);

let character: Character | null = null;
let action: THREE.AnimationAction | null = null;
let clips: readonly AnimInfo[] = [];
// A figure under trial that isn't one of the cast (a generated one given the cast's skeleton by
// scripts/blender/rig_figure.py): `?figure=<its .glb's path>` shows it, as the character `figure`.
const figureFile = query.get('figure');
if (figureFile) registerCharacters({ figure: figureFile });
let charName = query.get('char') ?? (figureFile ? 'figure' : CHARACTERS.includes('salaryman') ? 'salaryman' : CHARACTERS[0]);
let clipName: string | null = query.get('clip') ?? 'Idle_Loop';
let speed = Number(query.get('speed') ?? 1);
let paused = false;
// The hands as the clip has them, or left loosely open (the library's walks and its idle close them into fists).
let openHands = query.get('hands') === 'open';
let pelvis: THREE.Object3D | null = null;
const at = new THREE.Vector3();
const was = new THREE.Vector3();

// Reviewing a candidate for the city: which, the part of its run that's playing, how long it has played and how
// long it's to play.
let cand: Candidate | null = null;
let part = 0;
let partT = 0;
let partLen = 0;
let switching = false;
/** The jump both figures are carried by during a part that's in the air: height (m) and rise (m/s). */
const hop = { y: 0, v: 0 };
/** The rig's own jump beside a clip that leaves the ground by itself (`Part.nowHop`), and whether this part's is made. */
const rigHop = { y: 0, v: 0 };
let hopped = false;
/** Where a clip that travels has carried the figure so far in this run (the next clip starts from there). */
const carry = new THREE.Vector3();
/** Mack's rig as the city has it, standing beside the figure: what he does today. Loaded when first wanted. */
let rig: FirstPersonRig | null = null;
let rigAsked = false;
/** The shot or the reload a part asks of the rig has been made. */
let acted = false;
const NOW_X = -1.5;
const eyes = new THREE.PerspectiveCamera();
const props = new THREE.Group();
scene.add(props);
let centre = 0;
let reviews: Record<string, Review> = {};
let saveError = '';
/** For scripted shots: the page's own clock stopped, time moved on by `__anims.tick`. */
let manual = false;

const nowOf = (c: Candidate, p: Part): NowState | null => (c.now || c.parts.some((q) => q.now) ? { ...c.now, ...p.now } : null);
/** How long a part plays for (s). */
function lengthOf(p: Part): number {
  if (p.lift) return (2 * HOP.v) / HOP.g;
  const info = clips.find((c) => c.name === p.clip);
  return p.seconds ?? (info ? (info.loop ? info.seconds * 2 : info.seconds - (p.from ?? 0)) : 1);
}

/** Looks from where it did, at a new middle (the two figures', or the one's). */
function recentre(x: number): void {
  camera.position.x += x - centre;
  controls.target.x += x - centre;
  centre = x;
}

/** Out of the review: one figure, one clip, as the page was. */
function leave(): void {
  if (!cand) return;
  cand = null;
  hop.y = hop.v = 0;
  carry.set(0, 0, 0);
  character?.root.position.set(0, 0, 0);
  props.clear();
  if (rig) rig.object.visible = false;
  recentre(0);
  buildCard();
}

async function load(name: string): Promise<void> {
  if (character && character.name === name) return;
  const next = await Character.load(name);
  if (character) scene.remove(character.root);
  character = next;
  scene.add(character.root);
  pelvis = character.root.getObjectByName('pelvis') ?? null;
  action = null;
  charName = name;
}

/** The next part of the candidate's run (or its first again), from where the last one left the figure. */
async function startPart(i: number, fade = 0.15): Promise<void> {
  const c = cand;
  if (!c || !character) return;
  switching = true;
  const p = c.parts[i];
  const before = action;
  // A clip that travelled leaves him where it took him: the next one has its root back at the start, so the
  // figure itself is moved by the difference (and a run that starts again starts where it began).
  const root = pelvis?.parent ?? null;
  const travelled = !!before && /_RM$/.test(before.getClip().name) && i > 0;
  const from = travelled && root ? root.getWorldPosition(new THREE.Vector3()) : null;
  const a = await character.play(p.clip, from || i === 0 ? 0 : fade, p.openHands ?? false);
  if (cand !== c) {
    switching = false;
    return;
  }
  part = i;
  partT = 0;
  partLen = lengthOf(p);
  action = a;
  clipName = p.clip;
  acted = false;
  hopped = false;
  if (i === 0) carry.set(0, 0, 0);
  if (a) {
    if (a === before) a.reset().play();
    a.setLoop(/_Loop$/.test(p.clip) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.timeScale = speed;
    a.paused = paused;
    if (p.from) a.time = p.from;
  }
  if (from && root) {
    character.root.position.copy(carry);
    character.update(0);
    character.root.updateMatrixWorld(true);
    carry.add(from.sub(root.getWorldPosition(new THREE.Vector3())));
  }
  if (p.lift) {
    hop.y = 1e-4;
    hop.v = HOP.v;
  }
  switching = false;
}

/** Shows a candidate: its run of clips on `name` (Mack, coming into the review), and what he does today beside it. */
async function review(id: string, name = cand ? charName : CHARACTERS.includes('mack') ? 'mack' : charName): Promise<void> {
  const c = CANDIDATES.find((x) => x.id === id);
  if (!c) return;
  await load(name);
  cand = c;
  saveError = '';
  hop.y = hop.v = 0;
  props.clear();
  for (const p of c.props ?? []) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(...p.size), new THREE.MeshStandardMaterial({ color: 0x6d727c, roughness: 0.9 }));
    box.position.set(...p.at);
    box.castShadow = box.receiveShadow = true;
    props.add(box);
  }
  const beside = nowOf(c, c.parts[0]) !== null;
  recentre(beside ? NOW_X / 2 : 0);
  if (beside && !rigAsked) {
    rigAsked = true;
    void import('../models/firstPerson').then(async ({ FirstPersonRig }) => {
      const r = await FirstPersonRig.load('mack', env);
      r.setHeadless(false);
      r.armed = false;
      r.object.visible = false;
      scene.add(r.object);
      rig = r;
    });
  }
  await startPart(0, 0);
  buildPanel();
  buildCard();
}

/** Keeps a verdict (null takes it back) or a note for a candidate: here, and in the file through the dev server. */
async function judge(id: string, change: { verdict?: Verdict | null; note?: string }): Promise<void> {
  const old = reviews[id] ?? { verdict: null, note: '', at: '' };
  const next: Review = { verdict: change.verdict === undefined ? old.verdict : change.verdict, note: change.note ?? old.note, at: new Date().toISOString().slice(0, 10) };
  reviews = { ...reviews, [id]: next };
  buildPanel();
  buildCard();
  try {
    const res = await fetch('/__anims', { method: 'POST', body: JSON.stringify({ id, verdict: next.verdict, note: next.note }) });
    saveError = res.ok ? '' : `not saved: ${await res.text()}`;
  } catch (err) {
    saveError = `not saved: ${String(err)}`;
  }
  if (saveError) buildCard();
}

/** The candidate after this one in the list (or before it), round and round. */
function step(by: number): void {
  const i = cand ? CANDIDATES.indexOf(cand) : by > 0 ? -1 : 0;
  void review(CANDIDATES[(i + by + CANDIDATES.length) % CANDIDATES.length].id);
}

const MARKS: Record<Verdict, string> = { use: 'yes', keep: 'keep his', no: 'no', later: 'later' };

/** The card for the candidate on show: what it's for, what's there today, what stands against it, the verdict. */
function buildCard(): void {
  const card = $('card');
  card.replaceChildren();
  card.hidden = !cand;
  if (!cand) return;
  const c = cand;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const i = CANDIDATES.indexOf(c);
  card.appendChild(el('small', `${i + 1} of ${CANDIDATES.length}  ·  ${c.kind === 'replace' ? 'would replace what he does now' : 'new'}`));
  card.appendChild(el('h2', c.title));
  card.appendChild(el('code', [...new Set(c.parts.map((p) => p.clip))].join('  →  ')));
  for (const [label, text] of [['For', c.use], ['Today', c.today], ['Against', c.notes], ["Claude's view", c.advice]] as const) {
    const p = el('p');
    p.append(el('b', `${label}: `), text);
    card.appendChild(p);
  }
  const mine = reviews[c.id];
  const row = el('div', '', 'row');
  Object.entries(VERDICT_LABELS[c.kind]).forEach(([v, label], n) => {
    const b = el('button', `${n + 1}  ${label}`, mine?.verdict === v ? 'on' : '');
    b.onclick = () => void judge(c.id, { verdict: mine?.verdict === v ? null : (v as Verdict) });
    row.appendChild(b);
  });
  card.appendChild(row);
  const note = el('input');
  note.placeholder = 'A note for whoever does the work (Enter saves)';
  note.value = mine?.note ?? '';
  note.onchange = () => void judge(c.id, { note: note.value.trim() });
  card.appendChild(note);
  if (saveError) card.appendChild(el('p', saveError, 'error'));
}

async function show(name: string, clip: string | null): Promise<void> {
  leave();
  await load(name);
  if (!character) return;
  clipName = clip;
  action = await character.play(clip, 0, openHands);
  if (action) {
    // Every clip repeats here, a loop or not.
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.timeScale = speed;
    action.paused = paused;
  }
  buildPanel();
}

/** Puts the clip at `t` seconds and holds it there (for stepping, and for scripted shots). */
function seek(t: number): void {
  if (!action || !character) return;
  paused = true;
  action.paused = true;
  action.time = Math.max(0, Math.min(action.getClip().duration, t));
  character.update(0);
  buildPanel();
}

async function setHands(open: boolean): Promise<void> {
  // (A candidate's parts say how their own hands are.)
  if (cand) return;
  openHands = open;
  const t = action?.time ?? 0;
  await show(charName, clipName);
  if (action) action.time = t;
}

function button(label: string, on: boolean, click: () => void, note = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (note) {
    const s = document.createElement('small');
    s.textContent = note;
    b.appendChild(s);
  }
  if (on) b.className = 'on';
  b.onclick = click;
  return b;
}

function buildPanel(): void {
  const panel = $('panel');
  const scroll = panel.scrollTop;
  panel.replaceChildren();
  const head = (text: string): void => {
    const h = document.createElement('h3');
    h.textContent = text;
    panel.appendChild(h);
  };
  head('Who');
  for (const n of CHARACTERS) panel.appendChild(button(n, n === charName, () => void (cand ? review(cand.id, n) : show(n, clipName))));
  if (!cand) {
    head('Hands (H)');
    panel.appendChild(button(openHands ? 'left open' : 'as the clip has them', openHands, () => void setHands(!openHands)));
  }
  head('Speed');
  const row = document.createElement('div');
  row.className = 'row';
  for (const s of [0.1, 0.25, 0.5, 1]) {
    row.appendChild(
      button(`${s}×`, s === speed, () => {
        speed = s;
        if (action) action.timeScale = s;
        buildPanel();
      }),
    );
  }
  panel.appendChild(row);
  panel.appendChild(
    button(paused ? 'Paused (Space)' : 'Pause (Space)', paused, () => {
      paused = !paused;
      if (action) action.paused = paused;
      buildPanel();
    }),
  );
  // The clips proposed for the city, to judge one by one: first what would replace something of his, then what's new.
  const judged = CANDIDATES.filter((c) => reviews[c.id]?.verdict).length;
  head(`For the city: ${judged} of ${CANDIDATES.length} judged (N / P)`);
  for (const kind of ['replace', 'add'] as const) {
    const h = document.createElement('h4');
    h.textContent = kind === 'replace' ? 'would replace what he does' : 'new';
    panel.appendChild(h);
    for (const c of CANDIDATES) {
      if (c.kind !== kind) continue;
      const v = reviews[c.id]?.verdict;
      panel.appendChild(button(c.title, c === cand, () => void review(c.id), v ? MARKS[v] : ''));
    }
  }
  head('The procedural one');
  panel.appendChild(button('idle (no clip)', !cand && clipName === null, () => void show(charName, null)));
  for (const pack of [...new Set(clips.map((c) => c.pack))]) {
    head(pack);
    for (const c of clips) if (c.pack === pack) panel.appendChild(button(c.name, !cand && c.name === clipName, () => void show(charName, c.name), `${c.seconds.toFixed(1)} s`));
  }
  panel.scrollTop = scroll;
}

window.addEventListener('keydown', (e) => {
  // (Typing a note.)
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.code === 'KeyN' || e.code === 'KeyP') {
    step(e.code === 'KeyN' ? 1 : -1);
    return;
  }
  if (cand && e.code === 'Escape') {
    void show(charName, clipName);
    return;
  }
  if (cand && /^Digit[1-9]$/.test(e.code)) {
    const v = Object.keys(VERDICT_LABELS[cand.kind])[Number(e.code.slice(5)) - 1] as Verdict | undefined;
    if (v) void judge(cand.id, { verdict: reviews[cand.id]?.verdict === v ? null : v });
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    if (action) action.paused = paused;
    buildPanel();
  } else if (e.code === 'KeyH') {
    void setHands(!openHands);
  } else if ((e.key === ',' || e.key === '.') && action) {
    seek(action.time + (e.key === '.' ? 1 : -1) / 30);
  } else if (e.key === '[' || e.key === ']') {
    const i = clips.findIndex((c) => c.name === clipName);
    const next = clips[(i + (e.key === ']' ? 1 : -1) + clips.length) % clips.length];
    if (next) void show(charName, next.name);
  }
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const label = { now: $('label-now'), clip: $('label-clip') };
const _p = new THREE.Vector3();
/** Puts a figure's label over its head (hidden when it's behind the camera, or not wanted). */
function place(el: HTMLElement, on: boolean, x: number, y: number, z: number): void {
  _p.set(x, y, z).project(camera);
  el.hidden = !on || _p.z > 1;
  el.style.left = `${((_p.x + 1) / 2) * window.innerWidth}px`;
  el.style.top = `${((1 - _p.y) / 2) * window.innerHeight}px`;
}

/** The candidate's run moved on by `dt`, and his rig beside it doing what the part says he does today. */
function reviewStep(dt: number): void {
  if (!cand || !character) return;
  const c = cand;
  const p = c.parts[part];
  const t = paused ? 0 : dt * speed;
  if (!switching) {
    if (hop.y > 0) {
      hop.v -= HOP.g * t;
      hop.y += hop.v * t;
      if (hop.y <= 0) hop.y = hop.v = 0;
    }
    partT += t;
    if (p.nowHop !== undefined && !hopped && partT >= p.nowHop) {
      hopped = true;
      rigHop.y = 1e-4;
      rigHop.v = HOP.v;
    }
    if (rigHop.y > 0) {
      rigHop.v -= HOP.g * t;
      rigHop.y += rigHop.v * t;
      if (rigHop.y <= 0) rigHop.y = rigHop.v = 0;
    }
    const over = p.lift ? hop.y === 0 : partT >= partLen;
    // (A candidate that's one loop just goes round.)
    if (over && !(c.parts.length === 1 && /_Loop$/.test(p.clip))) void startPart((part + 1) % c.parts.length);
  }
  character.root.position.set(carry.x, carry.y + hop.y, carry.z);
  const s = nowOf(c, p);
  if (!rig) return;
  rig.object.visible = !!s;
  if (!s) return;
  rig.squatting = !!s.squat;
  if (s.gun && rig.kind !== s.gun) rig.setKind(s.gun);
  rig.armed = !!s.gun;
  rig.aiming = !!s.gun && !!s.aim;
  if (!acted && s.fire) acted = rig.fire();
  if (!acted && s.reload) {
    rig.reload();
    acted = true;
  }
  // (The rig is posed from a camera at his eyes: facing +z, as the figure beside him does.)
  const up = hop.y + rigHop.y;
  rig.air = up;
  rig.airV = hop.y > 0 ? hop.v : rigHop.v;
  eyes.position.set(NOW_X, up + rig.eyeHeight - rig.eyeDrop, 0);
  eyes.rotation.set(0, Math.PI, 0, 'YXZ');
  eyes.updateMatrixWorld(true);
  rig.update(t, eyes, s.gait ?? 0, up);
}

function tick(dt: number): void {
  reviewStep(dt);
  if (character) {
    character.update(dt);
    // Keep with the figure: the camera and what it looks at move by what the hips moved over the floor.
    if (pelvis) {
      pelvis.getWorldPosition(at);
      const dx = at.x - was.x;
      const dz = at.z - was.z;
      camera.position.x += dx;
      camera.position.z += dz;
      controls.target.x += dx;
      controls.target.z += dz;
      key.position.set(at.x + 3, 6, at.z + 4);
      key.target.position.set(at.x, 0, at.z);
      was.copy(at);
    }
  }
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!manual) tick(dt);
  controls.update();
  renderer.render(scene, camera);
  const beside = !!cand && !!rig && rig.object.visible;
  place(label.now, beside, NOW_X, 2.12 + hop.y + rigHop.y, 0);
  place(label.clip, beside, at.x, 2.12 + carry.y + hop.y, at.z);
  const info = clips.find((c) => c.name === clipName);
  const run = cand ? `${cand.title}  (${part + 1}/${cand.parts.length})\n` : '';
  $('hud').textContent = `${charName}\n${run}${clipName ?? 'procedural idle'}${action ? `  ${action.time.toFixed(2)} / ${action.getClip().duration.toFixed(2)} s` : ''}${info?.rootMotion ? '  (travels)' : ''}\n${speed}×${paused ? '  paused' : ''}`;
});

// For scripted shots: __anims.show(char, clip), .seek(seconds), .clips(), .ready; a candidate for the city:
// .review(id), .candidates(), .length() its run in seconds, and time by hand: .manual(true), then .tick(dt) (wait for
// .settled() after each: a part starting is a promise).
const api = {
  ready: false,
  show,
  seek,
  hands: setHands,
  clips: () => clips,
  pelvis: () => pelvis,
  hide: () => ($('panel').style.display = $('hud').style.display = $('card').style.display = 'none'),
  review,
  candidates: () => CANDIDATES,
  length: () => (cand ? cand.parts.reduce((s, p) => s + lengthOf(p), 0) : 0),
  manual: (on: boolean) => (manual = on),
  tick,
  settled: () => !switching && (!cand || !nowOf(cand, cand.parts[part]) || !!rig),
  pace: (clip: string) => character?.pace(clip) ?? Promise.resolve(0),
};
(window as unknown as { __anims: typeof api }).__anims = api;

void (async () => {
  const library = await animLibrary();
  // Clips under review that the game doesn't take (assets/anims/review/: cut, looked at, not chosen yet).
  for (const url of Object.values(import.meta.glob('/assets/anims/review/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)) await library.addFile(url);
  // A take under review, not in the library: its file's clips join the list, and the first of them is shown.
  const extra = query.get('extra');
  if (extra) {
    await library.addFile(extra);
    if (!query.get('clip')) clipName = library.clips.find((c) => extra.endsWith(`/${c.pack}.glb`))?.name ?? clipName;
  }
  clips = library.clips;
  if (clipName !== null && !clips.some((c) => c.name === clipName)) clipName = 'Idle_Loop';
  // The verdicts given so far (the dev server's; without it there are none to show and none are kept).
  try {
    const res = await fetch('/__anims');
    if (res.ok) reviews = (await res.json()) as Record<string, Review>;
  } catch {
    // (No dev server: nothing kept.)
  }
  const first = query.get('review');
  const start = first === null ? null : (CANDIDATES.find((c) => c.id === first) ?? CANDIDATES.find((c) => !reviews[c.id]?.verdict) ?? CANDIDATES[0]);
  if (start) await review(start.id, query.get('char') ?? undefined);
  else await show(charName, clipName);
  api.ready = true;
})();
