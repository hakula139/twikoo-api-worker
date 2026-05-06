// Workers free-tier bundles are capped at 1 MiB. `twikoo-func` pulls in three
// Node-only modules that the runtime can't execute anyway (`jsdom`,
// `tencentcloud-sdk-nodejs`, `nodemailer`); we replace their entry points with
// empty files so esbuild tree-shakes them out at deploy time. Custom shims
// (xss for sanitization, fetch-based mail providers) live in `src/`.

import { existsSync, writeFileSync } from 'node:fs';

const TARGETS = [
  'node_modules/jsdom/lib/api.js',
  'node_modules/tencentcloud-sdk-nodejs/tencentcloud/index.js',
  'node_modules/nodemailer/lib/nodemailer.js',
];

for (const target of TARGETS) {
  if (existsSync(target)) {
    writeFileSync(target, '');
    console.log(`  trimmed ${target}`);
  }
}
