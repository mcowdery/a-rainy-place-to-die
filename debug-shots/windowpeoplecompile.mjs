// What the rooms behind the windows add to the city shader's compile (city.ts): in one page, the city program's
// own source is compiled and linked again with the scenes' block in and with it cut out (its condition made false), each
// with a constant nudged so no cache answers, alternated a few times.
//   node debug-shots/windowpeoplecompile.mjs [rounds] [what]
// what: `block` (the default: the whole block against none of it) or `table` (the block as it is against the block
// with its per-scene table read replaced by a constant: what the table costs), or `shady` (the storefronts' shady
// rooms against none).
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const rounds = Number(process.argv[2] ?? 3);
const what = process.argv[3] ?? 'block';
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const t0 = Date.now();
await page.goto(`${server.resolvedUrls.local[0]}?diag=1&weather=clear&res=100&clock=20:30`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 600000, polling: 250 });
console.log('page ready (s)', ((Date.now() - t0) / 1000).toFixed(1));
for (let r = 0; r < rounds; r++) {
  for (const cut of [true, false]) {
    const res = await page.evaluate(([cut, salt, what]) => {
      const gl = window.__renderer.getContext();
      const COND = 'furnished && (lit || uLamps < 0.97)';
      const progs = window.__renderer.info.programs.map((p) => ({ vs: gl.getShaderSource(p.vertexShader), fs: gl.getShaderSource(p.fragmentShader) })).filter((p) => p.fs.includes(COND));
      if (!progs.length) return { error: 'no city program found' };
      const p = progs.sort((a, b) => b.fs.length - a.fs.length)[0];
      // (A live constant, so the translated shader differs each time.)
      let fs = p.fs.replace('vec3(0.42, 0.44, 0.47)', `vec3(${(0.42 + salt * 1e-4).toFixed(5)}, 0.44, 0.47)`);
      if (cut && what === 'block') fs = fs.replace(COND, 'false');
      if (cut && what === 'shady') fs = fs.replace('bool shady = shopOpen', 'bool shady = false && shopOpen');
      if (cut && what === 'table') fs = fs.replace(/WINDOW_PLAY\[int\(fn \+ 0\.5\)\]/, 'vec4(0.5, 0.5, 0.0, 0.0)').replace(/WINDOW_PICK\[[^\]]*\]/, '3.0');
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const t = performance.now();
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, p.vs));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr);
      const ok = gl.getProgramParameter(pr, gl.LINK_STATUS);
      const ms = performance.now() - t;
      const log = ok ? '' : gl.getProgramInfoLog(pr);
      gl.deleteProgram(pr);
      return { ms: Math.round(ms), ok, log, chars: fs.length, variants: progs.length };
    }, [cut, r * 2 + (cut ? 1 : 2), what]);
    console.log(cut ? 'without' : 'with   ', JSON.stringify(res));
  }
}
await browser.close();
await server.close();
