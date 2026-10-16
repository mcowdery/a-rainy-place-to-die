// The dead hours on the MakeHuman test page (humans.html, humans/fallen.ts): every view of its street at night, the
// shades and the giant again in the studio's light (their shapes), the possessed at the wall over a few moments (the
// stutter, the heads turning), then first person: looking away and back again (the stalk), and a fight against the
// possessed and against the shades.
//   node debug-shots/deadshots.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const hud = () => page.evaluate(() => document.getElementById('hud').textContent.split('\n').slice(0, 2).join(' | '));
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
const who = () => page.evaluate(() => __humans.dead.people.map((f) => `${f.name}:${f.act}@${f.x.toFixed(1)},${f.z.toFixed(1)}${f.act === 'shade' ? ` ${f.stalk} fade ${f.fade.value.toFixed(2)}` : ''}`).join('  '));

await page.goto(`${server.resolvedUrls.local[0]}humans.html?labels=0&view=${encodeURIComponent('the dead hours')}`);
await page.waitForFunction(() => window.__humans && __humans.dead.loaded === __humans.dead.people.length, null, { timeout: 180000, polling: 250 });
await wait(2500);
console.log('loaded:', await hud());
const views = (await page.evaluate(() => __humans.items)).filter((v) => v.startsWith('the dead hours'));
for (const [i, v] of views.entries()) {
  await page.evaluate((name) => __focus(name), v);
  await wait(1500);
  await shot(`n${i}_${slug(v)}`);
}
// The possessed at the wall, a few moments apart: the camera is behind them, so their heads come round.
await page.evaluate(() => __focus('the dead hours: the possessed at the wall'));
for (let k = 0; k < 4; k++) {
  await wait(450);
  await shot(`w${k}_wall_over_time`);
}
// Their shapes, in the studio's light.
await page.keyboard.press('Digit1');
for (const v of ['the dead hours: shades', 'the dead hours: the giant', 'the dead hours, as you walk it']) {
  await page.evaluate((name) => __focus(name), v);
  await wait(1500);
  await shot(`s_${slug(v)}`);
}
await page.keyboard.press('Digit2');
await page.evaluate(() => __focus('the dead hours'));
await wait(800);
// First person: ahead, then looking back for a while (the shades come on when not seen), then ahead again.
await page.keyboard.press('KeyV');
await page.waitForFunction(() => window.__fp && __fp.rig(), null, { timeout: 60000, polling: 250 });
await wait(2500);
await shot('f0_first_person');
console.log('fp start:', await who());
for (let round = 0; round < 3; round++) {
  await page.evaluate(() => __fp.look(Math.PI, 0));
  await wait(5000);
  await page.evaluate(() => __fp.look(0, 0.05));
  await wait(150);
  await shot(`f${round + 1}_looked_back`);
  console.log(`round ${round + 1}:`, await who());
  await wait(900);
  await shot(`f${round + 1}_after_seen`);
}
console.log('hud:', await hud());
for (const set of ['possessed', 'shades']) {
  await page.evaluate((w) => __humans.enemies(w), set);
  await page.evaluate(() => { __fp.hand('fists'); __fp.spawn(3); });
  await page.waitForFunction(() => __fp.thugs().filter((t) => t.root.visible).length >= 3, null, { timeout: 60000, polling: 200 });
  await page.keyboard.press('KeyX');
  await wait(1800);
  await shot(`g_fight_${set}`);
  await page.keyboard.press('KeyX');
}
await browser.close();
await server.close();
