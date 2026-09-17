import { defineConfig } from 'vitest/config';

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
      '@': new URL('./devLogger/', import.meta.url).pathname,
    },
  },
});
