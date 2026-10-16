// The dead hours' close-ups (each shade, a possessed face) at night and in the studio's light.
//   node debug-shots/deadclose.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const wait = (ms) => page.waitForTimeout(ms);
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
await page.goto(`${server.resolvedUrls.local[0]}humans.html?labels=0&view=${encodeURIComponent('the dead hours')}`);
await page.waitForFunction(() => window.__humans && __humans.dead.loaded === __humans.dead.people.length, null, { timeout: 180000, polling: 250 });
console.log(JSON.stringify(await page.evaluate(() => __humans.dead.people.filter((f) => f.act === 'stand').map((f) => { const m = []; f.c.root.traverse((o) => o.isMesh && m.push(o.name)); return m; }))));
for (const light of ['Digit2', 'Digit1']) {
  await page.keyboard.press(light);
  for (const v of ['the dead hours: the hat man', 'the dead hours: the woman', 'the dead hours: the bare one', 'the dead hours: a possessed face']) {
    await page.evaluate((name) => __focus(name), v);
    await wait(1500);
    await page.screenshot({ path: `${out}/c_${light === 'Digit1' ? 'studio' : 'night'}_${slug(v.slice(16))}.png` });
  }
}
await browser.close();
await server.close();
