// The one place a script's browser is launched, so a script runs the same on this Windows machine and on a Linux
// GPU pod. Takes what `chromium.launch` takes and returns what it returns.
//
//   Windows (default): the installed Microsoft Edge (`channel: 'msedge'`) with ANGLE on Direct3D 11.
//   Linux: Playwright's own Chromium (`npx playwright-core install chromium`; PLAYWRIGHT_BROWSERS_PATH picks where)
//          with ANGLE on Vulkan, which reaches the NVIDIA GPU in a RunPod container (`node scripts/gpuCheck.mjs`).
//   BROWSER_PATH=<exe>         run that executable instead (Brave, Chrome, ...)
//   BROWSER_CHANNEL=<channel>  run an installed channel instead (msedge, chrome)
//   BROWSER_ARGS="--a --b"     extra flags, whatever the platform
//
// A script's own flags are kept; `--use-angle=d3d11` is swapped for the Vulkan set off Windows, and a headed run with
// no display (a pod) falls back to headless.
import { chromium } from 'playwright-core';

// --disable-gpu-compositing: with it off the pod's Vulkan renders corrupted pictures (big dark rectangles, garbled text, green
// patches on the ground); the game's WebGL stays on the GPU either way. Found by rendering the same view on a PC and the pod.
const VULKAN = ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--disable-gpu-compositing'];

export function launchBrowser(options = {}) {
  const opts = { ...options };
  let args = [...(opts.args ?? [])];

  if (process.platform !== 'win32') {
    if (args.includes('--use-angle=d3d11')) args = [...args.filter((a) => a !== '--use-angle=d3d11'), ...VULKAN];
    if (!args.includes('--no-sandbox')) args.push('--no-sandbox'); // pods run as root
    if (!process.env.DISPLAY && opts.headless === false) opts.headless = true;
  }
  if (process.env.BROWSER_ARGS) args.push(...process.env.BROWSER_ARGS.split(/\s+/).filter(Boolean));
  opts.args = args;

  if (process.env.BROWSER_PATH) {
    delete opts.channel;
    opts.executablePath = process.env.BROWSER_PATH;
  } else if (process.env.BROWSER_CHANNEL) {
    opts.channel = process.env.BROWSER_CHANNEL;
  } else if (process.platform !== 'win32') {
    delete opts.channel; // 'msedge' etc. aren't installed on the pod: use the bundled Chromium
  }
  return chromium.launch(opts);
}
