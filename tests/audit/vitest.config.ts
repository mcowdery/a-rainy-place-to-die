import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import base from '../../vite.config';

// The street audit (npm run audit:streets): not part of `npm test` (its files end .audit.ts, which the tests' own
// include doesn't take); run with the project's Vite config so the content's globs work.
export default defineConfig(async (env) => {
  const b = (typeof base === 'function' ? await (base as (e: unknown) => unknown)(env) : base) as Record<string, unknown>;
  return { ...b, root: fileURLToPath(new URL('../../', import.meta.url)), test: { environment: 'node', include: ['tests/audit/*.audit.ts'], testTimeout: 600000 } };
});
