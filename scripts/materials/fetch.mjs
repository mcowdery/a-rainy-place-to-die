// Scanned materials and skies from the two CC0 libraries, fetched by name: Poly Haven (polyhaven.com: textures and
// HDRI skies; "You can use our assets for any purpose, including commercial work. You do not need to give credit")
// and ambientCG (ambientcg.com: "You can copy, modify, distribute and perform the assets, even for commercial
// purposes, all without asking permission. You can include the raw files in your project, for example a video game").
// Nothing is owed for either; what's used is recorded in CREDITS.md all the same (.claude/rules/licences.md).
//
//   node scripts/materials/fetch.mjs search <words> [--from polyhaven|ambientcg] [--type textures|hdris]
//   node scripts/materials/fetch.mjs get <polyhaven|ambientcg>:<id> [--res 1k|2k|4k]
//   node scripts/materials/fetch.mjs list
//
//   `get` puts a material's maps (colour, normal (OpenGL's way up, as three.js and Blender read it), roughness,
//   ambient occlusion, height) or a sky's .hdr into .cache/materials/<library>/<id>/ (git-ignored) with a source.json
//   beside them: who made it, its licence, its page and the day it was fetched, which is the credit entry when it's
//   used. 1k by default: a character's cloth is 1024² at most (cast.md). `list` prints what's been fetched.
//
//   This is a quarry, not the game: a material goes into a model through its build (scripts/blender/), the model
//   through a showroom for the user's approval, and only what ships is copied out of .cache/ and credited.
//   Poly Haven's API asks every caller to name itself (its terms, 2.4): the User-Agent below.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.cache', 'materials');
const AGENT = { 'User-Agent': 'rainyplace-asset-fetch/1.0 (game development; one asset at a time)' };

const args = process.argv.slice(2);
const opt = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else rest.push(args[i]);
}
const [command, ...words] = rest;

const json = async (url) => {
  const res = await fetch(url, { headers: AGENT });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};
const save = async (url, file) => {
  const res = await fetch(url, { headers: AGENT });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
};
const today = () => new Date().toISOString().slice(0, 10);

async function search() {
  const want = words.map((w) => w.toLowerCase());
  const from = opt.from ? [opt.from] : ['polyhaven', 'ambientcg'];
  if (from.includes('polyhaven')) {
    for (const type of opt.type ? [opt.type] : ['textures', 'hdris']) {
      const all = await json(`https://api.polyhaven.com/assets?t=${type}`);
      const hits = Object.entries(all).filter(([id, a]) => want.every((w) => [id, a.name, ...(a.tags ?? []), ...(a.categories ?? [])].join(' ').toLowerCase().includes(w)));
      for (const [id, a] of hits.slice(0, 25)) console.log(`polyhaven:${id}`.padEnd(46), type.padEnd(9), a.name, `· ${(a.categories ?? []).join(', ')}`);
      if (hits.length > 25) console.log(`  ... and ${hits.length - 25} more ${type}`);
    }
  }
  if (from.includes('ambientcg') && opt.type !== 'hdris') {
    const found = await json(`https://ambientcg.com/api/v2/full_json?q=${encodeURIComponent(words.join(' '))}&type=Material&limit=25&sort=Popular`);
    for (const a of found.foundAssets) console.log(`ambientcg:${a.assetId}`.padEnd(46), 'textures '.padEnd(9), a.displayName, `· ${(a.tags ?? []).slice(0, 6).join(', ')}`);
    if (found.numberOfResults > 25) console.log(`  ... and ${found.numberOfResults - 25} more`);
  }
}

/** A Poly Haven texture's maps as the files they're saved as. */
const MAPS = { Diffuse: 'color', nor_gl: 'normal', Rough: 'roughness', AO: 'ao', Displacement: 'height', arm: 'arm' };

