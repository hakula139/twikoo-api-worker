import type { TwikooConfig } from '@/types';

import type { UploadResult } from './types';

import { stringConfig } from '../config-read';
import { multipartFromPhoto } from './helpers';

interface EasyImageResponse {
  code?: number;
  result?: string;
  url?: string;
  thumb?: string;
  del?: string;
  message?: string;
}

// EasyImage 2.0.
export const uploadEasyImage = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
): Promise<UploadResult> => {
  const apiUrl = stringConfig(config, 'IMAGE_CDN_URL');
  if (!apiUrl) {
    throw new Error('未配置 EasyImage2.0 的 API 地址 (IMAGE_CDN_URL)');
  }
  const token = stringConfig(config, 'IMAGE_CDN_TOKEN');
  if (!token) {
    throw new Error('未配置 EasyImage2.0 的 Token (IMAGE_CDN_TOKEN)');
  }

  const formData = multipartFromPhoto(photo, fileName, 'image');
  formData.append('token', token);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'User-Agent': 'Twikoo' },
    body: formData,
  });
  const data: EasyImageResponse = await response.json();
  if (data.code !== 200 || data.result !== 'success') {
    throw new Error(`EasyImage2.0 上传失败: API 返回错误 (CODE: ${data.code ?? 'unknown'})`);
  }
  if (!data.url) {
    throw new Error('EasyImage2.0 上传失败: 未找到有效图片 URL');
  }
  return { url: data.url, thumb: data.thumb, del: data.del };
};
