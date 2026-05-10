import type { TwikooConfig } from '@/types';

import type { UploadResult } from './types';

import { stringConfig } from '../config-read';
import { multipartFromPhoto, stripTrailingSlash } from './helpers';

interface CheveretoResponse {
  status_code?: number;
  image?: { url?: string; thumb?: { url?: string }; delete_url?: string };
  error?: { message?: string };
}

export const uploadChevereto = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
): Promise<UploadResult> => {
  const siteUrl = stringConfig(config, 'IMAGE_CDN_URL');
  if (!siteUrl) {
    throw new Error('未配置 Chevereto 站点地址 (IMAGE_CDN_URL)');
  }
  const token = stringConfig(config, 'IMAGE_CDN_TOKEN');
  if (!token) {
    throw new Error('未配置 Chevereto API Key (IMAGE_CDN_TOKEN)');
  }

  const formData = multipartFromPhoto(photo, fileName, 'source');
  formData.append('key', token);
  formData.append('format', 'json');

  const response = await fetch(`${stripTrailingSlash(siteUrl)}/api/1/upload`, {
    method: 'POST',
    body: formData,
  });
  const data: CheveretoResponse = await response.json();
  if (data.status_code !== 200 || !data.image?.url) {
    const errMsg = data.error?.message ?? JSON.stringify(data);
    throw new Error(`Chevereto 上传失败: ${errMsg}`);
  }
  return {
    url: data.image.url,
    thumb: data.image.thumb?.url ?? data.image.url,
    del: data.image.delete_url,
  };
};
