import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyTurnstile } from '../../../src/lib/turnstile';

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyTurnstile', () => {
  it('POSTs secret/response/remoteip to siteverify and returns success on 200 ok', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ success: true }));

    const result = await verifyTurnstile({ secret: 'sk', token: 'tk', ip: '1.2.3.4' });

    expect(result).toEqual({ success: true, errorCodes: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');

    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('sk');
    expect(body.get('response')).toBe('tk');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });

  it('omits remoteip when ip is not provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ success: true }));

    await verifyTurnstile({ secret: 'sk', token: 'tk' });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.has('remoteip')).toBe(false);
  });

  it('reports error codes when siteverify reports failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({ 'success': false, 'error-codes': ['invalid-input-response'] }),
    );

    const result = await verifyTurnstile({ secret: 'sk', token: 'tk' });
    expect(result).toEqual({ success: false, errorCodes: ['invalid-input-response'] });
  });

  it('returns http-<status> when siteverify responds non-OK', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));

    const result = await verifyTurnstile({ secret: 'sk', token: 'tk' });
    expect(result).toEqual({ success: false, errorCodes: ['http-503'] });
  });
});
