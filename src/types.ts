import type { ExecutionContext } from '@cloudflare/workers-types';

import type { DB } from './db';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  R2_PUBLIC_URL: string;

  // Secrets — set via `wrangler secret put`. Optional in TS so the smoke-test
  // path runs without them; handlers that need a secret must validate.
  AKISMET_KEY?: string;
  SENDER_EMAIL?: string;
  SMTP_PASS?: string;
  SMTP_USER?: string;
  TURNSTILE_SECRET?: string;
}

// Twikoo's config table holds a single row whose `value` column is a
// JSON-stringified blob. Declared fields are the ones we read directly;
// twikoo-func may set additional ones, so the index signature stays open.
export interface TwikooConfig {
  ADMIN_PASS?: string;
  BLOGGER_EMAIL?: string;
  COMMENT_PAGE_SIZE?: string;
  CORS_ALLOW_ORIGIN?: string;
  GRAVATAR_CDN?: string;
  LIMIT_PER_MINUTE?: string;
  LIMIT_PER_MINUTE_ALL?: string;
  SHOW_REGION?: string | boolean;
  TOP_DISABLED?: boolean;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  [key: string]: unknown;
}

// Per-request context, computed once in `worker.ts` and threaded through every
// handler. Keeps handlers pure — no global state, no cross-request leakage.
export interface RequestCtx {
  env: Env;
  request: Request;
  waitUntil: ExecutionContext['waitUntil'];
  ip: string;
  region: string;
  origin: string | null;
  uid: string;
  config: TwikooConfig;
  db: DB;
}

// Twikoo's wire-protocol envelope. Some events emit ad-hoc top-level fields
// (`count`, `more`, `time`, `log`, `id`), so the index signature stays open.
export interface TwikooResponse {
  code: number;
  message?: string;
  data?: unknown;
  version?: string;
  accessToken?: string;
  [key: string]: unknown;
}

// Handler signature. The dispatcher parses the request body, builds the ctx,
// and invokes the handler. Returning `{}` is treated as success (code 0).
export type Handler = (
  payload: Record<string, unknown>,
  ctx: RequestCtx,
) => Promise<Partial<TwikooResponse>>;
