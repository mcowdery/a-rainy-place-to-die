// Runs the 3D PoC benchmark in the installed Microsoft Edge and prints a results table.
//   node scripts/bench3d.mjs            headless (GPU flags on; check the reported GPU)
//   node scripts/bench3d.mjs --headed   visible window, real desktop GPU path
import { launchBrowser } from './launchBrowser.mjs';
import { shotServer } from './shotServer.mjs';

const headed = process.argv.includes('--headed');
const configs = [
  { label: 'test street only', query: '' },
  { label: '+2,000 buildings, one mesh each', query: '&grid=2000' },
  { label: '+2,000 buildings, merged per chunk', query: '&grid=2000&merge=1' },
  { label: '+20,000 buildings, one mesh each', query: '&grid=20000' },
  { label: '+20,000 buildings, merged per chunk', query: '&grid=20000&merge=1' },
];

const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({
  channel: 'msedge',
  headless: !headed,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const c of configs) {
    await page.goto(`${base}poc3d.html?bench=1${c.query}`);
    const r = await page.waitForFunction(() => window.__bench, null, { timeout: 180_000, polling: 500 }).then((h) => h.jsonValue());
    console.log(`\n## ${c.label}  (viewport ${r.viewport}, ascii ${r.cells} cells, GPU: ${r.gpu})`);
    console.log('mode            fps   ms/frame  p95 ms  calls  triangles');
    for (const x of r.results) {
      const name = `${x.mode}${x.mode === 'webgl' ? '' : x.color ? ' colour' : ' mono'}`;
      console.log(`${name.padEnd(14)} ${String(x.fps).padStart(5)} ${String(x.workMs).padStart(9)} ${String(x.p95Ms).padStart(7)} ${String(x.calls).padStart(6)} ${String(x.triangles).padStart(10)}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
