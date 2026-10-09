// A check of the pistol from the driver's window: how near ahead there's a line of fire, the blocked crosshair with
// the gun pulled back, the flash, and the engine's smoke from the cockpit.
// node debug-shots/_lean.mjs <out dir> [parts: aim,hip,smoke]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/lean';
const parts = (process.argv[3] ?? 'aim,hip,smoke').split(',');
const clock = process.argv[4] ?? '14:00';
const spawn = process.argv[5] ?? 'city_garage.front';
const view = process.argv[6] ?? 'chase';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const big = parts.includes("holes") || parts.includes("hip") || parts.includes("flashout") || parts.includes("side");
const page = await browser.newPage({ viewport: big ? { width: 1900, height: 1060 } : { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.addInitScript((v) => localStorage.setItem('citypop.driveView', v), view);
if (parts.includes('saloon') || parts.includes('hardtop'))
  await page.addInitScript(() =>
    localStorage.setItem('citypop.race.v1.profile', JSON.stringify({ v: 1, yen: 1e6, earned: 0, current: 'car2', cars: [
      { id: 'car1', type: 'hatch', paint: 0xf0f0ec, paint2: 0x121316, parts: {}, livery: { stripes: null, side: null, number: null, banner: null }, neon: null, neonFitted: false },
      { id: 'car2', type: 'hardtop', paint: 0x0a0a0c, paint2: null, parts: {}, livery: { stripes: null, side: null, number: null, banner: null }, neon: null, neonFitted: false },
    ] })),
  );
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=${spawn}&car=home&clock=${clock}&weather=clear`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__chase, null, { timeout: 60000 });
await page.waitForTimeout(3000);
let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}_${name}.png`, ...(big ? { clip: { x: 600, y: 330, width: 700, height: 520 } } : {}) });
if (parts.includes('cig')) {
  // Light one on foot first (J), wait for it to be between his lips, then take the wheel.
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(9000);
}
if (parts.includes('drag')) {
  // On foot, third person: at each drag, how far the cigarette's mouth end is from the fingers that hold it and from
  // his mouth (standing, then squatting, then looking down at him). Then J straight after a flick.
  const rig = () => 'window.__chase.gun.host.rig()';
  await page.evaluate(() => localStorage.setItem('citypop.thirdPerson', '1'));
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(600);
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(7000);
  const drag = async (name) => {
    await page.evaluate(() => { const S = window.__chase.gun.host.rig().smoking; S.round = -1; S.wait = 0.05; });
    let worst = 0, n2 = 0, mouthOff = 0;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(60);
      const r = await page.evaluate(() => {
        const R = window.__chase.gun.host.rig();
        const S = R.smoking;
        const V = window.__camera.position.constructor;
        const f = R.arms.l.fingers;
        const p = (a, b) => f[a][b].getWorldPosition(new V());
        const g = p(0, 1).add(p(0, 2)).add(p(1, 1)).add(p(1, 2)).multiplyScalar(0.25);
        const stick = S.sticks[S.kind].root.position;
        const face = R.faceNow();
        const mouth = face.eye.clone().addScaledVector(face.up, -0.07).addScaledVector(face.fwd, 0.085);
        return { lift: S.lift, inHand: S.inHand, d: g.distanceTo(stick), m: mouth.distanceTo(stick), headless: R.headless };
      });
      if (r.lift > 0.97 && r.inHand) { worst = Math.max(worst, r.d); mouthOff = Math.max(mouthOff, r.m); n2++; }
      if (i === 22) await shot(`drag_${name}`);
    }
    console.log('drag', name, JSON.stringify({ samples: n2, fingersToCigarette_cm: +(worst * 100).toFixed(1), cigaretteToMouth_cm: +(mouthOff * 100).toFixed(1) }));
  };
  await page.evaluate(() => window.__turn(150));
  await page.waitForTimeout(900);
  await drag('standing');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(1500);
  await drag('squatting');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(1200);
  // J: flick, and at once J again (it used to do nothing for some seconds).
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(700);
  await page.keyboard.press('KeyJ');
  for (const t of [0.5, 1.5, 3]) {
    await page.waitForTimeout(t === 0.5 ? 500 : t === 1.5 ? 1000 : 1500);
    console.log('again', t, JSON.stringify(await page.evaluate(() => { const S = window.__chase.gun.host.rig().smoking; return { stage: S.stage, what: S.what }; })));
  }
  await browser.close();
  await server.close();
  process.exit(0);
}
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(1500);
if (parts.includes('cig')) {
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll('body > div, body > pre').forEach((d) => (d.style.visibility = 'hidden')));
  const tip = () => page.evaluate(() => {
    const o = window.__chase.gun.host.rig().smoking.out;
    const c = window.__camera;
    const p = o.tip.clone().project(c);
    return { lit: o.lit, ndc: [+p.x.toFixed(2), +p.y.toFixed(2)], dist: +o.tip.distanceTo(c.position).toFixed(2) };
  });
  for (const [name, yaw, pitch] of [['ahead', 0, 0], ['left', 0.9, 0], ['right', -0.9, 0], ['up', 0, 0.3], ['back', 2.0, 0]]) {
    for (let i = 0; i < 5; i++) {
      await page.evaluate(([y, p]) => window.__bike.driving.setLook(y, p), [yaw, pitch]);
      await page.waitForTimeout(220);
    }
    console.log('cig', name, JSON.stringify(await tip()));
    await shot(`cig_${name}`);
  }
}
const r2 = (v) => (Array.isArray(v) ? v.map((x) => +x.toFixed(2)) : v);
const state = () =>
  page.evaluate(() => {
    const c = window.__chase;
    const a = c.arm();
    return { side: c.gun.side, outFrom: +((c.seated().outFrom * 180) / Math.PI).toFixed(1), shift: c.seated().eyeShift.toArray().map((v) => +v.toFixed(2)), arm: a, muzzle: c.muzzle() };
  });
