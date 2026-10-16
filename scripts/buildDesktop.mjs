// The Windows desktop build: the standard edition (dist/) wrapped in Electron (desktop/main.cjs), into
// release/win-unpacked/ (the .exe and its folder, run in place or zipped). `--skip-web` reuses the current dist/.
import { execSync } from 'node:child_process'
const run = (c) => execSync(c, { stdio: 'inherit' })
if (!process.argv.includes('--skip-web')) run('npm run build')
run('npx electron-builder --win --dir')
console.log('built release/win-unpacked/A Rainy Place to Die.exe')
