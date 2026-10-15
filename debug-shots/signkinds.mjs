// The proposed sign kinds (real/signKinds.ts) on their street in the buildings showroom (models-buildings.html, Signs
// (proposed)), at night and by day.
//   node debug-shots/signkinds.mjs [out dir] [night|day|both] [views, e.g. lanterns,windows]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/signkinds';
const when = process.argv[3] ?? 'both';
const only = process.argv[4]?.split(',');
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await page.goto(`${server.resolvedUrls.local[0]}models-buildings.html`, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__focusAt === 'function', null, { timeout: 300000 });
  await page.waitForTimeout(8000);
  const Z = 113;
  const views = {
    street: [14, 12, Z, 82, 0.2, 0.25, 1],
    tenant: [-22.4, 10, Z, 15, 0.8, 0.1, 1],
    stand: [-18.4, 0.8, Z + 0.9, 2.6, 0.6, 0.15, 1],
    tube: [-19.6, 3.6, Z, 3.6, 0.15, 0.12, 1],
    lanterns: [-13.35, 2.8, Z, 6, 0.15, 0.1, 1],
    hotel: [-4.7, 4.8, Z, 7, 0.15, 0.12, 1],
    hotelboards: [-8.4, 2.2, Z, 2.8, 0.15, 0.1, 1],
    arrow: [-1.2, 3.2, Z, 3.6, 0.15, 0.1, 1],
    blades: [-0.9, 9.5, Z, 9, 1, 0.1, 0.35],
    led: [6.7, 4.8, Z, 9, 0.15, 0.1, 1],
    windows: [17.1, 11, Z, 16, 0.15, 0.1, 1],
    banner: [27.2, 14, Z, 26, 0.3, 0.1, 1],
    kissa: [32.4, 3.2, Z, 7, 0.15, 0.1, 1],
    crown: [44.3, 39, Z, 20, 0.1, -0.15, 1],
    icons: [43.8, 3, Z, 13, 0.1, 0.1, 1],
    barber: [53.4, 2.1, Z + 0.3, 2.8, 0.5, 0.1, 1],
  };
  const modes = when === 'both' ? ['night', 'day'] : [when];
  for (const mode of modes) {
    await page.keyboard.press(mode === 'night' ? 'Digit2' : 'Digit3');
    await page.waitForTimeout(1500);
    for (const [n, v] of Object.entries(views).filter(([n]) => !only || only.includes(n))) {
      await page.evaluate((v) => window.__focusAt(...v), v);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${mode}-${n}.png` });
      console.log('shot', mode, n);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
