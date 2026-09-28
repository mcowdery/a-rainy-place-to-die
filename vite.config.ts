import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: {
      // index.html: 2D tile prototype (set aside). poc3d.html: 3D rendering test block. district.html: Kaburo district.
      // models.html: showroom for reviewing car and people models in isolation.
      // race.html: the racing venue (Kurokami Pass), the handling test.
      input: { main: 'index.html', poc3d: 'poc3d.html', district: 'district.html', models: 'models.html', race: 'race.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
