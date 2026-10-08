// Contact sheets of the animation library's clips on one of the cast (anims.html): each clip held at several
// points along its length and photographed from the front quarter and from the side, one sheet a clip. For judging
// a clip, and how well it fits that body, as stills.
//   node debug-shots/animsheet.mjs <out dir> [character] [clips, comma separated | all] [frames a clip] [a take's .glb]
//   e.g. node debug-shots/animsheet.mjs debug-shots/anims salaryman Walk_Loop,Idle_Talking_Loop 8
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const who = process.argv[3] ?? 'salaryman';
const only = process.argv[4] && process.argv[4] !== 'all' ? process.argv[4].split(',') : null;
const count = Number(process.argv[5] ?? 8);
if (!out) {
  console.log('Usage: node debug-shots/animsheet.mjs <out dir> [character] [clips | all] [frames a clip]');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const W = 300;
const H = 380;
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
// A take that isn't in the library (a .glb under this folder, e.g. debug-shots/mocap/wave.glb) joins the page's list.
// (Given from the repository's root, no leading slash: Git Bash turns an argument that starts with one into a Windows path.)
const extra = process.argv[6] ? `&extra=${encodeURIComponent(`/${process.argv[6].replace(/\\/g, '/').replace(/^.*?(?=(debug-shots|assets)\/)/, '')}`)}` : '';
// FIGURE=<a .glb> in the environment: a figure that isn't one of the cast (scripts/blender/rig_figure.py's), as the character `figure`.
const figure = process.env.FIGURE ? `&figure=${encodeURIComponent(`/${process.env.FIGURE.replace(/\\/g, '/').replace(/^.*?(?=(debug-shots|assets)\/)/, '')}`)}` : '';
await page.goto(`${server.resolvedUrls.local[0]}anims.html?char=${who}${extra}${figure}`);
await page.waitForFunction(() => window.__anims && window.__anims.ready, null, { timeout: 120000, polling: 250 });
await page.evaluate(() => __anims.hide());
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const clips = (await page.evaluate(() => __anims.clips())).filter((c) => !only || only.includes(c.name));
// From the figure's hips (x, y, z, then what's looked at): the front quarter, and square on from his left.
const VIEWS = { front: [1.9, 1.35, 3.4, 0, 0.95, 0], side: [4.0, 1.2, 0, 0, 0.95, 0] };
const sheetPage = await browser.newPage({ viewport: { width: 100, height: 100 } });
for (const clip of clips) {
  await page.evaluate(([who, name]) => __anims.show(who, name), [who, clip.name]);
  const rows = { front: [], side: [] };
  const times = Array.from({ length: count }, (_, i) => (clip.seconds * i) / (clip.loop ? count : count - 1));
  for (const t of times) {
    await page.evaluate((t) => __anims.seek(t), t);
    await frames(2);
    for (const [view, v] of Object.entries(VIEWS)) {
      // The views follow the hips over the floor, so a clip that travels stays in frame.
      await page.evaluate((v) => {
        const p = new (Object.getPrototypeOf(__anims.pelvis().position).constructor)();
        __anims.pelvis().getWorldPosition(p);
        __view(p.x + v[0], v[1], p.z + v[2], p.x + v[3], v[4], p.z + v[5]);
      }, v);
      await frames(2);
      rows[view].push((await page.screenshot()).toString('base64'));
    }
  }
  let html = `<body style="margin:0;background:#111;color:#ddd;font:12px Consolas,monospace"><table cellspacing="2" cellpadding="0"><tr><td colspan="${count}">${who}: ${clip.name} (${clip.pack}, ${clip.seconds.toFixed(2)} s)</td></tr>`;
  html += `<tr>${times.map((t) => `<td>${t.toFixed(2)} s</td>`).join('')}</tr>`;
  for (const view of Object.keys(VIEWS)) html += `<tr>${rows[view].map((c) => `<td><img width="${W * 0.75}" height="${H * 0.75}" src="data:image/png;base64,${c}"></td>`).join('')}</tr>`;
  html += '</table></body>';
  await sheetPage.setContent(html);
  await sheetPage.waitForTimeout(150);
  await (await sheetPage.$('table')).screenshot({ path: `${out}/${who}_${clip.name}.png` });
  console.log(`${out}/${who}_${clip.name}.png`);
}
await browser.close();
await server.close();
process.exit(0);
