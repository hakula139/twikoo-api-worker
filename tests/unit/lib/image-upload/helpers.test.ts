import type { TwikooConfig } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkNsfw,
  decodePhoto,
  encodePath,
  isUrl,
  safeBaseName,
  stripTrailingSlash,
} from '@/lib/image-upload/helpers';

const PNG_BASE64 = 'iVBORw0KGgo=';
const dataUrl = `data:image/png;base64,${PNG_BASE64}`;
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const okResponse = (body: unknown, init: ResponseInit = { status: 200 }): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decodePhoto', () => {
  it('decodes a valid data URL into blob, bytes, and mimeType', async () => {
    const result = decodePhoto(dataUrl);

    expect(result.mimeType).toBe('image/png');
    expect(result.bytes).toEqual(PNG_BYTES);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('image/png');
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it('preserves the supplied MIME type', () => {
    const jpeg = `data:image/jpeg;base64,${PNG_BASE64}`;

    expect(decodePhoto(jpeg).mimeType).toBe('image/jpeg');
  });

  it('defaults to application/octet-stream when the data: prefix omits a MIME type', () => {
    expect(decodePhoto(`data:;base64,${PNG_BASE64}`).mimeType).toBe('application/octet-stream');
  });

  it('throws when the input is not a base64 data URL', () => {
    expect(() => decodePhoto('not a data url')).toThrow('photo must be a base64 data URL');
  });
});

describe('isUrl', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com/path', true],
    ['ftp://example.com', false],
    ['mailto:reader@example.com', false],
    ['/relative', false],
    ['', false],
  ])('isUrl(%s) === %s', (input, expected) => {
    expect(isUrl(input)).toBe(expected);
  });
});

describe('stripTrailingSlash', () => {
  it.each([
    ['https://example.com/', 'https://example.com'],
    ['https://example.com', 'https://example.com'],
    ['https://example.com//', 'https://example.com/'],
  ])('strips at most one trailing slash from %s', (input, expected) => {
    const result = stripTrailingSlash(input);

    expect(result).toBe(expected);
  });
});

describe('encodePath', () => {
  it('encodes each segment with the AWS URI rules without escaping separators', () => {
    expect(encodePath("articles/Reader's notes (draft) #1?.png")).toBe(
      'articles/Reader%27s%20notes%20%28draft%29%20%231%3F.png',
    );
  });
});

describe('safeBaseName', () => {
  it.each([
    ['a/b/c.png', 'c.png'],
    [String.raw`a\b\c.png`, 'c.png'],
    ['../../etc/passwd', 'passwd'],
    ['weird..name.png', 'weird.name.png'],
    ['', 'upload'],
    ['a/', 'upload'],
    ['report #1?.png', 'report #1?.png'],
  ])('normalizes %s', (input, expected) => {
    const result = safeBaseName(input);

    expect(result).toBe(expected);
  });
});

describe('checkNsfw', () => {
  it('passes through (no rejection) when NSFW_API_URL is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await checkNsfw(dataUrl, {});

    expect(result).toEqual({ rejected: false, message: '' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects when the summed nsfw score exceeds the configured threshold', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ porn: 0.4, hentai: 0.3, sexy: 0.2, neutral: 0.1 }),
    );
    const config: TwikooConfig = {
      NSFW_API_URL: 'https://nsfw.example/',
      NSFW_THRESHOLD: '0.5',
    };
    const result = await checkNsfw(dataUrl, config);

    expect(result.rejected).toBe(true);
    expect(result.message).toContain('0.900');
    expect(result.message).toContain('0.5');
  });

  it('passes through when the summed score is below the threshold', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ porn: 0.1, hentai: 0.1, sexy: 0.1 }),
    );
    const config: TwikooConfig = { NSFW_API_URL: 'https://nsfw.example' };

    expect(await checkNsfw(dataUrl, config)).toEqual({ rejected: false, message: '' });
  });

  it('falls through (best-effort) when the fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));
    const config: TwikooConfig = { NSFW_API_URL: 'https://nsfw.example' };

    expect(await checkNsfw(dataUrl, config)).toEqual({ rejected: false, message: '' });
  });

  it('uses default threshold 0.5 when NSFW_THRESHOLD is unset', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ porn: 0.6, hentai: 0, sexy: 0 }),
    );
    const config: TwikooConfig = { NSFW_API_URL: 'https://nsfw.example' };
    const result = await checkNsfw(dataUrl, config);

    expect(result.rejected).toBe(true);
  });

  it('strips a trailing slash on NSFW_API_URL before posting to /classify', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ porn: 0, hentai: 0, sexy: 0 }));
    await checkNsfw(dataUrl, { NSFW_API_URL: 'https://nsfw.example/' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://nsfw.example/classify',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
