import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs at build time on the laptop / CI, not inside a Worker, so
// it talks to D1 via the REST API rather than the wrangler binding. The
// account / database IDs are operational config (already in wrangler.toml);
// CLOUDFLARE_D1_TOKEN must be exported in the shell with "D1 Edit" permission.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    databaseId: '09fa1c1b-2f3e-4af8-bd3b-8f3b808c94c4',
    token: process.env.CLOUDFLARE_D1_TOKEN ?? '',
  },
});
