import type { TwikooConfig } from '@/types';

import type { UploadResult } from './types';

import { stringConfig } from '../config-read';
import { decodePhoto } from './helpers';

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
  const { blob } = decodePhoto(photo);
  const formData = new FormData();
  formData.append('smfile', blob, fileName);

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
