import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {defineConfig} from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['devLogger/**', 'devBrowserLogs/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(rootDir, 'devLogger'),
    },
  },
});
