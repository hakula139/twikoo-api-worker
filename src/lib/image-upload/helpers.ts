import type { TwikooConfig } from '@/types';

import type { DecodedPhoto } from './types';

import { logger } from '@/twikoo';
import { stringConfig } from '../config-read';

export const decodePhoto = (dataUrl: string): DecodedPhoto => {
  const [meta, base64] = dataUrl.split(';base64,');
  if (!base64) {
    throw new Error('photo must be a base64 data URL');
  }
  const mimeType = meta.replace(/^data:/, '') || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { blob: new Blob([bytes], { type: mimeType }), bytes, mimeType };
};

export const isUrl = (s: string): boolean => /^https?:\/\//.test(s);

export const stripTrailingSlash = (s: string): string => s.replace(/\/$/, '');

// Build a multipart FormData with the decoded photo under `field`. Used by
// every non-r2/s3 provider to package the image for the upstream HTTP API.
export const multipartFromPhoto = (photo: string, fileName: string, field: string): FormData => {
  const { blob } = decodePhoto(photo);
  const fd = new FormData();
  fd.append(field, blob, fileName);
  return fd;
};

// Drop path separators and collapse repeated dots so a hostile fileName can't
// climb out of the configured prefix or collide with a different tenant.
export const safeBaseName = (name: string): string => {
  const base = name.replace(/.*[\\/]/, '').replace(/\.{2,}/g, '.');
  return base || 'upload';
};

interface NsfwResult {
  rejected: boolean;
  message: string;
}

export const checkNsfw = async (photo: string, config: TwikooConfig): Promise<NsfwResult> => {
  const apiBase = stringConfig(config, 'NSFW_API_URL');
  if (!apiBase) {
    return { rejected: false, message: '' };
  }

  try {
    const threshold = parseFloat(stringConfig(config, 'NSFW_THRESHOLD') ?? '') || 0.5;
    const { blob } = decodePhoto(photo);
    const formData = new FormData();
    formData.append('image', blob, 'nsfw_check.jpg');

    const response = await fetch(`${stripTrailingSlash(apiBase)}/classify`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(30000),
    });
    const scores: Record<string, number> | null = await response.json();
    if (scores && typeof scores === 'object') {
      const nsfwScore = (scores.porn ?? 0) + (scores.hentai ?? 0) + (scores.sexy ?? 0);
      if (nsfwScore > threshold) {
        return {
          rejected: true,
          message: `图片包含不当内容，检测分数 ${nsfwScore.toFixed(3)} 超过阈值 ${threshold}`,
        };
      }
    }
  } catch (error) {
    // Best-effort: NSFW failures fall through (don't block upload), but log so
    // a misconfigured / down provider is visible.
    logger.warn('NSFW pre-check failed:', error);
  }
  return { rejected: false, message: '' };
};
