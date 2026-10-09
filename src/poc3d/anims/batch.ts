import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { animLibrary, type AnimInfo } from '../models/characterAnims';
import { Character, CHARACTERS, setCharacterEnvironment } from '../models/characters';

/**
 * The whole animation library in one sitting (animbatch.html; dev only): every clip there is, eighteen to a page,
 * each on a figure of its own, all playing at once, for saying **who a clip isn't for**. (The user, 2026-10-07, having
 * first ticked what might do: "There's a lot more here that I like than dislike ... let me do per character (mack for
 * example) which ones to exclude given that they are not his vibe/style and then everything else is fair game and can
 * be added when the situation makes sense. And maybe a note for instructions for each animation that I can add to
 * say how it should be added in the game".)
 *
 * The bar's "For" is whose list is being made: Mack, the mob (the crowd, shown on the salaryman: its own figures
 * can't play a clip), or one of the cast. Under each figure: the clip's name (a click looks at that one alone, the
 * others stepping out; Esc or another click, back to all), **not for <who>** (X on the one looked at), and a note
 * for the clip, which is the clip's and not the character's: how it should be used in the game. Both are kept in
 * scripts/anims/exclusions.json through the dev server's /__animcast (scripts/devEndpoints.mjs). A clip ticked in
 * the page's first form (scripts/anims/picks.json: liked for Mack or the mob) has a green tick before its name.
 *
 * The clips are grouped by what they are (standing, walking, running ...) and go by name within a group; the bar
 * picks a group, or what's excluded, or what's still in, or what has a note; the speed; hands as the clip has them
 * or at ease. Left and right arrows turn the page. `?who=&group=&page=`. What's under review and not in the game
 * (assets/anims/review/) is here too.
 *
 * Nothing here changes the game. What it says is who a clip may be used on when a situation calls for one: a clip
 * not excluded for a character is fair game for them, and its note says how.
 */

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const query = new URLSearchParams(location.search);
const COLS = 6;
const ROWS = 3;
const PER = COLS * ROWS;
/** Metres between figures across, and between rows going back (far enough that a row's heads clear the feet behind). */
const ACROSS = 2.1;
const BACK = 7;

/** What a clip is, by its name: the groups, in the order they're gone through. */
const GROUPS: readonly (readonly [string, RegExp])[] = [
  ['Standing', /^(Idle_(?!Shield)|Zombie_Idle)/],
  ['Walking', /^(Walk_|Zombie_Walk)/],
  ['Running', /^(Run_|Jog_|Sprint_|RunStart|RunStop|Slide_)/],
  ['Sitting and low', /^(Sitting_|GroundSit_|Crouch_|Crawl_|LayToIdle)/],
  ['Doing things', /^(Drink|Consume|Interact|Counter_|PickUp_|Fixing_|Farm_|Chest_|TreeChopping|OverhandThrow|Celebration|Crying|Dance|Yes|Push_|Driving)/],
  ['Jumping and climbing', /^(Jump|NinjaJump|Climb|BackFlip|Roll|Dodge|Swim|Turn90)/],
  ['Guns and fighting', /^(Pistol_|Sword_|Punch|Kick|Melee_|Hit_|Death|Shield_|Idle_Shield|Spell_|Zombie_)/],
];
const groupOf = (name: string): string => GROUPS.find(([, re]) => re.test(name))?.[0] ?? 'Other';
/** Whose list can be made: Mack, the crowd, and the rest of the cast (not his other clothes: they're him). And the
 * figure a list is judged on, where it isn't the one it's named for. */
const PROFILES = ['mack', 'mob', ...CHARACTERS.filter((c) => !/^mack(_|$)/.test(c))].filter((p) => p === 'mob' || CHARACTERS.includes(p));
const FIGURE: Record<string, string> = { mob: CHARACTERS.includes('salaryman') ? 'salaryman' : CHARACTERS[0] };
const figureOf = (profile: string): string => FIGURE[profile] ?? profile;
const nameOf = (profile: string): string => (profile === 'mob' ? 'the mob' : profile === 'mack' ? 'Mack' : `the ${profile}`);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2c31);
scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x3a3630, 1.2));
const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
key.position.set(4, 8, 6);
scene.add(key);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x55585f, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
const grid = new THREE.GridHelper(80, 80, 0x8a8f9c, 0x3f424a);
grid.position.y = 0.002;
scene.add(floor, grid);
setCharacterEnvironment(new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture);

