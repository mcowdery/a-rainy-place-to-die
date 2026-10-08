// Contact sheets of the clips proposed for the city (anims.html's "For the city" list, src/poc3d/anims/candidates.ts):
// each candidate's run of clips at several moments from the front quarter, beside Mack's rig doing what the city has
// him do today where it would replace something; and the page itself with its card, once.
//   node debug-shots/animreview.mjs <out dir> [ids, comma separated | all] [frames a candidate] [character]
//   e.g. node debug-shots/animreview.mjs debug-shots/animreview jump,seated 10
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',') : null;
const count = Number(process.argv[4] ?? 8);
const who = process.argv[5] ?? 'mack';
if (!out) {
  console.log('Usage: node debug-shots/animreview.mjs <out dir> [ids | all] [frames a candidate] [character]');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${url}anims.html?review=1&char=${who}`);
await page.waitForFunction(() => window.__anims && window.__anims.ready, null, { timeout: 120000, polling: 250 });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const settled = () => page.waitForFunction(() => __anims.settled(), null, { timeout: 120000, polling: 50 });
const candidates = (await page.evaluate(() => __anims.candidates())).filter((c) => !only || only.includes(c.id));

// The page as the user has it, on the first candidate asked for.
await page.evaluate((id) => __anims.review(id), candidates[0].id);
await settled();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/page_${candidates[0].id}.png` });
console.log(`${out}/page_${candidates[0].id}.png`);

await page.evaluate(() => { __anims.hide(); __anims.manual(true); });
const STEP = 1 / 30;
const sheetPage = await browser.newPage({ viewport: { width: 100, height: 100 } });
for (const c of candidates) {
  const beside = !!c.now || c.parts.some((p) => p.now);
  const W = beside ? 460 : 300;
  const H = 400;
  await page.setViewportSize({ width: W, height: H });
  await page.evaluate(([id, who]) => __anims.review(id, who), [c.id, who]);
  await settled();
  // (Posed in its first clip before the first picture.)
  await page.evaluate(() => __anims.tick(0));
  const length = await page.evaluate(() => __anims.length());
  const cells = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const until = (length * i) / count;
    while (t < until - 1e-6) {
      await page.evaluate((dt) => __anims.tick(dt), STEP);
      await settled();
      t += STEP;
    }
    // From the front quarter, keeping with the figure where a clip carries him off.
    await page.evaluate((beside) => {
      const p = new (Object.getPrototypeOf(__anims.pelvis().position).constructor)();
      __anims.pelvis().getWorldPosition(p);
      if (beside) __view(0.9, 1.35, 4.9, -0.75, 0.95, 0);
      else __view(p.x + 1.9, 1.35 + (p.y > 1.6 ? 0.6 : 0), p.z + 3.4, p.x, 0.95 + (p.y > 1.6 ? 0.6 : 0), p.z);
    }, beside);
    await frames(2);
    const hud = await page.evaluate(() => document.getElementById('hud').textContent.split('\n')[2] ?? '');
    cells.push({ t: until, clip: hud.split('  ')[0], png: (await page.screenshot()).toString('base64') });
  }
  let html = `<body style="margin:0;background:#111;color:#ddd;font:12px Consolas,monospace"><table cellspacing="2" cellpadding="0"><tr><td colspan="${count}">${c.id}: ${c.title} (${c.kind}, ${length.toFixed(1)} s)${beside ? '  ·  left: what he does now, right: the library' : ''}</td></tr>`;
  html += `<tr>${cells.map((x) => `<td>${x.t.toFixed(2)} s ${x.clip}</td>`).join('')}</tr>`;
  html += `<tr>${cells.map((x) => `<td><img width="${W * 0.6}" height="${H * 0.6}" src="data:image/png;base64,${x.png}"></td>`).join('')}</tr>`;
  html += '</table></body>';
  await sheetPage.setContent(html);
  await sheetPage.waitForTimeout(150);
  await (await sheetPage.$('table')).screenshot({ path: `${out}/${c.id}.png` });
  console.log(`${out}/${c.id}.png`);
}
// How fast each clip that walks covers the ground on this figure (m/s), for the candidates' notes.
const paces = await page.evaluate(async () => {
  const names = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop'];
  return Object.fromEntries(await Promise.all(names.map(async (n) => [n, (await __anims.pace(n)).toFixed(2)])));
});
console.log('pace (m/s):', JSON.stringify(paces));
await browser.close();
await server.close();
process.exit(0);
