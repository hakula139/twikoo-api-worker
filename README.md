# twikoo-api-worker

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
# Copy database_id from the output into wrangler.toml.
pnpm wrangler d1 execute twikoo --remote --file=./schema.sql
pnpm wrangler r2 bucket create twikoo
# Set custom R2 public URL via Cloudflare dashboard, then update R2_PUBLIC_URL in wrangler.toml.
```

Secrets (set as needed):

```bash
pnpm wrangler secret put AKISMET_KEY
pnpm wrangler secret put TURNSTILE_SECRET
pnpm wrangler secret put SENDER_EMAIL
pnpm wrangler secret put SMTP_USER
pnpm wrangler secret put SMTP_PASS
```

For local dev secrets, create `.dev.vars` (gitignored) with `KEY=value` per line.

## Development

```bash
pnpm dev                     # wrangler dev on port 8787
pnpm check                   # type-check
pnpm format                  # prettier --check .
pnpm lint                    # markdownlint *.md
pnpm spellcheck              # cspell
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

In [`twikoo-js`](https://github.com/twikoojs/twikoo) (or via [IgnIt](https://github.com/hakula139/IgnIt)'s comments partial):

```js
twikoo.init({
  envId: 'https://twikoo-api.hakula.xyz',
  el: '#tcomment',
});
```

## License

MIT — see [LICENSE](LICENSE). Originally inspired by [`twikoojs/twikoo-cloudflare`](https://github.com/twikoojs/twikoo-cloudflare) (MIT). Business logic comes from upstream [`twikoo-func`](https://github.com/twikoojs/twikoo) (MIT).
