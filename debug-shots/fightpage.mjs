// The fight page (fight.html) itself: as it opens (first person, the panel), fists up against a group, a duel at
// night, and the yard from the orbiting view; then the showroom's first person, which no longer fights.
//   node debug-shots/fightpage.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const hud = () => page.evaluate(() => document.getElementById('hud').textContent);
const panelOn = () => page.evaluate(() => [...document.querySelectorAll('#panel button.on')].map((b) => b.textContent).join(' | '));

await page.goto(`${server.resolvedUrls.local[0]}fight.html`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await wait(1500);
await shot('1_open');
console.log('open:', await hud(), '\npanel on:', await panelOn());
// A jump (Space): how high the eyes go.
const eyeY = () => page.evaluate(() => __fp.camera().position.y);
const stood = await eyeY();
await page.keyboard.press('Space');
let peak = stood;
for (let i = 0; i < 12; i++) { await wait(60); peak = Math.max(peak, await eyeY()); }
await wait(600);
console.log('jump: eyes', stood.toFixed(2), 'peak', peak.toFixed(2), 'landed', (await eyeY()).toFixed(2));
// Fists (the key): a group comes on.
await page.keyboard.press('Digit2');
await page.waitForFunction(() => __fp.thugs().filter((t) => t.root.visible).length >= 4, null, { timeout: 60000, polling: 200 });
await page.keyboard.press('KeyX');
await wait(1200);
await shot('2_fists_group');
console.log('fists:', (await hud()).split('\n')[0], '\npanel on:', await panelOn());
// V: out to the orbiting view (the fight paused), and V again back in.
await page.keyboard.press('KeyV');
await wait(600);
await shot('3_orbit');
console.log('orbit:', await hud());
await page.keyboard.press('KeyV');
await wait(400);
console.log('back in:', (await hud()).split('\n')[0]);
// The panel: a duel, at night.
await page.locator('#panel button', { hasText: 'katana' }).click();
await page.locator('#panel button', { hasText: 'a duel' }).click();
await page.locator('#panel button', { hasText: 'night' }).click();
await page.waitForFunction(() => __fp.thugs().some((t) => t.tier === 'elite' && t.root.visible), null, { timeout: 60000, polling: 200 });
await wait(1500);
await shot('4_duel_night');
console.log('duel:', (await hud()).split('\n')[0], '\npanel on:', await panelOn());
// Third person from the panel, nobody about, day.
await page.locator('#panel button', { hasText: 'nobody' }).click();
await page.locator('#panel button', { hasText: 'first person (Q)' }).click();
await page.locator('#panel button', { hasText: 'day' }).click();
await wait(800);
await shot('5_third_day');
console.log('state:', JSON.stringify(await page.evaluate(() => ({ standing: __fp.brawl().standing, visible: __fp.thugs().filter((t) => t.root.visible).length }))));

// The showroom's first person: Mack and his guns, and none of the fight's keys.
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await wait(1500);
await page.keyboard.press('Digit2');
await page.keyboard.press('KeyT');
await wait(800);
await shot('6_showroom_fp');
console.log('showroom:', (await hud()).split('\n')[0]);
console.log('showroom __fp fight calls:', JSON.stringify(await page.evaluate(() => ['hand', 'spawn', 'brawl', 'thugs'].filter((k) => k in __fp))), 'melee:', await page.evaluate(() => __fp.rig().melee));
await browser.close(); await server.close();
