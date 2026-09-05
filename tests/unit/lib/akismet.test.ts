import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAkismet } from '@/lib/akismet';

const baseOpts = {
  apiKey: 'test-api-key',
  blog: 'https://hakula.xyz',
  userIp: '192.0.2.1',
  userAgent: 'Mozilla/5.0',
  content: '感谢分享。',
};

const textResponse = (text: string, status = 200): Response => new Response(text, { status });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkAkismet', () => {
  it('POSTs to the per-key host and returns true when body is "true"', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('true'));

    const isSpam = await checkAkismet(baseOpts);
    expect(isSpam).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test-api-key.rest.akismet.com/1.1/comment-check');
    expect(init.method).toBe('POST');

    const body = init.body as URLSearchParams;
    expect(body.get('blog')).toBe('https://hakula.xyz');
    expect(body.get('user_ip')).toBe('192.0.2.1');
    expect(body.get('user_agent')).toBe('Mozilla/5.0');
    expect(body.get('comment_type')).toBe('comment');
    expect(body.get('comment_content')).toBe('感谢分享。');
  });

  it('returns false when body is "false"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('false'));
    expect(await checkAkismet(baseOpts)).toBe(false);
  });

  it('appends optional author / permalink fields when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('false'));

    await checkAkismet({
      ...baseOpts,
      permalink: 'https://hakula.xyz/about-me/',
      author: 'Reader',
      authorEmail: 'reader@example.com',
      authorUrl: 'https://reader.example.com',
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get('permalink')).toBe('https://hakula.xyz/about-me/');
    expect(body.get('comment_author')).toBe('Reader');
    expect(body.get('comment_author_email')).toBe('reader@example.com');
    expect(body.get('comment_author_url')).toBe('https://reader.example.com');
  });

  it('fail-opens with logger.warn on 5xx (transient outage)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('true', 500));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await checkAkismet(baseOpts)).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('fail-opens with logger.error on 4xx (misconfigured key)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('', 401));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await checkAkismet(baseOpts)).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('propagates network errors (caller wraps for fail-open)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENETDOWN'));
    await expect(checkAkismet(baseOpts)).rejects.toThrow('ENETDOWN');
  });
});
