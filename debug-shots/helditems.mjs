// The umbrella and the flashlight in Mack's hand (models/heldItem.ts), first person and third, dry and in the rain.
//   node debug-shots/helditems.mjs <out dir> [hold-ms]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const hold = Number(process.argv[3] ?? 1400);
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [tag, query] of [['dry', 'time=day&weather=clear'], ['rain', 'time=night&weather=rain']]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
  await page.addInitScript((o) => { try { localStorage.setItem('rainyplace.wardrobe', JSON.stringify({ outfit: o })); } catch {} }, process.argv[4] ?? 'detective');
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&${query}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(4000);
  const tap = async (code) => { await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), code); await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c })), code); };
  const look = (pitchDeg) => page.evaluate((p) => {
    const cam = window.__camera;
    const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
    e.x = (p * Math.PI) / 180;
    e.z = 0;
    cam.quaternion.setFromEuler(e);
  }, pitchDeg);
  const shot = (n) => page.screenshot({ path: `${out}/${tag}_${n}.png` });
  await tap('Escape'); await page.waitForTimeout(1500);
  await look(-5);
  for (const [slot, name] of [['Digit2', 'torch'], ['Digit1', 'umbrella']]) {
    await tap(slot);
    await page.waitForTimeout(hold * 0.5); await shot(`${name}_fp_mid`);
    await page.waitForTimeout(hold); await shot(`${name}_fp`);
    await look(30); await page.waitForTimeout(500); await shot(`${name}_fp_up`); await look(12); await page.waitForTimeout(400); await shot(`${name}_fp_up2`);
    await look(-35); await page.waitForTimeout(500); await shot(`${name}_fp_down`); await look(-5);
    await tap('KeyQ'); await page.waitForTimeout(900); await shot(`${name}_third`);
    for (const [deg, tagn] of [[90, 'side'], [90, 'front'], [90, 'side2']]) {
      await page.evaluate((d) => { const cam = window.__camera; const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ'); e.y += (d * Math.PI) / 180; cam.quaternion.setFromEuler(e); }, deg);
      await page.waitForTimeout(900); await shot(`${name}_third_${tagn}`);
    }
    // Walking, seen from the side he walks past (the camera turns freely round him).
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));
    await page.waitForTimeout(1100); await shot(`${name}_third_walk`);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })));
    await page.waitForTimeout(400);
    await tap('KeyQ'); await page.waitForTimeout(500);
    await tap(slot); await page.waitForTimeout(800);
  }
  await page.close();
}
await browser.close(); await server.close();