// Seen square on from a little above, with no perspective, so every row is the same size and the names line up.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxPolarAngle = Math.PI * 0.495;
// (Looked at a little above the middle row's feet, so the rows sit under the bar along the top.)
const HOME = { at: new THREE.Vector3(0, 2.2, -BACK * ((ROWS - 1) / 2)), tilt: 0.42, height: 12 };
/** Half the height of what's seen (m): all three rows, or one figure. */
let span = HOME.height / 2;
function frame(): void {
  const aspect = window.innerWidth / window.innerHeight;
  // (Wide enough for a whole row whatever the window's shape.)
  const half = Math.max(span, focus < 0 ? (COLS * ACROSS) / 2 / aspect + 0.3 : 0);
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
}
function look(at: THREE.Vector3, height: number, tilt = HOME.tilt, turn = 0): void {
  span = height / 2;
  camera.zoom = 1;
  controls.target.copy(at);
  camera.position.set(at.x + 40 * Math.sin(turn) * Math.cos(tilt), at.y + 40 * Math.sin(tilt), at.z + 40 * Math.cos(turn) * Math.cos(tilt));
  controls.update();
  frame();
}

let clips: readonly AnimInfo[] = [];
/** Whose list is being made. */
let who = PROFILES.includes(query.get('who') ?? '') ? query.get('who')! : PROFILES[0];
let group = query.get('group') ?? 'All';
let page = Number(query.get('page') ?? 0);
let speed = 1;
let open = false;
let paused = false;
/** The slot looked at alone, or -1 for the whole page. */
let focus = -1;
let saveError = '';
/** Who each clip isn't for; each clip's note; and what was ticked as liked in the page's first form. */
const exclude = new Map<string, Set<string>>();
const notes = new Map<string, string>();
const liked = new Map<string, Set<string>>();
const out = (profile: string): Set<string> => exclude.get(profile) ?? exclude.set(profile, new Set()).get(profile)!;
const figures: (Character | null)[] = Array.from({ length: PER }, () => null);
const actions: (THREE.AnimationAction | null)[] = Array.from({ length: PER }, () => null);
const shown: (AnimInfo | null)[] = Array.from({ length: PER }, () => null);
const cells: HTMLElement[] = [];
/** A page is being put up: a later one asked for meanwhile waits its turn. */
let busy: Promise<void> = Promise.resolve();

// (The first row is the one at the back, which is the top of the picture: read like a page.)
const placeOf = (i: number): THREE.Vector3 => new THREE.Vector3(((i % COLS) - (COLS - 1) / 2) * ACROSS, 0, -(ROWS - 1 - Math.floor(i / COLS)) * BACK);

/** The filters after the groups, and what each keeps. */
const FILTERS: Record<string, (c: AnimInfo) => boolean> = {
  'Still in': (c) => !out(who).has(c.name),
  Excluded: (c) => out(who).has(c.name),
  'With a note': (c) => notes.has(c.name),
};

function listed(): AnimInfo[] {
  const order = new Map(GROUPS.map(([name], i) => [name, i]));
  const all = [...clips].sort((a, b) => (order.get(groupOf(a.name)) ?? 99) - (order.get(groupOf(b.name)) ?? 99) || a.name.localeCompare(b.name));
  if (group === 'All') return all;
  return all.filter(FILTERS[group] ?? ((c) => groupOf(c.name) === group));
}
const pagesOf = (count: number): number => Math.max(1, Math.ceil(count / PER));

/** Puts the page's clips on its figures (loading the figures the first time, and again for someone else). */
async function show(): Promise<void> {
  const list = listed();
  page = Math.max(0, Math.min(pagesOf(list.length) - 1, page));
  const model = figureOf(who);
  for (let i = 0; i < PER; i++) {
    const clip = list[page * PER + i] ?? null;
    shown[i] = clip;
    let f = figures[i];
    if (clip && (!f || f.name !== model)) {
      if (f) scene.remove(f.root);
      f = figures[i] = await Character.load(model, i * 0.37);
      scene.add(f.root);
    }
    if (!clip || !f) {
      actions[i] = null;
      continue;
    }
    f.root.position.copy(placeOf(i));
    const a = (actions[i] = await f.play(clip.name, 0, open));
    if (a) {
      a.reset().play();
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.timeScale = speed;
      a.paused = paused;
    }
  }
  if (focus >= 0 && !shown[focus]) {
    focus = -1;
    look(HOME.at, HOME.height);
  }
  bar();
  labels();
}
const put = (): void => void (busy = busy.then(show));