if (parts.includes('aim')) {
  await page.evaluate(() => window.__chase.gun.raise(true));
  for (const [name, deg] of [['ahead', 0], ['r3', -3], ['r6', -6], ['r10', -10], ['r20', -20], ['r40', -40], ['r75', -75], ['left15', 15]]) {
    await page.evaluate((y) => {
      const d = window.__bike.driving;
      d.aim.yaw = window.__own.sim.h + (y * Math.PI) / 180;
      d.aim.pitch = 0;
    }, deg);
    await page.waitForTimeout(1100);
    console.log(name, JSON.stringify(await state()));
    await shot(`aim_${name}`);
    await page.evaluate(() => window.__chase.fire());
    await page.waitForTimeout(30);
    await shot(`fire_${name}`);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.__chase.lower());
  await page.waitForTimeout(2500);
}
if (parts.includes('hip')) {
  // From the chase camera: the view swung a little to the right of ahead, a shot from the hip (he's seen from behind).
  for (const [name, deg] of [['r6', -6], ['r25', -25], ['ahead', 2]]) {
    const look = () => page.evaluate((y) => window.__bike.driving.setLook((y * Math.PI) / 180, 0), deg);
    for (let i = 0; i < 5; i++) {
      await look();
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => window.__chase.fire());
    for (let i = 0; i < 4; i++) {
      await look();
      await page.waitForTimeout(180);
    }
    console.log('hip', name, JSON.stringify(await state()));
    await shot(`hip_${name}`);
    await look();
    await page.evaluate(() => window.__chase.fire());
    await page.waitForTimeout(25);
    await shot(`hipfire_${name}`);
    await page.waitForTimeout(2500);
  }
}
// A shot held at its first frames: the gunfire's update is stopped once the flash is up.
const frozenShot = async (name, frames = 1) => {
  await page.evaluate(
    (frames) =>
      new Promise((done) => {
        const G = window.__chase.gun.host.gunfire;
        const shots = () => window.__chase.rig().fired;
        const before = shots();
        window.__chase.fire();
        let seen = 0;
        const tick = () => {
          if (shots() !== before && ++seen > frames) {
            G.held = G.update;
            G.update = () => {};
            done();
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
  await page.waitForTimeout(60);
  await shot(name);
  await page.evaluate(() => {
    const G = window.__chase.gun.host.gunfire;
    G.update = G.held;
  });
  await page.waitForTimeout(700);
};
if (parts.includes('flash')) {
  await page.evaluate(() => window.__chase.gun.raise(true));
  for (const [name, deg] of [['r8', -8], ['r30', -30], ['r80', -80], ['across', 70]]) {
    await page.evaluate((y) => {
      const d = window.__bike.driving;
      d.aim.yaw = window.__own.sim.h + (y * Math.PI) / 180;
      d.aim.pitch = 0;
    }, deg);
    await page.waitForTimeout(1300);
    await frozenShot(`flash_${name}`, 0);
    await frozenShot(`flash_${name}_b`, 1);
  }
  await page.evaluate(() => window.__chase.lower());
  await page.waitForTimeout(2500);
}
if (parts.includes('flashout')) {
  for (const [name, deg] of [['r30', -30], ['r90', -90]]) {
    const look = () => page.evaluate((y) => window.__bike.driving.setLook((y * Math.PI) / 180, 0), deg);
    for (let i = 0; i < 5; i++) {
      await look();
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => window.__chase.fire());
    for (let i = 0; i < 5; i++) {
      await look();
      await page.waitForTimeout(180);
    }
    await look();
    await frozenShot(`out_${name}`);
  }
}
if (parts.includes('side')) {
  // A flash on its own, seen from the side: 2 m ahead of the camera, the bore across the view.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const G = window.__chase.gun.host.gunfire;
      const cam = window.__camera;
      window.__n ??= 0;
      const THREE_UP = cam.position.constructor;
      const f = cam.getWorldDirection(cam.position.clone());
      const right = f.clone().cross(cam.up).normalize();
      const at = cam.position.clone().addScaledVector(f, 2).addScaledVector(right, -0.9 + 0.5 * window.__n).add(new THREE_UP(0, -0.55, 0));
      window.__n++;
      G.flashes.fire(at, right, 1);
      G.held = G.update;
      G.update = () => {};
    });
    await page.waitForTimeout(80);
    console.log('side', JSON.stringify(await page.evaluate(() => { const G = window.__chase.gun.host.gunfire; return { strength: G.flashes.strength, dark: G.dark, on: G.light.on(), at: G.flashes.at.toArray().map((v) => Math.round(v)), cam: window.__camera.position.toArray().map((v) => Math.round(v)) }; })));
    await shot(`side_${i}`);
    await page.evaluate(() => {
      const G = window.__chase.gun.host.gunfire;
      G.update = G.held;
    });
    await page.waitForTimeout(300);
  }
}
if (parts.includes('sound')) {
  console.log('sound', JSON.stringify(await page.evaluate(async () => {
    const G = window.__chase.gun.host.gunfire;
    G.resume();
    await G.gunSound.ready;
    return { voice: G.gunSound.voice, sets: [...G.gunSound.shots.entries()].map(([k, v]) => `${k}:${v.length}`).sort() };
  })));
}
if (parts.includes('holes')) {
  // Rounds into your own car from outside it (as the gunmen's are), and into the nearest traffic car: where they land.
  const out = await page.evaluate(() => {
    const G = window.__chase.gun.host.gunfire;
    const own = window.__own;
    const o = own.view.obj;
    const V = window.__camera.position.constructor;
    const res = [];
    const was = G.onCarHit;
    G.onCarHit = (c, h, by) => { window.__lastHit = { local: h.local.toArray().map((v) => +v.toFixed(2)), n: h.normal.clone().transformDirection(o.matrixWorld.clone().invert()).toArray().map((v) => +v.toFixed(2)), pane: h.pane }; was?.(c, h, by); };
    const shoot = (from, to) => {
      const muzzle = o.localToWorld(new V(...from));
      const dir = o.localToWorld(new V(...to)).sub(muzzle).normalize();
      const before = (G.carHits.cars.get(o)?.marks.length) ?? 0;
      G.shot({ muzzle, dir, spread: 0, sound: 'pistol', listener: window.__camera.position, by: 'test' });
      const st = G.carHits.cars.get(o);
      const b = own.view.body; b.geometry.computeBoundingBox();
      res.push({ to, marks: st?.marks.length ?? 0, added: (st?.marks.length ?? 0) - before, panes: st && { ...st.panes }, last: window.__lastHit, box: [b.geometry.boundingBox.min.y, b.geometry.boundingBox.max.y].map((v) => +v.toFixed(2)), kids: b.children.length, win: [!!own.view.windows.left, !!own.view.windows.right] });
    };
    // door, bonnet from ahead, windscreen from ahead, rear glass, the left window twice, the right window once
    shoot([4, 0.7, 0.3], [0, 0.7, 0.3]);
    shoot([0.3, 1.2, 6], [0.3, 0.75, 1.6]);
    shoot([0.25, 1.3, 6], [0.25, 1.05, 0.6]);
    shoot([-0.2, 1.3, -6], [-0.2, 1.05, -1.0]);
    shoot([4, 1.05, 0.1], [0, 1.05, 0.1]);
    shoot([4, 1.08, -0.1], [0, 1.08, -0.1]);
    shoot([-4, 1.05, 0.1], [0, 1.05, 0.1]);
    return { res, parts: { ...own.parts }, broken: [own.view.windows.left?.userData.broken, own.view.windows.right?.userData.broken] };
  });
  for (const r of out.res) console.log('hole', JSON.stringify(r));
  console.log('parts', JSON.stringify(out.parts), 'broken', JSON.stringify(out.broken));
  for (const [name, deg] of [['left', 75], ['front', 170], ['right', -110]]) {
    for (let i = 0; i < 4; i++) {
      await page.evaluate((y) => window.__bike.driving.setLook((y * Math.PI) / 180, 0.1), deg);
      await page.waitForTimeout(250);
    }
    await shot(`holes_${name}`);
  }
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1500);
  await shot('holes_cockpit');
}
if (parts.includes('saloon')) {
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelectorAll('body > div, body > pre').forEach((d) => (d.style.visibility = 'hidden')));
  await shot('saloon_chase');
  for (const [name, deg] of [['side', 88], ['front', 150], ['rear34', 35], ['front34', -140]]) {
    for (let i = 0; i < 4; i++) {
      await page.evaluate((y) => window.__bike.driving.setLook((y * Math.PI) / 180, 0.1), deg);
      await page.waitForTimeout(250);
    }
    await shot(`saloon_${name}`);
  }
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1500);
  await shot('saloon_cockpit');
  await page.evaluate(() => window.__chase.gun.raise(true));
  await page.evaluate(() => {
    const d = window.__bike.driving;
    d.aim.yaw = window.__own.sim.h - 0.5;
    d.aim.pitch = 0;
  });
  await page.waitForTimeout(1300);
  await shot('saloon_aim');
  console.log('saloon', JSON.stringify(await state()));
}
if (parts.includes('picker')) {
  // The debug menu's car picker, at the wheel: each pick swaps the car in place (no page load).
  let loads = 0;
  page.on('framenavigated', (f) => f === page.mainFrame() && loads++);
  for (const name of ['Seika Kurofune 3000 Brougham', 'Kaiun Tatsumaki RS', 'Seika Kurofune 3000 Brougham']) {
    await page.evaluate(() => window.__menu.show('Player'));
    await page.waitForTimeout(400);
    await page.getByText(name, { exact: true }).first().click();
    await page.waitForTimeout(1200);
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(500);
    console.log('picked', name, JSON.stringify(await page.evaluate(() => ({ name: window.__own.name, type: window.__own.view.type, driving: !!window.__bike.driving.car, kids: window.__own.view.obj.children.length, kmh: Math.round(window.__own.sim.u * 3.6) }))), 'page loads', loads);
    await page.evaluate(() => document.querySelectorAll('body > div, body > pre').forEach((d) => (d.style.visibility = 'hidden')));
    await shot(`picked_${name.split(' ')[1]}`);
    await page.evaluate(() => document.querySelectorAll('body > div, body > pre').forEach((d) => (d.style.visibility = '')));
  }
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  console.log('driven', JSON.stringify(await page.evaluate(() => ({ kmh: Math.round(window.__own.sim.u * 3.6), name: window.__own.name }))));
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1500);
  await shot('picked_cockpit');
}
if (parts.includes('lookback')) {
  // Z held, from each view; and the cab's side mirrors.
  const hide = () => page.evaluate(() => document.querySelectorAll('body > div, body > pre').forEach((d) => (d.style.visibility = 'hidden')));
  await hide();
  await page.waitForTimeout(600);
  await shot('chase');
  await page.keyboard.down('KeyZ');
  await page.waitForTimeout(900);
  await shot('chase_z');
  await page.keyboard.up('KeyZ');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1200);
  await shot('cab');
  await page.keyboard.down('KeyZ');
  await page.waitForTimeout(900);
  await shot('cab_z');
  await page.keyboard.up('KeyZ');
  for (const [name, yaw, pitch] of [['cab_right', -1.0, -0.05], ['cab_left', 0.75, -0.05]]) {
    for (let i = 0; i < 5; i++) {
      await page.evaluate(([y, p]) => window.__bike.driving.setLook(y, p), [yaw, pitch]);
      await page.waitForTimeout(250);
    }
    await shot(name);
  }
  // From outside, close: the mirrors' faces from behind each side, and their shells from in front.
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.setViewportSize({ width: 1900, height: 1060 });
  for (const [name, yaw] of [['out_behind_right', -0.55], ['out_behind_left', 0.55], ['out_front_right', -2.45], ['out_front_left', 2.45]]) {
    for (let i = 0; i < 5; i++) {
      await page.evaluate((y) => window.__bike.driving.setLook(y, 0.02), yaw);
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}_${name}.png`, clip: { x: 600, y: 380, width: 700, height: 440 } });
  }
}
if (parts.includes('mirrorperf')) {
  // What the mirrors cost, from the cab, standing: the frame's GPU and CPU time (ms) averaged over a few seconds, by setting.
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(2500);
  const measure = async (name, set) => {
    await page.evaluate(set);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__perf.gpu.length = 0;
      window.__perf.cpu.length = 0;
    });
    await page.waitForTimeout(4500);
    const r = await page.evaluate(() => {
      const avg = (a) => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);
      const p = window.__perf;
      return { gpu: avg(p.gpu), cpu: avg(p.cpu), frames: p.cpu.length };
    });
    console.log('perf', name.padEnd(34), JSON.stringify(r));
  };
  // (The door mirrors show no picture any more: only the cab's is measured.)
  const cfg = (mode, rw, rh, re) => `(() => { const M = window.__mirrors; M.mode('${mode}'); M.rear.target.setSize(${rw}, ${rh}); M.rear.every = ${re}; })()`;
  await measure('off', cfg('off', 256, 68, 3));
  await measure('256x68/3', cfg('cockpit', 256, 68, 3));
  await measure('512x136/3', cfg('cockpit', 512, 136, 3));
  await measure('768x204/3', cfg('cockpit', 768, 204, 3));
  await measure('512x136/2', cfg('cockpit', 512, 136, 2));
  await measure('512x136/1', cfg('cockpit', 512, 136, 1));
  await measure('off again', cfg('off', 256, 68, 3));
  console.log('groups', JSON.stringify(await page.evaluate(() => window.__scene.children.filter((o) => o.visible).map((o) => o.name || o.type).slice(0, 60))));
}
if (parts.includes('mirrorprof')) {
  // Where a mirror render's CPU time goes: one render straight back from the car, timed; then with each top-level group hidden in turn.
  const r = await page.evaluate(() => {
    const M = window.__mirrors.rear;
    M.every = 1;
    const R = window.__renderer;
    const S = window.__scene;
    const own = window.__own;
    const V = window.__camera.position.constructor;
    const at = new V(own.sim.x, own.view.obj.position.y + 1.25, own.sim.z);
    const back = new V(-Math.sin(own.sim.h), -0.03, -Math.cos(own.sim.h));
    const time = (n = 12) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) M.renderBack(R, S, at, back, 15, [own.view.obj]);
      R.getContext().finish();
      return (performance.now() - t0) / n;
    };
    time(4);
    const base = time(20);
    R.info.reset();
    M.renderBack(R, S, at, back, 15, [own.view.obj]);
    const calls = R.info.render.calls;
    const tris = R.info.render.triangles;
    let objects = 0;
    S.traverseVisible(() => objects++);
    const rows = [];
    S.children.forEach((o, i) => {
      if (!o.visible) return;
      let n = 0;
      o.traverseVisible(() => n++);
      o.visible = false;
      const t = time(8);
      o.visible = true;
      rows.push({ i, name: o.name || o.type, objects: n, saves: +(base - t).toFixed(2) });
    });
    rows.sort((a, b) => b.saves - a.saves);
    const auto = S.matrixWorldAutoUpdate;
    S.matrixWorldAutoUpdate = false;
    const noMatrix = time(12);
    S.matrixWorldAutoUpdate = auto;
    const sh = R.shadowMap.enabled;
    R.shadowMap.enabled = false;
    const noShadow = time(12);
    R.shadowMap.enabled = sh;
    return { base: +base.toFixed(2), calls, tris, objects, noMatrix: +noMatrix.toFixed(2), noShadow: +noShadow.toFixed(2), top: rows.slice(0, 12) };
  });
  console.log('prof', JSON.stringify(r));
}
if (parts.includes('mirror2')) {
  // The mirrors as they are now: what they cost from the cab, and the cars after you marked in them.
  const hide = () => page.evaluate(() => document.querySelectorAll('body > div, body > pre').forEach((d) => (d.style.visibility = 'hidden')));
  const measure = async (name, mode) => {
    await page.evaluate((m) => window.__mirrors.mode(m), mode);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__perf.gpu.length = 0;
      window.__perf.cpu.length = 0;
    });
    await page.waitForTimeout(5000);
    const r = await page.evaluate(() => {
      const avg = (a) => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);
      return { gpu: avg(window.__perf.gpu), cpu: avg(window.__perf.cpu), frames: window.__perf.cpu.length };
    });
    console.log('perf', name.padEnd(22), JSON.stringify(r));
  };
  await page.waitForTimeout(6000);
  await measure('chase, mirror off', 'off');
  await measure('chase, mirror on', 'all');
  await measure('chase, mirror off', 'off');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(2000);
  await measure('cab, mirrors off', 'off');
  await measure('cab, mirrors on', 'all');
  await measure('cab, mirrors off', 'off');
  await page.evaluate(() => window.__mirrors.mode('all'));
  console.log('gps', await page.evaluate(() => window.__gps('kaburo_crossing.view')));
  await page.evaluate(() => window.__auto.set('traffic'));
  await page.waitForTimeout(9000);
  console.log('start', await page.evaluate(() => window.__chase.start('tail')));
  await page.waitForTimeout(3200);
  await hide();
  await shot('cab_chased');
  await page.waitForTimeout(2500);
  await shot('cab_chased_b');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1500);
  await hide();
  await shot('chase_chased');
  await page.screenshot({ path: `${out}/mirror_close.png`, clip: { x: 395, y: 90, width: 310, height: 100 }, scale: 'css' });
  console.log('cars', JSON.stringify(await page.evaluate(() => window.__chase.state()?.cars.map((c) => ({ d: c.d, mode: c.mode })))));
  console.log('tags', JSON.stringify(await page.evaluate(() => {
    const M = window.__mirrors.rear;
    return window.__chase.chase.cars.map((c) => {
      const t = c.tag;
      const w = t.getWorldPosition(t.position.clone());
      const ndc = w.clone().project(M.camera);
      return { vis: t.visible, mask: t.layers.mask, cam: M.camera.layers.mask, scale: +t.scale.x.toFixed(2), world: w.toArray().map((v) => Math.round(v)), ndc: ndc.toArray().map((v) => +v.toFixed(2)), parentVis: c.view.obj.visible, inScene: !!c.view.obj.parent, map: !!t.material.map?.image };
    });
  })));
}
if (parts.includes('window')) {
  // The door glass from outside, each side: with the gun away, just after a shot from the hip, and four seconds on.
  const hide = () => page.evaluate(() => document.querySelectorAll('body > div, body > pre').forEach((d) => (d.style.visibility = 'hidden')));
  const win = () => page.evaluate(() => { const w = window.__own.view.windows; return { left: w.left && { vis: w.left.visible, y: +w.left.position.y.toFixed(2), broken: !!w.left.userData.broken }, right: w.right && { vis: w.right.visible, y: +w.right.position.y.toFixed(2), broken: !!w.right.userData.broken }, shown: window.__chase.gun.shown, mack: window.__chase.vis() }; });
  const side = async (name, deg) => {
    for (let i = 0; i < 5; i++) {
      await page.evaluate((y) => window.__bike.driving.setLook((y * Math.PI) / 180, 0.02), deg);
      await page.waitForTimeout(220);
    }
    await hide();
    console.log('window', name, JSON.stringify(await win()));
    await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}_${name}.png`, clip: { x: 250, y: 200, width: 600, height: 300 } });
  };
  await side('left_before', 90);
  await side('right_before', -90);
  await page.evaluate(() => window.__bike.driving.setLook(-1.2, 0));
  await page.evaluate(() => window.__chase.fire());
  await page.waitForTimeout(500);
  await side('left_just_fired', 90);
  await page.waitForTimeout(4500);
  await side('left_after', 90);
  await side('right_after', -90);
}
if (parts.includes('smoke')) {
  // A smashed front, from the driver's seat: standing, then driving through its own smoke.
  await page.evaluate(() => {
    window.__own.parts.front = 85;
  });
  console.log('gps', await page.evaluate(() => window.__gps('yoru_mart.front')));
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(2500);
  await shot('smoke_standing');
  await page.evaluate(() => window.__auto.set('fast'));
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1500);
    await shot(`smoke_driving${i}`);
  }
}
await browser.close();
await server.close();
