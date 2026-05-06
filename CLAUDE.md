# CLAUDE.md — twikoo-api-worker

## Project Overview

twikoo-api-worker is a Cloudflare Workers backend for the [Twikoo](https://twikoo.js.org/en/intro.html) comment system, deployed to <https://twikoo.hakula.xyz>. It replaces the previous Vercel + MongoDB deployment ([hakula139/twikoo-vercel-api](https://github.com/hakula139/twikoo-vercel-api)) — which still serves the legacy `twikoo-api.hakula.xyz` URL during cutover — with Cloudflare D1 (SQLite) for comments and Cloudflare R2 for image uploads.

The worker is a thin TypeScript dispatcher that delegates business logic to the upstream `twikoo-func` npm package, with V8-isolate-compatible shims for parts of `twikoo-func` that assume Node.js (mail via HTTP providers instead of SMTP, `xss` instead of `DOMPurify` + `jsdom`, etc.).

A long-term roadmap to drop Twikoo entirely and ship a custom comment system lives in `.claude/plans/comment-system-roadmap.md` (gitignored, local planning only).

### Repo Layout

```text
.
├── .github/
│   ├── actions/setup-nix/      # Composite action: install Nix + Cachix
│   └── workflows/
│       ├── ci.yml              # PR validation: flake check + type/format/lint/spell
│       └── deploy.yml          # Push-to-main → wrangler deploy
├── scripts/
│   └── bundle-trim.mjs         # postinstall: empty out Node-only modules to fit 1 MiB bundle
├── src/
│   ├── worker.ts               # fetch entry: CORS, routing, event dispatch
│   └── types.ts                # Env interface + shared types
├── flake.nix                   # Nix dev shell + git-hooks-nix pre-commit
├── schema.sql                  # D1 schema (comment, config, counter)
├── wrangler.toml               # Worker config (D1 + R2 bindings, custom domain)
├── package.json
├── tsconfig.json
├── cspell.json
└── .cspell/words.txt
```

## Stack

- **Runtime**: Cloudflare Workers (V8 isolate) with `nodejs_compat` flag.
- **Storage**: Cloudflare D1 (SQLite) for `comment` / `config` / `counter` tables; Cloudflare R2 for uploaded images.
- **Mail**: HTTP-based providers only (SendGrid / MailChannels / Resend). No SMTP — `nodemailer` is null'd at bundle time.
- **Sanitization**: [`xss`](https://www.npmjs.com/package/xss) (replaces `DOMPurify` + `jsdom`).
- **Spam**: Akismet HTTP API + frequency limiter; Cloudflare Turnstile for captcha.
- **Captcha**: Cloudflare Turnstile siteverify.

## Build & Deploy

### Dev shell (Nix)

```bash
nix develop                  # interactive shell (auto-installs hooks)
nix flake check              # Nix-side hooks (Node-side run in CI's `check` job)
```

`direnv allow` auto-activates the dev shell on directory entry.

### Local development

```bash
pnpm install                 # also runs scripts/bundle-trim.mjs
pnpm dev                     # wrangler dev on port 8787 (config in wrangler.toml)
pnpm check                   # tsc --noEmit
```

For local secrets, create `.dev.vars` (gitignored) with one `KEY=value` per line.

### Manual deploy

```bash
pnpm wrangler login          # one-time OAuth
pnpm wrangler d1 create twikoo                                    # capture database_id → wrangler.toml
pnpm wrangler r2 bucket create twikoo
pnpm wrangler d1 execute twikoo --remote --file=./schema.sql
pnpm wrangler secret put SMTP_PASS                                # repeat per secret
pnpm deploy
```

### CI deploy

Pushes to `main` trigger `.github/workflows/deploy.yml`. Required repo secrets:

- `CLOUDFLARE_API_TOKEN` — scoped to: Account → Workers Scripts: Edit; Zone (`hakula.xyz`) → Workers Routes: Edit.
- `CLOUDFLARE_ACCOUNT_ID`.

## Coding Conventions

### TypeScript

- Worker entry exports a default object satisfying `ExportedHandler<Env>` (b2-worker pattern).
- `Env` is hand-written in `src/types.ts`. Optional secrets (`?`) so the smoke-test path runs without them; handlers that need a secret must validate.
- File naming: kebab-case (`mail.ts`, not `mailService.ts`).
- Imports: type imports first, then value imports, grouped by source.
- Sparse comments — only when _why_ is non-obvious (hidden constraint, V8 quirk, upstream contract).

### Local-only paths

Never reference gitignored paths (`.claude/`, `.dev.vars`, `.env*`, etc.) from anything that gets committed: source files, code comments, commit messages, PR descriptions, README, or other docs. They don't exist for other contributors or CI, and the references rot. This file (`CLAUDE.md`) is the exception — it documents local planning state for the assistant.

### Bundle constraints

The Workers free tier caps bundles at 1 MiB. `scripts/bundle-trim.mjs` empties out three Node-only packages that `twikoo-func` pulls in (`jsdom`, `tencentcloud-sdk-nodejs`, `nodemailer`) so esbuild can tree-shake them. Touch this script if `twikoo-func` adds new Node-only deps.

### Secrets discipline

The repo is **public**. Anything sensitive goes through `wrangler secret put` — never into `wrangler.toml` or source. Local development uses `.dev.vars` (gitignored).

D1 database IDs are committed: they're not secrets on their own, but they identify your account's resources. Treat as operational config.

### Git Conventions

- Commit messages: `type(scope): description`
  - Types: `feat`, `fix`, `refactor`, `docs`, `test`, `ci`, `chore`, `style`, `perf`.
  - Scope: most specific area changed (e.g., `worker`, `db`, `mail`, `ci`, `flake`).
- One logical change per commit.
- Branches: `<type>/<short-name>`.
- PRs: assign to `hakula139`, label `enhancement` for `feat`.

### Pre-commit hooks

Driven by [git-hooks-nix](https://github.com/cachix/git-hooks.nix), wired in `flake.nix`. Entering the dev shell installs `.git/hooks/pre-commit` automatically. Hooks: Prettier (TS / JS / JSON / TOML / YAML), markdownlint, cspell, nixfmt / statix / deadnix, basic file hygiene. Node-side hooks no-op when `node_modules/` is absent (Nix sandbox); CI's `check` job runs the equivalent commands directly via `pnpm`.

### Spell checking

- Config in `cspell.json`. Add project-specific words to `.cspell/words.txt` (one word per line, sorted alphabetically).

## Upstream relationship

The original Cloudflare port lives at [twikoojs/twikoo-cloudflare](https://github.com/twikoojs/twikoo-cloudflare) (MIT). This repo is a from-scratch TypeScript rewrite that consults the upstream as a reference implementation but does not share code. Business logic comes from the `twikoo-func` npm package.
