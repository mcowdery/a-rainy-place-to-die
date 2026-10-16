// How the cover moves cost, on the fight page: the time to fit each of their clips to the body the first time it's played
// (a stall at the start of a first use), and the frame times while one plays.
//   node debug-shots/coverperf.mjs
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}fight.html?hand=fists`);
await page.waitForFunction(() => window.__fp && window.__fp.rig() && window.__fp.rig().anims && window.__fp.rig().anims.clips.some((c) => c.name === 'MX_AA_stand_to_cover'), null, { timeout: 90000, polling: 250 });
await page.evaluate(() => __fp.spawn(0));
await page.waitForTimeout(1500);
const fits = await page.evaluate(() => {
  const rig = __fp.rig();
  const names = rig.anims.clips.filter((c) => c.name.startsWith('MX_')).map((c) => [c.name, c.seconds]);
  return names.map(([n, s]) => { const t0 = performance.now(); rig.anims.clipFor(rig.model, rig.body, n); return { n, s, ms: +(performance.now() - t0).toFixed(1) }; });
});
console.log('first fit of each clip (ms):');
for (const f of fits) console.log(' ', f.n.padEnd(58), String(f.ms).padStart(6), ' (clip', f.s, 's)');
console.log('total', fits.reduce((a, f) => a + f.ms, 0).toFixed(0), 'ms');
// Frame times in each case (the clips are fitted by now: what's left is per frame).
await page.evaluate(() => { window.__dts = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__dts.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
const stats = async (label, ms) => {
  await page.evaluate(() => (window.__dts = []));
  await page.waitForTimeout(ms);
  const r = await page.evaluate(() => { const d = [...window.__dts].sort((a, b) => a - b); return { frames: d.length, mean: d.reduce((a, b) => a + b, 0) / d.length, p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1] }; });
  console.log(label.padEnd(34), `frames ${String(r.frames).padStart(3)}  mean ${r.mean.toFixed(1).padStart(5)} ms  p95 ${r.p95.toFixed(1).padStart(5)}  max ${r.max.toFixed(1).padStart(6)}`);
};
const at = (x, z) => page.evaluate(([x, z]) => { const c = __fp.camera(); c.position.x = x; c.position.z = z; __fp.look(0, -0.08); }, [x, z]);
await at(0, 6);
await page.evaluate(() => __fp.third(false));
await page.waitForTimeout(800);
await stats('first person, standing', 2000);
await page.evaluate(() => __fp.third(true));
await page.waitForTimeout(800);
await stats('third person, standing', 2000);
await page.evaluate(() => __fp.third(false));
await at(0, 6);
await page.waitForTimeout(500);
await page.keyboard.press('Space');
await stats('a roll (third person forced)', 2600);
await page.waitForTimeout(500);
await at(5.8, 0.4);
await page.waitForTimeout(500);
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
await stats('held in cover (third person)', 2500);
await browser.close();
await server.close();
