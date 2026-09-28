// VN stories from Krea Studio into the game (format: src/vn/format.ts, the generator's docs/vn-export-format.md).
//
//   npm run vn:pull -- <story_id>     download a story's VN export from Studio (GET /api/stories/<id>/export?kind=vn)
//                                     and install it (the story must belong to the account in .env.krea / the session)
//   npm run vn:import -- <file.zip>   install an export zip you downloaded yourself
//
// Installing unzips into content/vn/<story_id>/ (scene.json, entry_points.json, assets/), replacing that story's
// folder. `npm test` then validates it (schema, targets, flags, entry points that match world nodes).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, Studio, StudioError } from '../krea/studio.mjs';

const CONTENT = path.join(ROOT, 'content', 'vn');

export function install(zip) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-'));
  try {
    // Windows: PowerShell's Expand-Archive (a Git Bash tar can't read zips); elsewhere unzip, then bsdtar.
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`], { stdio: 'pipe' });
    } else {
      try {
        execFileSync('unzip', ['-q', zip, '-d', tmp], { stdio: 'pipe' });
      } catch {
        execFileSync('tar', ['-xf', zip, '-C', tmp], { stdio: 'pipe' });
      }
    }
    const scenePath = path.join(tmp, 'scene.json');
    if (!fs.existsSync(scenePath)) throw new StudioError(`${zip}: no scene.json (is this a VN export, kind=vn?)`);
    const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
    const id = scene?.story?.id;
    if (!/^s\d+$/.test(id ?? '')) throw new StudioError(`${zip}: scene.json has no story id`);
    if ((scene.schema ?? 0) < 2) throw new StudioError(`${zip}: schema ${scene.schema}; the game reads schema 2 (entry points)`);
    const dest = path.join(CONTENT, id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(CONTENT, { recursive: true });
    fs.cpSync(tmp, dest, { recursive: true });
    const frames = Object.keys(scene.frames ?? {}).length;
    const entries = Object.keys(scene.entry_points ?? {});
    console.log(`Installed ${id} "${scene.story.name}": ${frames} frames, entry points: ${entries.join(', ') || 'none'} -> content/vn/${id}/`);
    for (const w of scene.warnings ?? []) console.warn(`  warning: ${w}`);
    console.log('Run npm test to check it against the world (entry points must be node ids, exits spawn ids).');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function pull(storyId) {
  if (!/^s\d+$/.test(storyId ?? '')) throw new StudioError('Usage: npm run vn:pull -- <story_id> (like s08)');
  const studio = new Studio();
  const zip = path.join(os.tmpdir(), `vn-${storyId}.zip`);
  await studio.download(`/api/stories/${storyId}/export?kind=vn`, zip);
  install(zip);
  fs.rmSync(zip, { force: true });
}

const [cmd, arg] = process.argv.slice(2);
if (process.argv[1]?.endsWith('vn.mjs')) try {
  if (cmd === 'pull') await pull(arg);
  else if (cmd === 'import' && arg) install(path.resolve(arg));
  else console.log('Usage: npm run vn:pull -- <story_id> | npm run vn:import -- <file.zip>');
} catch (e) {
  console.error(e instanceof StudioError ? e.message : e);
  process.exit(1);
}
