/**
 * The shared playtest build (`npm run build:share`, scripts/buildShare.mjs): the standard edition with the debug menu
 * open to everyone, crash damage off by default, and the things-to-try panel (district/playtest.ts). Vite sets
 * `VITE_SHARE` and `VITE_BUILD_LABEL` from the environment, so no config changes: every other build leaves both unset.
 */
export const SHARE = import.meta.env.VITE_SHARE === '1';
/** Which build a report came from (the build's date and commit; "dev" on the dev server). */
export const BUILD_LABEL: string = import.meta.env.VITE_BUILD_LABEL ?? 'dev';
