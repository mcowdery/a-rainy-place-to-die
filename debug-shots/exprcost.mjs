// What the expressway costs: triangles, draws and GPU time at a few viewpoints, with it shown and hidden.
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';

const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({
  channel: 'msedge',
  headless: false,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const spot of ['kaburo_crossing.view', 'city_garage.bay', 'city_hall.observatory', 'west_exit.plaza']) {
    await page.goto(`${base}?diag=1&debug=1&clock=22:00&weather=clear&res=100&spawn=${spot}`);
    await page.waitForFunction(() => window.__perf && window.__scene, null, { timeout: 180_000 });
    await page.waitForTimeout(25_000);
    const measure = () => page.evaluate(async () => {
      window.__perf.gpu.length = 0;
      window.__perf.cpu.length = 0;
      await new Promise((r) => setTimeout(r, 4000));
      const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[s.length >> 1] * 100) / 100 : null; };
      const kids = window.__scene.children;
      const i = kids.findIndex((c) => c.getObjectByName && c.getObjectByName('sodium'));
      kids[i].name = 'EXPRESSWAY';
      kids[i + 1].name = 'EX_TRAFFIC';
      return { gpu: med(window.__perf.gpu), cpu: med(window.__perf.cpu), total: window.__renderer.info.render.triangles, tris: window.__tris().slice(0, 8) };
    });
    const on = await measure();
    await page.evaluate(() => {
      const kids = window.__scene.children;
      const i = kids.findIndex((c) => c.getObjectByName && c.getObjectByName('sodium'));
      kids[i].visible = false;
      kids[i + 1].visible = false; // its traffic
    });
    const off = await measure();
    console.log(`\n## ${spot}`);
    console.log(`  shown : gpu ${on.gpu} ms, cpu ${on.cpu} ms`);
    console.log(`  hidden: gpu ${off.gpu} ms, cpu ${off.cpu} ms`);
    console.log('  in view (shown):', on.tris.join(' | '));
    console.log('  in view (hidden):', off.tris.join(' | '));
  }
} finally {
  await browser.close();
  await server.close();
}
