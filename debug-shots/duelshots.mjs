// A duel in the showroom's first person: the swordsman's guard, his blow and the indicator, a deflect timed
// to his blow, swings into and round his guard, his posture broken and the deathblow.
//   node debug-shots/duelshots.mjs <out dir>
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const el = () => page.evaluate(() => { const e = __fp.thugs().find((t) => t.tier === 'elite'); return e && { state: e.state, guard: e.guard, posture: Math.round(e.posture), health: Math.round(e.health), incoming: e.incoming, move: e.melee.move?.id ?? null, phase: +e.melee.phase.toFixed(2) }; });
const st = async (tag) => console.log(tag, JSON.stringify(await el()), JSON.stringify(await page.evaluate(() => { const b = __fp.brawl(); return { you: Math.round(b.health), posture: Math.round(b.posture), stun: +b.stun.toFixed(2), last: b.lastHit, run: b.run?.def.id ?? null }; })));
await page.evaluate(async () => { await __fp.enter(14, 30, 0); __fp.look(0, -0.05); __fp.hand('katana'); __fp.gore('full'); __fp.duel(); });
await page.waitForFunction(() => __fp.thugs().some((t) => t.tier === 'elite' && t.root.visible), null, { timeout: 60000, polling: 200 });
await page.evaluate(() => __fp.draw());
await wait(1500);
await shot('d1_guard');
await st('guard');
// Outside view of you both.
await page.evaluate(() => { __fp.freeze(true); __fp.headless(false); const c = __fp.camera(); window.__saved = { p: c.position.clone(), q: c.quaternion.clone() }; const e = __fp.thugs().find((t) => t.tier === 'elite').root.position; __view(c.position.x + 2.5, 1.7, (c.position.z + e.z) / 2 + 0.3, c.position.x, 1.2, (c.position.z + e.z) / 2); });
await wait(400);
await shot('d2_outside');
await page.evaluate(() => { const c = __fp.camera(); c.position.copy(window.__saved.p); c.quaternion.copy(window.__saved.q); __fp.headless(true); __fp.freeze(false); });
// Wait for his blow; deflect it just before it lands.
let deflected = false;
for (let tries = 0; tries < 6 && !deflected; tries++) {
  await page.waitForFunction(() => { const e = __fp.thugs().find((t) => t.tier === 'elite'); return e.melee.move && e.melee.phase > 0.22; }, null, { timeout: 15000, polling: 16 });
  await shot(`d3_incoming_${tries}`);
  await page.waitForFunction(() => { const e = __fp.thugs().find((t) => t.tier === 'elite'); return !e.melee.move || e.melee.phase > (e.melee.move.active[0] - 0.12); }, null, { timeout: 5000, polling: 8 });
  await page.evaluate(() => __fp.guard(true));
  await wait(250);
  await shot(`d4_after_guard_${tries}`);
  await page.evaluate(() => __fp.guard(false));
  await st(`deflect try ${tries}`);
  deflected = (await page.evaluate(() => __fp.brawl().lastHit)) === 'deflected';
  await wait(300);
}
// Swing into his guard, and round it.
for (let i = 0; i < 8; i++) {
  const g = (await el()).guard;
  // His left is covered by your swing from your right (mouse left).
  const into = { left: 'left', right: 'right', high: 'down' }[g];
  const round = { left: 'right', right: 'left', high: 'left' }[g];
  await page.evaluate((d) => __fp.attack(d), i % 2 ? round : into);
  await wait(650);
  await st(`swing ${i % 2 ? 'round' : 'into'} ${g}`);
}
await shot('d5_after_swings');
// Break him: keep at it till he's open, then the deathblow.
for (let i = 0; i < 40; i++) {
  const e = await el();
  if (!e || e.state === 'dead' || e.state === 'scripted') break;
  if (e.state === 'broken') {
    await shot('d6_broken');
    await page.evaluate(() => __fp.attack(null));
    await wait(400);
    await shot('d7_deathblow');
    await st('deathblow');
    await wait(1500);
    await shot('d8_after');
    break;
  }
  await page.evaluate((g) => __fp.attack({ left: 'left', right: 'right', high: 'down' }[g]), e.guard);
  await wait(600);
}
await st('end');
await browser.close(); await server.close();
