// A taxi called where none cruise: hail, follow it in, shoot it arriving. node debug-shots/taxicall.mjs [x,y,z,yaw,pitch]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';

const cam = process.argv[2] ?? '4994,1.7,1100,0,0';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  const toasts = [];
  await page.goto(`${base}?debug=1&clock=12:00&weather=clear&cam=${cam}`);
  await page.waitForTimeout(45_000);
  await page.evaluate(() => window.__taxi.hail());
  await page.waitForTimeout(500);
  console.log('toast:', await page.evaluate(() => [...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => /taxi|タクシー|配車/i.test(t ?? '') && (t ?? '').length < 200)));
  let shot = 0;
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => window.__taxi.state());
    console.log(i * 1.5, JSON.stringify(st.hail));
    if (st.hail && !st.hail.stopped && st.hail.d < 70 && shot === 0) {
      await page.screenshot({ path: 'debug-shots/taxicall_coming.png' });
      shot = 1;
    }
    if (st.hail?.stopped) {
      await page.screenshot({ path: 'debug-shots/taxicall_here.png' });
      console.log('here:', JSON.stringify(st));
      break;
    }
    await page.waitForTimeout(1500);
  }
} finally {
  await browser.close();
  await server.close();
}
