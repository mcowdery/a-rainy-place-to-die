// Mack standing at rest with his hands free (and walking, and running): the whole of him from four sides and each
// hand up close. node debug-shots/restpose.mjs <outdir> [outfit]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/restpose';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`, { timeout: 240000 });
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 120000, polling: 250 });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; __fp.armed(false); __fp.look(0, 0); __fp.third(true); });
if (process.argv[3]) await page.evaluate((o) => __fp.wear(o), process.argv[3]);
await page.waitForFunction(() => __fp.rig() && __fp.rig().smoking.free, null, { timeout: 60000, polling: 100 });
await page.waitForTimeout(1200);
let n = 0;
// Views round him, held still: [name, from (right, up from the floor, ahead of him), at (the same)].
const shoot = async (tag) => {
  await page.evaluate(() => __fp.freeze(true));
  const info = await page.evaluate(() => {
    const r = __fp.rig();
    const b = r.body.position;
    const cam = __fp.camera();
    const f = new cam.position.constructor();
    cam.getWorldDirection(f);
    const p = (o) => { const v = new cam.position.constructor(); o.getWorldPosition(v); return [v.x, v.y, v.z]; };
    return { b: [b.x, b.y, b.z], hl: p(r.arms.l.hand), hr: p(r.arms.r.hand), sl: p(r.arms.l.upper), sr: p(r.arms.r.upper), el: p(r.arms.l.lower), er: p(r.arms.r.lower), ml: p(r.arms.l.fingers[1][2]), mr: p(r.arms.r.fingers[1][2]) };
  });
  // (He faces -z with the view at yaw 0: his right is +x.)
  const [bx, by, bz] = info.b;
  const view = async (name, from, at) => {
    await page.evaluate(([f, a]) => __view(f[0], f[1], f[2], a[0], a[1], a[2]), [from, at]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_${tag}_${name}.png` });
  };
  await view('front', [bx, by + 1.2, bz - 2.6], [bx, by + 1.0, bz]);
  await view('right_side', [bx + 2.6, by + 1.2, bz], [bx, by + 1.0, bz]);
  await view('left_side', [bx - 2.6, by + 1.2, bz], [bx, by + 1.0, bz]);
  await view('back', [bx, by + 1.2, bz + 2.6], [bx, by + 1.0, bz]);
  for (const [s, h] of [['right', info.hr], ['left', info.hl]]) {
    const out = s === 'right' ? 1 : -1;
    await view(`${s}_hand_front`, [h[0] + 0.05 * out, h[1] + 0.05, h[2] - 0.55], [h[0], h[1] - 0.05, h[2]]);
    await view(`${s}_hand_side`, [h[0] + 0.55 * out, h[1] + 0.05, h[2] - 0.05], [h[0], h[1] - 0.05, h[2]]);
    await view(`${s}_hand_back`, [h[0] + 0.05 * out, h[1] + 0.05, h[2] + 0.55], [h[0], h[1] - 0.05, h[2]]);
  }
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(3);
  const rel = (a) => [(a[0] - bx).toFixed(3), (a[1] - by).toFixed(3), (-(a[2] - bz)).toFixed(3)];
  console.log(tag, 'right: shoulder', rel(info.sr), 'elbow', rel(info.er), 'wrist', rel(info.hr), 'fingertip joint', rel(info.mr), '| upper', d(info.sr, info.er), 'fore', d(info.er, info.hr), 'shoulder-wrist', d(info.sr, info.hr));
  console.log(tag, 'left:  shoulder', rel(info.sl), 'elbow', rel(info.el), 'wrist', rel(info.hl), 'fingertip joint', rel(info.ml));
  await page.evaluate(() => __fp.freeze(false));
};
const done = async () => {
  await browser.close();
  await server.close();
  writeGallery(out);
  process.exit(0);
};
if (process.argv[4] === 'gait') {
  // His stride, frozen at eight points of it, from the side and from in front: his walk (the city's default pace)
  // and his run (Shift). (The pace is set by hand: __fp.pace; the body is held still and the stride stepped.)
  for (const [name, v] of [['walk', 1.5], ['run', 4.2]]) {
    await page.evaluate((v) => __fp.pace(v), v);
    await page.waitForTimeout(1500);
    const feet = await page.evaluate(() => { const r = __fp.rig(); const V = __fp.camera().position.constructor; const a = new V(), b = new V(); r.legs.l.hand.getWorldPosition(a); r.legs.r.hand.getWorldPosition(b); return +Math.abs(a.x - b.x).toFixed(3); });
    console.log(name, 'ankles apart (m, across) at this instant', feet);
    for (let i = 0; i < 8; i++) {
      await page.evaluate((ph) => __fp.stridePhase(ph), (i / 8) * Math.PI * 2);
      await page.waitForTimeout(140);
      await page.evaluate(() => __fp.freeze(true));
      const b = await page.evaluate(() => { const r = __fp.rig(); const p = r.body.position; return [p.x, p.y, p.z]; });
      for (const [view, from] of [['side', [b[0] + 3.0, b[1] + 0.95, b[2]]], ['front', [b[0], b[1] + 0.95, b[2] - 3.0]]]) {
        await page.evaluate(([f, a]) => __view(f[0], f[1], f[2], a[0], a[1], a[2]), [from, [b[0], b[1] + 0.9, b[2]]]);
        await page.waitForTimeout(160);
        await page.screenshot({ path: `${out}/${name}_${view}_${i}.png`, clip: { x: 440, y: 150, width: 400, height: 520 } });
      }
      await page.evaluate(() => __fp.freeze(false));
    }
  }
  await page.evaluate(() => { __fp.pace(null); __fp.stridePhase(null); });
  await done();
}
if (process.argv[4] === 'jump') {
  // A jump, held at points of it: leaving the ground, rising, the top, coming down, and the landing.
  for (const [name, air, v, wait] of [['1_leaving', 0.05, 4.2, 200], ['2_rising', 0.45, 2.6, 250], ['3_top', 0.8, 0, 300], ['4_falling', 0.4, -3, 250], ['5_about_to_land', 0.05, -4.3, 200]]) {
    await page.evaluate(([a, v]) => __fp.air(a, v), [air, v]);
    await page.waitForTimeout(wait);
    await page.evaluate(() => __fp.freeze(true));
    const b = await page.evaluate(() => { const r = __fp.rig(); const p = r.body.position; return [p.x, p.y, p.z]; });
    for (const [view, from] of [['side', [b[0] + 3.2, b[1] + 0.8, b[2]]], ['front', [b[0], b[1] + 0.8, b[2] - 3.2]]]) {
      await page.evaluate(([f, a]) => __view(f[0], f[1], f[2], a[0], a[1], a[2]), [from, [b[0], b[1] + 0.8, b[2]]]);
      await page.waitForTimeout(160);
      await page.screenshot({ path: `${out}/jump_${name}_${view}.png`, clip: { x: 440, y: 100, width: 400, height: 560 } });
    }
    await page.evaluate(() => __fp.freeze(false));
  }
  // Landing: the knees give, then he's up.
  await page.evaluate(() => __fp.air(0, 0));
  for (const [name, ms] of [['6_landed', 90], ['7_recovering', 160], ['8_up', 600]]) {
    await page.waitForTimeout(ms);
    await page.evaluate(() => __fp.freeze(true));
    const b = await page.evaluate(() => { const r = __fp.rig(); const p = r.body.position; return [p.x, p.y, p.z, +r.eyeDrop.toFixed(3)]; });
    console.log(name, 'body y', b[1].toFixed(3), 'eye drop', b[3]);
    await page.evaluate(([f, a]) => __view(f[0], f[1], f[2], a[0], a[1], a[2]), [[b[0] + 3.2, b[1] + 0.8, b[2]], [b[0], b[1] + 0.8, b[2]]]);
    await page.waitForTimeout(160);
    await page.screenshot({ path: `${out}/jump_${name}_side.png`, clip: { x: 440, y: 100, width: 400, height: 560 } });
    await page.evaluate(() => __fp.freeze(false));
  }
  await done();
}
if (process.argv[4] === 'squat') {
  // Down on his heels: empty-handed, then with a cigarette (low across the knee, and up at his mouth); from his eyes.
  await page.evaluate(() => __fp.squat(true));
  await page.waitForTimeout(1500);
  console.log('eye drop', await page.evaluate(() => +__fp.rig().eyeDrop.toFixed(3)), 'camera y', await page.evaluate(() => +__fp.camera().position.y.toFixed(3)));
  await shoot('squat');
  await page.evaluate(() => { __fp.third(false); __fp.look(0, -0.5); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_squat_from_his_eyes.png` });
  await page.evaluate(() => { __fp.third(true); __fp.look(0, 0); __fp.smoke('cigarette'); });
  await page.waitForFunction(() => __fp.rig().smoking.held === 'hand' && __fp.rig().smoking.stage === 'lit' && __fp.rig().smoking.oursR < 0.01, null, { timeout: 30000, polling: 50 });
  await page.waitForTimeout(900);
  await shoot('squat_smoke_low');
  await page.evaluate(() => { __fp.rig().smoking.wait = 0.02; });
  await page.waitForFunction(() => __fp.rig().smoking.lift > 0.995, null, { timeout: 30000, polling: 16 });
  await shoot('squat_smoke_mouth');
  await page.evaluate(() => __fp.walk(true));
  await page.waitForTimeout(900);
  console.log('up again: squatting', await page.evaluate(() => __fp.rig().squatting), 'eye drop', await page.evaluate(() => +__fp.rig().eyeDrop.toFixed(3)));
  await done();
}
if (process.argv[4] === 'free') {
  // Third person, the camera free: standing, the view turned round him; then walking toward the camera, and across it.
  const snap = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_free_${name}.png` }); };
  const yaw = () => page.evaluate(() => +__fp.rig().body.rotation.y.toFixed(2));
  await snap('behind');
  console.log('standing, view 0: body', await yaw());
  await page.evaluate(() => __fp.look(1.6, -0.05));
  await page.waitForTimeout(600);
  await snap('view_turned_to_his_side');
  console.log('view 1.6: body', await yaw());
  await page.evaluate(() => __fp.look(3.1, -0.05));
  await page.waitForTimeout(600);
  await snap('view_turned_to_his_front');
  console.log('view 3.1: body', await yaw());
  await page.evaluate(() => __fp.key('KeyS', true));
  await page.waitForTimeout(1200);
  await snap('walking_toward_the_camera');
  console.log('walking back along the view 3.1: body', await yaw());
  await page.evaluate(() => { __fp.key('KeyS', false); __fp.key('KeyD', true); });
  await page.waitForTimeout(1200);
  await snap('walking_across');
  console.log('walking to the view right: body', await yaw());
  await page.evaluate(() => { __fp.key('KeyD', false); __fp.armed(true); });
  await page.waitForTimeout(900);
  await snap('gun_out_not_raised');
  console.log('gun out: body', await yaw());
  await page.evaluate(() => __fp.aim(true));
  await page.waitForTimeout(900);
  await snap('gun_raised_turns_to_the_view');
  console.log('gun raised: body', await yaw());
  await done();
}
if (process.argv[4] === 'smoke') {
  // With a cigarette lit: held low, then up at his mouth on a drag.
  await page.evaluate(() => __fp.smoke('cigarette'));
  await page.waitForFunction(() => __fp.rig().smoking.held === 'hand' && __fp.rig().smoking.stage === 'lit' && __fp.rig().smoking.oursR < 0.01, null, { timeout: 30000, polling: 50 });
  await page.waitForTimeout(900);
  await shoot('smoke_low');
  await page.evaluate(() => { __fp.rig().smoking.wait = 0.02; });
  await page.waitForFunction(() => __fp.rig().smoking.lift > 0.995, null, { timeout: 30000, polling: 16 });
  await shoot('smoke_mouth');
  await page.evaluate(() => __fp.walk(true));
  await page.waitForTimeout(5200);
  await shoot('smoke_walk');
  await browser.close();
  await server.close();
  writeGallery(out);
  process.exit(0);
}
await shoot('stand');
await page.evaluate(() => __fp.walk(true));
await page.waitForTimeout(1300);
await shoot('walk');
await page.evaluate(() => __fp.run(true));
await page.waitForTimeout(1300);
await shoot('run');
await browser.close();
await server.close();
writeGallery(out);
