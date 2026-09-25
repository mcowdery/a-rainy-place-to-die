import type { FlagValue } from './flags';

/**
 * Tiny condition language for node visibility, e.g.
 *   ch2_started && !kanpai_closed
 *   world.time == "night" || flags.met_detective
 * Identifiers are flag keys (an optional "flags." prefix is stripped). Unset flags are undefined (falsy).
 * Supports: ! && || == != ( ), string/number/true/false literals.
 */
export type FlagReader = (key: string) => FlagValue | undefined;
export type Condition = (read: FlagReader) => boolean;

type Value = FlagValue | undefined;
type Expr =
  | { t: 'id'; key: string }
  | { t: 'lit'; v: FlagValue }
  | { t: 'not'; e: Expr }
  | { t: 'and' | 'or' | 'eq' | 'ne'; a: Expr; b: Expr };

const TOKEN = /\s*(?:(&&|\|\||==|!=|!|\(|\))|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(-?\d+(?:\.\d+)?)|([A-Za-z_][\w.]*))/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`unexpected character at ${start}: "${src.slice(start, start + 10)}"`);
    out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  }
  return out;
}

export function compileCondition(src: string): Condition {
  const toks = tokenize(src);
  let i = 0;
  const peek = (): string | undefined => toks[i];
  const take = (): string => {
    const t = toks[i++];
    if (t === undefined) throw new Error('unexpected end of condition');
    return t;
  };

  const primary = (): Expr => {
    const t = take();
    if (t === '(') {
      const e = or();
      if (take() !== ')') throw new Error('expected )');
      return e;
    }
    if (t[0] === '"' || t[0] === "'") return { t: 'lit', v: t.slice(1, -1).replace(/\\(.)/g, '$1') };
    if (/^-?\d/.test(t)) return { t: 'lit', v: Number(t) };
    if (t === 'true' || t === 'false') return { t: 'lit', v: t === 'true' };
    if (/^[A-Za-z_]/.test(t)) return { t: 'id', key: t.startsWith('flags.') ? t.slice(6) : t };
    throw new Error(`unexpected token "${t}"`);
  };
  const unary = (): Expr => (peek() === '!' ? (take(), { t: 'not', e: unary() }) : primary());
  const cmp = (): Expr => {
    const a = unary();
    const op = peek();
    if (op === '==' || op === '!=') {
      take();
      return { t: op === '==' ? 'eq' : 'ne', a, b: unary() };
    }
    return a;
  };
  const and = (): Expr => {
    let e = cmp();
    while (peek() === '&&') (take(), (e = { t: 'and', a: e, b: cmp() }));
    return e;
  };
  function or(): Expr {
    let e = and();
    while (peek() === '||') (take(), (e = { t: 'or', a: e, b: and() }));
    return e;
  }

  const root = or();
  if (i !== toks.length) throw new Error(`unexpected token "${toks[i]}"`);

  const ev = (e: Expr, read: FlagReader): Value => {
    switch (e.t) {
      case 'id': return read(e.key);
      case 'lit': return e.v;
      case 'not': return !ev(e.e, read);
      case 'and': return Boolean(ev(e.a, read)) && Boolean(ev(e.b, read));
      case 'or': return Boolean(ev(e.a, read)) || Boolean(ev(e.b, read));
      case 'eq': return ev(e.a, read) === ev(e.b, read);
      case 'ne': return ev(e.a, read) !== ev(e.b, read);
    }
  };
  return (read) => Boolean(ev(root, read));
}
