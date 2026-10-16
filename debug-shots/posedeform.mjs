// How a posed character's skin bends at its joints (showroom/poser.ts, real/characterPose.ts): the bare body's hips
// and ankles close up through a few turns of each, from the side, behind and the front, in one sheet a joint.
//   node debug-shots/posedeform.mjs [out dir] [hips,ankles,seat,bent]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, readFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/posedeform';
const which = (process.argv[3] ?? 'hips,ankles').split(',');
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.text().startsWith('WELD')) console.log(m.text()); });
await page.goto(server.resolvedUrls.local[0] + 'characters.html?labels=0&t=3');
await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
await page.evaluate(() => window.__focus('pose'));
await page.waitForTimeout(400);
// The bare body, free of the floor (so the hips stay where they are), its dots out of the picture.
await page.evaluate((who) => { const p = window.__mob.poser; p.who = who; p.build(); p.setFree(true); p.active = false; }, Number(process.env.WHO ?? 1));
const z = await page.evaluate(() => window.__mob.controls.target.z);
const sheet = async (name, views, poses, clip, follow = false, own = false) => {
  const cells = [];
  for (const [vn, eye, at] of views) {
    // (Heights above the stage's floor.)
    await page.evaluate(([e, a, zz]) => window.__view(e[0], e[1] + 0.15, zz + e[2], a[0], a[1] + 0.15, zz + a[2]), [eye, at, z]);
    for (const [pn, pose] of poses) {
      // (Her arms up out of the way.)
      await page.evaluate(([q, own]) => { const p = window.__mob.poser; p.set(own ? q : { aL: [165, 0, 10], aR: [165, 0, 10], ...q }); p.active = false; }, [pose, own]);
      if (follow) {
        // (Looked at from about her hips, wherever the pose has taken them.)
        const h = await page.evaluate((dot) => window.__mob.poser.where(dot), follow === true ? 'hips' : follow);
        await page.evaluate(([e, a, h, zz]) => window.__view(h[0] + e[0], h[1] + e[1] + 0.15, zz + h[2] + e[2], h[0] + a[0], h[1] + a[1] + 0.15, zz + h[2] + a[2]), [eye, at, h, z]);
        await page.evaluate(() => { window.__mob.poser.active = false; });
      }
      await page.waitForTimeout(120);
      const f = `${out}/${name}_${vn}_${pn}.png`;
      await page.screenshot({ path: f, clip });
      cells.push([`${vn} · ${pn}`, f]);
    }
  }
  const html = '<body style="margin:0;background:#111;color:#ddd;font:12px Consolas,monospace"><table cellspacing="2" cellpadding="0">' +
    views.map((_, r) => '<tr>' + cells.slice(r * poses.length, (r + 1) * poses.length).map(([t, f]) => `<td><div>${t}</div><img width="300" src="data:image/png;base64,${readFileSync(f).toString('base64')}"></td>`).join('') + '</tr>').join('') + '</table></body>';
  const p2 = await browser.newPage({ viewport: { width: 100, height: 100 } });
  await p2.setContent(html);
  await p2.waitForTimeout(200);
  await (await p2.$('table')).screenshot({ path: `${out}/${name}.png` });
  await p2.close();
};
// (A pose's leg: raise, swing, knee, twist; its foot: pitch, turn, roll.)
if (which.includes('hips')) {
  await sheet('hips', [['side', [1.3, 0.75, 0], [0, 0.7, 0]], ['behind', [0, 0.75, -1.3], [0, 0.7, 0]], ['front', [0, 0.75, 1.3], [0, 0.7, 0]]], [
    ['rest', {}], ['fwd 12', { lL: [12], lR: [12] }], ['fwd 30', { lL: [30], lR: [30] }], ['fwd 90', { lL: [90, 0, 90], lR: [90, 0, 90] }], ['back 20', { lL: [-20], lR: [-20] }],
    ['out 30', { lL: [30, 90, 0, -90], lR: [30, 90, 0, -90] }], ['twist 35', { lL: [0, 0, 0, 35], lR: [0, 0, 0, 35] }],
  ], { x: 420, y: 250, width: 380, height: 400 });
}
// (Under the buttock, where it meets the thigh: from behind and to the side, and square from the side.)
if (which.includes('seat')) {
  await sheet('seat', [['quarter', [0.75, 0.82, -0.75], [0.06, 0.72, -0.02]], ['side', [1.1, 0.74, -0.05], [0, 0.72, -0.05]], ['under', [0.5, 0.45, -0.8], [0.06, 0.72, -0.04]]], [
    ['rest', {}], ['fwd 8', { lL: [8], lR: [8] }], ['fwd 18', { lL: [18], lR: [18] }], ['fwd 40', { lL: [40, 0, 20], lR: [40, 0, 20] }], ['back 10', { lL: [-10], lR: [-10] }], ['back 25', { lL: [-25], lR: [-25] }],
    ['a stride', { lL: [26, 0, 6], lR: [-18, 0, 30] }],
  ], { x: 420, y: 250, width: 380, height: 400 });
}
// (Bent over, the legs straight: from behind and above, behind, the side.)
if (which.includes('bent')) {
  await sheet('bent', [['behind above', [0.3, 0.35, -0.8], [0, 0, -0.05]], ['behind', [0, 0.05, -0.9], [0, 0, 0]], ['side', [1.0, 0.05, 0], [0, -0.05, 0]]], [
    ['40', { pitch: 40, lL: [40], lR: [40] }], ['70', { pitch: 70, lL: [70], lR: [70] }], ['90', { pitch: 90, lL: [90], lR: [90] }], ['90, feet apart', { pitch: 90, lL: [90, 14, 0, -14], lR: [90, 14, 0, -14] }],
    ['70, knees bent', { pitch: 70, lL: [95, 0, 45], lR: [95, 0, 45] }], ['back arched', { pitch: 60, lean: -15, ribLean: -15, lL: [75], lR: [75] }],
  ], { x: 380, y: 200, width: 460, height: 480 }, true);
}
// (The shoulder and armpit as an arm is raised, and a hand as it closes. An arm's list: raise, swing, elbow, twist;
// straight out to the side without rolling is raise 90, swing 90, twist 90: the twist undoes the swing's own turn.)
if (which.includes('arms')) {
  const arm = (a) => ({ aL: [3, 0, 8], aR: a });
  await sheet('arms', [['front', [0.25, 1.38, 1.0], [0.16, 1.3, 0]], ['behind', [0.25, 1.38, -1.0], [0.16, 1.3, 0]], ['above', [0.3, 2.1, 0.45], [0.16, 1.3, 0]]], [
    ['rest', arm([3, 0, 8])], ['fwd 45', arm([45, 0, 8])], ['fwd 90', arm([90, 0, 8])], ['up 160', arm([160, 0, 8])], ['out 45', arm([45, 90, 8, 90])], ['out 90', arm([90, 90, 8, 90])], ['back 40', arm([-40, 0, 8])],
  ], { x: 440, y: 230, width: 420, height: 420 }, false, true);
  // (The whole of her at rest, and her hand hanging: for her proportions.)
  // (Her right hand close, from its back, its palm's side and below, open and closing: the fingers' join to the palm.)
  await sheet('knuckles', [['back', [0.26, -0.02, 0.02], [0, -0.07, 0.02]], ['palm side', [-0.26, -0.02, 0.02], [0, -0.07, 0.02]], ['in front', [0.02, -0.03, 0.27], [0, -0.07, 0.02]], ['below', [0.06, -0.3, 0.06], [0, -0.07, 0.02]]], [
    ['open', {}], ['half closed', { gR: 0.5 }], ['fist', { gR: 1 }], ['spread', { dR: [0, -20, 0, 0, -15, 0, 0, -5, 0, 0, 8, 0, 0, 18, 0] }],
  ], { x: 400, y: 150, width: 600, height: 600 }, 'hand R', true);
  await sheet('figure', [['front', [0, 0.95, 2.7], [0, 0.82, 0]], ['side', [2.7, 0.95, 0], [0, 0.82, 0]], ['hand', [0.32, 0.8, 0.55], [0.2, 0.72, 0.02]]], [
    ['rest', {}], ['fingers half closed', { gL: 0.5, gR: 0.5 }], ['arms out', { aL: [90, 90, 8, 90], aR: [90, 90, 8, 90] }],
  ], { x: 300, y: 60, width: 800, height: 780 }, false, true);
  // (Both arms the same, from in front and behind: the two sides must match.)
  const both = (a) => ({ aL: a, aR: a });
  await sheet('both', [['front', [0, 1.3, 2.0], [0, 1.25, 0]], ['behind', [0, 1.3, -2.0], [0, 1.25, 0]]], [
    ['out 90', both([90, 90, 8, 90])], ['out 90, rolled forward', both([90, 90, 8, 0])], ['out 90, rolled back', both([90, 90, 8, 170])], ['out 45', both([45, 90, 8, 90])], ['up 150', both([150, 0, 8])],
  ], { x: 250, y: 150, width: 800, height: 520 }, false, true);
  const hand = (g, d) => ({ aL: [3, 0, 8], aR: [70, 0, 60], gR: g, ...(d ? { dR: d } : {}) });
  await page.evaluate(() => window.__mob.poser.set({ aL: [3, 0, 8], aR: [70, 0, 60] }));
  const h = await page.evaluate(() => window.__mob.poser.where('hand R'));
  const near = (e) => [[h[0] + e[0], h[1] + e[1], h[2] + e[2]], [h[0], h[1] - 0.02, h[2] + 0.06]];
  await sheet('hands', [['outside', ...near([0.3, 0.05, 0.1])], ['palm side', ...near([-0.3, 0.05, 0.12])], ['from the front', ...near([0.05, 0.12, 0.4])]], [
    ['open', hand(0)], ['half', hand(0.5)], ['fist', hand(1)], ['index out', hand([1, 0, 1, 1, 1])], ['spread', hand(0, [0, -20, 0, 0, -15, 0, 0, 0, 0, 0, 12, 0, 0, 25, 0])],
  ], { x: 440, y: 230, width: 420, height: 420 }, false, true);
}
if (which.includes('ankles')) {
  await sheet('ankles', [['side', [0.75, 0.12, 0.03], [0, 0.09, 0.03]], ['behind', [0.25, 0.14, -0.7], [0, 0.09, 0.03]], ['front', [0.25, 0.2, 0.75], [0, 0.09, 0.03]]], [
    ['rest', {}], ['down 25', { fL: [25], fR: [25] }], ['down 50', { fL: [50], fR: [50] }], ['up 25', { fL: [-25], fR: [-25] }], ['up 40', { fL: [-40], fR: [-40] }],
    ['roll 20', { fL: [0, 0, 20], fR: [0, 0, 20] }], ['turn 30', { fL: [0, 30], fR: [0, 30] }],
  ], { x: 420, y: 330, width: 380, height: 300 });
}
await browser.close();
await server.close();
