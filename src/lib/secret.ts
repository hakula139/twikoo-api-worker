import type { RequestCtx, TwikooConfig } from '@/types';

import { stringConfig } from './config-read';

const SECRET_KEYS = [
  'AKISMET_KEY',
  'PUSHOO_TOKEN',
  'QQ_API_KEY',
  'SENDER_EMAIL',
  'SMTP_PASS',
  'SMTP_USER',
  'TURNSTILE_SECRET_KEY',
] as const;

type SecretEnvKey = (typeof SECRET_KEYS)[number];

export const secret = (ctx: RequestCtx, key: SecretEnvKey): string | undefined => {
  const fromEnv = ctx.env[key];

  if (fromEnv) {
    return fromEnv;
  }

  return stringConfig(ctx.config, key);
};

export const configWithSecrets = (ctx: RequestCtx): TwikooConfig => {
  const merged: TwikooConfig = { ...ctx.config };
  for (const key of SECRET_KEYS) {
    const fromEnv = ctx.env[key];

    if (fromEnv) {
      merged[key] = fromEnv;
    }
  }

  return merged;
};