function unfocus(): void {
  focus = -1;
  look(HOME.at, HOME.height);
  labels();
}
function focusOn(i: number): void {
  if (focus === i) return unfocus();
  focus = i;
  look(placeOf(i).add(new THREE.Vector3(0, 0.75, 0)), 3.4, 0.12, 0.5);
  labels();
}

async function save(body: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch('/__animcast', { method: 'POST', body: JSON.stringify(body) });
    saveError = res.ok ? '' : `not saved: ${await res.text()}`;
  } catch (err) {
    saveError = `not saved: ${String(err)}`;
  }
  bar();
}

/** Says a clip isn't for whoever's list this is, or takes that back. */
function toggle(clip: string): void {
  const set = out(who);
  const on = !set.has(clip);
  if (on) set.add(clip);
  else set.delete(clip);
  labels();
  void save({ who, clip, on });
}

function button(text: string, on: boolean, click: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  if (on) b.className = 'on';
  b.onclick = click;
  return b;
}

/** The bar along the top: whose list, the groups, speed, hands, the page. */
function bar(): void {
  const count = listed().length;
  const pages = pagesOf(count);
  const el = $('bar');
  el.replaceChildren();
  const row = (label: string): HTMLElement => {
    const r = document.createElement('div');
    const s = document.createElement('span');
    s.textContent = label;
    r.appendChild(s);
    el.appendChild(r);
    return r;
  };
  const people = row('For');
  for (const p of PROFILES) {
    people.appendChild(button(`${p}${out(p).size ? ` (${out(p).size} out)` : ''}`, p === who, () => {
      who = p;
      put();
    }));
  }
  const about = document.createElement('em');
  about.textContent = `mark what isn't ${nameOf(who)}'s; the rest is fair game${who === 'mob' ? ` · shown on the ${figureOf(who)}` : ''}`;
  people.appendChild(about);
  const groups = row('Show');
  for (const g of ['All', ...GROUPS.map(([name]) => name), 'Other', ...Object.keys(FILTERS)]) {
    const n = g === 'All' ? clips.length : clips.filter(FILTERS[g] ?? ((c) => groupOf(c.name) === g)).length;
    groups.appendChild(button(`${g} ${n}`, g === group, () => {
      group = g;
      page = 0;
      focus = -1;
      look(HOME.at, HOME.height);
      put();
    }));
  }
  const play = row('Play');
  for (const s of [0.25, 0.5, 1]) {
    play.appendChild(button(`${s}×`, s === speed, () => {
      speed = s;
      for (const a of actions) if (a) a.timeScale = s;
      bar();
    }));
  }
  play.appendChild(button(paused ? 'paused (Space)' : 'pause (Space)', paused, togglePause));
  play.appendChild(button(open ? 'hands at ease (H)' : 'hands as made (H)', open, () => ((open = !open), put())));
  const turn = row('Page');
  turn.appendChild(button('←', false, () => ((page -= 1), put())));
  const where = document.createElement('b');
  where.textContent = ` ${page + 1} of ${pages} `;
  turn.appendChild(where);
  turn.appendChild(button('→', false, () => ((page += 1), put())));
  const note = document.createElement('em');
  note.textContent = `${count} clips · a name looks at that one alone (Esc back; X marks it) · ${notes.size} with a note${saveError ? ` · ${saveError}` : ''}`;
  turn.appendChild(note);
}

function togglePause(): void {
  paused = !paused;
  for (const a of actions) if (a) a.paused = paused;
  bar();
}

/** Each slot's name, its mark and its note, as they stand; and its figure there or not (looked at alone, the
 * others step out). */
