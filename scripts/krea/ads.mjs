// Ad / signage art from Krea Studio, propose-then-review. Nothing here wires images into the world:
// generated candidates land in assets/ads/pending/<batch>/ with a manifest; you approve (moves the image to
// assets/ads/source/) or reject; wiring an approved image in is a separate, explicit step.
//
//   npm run krea:login                                   log in once (session cached in .krea/, 30 days)
//   node scripts/krea/ads.mjs signup [name]              create this project's own Studio account (sign-ups open)
//   npm run ads:generate -- <brief.json> [--dry-run] [--only id,id] [--skip-missing-lora]   generate a batch
//   npm run ads:review [-- <batch>]                      list pending batches / one batch's candidates
//   npm run ads:approve -- <batch> <file> [--as <name>]  move a candidate to assets/ads/source/<name>.png
//   npm run ads:reject -- <batch> <file> [--reason ...]  move a candidate to pending/<batch>/rejected/
//   node scripts/krea/ads.mjs approve-chosen            approve whatever was moved into pending/<batch>/chosen/
//   npm run ads:status                                   check the Studio connection and login
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { ROOT, Studio, StudioError, config } from './studio.mjs';

const PENDING = path.join(ROOT, 'assets', 'ads', 'pending');
const SOURCE = path.join(ROOT, 'assets', 'ads', 'source');

/**
 * The house style: the anchor prefix used for the taxi ads, then the (optional) LoRA trigger, then the
 * subject. Text is composited in the engine, so images ask for no lettering (the generator's own lettering
 * comes out garbled).
 */
export const STYLE_ANCHOR = 'photorealistic advertising photography, professional studio lighting, commercial print ad, 80s/90s Japanese magazine ad aesthetic, shot on film, glossy poster finish';
const NO_TEXT = 'no text, no lettering, no logos, no watermark';
/** Composition hints and default sizes per use (all crops happen after approval). */
const USES = {
  taxi: { size: [1024, 1024], hint: 'vertical composition' },
  poster: { size: [832, 1216], hint: 'vertical poster composition' },
  // (Avoid the word "billboard": the model then draws a photo *of* a billboard with an empty panel.)
  // ("Leave space for text" gave blank white halves: ask for an off-centre subject in a full-frame scene.)
  billboard: { size: [1536, 768], hint: 'wide horizontal composition, subject off-centre to one side, the background scene continues across the whole frame' },
  sign: { size: [1024, 1024], hint: 'centred composition' },
};
const DEFAULTS = { lora: 'ohwx julie', loraScale: 0.85, steps: 12, variants: 2, model: 'krea-2-turbo' };

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

function ask(question, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '');
  return new Promise((ok) => rl.question(question, (a) => (rl.close(), hidden && process.stdout.write('\n'), ok(a))));
}

/** The prompt for one brief item, exactly as sent. */
export function promptFor(item, use, lora) {
  const hint = item.composition ?? USES[use]?.hint;
  return [STYLE_ANCHOR, lora || null, item.subject, hint, item.noText === false ? null : NO_TEXT].filter(Boolean).join(', ');
}

async function cmdLogin() {
  const cfg = config();
  const studio = new Studio(cfg);
  const username = cfg.username || (await ask(`Krea Studio username (${cfg.url}): `));
  const password = cfg.password || (await ask('Password (not stored): ', true));
  const user = await studio.login(username.trim(), password);
  console.log(`Logged in as ${user.username}. Session cached in .krea/session.json (valid ~30 days).`);
}

/**
 * Creates this project's own Studio account (only works while Studio allows sign-ups) with a random
 * password, saved to the git-ignored .env.krea so the client can log itself in whenever the session expires.
 */
async function cmdSignup() {
  const envPath = path.join(ROOT, '.env.krea');
  const cfg = config();
  if (cfg.username && cfg.password) throw new StudioError(`.env.krea already has credentials for "${cfg.username}".`);
  const username = typeof args[1] === 'string' ? args[1] : 'citypopper_bot';
  const password = crypto.randomBytes(24).toString('base64url');
  const res = await fetch(cfg.url + '/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!res.ok) throw new StudioError(`Sign-up failed (${res.status}): ${(await res.json().catch(() => ({}))).detail ?? ''}`);
  const kept = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !/^\s*KREA_STUDIO_(USERNAME|PASSWORD)\s*=/.test(l))
    : [`KREA_STUDIO_URL=${cfg.url}`];
  kept.push(`KREA_STUDIO_USERNAME=${username}`, `KREA_STUDIO_PASSWORD=${password}`);
  fs.writeFileSync(envPath, kept.join('\n') + '\n', { mode: 0o600 });
  const user = await new Studio(config()).login(username, password);
  console.log(`Created Studio account "${user.username}" (role ${user.role}); credentials saved to .env.krea (git-ignored), session cached.`);
}

