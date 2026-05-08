import type { Env, RequestCtx, TwikooConfig } from '../../../src/types';

import { describe, expect, it } from 'vitest';

import { configWithSecrets, secret } from '../../../src/lib/secret';

const buildCtx = (env: Partial<Env>, config: TwikooConfig): RequestCtx =>
  ({ env, config }) as unknown as RequestCtx;

describe('secret', () => {
  it('returns the wrangler env value when both env and admin config are set (env wins)', () => {
    const ctx = buildCtx(
      { TURNSTILE_SECRET_KEY: 'env-secret' },
      { TURNSTILE_SECRET_KEY: 'config-secret' },
    );
    expect(secret(ctx, 'TURNSTILE_SECRET_KEY')).toBe('env-secret');
  });

  it('falls back to admin config when env is unset', () => {
    const ctx = buildCtx({}, { AKISMET_KEY: 'config-key' });
    expect(secret(ctx, 'AKISMET_KEY')).toBe('config-key');
  });

  it('falls back to admin config when env is empty string', () => {
    const ctx = buildCtx({ AKISMET_KEY: '' }, { AKISMET_KEY: 'config-key' });
    expect(secret(ctx, 'AKISMET_KEY')).toBe('config-key');
  });

  it('returns undefined when neither env nor config has the key', () => {
    const ctx = buildCtx({}, {});
    expect(secret(ctx, 'SMTP_PASS')).toBeUndefined();
  });

  it('returns undefined when the config value is non-string', () => {
    const ctx = buildCtx({}, { SMTP_PASS: 42 as unknown as string });
    expect(secret(ctx, 'SMTP_PASS')).toBeUndefined();
  });
});

describe('configWithSecrets', () => {
  it('overlays env-bound secrets onto admin config', () => {
    const ctx = buildCtx(
      { SMTP_PASS: 'env-pass', SMTP_USER: 'env-user' },
      { SMTP_PASS: 'config-pass', BLOGGER_EMAIL: 'a@b.c' },
    );
    const merged = configWithSecrets(ctx);
    expect(merged.SMTP_PASS).toBe('env-pass');
    expect(merged.SMTP_USER).toBe('env-user');
    expect(merged.BLOGGER_EMAIL).toBe('a@b.c');
  });

  it('preserves admin config values for keys not present in env', () => {
    const ctx = buildCtx({}, { SMTP_PASS: 'config-pass', AKISMET_KEY: 'config-akismet' });
    const merged = configWithSecrets(ctx);
    expect(merged.SMTP_PASS).toBe('config-pass');
    expect(merged.AKISMET_KEY).toBe('config-akismet');
  });

  it('returns a new object — does not mutate ctx.config', () => {
    const config: TwikooConfig = { SMTP_PASS: 'config-pass' };
    const ctx = buildCtx({ SMTP_PASS: 'env-pass' }, config);
    const merged = configWithSecrets(ctx);
    expect(merged).not.toBe(config);
    expect(config.SMTP_PASS).toBe('config-pass');
  });
});
