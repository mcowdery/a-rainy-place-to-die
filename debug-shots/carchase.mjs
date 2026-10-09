// Car chases and the pistol from your car, in the city: starts a job, drives it, logs how it goes and photographs it.
// node debug-shots/carchase.mjs <out dir> [job id] [mode] [spawn] [query]
//   mode: 'tail' (a hunt: your car drives itself after the runner and shoots at it), 'run' (hunted: your car is driven
//   off down the road while they come after you), 'stunts' (no job: a burnout, a donut, a handbrake 180 and a J-turn
//   in a car park), 'gun' (no job: the views with the pistol out of each window).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/carchase';
const job = process.argv[3] ?? 'runner';
const mode = process.argv[4] ?? 'tail';
const spawn = process.argv[5] ?? 'city_garage.front';
const extra = process.argv[6] ? `&${process.argv[6]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('framenavigated', (f) => f === page.mainFrame() && console.log('NAVIGATED', f.url().slice(0, 160)));
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.addInitScript(() => localStorage.setItem('citypop.driveView', 'chase'));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=${spawn}&car=home&clock=14:00&weather=clear${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__chase, null, { timeout: 60000 });
await page.waitForTimeout(3000);
let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}_${name}.png` });
const own = () =>
  page.evaluate(() => {
    const s = window.__own.sim;
    return { at: [Math.round(s.x), Math.round(s.z)], h: Math.round((s.h * 180) / Math.PI), kmh: Math.round(s.u * 3.6), w: +s.w.toFixed(1), stunt: s.stunt, spin: +s.spin.toFixed(2), damage: Math.round(window.__own.condition) };
  });
const keys = async (down, ms, up = down) => {
  for (const k of down) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of up) await page.keyboard.up(k);
};
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(1500);

if (mode === 'stunts') {
  // A burnout, then out of it into a donut; a handbrake 180; reversing with the wheel over; a J-turn.
  console.log('start', JSON.stringify(await own()));
  await keys(['KeyW', 'KeyS'], 2500);
  console.log('burnout', JSON.stringify(await own()));
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(1200);
  await shot('burnout');
  await page.keyboard.down('KeyA');
  await page.keyboard.up('KeyS');
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1500);
    console.log('donut', JSON.stringify(await own()));
    if (i === 1) await shot('donut');
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(2500);
  console.log('after', JSON.stringify(await own()));
  // Out on the avenue (auto drive to get there and line the car up), then: up to speed, the handbrake held with the
  // wheel over (a 180), away; backing up, then the wheel over and the throttle (a J-turn).
  console.log('gps', await page.evaluate((d) => window.__gps(d), process.argv[6] ?? 'yoru_mart.front'));
  await page.evaluate(() => window.__auto.set('traffic'));
  await page.waitForTimeout(9000);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3200);
  const before = await own();
  console.log('at speed', JSON.stringify(before));
  await page.keyboard.up('KeyW');
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(700);
  await shot('handbrake_turn');
  await page.waitForTimeout(1100);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(500);
  const round = await own();
  console.log('handbrake 180', JSON.stringify(round), 'turned', round.h - before.h);
  await keys(['KeyW'], 2500);
  console.log('away', JSON.stringify(await own()));
  await page.waitForTimeout(2500);
  await keys(['KeyS'], 2800);
  const backing = await own();
  console.log('backing', JSON.stringify(backing));
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  await shot('j_turn');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  const j = await own();
  console.log('J-turn', JSON.stringify(j), 'turned', j.h - backing.h);
  // (And straight on from it, down the avenue it's now facing: the handbrake turn again, with room.)
  await keys(['KeyW'], 1800);
  const fast = await own();
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(650);
  await shot('handbrake_turn_2');
  await page.waitForTimeout(1150);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(400);
  const spun = await own();
  console.log('handbrake 180 from', fast.kmh, 'km/h:', JSON.stringify(spun), 'turned', spun.h - fast.h);
} else if (mode === 'gun') {
  // The pistol out of each window: aimed ahead, to the right, behind, and across the car to the left; from the hip.
  await page.evaluate(() => window.__chase.gun.raise(true));
  for (const [name, yaw] of [['ahead', 0], ['right', -1.3], ['behind', -2.6], ['across', 1.2], ['windscreen', 0.5]]) {
    await page.evaluate((y) => {
      const d = window.__bike.driving;
      d.aim.yaw = window.__own.sim.h + y;
      d.aim.pitch = 0;
    }, yaw);
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__chase.fire());
    await page.waitForTimeout(120);
    await shot(`aim_${name}`);
    console.log(name, await page.evaluate(() => ({ side: window.__chase.gun.side, out: window.__chase.gun.out, slow: +window.__chase.gun.slow.toFixed(2), focus: +window.__chase.gun.focus.toFixed(2) })));
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.__chase.lower());
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__chase.fire());
  await page.waitForTimeout(200);
  await shot('hip_chase_view');
  await page.waitForTimeout(4000);
  await shot('gun_away');
} else {
  console.log('start', job, await page.evaluate((id) => window.__chase.start(id), job));
  await page.waitForTimeout(800);
  await shot('grid');
  if (mode === 'tail') await page.evaluate(() => window.__chase.tail(true));
  else {
    // Hunted: off down the road at speed (the auto drive, fast, to somewhere far).
    console.log('gps', await page.evaluate(() => window.__gps('kaburo_crossing.view')));
    await page.evaluate(() => window.__auto.set('fast'));
  }
  for (let t = 0; t < 150; t += 2) {
    await page.waitForTimeout(2000);
    const st = await page.evaluate(() => window.__chase.state());
    console.log(t + 2, JSON.stringify({ own: await own(), ...st }));
    if (!st || st.phase === 'over') break;
    // A hunt: shoot at the runner whenever there's a line.
    if (mode === 'tail' && st.phase === 'running' && st.cars[0].d < 45) {
      await page.evaluate(() => window.__chase.aim(0));
      await page.waitForTimeout(250);
      for (let k = 0; k < 3; k++) {
        await page.evaluate(() => (window.__chase.aim(0), window.__chase.fire()));
        await page.waitForTimeout(220);
      }
      console.log('  shot at him:', await page.evaluate(() => ({ side: window.__chase.gun.side, health: window.__chase.state()?.cars[0].health })));
      if (n < 14 && t % 6 === 0) await shot('aimed');
      await page.evaluate(() => window.__chase.lower());
    } else if (n < 14 && t % 10 === 0) await shot('chase');
  }
  await page.waitForTimeout(600);
  await shot('result');
}
await browser.close();
await server.close();
