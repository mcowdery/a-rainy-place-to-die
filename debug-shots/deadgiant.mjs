// The dead hours' giant alone (the possessed held back): first person near him, what his blows do over ten seconds.
//   node debug-shots/deadgiant.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(`${server.resolvedUrls.local[0]}humans.html?labels=0&view=${encodeURIComponent('the dead hours')}`);
await page.waitForFunction(() => window.__humans && __humans.dead.loaded === __humans.dead.people.length, null, { timeout: 180000, polling: 250 });
await page.evaluate(() => __humans.dead.people.forEach((f) => { if (f.act !== 'giant') f.joined = true; }));
await page.keyboard.press('KeyV');
await page.waitForFunction(() => window.__fp && __fp.rig(), null, { timeout: 60000, polling: 250 });
await page.evaluate(() => __fp.enter(-11, 41.5, Math.PI / 2));
let last = '';
for (let i = 0; i < 20; i++) {
  await wait(500);
  const s = await page.evaluate(() => { const b = __fp.brawl(); const g = b.thugs.find((t) => t.tier === 'elite'); return `${(b.health | 0)} ${b.lastHit} | giant ${g ? `${g.state} ${g.tell > 0 ? 'tell' : ''}${g.melee.move ? g.melee.move.id : ''} at ${g.root.position.distanceTo(__fp.camera().position).toFixed(1)} m` : 'not yet'}`; });
  if (s !== last) console.log(`${((i + 1) / 2).toFixed(1)} s: ${s}`);
  last = s;
  if (i === 7) await page.screenshot({ path: `${out}/g_giant_alone.png` });
}
await browser.close();
await server.close();
