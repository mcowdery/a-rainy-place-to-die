// The shared playtest build (src/share.ts): the standard edition with the debug menu open, crash damage off and the
// things-to-try panel, into dist-share/, ready to upload to a static host. The front door (index.html) is the city itself,
// and the pages that are for development only (the 3D test block, the scene editor) are left out.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const git = (a) => { try { return execSync(`git ${a}`, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const label = `${new Date().toISOString().slice(0, 10)} ${git('rev-parse --short HEAD') || 'nogit'}${git('status --porcelain') ? '+edits' : ''}`;
const env = { ...process.env, VITE_SHARE: '1', VITE_BUILD_LABEL: label };
execSync('npx tsc', { stdio: 'inherit', env });
execSync('npx vite build --outDir dist-share --emptyOutDir', { stdio: 'inherit', env });
for (const f of ['poc3d.html', 'scenes.html']) rmSync(`dist-share/${f}`, { force: true });
console.log(`built dist-share (${label})`);
