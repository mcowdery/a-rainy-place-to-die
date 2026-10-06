// Writes an index.html into a folder of screenshots, so the dev server shows them at /debug-shots/<dir>/
// (Vite serves a folder's index.html but doesn't list folders). Also: node debug-shots/gallery.mjs <dir>
import { readdirSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { pathToFileURL } from 'url';

export function writeGallery(dir) {
  const pngs = readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const items = pngs.map((f) => `<figure><a href="${f}"><img src="${f}" loading="lazy"></a><figcaption>${f}</figcaption></figure>`).join('\n');
  writeFileSync(`${dir}/index.html`, `<!doctype html><meta charset="utf-8"><title>${basename(dir)}</title>
<style>body{background:#16171b;color:#ccc;font:13px sans-serif;margin:16px}h1{font-size:16px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px}figure{margin:0}
img{width:100%;display:block;border:1px solid #333}figcaption{padding:4px 0}</style>
<h1>${basename(dir)} · ${pngs.length} shots · ${new Date().toLocaleString()}</h1><main>${items}</main>`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) writeGallery(process.argv[2] ?? '.');
