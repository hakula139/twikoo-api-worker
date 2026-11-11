// cspell:ignore AKIA AKIAIOSFODNN

import type { Env, TwikooConfig } from '@/types';

import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResponseCode } from '@/lib/errors';
import { uploadImage } from '@/lib/image-upload';

const PNG_BASE64 = 'iVBORw0KGgo=';
const dataUrl = `data:image/png;base64,${PNG_BASE64}`;

const r2Env = (): Pick<Env, 'DB' | 'R2' | 'R2_PUBLIC_URL'> => ({
  DB: env.DB,
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

describe('uploadImage > configuration', () => {
  it('rejects when IMAGE_CDN is unset', async () => {
    await expect(uploadImage(dataUrl, 'a.png', {}, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
      message: expect.stringContaining('未配置图片上传服务') as string,
    });
  });

  it('rejects when a non-r2/non-s3 provider is missing IMAGE_CDN_TOKEN', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'lskypro' };

    await expect(uploadImage(dataUrl, 'a.png', config, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
    });
  });

  it('rejects when imageService is unrecognized but token-gating passed', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'unknown-service', IMAGE_CDN_TOKEN: 'tk' };

    await expect(uploadImage(dataUrl, 'a.png', config, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
      message: '不支持的图片上传服务',
    });
  });
});

describe('uploadImage > NSFW pre-check', () => {
  it('rejects with NSFW_REJECTED when the classifier exceeds the threshold', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ porn: 0.9 }));
    const config: TwikooConfig = {
      IMAGE_CDN: 'r2',
      NSFW_API_URL: 'https://nsfw.example/',
      NSFW_THRESHOLD: '0.5',
    };

    await expect(uploadImage(dataUrl, 'x.png', config, r2Env())).rejects.toMatchObject({
      code: ResponseCode.NSFW_REJECTED,
      message: expect.stringContaining('0.900') as string,
    });
  });
});

describe('uploadImage > providers', () => {
  const lskyConfig: TwikooConfig = {
    IMAGE_CDN: 'lskypro',
    IMAGE_CDN_URL: 'https://lsky.example',
    IMAGE_CDN_TOKEN: 'tk',
  };

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

  it('lskypro surfaces upstream message when status: false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ status: false, message: 'token expired' }),
    );

    await expect(uploadImage(dataUrl, 'a.png', lskyConfig, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
      message: 'token expired',
    });
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

  it('see surfaces upstream message when success: false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ success: false, message: 'rate limited' }),
    );
    const config: TwikooConfig = { IMAGE_CDN: 'see', IMAGE_CDN_TOKEN: 'tk' };

    await expect(uploadImage(dataUrl, 'a.png', config, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
      message: 'rate limited',
    });
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

  it('piclist surfaces upstream message when success: false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ success: false, message: 'quota exceeded' }),
    );
    const config: TwikooConfig = {
      IMAGE_CDN: 'piclist',
      IMAGE_CDN_URL: 'https://piclist.example',
      IMAGE_CDN_TOKEN: 'tk',
    };

    await expect(uploadImage(dataUrl, 'a.png', config, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
      message: 'quota exceeded',
    });
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

  it('easyimage rejects when API code is not 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ code: 500, message: 'internal' }),
    );
    const config: TwikooConfig = {
      IMAGE_CDN: 'easyimage',
      IMAGE_CDN_URL: 'https://easy.example/api/index.php',
      IMAGE_CDN_TOKEN: 'tk',
    };

    await expect(uploadImage(dataUrl, 'a.png', config, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
      message: expect.stringContaining('CODE: 500') as string,
    });
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

  it('chevereto wraps non-200 status_code with the upstream error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ status_code: 400, error: { message: 'invalid api key' } }),
    );
    const config: TwikooConfig = {
      IMAGE_CDN: 'chevereto',
      IMAGE_CDN_URL: 'https://chev.example',
      IMAGE_CDN_TOKEN: 'tk',
    };

    await expect(uploadImage(dataUrl, 'a.png', config, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
      message: expect.stringContaining('invalid api key') as string,
    });
  });

  it('s3 preserves the prefix and gives same-name uploads distinct signed paths at the same time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1768435200000);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    const config: TwikooConfig = {
      IMAGE_CDN: 's3',
      S3_BUCKET: 'my-bucket',
      S3_ACCESS_KEY_ID: 'AKIA',
      S3_SECRET_ACCESS_KEY: 'sk',
      S3_REGION: 'us-east-1',
      S3_PATH_PREFIX: 'uploads/images/',
    };

    const results = await Promise.all([
      uploadImage(dataUrl, 'a.png', config, r2Env()),
      uploadImage(dataUrl, 'a.png', config, r2Env()),
    ]);

    const urls = fetchSpy.mock.calls.map(([url]) => url);
    expect(results.map(({ url }) => url).sort()).toEqual([...urls].sort());
    expect(urls[0]).not.toBe(urls[1]);

    for (const [url, init] of fetchSpy.mock.calls as [string, RequestInit][]) {
      expect(url).toMatch(
        /^https:\/\/my-bucket\.s3\.us-east-1\.amazonaws\.com\/uploads\/images\/[^/]+-a\.png$/,
      );
      expect(init.method).toBe('PUT');
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      const sig = /Signature=([0-9a-f]+)/.exec(headers.Authorization);
      expect(sig?.[1]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('s3 encodes URL-reserved filename characters in the signed request path', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    const config: TwikooConfig = {
      IMAGE_CDN: 's3',
      S3_BUCKET: 'my-bucket',
      S3_ACCESS_KEY_ID: 'AKIA',
      S3_SECRET_ACCESS_KEY: 'test-secret',
      S3_REGION: 'us-east-1',
    };

    const result = await uploadImage(dataUrl, "Reader's report (draft) #1?.png", config, r2Env());

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/Reader%27s%20report%20%28draft%29%20%231%3F\.png$/);
    expect(result.url).toBe(url);
  });

  it('s3 SigV4 produces a stable signature for fixed inputs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');

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
      expect(url).toBe(
        'https://my-bucket.s3.us-east-1.amazonaws.com/00000000-0000-4000-8000-000000000000-a.png',
      );
      const headers = init.headers as Record<string, string>;

      expect(headers['x-amz-date']).toBe('20260115T000000Z');
      expect(headers['x-amz-content-sha256']).toBe(
        '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      );
      expect(headers.Authorization).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260115/us-east-1/s3/aws4_request, ' +
          'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, ' +
          'Signature=f877700e5fc3292742aede4728a4762276f0d3aa34db961056d8b5d20e146ac2',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('s3 wraps a non-2xx PUT response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    const config: TwikooConfig = {
      IMAGE_CDN: 's3',
      S3_BUCKET: 'my-bucket',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    };

    await expect(uploadImage(dataUrl, 'a.png', config, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
    });
  });

  it('rejects when s3 is missing S3_BUCKET / S3_ACCESS_KEY_ID', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 's3' };

    await expect(uploadImage(dataUrl, 'a.png', config, r2Env())).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
      message: expect.stringContaining('S3') as string,
    });
  });

  it('rejects when r2 is selected but R2_PUBLIC_URL is unset', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };
    const env = { DB: r2Env().DB, R2: r2Env().R2, R2_PUBLIC_URL: '' };

    await expect(uploadImage(dataUrl, 'a.png', config, env)).rejects.toMatchObject({
      code: ResponseCode.UPLOAD_FAILED,
      message: expect.stringContaining('R2') as string,
    });
  });
});
