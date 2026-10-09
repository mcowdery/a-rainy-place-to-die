// The mob's emotes (real/emotes.ts): the showroom's row, the atlas, and the city with them held up, then what they cost.
//   node debug-shots/emotes.mjs [out dir] [parts: show,city,perf] [city query] [spawn]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, writeFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/emotes';
mkdirSync(out, { recursive: true });
const parts = (process.argv[3] ?? 'show,city,perf').split(',');
const extra = process.argv[4] ? `&${process.argv[4]}` : '';
const spawn = process.argv[5] ?? 'kaburo_crossing.view';
// (No hot reload: others' edits mustn't reload the page mid-shot.)
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const warned = new Map();
const watch = (page) => {
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  // (GL and shader warnings, counted: printed at the end.)
  page.on('console', (m) => { if (m.type() === 'warning' && /GL_|WebGL|uninitialized|X\d{4}/.test(m.text())) { const k = m.text().slice(0, 260); warned.set(k, (warned.get(k) ?? 0) + 1); } });
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 600)); });
};

if (parts.includes('show')) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  watch(page);
  await page.goto(`${server.resolvedUrls.local[0]}mob.html?t=3`, { timeout: 240000 });
  await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
  await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
  // The atlas as painted, over a dark, a middling and a pale ground, whole and a quarter at a time (full size).
  const sheets = await page.evaluate(() => {
    const src = window.__mob.emotes.material.uniforms.tEmotes.value.userData.canvas;
    const over = (bg, x, y, w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.drawImage(src, x, y, w, h, 0, 0, w, h);
      return c.toDataURL('image/png');
    };
    const out = {};
    for (const [name, bg] of [['dark', '#15151b'], ['mid', '#6f6c67'], ['pale', '#d9d5cc']]) {
      out[`atlas_${name}`] = over(bg, 0, 0, src.width, src.height);
      for (let q = 0; q < 5; q++) out[`atlas_${name}_rows${q}`] = over(bg, 0, q * src.height / 5, src.width, src.height / 5);
    }
    return out;
  });
  console.log('atlas painted in', await page.evaluate(() => window.__mob.emotes.material.uniforms.tEmotes.value.userData.ms.toFixed(1)), 'ms; heads', await page.evaluate(() => JSON.stringify(window.__mob.emotes.material.uniforms.uHead.value.map((v) => +v.toFixed(3)))));
  for (const [name, url] of Object.entries(sheets)) writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  const key = (code) => page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
  const views = (await page.evaluate(() => window.__mob.items)).filter((v) => v.startsWith('emotes'));
  const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 40);
  for (const [name, keys] of [['studio', []], ['night_ghost', ['Digit3', 'KeyO']], ['black', ['Digit1', 'KeyB']]]) {
    for (const k of keys) await key(k);
    for (const v of views) {
      await page.evaluate((n) => window.__focus(n), v);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/show_${slug(v)}_${name}.png` });
    }
    // Large: three heads at a time from 2.4 m.
    await page.evaluate(() => window.__focus('emotes'));
    const row = await page.evaluate(() => { const a = window.__mob.emotes.mesh.geometry.getAttribute('aFig'); return { x0: a.array[0], x1: a.array[4], z: a.array[1], n: window.__mob.emotes.mesh.geometry.instanceCount }; });
    for (let i = 1; i < row.n; i += 3) {
      const x = row.x0 + (row.x1 - row.x0) * Math.min(i, row.n - 2);
      await page.evaluate(([x, z]) => window.__view(x, 1.5, z + 2.4, x, 1.45, z), [x, row.z]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/show_large_${String(i).padStart(2, '0')}_${name}.png` });
    }
    // Their breath in the cold: the same row, five heads at a time, a little from the side.
    for (const i of [2, 7, 12, 17]) {
      const x = row.x0 + (row.x1 - row.x0) * i;
      await page.evaluate(([x, z]) => { window.__view(x + 1.6, 1.55, z + 3.4, x, 1.4, z); window.__mob.emotes.cold = 1; }, [x, row.z]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/show_breath_${String(i).padStart(2, '0')}_${name}.png` });
    }
    await page.evaluate(() => { window.__mob.emotes.cold = 0; });
  }
  await page.close();
}

// The marks on faces, moving: the clock running and the standing figures going about their routine (their heads
// turn); a face's mark held on everyone in the row, seen from in front, three quarters, the side and behind at two
// moments; then the street's walkers with it.
if (parts.includes('face')) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  watch(page);
  await page.goto(`${server.resolvedUrls.local[0]}mob.html?still=0&labels=0`, { timeout: 240000 });
  await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
  await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
  await page.evaluate(() => window.__focus('emotes'));
  const row = await page.evaluate(() => { const a = window.__mob.emotes.mesh.geometry.getAttribute('aFig'); return { x0: a.array[0], x1: a.array[4], z: a.array[1] }; });
  const x = row.x0 + (row.x1 - row.x0) * 6;
  const VIEWS = { front: [0, 2.3], quarter: [1.7, 1.7], side: [2.4, 0.1], behind: [0.4, -2.3] };
  for (const mark of ['blushBoth', 'heartEyes', 'starEyes']) {
    await page.evaluate((m) => { window.__mob.emotes.force = m; }, mark);
    for (const [name, [dx, dz]] of Object.entries(VIEWS)) {
      await page.evaluate(([x, z, dx, dz]) => window.__view(x + dx, 1.5, z + dz, x, 1.45, z), [x, row.z, dx, dz]);
      for (const moment of [0, 1]) {
        await page.waitForTimeout(moment ? 1600 : 300);
        await page.screenshot({ path: `${out}/face_${mark}_${name}_${moment}.png` });
      }
    }
  }
  // The street: its walkers are figures that come and go, so with no row they're the ones that emote.
  await page.evaluate(() => { window.__focus('street (as you walk it)'); const e = window.__mob.emotes; e.on = true; e.row = null; e.force = 'heartEyes'; });
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/face_street_heartEyes_${i}.png` });
  }
  await page.evaluate(() => { window.__mob.emotes.force = 'blushBoth'; });
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/face_street_blushBoth_${i}.png` });
  }
  await page.close();
}

if (parts.includes('city') || parts.includes('perf')) {
  for (const time of parts.includes('city') ? ['day', 'night'] : ['day']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    watch(page);
    await page.goto(`${server.resolvedUrls.local[0]}district.html?diag=1${extra}&time=${time}${time === 'night' ? '&season=winter' : ''}&weather=clear&res=100&spawn=${spawn}`, { timeout: 240000 });
    await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
    // (The frames start a while after the overlay says so: wait for the crowd.)
    await page.waitForFunction(() => window.__perf?.gpu.length > 60 && window.__district.crowd?.emoteLayer.mesh.geometry.instanceCount > 0, null, { timeout: 240000, polling: 500 });
    await page.waitForTimeout(8000);
    const layer = () => page.evaluate(() => {
      const L = window.__district.crowd.emoteLayer;
      return { figures: L.mesh.geometry.instanceCount, visible: L.mesh.visible, cold: +L.cold.toFixed(2), breath: L.breath.visible, force: L.force, rate: L.rate, hour: L.material.uniforms.uHour.value, hemi: L.material.uniforms.uHemiSky.value.toArray().map((v) => +v.toFixed(3)) };
    });
    console.log(time, JSON.stringify(await layer()));
    if (parts.includes('city')) {
      const tag = `${time}${extra.replace(/\W+/g, '_')}`;
      const shot = async (name, crop = false) => {
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${out}/city_${tag}_${name}.png` });
        // (The middle of the view on its own, to see the symbols at their size.)
        if (crop) await page.screenshot({ path: `${out}/city_${tag}_${name}_crop.png`, clip: { x: 400, y: 250, width: 800, height: 450 } });
      };
      // As it is (rare), then everyone holding one up, then by the clock but in every slot.
      await shot('as_is');
      await page.evaluate(() => { window.__district.crowd.emoteLayer.force = 'each'; });
      await shot('each');
      // Up close: in front of each of the standing people nearest the camera, looking at them; then from further off.
      const near = await page.evaluate(() => {
        const g = window.__district.crowd.emoteLayer.mesh.geometry;
        const fig = g.getAttribute('aFig').array, walk = g.getAttribute('aWalk').array, ground = g.getAttribute('aGround').array;
        const cam = window.__camera.position;
        const still = [];
        for (let i = 0; i < g.instanceCount; i++) if (walk[i * 4 + 2] === 0) still.push({ x: fig[i * 4], z: fig[i * 4 + 1], yaw: fig[i * 4 + 2], y: ground[i * 3], d: Math.hypot(fig[i * 4] - cam.x, fig[i * 4 + 1] - cam.z) });
        return still.sort((a, b) => a.d - b.d).slice(0, 5);
      });
      const place = (n, dist) => page.evaluate(([n, dist]) => {
        const cam = window.__camera;
        const dx = Math.sin(n.yaw), dz = Math.cos(n.yaw);
        cam.position.set(n.x + dx * dist, n.y + 1.5, n.z + dz * dist);
        // (The yaw that looks at them, found by trying: __look takes degrees.)
        let bestYaw = 0, bestDot = -2;
        for (let yaw = 0; yaw < 360; yaw += 1) {
          window.__look(yaw, 0);
          cam.updateMatrixWorld();
          const e = cam.matrixWorld.elements;
          const dot = e[8] * dx + e[10] * dz;
          if (dot > bestDot) { bestDot = dot; bestYaw = yaw; }
        }
        window.__look(bestYaw, 0);
      }, [n, dist]);
      for (const [i, n] of near.entries()) {
        await place(n, 3);
        await page.waitForTimeout(2000);
        await shot(`each_close${i}`, true);
      }
      if (near.length) {
        for (const dist of [9, 20]) {
          await place(near[0], dist);
          await page.waitForTimeout(2000);
          await shot(`each_${dist}m`, true);
        }
        await page.evaluate(() => { const L = window.__district.crowd.emoteLayer; L.force = null; L.rate = 1; });
        await page.waitForTimeout(1500);
        await shot('clock_20m', true);
      }
      // The marks on faces, held on everyone: in front of the nearest few, two moments each.
      for (const mark of ['heartEyes', 'blushBoth', 'starEyes']) {
        await page.evaluate((m) => { const L = window.__district.crowd.emoteLayer; L.rate = 0.25; L.force = m; }, mark);
        for (const [i, n] of near.entries()) {
          await place(n, 2.2);
          for (const moment of [0, 1]) {
            await page.waitForTimeout(1300);
            await page.screenshot({ path: `${out}/city_${tag}_face_${mark}_${i}_${moment}.png`, clip: { x: 400, y: 200, width: 800, height: 450 } });
          }
        }
      }
      await page.evaluate(() => { window.__district.crowd.emoteLayer.force = null; });
      // Their breath in the cold (the night's pass is winter): in front of the nearest few, a second and a bit apart.
      if (await page.evaluate(() => window.__district.crowd.cold > 0.5)) {
        // (Through the settings: the page applies them every frame.)
        await page.evaluate(() => { window.__mood.mobEmotes = false; });
        for (const [i, n] of near.slice(0, 3).entries()) {
          await place(n, 2.6);
          await page.waitForTimeout(1500);
          for (let f = 0; f < 8; f++) {
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${out}/city_${tag}_breath${i}_${f}.png`, clip: { x: 560, y: 300, width: 480, height: 300 } });
          }
        }
        await page.evaluate(() => { window.__mood.mobEmotes = true; });
      }
    }
    if (parts.includes('perf') && time === 'day') {
      // What the emotes cost: the GPU's and CPU's medians with them off and on, a few times over. (Through the
      // settings: the page applies them every frame. The breath is there only in the cold: add &season=winter and
      // a night's clock to the query to have it in both.)
      await page.evaluate(() => { const L = window.__district.crowd.emoteLayer; L.force = null; L.rate = 0.25; });
      const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
      for (let round = 0; round < 3; round++) {
        for (const on of [false, true]) {
          await page.evaluate((on) => { window.__mood.mobEmotes = on; }, on);
          await page.waitForTimeout(7000);
          const p = await page.evaluate(() => ({ gpu: window.__perf.gpu.slice(-300), cpu: window.__perf.cpu.slice(-300) }));
          console.log(`perf emotes ${on ? 'on ' : 'off'}: gpu ${med(p.gpu).toFixed(2)} ms, cpu ${med(p.cpu).toFixed(2)} ms`);
        }
      }
      console.log(JSON.stringify(await layer()));
    }
    await page.close();
  }
}
for (const [k, n] of warned) console.log(`WARNED x${n}: ${k}`);
await browser.close();
await server.close();
