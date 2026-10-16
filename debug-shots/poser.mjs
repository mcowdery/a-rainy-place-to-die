// The characters' page's Pose tab (showroom/poser.ts): works it with the mouse and checks what it promises: a dot
// comes to where it's dragged and the limb doesn't twist on the way (a foot carried forward or out to the side keeps
// its toes pointing ahead); a foot on the floor stays where it is while the other leg, the standing knee or the hips
// are dragged; free of the floor, lifting both legs leaves her where she is and the hips' dot lifts all of her;
// Shift-drag turns a limb about its own line with its hand or foot staying put; a click on a dot shows its part's
// rings and dragging a ring turns that part; undo and redo step through it. Photographs each.
//   node debug-shots/poser.mjs [out dir]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/poser';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 600)); });
await page.goto(server.resolvedUrls.local[0] + 'characters.html?labels=0&t=3');
await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
// The panel's own tab.
await page.locator('#panel button', { hasText: /^Pose$/ }).click();
await page.waitForTimeout(500);
console.log('the Pose tab: sections', await page.locator('#panel summary').allTextContents());
const dot = (name) => page.evaluate((n) => window.__mob.poser.dotAt(n), name);
const where = (name) => page.evaluate((n) => window.__mob.poser.where(n), name);
const pose = () => page.evaluate(() => JSON.stringify(window.__mob.poser.pose));
/** Which way a foot's toes point, round the upright from straight ahead (degrees), and a knee's or elbow's hinge. */
const toes = (s) => page.evaluate((b) => { const m = window.__mob.poser.posed.bones; return Math.round((Math.atan2(m[b * 16 + 8], m[b * 16 + 10]) * 180) / Math.PI); }, s === 'L' ? 12 : 13);
const cm = (a, b) => (Math.hypot(a[0] - b[0], a[2] - b[2]) * 100).toFixed(1);
const cm3 = (a, b) => (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100).toFixed(1);
// (The joints' dots show, and are taken hold of, only while Shift is held; with Alt as well a drag turns the limb.)
const dragFrom = async (x, y, dx, dy, alt = false, shift = false) => {
  if (shift) await page.keyboard.down('Shift');
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
};
const drag = async (name, dx, dy, alt = false) => {
  const [x, y] = await dot(name);
  await dragFrom(x, y, dx, dy, alt, true);
  const [ax, ay] = await dot(name);
  return Math.round(Math.hypot(ax - x - dx, ay - y - dy));
};
let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_${name}.png` });
const reset = () => page.evaluate(() => { const p = window.__mob.poser; p.setFree(false); p.offset.set(0, 0, 0); p.set({}); });
const front = async () => { await page.evaluate(() => window.__focus('pose')); await page.waitForTimeout(200); };
await shot('start');
console.log('dots shown without Shift:', await page.evaluate(() => window.__mob.poser.dots.filter((d) => d.visible).length), '· with Shift:', await (async () => { await page.keyboard.down('Shift'); await page.waitForTimeout(120); const n = await page.evaluate(() => window.__mob.poser.dots.filter((d) => d.visible).length); await page.keyboard.up('Shift'); return n; })());

// A hand, up and across.
console.log('hand R dragged up: off by', await drag('hand R', -40, -260), 'px', await pose());
await shot('hand_up');
await reset();

// A foot carried forward-and-up, then out to the side: the other foot stays, the toes still point ahead.
let footR = await where('foot R');
console.log('foot L lifted from in front: off by', await drag('foot L', 0, -140), 'px; toes', await toes('L'), 'deg round;', await pose());
let knee = await where('knee L'), hip = await where('hips');
console.log('  the knee is', ((knee[2] - hip[2]) * 100).toFixed(0), 'cm in front of the hips,', (Math.abs(knee[0] - hip[0]) * 100).toFixed(0), 'cm to the side; the other foot moved', cm(footR, await where('foot R')), 'cm');
await shot('foot_up');
await reset();
console.log('foot L dragged out to the side: off by', await drag('foot L', -150, -60), 'px; toes', await toes('L'), 'deg round;', await pose());
await shot('foot_side');
await reset();
console.log('hand L dragged out to the side and up: off by', await drag('hand L', -160, -200), 'px;', await pose());
await shot('hand_side');
await reset();

// The standing leg's knee: its own foot stays, the body moves over it.
await drag('foot L', 0, -140);
footR = await where('foot R');
hip = await where('hips');
await page.evaluate(() => window.__view(3.2, 1.0, window.__mob.controls.target.z + 0.2, 0, 0.9, window.__mob.controls.target.z));
await page.waitForTimeout(200);
await drag('knee R', -50, 20);
console.log('standing knee R dragged (from the side): its foot moved', cm(footR, await where('foot R')), 'cm; the hips moved', cm(hip, await where('hips')), 'cm', await pose());
await shot('standing_knee');
await reset();
await front();

// The hips: a crouch, both feet where they were.
const [fl, fr] = [await where('foot L'), await where('foot R')];
hip = await where('hips');
await drag('hips', 0, 110);
let hip2 = await where('hips');
console.log('hips dragged down: they dropped', ((hip[1] - hip2[1]) * 100).toFixed(0), 'cm; foot L moved', cm(fl, await where('foot L')), 'cm, foot R', cm(fr, await where('foot R')), 'cm', await pose());
await shot('crouch');
await reset();

// Free of the floor: both legs lifted, she stays where she is; the hips' dot lifts all of her.
await page.locator('#panel button', { hasText: 'free of it' }).click();
await page.waitForTimeout(200);
hip = await where('hips');
await drag('foot L', 0, -120);
await drag('foot R', 0, -120);
hip2 = await where('hips');
console.log('free: both feet lifted; the hips moved', cm3(hip, hip2), 'cm; feet now', ((await where('foot L'))[1] * 100).toFixed(0), 'and', ((await where('foot R'))[1] * 100).toFixed(0), 'cm up');
await shot('free_legs');
console.log('free: hips dragged up and across: off by', await drag('hips', 80, -150), 'px; they rose', (((await where('hips'))[1] - hip2[1]) * 100).toFixed(0), 'cm');
await shot('free_lifted');
await page.locator('#panel button', { hasText: 'on the floor' }).click();
await page.waitForTimeout(200);
console.log('back on the floor: the lower foot is', (Math.min((await where('foot L'))[1], (await where('foot R'))[1]) * 100).toFixed(0), 'cm up');
await reset();
await front();

// Shift: a limb turned about its own line. A foot: it stays, the toes and knee go round. A bent arm: the hand stays, the elbow goes round.
let f0 = await where('foot L');
await drag('foot L', 60, 0, true);
console.log('foot L Alt-dragged: it moved', cm3(f0, await where('foot L')), 'cm; toes', await toes('L'), 'deg round');
await reset();
await drag('hand R', -60, -120);
let h0 = await where('hand R'), e0 = await where('elbow R');
await drag('hand R', 60, 0, true);
console.log('hand R Alt-dragged: it moved', cm3(h0, await where('hand R')), 'cm; the elbow went', cm3(e0, await where('elbow R')), 'cm round');
await shot('swivel');
await reset();

// A click on a dot: its part in hand, its rings round the joint; a ring dragged turns the part.
let [x, y] = await dot('elbow R');
await page.keyboard.down('Shift');
await page.mouse.click(x, y);
await page.keyboard.up('Shift');
await page.waitForTimeout(200);
console.log('clicked elbow R: the panel shows', await page.locator('#panel h3').first().textContent());
await shot('rings');
for (const axis of ['x', 'y', 'z']) {
  const before = await pose();
  h0 = await where('hand R');
  const at = await page.evaluate((a) => window.__mob.poser.ringAt(a), axis);
  await dragFrom(at[0], at[1], 30, 30);
  console.log(' ', axis, 'ring dragged: the hand moved', cm3(h0, await where('hand R')), 'cm;', before, '->', await pose());
}
await shot('ring_turned');
[x, y] = await dot('hips');
await page.keyboard.down('Shift');
await page.mouse.click(x, y);
await page.keyboard.up('Shift');
await page.waitForTimeout(200);
hip = await where('hips');
let at = await page.evaluate(() => window.__mob.poser.ringAt('y'));
await dragFrom(at[0], at[1], 60, 10);
console.log('whole body turned by its green ring: the hips moved', cm(hip, await where('hips')), 'cm;', await pose());
await shot('body_turned');

// The spine: the neck's base dragged bends the whole back, shared between its joints; the head on the neck.
await reset();
await page.evaluate(() => window.__view(3.2, 1.1, window.__mob.controls.target.z + 0.2, 0, 0.95, window.__mob.controls.target.z));
await page.waitForTimeout(200);
console.log('neck dragged forward (from the side): off by', await drag('neck', -70, 20), 'px;', await pose());
console.log('head top dragged back: off by', await drag('head', 45, 10), 'px;', await pose());
await shot('spine_forward');
await reset();
console.log('neck dragged back: off by', await drag('neck', 60, 12), 'px;', await pose());
console.log('neck dragged well below where the back can take it: off by', await drag('neck', 60, 200), 'px (held to its reach);', await pose());
await shot('spine_back_far');
await reset();
await front();

// Z held: the whole of her moved; X held: turned.
hip = await where('hips');
await page.keyboard.down('z');
await dragFrom(500, 300, 120, -40);
await page.keyboard.up('z');
console.log('Z held and dragged: the hips moved', cm(hip, await where('hips')), 'cm along the floor;', await pose());
hip = await where('hips');
await page.keyboard.down('x');
await dragFrom(500, 300, 90, 0);
await page.keyboard.up('x');
console.log('X held and dragged: the hips moved', cm(hip, await where('hips')), 'cm;', await pose(), '· wireframe', await page.evaluate(() => window.__mob.poser.material.wireframe));
await shot('moved_turned');
await reset();

// A lock: a hand raised and locked stays where it is while she crouches, is moved and is turned.
await drag('hand R', -70, -150);
[x, y] = await dot('hand R');
await page.keyboard.down('Shift');
await page.keyboard.down('Control');
await page.mouse.click(x, y);
await page.keyboard.up('Control');
await page.keyboard.up('Shift');
await page.waitForTimeout(200);
h0 = await where('hand R');
console.log('Ctrl-clicked hand R: locked', await page.evaluate(() => [...window.__mob.poser.locks.keys()].join(',')));
await drag('hips', 0, 90);
console.log('  hips dragged down: the hand moved', cm3(h0, await where('hand R')), 'cm; the hips dropped to', ((await where('hips'))[1] * 100).toFixed(0), 'cm');
await shot('locked_crouch');
await page.keyboard.down('z');
await dragFrom(500, 300, -50, 0);
await page.keyboard.up('z');
console.log('  moved with Z: the hand moved', cm3(h0, await where('hand R')), 'cm');
await drag('neck', 40, 10);
console.log('  the back bent: the hand moved', cm3(h0, await where('hand R')), 'cm');
await shot('locked_moved');
await page.locator('#panel button', { hasText: 'unlock all' }).click();
await reset();

// Space: the fingers' and toes' joints. A fingertip dragged closes that finger alone; a toe's tip lifts that toe.
await page.keyboard.press('Space');
await page.waitForTimeout(200);
const fz = await page.evaluate(() => window.__mob.controls.target.z);
const hand = await where('hand R');
await page.evaluate(([hx, hy, z]) => window.__view(hx + 0.05, hy - 0.05, z + 0.55, hx, hy - 0.08, z), [hand[0], hand[1] + 0.15, fz]);
await page.waitForTimeout(300);
await shot('fingers');
const tip0 = await where('index R tip');
console.log('index R tip dragged: off by', await drag('index R tip', -40, -25), 'px; the tip moved', cm3(tip0, await where('index R tip')), 'cm;', await pose());
console.log('thumb R mid dragged: off by', await drag('thumb R mid', 25, 0), 'px;', await pose());
await shot('finger_bent');
await reset();
await page.locator('#panel button', { hasText: /^Koharu, nothing on$/ }).click();
await page.waitForTimeout(400);
const foot = await where('foot R');
await page.evaluate(([fx, z]) => window.__view(fx + 0.3, 0.3, z + 0.5, fx, 0.03, z + 0.08), [foot[0], fz]);
await page.waitForTimeout(300);
await shot('toes');
const toe0 = await where('big toe R');
console.log('big toe R dragged up: off by', await drag('big toe R', 0, -25), 'px; its tip moved', cm3(toe0, await where('big toe R')), 'cm;', await pose());
console.log('toe 5 R dragged out: off by', await drag('toe 5 R', 18, 0), 'px;', await pose());
await shot('toe_bent');
await page.evaluate(() => window.__view(2.2, 0.85, window.__mob.controls.target.z - 0.5, 0, 0.8, window.__mob.controls.target.z));
await page.waitForTimeout(300);
await reset();
await shot('hip_side_rest');
await page.locator('#panel button', { hasText: /^Koharu$/ }).click();
await page.keyboard.press('Space');
await reset();
await front();

// Undo and redo.
await drag('hand L', -60, -90);
const before = await pose();
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
const undone = await pose();
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(100);
console.log('undo:', undone !== before ? 'went back' : 'DID NOTHING', '· redo:', (await pose()) === before ? 'came forward again' : 'DID NOT RETURN');

// Orbiting still works where there's no dot.
const cam = await page.evaluate(() => window.__mob.camera.position.toArray().join(','));
await dragFrom(300, 500, 80, 0);
console.log('orbit off a dot moves the camera:', cam !== (await page.evaluate(() => window.__mob.camera.position.toArray().join(','))));
await page.locator('#panel button', { hasText: /^Showroom$/ }).click();
await page.waitForTimeout(300);
await shot('showroom_tab');
await browser.close();
await server.close();
