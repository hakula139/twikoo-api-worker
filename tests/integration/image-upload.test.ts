import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ResponseCode } from '@/lib/errors';
import { applyTestSchema, resetTestDb } from '@tests/helpers/db';
import { postEvent, seedConfig } from './helpers';

const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

beforeAll(applyTestSchema);

afterEach(async () => {
  await resetTestDb();
  vi.restoreAllMocks();
  const { objects } = await env.R2.list();
  await Promise.all(objects.map(({ key }) => env.R2.delete(key)));
});

describe('integration: image uploads', () => {
  it('preserves same-name uploads made at the same time in the persisted R2 provider', async () => {
    await seedConfig({
      IMAGE_CDN: 'r2',
      IMAGE_CDN_URL: 'https://retired.example.com',
      IMAGE_CDN_TOKEN: 'example-token',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(Date, 'now').mockReturnValue(1768435200000);
    const photos = [
      { photo: PHOTO, bytes: PNG_BYTES },
      { photo: 'data:image/png;base64,iVBORw0KGgoA', bytes: new Uint8Array([...PNG_BYTES, 0]) },
    ];

    const uploads = await Promise.all(
      photos.map(async ({ photo, bytes }) => ({
        bytes,
        ...(await postEvent('UPLOAD_IMAGE', { photo, fileName: 'sample.png' })),
      })),
    );

    for (const { body, bytes } of uploads) {
      expect(body.code).toBe(ResponseCode.SUCCESS);
      expect(body).not.toHaveProperty('err');
      const { url } = body.data as { url: string };
      const publicUrl = new URL(url);
      expect(publicUrl.origin).toBe(env.R2_PUBLIC_URL);
      const key = decodeURIComponent(publicUrl.pathname.slice(1));
      expect(key).toMatch(/^[^/]+-sample\.png$/);
      const stored = await env.R2.get(key);
      if (!stored) {
        throw new Error('Expected R2 to return the uploaded object.');
      }
      expect(new Uint8Array(await stored.arrayBuffer())).toEqual(bytes);
      expect(stored.httpMetadata?.contentType).toBe('image/png');
    }

    const urls = uploads.map(({ body }) => (body.data as { url: string }).url);
    expect(urls[0]).not.toBe(urls[1]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns validation failures in the upload client error field', async () => {
    await seedConfig({ IMAGE_CDN: 'r2' });

    const { body } = await postEvent('UPLOAD_IMAGE', { fileName: 'sample.png' });

    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toBe('参数"photo"不合法');
    expect(body.err).toBe('参数"photo"不合法');
  });

  it('returns R2 failures in the upload client error field', async () => {
    await seedConfig({ IMAGE_CDN: 'r2' });
    vi.spyOn(env.R2, 'put').mockRejectedValueOnce(new Error('Storage is unavailable.'));

    const { body } = await postEvent('UPLOAD_IMAGE', { photo: PHOTO, fileName: 'sample.png' });

    expect(body.code).toBe(ResponseCode.UPLOAD_FAILED);
    expect(body.message).toBe('Storage is unavailable.');
    expect(body.err).toBe('Storage is unavailable.');
  });
});
