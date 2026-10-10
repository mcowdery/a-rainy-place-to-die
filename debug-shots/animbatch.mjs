// The animation batch page (animbatch.html) as the user has it: a page of each group asked for, and one figure
// looked at alone. (It doesn't mark or note anything: that would write the user's file.)
//   node debug-shots/animbatch.mjs <out dir> [groups, comma separated] [who]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/animbatch';
const groups = (process.argv[3] ?? 'Standing,Walking').split(',');
const who = process.argv[4] ?? 'mack';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}animbatch.html?who=${who}`, { timeout: 240000 });
await page.waitForFunction(() => window.__batch && window.__batch.ready, null, { timeout: 240000, polling: 250 });
for (const g of groups) {
  await page.evaluate((g) => __batch.go(g, 0), g);
  await page.waitForTimeout(1200);
  const file = `${out}/${g.replace(/\W+/g, '_')}.png`;
  await page.screenshot({ path: file });
  console.log(file, '|', (await page.evaluate(() => __batch.names())).filter(Boolean).length, 'clips on the page |', await page.evaluate(() => document.querySelector('#bar em').textContent));
}
await page.evaluate(() => __batch.focus(1));
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/one_alone.png` });
const t0 = Date.now();
const n = await page.evaluate(() => new Promise((res) => { let k = 0; const f = () => (++k >= 60 ? res(k) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
console.log(`one alone: ${out}/one_alone.png | ${Math.round((n * 1000) / (Date.now() - t0))} frames a second headless`);
await browser.close();
await server.close();
process.exit(0);
