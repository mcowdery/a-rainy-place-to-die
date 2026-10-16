// How the fight page's frame time grows with the window, first person against third person against a roll: the GPU's share,
// which the 16.7 ms vsync floor hides at a small window (an ultrawide has ten times the pixels of 960x540).
//   [SCALE=0.75] node debug-shots/coverscale.mjs [WxH ...]      (SCALE: the page's render scale, ?scale=)
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const sizes = (process.argv.length > 2 ? process.argv.slice(2) : ['1280x720', '1920x1080', '2560x1440', '3440x1440', '3840x2160']).map((s) => s.split('x').map(Number));
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}fight.html?hand=fists&scale=${process.env.SCALE ?? 1}`);
await page.waitForFunction(() => window.__fp && window.__fp.rig() && window.__fp.rig().anims && window.__fp.rig().anims.clips.some((c) => c.name === 'MX_AA_stand_to_cover'), null, { timeout: 90000, polling: 250 });
await page.evaluate(() => __fp.spawn(0));
await page.waitForTimeout(1500);
await page.evaluate(() => { const rig = __fp.rig(); for (const c of rig.anims.clips) if (c.name.startsWith('MX_')) rig.anims.clipFor(rig.model, rig.body, c.name); window.__dts = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__dts.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
const at = (x, z) => page.evaluate(([x, z]) => { const c = __fp.camera(); c.position.x = x; c.position.z = z; __fp.look(0, -0.08); }, [x, z]);
const stats = async (ms) => {
  await page.evaluate(() => (window.__dts = []));
  await page.waitForTimeout(ms);
  return page.evaluate(() => { const d = [...window.__dts].sort((a, b) => a - b); return { mean: d.reduce((a, b) => a + b, 0) / d.length, p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1], n: d.length }; });
};
const row = (r) => `${r.mean.toFixed(1).padStart(5)} ms (worst ${r.max.toFixed(0).padStart(3)})`;
console.log('window        MP    first person        third person        a roll');
for (const [w, h] of sizes) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1200);
  await at(0, 6);
  await page.evaluate(() => __fp.third(false)); await page.waitForTimeout(700);
  const fp = await stats(1500);
  await page.evaluate(() => __fp.third(true)); await page.waitForTimeout(700);
  const tp = await stats(1500);
  await page.evaluate(() => __fp.third(false)); await at(0, 6); await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  const roll = await stats(2200);
  await page.waitForTimeout(800);
  console.log(`${`${w}x${h}`.padEnd(12)} ${((w * h) / 1e6).toFixed(1).padStart(5)}   ${row(fp)}   ${row(tp)}   ${row(roll)}`);
}
await browser.close();
await server.close();
