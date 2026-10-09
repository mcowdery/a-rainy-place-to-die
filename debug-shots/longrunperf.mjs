// Frame times in the long run (district/chase.ts 'gauntlet'): GPU and CPU (ms, mean and worst of the last window),
// hitches over 33 ms, draw calls, triangles and the number of shader programs, every few seconds: first on the street
// with no job (the baseline), then through the run under the auto drive. exclusive: it measures frame times.
// node debug-shots/longrunperf.mjs [seconds] [query]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const secs = Number(process.argv[2] ?? 60);
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript(() => localStorage.setItem('citypop.driveView', 'chase'));
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&spawn=city_garage.front&car=home&clock=22:30&weather=clear&res=100${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__chase, null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.__drive());
// New shader programs since the last call, by material type and a bit of what makes them differ.
const programsSeen = new Set();
const newPrograms = () =>
  page.evaluate((seen) => {
    const out = [];
    for (const p of window.__renderer.info.programs ?? []) {
      const k = p.cacheKey;
      if (seen.includes(k)) continue;
      seen.push(k);
      out.push(`${p.name} ${(k.match(/(USE_\w+|SHADOWMAP|NUM_\w+_LIGHTS\w*)/g) ?? []).slice(0, 6).join(',')} ${k.length}`);
    }
    return { out, seen };
  }, [...programsSeen]).then((r) => (r.seen.forEach((k) => programsSeen.add(k)), r.out));
const sample = (label, n = 120) =>
  page.evaluate(
    ([label, n]) => {
      const p = window.__perf;
      const last = (a) => a.slice(-n);
      const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
      const cpu = last(p.cpu);
      const gpu = last(p.gpu);
      const info = window.__renderer.info;
      const c = window.__chase.chase;
      return `${label}: cpu ${mean(cpu).toFixed(1)} (max ${Math.max(...cpu).toFixed(0)}) gpu ${mean(gpu).toFixed(1)} (max ${Math.max(...gpu).toFixed(0)}) hitches>33ms ${cpu.filter((x) => x > 33).length}/${cpu.length} calls ${info.render.calls} tris ${(info.render.triangles / 1000).toFixed(0)}k programs ${info.programs?.length} cars ${c.cars.length} blocks ${c.blocks.length}`;
    },
    [label, n],
  );
await page.waitForTimeout(5000);
console.log(await sample('baseline (parked, no job)'));
await newPrograms();
// Time the parts of the chase on the CPU: calls, total and worst (ms).
await page.evaluate(() => {
  const c = window.__chase.chase;
  const T = (window.__t = {});
  const wrap = (obj, name, label = name) => {
    const f = obj[name];
    obj[name] = function (...a) {
      const t0 = performance.now();
      const r = f.apply(this, a);
      const d = performance.now() - t0;
      const e = (T[label] ??= { n: 0, ms: 0, max: 0 });
      e.n++;
      e.ms += d;
      e.max = Math.max(e.max, d);
      return r;
    };
  };
  for (const m of ['update', 'swarm', 'spawnAttacker', 'placeBlock', 'way', 'spot', 'syncBodies', 'makeCar', 'struck']) wrap(c, m, `chase.${m}`);
  wrap(c.host, 'route', 'host.route');
  // (probe is hot: only counted, not timed)
  const probe = c.host.probe;
  T.probes = { n: 0, ms: 0, max: 0 };
  c.host.probe = (...a) => (T.probes.n++, probe(...a));
  wrap(c.hud, 'update', 'hud.update');
  const k = c.cars[0] ?? null;
  window.__wrapCar = (car) => {
    const P = Object.getPrototypeOf(car);
    if (P.__wrapped) return;
    P.__wrapped = true;
    for (const m of ['update', 'shoot', 'dispose']) wrap(P, m, `car.${m}`);
  };
  const P = window.__chase.chase.constructor;
});
console.log('start', await page.evaluate(() => window.__chase.start('long_run')));
console.log('   programs at start:', (await newPrograms()).join(' | '));
// 'full': the swarm at its biggest from the first moment (9 cars on you), for the worst case.
if (process.argv[4] === 'full') await page.evaluate(() => Object.assign(window.__chase.chase.state.def.swarm, { start: 9, max: 9 }));
await page.waitForFunction(() => window.__chase.chase.cars[0], null, { timeout: 30000 });
await page.evaluate(() => window.__wrapCar(window.__chase.chase.cars[0]));
await page.waitForTimeout(6500);
await page.evaluate(() => window.__auto.set('fast'));
for (let t = 0; t < secs; t += 4) {
  await page.waitForTimeout(4000);
  console.log(`${t + 4}s`, await sample('run'));
  const np = await newPrograms();
  if (np.length) console.log('   new programs:', np.join(' | '));
}
console.log(
  await page.evaluate(() =>
    Object.entries(window.__t)
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([k, e]) => `${k.padEnd(18)} calls ${String(e.n).padStart(6)}  total ${e.ms.toFixed(0).padStart(6)} ms  mean ${(e.ms / e.n).toFixed(3)}  worst ${e.max.toFixed(1)}`)
      .join(' | '),
  ),
);
// Which part of the frame it is: the chase's own update on the CPU, timed over a few hundred frames.
console.log(
  'update cost',
  await page.evaluate(() => {
    const c = window.__chase.chase;
    const t0 = performance.now();
    const N = 200;
    for (let i = 0; i < N; i++) c.update(0.016, 0.016);
    return `${((performance.now() - t0) / N).toFixed(2)} ms per CityChase.update with ${c.cars.length} cars`;
  }),
);
await browser.close();
await server.close();
