import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/twikoo', () => ({ logger: console }));

import { checkAkismet } from '../../../src/lib/akismet';

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

  it('fail-opens to non-spam when Akismet returns a non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('true', 500));
    expect(await checkAkismet(baseOpts)).toBe(false);
  });
});
