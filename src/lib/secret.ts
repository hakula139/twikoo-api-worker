import type { RequestCtx, TwikooConfig } from '@/types';

import { stringConfig } from './config-read';
import { ResponseCode, type ResponseCodeValue, TwikooError } from './errors';

// Env binding name == admin-config field name. Wrangler secret wins.
const SECRET_PAIRS = {
  AKISMET_KEY: 'AKISMET_KEY',
  QQ_API_KEY: 'QQ_API_KEY',
  SENDER_EMAIL: 'SENDER_EMAIL',
  SMTP_PASS: 'SMTP_PASS',
  SMTP_USER: 'SMTP_USER',
  TURNSTILE_SECRET_KEY: 'TURNSTILE_SECRET_KEY',
} as const satisfies Record<string, string>;

type SecretEnvKey = keyof typeof SECRET_PAIRS;

export const secret = (ctx: RequestCtx, key: SecretEnvKey): string | undefined => {
  const fromEnv = ctx.env[key];
  if (fromEnv) {
    return fromEnv;
  }
  return stringConfig(ctx.config, SECRET_PAIRS[key]);
};

// Throwing variant for sites where the secret is mandatory; saves callers a
// truthiness check and a hand-written error message.
export const requireSecret = (
  ctx: RequestCtx,
  key: SecretEnvKey,
  errorCode: ResponseCodeValue = ResponseCode.CONFIG_NOT_EXIST,
): string => {
  const value = secret(ctx, key);
  if (!value) {
    throw new TwikooError(errorCode, `${key} is not configured.`);
  }
  return value;
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
