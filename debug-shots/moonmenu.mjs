// The debug menu's Moon section: node debug-shots/moonmenu.mjs
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`${base}?debug=1&diag=1&clock=23:00&weather=clear&spawn=kaburo_crossing.view`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 180_000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__menu.show('Light & sky'));
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'look at it' }).click();
  await page.getByRole('button', { name: 'hazy', exact: true }).click();
  const set = (i, v) => page.evaluate(([i, v]) => {
    const r = [...document.querySelectorAll('input[type=range]')].at(i);
    r.value = String(v);
    r.dispatchEvent(new Event('input'));
  }, [i, v]);
  await set(-2, 2.5);
  await set(-1, 2);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'debug-shots/sky/moon-menu.png' });
  await page.getByRole('button', { name: 'copy settings' }).click();
  await page.waitForTimeout(300);
  console.log(await page.evaluate(() => [...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => t?.startsWith('Copied'))));
} finally {
  await browser.close();
  await server.close();
}
