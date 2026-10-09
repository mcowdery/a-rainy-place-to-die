// The MakeHuman test page (humans.html): the street and each line-up as built (textured), the same converted for the
// mob's material in its colours and all black, then first person on the street against a group drawn from the crowd.
//   node debug-shots/humanshots.mjs <out dir> [query, e.g. "light=night&crowd=30"] [only the views matching this, e.g. "made by hand|: face"]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const hud = () => page.evaluate(() => document.getElementById('hud').textContent.split('\n').slice(0, 2).join(' | '));
const loaded = () => page.waitForFunction(() => window.__humans && __humans.waiting() === 0, null, { timeout: 180000, polling: 250 });
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();

const t0 = Date.now();
await page.goto(`${server.resolvedUrls.local[0]}humans.html?labels=1${extra}`);
await loaded();
console.log(`the street loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await wait(2500);
const views = (await page.evaluate(() => __humans.items)).filter((v) => !only || only.test(v));
console.log('views:', views.join(' · '));
// As built: every view.
for (const [i, v] of views.entries()) {
  await page.evaluate((name) => __focus(name), v);
  await loaded();
  await wait(1200);
  await shot(`a${String(i).padStart(2, '0')}_${slug(v)}`);
  console.log(v, '->', await hud());
}
if (only) {
  await browser.close(); await server.close();
  process.exit(0);
}
// Converted, in the mob's colours and all black: the street and the first line-up of the crowd.
for (const look of ['mob', 'black']) {
  await page.evaluate((l) => __humans.look(l), look);
  await page.waitForFunction(() => __humans.converted(), null, { timeout: 120000, polling: 250 });
  for (const v of views.filter((n) => n === 'the street' || n.startsWith('women (') || n.startsWith('body types'))) {
    await page.evaluate((name) => __focus(name), v);
    await wait(1500);
    await shot(`${look}_${slug(v)}`);
    console.log(look, v, '->', await hud());
  }
}
// As Mack on the street, as built: looking along it, then fists up against four of the men, then the women.
await page.evaluate(() => __humans.look('original'));
await page.keyboard.press('KeyV');
await page.waitForFunction(() => window.__fp && __fp.rig(), null, { timeout: 60000, polling: 250 });
await wait(2500);
await shot('f1_first_person');
for (const who of ['men', 'women']) {
  await page.evaluate((w) => __humans.enemies(w), who);
  await page.evaluate(() => { __fp.hand('fists'); __fp.spawn(4); });
  await page.waitForFunction(() => __fp.thugs().filter((t) => t.root.visible).length >= 4, null, { timeout: 60000, polling: 200 });
  await page.keyboard.press('KeyX');
  await wait(1600);
  await shot(`f2_fists_${who}`);
  console.log(who, '->', (await page.evaluate(() => document.getElementById('hud').textContent)).split('\n').slice(2, 3).join(''), JSON.stringify(await page.evaluate(() => __fp.thugs().filter((t) => t.root.visible).map((t) => t.model.children[0]?.name ?? t.model.name))));
  await page.keyboard.press('KeyX');
}
await browser.close(); await server.close();
