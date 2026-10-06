import { describe, expect, it } from 'vitest';
import root from '../CLAUDE.md?raw';

// The area docs (.claude/rules/*.md, indexed in CLAUDE.md) load when a file named in their `paths:` is opened, so a
// renamed or deleted source file silently stops its doc loading. These keep the lists honest.
const texts = import.meta.glob('../.claude/rules/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const docs = Object.fromEntries(Object.entries(texts).map(([path, text]) => [path.split('/').pop() as string, text]));
// Every file a doc could name (the keys only: nothing is loaded).
const files = new Set(
  Object.keys(import.meta.glob(['../src/**', '../content/**', '../scripts/**', '../story/**', '../assets/ads/briefs/**', '../*.html'])).map((p) => p.replace(/^\.\.\//, '')),
);
const pathsOf = (text: string) => {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return head ? [...head[1].matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]) : [];
};

describe('area docs', () => {
  it('there are some', () => {
    expect(Object.keys(docs).length).toBeGreaterThan(10);
  });

  it('each names files that exist', () => {
    const all = [...files];
    const missing: string[] = [];
    for (const [file, text] of Object.entries(docs)) {
      const paths = pathsOf(text);
      expect(paths.length, `${file} has no paths: it would load in every session`).toBeGreaterThan(0);
      for (const p of paths) {
        // a pattern: something must be under the folder before its first *; a plain path: the file itself
        const found = p.includes('*') ? all.some((f) => f.startsWith(p.slice(0, p.indexOf('*')))) : files.has(p);
        if (!found) missing.push(`${file}: ${p}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('each is in the index in CLAUDE.md, and the index lists no doc that is gone', () => {
    const listed = [...root.matchAll(/\]\(\.claude\/rules\/([a-z0-9-]+\.md)\)/g)].map((m) => m[1]);
    expect(Object.keys(docs).filter((f) => !listed.includes(f))).toEqual([]);
    expect([...new Set(listed)].filter((f) => !(f in docs))).toEqual([]);
  });

  it('keep a topic to a paragraph: no paragraph runs to the size the old single file had', () => {
    for (const [file, text] of [['CLAUDE.md', root], ...Object.entries(docs)]) {
      const longest = Math.max(...text.split(/\r?\n/).map((l) => l.length));
      expect(longest, `${file}: split its longest paragraph by topic`).toBeLessThan(12000);
    }
  });
});
