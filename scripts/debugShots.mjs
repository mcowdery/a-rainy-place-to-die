import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Dev only: POST /__shot (src/debug/snap.ts, F9 in the game) saves a snapshot and its notes to debug-shots/
 * (git-ignored): `<date>_<time>_<page>.png` and `.json`.
 */
export function debugShots() {
  return {
    name: 'debug-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const { page, png, info } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const d = new Date();
            const p = (n) => String(n).padStart(2, '0');
            const name = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_${String(page).replace(/[^a-z0-9_-]/gi, '')}`;
            const dir = resolve(server.config.root, 'debug-shots');
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, `${name}.png`), Buffer.from(String(png).replace(/^data:image\/png;base64,/, ''), 'base64'));
            writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(info, null, 2));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ file: `debug-shots/${name}.png` }));
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}
