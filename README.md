# twikoo-api-worker

[![CI](https://github.com/hakula139/twikoo-api-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/hakula139/twikoo-api-worker/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/hakula139/twikoo-api-worker/graph/badge.svg)](https://codecov.io/gh/hakula139/twikoo-api-worker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Cloudflare Workers backend for the [Twikoo](https://twikoo.js.org/en/intro.html) comment system, backed by Cloudflare D1 and R2. It replaces a Vercel + MongoDB deployment with a single low-latency Worker.

This from-scratch TypeScript implementation uses the upstream [`twikoo-func`](https://www.npmjs.com/package/twikoo-func) npm package for business logic and draws on [`twikoojs/twikoo-cloudflare`](https://github.com/twikoojs/twikoo-cloudflare) (MIT) as a reference implementation.

## Features

- **D1 + R2 storage**: D1 stores comments in SQLite, and R2 stores uploaded images.
- **HTTP mail providers**: SendGrid, MailChannels, and Resend deliver mail over HTTP.
- **Telegram notifications**: native Bot API delivery without Node.js HTTP adapters.
- **Cloudflare-native**: Smart Placement, observability logs, and a custom domain via `routes`.
- **Public repo, private secrets**: secrets set via `wrangler secret put` are never committed.

## Setup

[Nix](https://nixos.org/download/) with flakes supplies Node.js, pnpm, Nushell, and the validation tools:

```bash
git clone https://github.com/hakula139/twikoo-api-worker.git
cd twikoo-api-worker
nix develop
pnpm install --frozen-lockfile
```

Enter the development shell from this repository. It installs the shared [devkit](https://github.com/hakula139/devkit) Git hooks.

## One-time provisioning

```bash
pnpm wrangler login
pnpm wrangler d1 create twikoo
pnpm wrangler r2 bucket create twikoo
```

After creating D1, copy the printed `database_id` into [`wrangler.toml`](wrangler.toml). Connect a public custom domain to the R2 bucket in the Cloudflare dashboard and set `R2_PUBLIC_URL` in `wrangler.toml`. After deployment, set `IMAGE_CDN` to `r2` in the Twikoo admin configuration so new uploads use this bucket, and keep all other settings unchanged if you are updating an existing deployment.

Then sync [`src/db/schema.ts`](src/db/schema.ts) to the remote D1 database. This requires `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` with D1 Edit permission, and it applies the schema delta directly without keeping migration files in the repository.

```bash
pnpm db:push
```

Set the following optional secrets as needed. Each value can also be set under the matching field name in the admin configuration UI, though a Wrangler secret takes precedence when both are set:

```bash
pnpm wrangler secret put AKISMET_KEY
pnpm wrangler secret put PUSHOO_TOKEN
pnpm wrangler secret put QQ_API_KEY
pnpm wrangler secret put SENDER_EMAIL
pnpm wrangler secret put SMTP_PASS
pnpm wrangler secret put SMTP_USER
pnpm wrangler secret put TURNSTILE_SECRET_KEY
```

For HTTP mail, set `SMTP_SERVICE` to `sendgrid`, `mailchannels`, or `resend` in the admin configuration. Set `SMTP_PASS` to the provider API key, `SMTP_USER` to any non-empty string, and `SENDER_EMAIL` to a sender address verified with the provider.

Telegram notifications also require `PUSHOO_CHANNEL=telegram` in the admin configuration, with `PUSHOO_TOKEN` formatted as `<bot-token>#<chat-id>`.

`SET_PASSWORD` requires an existing admin identity, so seed `ADMIN_PASS_HASH` with the md5 of your plaintext password before the first deployment:

```bash
nu -c '"my-plain-password" | hash md5'
pnpm wrangler secret put ADMIN_PASS_HASH   # paste the hex
```

After you rotate the password with `SET_PASSWORD`, the value stored in D1 takes precedence and `ADMIN_PASS_HASH` can be removed.

For local dev secrets, create `.dev.vars` (gitignored) with one `KEY=value` pair per line.

## Development

```bash
pnpm dev                     # wrangler dev on port 8787
run-hooks                    # formatting, lint, spelling, type-check, and file hygiene
pnpm test                    # vitest run (workerd via @cloudflare/vitest-plugin)
pnpm test:bundle             # Wrangler dry-run against the Workers Free plan's 3 MiB gzip limit
pnpm test:smoke              # temporary local D1 state and upstream function version
nix flake check              # flake output evaluation
```

## Deployment

Pushes to `main` auto-deploy via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Required repository secrets:

- `CLOUDFLARE_API_TOKEN` with both permissions:
  - Account → Workers Scripts: Edit
  - Zone (`hakula.xyz`) → Workers Routes: Edit
- `CLOUDFLARE_ACCOUNT_ID`.

Manual deploy:

```bash
pnpm run deploy
```

New uploads expire after one hour unless a stored comment references them. Pending and hidden comments preserve their images. Removing the last reference starts another one-hour grace period. Cleanup runs every 15 minutes and retries failed work. Existing unregistered images remain untouched. Submit drafts within one hour or upload their images again.

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
