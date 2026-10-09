// A body of the mob as the rooms behind the windows pose it (real/windowAtlas.ts), looked at as a surface rather than
// an outline: lit, coloured by what each part is (skin, hair, footwear grey; anything else, a garment's cloth, in
// magenta so it stands out), with the painter's own outline of the same pose beside it. For checking a body with
// nothing lofted over it is one clean body, bare feet and heels, and what a wrist and an ankle do.
//   node debug-shots/bodysheet.mjs [out dir] [sheets: body,feet,ankles,wrists,hips or all] [vite mode]
// Sheets: `body` (nude_man and nude: front, three quarter, side, back; standing, sitting, lying, striding), `feet`
// (barefoot and heeled side by side, standing, kneeling and lying), `ankles` (a foot pointed, flexed, turned and
// tipped, on a kneeling and a lying figure, close up), `wrists` (a hand bent forward, back, to each side and
// turned, facing and in profile, on a man, a woman and a long-sleeved suit, close up).
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, writeFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/bodysheet';
mkdirSync(out, { recursive: true });
const want = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',') : ['body', 'feet', 'ankles', 'wrists'];
const mode = process.argv[4];

const SIT = { lL: [88, 0, 88], lR: [88, 0, 88] };
const KNEEL = { lL: [6, 0, 96], lR: [6, 0, 96] };
const sheets = {};
// A body, turned round, in four postures. A cell: [label, figure, view: centre x, centre y, half height (m)].
for (const who of ['nude_man', 'nude']) {
  const cells = [];
  for (const [what, make] of [
    ['standing', (yaw) => ({ who, x: 0, pose: { yaw } })],
    ['sitting', (yaw) => ({ who, x: 0, pose: { yaw, ...SIT }, seat: 0.45 })],
    ['lying', (yaw) => ({ who, x: 0, pose: { yaw, pitch: -90 }, floor: 0.5 })],
    ['arms up, a stride', (yaw) => ({ who, x: 0, pose: { yaw, aL: [160, 20, 20], aR: [90, 80, 10], lL: [26, 0, 6], lR: [-18, 0, 30] } })],
  ]) for (const [view, yaw] of [['front', 0], ['three quarter', 45], ['side', 90], ['back', 180]]) cells.push([`${what} · ${view}`, make(yaw), [0, 0.95, 1.1]]);
  sheets[`body_${who}`] = { cols: 4, cells, want: 'body' };
}
// Barefoot and in heels, side by side.
{
  const cells = [];
  for (const [what, pose, more, view] of [
    ['standing, side', { yaw: 90 }, {}, [0, 0.9, 1.0]],
    ['standing, front', {}, {}, [0, 0.9, 1.0]],
    ['standing: the feet', { yaw: 90 }, {}, [0.05, 0.16, 0.24]],
    ['kneeling', { yaw: 90, ...KNEEL }, {}, [0, 0.6, 0.75]],
    ['kneeling: the feet', { yaw: 90, ...KNEEL }, {}, [-0.4, 0.14, 0.24]],
    ['lying on the back', { yaw: 90, pitch: -90 }, { floor: 0.5 }, [0, 0.7, 0.75]],
  ]) for (const who of ['nude', 'nude_heels', 'nude_man']) cells.push([`${who} · ${what}`, { who, x: 0, pose, ...more }, view]);
  sheets.feet = { cols: 3, cells, want: 'feet' };
}
// An ankle's three turns, kneeling and lying.
{
  const cells = [];
  for (const [what, base, more, view] of [
    ['kneeling', { yaw: 90, ...KNEEL }, {}, [-0.42, 0.16, 0.26]],
    ['lying on the back', { yaw: 90, pitch: -90 }, { floor: 0.5 }, [0.75, 0.66, 0.26]],
    ['lying, seen from the feet', { yaw: 0, pitch: -90 }, { floor: 0.5 }, [0, 0.66, 0.26]],
  ]) for (const [name, f] of [['at rest', undefined], ['pointed 55', [55]], ['flexed -35', [-35]], ['turned out 40', [0, 40]], ['turned in -40', [0, -40]], ['tipped 30', [0, 0, 30]]]) {
    cells.push([`${what} · ${name}`, { who: 'nude', x: 0, pose: { ...base, ...(f ? { fL: f, fR: f } : {}) }, ...more }, view]);
  }
  sheets.ankles = { cols: 6, cells, want: 'ankles' };
}
// A wrist's three turns, facing and in profile, on a man, a woman and a long sleeve.
{
  const cells = [];
  for (const who of ['nude_man', 'nude', 'suit', 'mama']) for (const [facing, yaw, arm] of [['facing, the arm hanging', 0, [3, 0, 8]], ['facing, the arm out', 0, [50, 80, 20]], ['profile, the arm forward', 90, [70, 0, 20]]]) {
    for (const [name, h] of [['straight', undefined], ['bent forward 60', [60]], ['bent back -60', [-60]], ['to the thumb 30', [0, 30]], ['to the little finger -30', [0, -30]], ['turned 80', [0, 0, 80]]]) {
      // (Hanging, the palm is to the thigh, so the bend is across the picture; held out or forward, the sideways bend is.)
      const pose = { yaw, aR: arm, ...(h ? { hR: h } : {}) };
      // (The view: about the wrist, wherever the pose has put it.)
      cells.push([`${who} · ${facing} · ${name}`, { who, x: 0, pose }, ['wristR', 0.19]]);
    }
  }
  sheets.wrists = { cols: 6, cells, want: 'wrists' };
}

