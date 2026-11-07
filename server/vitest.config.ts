import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
