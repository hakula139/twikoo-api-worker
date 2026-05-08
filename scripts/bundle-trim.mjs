// Workers free-tier bundles cap at 1 MiB. `twikoo-func` pulls in three
// Node-only modules the runtime can't execute; null out their entry points so
// esbuild tree-shakes the rest. The lookup walks pnpm's `.pnpm/` hoist layout.
// CI enforces a 950 KiB compressed cap (.github/workflows/ci.yml). If a new
// twikoo-func release pulls in another Node-only dep, add it to PACKAGES below
// — the CI gate is the alarm.

import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PACKAGES = ['jsdom', 'nodemailer', 'tencentcloud-sdk-nodejs'];

const entryPathsFromPkg = (pkgJson) => {
  const entries = new Set();
  if (typeof pkgJson.main === 'string') {
    entries.add(pkgJson.main);
  }
  if (typeof pkgJson.module === 'string') {
    entries.add(pkgJson.module);
  }
  const exp = pkgJson.exports;
  if (exp && typeof exp === 'object') {
    for (const v of Object.values(exp)) {
      if (typeof v === 'string') {
        entries.add(v);
      } else if (v && typeof v === 'object') {
        for (const inner of Object.values(v)) {
          if (typeof inner === 'string') {
            entries.add(inner);
          }
        }
      }
    }
  }
  return [...entries];
};

for (const pkg of PACKAGES) {
  const pkgJsonPaths = [
    ...globSync(`node_modules/${pkg}/package.json`),
    ...globSync(`node_modules/.pnpm/*/node_modules/${pkg}/package.json`),
  ];
  if (pkgJsonPaths.length === 0) {
    continue;
  }

  for (const pkgJsonPath of pkgJsonPaths) {
    const pkgDir = dirname(pkgJsonPath);
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    if (pkgJson.name !== pkg) {
      continue;
    }

    for (const entry of entryPathsFromPkg(pkgJson)) {
      const target = join(pkgDir, entry);
      if (existsSync(target) && target.endsWith('.js')) {
        writeFileSync(target, '');
        console.log(`  trimmed ${target}`);
      }
    }
  }
}
