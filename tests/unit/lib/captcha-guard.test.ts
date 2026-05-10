import type { EventPayloads, RequestCtx } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { enforceTurnstile } from '@/lib/captcha-guard';
import { ResponseCode, TwikooError } from '@/lib/errors';
import { logger } from '@/twikoo';
import { buildCtx } from '@tests/helpers/ctx';

const okSiteverify = (success: boolean, errorCodes?: string[]): Response =>
  new Response(JSON.stringify({ 'success': success, 'error-codes': errorCodes ?? [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const submitPayload = (
  overrides: Partial<EventPayloads['COMMENT_SUBMIT']> = {},
): EventPayloads['COMMENT_SUBMIT'] => ({
  url: '/post',
  ua: 'Mozilla',
  comment: 'hi',
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enforceTurnstile', () => {
  it('skips siteverify when CAPTCHA_PROVIDER is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ctx = buildCtx({ config: {} });

    await enforceTurnstile(submitPayload(), ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('warns and allows through when CAPTCHA_PROVIDER is an unrecognized value', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const ctx = buildCtx({ config: { CAPTCHA_PROVIDER: 'hCaptcha' } });

    await enforceTurnstile(submitPayload(), ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('hCaptcha');
  });

  it('throws FAIL when CAPTCHA_PROVIDER=Turnstile but no secret is configured', async () => {
    const ctx = buildCtx({ config: { CAPTCHA_PROVIDER: 'Turnstile' } });

    try {
      await enforceTurnstile(submitPayload({ turnstileToken: 'tk' }), ctx);
      throw new Error('expected enforceTurnstile to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.FAIL);
    }
  });

  it('throws CREDENTIALS_INVALID when the token is missing', async () => {
    const ctx = buildCtx({
      config: { CAPTCHA_PROVIDER: 'Turnstile' },
      env: { TURNSTILE_SECRET_KEY: 'sk-test' } as RequestCtx['env'],
    });

    try {
      await enforceTurnstile(submitPayload(), ctx);
      throw new Error('expected enforceTurnstile to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.CREDENTIALS_INVALID);
    }
  });

  it('proceeds when only the wrangler secret is set (TURNSTILE_SITE_KEY blank)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okSiteverify(true));
    const ctx = buildCtx({
      config: { CAPTCHA_PROVIDER: 'Turnstile' },
      env: { TURNSTILE_SECRET_KEY: 'sk-test' } as RequestCtx['env'],
    });

    await enforceTurnstile(submitPayload({ turnstileToken: 'tk' }), ctx);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws CREDENTIALS_INVALID with siteverify error codes when verification fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okSiteverify(false, ['timeout-or-duplicate']));
    const ctx = buildCtx({
      config: { CAPTCHA_PROVIDER: 'Turnstile' },
      env: { TURNSTILE_SECRET_KEY: 'sk-test' } as RequestCtx['env'],
    });

    try {
      await enforceTurnstile(submitPayload({ turnstileToken: 'tk' }), ctx);
      throw new Error('expected enforceTurnstile to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.CREDENTIALS_INVALID);
      expect((e as TwikooError).message).toContain('timeout-or-duplicate');
    }
  });

  it('also accepts a config-only secret (admin pasted it into ADMIN_PASS UI, no env)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okSiteverify(true));
    const ctx = buildCtx({
      config: { CAPTCHA_PROVIDER: 'Turnstile', TURNSTILE_SECRET_KEY: 'sk-from-config' },
    });

    await enforceTurnstile(submitPayload({ turnstileToken: 'tk' }), ctx);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.body as URLSearchParams).get('secret')).toBe('sk-from-config');
  });
});
