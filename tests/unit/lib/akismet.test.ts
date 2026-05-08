import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAkismet } from '@/lib/akismet';

const baseOpts = {
  apiKey: 'KEY123',
  blog: 'https://blog.example',
  userIp: '1.2.3.4',
  userAgent: 'Mozilla',
  content: 'hi',
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
    expect(url).toBe('https://KEY123.rest.akismet.com/1.1/comment-check');
    expect(init.method).toBe('POST');

    const body = init.body as URLSearchParams;
    expect(body.get('blog')).toBe('https://blog.example');
    expect(body.get('user_ip')).toBe('1.2.3.4');
    expect(body.get('user_agent')).toBe('Mozilla');
    expect(body.get('comment_type')).toBe('comment');
    expect(body.get('comment_content')).toBe('hi');
  });

  it('returns false when body is "false"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('false'));
    expect(await checkAkismet(baseOpts)).toBe(false);
  });

  it('appends optional author / permalink fields when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('false'));

    await checkAkismet({
      ...baseOpts,
      permalink: 'https://blog.example/post',
      author: 'Alice',
      authorEmail: 'a@b.c',
      authorUrl: 'https://a.example',
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get('permalink')).toBe('https://blog.example/post');
    expect(body.get('comment_author')).toBe('Alice');
    expect(body.get('comment_author_email')).toBe('a@b.c');
    expect(body.get('comment_author_url')).toBe('https://a.example');
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
