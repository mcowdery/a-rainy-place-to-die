// Third-person shots at given spots: node debug-shots/thirdshots.mjs tag '{"name":"x,y,z,yaw,pitch"}'
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const tag = process.argv[2] ?? 'third';
const shots = JSON.parse(process.argv[3] ?? '{}');
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('citypop.thirdPerson', '1'));
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  for (const [name, cam] of Object.entries(shots)) {
    await page.goto(`${base}district.html?clock=21:00&weather=clear&cam=${cam}`);
    await page.waitForTimeout(40_000);
    await page.screenshot({ path: `debug-shots/${tag}_${name}.png` });
  }
} finally {
  await browser.close();
  await server.close();
}
