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
    // Opt-in via `--coverage` (CI / `npm run test:coverage`) so plain `npm test`
    // stays fast. Thresholds only apply to coverage runs.
    coverage: {
      provider: 'v8',
      // Count every app source file, not just the ones a spec happens to import,
      // so a component with no spec drags the totals down instead of vanishing.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/test-setup.ts',
        'src/main.ts',
        'src/polyfills.ts',
        'src/environments/**',
      ],
      reporter: ['text', 'html'],
      skipFull: true,
      // Ratchet, ~2 points below the measured totals (lines 82.3, statements
      // 82.0, functions 78.7, branches 75.2). Raise as coverage improves;
      // never lower to make a PR pass.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 77,
        branches: 73,
      },
    },
  },
});
