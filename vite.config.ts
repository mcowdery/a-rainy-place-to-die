import { defineConfig } from 'vitest/config';
// F9 snapshots from the game (src/debug/snap.ts) are saved by the dev server to debug-shots/.
import { debugShots } from './scripts/debugShots.mjs';

export default defineConfig({
  plugins: [debugShots()],
  build: {
    rollupOptions: {
      // index.html: 2D tile prototype (set aside). poc3d.html: 3D rendering test block. district.html: Kaburo district.
      // models.html: showroom for reviewing car and people models in isolation.
      // race.html: the racing venue (Kurokami Pass), the handling test.
      input: { main: 'index.html', poc3d: 'poc3d.html', district: 'district.html', models: 'models.html', race: 'race.html', garage: 'garage.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
