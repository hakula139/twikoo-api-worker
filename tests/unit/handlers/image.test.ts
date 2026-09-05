import type { RequestCtx } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { imageUpload } from '@/handlers/image';
import * as imageLib from '@/lib/image-upload';
import { buildCtx } from '@tests/helpers/ctx';

vi.mock('@/lib/image-upload', () => ({
  uploadImage: vi.fn(async () => ({ url: 'https://cdn.example/x.png' })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('imageUpload', () => {
  const photo = 'data:image/png;base64,iVBORw0KGgo=';

  it('forwards photo, fileName, config, and env to uploadImage and wraps the result', async () => {
    vi.mocked(imageLib.uploadImage).mockResolvedValueOnce({ url: 'https://cdn.example/y.png' });
    const env = { R2_PUBLIC_URL: 'https://cdn.example' } as RequestCtx['env'];
    const config = { IMAGE_CDN: 'r2' };
    const ctx = buildCtx({ config, env });

    const result = await imageUpload({ photo, fileName: 'avatar.png' }, ctx);

    expect(imageLib.uploadImage).toHaveBeenCalledWith(photo, 'avatar.png', config, env);
    expect(result).toEqual({ data: { url: 'https://cdn.example/y.png' } });
  });

  it('propagates errors from uploadImage', async () => {
    vi.mocked(imageLib.uploadImage).mockRejectedValueOnce(new Error('R2 binding missing'));
    await expect(imageUpload({ photo, fileName: 'avatar.png' }, buildCtx())).rejects.toThrow(
      'R2 binding missing',
    );
  });
});
