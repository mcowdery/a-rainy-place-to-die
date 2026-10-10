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
    resolve: { alias: { '@edition': `/src/edition/${edition}.ts`, '@bare': `/src/edition/bare/${edition === 'uncensored' ? 'uncensored' : 'none'}.ts` } },
    // For code that only needs the edition's name (the chunk workers' ad list), without importing its files.
    define: { __EDITION__: JSON.stringify(edition) },
    // Other agents' checkouts (.claude/worktrees, scripts/worktree.mjs) and the shots are inside this folder but are
    // none of this server's business: a save or a git operation in one mustn't reload the page being played here.
    // No hot reload: the game can't swap a module in place, so every save of a source file (an agent's, mid-play)
    // reloaded the whole page. A change is picked up when you refresh (F5); the files are still watched for that.
    server: { hmr: false, watch: { ignored: ['**/.claude/**', '**/debug-shots/**', '**/.cache/**'] } },
    build: {
      outDir: edition === 'standard' ? 'dist' : `dist-${edition}`,
      rollupOptions: {
        // index.html: the city (the game; the 2D tile prototype it replaced is set aside in archive/2d/). poc3d.html: 3D rendering test block.
        // models.html: the index of the showrooms; models-<room>.html (Tōto's cars, mack, plants, buildings, transit) and models-<room>-ph.html (Manila's cars, plants, boats, buildings) review models in isolation, one room a page (src/poc3d/showroom/shell.ts, rooms/);
        // mob.html: the mob's own showroom, mob-ph.html its Manila half; characters.html: the named characters built on the mob's bodies (the same page's other half).
        // race.html: the racing venue (Kurokami Pass), the handling test.
        // scenes.html: the editor for the rooms behind the windows (it saves through the dev server; built, it downloads).
        // fight.html: the fight test, a yard for trying the melee as Mack in first person.
        input: { city: 'index.html', poc3d: 'poc3d.html', models: 'models.html', modelsCars: 'models-cars.html', modelsMack: 'models-mack.html', modelsPlants: 'models-plants.html', modelsBuildings: 'models-buildings.html', modelsTransit: 'models-transit.html', modelsCarsPh: 'models-cars-ph.html', modelsPlantsPh: 'models-plants-ph.html', modelsBoatsPh: 'models-boats-ph.html', modelsBuildingsPh: 'models-buildings-ph.html', mob: 'mob.html', mobPh: 'mob-ph.html', characters: 'characters.html', scenes: 'scenes.html', race: 'race.html', garage: 'garage.html', fight: 'fight.html' },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
