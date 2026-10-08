// Kill moves on the fight page (fight.html): each one forced on a thug in front of you, photographed through
// it (first person, or its cinematic angle), and the group coming at you.
//   node debug-shots/killshots.mjs <out dir> [ids, comma separated | group]     (THIRD=1: in third person)
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(',') : null;
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}fight.html`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
if (process.env.THIRD) await page.evaluate(() => __fp.third(true));
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const state = async () => JSON.stringify(await page.evaluate(() => __fp.state()));
// Somewhere open, and a wall (for the wall slam) 2 m ahead of where the thug will stand.
await page.evaluate(async () => {
  await __fp.enter(0, 3, 0);
  __fp.look(0, -0.05);
  const { THREE, scene } = window.__lab;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.3), new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 }));
  wall.position.set(0, 1.5, 3 - 2.3);
  wall.name = 'test-wall';
  scene.add(wall);
});
const setup = async (hand) => {
  await page.evaluate((hand) => {
    __fp.look(0, -0.05);
    __fp.camera().position.set(0, __fp.camera().position.y, 3);
    __fp.hand(hand);
    __fp.killChance(1);
    __fp.gore('full');
    __fp.spawn(1);
  }, hand);
  await page.waitForFunction(() => __fp.thugs().length > 0 && __fp.thugs()[0].root.visible, null, { timeout: 60000, polling: 200 });
  // Stand him 1.1 m ahead, facing you.
  await page.evaluate(() => {
    const t = __fp.thugs()[0];
    const c = __fp.camera().position;
    t.place(c.x, 0, c.z - 1.1, Math.PI);
    __fp.thugs().slice(1).forEach((x) => (x.root.visible = false));
  });
  await wait(400);
};
const moves = [
  ['run_through', 'katana', [250, 450, 800, 1300]],
  ['decapitate', 'katana', [300, 700, 950, 1500]],
  ['neck_snap', 'fists', [300, 550, 700, 1200]],
  ['wall_slam', 'fists', [250, 640, 1100, 1700]],
  ['shotgun_jaw', 'gun', [300, 560, 700, 1300]],
  ['bat_homerun', 'bat', [420, 620, 700, 820, 1100]],
  ['bat_breaker', 'bat', [330, 480, 640, 800, 960, 1150]],
];
for (const [id, hand, times] of moves) {
  if (only && !only.includes(id)) continue;
  await setup(hand);
  if (hand === 'katana') {
    await page.evaluate(() => __fp.draw());
    await wait(900);
  }
  if (hand === 'fists') {
    await page.evaluate(() => __fp.draw());
    await wait(300);
  }
  if (hand === 'bat') {
    await page.evaluate(() => __fp.draw());
    await wait(700);
  }
  if (hand === 'gun') await page.evaluate(() => { __fp.armed(true); __fp.kind('lever'); });
  await wait(200);
  if (id === 'wall_slam') console.log('probe', await page.evaluate(() => { const t = __fp.thugs()[0]; const p = t.bone('spine_02').getWorldPosition(t.root.position.clone()); const c = __fp.camera().position; return JSON.stringify({ p, c, wall: __fp.probe(p, p.clone().sub(c).setY(0).normalize(), 1.7), vis: __fp.thugs().map((x) => x.root.visible) }); }));
  await page.evaluate(() => { const t = __fp.thugs()[0]; const c = __fp.camera().position; t.place(c.x, 0, c.z - 1.1, Math.PI); t.update(0.016, { you: c, youYaw: 0, others: [t], floorAt: () => 0, mayAttack: () => false, attacked: () => {} }); });
  const ok = await page.evaluate((id) => __fp.forceKill(id), id);
  console.log(id, 'started', ok);
  let last = 0;
  for (const [i, t] of times.entries()) {
    await wait(t - last);
    last = t;
    await shot(`${id}_${i}`);
  }
  await wait(1200);
  await shot(`${id}_after`);
  console.log(id, await state());
}
if (!only || only.includes('stomp')) {
  await setup('fists');
  await page.evaluate(() => __fp.draw());
  await page.evaluate(() => { const t = __fp.thugs()[0]; t.hit({ point: t.root.position.clone(), dir: __fp.camera().getWorldDirection(t.root.position.clone()).setY(0).normalize(), part: 'torso', damage: 1, force: 4, cut: false, move: 'kick', hitter: 'foot_r' }); });
  await page.waitForFunction(() => __fp.thugs()[0].floored, null, { timeout: 5000, polling: 100 }).catch(() => console.log('not floored'));
  await wait(700);
  console.log('stomp started', await page.evaluate(() => __fp.forceKill('stomp')));
  for (const [i, t] of [300, 500, 900].entries()) {
    await wait(i === 0 ? t : 220);
    await shot(`stomp_${i}`);
  }
  await wait(1500);
  await shot('stomp_after');
}
if (!only || only.includes('group')) {
  await page.evaluate(() => { __fp.camera().position.set(0, __fp.camera().position.y, 7); __fp.look(0, -0.05); __fp.hand('fists'); __fp.killChance(0.8); __fp.spawn(4); __fp.draw(); });
  await page.waitForFunction(() => __fp.thugs().filter((t) => t.root.visible).length >= 4, null, { timeout: 60000, polling: 200 });
  for (let i = 0; i < 5; i++) {
    await wait(1200);
    await shot(`group_${i}`);
    console.log('group', i, await state());
  }
  // Fight back: turn to the nearest one standing and hit him, again and again.
  for (let i = 0; i < 40; i++) {
    await page.evaluate((i) => {
      const c = __fp.camera().position;
      const up = __fp.thugs().filter((t) => t.root.visible && t.alive);
      up.sort((a, b) => a.root.position.distanceTo(c) - b.root.position.distanceTo(c));
      if (up[0]) {
        const p = up[0].root.position;
        __fp.look(Math.atan2(-(p.x - c.x), -(p.z - c.z)), -0.12);
      }
      __fp.attack(['left', 'right', null, 'up', null][i % 5]);
    }, i);
    await wait(300);
    if (i % 10 === 9) await shot(`group_fight_${i}`);
  }
  await shot('group_fight');
  console.log('group after', await state());
}
await browser.close(); await server.close();
