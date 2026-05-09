import type { Env, TwikooConfig } from '@/types';

import { describe, expect, it } from 'vitest';

import { ResponseCode, TwikooError } from '@/lib/errors';
import { configWithSecrets, requireSecret, secret } from '@/lib/secret';
import { buildCtx } from '@tests/helpers/ctx';

const ctxOf = (env: Partial<Env>, config: TwikooConfig) => buildCtx({ env: env as Env, config });

describe('secret', () => {
  it('returns the wrangler env value when both env and admin config are set (env wins)', () => {
    const ctx = ctxOf(
      { TURNSTILE_SECRET_KEY: 'env-secret' },
      { TURNSTILE_SECRET_KEY: 'config-secret' },
    );
    expect(secret(ctx, 'TURNSTILE_SECRET_KEY')).toBe('env-secret');
  });

  it('falls back to admin config when env is unset', () => {
    const ctx = ctxOf({}, { AKISMET_KEY: 'config-key' });
    expect(secret(ctx, 'AKISMET_KEY')).toBe('config-key');
  });

  it('falls back to admin config when env is empty string', () => {
    const ctx = ctxOf({ AKISMET_KEY: '' }, { AKISMET_KEY: 'config-key' });
    expect(secret(ctx, 'AKISMET_KEY')).toBe('config-key');
  });

  it('returns undefined when neither env nor config has the key', () => {
    const ctx = ctxOf({}, {});
    expect(secret(ctx, 'SMTP_PASS')).toBeUndefined();
  });

  it('returns undefined when the config value is non-string', () => {
    const ctx = ctxOf({}, { SMTP_PASS: 42 as unknown as string });
    expect(secret(ctx, 'SMTP_PASS')).toBeUndefined();
  });
});

describe('requireSecret', () => {
  it('returns the secret when set', () => {
    const ctx = ctxOf({ TURNSTILE_SECRET_KEY: 'sk' }, {});
    expect(requireSecret(ctx, 'TURNSTILE_SECRET_KEY')).toBe('sk');
  });

  it('throws TwikooError(CONFIG_NOT_EXIST) by default when missing', () => {
    const ctx = ctxOf({}, {});
    try {
      requireSecret(ctx, 'TURNSTILE_SECRET_KEY');
      throw new Error('expected requireSecret to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.CONFIG_NOT_EXIST);
    }
  });

  it('lets callers override the error code', () => {
    const ctx = ctxOf({}, {});
    try {
      requireSecret(ctx, 'AKISMET_KEY', ResponseCode.AKISMET_ERROR);
      throw new Error('expected requireSecret to throw');
    } catch (e) {
      expect((e as TwikooError).code).toBe(ResponseCode.AKISMET_ERROR);
    }
  });
});

describe('configWithSecrets', () => {
  it('overlays env-bound secrets onto admin config', () => {
    const ctx = ctxOf(
      { SMTP_PASS: 'env-pass', SMTP_USER: 'env-user' },
      { SMTP_PASS: 'config-pass', BLOGGER_EMAIL: 'a@b.c' },
    );
    const merged = configWithSecrets(ctx);
    expect(merged.SMTP_PASS).toBe('env-pass');
    expect(merged.SMTP_USER).toBe('env-user');
    expect(merged.BLOGGER_EMAIL).toBe('a@b.c');
  });

  it('preserves admin config values for keys not present in env', () => {
    const ctx = ctxOf({}, { SMTP_PASS: 'config-pass', AKISMET_KEY: 'config-akismet' });
    const merged = configWithSecrets(ctx);
    expect(merged.SMTP_PASS).toBe('config-pass');
    expect(merged.AKISMET_KEY).toBe('config-akismet');
  });

  it('returns a new object — does not mutate ctx.config', () => {
    const config: TwikooConfig = { SMTP_PASS: 'config-pass' };
    const ctx = ctxOf({ SMTP_PASS: 'env-pass' }, config);
    const merged = configWithSecrets(ctx);
    expect(merged).not.toBe(config);
    expect(config.SMTP_PASS).toBe('config-pass');
  });
});
