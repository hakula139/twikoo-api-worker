import type { TwikooConfig } from '@/types';

import type { UploadResult } from './types';

import { stringConfig } from '../config-read';
import { multipartFromPhoto, stripTrailingSlash } from './helpers';

interface PicListResponse {
  success: boolean;
  message?: string;
  result?: string[];
}

export const uploadPicList = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
  imageCdn: string,
): Promise<UploadResult> => {
  const formData = multipartFromPhoto(photo, fileName, 'file');

  const token = stringConfig(config, 'IMAGE_CDN_TOKEN');
  const url = token
    ? `${stripTrailingSlash(imageCdn)}/upload?key=${encodeURIComponent(token)}`
    : `${stripTrailingSlash(imageCdn)}/upload`;
  const response = await fetch(url, { method: 'POST', body: formData });
  const data: PicListResponse = await response.json();
  if (!data.success || !data.result?.[0]) {
    throw new Error(data.message ?? 'PicList upload failed');
  }
  return { ...data, url: data.result[0] };
};
