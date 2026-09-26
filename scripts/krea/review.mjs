// Review decisions for generated ad art (shared by the ads CLI and the review server).
//
// Each pending batch folder holds manifest.json, REVIEW.md and review.html. The review page is interactive:
// every image has Approve / Reject / Undo buttons and a note box ("why", or "what I want you to do"). The
// buttons call the local review server (review-server.mjs, `npm run ads:serve`); opened as a file, the page
// still talks to the server if it's running. Every decision and note is also appended to
// assets/ads/pending/feedback.jsonl so the notes can be picked up and acted on later.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './studio.mjs';

export const PENDING = path.join(ROOT, 'assets', 'ads', 'pending');
export const SOURCE = path.join(ROOT, 'assets', 'ads', 'source');
export const FEEDBACK = path.join(PENDING, 'feedback.jsonl');
export const REVIEW_PORT = 5320;

export class ReviewError extends Error {}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

export function batches() {
  if (!fs.existsSync(PENDING)) return [];
  return fs.readdirSync(PENDING).filter((b) => fs.existsSync(path.join(PENDING, b, 'manifest.json')));
}

export function loadBatch(batch) {
  const dir = path.join(PENDING, slug(batch));
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) throw new ReviewError(`No batch "${batch}".`);
  return { dir, file, m: readJson(file) };
}

/** Next free NN_ prefix across the approved art. */
function nextNumber() {
  const dirs = [path.join(ROOT, 'assets', 'ads'), SOURCE].filter((d) => fs.existsSync(d));
  const used = dirs.flatMap((d) => fs.readdirSync(d)).map((f) => parseInt(f, 10)).filter((n) => n > 0);
  return Math.max(0, ...used) + 1;
}

