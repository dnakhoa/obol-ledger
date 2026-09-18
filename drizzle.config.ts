import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

// Same .env cascade as the application, so `drizzle-kit` and the running app
// can never disagree about which database they are looking at.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? '' },
  strict: true,
  verbose: true,
});