function labels(): void {
  for (let i = 0; i < PER; i++) {
    const cell = cells[i];
    const clip = shown[i];
    const f = figures[i];
    if (f) f.root.visible = !!clip && (focus < 0 || focus === i);
    cell.hidden = !clip || (focus >= 0 && focus !== i);
    cell.replaceChildren();
    if (!clip) continue;
    const gone = out(who).has(clip.name);
    cell.className = `cell${gone ? ' out' : ''}${focus === i ? ' alone' : ''}`;
    // (Ticked as liked in the page's first form: a mark before the name.)
    const was = !!liked.get(who)?.has(clip.name);
    const name = button(`${was ? '✓ ' : ''}${clip.name.replace(/_/g, '_​')}`, focus === i, () => focusOn(i));
    name.className += ` name${was ? ' liked' : ''}`;
    name.title = `${clip.pack}, ${clip.seconds.toFixed(1)} s${clip.rootMotion ? ', travels' : ''}${was ? ' · you ticked this as liked earlier' : ''}`;
    cell.appendChild(name);
    const mark = button(gone ? `✕ not for ${nameOf(who)}` : `not for ${nameOf(who)}?`, gone, () => toggle(clip.name));
    mark.className += ' mark';
    cell.appendChild(mark);
    const text = document.createElement('input');
    text.placeholder = 'how to use it…';
    text.value = notes.get(clip.name) ?? '';
    text.title = 'A note for this animation: how it should be used in the game (Enter saves)';
    text.onchange = () => {
      const v = text.value.trim();
      if (v) notes.set(clip.name, v);
      else notes.delete(clip.name);
      void save({ clip: clip.name, note: v });
    };
    cell.appendChild(text);
  }
}

window.addEventListener('keydown', (e) => {
  // (Typing a note.)
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    page += e.code === 'ArrowRight' ? 1 : -1;
    put();
  } else if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
  } else if (e.code === 'KeyH') {
    open = !open;
    put();
  } else if (e.code === 'KeyX' && focus >= 0 && shown[focus]) toggle(shown[focus]!.name);
  else if (e.code === 'Escape' && focus >= 0) unfocus();
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  frame();
});

const clock = new THREE.Clock();
const _p = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  for (let i = 0; i < PER; i++) if (shown[i]) figures[i]?.update(dt);
  controls.update();
  renderer.render(scene, camera);
  // Each name under its figure's feet.
  for (let i = 0; i < PER; i++) {
    if (cells[i].hidden) continue;
    _p.copy(placeOf(i)).project(camera);
    cells[i].style.left = `${((_p.x + 1) / 2) * window.innerWidth}px`;
    cells[i].style.top = `${((1 - _p.y) / 2) * window.innerHeight}px`;
  }
});

// For scripted shots: __batch.ready, .go(group, page), .who(profile), .focus(slot), .names(), .hide().
const api = {
  ready: false,
  go: async (g: string, p = 0) => {
    group = g;
    page = p;
    put();
    await busy;
  },
  who: async (p: string) => {
    who = p;
    put();
    await busy;
  },
  focus: (i: number) => focusOn(i),
  names: () => shown.map((c) => c?.name ?? null),
  hide: () => ($('bar').style.display = 'none'),
};
(window as unknown as { __batch: typeof api }).__batch = api;

void (async () => {
  for (let i = 0; i < PER; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.hidden = true;
    document.body.appendChild(cell);
    cells.push(cell);
  }
  look(HOME.at, HOME.height);
  const library = await animLibrary();
  // (What's under review and not taken by the game.)
  for (const url of Object.values(import.meta.glob('/assets/anims/review/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)) await library.addFile(url);
  clips = library.clips;
  try {
    const res = await fetch('/__animcast');
    if (res.ok) {
      const saved = (await res.json()) as { exclude?: Record<string, string[]>; notes?: Record<string, string>; liked?: Record<string, string[]> };
      for (const [p, names] of Object.entries(saved.exclude ?? {})) exclude.set(p, new Set(names));
      for (const [clip, text] of Object.entries(saved.notes ?? {})) notes.set(clip, text);
      for (const [p, names] of Object.entries(saved.liked ?? {})) liked.set(p, new Set(names));
    }
  } catch {
    // (No dev server: nothing kept.)
  }
  put();
  await busy;
  api.ready = true;
})();
