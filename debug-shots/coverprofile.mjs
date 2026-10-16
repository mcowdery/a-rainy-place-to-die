// Where the time goes while a cover move plays on the fight page: a CPU profile (Chrome's) of one roll, the top functions by self time.
//   node debug-shots/coverprofile.mjs [roll|hug]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const move = process.argv[2] ?? 'roll';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`${server.resolvedUrls.local[0]}fight.html?hand=fists`);
await page.waitForFunction(() => window.__fp && window.__fp.rig() && window.__fp.rig().anims && window.__fp.rig().anims.clips.some((c) => c.name === 'MX_AA_stand_to_cover'), null, { timeout: 90000, polling: 250 });
await page.evaluate(() => __fp.spawn(0));
await page.waitForTimeout(1500);
await page.evaluate(() => { const rig = __fp.rig(); for (const c of rig.anims.clips) if (c.name.startsWith('MX_')) rig.anims.clipFor(rig.model, rig.body, c.name); });
const at = (x, z) => page.evaluate(([x, z]) => { const c = __fp.camera(); c.position.x = x; c.position.z = z; __fp.look(0, -0.08); }, [x, z]);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
if (move === 'roll') await at(0, 6); else await at(5.8, 0.4);
await page.waitForTimeout(600);
await cdp.send('Profiler.start');
await page.keyboard.press('Space');
await page.waitForTimeout(2800);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
});
// Inclusive time (a function and everything under it), for our own code and three's big steps.
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map();
profile.samples.forEach((id, i) => {
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const n = byId.get(cur);
    const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
    if (!seen.has(key)) { seen.add(key); incl.set(key, (incl.get(key) ?? 0) + (dt[i] ?? 0) / 1000); }
  }
});
console.log('top by inclusive time:');
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).filter(([k]) => !/^\((root|program|idle)\)/.test(k)).slice(0, 22)) console.log(`${v.toFixed(0).padStart(6)} ms  ${k}`);
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`profile of a ${move}: ${total.toFixed(0)} ms sampled; top by self time:`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 16)) console.log(`${v.toFixed(0).padStart(6)} ms  ${k}`);
await browser.close();
await server.close();
