export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  R2_PUBLIC_URL: string;

  // Secrets — set via `wrangler secret put`. Optional in TS so the smoke-test
  // path runs without them; handlers that need a secret should validate.
  AKISMET_KEY?: string;
  TURNSTILE_SECRET?: string;
  SENDER_EMAIL?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
}
