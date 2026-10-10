// Third person in the district: on foot (still, walking, running), with the gun out and raised, by a wall.
//   node debug-shots/citythird.mjs <out dir> [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/citythird';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' || /Mack/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); } catch {} });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(4000);
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
const tap = async (code) => { await key(code, true); await key(code, false); };
const look = (pitchDeg, yawDeg) => page.evaluate(([p, y]) => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.x = (p * Math.PI) / 180;
  if (y !== undefined) e.y = (y * Math.PI) / 180;
  e.z = 0;
  cam.quaternion.setFromEuler(e);
}, [pitchDeg, yawDeg]);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
await tap('KeyQ');
await look(-8); await page.waitForTimeout(1200); await shot('t1_still');
await look(20); await page.waitForTimeout(600); await shot('t2_look_up');
await look(-45); await page.waitForTimeout(600); await shot('t3_look_down');
await look(-8); await key('KeyW', true); await page.waitForTimeout(1200); await shot('t4_walk');
await key('ShiftLeft', true); await page.waitForTimeout(1000); await shot('t5_run');
await key('ShiftLeft', false); await key('KeyW', false); await page.waitForTimeout(800);
await tap('KeyX'); await page.waitForTimeout(900); await shot('t6_gun');
await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousedown', { button: 2 })));
await page.waitForTimeout(900); await shot('t7_aim');
await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { button: 2 })));
await tap('KeyX');
// Turned round, backing toward whatever is behind.
await look(-8, 90); await page.waitForTimeout(900); await shot('t8_turned');
await tap('KeyQ'); await page.waitForTimeout(700); await shot('t9_first_again');
await browser.close(); await server.close();
writeGallery(out);
