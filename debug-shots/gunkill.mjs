// Your shots against a gunman: he's hurt when he stands up from cover and you shoot him; and brawlers come at you meanwhile (no errors).
//   node debug-shots/gunkill.mjs
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(`${server.resolvedUrls.local[0]}fight.html?hand=gun`);
await page.waitForFunction(() => window.__fp && window.__fp.rig() && window.__fp.rig().anims && window.__fp.rig().anims.clips.some((c) => c.name === 'Pistol_Aim_Neutral'), null, { timeout: 90000, polling: 250 });
await page.evaluate(() => { __fp.spawn(0); __fp.third(false); __fp.rig().armed = true; __fp.brawl().health = 99999; });
await wait(500);
await page.evaluate(() => __fp.mixed(0, 1));
// Two brawlers come at you meanwhile: say how they and the gunman are doing a few times.
const info = () => page.evaluate(() => __fp.thugs().map((t) => `${t.role} ${t.state} ${Math.round(t.health)}`).join(' | '));
await wait(1500);
console.log('start:', await info());
// Wait for the gunman to stand up to shoot, then shoot him from where you are (aimed at his chest).
await page.waitForFunction(() => __fp.gunmen().men[0] === 'peek', null, { timeout: 60000, polling: 40 });
await wait(900);
const before = await page.evaluate(() => { const t = __fp.thugs().find((t) => t.role === 'gunman'); return t.health; });
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => {
    const t = __fp.thugs().find((t) => t.role === 'gunman');
    const e = __fp.camera().position;
    const dx = t.root.position.x - e.x, dz = t.root.position.z - e.z, dy = 1.3 - e.y;
    __fp.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  });
  await wait(120);
  const fired = await page.evaluate(() => { const r = __fp.rig(); const n0 = r.shotsFired; r.fire(); return [n0, r.shotsFired, r.armed, r.draw, r.loaded]; });
  await wait(500);
  console.log(' shot', i, JSON.stringify(fired), (await page.evaluate(() => JSON.stringify(__fp.brawl().state()))).slice(0, 140));
}
const after = await page.evaluate(() => { const t = __fp.thugs().find((t) => t.role === 'gunman'); return { health: t.health, state: t.state }; });
console.log('gunman health', before, '->', after.health, `(${after.state})`);
console.log('end:', await info());
await browser.close();
await server.close();
