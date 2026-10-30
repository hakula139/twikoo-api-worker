import type { Unstable_Config } from 'wrangler';

import { isBuiltin } from 'node:module';
import path from 'node:path';

import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { unstable_readConfig } from 'wrangler';

const wranglerConfig = './wrangler.toml';
const { alias } = unstable_readConfig({ config: wranglerConfig }) as Unstable_Config;
const aliases = Object.fromEntries(
  Object.entries(alias ?? {}).map(([name, target]) => [
    name,
    path.resolve(import.meta.dirname, target),
  ]),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: wranglerConfig },
    }),
  ],
  resolve: {
    alias: {
      ...aliases,
      '@': path.resolve(import.meta.dirname, 'src'),
      '@tests': path.resolve(import.meta.dirname, 'tests'),
    },
  },
  test: {
    setupFiles: ['./tests/setup.ts'],
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: [
            'twikoo-func/utils',
            'twikoo-func/utils/import',
            'twikoo-func/utils/lib',
            'twikoo-func/utils/logger',
            'twikoo-func/utils/notify',
          ],
          rolldownOptions: { external: isBuiltin },
        },
      },
    },
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
