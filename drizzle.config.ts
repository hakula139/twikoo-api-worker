import type { Unstable_Config } from 'wrangler';

import { defineConfig } from 'drizzle-kit';
import { unstable_readConfig } from 'wrangler';

const { d1_databases } = unstable_readConfig({ config: './wrangler.toml' }) as Unstable_Config;
const databaseId = d1_databases.find(({ binding }) => binding === 'DB')?.database_id;

if (!databaseId) {
  throw new Error('Wrangler must define a DB D1 binding with a database_id.');
}

// drizzle-kit's D1 REST API requires an account ID and a token with D1 Edit permission.
export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    databaseId,
    token: process.env.CLOUDFLARE_API_TOKEN ?? '',
  },
});
