// A day's light from the observatory, facing the sun's side: node debug-shots/dayshots.mjs [times] [extra query] [tag]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const times = (process.argv[2] ?? '06:00,07:30,12:00,17:20,18:10,18:40,19:20,22:00').split(',');
const extra = process.argv[3] ?? '';
const tag = process.argv[4] ?? '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  for (const t of times) {
    for (let tries = 0; tries < 2; tries++) {
      await page.goto(`${base}?debug=1&diag=1&clock=${t}&weather=clear&fly=1&cam=3816,95,1562,0,0${extra ? '&' + extra : ''}`);
      try {
        await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 180_000, polling: 500 });
        break;
      } catch { console.log('retry', t); }
    }
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
    await page.waitForTimeout(3500);
    // Face the sun's side of the sky (or, at night, the west), looking a little down over the city.
    await page.evaluate(() => {
      const c = window.__camera;
      const sky = window.__scene.children.find((o) => o.material?.uniforms?.uSunPos);
      const s = sky.material.uniforms.uSunPos.value.clone();
      s.y = 0;
      if (s.length() < 0.1) s.set(-1, 0, 0);
      s.normalize();
      s.y = -0.12;
      c.lookAt(c.position.clone().add(s));
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `debug-shots/sky/day${tag}-${t.replace(':', '')}.png` });
    console.log(t);
  }
} finally {
  await browser.close();
  await server.close();
}
