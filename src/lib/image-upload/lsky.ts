import type { TwikooConfig } from '@/types';

import type { UploadResult } from './types';

import { stringConfig } from '../config-read';
import { multipartFromPhoto, stripTrailingSlash } from './helpers';

interface LskyProResponse {
  status: boolean;
  message?: string;
  data?: { links?: { url?: string }; [key: string]: unknown };
}

// Also used for `7bu` and URL-as-IMAGE_CDN.
export const uploadLskyPro = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
  imageCdn: string,
): Promise<UploadResult> => {
  const formData = multipartFromPhoto(photo, fileName, 'file');

  const rawToken = stringConfig(config, 'IMAGE_CDN_TOKEN') ?? '';
  const token = rawToken.startsWith('Bearer') ? rawToken : `Bearer ${rawToken}`;

  const response = await fetch(`${stripTrailingSlash(imageCdn)}/api/v1/upload`, {
    method: 'POST',
    headers: { Authorization: token },
    body: formData,
  });
  const data: LskyProResponse = await response.json();
  if (!data.status || !data.data?.links?.url) {
    throw new Error(data.message ?? 'LskyPro upload failed');
  }
  return { ...data.data, url: data.data.links.url };
};
