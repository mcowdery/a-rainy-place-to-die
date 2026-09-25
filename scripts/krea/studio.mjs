// Minimal client for Krea Studio (the VN generator's local FastAPI server).
//
// Auth: Studio uses local accounts with a signed session cookie (krea_session, valid 30 days). We never
// store a password: `npm run krea:login` asks for it once (or reads KREA_STUDIO_USERNAME / _PASSWORD from
// the environment or .env.krea for unattended use), logs in, and caches only the session cookie in
// .krea/session.json. Both .krea/ and .env.krea are git-ignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SESSION_FILE = path.join(ROOT, '.krea', 'session.json');

/** Settings from the environment, then .env.krea (KEY=value lines), then defaults. */
export function config() {
  const file = path.join(ROOT, '.env.krea');
  const fromFile = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trimStart().startsWith('#')) fromFile[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const get = (k, d) => process.env[k] ?? fromFile[k] ?? d;
  return {
    url: get('KREA_STUDIO_URL', 'http://127.0.0.1:7860').replace(/\/+$/, ''),
    username: get('KREA_STUDIO_USERNAME', ''),
    password: get('KREA_STUDIO_PASSWORD', ''),
  };
}

function loadSession(url) {
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    return s.url === url ? s : null;
  } catch {
    return null;
  }
}

export class StudioError extends Error {}

export class Studio {
  constructor(cfg = config()) {
    this.cfg = cfg;
    this.session = loadSession(cfg.url);
  }

  async request(method, route, body, { raw = false } = {}) {
    let res;
    try {
      res = await fetch(this.cfg.url + route, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(this.session ? { cookie: this.session.cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
    } catch (e) {
      throw new StudioError(`Krea Studio is not reachable at ${this.cfg.url} (${e.cause?.code ?? e.message}). Is it running?`);
    }
    if (res.status === 401) throw new StudioError('Not logged in to Krea Studio (or the session expired). Run: npm run krea:login');
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail = text;
      try {
        detail = JSON.parse(text).detail ?? text;
      } catch {}
      throw new StudioError(`${method} ${route} -> ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }
    return raw ? res : res.json();
  }

  /** Logs in and caches the session cookie (never the password). */
  async login(username, password) {
    this.session = null;
    const res = await fetch(this.cfg.url + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).catch((e) => {
      throw new StudioError(`Krea Studio is not reachable at ${this.cfg.url} (${e.cause?.code ?? e.message}).`);
    });
    if (!res.ok) throw new StudioError(`Login failed (${res.status}): ${(await res.json().catch(() => ({}))).detail ?? ''}`);
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('krea_session='));
    if (!cookie) throw new StudioError('Login succeeded but Studio sent no session cookie.');
    const { user } = await res.json();
    this.session = { url: this.cfg.url, cookie, username: user?.username, savedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(this.session, null, 2), { mode: 0o600 });
    return user;
  }

  /** The logged-in user, or null. Logs in from configured credentials if there is no valid session. */
  async me() {
    if (this.session) {
      const r = await this.request('GET', '/api/auth/me');
      if (r.user) return r.user;
    }
    if (this.cfg.username && this.cfg.password) return this.login(this.cfg.username, this.cfg.password);
    return null;
  }

  /** Id of the person LoRA with this trigger (e.g. "ohwx julie"), searched in /api/character. */
  async loraId(trigger, kind = 'person') {
    const state = await this.request('GET', `/api/character?kind=${kind}`);
    const want = trigger.trim().toLowerCase();
    let found = null;
    const walk = (v) => {
      if (found || !v || typeof v !== 'object') return;
      if (!Array.isArray(v) && typeof v.trigger === 'string' && v.trigger.trim().toLowerCase() === want && v.id) found = v;
      for (const x of Object.values(v)) walk(x);
    };
    walk(state);
    if (!found) throw new StudioError(`No ${kind} LoRA with trigger "${trigger}" in Krea Studio.`);
    return String(found.id);
  }

  /** Submits one generation (1-4 images) and waits for it. Returns [{ url, seed, width, height }]. */
  async generate(req, { onStatus = () => {}, timeoutMs = 15 * 60 * 1000 } = {}) {
    const start = await this.request('POST', '/api/generate', req);
    const deadline = Date.now() + timeoutMs;
    let last = '';
    for (;;) {
      const r = await this.request('GET', `/api/jobs/${encodeURIComponent(start.job_id)}`);
      const status = String(r.status ?? '');
      if (status !== last) onStatus(status, start.job_id);
      last = status;
      if (status === 'COMPLETED') return { jobId: start.job_id, items: r.items ?? (r.item ? [r.item] : []) };
      if (!['IN_QUEUE', 'IN_PROGRESS', 'QUEUED', 'RUNNING', ''].includes(status)) throw new StudioError(`Job ${start.job_id} ended ${status}: ${r.error ?? r.message ?? ''}`);
      if (Date.now() > deadline) throw new StudioError(`Job ${start.job_id} timed out.`);
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }

  /** Downloads a Studio output URL (e.g. /outputs/...) to a file. */
  async download(url, dest) {
    const res = await this.request('GET', url, undefined, { raw: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
}
