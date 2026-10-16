// Ride a subway leg and report errors and where it ends: node debug-shots/ridecheck.mjs from,to
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const leg = process.argv[2] ?? 'w05_station,w06_station';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}?debug=1&clock=12:00&ride=${leg}`);
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(8000);
    const s = await page.evaluate(() => ({ riding: window.__subway?.riding ?? null, pos: [Math.round(window.__camera?.position.x ?? 0), Math.round(window.__camera?.position.y ?? 0), Math.round(window.__camera?.position.z ?? 0)], hud: document.body.innerText.split('\n').find((l) => /SHIOMI|KAIGAN|汐見|海岸|Wakaba|若葉/.test(l)) ?? '' }));
    console.log(i * 8, JSON.stringify(s));
    if (s.riding && !globalThis.skipped) { globalThis.skipped = true; await page.mouse.click(640, 360); await page.keyboard.press('KeyE'); }
    if (i === 6) await page.screenshot({ path: 'debug-shots/ride_mid.png' });
    if (s.riding === false && i > 3) break;
  }
  await page.screenshot({ path: 'debug-shots/ride_end.png' });
} finally {
  await browser.close();
  await server.close();
}
