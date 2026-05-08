# twikoo-api-worker

[![CI](https://github.com/hakula139/twikoo-api-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/hakula139/twikoo-api-worker/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/hakula139/twikoo-api-worker/graph/badge.svg)](https://codecov.io/gh/hakula139/twikoo-api-worker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Cloudflare Workers backend for the [Twikoo](https://twikoo.js.org/en/intro.html) comment system, backed by Cloudflare D1 and R2. Replaces a Vercel + MongoDB deployment with a single low-latency Worker.

This is a from-scratch TypeScript implementation that depends on the upstream [`twikoo-func`](https://www.npmjs.com/package/twikoo-func) npm package for business logic. It consults [`twikoojs/twikoo-cloudflare`](https://github.com/twikoojs/twikoo-cloudflare) (MIT) as a reference implementation.

## Features

- **D1 + R2 storage**: SQLite-based comment store with R2 for image uploads — no external database.
- **HTTP mail providers**: SendGrid, MailChannels, Resend (no SMTP, no `nodemailer`).
- **Cloudflare-native**: Smart Placement, observability logs, custom domain via `routes`.
- **Public repo, private secrets**: secrets via `wrangler secret put`, never committed.

## Setup

[Nix](https://nixos.org/download/) (with flakes) is the recommended path:

```bash
git clone https://github.com/hakula139/twikoo-api-worker.git
cd twikoo-api-worker
nix develop                  # auto-installs pre-commit hooks
pnpm install
```

Without Nix, install Node.js 24 and pnpm yourself.

## One-time provisioning

```bash
pnpm wrangler login
pnpm wrangler d1 create twikoo
pnpm wrangler r2 bucket create twikoo
pnpm db:push
```

After `wrangler d1 create twikoo`, copy the printed `database_id` into [`wrangler.toml`](wrangler.toml) and [`drizzle.config.ts`](drizzle.config.ts). After `wrangler r2 bucket create twikoo`, set the custom R2 public URL in the Cloudflare dashboard and update `R2_PUBLIC_URL` in `wrangler.toml`.

`pnpm db:push` syncs [`src/db/schema.ts`](src/db/schema.ts) to remote D1 (needs `CLOUDFLARE_D1_TOKEN`), diffing against the live database and applying the delta directly — no migration files in the repo.

Secrets (set as needed):

```bash
pnpm wrangler secret put AKISMET_KEY
pnpm wrangler secret put QQ_API_KEY
pnpm wrangler secret put SENDER_EMAIL
pnpm wrangler secret put SMTP_PASS
pnpm wrangler secret put SMTP_USER
pnpm wrangler secret put TURNSTILE_SECRET
```

`QQ_API_KEY` is optional — it unlocks the v1.nsuuu.com nickname lookup used by `GET_QQ_NICK` (free path is rate-limited / key-gated; obtain one at <https://api.nsuuu.com>). The handler also falls back to the same key set in admin config (`QQ_API_KEY` field), so either path works — the secret takes precedence.

For local dev secrets, create `.dev.vars` (gitignored) with `KEY=value` per line.

## Development

```bash
pnpm dev                     # wrangler dev on port 8787
pnpm check                   # type-check
pnpm test                    # vitest run (workerd via @cloudflare/vitest-pool-workers)
pnpm format                  # prettier --check .
pnpm lint                    # markdownlint + eslint
pnpm spellcheck              # cspell
pnpm db:push                 # sync schema.ts changes to remote D1
```

## Deployment

Pushes to `main` auto-deploy via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Required repository secrets:

- `CLOUDFLARE_API_TOKEN` — Account → Workers Scripts: Edit; Zone (`hakula.xyz`) → Workers Routes: Edit.
- `CLOUDFLARE_ACCOUNT_ID`.

Manual deploy:

```bash
pnpm deploy
```

## Frontend integration

In [`twikoo-js`](https://github.com/twikoojs/twikoo):

```js
twikoo.init({
  envId: 'https://twikoo.hakula.xyz',
  el: '#tcomment',
});
```

## License

Copyright (c) 2026 [Hakula](https://hakula.xyz). Licensed under the [MIT License](LICENSE).
