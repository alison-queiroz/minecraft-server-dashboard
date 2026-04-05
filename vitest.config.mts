/// <reference types="vitest/config" />

import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath, URL } from 'node:url';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [angular(), viteTsConfigPaths()],
  resolve: {
    alias: {
      src: fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['e2e/**', 'dist/**', 'coverage/**'],
    reporters: ['default'],
  },
});
