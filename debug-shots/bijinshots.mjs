// The women made by hand on the MakeHuman test page (humans.html, scripts/blender/human_bijin.py): their line-up,
// then each one from the waist up and her face close, standing at ease, in the light asked for.
//   node debug-shots/bijinshots.mjs <out dir> [studio|night|day] [rest|smile|talk|worry: what their faces are doing]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const light = process.argv[3] ?? 'studio';
const face = process.argv[4] ?? 'rest';
const tag = face === 'rest' ? light : `${light}_${face}`;
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const wait = (ms) => page.waitForTimeout(ms);
const loaded = () => page.waitForFunction(() => window.__humans && __humans.waiting() === 0, null, { timeout: 180000, polling: 250 });

await page.goto(`${server.resolvedUrls.local[0]}humans.html?light=${light}&anims=procedural&face=${face}`);
await loaded();
const lineup = (await page.evaluate(() => __humans.items)).find((v) => v.startsWith('women made by hand'));
await page.evaluate((name) => __focus(name), lineup);
await loaded();
await wait(1500);
// The panel and the HUD out of the picture.
await page.addStyleTag({ content: '#hud, #panel, .label { display: none !important; }' });
await page.screenshot({ path: `${out}/${tag}_lineup.png` });
// Where each stands (figures.ts, BIJIN; main.ts, the line-ups: a metre apart, the second family's row at z -44).
const WOMEN = [['office', 1.6], ['club', 1.64], ['casual', 1.57], ['elegant', 1.66], ['ponytail', 1.62]];
for (const [i, [name, height]] of WOMEN.entries()) {
  const x = i - 2;
  const y = height - 0.11;
  await page.evaluate(([x, y]) => __view(x + 0.25, y - 0.12, -44 + 1.7, x, y - 0.22, -44), [x, y]);
  await wait(700);
  await page.screenshot({ path: `${out}/${tag}_${name}_half.png` });
  await page.evaluate(([x, y]) => __view(x + 0.12, y + 0.01, -44 + 0.62, x, y - 0.01, -44), [x, y]);
  await wait(700);
  await page.screenshot({ path: `${out}/${tag}_${name}_face.png` });
}
await browser.close();
await server.close();
