// Contact sheets of the melee moves on the fight page (fight.html): each move held at several points of its
// swing and photographed in third person (the game's camera behind him, from his front quarter, from his side)
// and in first person, one sheet a move; and each stance at rest. For judging a swing as a whole body's.
//   node debug-shots/movesheet.mjs <out dir> <fists|katana|bat> [move ids, comma separated | stances] [phases, comma separated]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const weapon = process.argv[3] ?? 'katana';
const only = process.argv[4] ? process.argv[4].split(',') : null;
const phases = process.argv[5] ? process.argv[5].split(',').map(Number) : [0, 0.2, 0.34, 0.44, 0.52, 0.6, 0.68, 0.85];
const W = 380;
const H = 340;
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}fight.html`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1200);
await page.evaluate(() => { for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none'; });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// Alone in the yard, the weapon out.
await page.evaluate(async ([weapon, oneHand, clips]) => {
  await __fp.enter(0, 3, 0);
  __fp.look(0, -0.08);
  __fp.hand(weapon);
  __fp.spawn(0);
  __fp.draw();
  // ONEHAND=1: in the right hand alone.
  __fp.melee().oneHand = oneHand;
  // CLIPS=1: the animation library's swings (their ids from `__fp.clipMoves()`).
  if (clips) await __fp.style('clips');
}, [weapon, !!process.env.ONEHAND, !!process.env.CLIPS]);
await page.waitForTimeout(1500);
// ZONES=1: the swings a click gives now, each stance's at each zone (from the right).
const info = await page.evaluate(([clips, zones]) => { __fp.autoStance(false); return { moves: zones ? __fp.zoneMoves() : clips ? __fp.clipMoves() : __fp.moves ? __fp.moves() : null, stances: __fp.stances ? __fp.stances() : null }; }, [!!process.env.CLIPS, !!process.env.ZONES]);
const ids = only && only[0] !== 'stances' ? only : (info.moves ?? []);
// The outside views, from where he stands (x, y, z, then what they look at).
const VIEWS = { front: [1.25, 1.5, -2.0, 0, 1.15, -0.3], side: [2.5, 1.3, -0.3, 0, 1.15, -0.3] };
const cell = async (third, view) => {
  await page.evaluate((third) => __fp.third(third), third);
  await frames(4);
  if (view) {
    await page.evaluate((v) => { __fp.freeze(true); const c = __fp.rig().object.children[0].position; __view(c.x + v[0], v[1], c.z + v[2], c.x + v[3], v[4], c.z + v[5]); }, view);
    await frames(2);
  }
  const png = await page.screenshot();
  if (view) {
    await page.evaluate(() => __fp.freeze(false));
    await frames(2);
  }
  return png.toString('base64');
};
const sheetPage = await browser.newPage({ viewport: { width: 100, height: 100 } });
const sheet = async (name, cols) => {
  // cols: [{ label, cells: [base64...] }]
  const rows = cols[0].cells.length;
  let html = `<body style="margin:0;background:#111;color:#ddd;font:12px Consolas,monospace"><table cellspacing="2" cellpadding="0"><tr>${cols.map((c) => `<td>${c.label}</td>`).join('')}</tr>`;
  for (let r = 0; r < rows; r++) html += `<tr>${cols.map((c) => `<td><img width="${W * SCALE}" height="${H * SCALE}" src="data:image/png;base64,${c.cells[r]}"></td>`).join('')}</tr>`;
  html += '</table></body>';
  await sheetPage.setContent(html);
  await sheetPage.waitForTimeout(150);
  const el = await sheetPage.$('table');
  await el.screenshot({ path: `${out}/${name}.png` });
};
// ROWS=third,front,side,first picks the views (all four by default); SCALE the size they're shown at.
const ROWS = (process.env.ROWS ?? 'third,front,side,first').split(',');
const SCALE = Number(process.env.SCALE ?? 0.75);
const shootAll = async () => {
  const cells = [];
  for (const r of ROWS) cells.push(r === 'third' ? await cell(true, null) : r === 'first' ? await cell(false, null) : await cell(true, VIEWS[r]));
  return cells;
};
if (!only || only[0] === 'stances') {
  const cols = [];
  for (const s of info.stances ?? ['mid']) {
    await page.evaluate((s) => { const m = __fp.melee(); m.cancel(); if (m.setStance) m.setStance(s); }, s);
    await page.waitForTimeout(600);
    cols.push({ label: `${weapon} · ${s} stance`, cells: await shootAll() });
  }
  await page.evaluate(() => { __fp.guard(true); });
  await page.waitForTimeout(500);
  cols.push({ label: `${weapon} · guard`, cells: await shootAll() });
  await page.evaluate(() => { __fp.guard(false); });
  await sheet(`${weapon}_stances`, cols);
  console.log('stances');
}
if (!only || only[0] !== 'stances') {
  for (const id of ids) {
    const cols = [];
    for (const ph of phases) {
      const ok = await page.evaluate(([id, ph]) => {
        const m = __fp.melee();
        m.cancel();
        const st = /^[kb]z_/.test(id) ? id.split('_')[1] : __fp.stanceOf ? __fp.stanceOf(id) : null;
        if (st && m.setStance) m.setStance(st, true);
        m.rate = 1;
        m.play(id);
        if (!m.move) return false;
        m.rate = 0;
        m.t = ph * m.move.time;
        return true;
      }, [id, ph]);
      if (!ok) break;
      cols.push({ label: `${id} · ${ph}`, cells: await shootAll() });
    }
    await page.evaluate(() => { const m = __fp.melee(); m.rate = 1; m.cancel(); });
    if (cols.length) await sheet(`${weapon}_${id}`, cols);
    console.log(id);
  }
}
await browser.close(); await server.close();
