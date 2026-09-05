import type { Env, TwikooConfig } from '@/types';

import { env as rawEnv } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uploadImage } from '@/lib/image-upload';

const PNG_BASE64 = 'iVBORw0KGgo=';
const dataUrl = `data:image/png;base64,${PNG_BASE64}`;
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const env = rawEnv as unknown as Env;

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
    const key = decodeURIComponent(new URL(result.url).pathname.slice(1));
    expect(key).toMatch(/^\d+-sample\.png$/);

    const stored = await env.R2.get(key);
    if (!stored) {
      throw new Error('expected R2 to return the uploaded object');
    }
    const bytes = new Uint8Array(await stored.arrayBuffer());
    expect(bytes).toEqual(PNG_BYTES);
    expect(stored.httpMetadata?.contentType).toBe('image/png');
  });

  it('strips path traversal segments from the upload key', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };
    const result = await uploadImage(dataUrl, '../../etc/passwd', config, r2Env());
    const key = decodeURIComponent(new URL(result.url).pathname.slice(1));
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

  it('encodes URL-reserved filename characters without changing the R2 key', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };
    const result = await uploadImage(dataUrl, 'report #1?.png', config, r2Env());
    expect(result.url).toMatch(/report%20%231%3F\.png$/);

    const key = decodeURIComponent(new URL(result.url).pathname.slice(1));
    expect(key).toMatch(/^\d+-report #1\?\.png$/);
    expect(await env.R2.get(key)).not.toBeNull();
  });
});
