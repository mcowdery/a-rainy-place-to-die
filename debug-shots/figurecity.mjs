// A figure under trial in the city (./?figure=..., district/trialFigure.ts): is it loaded and walking,
// and pictures of it crossing in front of where you stand, a few moments apart.
//   node debug-shots/figurecity.mjs <out dir> <the figure's .glb, from the repository's root> [time: day|dusk|night] [shots: 4]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const file = process.argv[3];
const time = process.argv[4] ?? 'day';
const count = Number(process.argv[5] ?? 4);
if (!out || !file) {
  console.log('Usage: node debug-shots/figurecity.mjs <out dir> <the figure\'s .glb> [day|dusk|night] [shots]');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|GPU stall|WebGL/.test(m.text())) console.log('ERROR', m.text().slice(0, 300)); });
const figure = encodeURIComponent(`/${file.replace(/\\/g, '/').replace(/^.*?(?=(debug-shots|assets)\/)/, '')}`);
await page.goto(`${server.resolvedUrls.local[0]}?diag=1&time=${time}&weather=clear&figure=${figure}${process.env.CAM ? `&cam=${process.env.CAM}` : ''}`, { timeout: 240000 });
await page.waitForFunction(() => document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
// (She is in the scene once her file and her walk have loaded.)
const there = await page.waitForFunction(() => window.__scene?.getObjectByName('character:figure'), null, { timeout: 60000, polling: 500 }).then(() => true, () => false);
console.log('in the scene:', there);
for (let i = 0; i < count; i++) {
  await page.waitForTimeout(i === 0 ? 1500 : 2200);
  const at = await page.evaluate(() => { const f = window.__scene.getObjectByName('character:figure'); const c = window.__camera.position; return f ? { x: +f.position.x.toFixed(1), y: +f.position.y.toFixed(2), z: +f.position.z.toFixed(1), away: +Math.hypot(f.position.x - c.x, f.position.z - c.z).toFixed(1) } : null; });
  await page.screenshot({ path: `${out}/${time}_${i}.png` });
  console.log(`${out}/${time}_${i}.png`, JSON.stringify(at));
}
await browser.close();
await server.close();
process.exit(0);
