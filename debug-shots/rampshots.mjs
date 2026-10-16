// Street-level shots of the expressway's ramps and piers: node debug-shots/rampshots.mjs [tag]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';

const tag = process.argv[2] ?? 'before';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const shots = process.argv[3] ? JSON.parse(process.argv[3]) : {
  // In the avenue's inner lane, before the Kaburo north on-ramp (heading east).
  on_lane: '3530,2.2,1275,-90,-2',
  // Under the north side, before the Kaburo off-ramp's high part (heading east).
  off_lane: '3290,2.2,1275,-90,-2',
  // From the pavement, across the avenue at the on-ramp.
  on_side: '3650,4,1300,-30,2',
  // Route 1 over Kōnan-dōri, the port off-ramp.
  r1: '3083,2.2,2200,180,-2',
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
  for (const [name, cam] of Object.entries(shots)) {
    await page.goto(`${base}?clock=${process.env.CLOCK ?? "12:00"}&weather=clear&fly=1&cam=${cam}`);
    await page.waitForTimeout(45_000);
    await page.screenshot({ path: `debug-shots/ramp_${tag}_${name}.png`, timeout: 120_000 });
  }
} finally {
  await browser.close();
  await server.close();
}
