import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// The dev server's own endpoints (paths starting /__), each a function of (server, req, res). scripts/debugShots.mjs
// loads this file through the server at each request, so a change here (or a new endpoint) is live at the next
// request: no restart of anyone's dev server, which a change to debugShots.mjs or vite.config.ts is.

/**
 * POST /__shot (src/debug/snap.ts, F9 in the game) saves a snapshot and its notes to debug-shots/
 * (git-ignored): `<date>_<time>_<page>.png` and `.json`.
 */
function shot(server, req, res) {
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
}

// The window pose lab (windowlab.html) writes one adult scene back. The id has to stay a single a_*.json file in
// adult/content/windows.
function windowLab(server, req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const scene = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const id = scene && scene.id;
      if (typeof id !== 'string' || !/^a_[a-z0-9_]+$/.test(id)) {
        res.statusCode = 400;
        res.end('id must look like a_love_missionary');
        return;
      }
      const dir = resolve(server.config.root, 'adult', 'content', 'windows');
      const file = resolve(dir, `${id}.json`);
      if (!file.startsWith(dir + sep)) {
        res.statusCode = 400;
        res.end('bad path');
        return;
      }
      writeFileSync(file, `${JSON.stringify(scene, null, 2)}\n`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ file: `adult/content/windows/${id}.json` }));
    } catch (err) {
      res.statusCode = 400;
      res.end(String(err));
    }
  });
}

// The scene editor (scenes.html, src/poc3d/showroom/scenes.ts).
//   GET  /__scene                               every .json in the two scene folders, as text (the editor parses
//                                               and checks them itself, and lists the ones it can't read)
//   POST /__scene { op: 'save', place, scene }  writes <id>.json into content/world3d/windows (place 'content')
//                                               or adult/content/windows (place 'adult')
//   POST /__scene { op: 'revert', id, place }   deletes an override: content/world3d/windows/<id>.json, or (place
//                                               'adult') adult/content/windows/<id>.json when id is a built-in scene's
// What may go where is src/poc3d/real/sceneFiles.ts's to say (sceneFileFor: the id's pattern, the scene's own
// checks, adult scenes only to adult/); here the path it gives is resolved and held inside its one folder.
function scene(server, req, res) {
  const json = (code, body) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const rules = () => server.ssrLoadModule('/src/poc3d/real/sceneFiles.ts');
  if (req.method === 'GET') {
    rules().then((R) => {
      const files = [];
      for (const [place, folder] of Object.entries(R.SCENE_FOLDERS)) {
        const dir = resolve(server.config.root, ...folder.split('/'));
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir).sort()) if (name.endsWith('.json')) files.push({ place, name, text: readFileSync(resolve(dir, name), 'utf8') });
      }
      json(200, { files });
    }).catch((err) => json(500, { error: String(err) }));
    return;
  }
  if (req.method !== 'POST') return json(405, { error: 'GET or POST' });
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    rules().then((R) => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const plan = body.op === 'save' ? R.sceneFileFor(body.scene, body.place) : body.op === 'revert' ? R.sceneRevertFor(body.id, body.place) : { error: 'op is save or revert' };
      if (plan.error) return json(400, { error: plan.error });
      const dir = resolve(server.config.root, ...plan.folder.split('/'));
      const file = resolve(dir, plan.name);
      if (!R.insideFolder(dir, file, sep)) return json(400, { error: 'bad path' });
      if (body.op === 'revert') {
        if (!existsSync(file)) return json(404, { error: `${plan.folder}/${plan.name} is not there` });
        unlinkSync(file);
        return json(200, { removed: `${plan.folder}/${plan.name}` });
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, R.sceneText(body.scene));
      json(200, { file: `${plan.folder}/${plan.name}` });
    }).catch((err) => json(400, { error: String(err) }));
  });
}

/** The endpoints by path. A new one goes here. */
export const ENDPOINTS = { '/__shot': shot, '/__window': windowLab, '/__scene': scene };

/** Answers the request if its path is an endpoint's; false if it's nobody's (Vite's own /__ paths). */
export function handle(server, req, res) {
  const path = (req.url ?? '').split('?')[0];
  const endpoint = ENDPOINTS[path];
  if (!endpoint) return false;
  endpoint(server, req, res);
  return true;
}
