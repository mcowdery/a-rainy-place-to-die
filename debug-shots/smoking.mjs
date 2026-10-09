// The mob's smokers (real/smoke.ts): the showroom's row through a round of the cigarette, then the city.
//   node debug-shots/smoking.mjs [out dir] [parts: show,city,perf] [city query] [spawn]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/smoking';
mkdirSync(out, { recursive: true });
const parts = (process.argv[3] ?? 'show,city').split(',');
const extra = process.argv[4] ? `&${process.argv[4]}` : '';
const spawn = process.argv[5] ?? 'kaburo_crossing.view';
// (No hot reload: others' edits mustn't reload the page mid-shot.)
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const warned = new Map();
const watch = (page) => {
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => { if (m.type() === 'warning' && /GL_|WebGL|uninitialized|X\d{4}/.test(m.text())) { const k = m.text().slice(0, 400); warned.set(k, (warned.get(k) ?? 0) + 1); } });
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 1800)); });
};
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 40);

if (parts.includes('show')) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  watch(page);
  await page.goto(`${server.resolvedUrls.local[0]}mob.html?t=0${extra}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
  await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
  const key = (code) => page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
  const views = (await page.evaluate(() => window.__mob.items)).filter((v) => v.startsWith('smoking'));
  console.log('smokers drawn:', await page.evaluate(() => window.__mob.smoke.count), 'views:', views.join(' | '));
  // (The clock is the page's ?t=: set the mob's own time by hand for each shot.)
  const at = (t) => page.evaluate((t) => { window.__mob.fixedTime = t; }, t);
  for (const [name, keys] of [['studio', []], ['night', ['Digit3']]]) {
    for (const k of keys) await key(k);
    for (const v of views) {
      await page.evaluate((n) => window.__focus(n), v);
      for (const t of v === 'smoking' ? [2, 6, 10] : [0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 14, 17, 20]) {
        await at(t);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${out}/show_${slug(v)}_${name}_t${String(t).replace('.', '_')}.png` });
      }
    }
  }
  // A wind, and from the side.
  await key('Digit1');
  await page.evaluate(() => { window.__focus('smoking: men'); window.__mob.smoke.material.uniforms.uWind.value.set(1.2, 0.3); });
  for (const t of [3, 6, 9]) {
    await at(t);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/show_wind_t${t}.png` });
  }
  await page.close();
}

if (parts.includes('city')) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  watch(page);
  for (const [name, q] of (process.env.ONLY ? [['night', 'clock=21:30']] : [['night', 'clock=21:30'], ['day', 'clock=13:00']])) {
    await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=${spawn}&${q}&weather=clear&mob=color${extra}`, { timeout: 240000 });
    await page.waitForFunction(() => window.__district && window.__perf, null, { timeout: 240000 });
    await page.waitForTimeout(9000);
    const info = await page.evaluate(() => ({ hemi: window.__ghost?.uniforms.uHemiSky.value.toArray().map((v) => +v.toFixed(3)), gain: window.__ghost?.uniforms.uLightGain.value, smokers: window.__district.crowd?.smokeLayer?.count ?? -1, wind: window.__district.crowd?.smokeLayer?.material.uniforms.uWind.value.toArray() }));
    console.log(name, JSON.stringify(info));
    await page.screenshot({ path: `${out}/city_${name}.png` });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/city_${name}_b.png` });
    // Up close: the nearest few standing smokers, from 2 m, through a round.
    const near = await page.evaluate(() => {
      const L = window.__district.crowd.smokeLayer;
      const fig = L.mesh.geometry.getAttribute('aFig').array, walk = L.mesh.geometry.getAttribute('aWalk').array, g = L.mesh.geometry.getAttribute('aGround').array, pose = L.mesh.geometry.getAttribute('aPose').array;
      const c = window.__camera.position;
      const list = [];
      for (let i = 0; i < L.count; i++) if (walk[i * 4 + 2] === 0) list.push({ x: fig[i * 4], z: fig[i * 4 + 1], yaw: fig[i * 4 + 2], y: g[i * 3], carry: pose[i * 4 + 2], d: Math.hypot(fig[i * 4] - c.x, fig[i * 4 + 1] - c.z) });
      return list.sort((a, b) => a.d - b.d).slice(0, 3);
    });
    console.log(name, 'standing smokers near:', JSON.stringify(near.map((n) => ({ d: +n.d.toFixed(1), carry: n.carry }))));
    for (const [i, n] of near.slice(0, name === 'night' ? 2 : 1).entries()) {
      // In front of them and a little to one side, at a walker's eye height, looking at their chest.
      const a = n.yaw + 0.45;
      const c = [n.x + Math.sin(a) * 2.3, n.y + 1.55, n.z + Math.cos(a) * 2.3];
      const yaw = (Math.atan2(c[0] - n.x, c[2] - n.z) * 180) / Math.PI;
      await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&cam=${c.map((v) => v.toFixed(2)).join(',')},${yaw.toFixed(1)},-4&${q}&weather=clear&mob=color&fly=1${extra}`, { timeout: 240000 });
      await page.waitForFunction(() => window.__district && window.__perf, null, { timeout: 240000 });
      await page.waitForTimeout(8000);
      console.log('  camera', JSON.stringify(await page.evaluate(() => { const c = window.__camera; const d = c.getWorldDirection(c.position.clone()); return { at: c.position.toArray().map((v) => +v.toFixed(1)), dir: d.toArray().map((v) => +v.toFixed(2)) }; })), 'smoker', n.x.toFixed(1), n.y.toFixed(1), n.z.toFixed(1), 'yaw', n.yaw.toFixed(2));
      for (let k = 0; k < 7; k++) {
        await page.waitForTimeout(1600);
        await page.screenshot({ path: `${out}/city_${name}_near${i}_${k}.png` });
      }
    }
  }
  await page.close();
}
for (const [k, n] of warned) console.log('WARN x' + n, k);
await browser.close();
await server.close();