async function cmdStatus() {
  const studio = new Studio();
  const user = await studio.me();
  if (!user) return console.log(`Studio at ${studio.cfg.url} is up, but not logged in. Run: npm run krea:login`);
  console.log(`Connected to ${studio.cfg.url} as ${user.username}.`);
  try {
    console.log(`LoRA "${DEFAULTS.lora}" -> ${await studio.loraId(DEFAULTS.lora)}`);
  } catch (e) {
    console.log(e.message);
  }
}

/**
 * Brief format (JSON): {
 *   batch: "harbor-billboards-01",       // folder name under assets/ads/pending/
 *   purpose: "why this batch exists",    // shown in the manifest / review
 *   use: "billboard" | "taxi" | "poster" | "sign",
 *   district?: "harbor",
 *   defaults?: { lora?: "ohwx julie" | null, loraScale?, width?, height?, steps?, variants? },
 *   items: [{ id, brand?, copy?, subject, lora?, variants?, width?, height?, composition?, notes? }]
 * }
 */
async function cmdGenerate() {
  const dry = Boolean(flag('dry-run'));
  // Items whose LoRA this Studio account can't see are skipped (with a warning) instead of failing the batch.
  const skipMissing = Boolean(flag('skip-missing-lora'));
  // --only a,b: generate just these item ids (e.g. to redo or add to a batch).
  const only = flag('only');
  const onlyIds = typeof only === 'string' ? new Set(only.split(',').map((x) => x.trim())) : null;
  const briefPath = args[1];
  if (!briefPath) throw new StudioError('Usage: npm run ads:generate -- <brief.json> [--dry-run]');
  const brief = readJson(path.resolve(briefPath));
  const use = brief.use ?? 'sign';
  if (!USES[use]) throw new StudioError(`Unknown use "${use}" (${Object.keys(USES).join(', ')}).`);
  if (!brief.batch || !Array.isArray(brief.items) || brief.items.length === 0) throw new StudioError('A brief needs "batch" and a non-empty "items" list.');
  const d = { ...DEFAULTS, width: USES[use].size[0], height: USES[use].size[1], ...(brief.defaults ?? {}) };
  const batch = slug(brief.batch);
  const dir = path.join(PENDING, batch);

  const plan = brief.items.filter((item) => !onlyIds || onlyIds.has(item.id)).map((item) => {
    const lora = item.lora === undefined ? d.lora : item.lora || null;
    return {
      item,
      lora,
      width: item.width ?? d.width,
      height: item.height ?? d.height,
      variants: Math.min(4, item.variants ?? d.variants),
      prompt: promptFor(item, use, lora),
    };
  });
  const total = plan.reduce((a, p) => a + p.variants, 0);
  console.log(`Batch "${batch}" (${use}): ${plan.length} items, ${total} images -> assets/ads/pending/${batch}/`);
  for (const p of plan) console.log(`  ${p.item.id} x${p.variants} ${p.width}x${p.height}${p.lora ? ` [${p.lora}]` : ''}\n    ${p.prompt}`);
  if (dry) return console.log('Dry run: nothing submitted.');

  const studio = new Studio();
  if (!(await studio.me())) throw new StudioError('Not logged in to Krea Studio. Run: npm run krea:login');
  const loraIds = new Map();
  for (const p of plan) {
    if (!p.lora || loraIds.has(p.lora)) continue;
    try {
      loraIds.set(p.lora, await studio.loraId(p.lora));
    } catch (e) {
      if (!skipMissing) throw e;
      loraIds.set(p.lora, null);
      console.log(`  (skipping items that use "${p.lora}": not available to this account)`);
    }
  }

  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? readJson(manifestPath)
    : { batch, purpose: brief.purpose ?? '', use, district: brief.district ?? null, brief: path.relative(ROOT, path.resolve(briefPath)).replace(/\\/g, '/'), created: new Date().toISOString(), images: [] };
  for (const p of plan) {
    if (p.lora && !loraIds.get(p.lora)) continue;
    const req = {
      prompt: p.prompt,
      width: p.width,
      height: p.height,
      steps: d.steps,
      num_images: p.variants,
      model: d.model,
      ...(p.lora ? { char_scale: d.loraScale, character_id: loraIds.get(p.lora), char_trigger: p.lora } : { char_scale: 0 }),
    };
    process.stdout.write(`  ${p.item.id}: `);
    const { jobId, items } = await studio.generate(req, { onStatus: (s) => process.stdout.write(`${s.toLowerCase()} `) });
    const already = manifest.images.filter((im) => im.item === p.item.id).length;
    for (const [k, out] of items.entries()) {
      const file = `${slug(p.item.id)}_v${already + k + 1}.png`;
      await studio.download(out.url, path.join(dir, file));
      manifest.images.push({
        file,
        item: p.item.id,
        brand: p.item.brand ?? null,
        copy: p.item.copy ?? null,
        notes: p.item.notes ?? null,
        prompt: p.prompt,
        lora: p.lora ? { trigger: p.lora, scale: d.loraScale } : null,
        model: d.model,
        size: [out.width ?? p.width, out.height ?? p.height],
        steps: d.steps,
        seed: out.seed ?? null,
        studioJob: jobId,
        generated: new Date().toISOString(),
        status: 'pending',
      });
    }
    writeJson(manifestPath, manifest);
    console.log(`-> ${items.length} saved`);
  }
  writeReview(dir, manifest);
  console.log(`\nDone. Review: assets/ads/pending/${batch}/review.html (or REVIEW.md). Nothing has been wired into the world.`);
}

