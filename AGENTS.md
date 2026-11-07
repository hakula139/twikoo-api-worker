# AGENTS.md — twikoo-api-worker

## Project Overview

twikoo-api-worker is a Cloudflare Workers backend for the [Twikoo](https://twikoo.js.org/en/intro.html) comment system, deployed to <https://twikoo.hakula.xyz>. It replaces the previous Vercel + MongoDB deployment ([hakula139/twikoo-vercel-api](https://github.com/hakula139/twikoo-vercel-api)), which still serves the legacy `twikoo-api.hakula.xyz` URL during cutover, using Cloudflare D1 (SQLite) for comments and Cloudflare R2 for image uploads.

The worker is a thin TypeScript dispatcher that delegates business logic to the upstream `twikoo-func` npm package, using V8-isolate-compatible shims where `twikoo-func` assumes Node.js (such as mail via HTTP providers instead of SMTP and `xss` instead of `DOMPurify` + `jsdom`).

### Repo Layout

```text
.
├── .github/
│   └── workflows/
│       ├── ci.yml           # PR validation: flake check + type/format/lint/spell/test + Codecov upload
│       └── deploy.yml       # Push-to-main → wrangler deploy
├── src/
│   ├── db/                  # Drizzle schema + per-table query classes
│   ├── handlers/            # one file per Twikoo event group + registry
│   ├── lib/                 # cross-cutting utilities (auth, errors, geo, http)
│   ├── worker.ts            # fetch entry: CORS, routing, event dispatch
│   ├── dispatch.ts          # body parsing, ctx assembly, handler invocation
│   ├── twikoo.ts            # twikoo-func wiring + V8-compatible shims
│   └── types.ts             # Env interface + shared types
├── tests/
│   ├── integration/         # request-to-D1 flows running inside workerd
│   └── unit/                # focused vitest suites running inside workerd
├── drizzle.config.ts        # drizzle-kit config (d1-http driver)
├── flake.nix                # Nix dev shell + git-hooks-nix pre-commit
├── wrangler.toml            # Worker config (D1 + R2 bindings, custom domain)
├── codecov.yml              # Codecov status thresholds
├── vitest.config.ts         # cloudflareTest plugin + istanbul coverage
├── package.json
├── tsconfig.json
├── cspell.json
└── .cspell/words.txt
```

## Stack

- **Runtime**: Cloudflare Workers (V8 isolate) with `nodejs_compat` and `enable_nodejs_http2_module` flags.
- **Storage**: Cloudflare D1 (SQLite) for the `comment`, `config`, and `counter` tables, accessed via Drizzle ORM (`drizzle-orm/d1`), and Cloudflare R2 for uploaded images.
- **Mail**: HTTP-based providers only (SendGrid / MailChannels / Resend). SMTP is unavailable because Wrangler aliases `nodemailer` to an empty Worker module.
- **Instant push**: Telegram Bot API via native `fetch`, while skipping other upstream Pushoo channels.
- **Sanitization**: [`xss`](https://www.npmjs.com/package/xss) (replaces `DOMPurify` + `jsdom`).
- **Spam**: Akismet HTTP API + frequency limiter.
- **Captcha**: Cloudflare Turnstile siteverify.

## Build & Deploy

See the [README](README.md) for setup, provisioning, admin bootstrap, local development, and deployment. Enter the dev shell from this repository so its hook installs into the correct checkout.

## Coding Conventions

### Prose

- Avoid semicolons in prose. Use a period, or rewrite the sentence to make the relationship explicit.

### TypeScript

- Worker entry exports a default object satisfying `ExportedHandler<Env>` (b2-worker pattern).
- `Env` is hand-written in `src/types.ts`, with secrets marked optional (`?`) so the smoke-test path can run without them. Handlers that need a secret must validate it.
- File naming: kebab-case (`mail.ts`, not `mailService.ts`).
- Imports: type imports first, then value imports, grouped by source.
- Keep comments for non-obvious constraints, such as V8 quirks or upstream contracts.

### Section Dividers

- Use `// ── Section Name ──` for section dividers in code (box-drawing character `─`, U+2500). The trailing `──` is two characters, matching the leading divider. Do not pad to a fixed column.

### Schema

- `src/db/schema.ts` is the single source of truth. After any schema edit, `pnpm db:push` diffs against live D1 and applies the delta directly, leaving the Git history of `schema.ts` as the audit trail without committed `migrations/` files.
- Use the raw `sql` tagged template only when the query builder cannot express the query cleanly (e.g., admin search fanning `LIKE ?` across many text columns), and interpolate column references inside the tag via `${schema.table.column}` so identifiers stay schema-aware.

### Local-only paths

Never reference personal gitignored paths such as `.claude/` plans or local settings in source files, code comments, commit messages, PR descriptions, the README, or other committed artifacts. Repository-standard setup inputs such as `.dev.vars` may be documented where contributors need them.

### Bundle constraints

The Workers Free plan and CI both enforce a 3 MiB post-gzip bundle limit. To keep esbuild from traversing unused packages, Wrangler aliases `jsdom`, `nodemailer`, `pushoo`, and `tencentcloud-sdk-nodejs-tms` to `src/shims/empty.ts`. Add another alias if `twikoo-func` gains an unused dependency that cannot run in Workers.

### Secrets discipline

Because the repo is **public**, set all sensitive values through `wrangler secret put` and never commit them to `wrangler.toml` or source. Local development uses `.dev.vars` (gitignored).

D1 database IDs are committed as operational config: they are not secrets on their own, though they do identify your account's resources.

### Git Conventions

- Commit messages: `type(scope): description`
  - Types: `feat`, `fix`, `refactor`, `docs`, `test`, `ci`, `chore`, `style`, `perf`.
  - Scope: most specific area changed (e.g., `worker`, `db`, `mail`, `ci`, `flake`).
- One logical change per commit.
- Branches: `<type>/<short-name>`.
- PRs: assign to `hakula139`, and label `feat` PRs with `enhancement` and dependency updates with `dependencies`.

### Pre-commit hooks

Pre-commit hooks use the shared [devkit](https://github.com/hakula139/devkit) baseline, configured in `flake.nix`. Entering the dev shell installs its hooks automatically. The hooks run Prettier for TypeScript, JavaScript, JSON, and YAML, Taplo for TOML, and the shared Markdown, spelling, Nix, and file hygiene checks. The ESLint development hook runs through the locked pnpm tool and is excluded from the Nix sandbox. CI's `check` job also runs the project checks directly via `pnpm`.

### Spell checking

- Configured in `cspell.json`. Add project-specific words to `.cspell/words.txt` (one word per line, sorted alphabetically).

## Verification

Run after implementation and before review:

```bash
prek run --all-files          # formatting, Markdown, spelling, Nix and file checks
pnpm check                   # tsc --noEmit
pnpm test                    # vitest run inside workerd
pnpm lint                    # eslint
nix flake check              # Nix-side hooks. Optional locally because CI runs the same check separately.
```

Use `pnpm dev` to smoke-test runtime behavior. Wrangler uses local D1 and R2 bindings by default and requires explicit opt-in per binding for remote access. Verify bundle size with `pnpm wrangler deploy --dry-run`.

## Code Review

After verification passes, run parallel reviews with a `reviewer` subagent and an independent second reviewer, adding lens-specific subagents from `pr-review-toolkit` (`code-reviewer`, `comment-analyzer`, `silent-failure-hunter`, `type-design-analyzer`) when the change touches their domain. The `/pr-review-toolkit:review-pr` slash command orchestrates the toolkit fan-out. Focus on:

- Correctness and edge cases, especially CORS, request body shape, and D1 binding boundaries.
- Adherence to project conventions (this file).
- Conciseness, favoring the simplest idiomatic solution.
- DRY, looking for duplicate logic across handlers and DB classes that can be extracted.
- Cross-file consistency across parallel handlers and DB methods in structure, naming, ordering, and error handling.
- Comment hygiene, trimming verbose blocks while documenting the reasons for non-obvious constraints (V8 quirks, upstream `twikoo-func` contracts, module-alias assumptions).
- Visibility, keeping helpers module-private and exporting only what consumers need.
- Idiomatic TypeScript, preferring discriminated unions, `readonly`, exhaustive `switch`, narrow types over `any` or `unknown` casts, and async / await over raw Promises.
- Existing packages, avoiding hand-written logic that `twikoo-func`, `xss`, or a Cloudflare-native API already provides.
- Bundle impact, verifying that new dependencies stay under the 3 MiB gzip limit after Wrangler applies module aliases and flagging unreachable Node-only packages that need an alias.
- Secrets, ensuring new sensitive config goes through `wrangler secret put` and never into `wrangler.toml` or source.

## Upstream relationship

This repo is a from-scratch TypeScript rewrite that uses the `twikoo-func` npm package for business logic and consults the original Cloudflare port at [twikoojs/twikoo-cloudflare](https://github.com/twikoojs/twikoo-cloudflare) (MIT) as a reference implementation without sharing code.