// A woman's hips and the tops of her legs as the legs move (real/mobShape.ts: one surface, weighted between the
// pelvis and each thigh), bare, so the surface itself shows: a run, a high step, the legs apart to the sides (a leg
// is raised forward, then swung out), a split front and back, a squat, a chair with the knees apart. Three sheets.
{
  const MOVES = [
    ['a run', { lL: [55, 0, 75], lR: [-32, 0, 25] }],
    ['a high step', { lL: [100, 0, 20] }],
    ['a split, front and back', { lL: [88, 0, 0], lR: [-70, 0, 0] }],
    ['legs apart', { lL: [40, 90, 0], lR: [40, 90, 0] }],
    ['legs wide apart', { lL: [80, 90, 0], lR: [80, 90, 0] }],
    ['one leg out to the side', { lL: [70, 90, 0] }],
    ['a squat', { lL: [115, 25, 135], lR: [115, 25, 135] }],
    ['on a chair, knees apart', { lL: [88, 35, 88], lR: [88, 35, 88] }],
    ['a stride', { lL: [26, 0, 6], lR: [-18, 0, 30] }],
  ];
  for (let n = 0; n < MOVES.length; n += 3) {
    const cells = [];
    for (const [what, legs] of MOVES.slice(n, n + 3)) for (const [view, yaw] of [['front', 0], ['three quarter', 45], ['side', 90], ['back', 180]]) cells.push([what + ' · ' + view, { who: 'nude', x: 0, pose: { yaw, ...legs } }, [0, 0.72, 0.55]]);
    sheets['hips_' + (n / 3 + 1)] = { cols: 4, cells, want: 'hips' };
  }
  // The same, close on the hips, from where each shows most.
  const close = [];
  for (const [what, yaws] of [['a run', [0, 135, 180]], ['a high step', [0, 45, 180]], ['legs apart', [0, 45, 180]], ['one leg out to the side', [0, 45, 180]], ['a stride', [0, 135, 180]], ['on a chair, knees apart', [0, 45, 135]]]) {
    const legs = MOVES.find((m) => m[0] === what)[1];
    for (const yaw of yaws) close.push([what + ' · ' + yaw, { who: 'nude', x: 0, pose: { yaw, ...legs } }, [0, 0.8, 0.3]]);
  }
  sheets.hips_close = { cols: 3, cells: close, want: 'hipsclose' };
}

// A bare woman's chest, close: turned round at eye level, and leaning back (seen from a little below, for the fold
// under each breast) and forward (from a little above).
{
  const cells = [];
  for (const [what, pitch] of [['level', 0], ['from below', -28], ['from above', 24]]) for (const yaw of [0, 30, 60, 90]) cells.push([what + ' · ' + yaw, { who: 'nude', x: 0, pose: { yaw, pitch } }, pitch ? ['chest', 0.34] : [0, 1.1, 0.21]]);
  // (And the clothed bust beside it, for its place and size.)
  for (const yaw of [0, 30, 60, 90]) cells.push(['in clothes · ' + yaw, { who: 'woman', x: 0, pose: { yaw } }, [0, 1.1, 0.21]]);
  sheets.bust = { cols: 4, cells, want: 'bust' };
}

// Under a bare woman's hips, close: where the buttocks meet the thighs and where the legs part, from behind, the side
// and the front, level and leaning (seen from below).
{
  const cells = [];
  for (const [what, pose, view] of [
    ['behind', { yaw: 180 }, [0, 0.8, 0.16]], ['behind, three quarter', { yaw: 140 }, [0, 0.8, 0.16]], ['side', { yaw: 90 }, [0, 0.8, 0.16]], ['front', { yaw: 0 }, [0, 0.8, 0.16]],
    ['front, three quarter', { yaw: 40 }, [0, 0.8, 0.16]], ['behind, from below', { yaw: 180, pitch: 30 }, [0, 0.68, 0.3]], ['front, from below', { yaw: 0, pitch: -30 }, [0, 0.68, 0.3]], ['side, a stride', { yaw: 90, lL: [26, 0, 6], lR: [-18, 0, 30] }, [0, 0.8, 0.16]],
  ]) cells.push([what, { who: 'nude', x: 0, pose }, view]);
  sheets.under = { cols: 4, cells, want: 'under' };
}

