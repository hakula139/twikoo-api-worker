import { defineConfig } from 'drizzle-kit';

// drizzle-kit's D1 REST API requires an account ID and a token with D1 Edit permission.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    databaseId: '09fa1c1b-2f3e-4af8-bd3b-8f3b808c94c4',
    token: process.env.CLOUDFLARE_API_TOKEN ?? '',
  },
});
