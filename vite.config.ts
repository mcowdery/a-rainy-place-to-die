import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: {
      // index.html: the 2D tile prototype (set aside). poc3d.html: the first-person 3D rendering PoC.
      input: { main: 'index.html', poc3d: 'poc3d.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
