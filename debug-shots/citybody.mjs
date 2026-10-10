// Mack's body in the district: looking down standing, walking, running, with the shotgun out, and from outside.
//   node debug-shots/citybody.mjs <out dir> [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' || /Mack/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(4000);
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
const look = (pitchDeg) => page.evaluate((p) => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.x = (p * Math.PI) / 180;
  e.z = 0;
  cam.quaternion.setFromEuler(e);
}, pitchDeg);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
await look(-82); await page.waitForTimeout(800); await shot("c1_down");
await look(-10); await page.waitForTimeout(400); await shot('c2_ahead');
await key("KeyW", true); await look(-80); await page.waitForTimeout(1200); await shot('c3_walk_down');
await key('ShiftLeft', true); await page.waitForTimeout(1000); await shot('c4_run_down');
await key('ShiftLeft', false); await key('KeyW', false); await page.waitForTimeout(600);
await key('KeyX', true); await key('KeyX', false); await look(-5); await page.waitForTimeout(900); await shot('c5_gun');
await look(-78); await page.waitForTimeout(600); await shot("c6_gun_down");
console.log(await page.evaluate(() => {
  const r = window.__scene.children.find((o) => o.name === 'first-person');
  return r ? `body in scene, visible ${r.visible}` : 'no body in scene';
}));
await browser.close(); await server.close();
