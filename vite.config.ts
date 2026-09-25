import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: {
      // index.html: 2D tile prototype (set aside). poc3d.html: 3D rendering test block. district.html: Kaburo district.
      input: { main: 'index.html', poc3d: 'poc3d.html', district: 'district.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
