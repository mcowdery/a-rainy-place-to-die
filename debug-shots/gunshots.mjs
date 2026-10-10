import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html`);
await page.waitForTimeout(8000);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const gx = await page.evaluate(() => 0);
const shots = [
  ['g1_top', (x) => __view(x + 0.12, 1.85, 38.05, x + 0.12, 1.2, 38.0)],
  ['g2_lever', (x) => __view(x - 0.1, 1.55, 37.5, x + 0.08, 1.2, 37.82)],
  ['g3_double', (x) => __view(x - 0.1, 1.55, 38.55, x + 0.08, 1.2, 38.18)],
  ['g4_grip', (x) => __view(x + 0.25, 1.38, 37.62, x + 0.13, 1.2, 37.82)],
];
for (const [name] of shots) {
  await page.evaluate(([n]) => {
    const x = Math.max(6, 4 * 2.2 + 2) / 2 + 1.4;
    const f = { g1_top: () => __view(x + 0.12, 1.75, 38.05, x + 0.12, 1.2, 38.0), g2_lever: () => __view(x - 0.05, 1.45, 37.42, x + 0.08, 1.2, 37.82), g3_double: () => __view(x - 0.05, 1.45, 38.58, x + 0.08, 1.2, 38.18), g4_grip: () => __view(x + 0.22, 1.36, 37.6, x + 0.12, 1.2, 37.82) }[n];
    f();
  }, [name]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close(); await server.close();