/** REVIEW.md (text) and review.html (contact sheet) for a batch. */
function writeReview(dir, m) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const md = [
    `# Pending ad art: ${m.batch}`,
    '',
    `Purpose: ${m.purpose || '-'}  `,
    `Use: ${m.use}${m.district ? ` · district: ${m.district}` : ''} · brief: \`${m.brief}\``,
    '',
    'Approve: `npm run ads:approve -- ' + m.batch + ' <file> [--as NN_name]` · Reject: `npm run ads:reject -- ' + m.batch + ' <file>`',
    '',
    '| file | item | brand / copy | status | seed |',
    '|---|---|---|---|---|',
    ...m.images.map((im) => `| ${im.file} | ${im.item} | ${[im.brand, im.copy].filter(Boolean).join(' · ') || '-'} | ${im.status} | ${im.seed ?? ''} |`),
    '',
    ...m.images.map((im) => `- **${im.file}** prompt: ${im.prompt}${im.notes ? `\n  notes: ${im.notes}` : ''}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'REVIEW.md'), md);
  const cards = m.images
    .map((im) => `<figure class="${im.status}"><img src="${esc(im.status === 'pending' ? im.file : '')}" alt=""><figcaption><b>${esc(im.file)}</b> · ${esc(im.status)}<br>${esc([im.brand, im.copy].filter(Boolean).join(' · '))}<br><small>${esc(im.prompt)}</small></figcaption></figure>`)
    .join('\n');
  fs.writeFileSync(
    path.join(dir, 'review.html'),
    `<!doctype html><meta charset="utf-8"><title>${esc(m.batch)}</title><style>body{font:13px system-ui;background:#16161a;color:#ddd;margin:16px}figure{display:inline-block;width:300px;margin:8px;vertical-align:top}img{width:300px;background:#333}figure.approved,figure.rejected{opacity:.4}small{color:#999}</style><h2>${esc(m.batch)}</h2><p>${esc(m.purpose)}</p>${cards}`,
  );
}

function cmdReview() {
  const batch = args[1];
  if (!fs.existsSync(PENDING)) return console.log('No pending ad art.');
  const batches = batch ? [slug(batch)] : fs.readdirSync(PENDING).filter((b) => fs.existsSync(path.join(PENDING, b, 'manifest.json')));
  if (batches.length === 0) return console.log('No pending ad art.');
  for (const b of batches) {
    const m = readJson(path.join(PENDING, b, 'manifest.json'));
    const count = (s) => m.images.filter((im) => im.status === s).length;
    console.log(`${b}: ${m.purpose || '(no purpose)'} · ${count('pending')} pending, ${count('approved')} approved, ${count('rejected')} rejected`);
    if (batch) for (const im of m.images) console.log(`  [${im.status}] ${im.file}  ${[im.brand, im.copy].filter(Boolean).join(' · ')}`);
  }
}

function decide(approve) {
  const [, batchArg, file] = args;
  const as = flag('as');
  const reason = flag('reason');
  if (!batchArg || !file) throw new StudioError(`Usage: npm run ads:${approve ? 'approve' : 'reject'} -- <batch> <file>${approve ? ' [--as NN_name]' : ' [--reason ...]'}`);
  const dir = path.join(PENDING, slug(batchArg));
  const manifestPath = path.join(dir, 'manifest.json');
  const m = readJson(manifestPath);
  const im = m.images.find((x) => x.file === file);
  if (!im) throw new StudioError(`No ${file} in batch ${batchArg}.`);
  if (im.status !== 'pending') throw new StudioError(`${file} is already ${im.status}.`);
  const from = path.join(dir, file);
  if (approve) {
    const name = typeof as === 'string' ? slug(as) : `${slug(m.batch)}_${path.basename(file, '.png')}`;
    const to = path.join(SOURCE, `${name}.png`);
    if (fs.existsSync(to)) throw new StudioError(`assets/ads/source/${name}.png already exists; pick another --as.`);
    fs.mkdirSync(SOURCE, { recursive: true });
    fs.renameSync(from, to);
    Object.assign(im, { status: 'approved', approvedAs: `assets/ads/source/${name}.png`, decided: new Date().toISOString() });
    // Keep the provenance next to the approved image.
    writeJson(path.join(SOURCE, `${name}.json`), { ...im, batch: m.batch, purpose: m.purpose, use: m.use, district: m.district });
    console.log(`Approved -> assets/ads/source/${name}.png (not wired into the world yet).`);
  } else {
    fs.mkdirSync(path.join(dir, 'rejected'), { recursive: true });
    fs.renameSync(from, path.join(dir, 'rejected', file));
    Object.assign(im, { status: 'rejected', reason: typeof reason === 'string' ? reason : null, decided: new Date().toISOString() });
    console.log(`Rejected -> pending/${slug(batchArg)}/rejected/${file}`);
  }
  writeJson(manifestPath, m);
  writeReview(dir, m);
}

/**
 * Approves everything the user moved into a `chosen/` folder under any pending batch: each file is matched to
 * the batch manifest that generated it (by file name), moved to assets/ads/source/NN_<item>.png (numbered
 * after the existing art) with its provenance, and marked approved. Files it can't match are left alone.
 */
function cmdApproveChosen() {
  if (!fs.existsSync(PENDING)) return console.log('No pending ad art.');
  const batches = fs.readdirSync(PENDING).filter((b) => fs.existsSync(path.join(PENDING, b, 'manifest.json')));
  const manifests = new Map(batches.map((b) => [b, readJson(path.join(PENDING, b, 'manifest.json'))]));
  fs.mkdirSync(SOURCE, { recursive: true });
  const artDir = path.join(ROOT, 'assets', 'ads');
  const used = [...fs.readdirSync(artDir), ...fs.readdirSync(SOURCE)].map((f) => parseInt(f, 10)).filter((n) => n > 0);
  let next = Math.max(0, ...used) + 1;
  const touched = new Set();
  for (const b of batches) {
    const chosen = path.join(PENDING, b, 'chosen');
    if (!fs.existsSync(chosen)) continue;
    for (const file of fs.readdirSync(chosen).filter((f) => f.endsWith('.png'))) {
      const owner = [...manifests].find(([, m]) => m.images.some((im) => im.file === file && im.status === 'pending'));
      if (!owner) {
        console.log(`  ? ${file}: no pending image with that name in any batch, left in place`);
        continue;
      }
      const [ob, m] = owner;
      const im = m.images.find((x) => x.file === file);
      const name = `${String(next++).padStart(2, '0')}_${slug(im.item)}`;
      fs.renameSync(path.join(chosen, file), path.join(SOURCE, `${name}.png`));
      Object.assign(im, { status: 'approved', approvedAs: `assets/ads/source/${name}.png`, decided: new Date().toISOString() });
      writeJson(path.join(SOURCE, `${name}.json`), { ...im, batch: m.batch, purpose: m.purpose, use: m.use, district: m.district });
      touched.add(ob);
      console.log(`  approved ${ob}/${file} -> assets/ads/source/${name}.png`);
    }
  }
  for (const b of touched) {
    writeJson(path.join(PENDING, b, 'manifest.json'), manifests.get(b));
    writeReview(path.join(PENDING, b), manifests.get(b));
  }
}

const commands = { login: cmdLogin, signup: cmdSignup, status: cmdStatus, generate: cmdGenerate, review: cmdReview, approve: () => decide(true), 'approve-chosen': cmdApproveChosen, reject: () => decide(false) };
const cmd = commands[args[0]];
if (!cmd) {
  console.log('Commands: login | status | generate <brief.json> [--dry-run] | review [batch] | approve <batch> <file> [--as name] | reject <batch> <file> [--reason ...]');
  process.exit(1);
}
try {
  await cmd();
} catch (e) {
  console.error(e instanceof StudioError ? `Error: ${e.message}` : e);
  process.exit(1);
}
