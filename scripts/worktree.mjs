// A checkout of one's own for a piece of work, so several agents can work at once without seeing each other's
// half-finished edits: its own files, branch, node_modules, Vite cache, dev server and debug-shots.
//
//   node scripts/worktree.mjs add <name> [--adult]   .claude/worktrees/<name> on branch worktree-<name>, from the commit
//                                                    this checkout is on, installed and ready (the place and the branch
//                                                    name are Claude Code's own, so its EnterWorktree and `claude -w
//                                                    <name>` open the same checkout)
//   node scripts/worktree.mjs setup                  in a worktree made some other way: install, copy the local files
//   node scripts/worktree.mjs list                   each worktree, what's uncommitted in it and how far it has got
//   node scripts/worktree.mjs remove <name> [--force]   takes it away once its work is merged (--force: whatever's in it)
//
// What isn't in git doesn't come along by itself: node_modules is installed (`npm ci`, ~125 MB), the files named in
// .worktreeinclude (the Studio login) are copied, debug-shots/ starts empty but for its scripts. adult/ (the
// uncensored edition, a repository of its own) comes only with --adult, as a clone: bring its commits back with
// `git -C adult pull <worktree>/adult` from the main checkout. Never link it in: removing a worktree deletes what's in it.
// Uncommitted work here is NOT in a new worktree: commit first.
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const git = (args, cwd = process.cwd()) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const tryGit = (args, cwd) => {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

/** Every worktree of this repository, the main checkout first. */
function worktrees() {
  return git(['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const get = (key) => (block.split(/\r?\n/).find((l) => l.startsWith(key + ' ')) ?? '').slice(key.length + 1);
    return { path: resolve(get('worktree')), branch: get('branch').replace('refs/heads/', '') };
  });
}

const MAIN = worktrees()[0].path;
const HOME = join(MAIN, '.claude', 'worktrees');

function setup(dir, adult) {
  // The local files a checkout needs (.worktreeinclude: one path a line), from the main checkout.
  const include = existsSync(join(MAIN, '.worktreeinclude')) ? readFileSync(join(MAIN, '.worktreeinclude'), 'utf8').split(/\r?\n/) : [];
  for (const line of include) {
    const rel = line.trim().replace(/\/$/, '');
    if (!rel || rel.startsWith('#') || !existsSync(join(MAIN, rel)) || existsSync(join(dir, rel))) continue;
    cpSync(join(MAIN, rel), join(dir, rel), { recursive: true });
    console.log(`copied ${rel}`);
  }
  if (adult && existsSync(join(MAIN, 'adult', '.git')) && !existsSync(join(dir, 'adult'))) {
    git(['clone', '--quiet', join(MAIN, 'adult'), join(dir, 'adult')]);
    console.log('cloned adult/ (bring its commits back with: git -C adult pull <this worktree>/adult)');
  }
  if (!existsSync(join(dir, 'node_modules'))) {
    console.log('installing node_modules (npm ci)...');
    const env = { ...process.env, PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` };
    execSync('npm ci --no-audit --no-fund', { cwd: dir, env, stdio: ['ignore', 'ignore', 'inherit'] });
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const name = rest.find((a) => !a.startsWith('--'));
const named = () => {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) fail('a name in lower case, digits and hyphens: node scripts/worktree.mjs ' + cmd + ' <name>');
  return join(HOME, name);
};

if (cmd === 'add') {
  const dir = named();
  if (existsSync(dir)) fail(`${dir} is already there`);
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
  git(['worktree', 'add', '--quiet', '-b', `worktree-${name}`, dir, 'HEAD']);
  setup(dir, flags.has('--adult'));
  console.log(`\n${dir}\non branch worktree-${name}, from ${git(['log', '-1', '--format=%h %s'])}`);
  if (dirty) console.log(`NOTE: ${dirty} uncommitted changes in ${process.cwd()} are not in it (a worktree starts from the last commit).`);
  console.log(`Work there, commit there, then from the main checkout: git merge worktree-${name}`);
} else if (cmd === 'setup') {
  const here = git(['rev-parse', '--show-toplevel']);
  if (resolve(here) === MAIN) fail('this is the main checkout; setup is for a worktree');
  setup(resolve(here), flags.has('--adult'));
  console.log('ready');
} else if (cmd === 'list') {
  const base = worktrees()[0].branch;
  for (const w of worktrees()) {
    const dirty = (tryGit(['status', '--porcelain'], w.path) ?? '').split('\n').filter(Boolean).length;
    const ahead = w.path === MAIN ? '' : `, ${tryGit(['rev-list', '--count', `${base}..${w.branch}`]) ?? '?'} commits not in ${base}`;
    console.log(`${w.path}\n    ${w.branch || '(detached)'}: ${dirty} uncommitted${ahead}`);
  }
} else if (cmd === 'remove') {
  const dir = named();
  const w = worktrees().find((x) => x.path === resolve(dir));
  if (!w) fail(`no worktree at ${dir}`);
  const force = flags.has('--force');
  const dirty = git(['status', '--porcelain'], dir).split('\n').filter(Boolean);
  const base = worktrees()[0].branch;
  const ahead = Number(tryGit(['rev-list', '--count', `${base}..${w.branch}`]) ?? 0);
  if (!force && (dirty.length || ahead)) fail(`${name} still has work: ${dirty.length} uncommitted, ${ahead} commits not in ${base}. Merge it (git merge ${w.branch}) or pass --force to throw it away.`);
  git(['worktree', 'remove', '--force', dir]);
  if (w.branch) tryGit(['branch', force ? '-D' : '-d', w.branch]);
  console.log(`removed ${dir}${w.branch ? ` and its branch ${w.branch}` : ''}`);
} else {
  fail('node scripts/worktree.mjs add <name> [--adult] | setup | list | remove <name> [--force]');
}
