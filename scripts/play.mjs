// Opens the city in its own window (Edge/Chrome --app mode: no tabs, no address bar).
// Usage: node scripts/play.mjs [--url http://localhost:5173/] [path-and-query, e.g. "?spawn=..."] [--fullscreen]
// With no --url it starts a dev server of its own (next free port) and stops it when the window closes.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? null : args.splice(i, 2)[1] }
const fullscreen = args.includes('--fullscreen') && args.splice(args.indexOf('--fullscreen'), 1)
const given = flag('--url')
const extra = args[0] ?? ''

const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const exe = browsers.find(existsSync)
if (!exe) { console.error('No Edge or Chrome found.'); process.exit(1) }

let server = null
let url = given
if (!url) {
  server = await createServer({ server: { open: false } })
  await server.listen()
  url = server.resolvedUrls.local[0]
}
url += extra.replace(/^\//, '')

// A profile of its own, so the window is separate from the everyday browser and closing it ends this process.
const profile = new URL('../.play-profile', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const win = spawn(exe, [
  `--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1600,900',
  ...(fullscreen ? ['--start-fullscreen'] : []),
], { stdio: 'ignore' })
console.log(`Playing ${url}`)
win.on('exit', async () => { await server?.close(); process.exit(0) })
