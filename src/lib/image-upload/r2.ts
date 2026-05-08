import type { R2Env, UploadResult } from './types';

import { decodePhoto, safeBaseName, stripTrailingSlash } from './helpers';

// Cloudflare R2 (native binding, no signing).
export const uploadR2 = async (
  photo: string,
  fileName: string,
  env: R2Env,
): Promise<UploadResult> => {
  if (!env.R2 || !env.R2_PUBLIC_URL) {
    throw new Error('R2 binding 或 R2_PUBLIC_URL 未配置');
  }
  const { mimeType, bytes } = decodePhoto(photo);
  const key = `${Date.now()}-${safeBaseName(fileName)}`;
  await env.R2.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  return { url: `${stripTrailingSlash(env.R2_PUBLIC_URL)}/${key}` };
};
