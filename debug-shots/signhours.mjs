// Shops' hours on one page (real/hours.ts): the same views before and after the story clock passes closing time, so the
// signs, the shops' insides and their glow on the pavement (the lightmap, painted again: district/world.ts setHour) are
// seen to go out, and how long the repainting took.
//   node debug-shots/signhours.mjs [out dir] [sign indices, as __signs.all() lists them] [from clock] [minutes on]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/signhours';
const picks = (process.argv[3] ?? '5087,4233,5942').split(',').map(Number);
const from = process.argv[4] ?? '21:30';
const on = Number(process.argv[5] ?? 120);
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 240)); });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&fly=1&res=100&clock=${from}&weather=clear&cam=3335,6,1300,0,-10`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__signs && window.__clock && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
  });
  await page.keyboard.press('Escape');
  // (The first view waits for its chunk's full detail: the storefronts are in it.)
  let first = true;
  const shoot = async (tag) => {
    for (const i of picks) {
      await page.evaluate((i) => window.__signs.go(i), i);
      await page.waitForTimeout(first ? 20000 : 6000);
      first = false;
      const clock = await page.evaluate(() => window.__clock.now());
      console.log(tag, i, 'clock', JSON.stringify(clock));
      await page.screenshot({ path: `${out}/${String(i).padStart(4, '0')}-${tag}.png` });
    }
  };
  await shoot('before');
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__district.stats.light)));
  await page.evaluate((m) => window.__clock.advance(m), on);
  await page.waitForTimeout(8000);
  const after = await page.evaluate(() => JSON.parse(JSON.stringify(window.__district.stats.light)));
  await shoot('after');
  const report = { from, minutesOn: on, lightStage: { before, after, repainted: after.count - before.count, msMax: after.msMax, msAvg: after.count ? after.msTotal / after.count : 0 } };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
