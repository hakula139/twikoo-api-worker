import type { Env, TwikooConfig } from '@/types';

import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uploadImage } from '@/lib/image-upload';
import { applyTestSchema, resetTestDb } from '@tests/helpers/db';
import { PNG_PHOTO as dataUrl } from '@tests/helpers/image-fixture';

const r2Env = (): Pick<Env, 'DB' | 'R2' | 'R2_PUBLIC_URL'> => ({
  DB: env.DB,
  R2: env.R2,
  R2_PUBLIC_URL: 'https://r2.example.test',
});

const clearR2 = async (): Promise<void> => {
  const list = await env.R2.list();
  await Promise.all(list.objects.map((o) => env.R2.delete(o.key)));
};

beforeAll(applyTestSchema);
beforeEach(clearR2);
afterEach(async () => {
  await resetTestDb();
  await clearR2();
});

describe('uploadImage > R2', () => {
  it('strips path traversal segments from the upload key', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };

    const result = await uploadImage(dataUrl, '../../etc/passwd', config, r2Env());
    const key = decodeURIComponent(new URL(result.url).pathname.slice(1));

    expect(key).not.toContain('/');
    expect(key).not.toContain('..');
    expect(key).toMatch(/^[^/]+-passwd$/);
  });

  it('falls back to "upload" when the filename collapses to empty', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };

    const result = await uploadImage(dataUrl, '/', config, r2Env());
    const key = result.url.replace('https://r2.example.test/', '');

    expect(key).toMatch(/^[^/]+-upload$/);
  });

  it('encodes URL-reserved filename characters without changing the R2 key', async () => {
    const config: TwikooConfig = { IMAGE_CDN: 'r2' };

    const result = await uploadImage(dataUrl, 'report #1?.png', config, r2Env());

    expect(result.url).toMatch(/report%20%231%3F\.png$/);

    const key = decodeURIComponent(new URL(result.url).pathname.slice(1));
    expect(key).toMatch(/^[^/]+-report #1\?\.png$/);
    expect(await env.R2.get(key)).not.toBeNull();
  });
});
