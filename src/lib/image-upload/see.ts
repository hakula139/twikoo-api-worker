import type { TwikooConfig } from '@/types';

import type { UploadResult } from './types';

import { stringConfig } from '../config-read';
import { multipartFromPhoto } from './helpers';

interface SeeResponse {
  success: boolean;
  message?: string;
  data?: { url?: string; [key: string]: unknown };
}

// S.EE (former SM.MS).
export const uploadSee = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
  imageCdn: string,
): Promise<UploadResult> => {
  const formData = multipartFromPhoto(photo, fileName, 'smfile');

  const response = await fetch(imageCdn, {
    method: 'POST',
    headers: { Authorization: stringConfig(config, 'IMAGE_CDN_TOKEN') ?? '' },
    body: formData,
  });
  const data: SeeResponse = await response.json();
  if (!data.success || !data.data?.url) {
    throw new Error(data.message ?? 'S.EE upload failed');
  }
  return data.data as UploadResult;
};
