// Footsteps against Mack's feet in the district: walks and runs him, logs each step sound with where the foot
// bones are at that moment, and checks the world going muffled in the car and indoors (the levels of the ways the
// outside is heard, sampled through the fade into Yoru Mart and back out).
//   node debug-shots/footsteps.mjs [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const extra = process.argv[2] ? `&${process.argv[2]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForFunction(() => window.__scene.children.some((o) => o.name === 'first-person'), null, { timeout: 60000, polling: 500 });
await page.waitForTimeout(3000);
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);

await page.evaluate(() => {
  const rig = window.__scene.children.find((o) => o.name === 'first-person');
  const bones = {};
  rig.traverse((o) => { if ((o.name === 'foot_l' || o.name === 'foot_r') && !bones[o.name]) bones[o.name] = o; });
  const v = new window.__camera.position.constructor();
  const feet = () => {
    const floor = window.__camera.position.y - 1.7;
    return { l: bones.foot_l.getWorldPosition(v).y - floor, r: bones.foot_r.getWorldPosition(v).y - floor };
  };
  const log = (window.__steps = { steps: [], frames: [] });
  const a = window.__audio;
  a.start();
  const step = a.step.bind(a);
  a.step = (surface, o) => {
    log.steps.push({ t: performance.now(), surface, foot: o.foot, footwear: o.footwear, run: o.run, land: o.land ?? 0, puddle: o.puddle ?? 0, wet: o.wet, ...feet() });
    step(surface, o);
  };
  const tick = () => {
    log.frames.push({ t: performance.now(), ...feet() });
    requestAnimationFrame(tick);
  };
  tick();
});

const leg = async (name, shift, ms) => {
  await page.evaluate(() => { window.__steps.steps.length = 0; window.__steps.frames.length = 0; });
  if (shift) await key('ShiftLeft', true);
  await key('KeyW', true);
  await page.waitForTimeout(ms);
  const r = await page.evaluate(() => {
    const { steps, frames } = window.__steps;
    // (Skip the first second: the stride easing in.)
    const t0 = frames[0].t + 1000;
    const fr = frames.filter((f) => f.t > t0);
    const st = steps.filter((s) => s.t > t0 && s.foot);
    const lo = { l: Math.min(...fr.map((f) => f.l)), r: Math.min(...fr.map((f) => f.r)) };
    const hi = { l: Math.max(...fr.map((f) => f.l)), r: Math.max(...fr.map((f) => f.r)) };
    const secs = (fr[fr.length - 1].t - fr[0].t) / 1000;
    // Each foot's own cycle: from the frames, the times it's lowest after being up (its lift past half way).
    return {
      steps: st.length,
      perSecond: +(st.length / secs).toFixed(2),
      alternating: st.every((s, i) => i === 0 || s.foot !== st[i - 1].foot),
      // How far above its lowest point the landing foot is when its step sounds, against how high it lifts (cm).
      aboveLowestCm: st.map((s) => +((s[s.foot] - lo[s.foot]) * 100).toFixed(1)),
      liftCm: { l: +((hi.l - lo.l) * 100).toFixed(1), r: +((hi.r - lo.r) * 100).toFixed(1) },
      // And the other foot at that moment: up, coming through.
      otherAboveLowestCm: st.map((s) => { const o = s.foot === 'l' ? 'r' : 'l'; return +((s[o] - lo[o]) * 100).toFixed(1); }),
      surfaces: [...new Set(steps.map((s) => s.surface))],
      footwear: [...new Set(steps.map((s) => s.footwear))],
      unfooted: steps.filter((s) => !s.foot && !s.land).length,
      // In the wet: how many of the steps landed in a puddle, and the deepest.
      wet: +Math.max(...steps.map((s) => s.wet)).toFixed(2),
      inPuddles: steps.filter((s) => s.puddle > 0.15).length,
      deepest: +Math.max(...steps.map((s) => s.puddle)).toFixed(2),
    };
  });
  await key('KeyW', false);
  if (shift) await key('ShiftLeft', false);
  await page.waitForTimeout(800);
  console.log(name, JSON.stringify(r));
};
await leg('walk', false, 6000);
await leg('run ', true, 6000);

// What a first step on a new surface costs (a render; later ones are kept), the slowest of each footwear.
console.log('render ms', JSON.stringify(await page.evaluate(() => Object.fromEntries(['boots', 'shoes', 'bare'].map((f) => [f, Math.max(...['paving', 'wood', 'metal', 'gravel', 'grass', 'snow'].map((s) => { const t = performance.now(); window.__audio.stepBuffer(s, f, false, false); return +(performance.now() - t).toFixed(1); }))])))));
// Standing: nothing.
await page.evaluate(() => { window.__steps.steps.length = 0; });
await page.waitForTimeout(2500);
console.log('standing: steps', await page.evaluate(() => window.__steps.steps.length));

// The car: out in the open, then at the wheel (the chase camera, then the cockpit).
const world = () => page.evaluate(() => ({ clear: +window.__audio.world.gains[0].gain.value.toFixed(2), throughGlass: +window.__audio.world.gains[1].gain.value.toFixed(2) }));
// Indoors, in the rain: teleported into the shop and back out, the cover's three levels every 150 ms.
const cover = () => page.evaluate(() => window.__audio.cover.gains.map((g) => +g.gain.value.toFixed(2)).join(' / '));
const fade = async (name, x, z) => {
  await page.evaluate(([px, pz]) => window.__camera.position.set(px, window.__camera.position.y, pz), [x, z]);
  const seen = [];
  for (let i = 0; i < 9; i++) { seen.push(await cover()); await page.waitForTimeout(150); }
  console.log(name, '(open / roof / indoors):', seen.join('  ->  '));
};
const shop = await page.evaluate(() => { const p = window.__district.placed.find((q) => q.stamp.landmark === 'konbini'); return { x: p.building.x, z: p.building.z, out: window.__camera.position.toArray() }; });
await fade('into the shop', shop.x, shop.z);
await fade('back out     ', shop.out[0], shop.out[2]);
console.log('on foot ', JSON.stringify(await world()));
await page.evaluate(() => window.__drive());
await page.waitForTimeout(2500);
console.log('driving ', JSON.stringify(await world()), await page.evaluate(() => document.body.innerText.match(/Camera: [A-Za-z ]+/)?.[0] ?? ''));
for (let i = 0; i < 5; i++) {
  await key('KeyQ', true); await key('KeyQ', false);
  await page.waitForTimeout(1800);
  console.log('view +' + (i + 1), JSON.stringify(await world()), await page.evaluate(() => document.body.innerText.match(/Camera: [A-Za-z ]+/)?.[0] ?? ''));
}
await browser.close(); await server.close();
