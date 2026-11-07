import type { R2Env, UploadResult } from './types';

import { drizzle } from 'drizzle-orm/d1';

import { createUploadDb } from '../../db/upload';
import { decodePhoto, encodePath, newUploadKey, stripTrailingSlash } from './helpers';

export const uploadR2 = async (
  photo: string,
  fileName: string,
  env: R2Env,
): Promise<UploadResult> => {
  if (!env.R2 || !env.R2_PUBLIC_URL) {
    throw new Error('R2 binding 或 R2_PUBLIC_URL 未配置');
  }

  const { mimeType, bytes } = decodePhoto(photo);
  const key = newUploadKey(fileName);
  if (new TextEncoder().encode(key).length > 1_024) {
    throw new Error('Image filename is too long.');
  }

  await createUploadDb(drizzle(env.DB)).register(key, Date.now());
  await env.R2.put(key, bytes, { httpMetadata: { contentType: mimeType } });

  return { url: `${stripTrailingSlash(env.R2_PUBLIC_URL)}/${encodePath(key)}` };
};
