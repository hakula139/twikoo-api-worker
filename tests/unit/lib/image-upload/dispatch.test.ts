// AKIAIOSFODNN is AWS's published synthetic access key for SigV4 examples.
// cspell:ignore AKIAIOSFODNN

import type { Env, TwikooConfig } from '@/types';

import { env as rawEnv } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResponseCode, TwikooError } from '@/lib/errors';
import { uploadImage } from '@/lib/image-upload';

const env = rawEnv as unknown as Env;

const PNG_BASE64 = 'iVBORw0KGgo=';
const dataUrl = `data:image/png;base64,${PNG_BASE64}`;

const r2Env = (): Pick<Env, 'R2' | 'R2_PUBLIC_URL'> => ({
  R2: env.R2,
  R2_PUBLIC_URL: 'https://r2.example.test',
});

const okResponse = (body: unknown, init: ResponseInit = { status: 200 }): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uploadImage routes IMAGE_CDN to the right provider', () => {
  it('lskypro posts multipart with Bearer token to /api/v1/upload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({
        status: true,
        data: { links: { url: 'https://cdn.example/abc.png' } },
      }),
    );
    const config: TwikooConfig = {
      IMAGE_CDN: 'lskypro',
      IMAGE_CDN_URL: 'https://lsky.example/',
      IMAGE_CDN_TOKEN: 'tk-1',
    };

    const result = await uploadImage(dataUrl, 'a.png', config, r2Env());

    expect(result.url).toBe('https://cdn.example/abc.png');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://lsky.example/api/v1/upload');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tk-1');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('see posts multipart with the configured imageCdn URL and smfile field', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse({ success: true, data: { url: 'https://s.ee/x.png' } }));
    const config: TwikooConfig = { IMAGE_CDN: 'see', IMAGE_CDN_TOKEN: 'tk' };

    const result = await uploadImage(dataUrl, 'a.png', config, r2Env());

    expect(result.url).toBe('https://s.ee/x.png');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://s.ee/api/v1/file/upload');
    expect((init.body as FormData).get('smfile')).toBeInstanceOf(Blob);
  });

  it('piclist posts to /upload and embeds the token in the query', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse({ success: true, result: ['https://piclist.example/y.png'] }));
    const config: TwikooConfig = {
      IMAGE_CDN: 'piclist',
      IMAGE_CDN_URL: 'https://piclist.example',
      IMAGE_CDN_TOKEN: 'pk',
    };

    const result = await uploadImage(dataUrl, 'a.png', config, r2Env());

    expect(result.url).toBe('https://piclist.example/y.png');
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://piclist.example/upload?key=pk');
  });

  it('easyimage posts token + image fields to IMAGE_CDN_URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        okResponse({ code: 200, result: 'success', url: 'https://e.example/z.png' }),
      );
    const config: TwikooConfig = {
      IMAGE_CDN: 'easyimage',
      IMAGE_CDN_URL: 'https://easy.example/api/upload',
      IMAGE_CDN_TOKEN: 'ek',
    };

    const result = await uploadImage(dataUrl, 'a.png', config, r2Env());

    expect(result.url).toBe('https://e.example/z.png');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://easy.example/api/upload');
    expect((init.body as FormData).get('token')).toBe('ek');
    expect((init.body as FormData).get('image')).toBeInstanceOf(Blob);
  });

  it('chevereto posts key/source/format to /api/1/upload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({
        status_code: 200,
        image: {
          url: 'https://chev.example/x.png',
          thumb: { url: 'https://chev.example/x.thumb.png' },
        },
      }),
    );
    const config: TwikooConfig = {
      IMAGE_CDN: 'chevereto',
      IMAGE_CDN_URL: 'https://chev.example/',
      IMAGE_CDN_TOKEN: 'ck',
    };

    const result = await uploadImage(dataUrl, 'a.png', config, r2Env());

    expect(result.url).toBe('https://chev.example/x.png');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chev.example/api/1/upload');
    expect((init.body as FormData).get('key')).toBe('ck');
    expect((init.body as FormData).get('format')).toBe('json');
  });

  it('7bu routes to LskyPro at https://7bu.top', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        okResponse({ status: true, data: { links: { url: 'https://7bu.top/x.png' } } }),
      );
    const config: TwikooConfig = { IMAGE_CDN: '7bu', IMAGE_CDN_TOKEN: 'tk' };

    await uploadImage(dataUrl, 'a.png', config, r2Env());

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://7bu.top/api/v1/upload');
  });

  it('https URL falls through to LskyPro using the URL as the imageCdn', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        okResponse({ status: true, data: { links: { url: 'https://custom.example/x.png' } } }),
      );
    const config: TwikooConfig = {
      IMAGE_CDN: 'https://custom.example/',
      IMAGE_CDN_TOKEN: 'tk',
    };

    await uploadImage(dataUrl, 'a.png', config, r2Env());

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://custom.example/api/v1/upload');
  });

  it('s3 PUTs to bucket endpoint with AWS4-HMAC-SHA256 Authorization', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    const config: TwikooConfig = {
      IMAGE_CDN: 's3',
      S3_BUCKET: 'my-bucket',
      S3_ACCESS_KEY_ID: 'AKIA',
      S3_SECRET_ACCESS_KEY: 'sk',
      S3_REGION: 'us-east-1',
    };

    const result = await uploadImage(dataUrl, 'a.png', config, r2Env());

    expect(result.url).toMatch(/^https:\/\/my-bucket\.s3\.us-east-1\.amazonaws\.com\/\d+-a\.png$/);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/my-bucket\.s3\.us-east-1\.amazonaws\.com\/\d+-a\.png$/);
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    const sig = /Signature=([0-9a-f]+)/.exec(headers.Authorization);
    expect(sig?.[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  // Pins the SigV4 derivation against fixed inputs. Catches drift in canonical
  // request shape, header ordering, signing-key chain, etc. The pinned hex was
  // computed by this implementation; if it changes, audit the diff before
  // updating — a passing structural test is not enough.
  it('s3 SigV4 produces a stable signature for fixed inputs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));
    try {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('', { status: 200 }));
      const config: TwikooConfig = {
        IMAGE_CDN: 's3',
        S3_BUCKET: 'my-bucket',
        S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        S3_REGION: 'us-east-1',
      };

      await uploadImage(dataUrl, 'a.png', config, r2Env());

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/1768435200000-a.png');
      const headers = init.headers as Record<string, string>;
      expect(headers['x-amz-date']).toBe('20260115T000000Z');
      // `iVBORw0KGgo=` decoded is the PNG magic byte sequence; SHA-256 is stable.
      expect(headers['x-amz-content-sha256']).toBe(
        '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      );
      expect(headers.Authorization).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260115/us-east-1/s3/aws4_request, ' +
          'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, ' +
          'Signature=031bfd6aa2d81e30bc47456932807c116a997c91d3e1650300c8574080aaa153',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects when imageService is unrecognized but token-gating passed', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'unknown-service', IMAGE_CDN_TOKEN: 'tk' };
    try {
      await uploadImage(dataUrl, 'a.png', config, r2Env());
      throw new Error('expected uploadImage to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.UPLOAD_FAILED);
    }
  });
});

describe('uploadImage NSFW pre-check', () => {
  it('rejects with NSFW_REJECTED when the classifier exceeds the threshold', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ porn: 0.9 }));
    const config: TwikooConfig = {
      IMAGE_CDN: 'r2',
      NSFW_API_URL: 'https://nsfw.example/',
      NSFW_THRESHOLD: '0.5',
    };

    try {
      await uploadImage(dataUrl, 'x.png', config, r2Env());
      throw new Error('expected uploadImage to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.NSFW_REJECTED);
    }
  });
});
