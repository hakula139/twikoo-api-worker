# AGENTS.md: twikoo-api-worker

Read [README.md](README.md) for setup, verification, provisioning, and deployment.

## Worker contracts

- The Worker entry exports a default object satisfying `ExportedHandler<Env>`.
- `Env` is hand-written in `src/types.ts`. Secrets are optional so local smoke tests work without them. Handlers that need a secret must validate it.
- Preserve the upstream [`twikoo-func`](https://www.npmjs.com/package/twikoo-func) contracts and V8-compatible shims. HTTP mail providers replace SMTP, `xss` replaces DOM sanitizers, and Telegram uses native `fetch`.
- The Workers Free plan limits gzip bundles to 3 MiB. Wrangler aliases unused Node-only dependencies to `src/shims/empty.ts` so esbuild does not traverse them.
- Use local D1 and R2 bindings for tests. Remote operations require explicit authorization.

## Code conventions

- Use kebab-case filenames and put type imports before value imports, grouped by source.
- Use `// ── Section Name ──` for TypeScript section dividers, without padding to a fixed column.
- Keep project spelling additions alphabetically sorted in `.cspell/words.txt`.

## Schema and secrets

- `src/db/schema.ts` is the schema source of truth. `pnpm db:push` applies its delta to live D1 without committed migration files, so schema changes need separate authorization before application.
- Use the raw `sql` template only for queries the builder cannot express. Interpolate schema columns so identifiers stay schema-aware.
- Store secrets through `wrangler secret put` or local gitignored `.dev.vars`. D1 database IDs are public operational configuration.

## Upstream boundary

This is a from-scratch TypeScript implementation using `twikoo-func` for business logic. [twikoojs/twikoo-cloudflare](https://github.com/twikoojs/twikoo-cloudflare) (MIT) is a reference implementation without shared code.
