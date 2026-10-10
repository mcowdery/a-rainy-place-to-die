// Opens every model showroom room headless and takes a shot of its first view and a few focused ones, reporting console errors.
//   node debug-shots/showrooms.mjs <out dir> [room ...] [--night]
// Rooms: cars mack plants buildings transit cars-ph plants-ph boats-ph buildings-ph (default: all); the page is models-<room>.html.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';

const args = process.argv.slice(2);
const night = args.includes('--night');
const out = args.find((a) => !a.startsWith('--') && !ROOMS_HAS(a)) ?? 'debug-shots/showrooms';
function ROOMS_HAS(a) { return ['cars', 'mack', 'plants', 'buildings', 'transit', 'cars-ph', 'plants-ph', 'boats-ph', 'buildings-ph'].includes(a); }
mkdirSync(out, { recursive: true });
// [name, x, y, z, size, vx, vy, vz]: __focusAt(x, y, z, size, view)
const VIEWS = {
  cars: [['taxis', -4, 0.8, -8.5, 14, 0.2, 0.35, -1], ['work', 0, 1, -30, 26, 0.2, 0.4, 1], ['ads', 0, 1, -19, 30, 0.3, 0.5, 1], ['bikes', 0, 0.8, -13.5, 22, 0.1, 0.4, 1]],
  mack: ['mack', 'shotgun: lever', 'katana', 'baseball bat', 'bike: bōsōzoku', 'bike: cruiser', 'bike: sports', 'helmet: black'],
  plants: [['trees', 18, 4, 0, 60, 0.1, 0.35, 1], ['row2', 18, 3, 16, 36, 0.1, 0.3, 1], ['foliage', 18, 4, 60, 40, 0.1, 0.25, 1], ['foliage4', 18, 4, 128, 40, 0.1, 0.25, 1]],
  buildings: [['mega', 58, 28, 22, 48, -1, 0.12, 1], ['wall', 4, 3, 0, 40, 1, 0.2, 0], ['street', 30, 1, 66, 40, 0.1, 0.35, 1], ['tanuki', 20, 0.8, 52, 3, 0.3, 0.15, 1]],
  transit: [['train', 0, 2, 0, 60, 1, 0.3, 0.6], ['bus', 26, 1.5, 0, 14, 1, 0.3, 0.7], ['planes', 130, 4, 0, 110, 0.2, 0.5, 1]],
  'cars-ph': [['jeepneys', 1, 1.5, 0, 26, 0.1, 0.4, 1], ['rear', 1, 1.5, -10, 26, 0.1, 0.4, -1], ['tricycles', 16, 1, -5, 14, 0.1, 0.5, 1], ['size', 1, 1, 12, 26, 0.1, 0.35, 1]],
  'plants-ph': [['trees', 38, 4, 0, 56, 0.1, 0.35, 1], ['banyan', 69, 4.5, 0, 12, 0.2, 0.2, 1], ['shrubs', 18, 1, 22, 40, 0.3, 0.3, 1]],
  'boats-ph': [['bangkas', 20, 1.2, 0, 22, 0.4, 0.35, 0.8], ['launch', 0, 2, 24, 32, 1, 0.35, 0.7], ['ships', 20, 12, 220, 190, 1, 0.25, 0.9]],
  'buildings-ph': [['houses', 24, 3.5, 0, 50, 0.1, 0.4, 1], ['street', 32, 2, 23, 64, 0.05, 0.3, 1], ['footbridge', 30, 3, -45, 40, 0.2, 0.35, 1], ['court', 85, 1, -45, 34, 0.2, 0.7, 1]],
};
const rooms = Object.keys(VIEWS).filter((r) => args.every((a) => a.startsWith('--') || !ROOMS_HAS(a)) || args.includes(r));
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const room of rooms) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('CONSOLE ' + m.text().slice(0, 300)); });
  await page.goto(`${server.resolvedUrls.local[0]}models-${room}.html`, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__view === 'function', null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(room === 'mack' ? 9000 : 5000);
  if (night) await page.keyboard.press('Digit2');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${room}-home.png` });
  for (const view of VIEWS[room]) {
    const [n, x, y, z, size, vx, vy, vz] = view;
    // A string is the name on a panel button; otherwise a [name, x, y, z, size, view] for __focusAt.
    if (typeof view === 'string') await page.locator('#panel button', { hasText: view }).first().click();
    else await page.evaluate((v) => window.__focusAt(...v), [x, y, z, size, vx, vy, vz]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${room}-${typeof view === 'string' ? view.replace(/[^a-z0-9]+/gi, '_') : n}.png` });
  }
  console.log(room, errors.length ? errors.join('\n  ') : 'no errors');
  await page.close();
}
await browser.close();
await server.close();
