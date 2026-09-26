// Local review server for generated ad art: serves assets/ads/ (the pending batches' review pages and
// images) and handles the review pages' Approve / Reject / Undo / Save note buttons.
//
//   npm run ads:serve     then open http://127.0.0.1:5320/  (or open a batch's review.html directly)
//
// Bound to 127.0.0.1 only. Decisions go through review.mjs (the same code as the CLI).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { batchData, batches, decide, loadBatch, PENDING, REVIEW_PORT, ReviewError, writeReview } from './review.mjs';
import { ROOT } from './studio.mjs';

const ADS = path.join(ROOT, 'assets', 'ads');
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };

// Rebuild every batch's page so older batches get the interactive version too.
for (const b of batches()) {
  const { dir, m } = loadBatch(b);
  writeReview(dir, m);
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function index() {
  const rows = batches().map((b) => {
    const { dir, m } = loadBatch(b);
    writeReview(dir, m); // keep every batch's page current (new batches, older page formats)
    const d = batchData(b);
    const n = (s) => d.images.filter((im) => im.status === s).length;
    return `<li><a href="/pending/${b}/review.html">${b}</a> · ${n('pending')} pending, ${n('approved')} approved, ${n('rejected')} rejected<br><small>${(d.purpose || '').replace(/</g, '&lt;')}</small></li>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>Ad review</title><style>body{font:14px system-ui;background:#16161a;color:#ddd;margin:24px}a{color:#8fd0ff}li{margin:10px 0}small{color:#999}</style><h1>Ad review</h1><ul>${rows.join('') || '<li>No pending batches.</li>'}</ul>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (url.pathname === '/' || url.pathname === '/pending/') return send(res, 200, index(), TYPES['.html']);
    if (url.pathname.startsWith('/api/batch/')) return send(res, 200, batchData(decodeURIComponent(url.pathname.slice(11))));
    if (url.pathname === '/api/decide' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { batch, file, action, note } = JSON.parse(body || '{}');
      const image = decide(batch, file, action, { note });
      const src = batchData(batch).images.find((im) => im.file === file)?.src;
      console.log(`${action} ${batch}/${file}${image.note ? ` · note: ${image.note}` : ''}`);
      return send(res, 200, { image: { ...image, src } });
    }
    // Static files under assets/ads/ (pending pages and images, approved source images).
    const file = path.normalize(path.join(ADS, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ADS) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
  } catch (e) {
    return send(res, e instanceof ReviewError ? 400 : 500, { error: e.message });
  }
});

server.listen(REVIEW_PORT, '127.0.0.1', () => {
  console.log(`Ad review server: http://127.0.0.1:${REVIEW_PORT}/  (pending batches in ${path.relative(ROOT, PENDING)})`);
  console.log('Decisions and notes are logged to assets/ads/pending/feedback.jsonl. Ctrl+C to stop.');
});
