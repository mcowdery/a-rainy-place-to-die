// Try a VN scene in the city: opens the district with the scene playing, in front of its node.
//
//   npm run vn:try -- <node id>              e.g. bar_kanpai.mama (see npm run vn:keys)
//   npm run vn:try -- <story_id> <node id>   pull the story from Studio first (npm run vn:pull), then open it
//
// Runs the dev server until you stop it (Ctrl+C); edit content/vn/<story>/scene.json and reload to see changes.
import path from 'node:path';
import { createServer } from 'vite';
import { ROOT } from '../krea/studio.mjs';
import { pull } from './vn.mjs';
import { loadKeys } from './keys.mjs';

const args = process.argv.slice(2);
const story = /^s\d+$/.test(args[0] ?? '') ? args.shift() : null;
const node = args[0];
if (!node) {
  console.log('Usage: npm run vn:try -- [story_id] <node id>   (npm run vn:keys lists the node ids)');
  process.exit(1);
}
if (story) await pull(story);
const keys = await loadKeys();
const entry = keys.entries[node];
if (!entry) {
  console.error(`${node} isn't a node that starts a VN scene. npm run vn:keys lists them.`);
  process.exit(1);
}
if (!entry.scene) console.warn(`No story has ${node} as an entry point yet: the placeholder will show. (Set a frame's entry point to ${node} in Studio.)`);
const url = `/district.html?debug=1&time=night&vn=${encodeURIComponent(node)}`;
const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { open: url } });
await server.listen();
console.log(`${entry.name} (${entry.place})${entry.scene ? ` -> ${entry.scene}` : ''}`);
console.log(`Open ${server.resolvedUrls.local[0].replace(/\/$/, '')}${url}   (Ctrl+C to stop)`);
