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
    // Migrates one PGlite database before any worker starts; every
    // integration test loads a copy of it. See the file for why.
    globalSetup: ['tests/helpers/database-template.ts'],
    // Files run in parallel: every integration test has an in-process
    // Postgres of its own, so files share nothing. The concurrency suites are
    // the exception — they share one real server and race on it on purpose —
    // and `test:concurrency` runs them one file at a time.
    // Each integration test loads its own PGlite (Postgres in WebAssembly);
    // no external database is required.
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
