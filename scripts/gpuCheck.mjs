// Does headless Chromium here get the real GPU for WebGL, or a software renderer (SwiftShader / llvmpipe)?
// Tries several flag sets and prints the WebGL renderer each one gets. For a Linux pod before porting the shot scripts.
//   node scripts/gpuCheck.mjs                    Playwright's own Chromium (npx playwright-core install chromium)
//   BROWSER_PATH=/usr/bin/google-chrome node scripts/gpuCheck.mjs
//   BROWSER_CHANNEL=msedge node scripts/gpuCheck.mjs      (Windows: the installed Edge)
// Exit code 0 if some flag set reached hardware, 1 if every one was software or failed.
import { chromium } from 'playwright-core';

const common = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
if (process.platform === 'linux') common.push('--no-sandbox'); // pods run as root

const sets = {
  win32: [{ label: 'ANGLE d3d11', args: ['--use-angle=d3d11'] }],
  linux: [
    { label: 'ANGLE vulkan', args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface'] },
    { label: 'ANGLE gl-egl', args: ['--use-gl=angle', '--use-angle=gl-egl'] },
    { label: 'ANGLE gl', args: ['--use-gl=angle', '--use-angle=gl'] },
    { label: 'chromium default', args: [] },
  ],
}[process.platform] ?? [{ label: 'chromium default', args: [] }];

const software = /swiftshader|llvmpipe|software|softpipe|microsoft basic/i;

const read = () => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { renderer: 'no WebGL2 context', version: '' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
  };
};

let hardware = null;
for (const set of sets) {
  const opts = { headless: true, args: [...common, ...set.args] };
  if (process.env.BROWSER_PATH) opts.executablePath = process.env.BROWSER_PATH;
  else if (process.env.BROWSER_CHANNEL) opts.channel = process.env.BROWSER_CHANNEL;
  let browser;
  try {
    browser = await chromium.launch(opts);
    const page = await browser.newPage();
    await page.goto('about:blank');
    const r = await page.evaluate(read);
    const isSoft = software.test(r.renderer) || r.renderer === 'no WebGL2 context';
    console.log(`${isSoft ? 'SOFTWARE' : 'HARDWARE'}  ${set.label.padEnd(18)} ${r.renderer}  (${r.version}${r.timer ? ', GPU timer queries' : ''})`);
    if (!isSoft && !hardware) hardware = set;
  } catch (e) {
    console.log(`FAILED    ${set.label.padEnd(18)} ${String(e.message).split('\n')[0]}`);
  } finally {
    await browser?.close();
  }
}

if (hardware) console.log(`\nUse: ${[...common, ...hardware.args].join(' ')}`);
else console.log('\nNo flag set reached the GPU: the container probably lacks the NVIDIA graphics capability (NVIDIA_DRIVER_CAPABILITIES) or the Vulkan/EGL libraries.');
process.exit(hardware ? 0 : 1);