const server = await shotServer({ mode, server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}debug-shots/blank.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
for (const [name, sheet] of Object.entries(sheets)) {
  if (!want.includes(sheet.want)) continue;
  const res = await page.evaluate(async ({ cells, cols }) => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const atlas = await import('/src/poc3d/real/windowAtlas.ts');
    const CW = 300, CH = 330, GAP = 22;
    const rows = Math.ceil(cells.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * CW * 1.5;
    cv.height = rows * (CH + GAP) + 26;
    const g = cv.getContext('2d');
    g.fillStyle = '#17181c';
    g.fillRect(0, 0, cv.width, cv.height);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(CW, CH);
    renderer.setClearColor(0xc9b48c);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-1.5, 2.5, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7);
    rim.position.set(2.5, 0.6, 1.2);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.004), new THREE.MeshBasicMaterial({ color: 0x6a5a40 }));
    scene.add(floor);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const tags = {};
    cells.forEach(([label, f, view], n) => {
      // (A view is a centre and a half height, or a joint to centre on and a half height.)
      const joints = typeof view[0] === 'string' ? atlas.placeFigure({ ...f, pose: { ...f.pose, hR: undefined, hL: undefined } }).joints : null;
      if (joints && !joints[view[0]]) throw new Error('no joint ' + view[0] + ': ' + Object.keys(joints).join(' '));
      const at = joints ? joints[view[0]] : view;
      const [cx, cy] = at, hh = view[view.length - 1];
      const hw = (hh * CW) / CH;
      const cam = new THREE.OrthographicCamera(cx - hw, cx + hw, cy + hh, cy - hh, -10, 10);
      cam.position.set(0, 0, 5);
      floor.position.set(0, (f.floor ?? 0) - 0.002, -1);
      const m = atlas.posedMesh(f);
      const col = new Float32Array(m.position.length);
      for (let v = 0; v < m.shade.length; v++) {
        const tag = Math.floor(m.shade[v] / 100);
        tags[tag] = (tags[tag] ?? 0) + 1;
        // Skin; hair; footwear; the face's emote quads (folded away in the city); anything else is cloth.
        const c = tag === 15 ? [0.62, 0.38, 0.43] : tag === 1 || tag === 21 ? [0.82, 0.62, 0.5] : tag === 19 ? [0.12, 0.1, 0.1] : tag === 20 ? [0.2, 0.2, 0.24] : tag === 4 ? [0.92, 0.92, 0.9] : tag === 18 ? [0.3, 0.32, 0.4] : tag === 11 ? [0.4, 0.3, 0.5] : [1, 0, 1];
        col.set(c, v * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      // (Without the face's emote quads: the city folds them away.)
      const idx = [];
      for (let t = 0; t < m.index.length; t += 3) if (Math.floor(m.shade[m.index[t]] / 100) !== 21) idx.push(m.index[t], m.index[t + 1], m.index[t + 2]);
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      renderer.render(scene, cam);
      scene.remove(mesh);
      geo.dispose();
      const x0 = (n % cols) * CW * 1.5, y0 = Math.floor(n / cols) * (CH + GAP) + GAP;
      g.drawImage(renderer.domElement, x0, y0);
      // Its outline as the painter draws it for the atlas, at the same view (half the width).
      const ppm = CH / (2 * hh);
      const painter = atlas.scenePainter(Math.min(ppm, 400));
      const k = Math.min(ppm, 400);
      const al = painter.alpha([f]);
      const img = g.createImageData(painter.w, painter.h);
      for (let p = 0; p < al.length; p++) {
        const a = al[p] / 255;
        img.data[p * 4] = 201 - 180 * a;
        img.data[p * 4 + 1] = 180 - 160 * a;
        img.data[p * 4 + 2] = 140 - 118 * a;
        img.data[p * 4 + 3] = 255;
      }
      const tmp = document.createElement('canvas');
      tmp.width = painter.w;
      tmp.height = painter.h;
      tmp.getContext('2d').putImageData(img, 0, 0);
      // (The painter's picture: x from the middle, y up from the floor at its bottom.)
      const sw = CW / 2, vw = (sw / CH) * 2 * hh;
      g.fillStyle = '#c9b48c';
      g.fillRect(x0 + CW, y0, sw, CH);
      g.drawImage(tmp, painter.w / 2 + (cx - vw / 2) * k, painter.h - (cy + hh) * k, vw * k, 2 * hh * k, x0 + CW, y0, sw, CH);
      g.fillStyle = '#e8e4da';
      g.font = '12px Consolas, monospace';
      g.fillText(label, x0 + 4, y0 - 6);
    });
    g.fillStyle = '#9aa0b0';
    g.font = '12px Consolas, monospace';
    g.fillText(`each: the body lit (skin, hair dark, footwear grey, cloth by its kind) and, beside it, the painter's outline · vertices by tag ${JSON.stringify(tags)}`, 6, cv.height - 8);
    renderer.dispose();
    return { url: cv.toDataURL('image/png'), tags };
  }, sheet);
  const file = `${out}/${name}.png`;
  writeFileSync(file, Buffer.from(res.url.split(',')[1], 'base64'));
  console.log(file, 'vertices by shade tag:', JSON.stringify(res.tags));
}
await browser.close();
await server.close();
