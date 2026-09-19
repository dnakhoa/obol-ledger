import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See tests/helpers/server-only-stub.ts for why this alias exists.
      'server-only': fileURLToPath(new URL('./tests/helpers/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Concurrency suites open many real connections; running files in
    // sequence keeps them from contending for the pool with each other.
    fileParallelism: false,
    // Each integration test spins up its own in-process Postgres (PGlite),
    // so files are isolated but cheap; no external database is required.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/server/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['src/server/db/schema.ts', '**/*.d.ts'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
