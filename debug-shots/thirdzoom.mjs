// The mouse wheel in third person (district, on foot): the default distance, wheeled out, wheeled in, and remembered.
//   node debug-shots/thirdzoom.mjs <out dir> [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/thirdzoom';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.addInitScript(() => { try { if (!sessionStorage.getItem('once')) { sessionStorage.setItem('once', '1'); localStorage.setItem('citypop.thirdPerson', '1'); localStorage.removeItem('citypop.thirdZoom'); } } catch {} });
const load = async () => {
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1${extra}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  // A real click captures the mouse: the wheel only zooms while it's captured.
  await page.mouse.click(640, 360);
  await page.waitForTimeout(4000);
  console.log('captured:', await page.evaluate(() => !!document.pointerLockElement));
};
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const stored = () => page.evaluate(() => localStorage.getItem('citypop.thirdZoom'));
const look = (pitchDeg) => page.evaluate((p) => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.x = (p * Math.PI) / 180;
  e.z = 0;
  cam.quaternion.setFromEuler(e);
}, pitchDeg);
await load();
await look(-8); await page.waitForTimeout(800); await shot('z1_default');
await page.mouse.wheel(0, 2000); await page.waitForTimeout(1500); await shot('z2_far');
console.log('far:', await stored());
// Looking up from far out: the camera comes in along the ground, not through it.
await look(25); await page.waitForTimeout(1200); await shot('z2b_far_look_up');
await look(-8);
await page.mouse.wheel(0, -4000); await page.waitForTimeout(1500); await shot('z3_near');
console.log('near:', await stored());
await page.mouse.wheel(0, 300); await page.waitForTimeout(1000);
console.log('left at:', await stored());
await load();
await look(-8); await page.waitForTimeout(800); await shot('z4_remembered');
await browser.close(); await server.close();
writeGallery(out);
