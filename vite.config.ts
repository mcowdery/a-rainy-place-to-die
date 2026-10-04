import { defineConfig } from 'vitest/config';
// F9 snapshots from the game (src/debug/snap.ts) are saved by the dev server to debug-shots/.
import { debugShots } from './scripts/debugShots.mjs';

// Editions (src/edition/types.ts): `--mode uncensored` builds the uncensored edition (with the overlays in adult/)
// into dist-uncensored/, `--mode demo` the gameplay demo (no story, tame art) into dist-demo/; any other mode (dev,
// build, test) is the standard edition. Each build bundles only its own edition's files.
const EDITIONS = ['standard', 'uncensored', 'demo'] as const;

export default defineConfig(({ mode }) => {
  const edition = (EDITIONS as readonly string[]).includes(mode) ? mode : 'standard';
  return {
    plugins: [debugShots()],
    // Root-relative, which Vite resolves from the project root (the config has no Node types to build a path with).
    resolve: { alias: { '@edition': `/src/edition/${edition}.ts` } },
    // For code that only needs the edition's name (the chunk workers' ad list), without importing its files.
    define: { __EDITION__: JSON.stringify(edition) },
    build: {
      outDir: edition === 'standard' ? 'dist' : `dist-${edition}`,
      rollupOptions: {
        // index.html: 2D tile prototype (set aside). poc3d.html: 3D rendering test block. district.html: Kaburo district.
        // models.html: showroom for reviewing car, cast and prop models in isolation; mob.html: the mob's own showroom.
        // race.html: the racing venue (Kurokami Pass), the handling test.
        input: { main: 'index.html', poc3d: 'poc3d.html', district: 'district.html', models: 'models.html', mob: 'mob.html', race: 'race.html', garage: 'garage.html' },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
