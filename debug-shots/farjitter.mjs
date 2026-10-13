// Far chase look-round jitter: drives straight, swings the view to one side, and records each frame the camera's
// place against the drawn car's (second differences = jitter). node debug-shots/farjitter.mjs [out dir] [yaw rad] [spawn]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/farjitter';
const yaw = Number(process.argv[3] ?? 1.5);
const spawn = process.argv[4] ?? 'city_garage.front';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const zoom = process.argv[5] ?? '1';
const carType = process.argv[6] ?? '';
await page.addInitScript(([z, t]) => { localStorage.setItem('rainyplace.driveView', 'far'); localStorage.setItem('rainyplace.chaseZoom', z); if (t) localStorage.setItem('rainyplace.race.v1.profile', JSON.stringify({ v: 1, yen: 99999999, cars: [{ id: 'car1', type: t, paint: 0x0a0a0c, paint2: null, parts: {}, livery: { stripes: null, side: null, number: null, banner: null }, neon: null, neonFitted: false }], current: 'car1', earned: 0 })); }, [zoom, carType]);
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&${spawn.includes(",") ? "cam=" + spawn : "spawn=" + spawn}&car=home`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(1500);
const key = (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
await key('KeyW', true);
for (let i = 0; i < 3; i++) { await page.waitForTimeout(1000); console.log('u', await page.evaluate(() => [window.__own.sim.u.toFixed(1), window.__own.sim.x.toFixed(0), window.__own.sim.z.toFixed(0), !!window.__driving.car])); }
const record = (label, look) => page.evaluate(async ([label, look]) => {
  window.__driving.setLook(look, 0);
  await new Promise((r) => setTimeout(r, 100));
  const rows = [];
  await new Promise((res) => {
    let n = 0;
    const f = () => {
      const c = window.__camera.position, o = window.__own.view.obj.position, h = window.__own.view.obj.rotation.y;
      const dx = c.x - o.x, dz = c.z - o.z;
      const d = window.__camera.getWorldDirection(new window.__camera.position.constructor()); const ob = window.__own.view.obj; const sm = window.__own.sim; rows.push({ t: performance.now(), px: o.x, pz: o.z, sx: sm.x, sz: sm.z, spd: sm.u, hd: h, cyaw: Math.atan2(d.x, d.z) - h, cpit: Math.asin(d.y), rx: ob.rotation.x, rz: ob.rotation.z, x: dx, z: dz, y: c.y - o.y, along: dx * Math.sin(h) + dz * Math.cos(h), side: dx * Math.cos(h) - dz * Math.sin(h) });
      if (++n < 90) requestAnimationFrame(f); else res();
    };
    requestAnimationFrame(f);
  });
  return { label, rows };
}, [label, look]);
const stat = (rows, k) => { const d2 = []; for (let i = 2; i < rows.length; i++) d2.push(Math.abs(rows[i][k] - 2 * rows[i - 1][k] + rows[i - 2][k])); d2.sort((a, b) => a - b); return { med: d2[d2.length >> 1].toFixed(4), p95: d2[Math.floor(d2.length * 0.95)].toFixed(4), max: d2[d2.length - 1].toFixed(4) }; };
const res = [];
const speedStat = (rows) => { const v = [], gap = []; for (let i = 1; i < rows.length; i++) { const dt = (rows[i].t - rows[i - 1].t) / 1000; v.push(Math.hypot(rows[i].px - rows[i - 1].px, rows[i].pz - rows[i - 1].pz) / dt); gap.push(Math.hypot(rows[i].px - rows[i].sx, rows[i].pz - rows[i].sz)); } const m = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); return `drawn speed mean ${m.toFixed(2)} sd ${sd.toFixed(2)} min ${Math.min(...v).toFixed(1)} max ${Math.max(...v).toFixed(1)}; drawn-vs-sim gap max ${Math.max(...gap).toFixed(3)}; sim speed ${rows[rows.length-1].spd.toFixed(1)}`; };
for (const [label, look] of [['ahead', 0], ['side', yaw], ['otherside', -yaw]]) {
  const r = await record(label, look);
  const dts = r.rows.slice(1).map((v, i) => v.t - r.rows[i].t);
  console.log(label, 'frame ms avg', (dts.reduce((a, b) => a + b, 0) / dts.length).toFixed(1), 'max', Math.max(...dts).toFixed(1), 'side', JSON.stringify(stat(r.rows, 'side')), 'along', JSON.stringify(stat(r.rows, 'along')), 'y', JSON.stringify(stat(r.rows, 'y')), ' | camYaw', JSON.stringify(stat(r.rows, 'cyaw')), 'camPitch', JSON.stringify(stat(r.rows, 'cpit')), 'heading', JSON.stringify(stat(r.rows, 'hd')), 'carPitch', JSON.stringify(stat(r.rows, 'rx')), 'carRoll', JSON.stringify(stat(r.rows, 'rz')));
  console.log('  ', speedStat(r.rows));
  res.push(r);
}
writeFileSync(`${out}/rows.json`, JSON.stringify(res));
await browser.close();
await server.close();
