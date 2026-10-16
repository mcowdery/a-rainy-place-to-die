// The dead hours coming for you (humans.html, humans/fallen.ts): first person on its street near the possessed in
// the road (they stare, then come on as the fight's fighters), what they do to your health, then near the giant (a
// duel), printing who's fighting, your health and the HUD as it goes.
//   node debug-shots/deadfight.mjs <out dir>
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
const state = () => page.evaluate(() => {
  const b = __fp.brawl();
  const t = b.thugs.filter((x) => x.root.visible).map((x) => `${x.name}${x.tier === 'elite' ? '*' : ''}:${x.state}:${Math.round(x.health)}`);
  return `health ${Math.round(b.health)} · ${t.length} fighting [${t.join(' ')}] · ${document.getElementById('hud').textContent.split('\n').slice(1, 3).join(' | ').slice(-220)}`;
});

await page.goto(`${server.resolvedUrls.local[0]}humans.html?labels=0&view=${encodeURIComponent('the dead hours')}`);
await page.waitForFunction(() => window.__humans && __humans.dead.loaded === __humans.dead.people.length, null, { timeout: 180000, polling: 250 });
await wait(1000);
await page.keyboard.press('KeyV');
await page.waitForFunction(() => window.__fp && __fp.rig(), null, { timeout: 60000, polling: 250 });
await page.evaluate(() => __fp.look(0.35, -0.05));
await wait(400);
await shot('a0_stare');
console.log('0.4 s:', await state());
await wait(1600);
await shot('a1_coming');
console.log('2 s:', await state());
await page.evaluate(() => __fp.hand('fists'));
await page.keyboard.press('KeyX');
await wait(3000);
await shot('a2_on_you');
console.log('5 s:', await state());
await page.keyboard.press('Digit3');
await wait(4000);
await shot('a3_katana');
console.log('9 s:', await state());
// Gone down, the street starts over: everyone home, nobody fighting.
await wait(3500);
console.log('after going down:', await state());
// Out, and in again over at the giant's end of the street.
await page.keyboard.press('KeyV');
await wait(500);
await page.evaluate(() => __focus('the dead hours'));
await page.keyboard.press('KeyV');
await page.waitForFunction(() => window.__fp && __fp.rig(), null, { timeout: 60000, polling: 250 });
await page.evaluate(() => __fp.enter(-11, 41.5, Math.PI / 2));
await wait(2500);
await shot('b0_giant');
console.log('giant 2.5 s:', await state());
await wait(3000);
await shot('b1_giant_on_you');
console.log('giant 5.5 s:', await state());
await browser.close();
await server.close();