async function get() {
  const [library, id] = (words[0] ?? '').split(':');
  if (!id) throw new Error('get <polyhaven|ambientcg>:<id>');
  const dir = join(CACHE, library, id);
  mkdirSync(dir, { recursive: true });
  const files = [];
  let source;
  if (library === 'polyhaven') {
    const res = (opt.res ?? '1k').toLowerCase();
    const [info, list] = await Promise.all([json(`https://api.polyhaven.com/info/${id}`), json(`https://api.polyhaven.com/files/${id}`)]);
    if (list.hdri) {
      const f = list.hdri[res]?.hdr;
      if (!f) throw new Error(`no ${res} .hdr of ${id}: ${Object.keys(list.hdri).join(', ')}`);
      await save(f.url, join(dir, `${id}_${res}.hdr`));
      files.push(`${id}_${res}.hdr`);
    } else {
      for (const [map, name] of Object.entries(MAPS)) {
        const f = list[map]?.[res]?.jpg;
        if (!f) continue;
        await save(f.url, join(dir, `${name}.jpg`));
        files.push(`${name}.jpg`);
      }
    }
    source = { library: 'Poly Haven', id, name: info.name, authors: Object.keys(info.authors ?? {}), licence: 'CC0 1.0', page: `https://polyhaven.com/a/${id}`, resolution: res, metres: info.dimensions ? info.dimensions.map((mm) => mm / 1000) : undefined };
  } else if (library === 'ambientcg') {
    const res = `${(opt.res ?? '1k').toUpperCase()}-JPG`;
    const a = (await json(`https://ambientcg.com/api/v2/full_json?id=${id}&include=downloadData`)).foundAssets[0];
    if (!a) throw new Error(`no ${id} on ambientCG`);
    const pick = a.downloadFolders.default.downloadFiletypeCategories.zip.downloads.find((d) => d.attribute === res);
    if (!pick) throw new Error(`no ${res} of ${id}`);
    const zip = join(dir, 'download.zip');
    await save(pick.downloadLink, zip);
    // Windows' own tar unpacks a zip (by its full path: Git's tar, first on a Git Bash PATH, takes C: for a host).
    execFileSync(join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir]);
    rmSync(zip);
    // Its maps under the same names as Poly Haven's (the DirectX normal map is left out: the OpenGL one is the one used).
    const names = { Color: 'color', NormalGL: 'normal', Roughness: 'roughness', AmbientOcclusion: 'ao', Displacement: 'height', Metalness: 'metalness', Opacity: 'opacity' };
    for (const f of readdirSync(dir)) {
      const m = /_([A-Za-z]+)\.jpg$/.exec(f);
      if (m && names[m[1]]) {
        renameSync(join(dir, f), join(dir, `${names[m[1]]}.jpg`));
        files.push(`${names[m[1]]}.jpg`);
      } else if (f !== 'source.json') rmSync(join(dir, f), { recursive: true });
    }
    source = { library: 'ambientCG', id, name: a.displayName, authors: ['Lennart Demes (ambientCG)'], licence: 'CC0 1.0', page: `https://ambientcg.com/a/${id}`, resolution: res, metres: a.dimensionX ? [a.dimensionX / 100, a.dimensionY / 100] : undefined };
  } else throw new Error(`no library '${library}': polyhaven or ambientcg`);
  if (files.length === 0) throw new Error(`nothing of ${id} at that size`);
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ ...source, fetched: today(), files }, null, 2));
  console.log(`${dir}\n  ${files.join(', ')}\n  ${source.name}, by ${source.authors.join(', ')}; ${source.licence}; ${source.page}`);
}

function list() {
  if (!existsSync(CACHE)) return console.log('nothing fetched yet');
  for (const library of readdirSync(CACHE)) {
    for (const id of readdirSync(join(CACHE, library))) {
      const file = join(CACHE, library, id, 'source.json');
      if (!existsSync(file)) continue;
      const s = JSON.parse(readFileSync(file, 'utf8'));
      console.log(`${library}:${id}`.padEnd(46), `${s.name}, ${s.authors.join(', ')}, ${s.library}, ${s.licence}, ${s.page}, fetched ${s.fetched} (${s.files.join(', ')})`);
    }
  }
}

if (command === 'search' && words.length) await search();
else if (command === 'get') await get();
else if (command === 'list') list();
else console.log('Usage: node scripts/materials/fetch.mjs search <words> | get <polyhaven|ambientcg>:<id> [--res 1k] | list');
