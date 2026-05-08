import type { RequestCtx, TwikooConfig } from '../types';

// env binding → admin-config field. Wrangler secret wins over admin config.
// Turnstile is the lone naming mismatch (env vs upstream's admin UI key).
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
  const fromConfig = ctx.config[SECRET_PAIRS[key]];
  return typeof fromConfig === 'string' ? fromConfig : undefined;
};

// Hand to upstream code (notify, spam) that reads config keys directly — env
// values shadow admin-config keys.
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
