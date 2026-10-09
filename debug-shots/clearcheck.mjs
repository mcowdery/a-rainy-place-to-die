// The debug menu's Summer and Clear: node debug-shots/clearcheck.mjs
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`${base}district.html?debug=1&diag=1&clock=17:40&weather=rain&fly=1&cam=3816,95,1562,0,0`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 180_000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(2000);
  const sky = () => page.evaluate(() => {
    const u = window.__scene.children.find((o) => o.material?.uniforms?.uSunPos).material.uniforms;
    return { cover: +u.uCover.value.toFixed(3), phys: +u.uPhys.value.toFixed(2) };
  });
  console.log('raining:', JSON.stringify(await sky()));
  await page.evaluate(() => window.__menu.show('Time & weather'));
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '夏 summer', exact: true }).click();
  await page.waitForTimeout(500);
  const on = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.style.background.includes('31, 90, 60') || b.style.background === 'rgb(31, 90, 60)').map((b) => b.textContent));
  console.log('after Summer, highlighted:', JSON.stringify(on));
  await page.getByRole('button', { name: 'clear', exact: true }).click();
  for (const s of [2, 6, 12, 16]) {
    await page.waitForTimeout(s === 2 ? 2000 : 4000);
    console.log(`clear +${s}s:`, JSON.stringify(await sky()));
  }
  await page.keyboard.press('Backquote');
  await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
  await page.evaluate(() => {
    const c = window.__camera;
    const s = window.__scene.children.find((o) => o.material?.uniforms?.uSunPos).material.uniforms.uSunPos.value.clone();
    s.y = 0; s.normalize(); s.y = -0.12;
    c.lookAt(c.position.clone().add(s));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'debug-shots/sky/clearcheck.png' });
} finally {
  await browser.close();
  await server.close();
}
