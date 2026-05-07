import type { ExecutionContext } from '@cloudflare/workers-types';

import type { DB } from './db';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  R2_PUBLIC_URL: string;

  // Secrets are optional so the smoke-test path runs without them; consumers must validate.
  AKISMET_KEY?: string;
  QQ_API_KEY?: string;
  SENDER_EMAIL?: string;
  SMTP_PASS?: string;
  SMTP_USER?: string;
  TURNSTILE_SECRET?: string;
}

// Single-row blob in the `config` table. Open index signature: twikoo-func may set extras.
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

// Open index signature: events emit ad-hoc top-level fields (count, more, time, log, id).
export interface TwikooResponse {
  code: number;
  message?: string;
  data?: unknown;
  version?: string;
  accessToken?: string;
  [key: string]: unknown;
}

// Returning `{}` is treated as SUCCESS.
export type Handler = (
  payload: Record<string, unknown>,
  ctx: RequestCtx,
) => Promise<Partial<TwikooResponse>>;
