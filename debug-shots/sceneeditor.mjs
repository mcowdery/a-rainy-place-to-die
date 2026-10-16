// The scene editor (scenes.html, src/poc3d/showroom/scenes.ts), used by a script: opens a scene, drags a hand of a
// figure onto a joint of another (or to a point), and photographs the page; with `save`, saves the result (a
// built-in scene's edited copy goes to content/world3d/windows/<id>.json). Also a round trip of the save endpoint
// with a scratch scene, which it removes again.
//   node debug-shots/sceneeditor.mjs <out dir> [mode] [jobs...]
// A job is  <scene id>[@<pose>]:<figure>.<handle>-><figure>.<joint>[+dx,dy][:save]   (figures and poses from 0), or
// just <scene id> to photograph it as it is. e.g.  v_den_close@1:1.handL->0.shoulderR:save
// A held thing:  <scene id>[@<pose>]:hold:<figure>.<hold>[:dx,dy][:angle][:wheel ticks][:undress]   takes hold of it, drags
// it dx, dy metres, turns it to an angle by its round handle, sizes it by the wheel (and with `undress`, presses the
// figure's undress button); photographed, never saved. e.g.  v_den_pour@1:hold:1.0:0.05,0.1:45:3
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { existsSync, mkdirSync, readFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/sceneeditor';
mkdirSync(out, { recursive: true });
const mode = process.argv[3] && process.argv[3] !== 'standard' ? process.argv[3] : undefined;
const jobs = process.argv.slice(4);
const server = await shotServer({ mode, server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
page.on('dialog', (d) => d.accept());
await page.goto(`${base}scenes.html`);
await page.waitForFunction(() => window.__scenes, null, { timeout: 120000 });
const list = await page.evaluate(() => window.__scenes.entries.map((e) => ({ id: e.id, place: e.place, errors: e.errors.length, overrides: !!e.overrides })));
console.log(`${list.length} scenes: ${list.filter((e) => e.place === 'builtin').length} built in, ${list.filter((e) => e.overrides).length} edited copies, ${list.filter((e) => e.place === 'content' && !e.overrides).length} more in content/, ${list.filter((e) => e.place === 'adult').length} in adult/, ${list.filter((e) => e.errors).length} with errors`);

// The save endpoint, there and back with a scratch scene (and what it must refuse).
const post = (body) => page.evaluate(async (b) => {
  const r = await fetch('/__scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, ...(await r.json()) };
}, body);
const scratch = { id: 'zz_editor_scratch', label: 'a scratch scene', cat: 'home', a: [{ who: 'man', x: 0, pose: {} }] };
const saved = await post({ op: 'save', place: 'content', scene: scratch });
const file = 'content/world3d/windows/zz_editor_scratch.json';
console.log('save:', JSON.stringify(saved), existsSync(file) && readFileSync(file, 'utf8') === `${JSON.stringify(scratch, null, 2)}\n` ? '· on disk, byte for byte' : '· NOT on disk as sent');
console.log('revert:', JSON.stringify(await post({ op: 'revert', id: 'zz_editor_scratch' })), existsSync(file) ? '· STILL THERE' : '· gone');
for (const [what, body] of [
  ['an id with a path in it', { op: 'save', place: 'content', scene: { ...scratch, id: '../zz_escape' } }],
  ['an adult scene to content/', { op: 'save', place: 'content', scene: { ...scratch, cat: 'v_love', adult: true, a: [{ who: 'suit', x: 0, pose: {} }] } }],
  ['a scene not marked adult to adult/', { op: 'save', place: 'adult', scene: scratch }],
  ['a child in a vice scene', { op: 'save', place: 'content', scene: { ...scratch, cat: 'v_den', a: [{ who: 'boy', x: 0, pose: {} }] } }],
  ['another folder', { op: 'save', place: 'src', scene: scratch }],
  ['reverting a file that is not there', { op: 'revert', id: 'zz_no_such_scene' }],
]) console.log(`refused (${what}):`, JSON.stringify(await post(body)).slice(0, 150));

for (const job of jobs) {
  // A held thing: taken hold of, dragged by dx, dy metres, turned to an angle by its round handle, sized by the wheel.
  const hm = /^([a-z0-9_]+)(?:@(\d+))?:hold:(\d+)\.(\d+)(?::(-?[\d.]+),(-?[\d.]+))?(?::(-?[\d.]*))?(?::(-?\d*))?(:undress)?$/.exec(job);
  if (hm) {
    const [, id, pose, fig, n, dx, dy, turn0, ticks0, bare] = hm;
    const turn = turn0 || undefined, ticks = ticks0 || undefined;
    if (!(await page.evaluate((i) => window.__scenes.open(i), id))) {
      console.log('no scene', id);
      continue;
    }
    if (pose) await page.evaluate((p) => window.__scenes.frame(Number(p)), pose);
    const holdNow = () => page.evaluate(([f, h, p]) => { const d = window.__scenes.doc(); const keys = [d.a, d.b, ...(d.frames ?? []).map((x) => x.a)].filter(Boolean); return JSON.stringify(keys[p][f].hold?.[h]); }, [Number(fig), Number(n), Number(pose ?? 0)]);
    const was = await holdNow();
    await page.evaluate(([f, h]) => window.__scenes.selectHold(f, h), [Number(fig), Number(n)]);
    const k = await page.evaluate(() => { const a = window.__scenes.pointAt(0, 0), b = window.__scenes.pointAt(1, 1); return [b[0] - a[0], b[1] - a[1]]; });
    if (dx !== undefined) {
      const on = await page.evaluate(() => window.__scenes.holdOn());
      await page.mouse.move(on.at[0], on.at[1]);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(on.at[0] + (Number(dx) * k[0] * i) / 8, on.at[1] + (Number(dy) * k[1] * i) / 8);
      await page.mouse.up();
    }
    if (turn !== undefined) {
      const on = await page.evaluate(() => window.__scenes.holdOn());
      // (Its far end is dragged to that bearing from where it's drawn.)
      const a = (Number(turn) * Math.PI) / 180;
      await page.mouse.move(on.turn[0], on.turn[1]);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(on.turn[0] + ((on.at[0] + Math.cos(a) * 0.3 * k[0] - on.turn[0]) * i) / 8, on.turn[1] + ((on.at[1] + Math.sin(a) * 0.3 * k[1] - on.turn[1]) * i) / 8);
      await page.mouse.up();
    }
    if (ticks !== undefined) {
      const on = await page.evaluate(() => window.__scenes.holdOn());
      await page.mouse.move(on.at[0], on.at[1]);
      for (let i = 0; i < Math.abs(Number(ticks)); i++) await page.mouse.wheel(0, Number(ticks) > 0 ? -100 : 100);
    }
    await page.waitForTimeout(200);
    console.log(`${id}: hold ${fig}.${n} ${was} -> ${await holdNow()} · selected ${JSON.stringify(await page.evaluate(() => window.__scenes.selected()))} · errors: ${JSON.stringify(await page.evaluate(() => window.__scenes.problems()))}`);
    if (bare) {
      // The undress buttons (an adult scene only): this pose, then every pose.
      const buttons = await page.evaluate(() => [...document.querySelectorAll('#side button')].map((b) => b.textContent).filter((t) => /undress|same in every|change clothes/.test(t)));
      const hint = await page.evaluate(() => [...document.querySelectorAll('#side .hint')].map((b) => b.textContent).filter((t) => /undress|nothing on|without clothes/.test(t)));
      console.log(`${id}: who buttons ${JSON.stringify(buttons)} hints ${JSON.stringify(hint)}`);
      const who = () => page.evaluate((f) => { const d = window.__scenes.doc(); return JSON.stringify([d.a, d.b, ...(d.frames ?? []).map((x) => x.a)].filter(Boolean).map((a) => a[f]?.who)); }, Number(fig));
      const before = await who();
      const all = await page.evaluate(() => { const b = [...document.querySelectorAll('#side button')].find((x) => x.textContent === 'undress in every pose') ?? [...document.querySelectorAll('#side button')].find((x) => x.textContent === 'undress'); b?.click(); return b?.textContent ?? null; });
      console.log(`${id}: '${all}' · figure ${fig} was ${before} is ${await who()} · errors: ${JSON.stringify(await page.evaluate(() => window.__scenes.problems()))}`);
      await page.evaluate(([f, h]) => window.__scenes.selectHold(f, h), [Number(fig), Number(n)]);
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => document.querySelector('#side .line.sel select[data-field=hold]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${out}/${id}${pose ? `_pose${pose}` : ''}_hold.png` });
    console.log(`${id}: unsaved ${await page.evaluate(() => window.__scenes.dirty())} (not saved) · ${out}/${id}${pose ? `_pose${pose}` : ''}_hold.png`);
    continue;
  }
  // A part's rings:  <scene id>[@<pose>]:part:<figure>.<part>[:<ring>][:depth <m>][:copy]   takes the part in hand, drags
  // that ring a sixth of the way round, nudges it with the keys, double-clicks it back; then (depth) stands the figure
  // that far back and drags its hand; (copy) copies the pose over the next. Photographed, never saved.
  const pm = /^([a-z0-9_]+)(?:@(\d+))?:part:(\d+)\.(\w+)(?::(\d))?(?::depth(-?[\d.]+))?(:copy)?$/.exec(job);
  if (pm) {
    const [, id, pose, fig, part, ring, depth, copy] = pm;
    if (!(await page.evaluate((i) => window.__scenes.open(i), id))) {
      console.log('no scene', id);
      continue;
    }
    if (pose) await page.evaluate((p) => window.__scenes.frame(Number(p)), pose);
    await page.evaluate((f) => window.__scenes.select(Number(f)), fig);
    await page.evaluate((p) => window.__scenes.selectPart(p), part);
    const figNow = () => page.evaluate(([f, p]) => { const d = window.__scenes.doc(); const keys = [d.a, d.b, ...(d.frames ?? []).map((x) => x.a)].filter(Boolean); return JSON.stringify(keys[p][f]); }, [Number(fig), Number(pose ?? 0)]);
    const was = await figNow();
    const k = Number(ring ?? 0);
    let on = await page.evaluate((k) => window.__scenes.ringOn(k), k);
    if (!on) console.log(`${id}: ${part} has no ring ${k}`);
    else {
      await page.mouse.move(on.at[0], on.at[1]);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(on.at[0] + ((on.on[0] - on.at[0]) * i) / 10, on.at[1] + ((on.on[1] - on.at[1]) * i) / 10);
      await page.screenshot({ path: `${out}/${id}_${part}_turning.png` });
      await page.mouse.up();
      const after = await page.evaluate((k) => window.__scenes.ringOn(k).value, k);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowRight');
      const nudged = await page.evaluate((k) => window.__scenes.ringOn(k).value, k);
      console.log(`${id}: ${part} ring ${k}: ${on.value} -> ${after} dragged a sixth of the way round -> ${nudged} after right and Shift+right · ${await figNow()} · errors: ${JSON.stringify(await page.evaluate(() => window.__scenes.problems()))}`);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/${id}_${part}.png` });
      on = await page.evaluate((k) => window.__scenes.ringOn(k), k);
      await page.mouse.dblclick(on.at[0], on.at[1]);
      console.log(`${id}: double-clicked: ring ${k} is ${await page.evaluate((k) => window.__scenes.ringOn(k).value, k)}`);
    }
    if (depth !== undefined) {
      await page.evaluate((d) => window.__scenes.depth(Number(d)), depth);
      await page.waitForTimeout(100);
      // A hand dragged on a figure that far back still lands under the pointer.
      const from = await page.evaluate(() => window.__scenes.jointAt('handR'));
      const end = [from[0] + 30, from[1] - 40];
      await page.mouse.move(from[0], from[1]);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(from[0] + (30 * i) / 10, from[1] - (40 * i) / 10);
      await page.mouse.up();
      const got = await page.evaluate(() => window.__scenes.jointAt('handR'));
      console.log(`${id}: ${depth} m back: its hand dragged ends ${Math.hypot(got[0] - end[0], got[1] - end[1]).toFixed(1)} px from the pointer · ${await figNow()} · errors: ${JSON.stringify(await page.evaluate(() => window.__scenes.problems()))}`);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/${id}_depth.png` });
    }
    if (copy) {
      const poses = () => page.evaluate(() => { const d = window.__scenes.doc(); return [d.a, d.b, ...(d.frames ?? []).map((x) => x.a)].filter(Boolean).map((a) => JSON.stringify(a)); });
      const before = await poses();
      await page.keyboard.press('Control+Shift+BracketRight');
      const then = await poses();
      const at = Number(pose ?? 0);
      console.log(`${id}: Ctrl+Shift+]: pose ${at + 1} ${before[at + 1] === then[at + 1] ? 'unchanged' : then[at + 1] === then[at] ? 'is now this pose' : 'changed, but is not this pose'} · ${await page.evaluate(() => document.getElementById('status')?.textContent)}`);
      await page.keyboard.press('Control+z');
      console.log(`${id}: undone: ${(await poses())[at + 1] === before[at + 1] ? 'pose ' + (at + 1) + ' is back' : 'NOT back'}`);
    }
    console.log(`${id}: ${was === (await figNow()) ? 'the figure is as it was' : 'the figure is changed'} (not saved)`);
    continue;
  }
  const m = /^([a-z0-9_]+)(?:@(\d+))?(?::(\d+)\.(\w+)->(?:(\d+)\.(\w+))?(?:\+?(-?[\d.]+),(-?[\d.]+))?)?(:save)?$/.exec(job);
  if (!m) {
    console.log('not a job:', job);
    continue;
  }
  const [, id, pose, fig, handle, toFig, toJoint, dx, dy, save] = m;
  if (!(await page.evaluate((i) => window.__scenes.open(i), id))) {
    console.log('no scene', id);
    continue;
  }
  if (pose) await page.evaluate((p) => window.__scenes.frame(Number(p)), pose);
  if (fig !== undefined) {
    // Where the other figure's joint is (in the room's metres, from the page's own placing), then the drag.
    let target = null;
    if (toFig !== undefined) {
      await page.evaluate((f) => window.__scenes.select(Number(f)), toFig);
      target = await page.evaluate((j) => window.__scenes.jointAt(j), toJoint);
    }
    await page.evaluate((f) => window.__scenes.select(Number(f)), fig);
    const from = await page.evaluate((h) => window.__scenes.jointAt(h), handle);
    const k = await page.evaluate(() => { const a = window.__scenes.pointAt(0, 0), b = window.__scenes.pointAt(1, 1); return [b[0] - a[0], b[1] - a[1]]; });
    const to = target ?? from;
    const end = [to[0] + Number(dx ?? 0) * k[0], to[1] + Number(dy ?? 0) * k[1]];
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(from[0] + ((end[0] - from[0]) * i) / 12, from[1] + ((end[1] - from[1]) * i) / 12);
    await page.mouse.up();
    const got = await page.evaluate((h) => window.__scenes.jointAt(h), handle);
    console.log(`${id}: ${handle} of figure ${fig} dragged; it ends ${(Math.hypot(got[0] - end[0], got[1] - end[1]) / Math.abs(k[0]) * 1000).toFixed(0)} mm from where it was put · errors: ${JSON.stringify(await page.evaluate(() => window.__scenes.problems()))}`);
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${id}${pose ? `_pose${pose}` : ''}.png` });
  if (save) {
    await page.evaluate(() => window.__scenes.save());
    await page.waitForTimeout(300);
    console.log(`${id}: ${await page.evaluate(() => document.getElementById('status')?.textContent)}`);
  }
  console.log(`${id}: unsaved ${await page.evaluate(() => window.__scenes.dirty())} · ${out}/${id}${pose ? `_pose${pose}` : ''}.png`);
}
await browser.close();
await server.close();
