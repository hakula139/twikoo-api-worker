import path from 'node:path';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      // `twikoo.ts` is third-party `twikoo-func` glue; `db/schema.ts` is pure
      // Drizzle table declarations. Type-only files emit no instrumentation.
      exclude: ['src/twikoo.ts', 'src/db/schema.ts'],
    },
  },
});
