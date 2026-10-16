// The hanging coat against Mack's old one, in motion: the same clip played in real steps (the coat's simulation needs
// time to pass: a seek to a time leaves it at rest) on `mack_gen` (the skirt skinned to the thighs) and `mack_gen_coat`
// (its skirt chains simulated, models/coatPhysics.ts), photographed at the same moments from the side and the front.
//   node debug-shots/coatshots.mjs <out dir> [clips, comma separated] [moments a clip]
//   e.g. node scripts/pod.mjs run -- node debug-shots/coatshots.mjs debug-shots/coat Walk_Loop,Crouch_Idle_Loop 6
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const only = (process.argv[3] ?? 'Walk_Loop,Jog_Fwd_Loop,Crouch_Idle_Loop').split(',');
const count = Number(process.argv[4] ?? 6);
if (!out) {
  console.log('Usage: node debug-shots/coatshots.mjs <out dir> [clips] [moments a clip]');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const W = 300;
const H = 380;
const FIGURES = ['mack_gen', 'mack_gen_coat'];
const VIEWS = { side: [4.0, 1.2, 0, 0, 0.95, 0], front: [1.9, 1.35, 3.4, 0, 0.95, 0] };
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const sheetPage = await browser.newPage({ viewport: { width: 100, height: 100 } });
const pages = {};
for (const who of FIGURES) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('PAGEERROR', who, String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}anims.html?char=${who}`);
  await page.waitForFunction(() => window.__anims && window.__anims.ready, null, { timeout: 120000, polling: 250 });
  await page.evaluate(() => __anims.hide());
  pages[who] = page;
}
const frames = (page, n = 2) => page.evaluate((n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const clips = (await pages.mack_gen.evaluate(() => __anims.clips())).filter((c) => only.includes(c.name));
for (const clip of clips) {
  const shots = {};
  for (const who of FIGURES) {
    const page = pages[who];
    await page.evaluate(([w, n]) => __anims.show(w, n), [who, clip.name]);
    await page.evaluate(() => __anims.manual(true));
    const step = 1 / 30;
    const total = Math.round(clip.seconds / step);
    // two loops to settle (the coat starts at rest), then the moments of a third
    await page.evaluate(([n, s]) => { for (let i = 0; i < n; i++) __anims.tick(s); }, [total * 2, step]);
    shots[who] = { side: [], front: [] };
    for (let m = 0; m < count; m++) {
      await page.evaluate(([n, s]) => { for (let i = 0; i < n; i++) __anims.tick(s); }, [Math.max(1, Math.round(total / count)), step]);
      for (const [view, v] of Object.entries(VIEWS)) {
        await page.evaluate((v) => {
          const p = new (Object.getPrototypeOf(__anims.pelvis().position).constructor)();
          __anims.pelvis().getWorldPosition(p);
          __view(p.x + v[0], v[1], p.z + v[2], p.x + v[3], v[4], p.z + v[5]);
        }, v);
        await frames(page, 2);
        shots[who][view].push((await page.screenshot()).toString('base64'));
      }
    }
  }
  let html = `<body style="margin:0;background:#111;color:#ddd;font:12px Consolas,monospace"><table cellspacing="2" cellpadding="0"><tr><td colspan="${count}">${clip.name}: the old coat (mack_gen, rows 1 and 3) against the simulated one (mack_gen_coat, rows 2 and 4); side, then front</td></tr>`;
  for (const view of ['side', 'front']) {
    for (const who of FIGURES) html += `<tr>${shots[who][view].map((c) => `<td><img width="${W * 0.75}" height="${H * 0.75}" src="data:image/png;base64,${c}"></td>`).join('')}</tr>`;
  }
  html += '</table></body>';
  await sheetPage.setContent(html);
  await sheetPage.waitForTimeout(150);
  await (await sheetPage.$('table')).screenshot({ path: `${out}/coat_${clip.name}.png` });
  console.log(`${out}/coat_${clip.name}.png`);
}
await browser.close();
await server.close();
process.exit(0);
