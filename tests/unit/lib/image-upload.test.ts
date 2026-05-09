import type { Env, TwikooConfig } from '@/types';

import { env as rawEnv } from 'cloudflare:test';

const env = rawEnv as unknown as Env;
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ResponseCode, TwikooError } from '@/lib/errors';
import { uploadImage } from '@/lib/image-upload';

const PNG_BASE64 = 'iVBORw0KGgo='; // arbitrary 8-byte payload, mime-flagged as png
const dataUrl = `data:image/png;base64,${PNG_BASE64}`;
const expectedBytes = atob(PNG_BASE64).length;

const r2Env = (): Pick<Env, 'R2' | 'R2_PUBLIC_URL'> => ({
  R2: env.R2,
  R2_PUBLIC_URL: 'https://r2.example.test',
});

const clearR2 = async (): Promise<void> => {
  const list = await env.R2.list();
  await Promise.all(list.objects.map((o) => env.R2.delete(o.key)));
};

beforeEach(clearR2);
afterEach(clearR2);

describe('uploadImage — r2 path', () => {
  it('round-trips bytes into the bound R2 bucket and returns a public URL', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };

    const result = await uploadImage(dataUrl, 'sample.png', config, r2Env());

    expect(result.url.startsWith('https://r2.example.test/')).toBe(true);
    const key = result.url.replace('https://r2.example.test/', '');
    expect(key).toMatch(/^\d+-sample\.png$/);

    const stored = await env.R2.get(key);
    if (!stored) {
      throw new Error('expected R2 to return the uploaded object');
    }
    const bytes = new Uint8Array(await stored.arrayBuffer());
    expect(bytes.length).toBe(expectedBytes);
    expect(stored.httpMetadata?.contentType).toBe('image/png');
  });

  it('strips path traversal segments from the upload key', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };
    const result = await uploadImage(dataUrl, '../../etc/passwd', config, r2Env());
    const key = result.url.replace('https://r2.example.test/', '');
    expect(key).not.toContain('/');
    expect(key).not.toContain('..');
    expect(key).toMatch(/^\d+-passwd$/);
  });

  it('falls back to "upload" when the filename collapses to empty', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };
    const result = await uploadImage(dataUrl, '/', config, r2Env());
    const key = result.url.replace('https://r2.example.test/', '');
    expect(key).toMatch(/^\d+-upload$/);
  });

  it('wraps generic errors as TwikooError(UPLOAD_FAILED)', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };
    const brokenEnv = { R2: env.R2, R2_PUBLIC_URL: '' };
    try {
      await uploadImage(dataUrl, 'x.png', config, brokenEnv);
      throw new Error('expected uploadImage to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.UPLOAD_FAILED);
    }
  });

  it('rejects when no IMAGE_CDN is configured', async () => {
    try {
      await uploadImage(dataUrl, 'x.png', {}, r2Env());
      throw new Error('expected uploadImage to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.UPLOAD_FAILED);
    }
  });
});