function log(entry) {
  fs.mkdirSync(PENDING, { recursive: true });
  fs.appendFileSync(FEEDBACK, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
}

function save(b) {
  writeJson(b.file, b.m);
  writeReview(b.dir, b.m);
}

/**
 * approve: moves the image (from the batch folder or its chosen/ subfolder) to assets/ads/source/NN_<item>.png
 * with a provenance JSON; reject: moves it to <batch>/rejected/; undo: puts it back as pending; note: saves
 * the note only. Returns the updated image record.
 */
export function decide(batch, file, action, { note, as } = {}) {
  const b = loadBatch(batch);
  const im = b.m.images.find((x) => x.file === file);
  if (!im) throw new ReviewError(`No ${file} in batch ${batch}.`);
  if (typeof note === 'string') im.note = note.trim() || undefined;
  const here = path.join(b.dir, file);
  const chosen = path.join(b.dir, 'chosen', file);
  const rejected = path.join(b.dir, 'rejected', file);
  if (action === 'approve' || action === 'reject') {
    if (im.status !== 'pending') throw new ReviewError(`${file} is already ${im.status}; undo it first.`);
    const from = fs.existsSync(here) ? here : chosen;
    if (!fs.existsSync(from)) throw new ReviewError(`${file} is missing from the batch folder.`);
    if (action === 'approve') {
      const name = as ? slug(as) : `${String(nextNumber()).padStart(2, '0')}_${slug(im.item)}`;
      const to = path.join(SOURCE, `${name}.png`);
      if (fs.existsSync(to)) throw new ReviewError(`assets/ads/source/${name}.png already exists.`);
      fs.mkdirSync(SOURCE, { recursive: true });
      fs.renameSync(from, to);
      Object.assign(im, { status: 'approved', approvedAs: `assets/ads/source/${name}.png`, decided: new Date().toISOString() });
      writeJson(path.join(SOURCE, `${name}.json`), { ...im, batch: b.m.batch, purpose: b.m.purpose, use: b.m.use, district: b.m.district });
    } else {
      fs.mkdirSync(path.dirname(rejected), { recursive: true });
      fs.renameSync(from, rejected);
      Object.assign(im, { status: 'rejected', decided: new Date().toISOString() });
    }
  } else if (action === 'undo') {
    if (im.status === 'approved') {
      const to = path.join(ROOT, im.approvedAs);
      if (fs.existsSync(to)) fs.renameSync(to, here);
      const meta = to.replace(/\.png$/, '.json');
      if (fs.existsSync(meta)) fs.rmSync(meta);
    } else if (im.status === 'rejected' && fs.existsSync(rejected)) {
      fs.renameSync(rejected, here);
    }
    Object.assign(im, { status: 'pending', approvedAs: undefined, decided: undefined });
  } else if (action !== 'note') {
    throw new ReviewError(`Unknown action "${action}".`);
  }
  save(b);
  log({ batch: b.m.batch, file, item: im.item, action, status: im.status, approvedAs: im.approvedAs ?? null, note: im.note ?? null });
  return im;
}

/** Where an image currently lives, relative to its batch folder (for the review page). */
const imageSrc = (im) => (im.status === 'approved' && im.approvedAs ? `../../source/${path.basename(im.approvedAs)}` : im.status === 'rejected' ? `rejected/${im.file}` : im.file);

/** REVIEW.md (text) and review.html (interactive contact sheet) for a batch. */
export function writeReview(dir, m) {
  const md = [
    `# Pending ad art: ${m.batch}`,
    '',
    `Purpose: ${m.purpose || '-'}  `,
    `Use: ${m.use}${m.district ? ` · district: ${m.district}` : ''} · brief: \`${m.brief}\``,
    '',
    'Review in the browser: `npm run ads:serve`, then open review.html (buttons: Approve / Reject / Undo, with a note).',
    '',
    '| file | item | brand / copy | status | note |',
    '|---|---|---|---|---|',
    ...m.images.map((im) => `| ${im.file} | ${im.item} | ${[im.brand, im.copy].filter(Boolean).join(' · ') || '-'} | ${im.status}${im.approvedAs ? ` → ${im.approvedAs}` : ''} | ${im.note ?? ''} |`),
    '',
    ...m.images.map((im) => `- **${im.file}** prompt: ${im.prompt}${im.notes ? `\n  brief notes: ${im.notes}` : ''}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'REVIEW.md'), md);
  const data = { batch: m.batch, purpose: m.purpose, use: m.use, images: m.images.map((im) => ({ ...im, src: imageSrc(im) })) };
  fs.writeFileSync(path.join(dir, 'review.html'), reviewHtml(data));
}

export function batchData(batch) {
  const { m } = loadBatch(batch);
  return { batch: m.batch, purpose: m.purpose, use: m.use, images: m.images.map((im) => ({ ...im, src: imageSrc(im) })) };
}

function reviewHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${data.batch} · ad review</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg:#16161a; --card:#202027; --line:#34343f; --ink:#e4e4ea; --dim:#9a9aa8; --ok:#3fbf7f; --no:#e0506a; --warn:#e8b040; }
  body { margin:0; padding:16px; font:13px/1.45 system-ui, 'Yu Gothic UI', sans-serif; background:var(--bg); color:var(--ink); }
  header { display:flex; flex-wrap:wrap; gap:12px; align-items:baseline; margin-bottom:12px; }
  h1 { font-size:18px; margin:0; } .purpose { color:var(--dim); max-width:90ch; }
  .bar { position:sticky; top:0; z-index:2; display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding:8px 10px; margin:0 -16px 12px; background:rgba(22,22,26,.95); border-bottom:1px solid var(--line); }
  .server { padding:3px 8px; border-radius:10px; font-size:12px; }
  .server.up { background:#173d2a; color:#8fe0b5; } .server.down { background:#4a1a24; color:#ffb0c0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:8px; overflow:hidden; display:flex; flex-direction:column; }
  .card.approved { border-color:var(--ok); } .card.rejected { border-color:var(--no); opacity:.6; }
  .card img { width:100%; display:block; background:#000; cursor:zoom-in; }
  .meta { padding:8px 10px; display:flex; flex-direction:column; gap:6px; flex:1; }
  .name { font-weight:600; display:flex; justify-content:space-between; gap:8px; }
  .badge { font-size:11px; padding:1px 7px; border-radius:9px; background:#333; color:#ddd; white-space:nowrap; }
  .approved .badge { background:#173d2a; color:#8fe0b5; } .rejected .badge { background:#4a1a24; color:#ffb0c0; }
  .copy { color:#cfcfda; } details { color:var(--dim); font-size:12px; }
  textarea { width:100%; box-sizing:border-box; min-height:52px; resize:vertical; background:#15151a; color:var(--ink); border:1px solid var(--line); border-radius:5px; padding:6px; font:inherit; }
  .buttons { display:flex; gap:6px; flex-wrap:wrap; }
  button { font:inherit; padding:5px 12px; border-radius:5px; border:1px solid var(--line); background:#2a2a33; color:var(--ink); cursor:pointer; }
  button:disabled { opacity:.4; cursor:default; }
  button.approve { border-color:var(--ok); color:#8fe0b5; } button.reject { border-color:var(--no); color:#ffb0c0; }
  .msg { font-size:12px; color:var(--warn); min-height:1em; }
  .zoom { position:fixed; inset:0; z-index:5; background:rgba(0,0,0,.9); display:none; place-items:center; cursor:zoom-out; }
  .zoom img { max-width:96vw; max-height:96vh; }
  label { color:var(--dim); }
</style></head>
<body>
<header><h1>${data.batch}</h1><div class="purpose"></div></header>
<div class="bar"><span id="server" class="server">checking review server…</span>
  <label><input type="checkbox" id="pendingOnly"> pending only</label>
  <span id="counts" style="color:var(--dim)"></span></div>
<div class="grid" id="grid"></div>
<div class="zoom" id="zoom"><img alt=""></div>
<script>
const EMBEDDED = ${json};
const API = location.protocol === 'file:' ? 'http://127.0.0.1:${REVIEW_PORT}' : '';
let data = EMBEDDED, up = false;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
$('.purpose').textContent = data.purpose || '';

async function refresh() {
  try {
    const r = await fetch(API + '/api/batch/' + encodeURIComponent(EMBEDDED.batch));
    if (!r.ok) throw new Error();
    data = await r.json(); up = true;
  } catch { up = false; }
  const s = $('#server');
  s.className = 'server ' + (up ? 'up' : 'down');
  s.textContent = up ? 'review server connected: buttons are live' : 'review server not running: start it with  npm run ads:serve  (buttons disabled)';
  render();
}

function render() {
  const only = $('#pendingOnly').checked;
  const count = (st) => data.images.filter((im) => im.status === st).length;
  $('#counts').textContent = count('pending') + ' pending · ' + count('approved') + ' approved · ' + count('rejected') + ' rejected';
  const drafts = {};
  document.querySelectorAll('.card textarea').forEach((t) => (drafts[t.dataset.file] = t.value));
  $('#grid').innerHTML = data.images.filter((im) => !only || im.status === 'pending').map((im) => {
    const note = drafts[im.file] ?? im.note ?? '';
    const pending = im.status === 'pending';
    return '<div class="card ' + im.status + '" data-file="' + esc(im.file) + '">' +
      '<img src="' + esc(im.src) + '" loading="lazy" alt="">' +
      '<div class="meta"><div class="name"><span>' + esc(im.file) + '</span><span class="badge">' + esc(im.status) + (im.approvedAs ? ' → ' + esc(im.approvedAs.split('/').pop()) : '') + '</span></div>' +
      '<div class="copy">' + esc([im.brand, im.copy].filter(Boolean).join(' · ')) + '</div>' +
      (im.notes ? '<div style="color:var(--dim);font-size:12px">' + esc(im.notes) + '</div>' : '') +
      '<details><summary>prompt</summary>' + esc(im.prompt) + '</details>' +
      '<textarea data-file="' + esc(im.file) + '" placeholder="Why, or what you want done (e.g. crop the left side, redo with…)">' + esc(note) + '</textarea>' +
      '<div class="buttons">' +
      (pending ? '<button class="approve" data-act="approve">Approve</button><button class="reject" data-act="reject">Reject</button>' : '<button data-act="undo">Undo</button>') +
      '<button data-act="note">Save note</button></div><div class="msg"></div></div></div>';
  }).join('');
  document.querySelectorAll('.card button').forEach((b) => (b.disabled = !up));
}

$('#grid').addEventListener('click', async (e) => {
  const img = e.target.closest('img');
  if (img) { $('#zoom img').src = img.src; $('#zoom').style.display = 'grid'; return; }
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  const card = btn.closest('.card');
  const file = card.dataset.file;
  const note = $('textarea', card).value;
  const msg = $('.msg', card);
  msg.textContent = '…';
  try {
    const r = await fetch(API + '/api/decide', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batch: EMBEDDED.batch, file, action: btn.dataset.act, note }) });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || r.status);
    const i = data.images.findIndex((x) => x.file === file);
    data.images[i] = out.image;
    $('textarea', card).value = out.image.note ?? '';
    render();
  } catch (err) { msg.textContent = 'Failed: ' + err.message; }
});
$('#zoom').addEventListener('click', () => ($('#zoom').style.display = 'none'));
$('#pendingOnly').addEventListener('change', render);
render();
refresh();
</script></body></html>
`;
}
