// The enemies' line-ups on the MakeHuman test page (humans.html; scripts/blender/enemy_figures.py): each faction's
// line-up in the studio's light and at night, then every figure close (head and shoulders: front, three-quarters, side).
//   node debug-shots/enemyshots.mjs <out dir> [faction prefix: rk|cp]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const only = process.argv[3] ?? null;
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
const wait = (ms) => page.waitForTimeout(ms);
const loaded = () => page.waitForFunction(() => window.__humans && __humans.waiting() === 0, null, { timeout: 180000, polling: 250 });
await page.goto(`${server.resolvedUrls.local[0]}humans.html?labels=1&light=studio`);
await loaded();
const lineups = (await page.evaluate(() => __humans.items)).filter((v) => /^(Ryujin Kogyo's men|chinpira) \(/.test(v)).filter((v) => !only || v.startsWith(only === 'rk' ? 'Ryujin' : 'chinpira'));
for (const v of lineups) {
  const slug = v.startsWith('Ryujin') ? 'rk' : 'cp';
  await page.evaluate((name) => __focus(name), v);
  await loaded();
  await page.keyboard.press('Digit1');
  await wait(2500);
  await page.screenshot({ path: `${out}/${slug}_lineup_studio.png` });
  await page.keyboard.press('Digit2');
  await wait(1200);
  await page.screenshot({ path: `${out}/${slug}_lineup_night.png` });
  await page.keyboard.press('Digit1');
  await page.keyboard.press('KeyL');
  const people = await page.evaluate((name) => {
    const st = __humans.stages.find((s) => name.startsWith(s.name.split(' (')[0]));
    return st.people.map((p) => ({ name: p.human.name, x: p.x, z: p.z, h: p.c ? new __lab.THREE.Box3().setFromObject(p.c.root).max.y : 1.7 }));
  }, v);
  for (const p of people) {
    const y = p.h - 0.2;
    await page.evaluate(([x, y, z]) => __view(x, y + 0.05, z + 1.25, x, y - 0.1, z), [p.x, y, p.z]);
    await wait(500);
    await page.screenshot({ path: `${out}/${p.name}_front.png`, clip: { x: 500, y: 100, width: 600, height: 700 } });
    await page.evaluate(([x, y, z]) => __view(x + 0.9, y, z + 0.95, x, y - 0.12, z), [p.x, y, p.z]);
    await wait(400);
    await page.screenshot({ path: `${out}/${p.name}_three_quarter.png`, clip: { x: 500, y: 100, width: 600, height: 700 } });
    // (The side, where a long head shows: close, between him and the next man in the line-up, a metre off.)
    await page.evaluate(([x, y, z]) => __view(x + 0.55, y, z + 0.02, x, y - 0.03, z), [p.x, y, p.z]);
    await wait(400);
    await page.screenshot({ path: `${out}/${p.name}_side.png`, clip: { x: 500, y: 100, width: 600, height: 700 } });
  }
  await page.keyboard.press('KeyL');
}
await browser.close();
await server.close();
