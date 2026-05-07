import type { RequestCtx, TwikooConfig } from '../types';

// (env binding → admin-config field) for every integration secret. Wrangler
// secret takes precedence; admin-config field is the fallback. Captcha is the
// only mismatch — env follows the wrangler convention, config matches the
// admin UI key (read by upstream too).
const SECRET_PAIRS = {
  AKISMET_KEY: 'AKISMET_KEY',
  QQ_API_KEY: 'QQ_API_KEY',
  SENDER_EMAIL: 'SENDER_EMAIL',
  SMTP_PASS: 'SMTP_PASS',
  SMTP_USER: 'SMTP_USER',
  TURNSTILE_SECRET: 'TURNSTILE_SECRET_KEY',
} as const satisfies Record<string, string>;

type SecretEnvKey = keyof typeof SECRET_PAIRS;

export const secret = (ctx: RequestCtx, key: SecretEnvKey): string | undefined => {
  const fromEnv = ctx.env[key];
  if (fromEnv) {
    return fromEnv;
  }
  return ctx.config[SECRET_PAIRS[key]] as string | undefined;
};

// Returns a config snapshot with env values shadowing the corresponding admin-
// config keys. Use when handing config to upstream code (twikoo-func/utils/notify,
// /spam) that reads keys directly — handlers can't intercept those reads.
export const configWithSecrets = (ctx: RequestCtx): TwikooConfig => {
  const merged: TwikooConfig = { ...ctx.config };
  for (const [envKey, configKey] of Object.entries(SECRET_PAIRS) as Array<[SecretEnvKey, string]>) {
    const fromEnv = ctx.env[envKey];
    if (fromEnv) {
      merged[configKey] = fromEnv;
    }
  }
  return merged;
};
