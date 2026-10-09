// Headroom for the people in the windows (city.ts, windowAtlas.ts): how many texture units the city's programs use of
// the GPU's limit, the textures' sizes, and how long the atlases took to build at startup.
//   node debug-shots/windowheadroom.mjs [query]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const extra = process.argv[2] ? `&${process.argv[2]}` : '&clock=20:30';
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const t0 = Date.now();
await page.goto(`${server.resolvedUrls.local[0]}?diag=1&weather=clear&res=100${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 600000, polling: 250 });
console.log('page ready (s)', ((Date.now() - t0) / 1000).toFixed(1));
await page.waitForTimeout(4000);
const res = await page.evaluate(() => {
  const gl = window.__renderer.getContext();
  const SAMPLERS = new Set([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_ARRAY_SHADOW, gl.SAMPLER_CUBE_SHADOW, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D]);
  const progs = [];
  for (const p of window.__renderer.info.programs) {
    const fs = gl.getShaderSource(p.fragmentShader);
    if (!fs.includes('roomHit(')) continue;
    const n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS);
    const names = [];
    let units = 0;
    for (let i = 0; i < n; i++) {
      const u = gl.getActiveUniform(p.program, i);
      if (!SAMPLERS.has(u.type)) continue;
      units += u.size;
      names.push(u.size > 1 ? `${u.name}x${u.size}` : u.name);
    }
    progs.push({ units, names: names.join(' '), chars: fs.length });
  }
  const U = window.__city;
  const tex = (t) => (t?.image ? `${t.image.width}x${t.image.height}` : 'none');
  return {
    limit: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    combined: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
    progs,
    shop: tex(U.tShopCol?.value),
    mask: tex(U.tShopMask?.value),
    built: U.tShopMask?.value?.userData ?? null,
    shopMs: U.tShopCol?.value?.userData?.ms ?? null,
  };
});
console.log('texture units a fragment shader may use', res.limit, '(combined', res.combined + ')');
for (const p of res.progs) console.log('city program:', p.units, 'units ·', p.chars, 'chars ·', p.names);
console.log('shop atlas', res.shop, '· mask and window scenes', res.mask, '· shop atlas built in', res.shopMs, 'ms');
if (res.built) console.log('window scenes:', res.built.scenes?.length, 'in', res.built.rows, 'px of rows, painted in', res.built.windowMs, 'ms');
await browser.close();
await server.close();
