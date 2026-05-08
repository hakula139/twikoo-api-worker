// Port of twikoo-func/utils/image.js to Web APIs (Blob / FormData / fetch /
// Web Crypto for S3 SigV4); upstream uses Node fs / axios / form-data.

import type { TwikooConfig } from '@/types';

import type { R2Env, UploadResult } from './types';

import { stringConfig } from '../config-read';
import { ResponseCode, TwikooError } from '../errors';
import { uploadChevereto } from './chevereto';
import { uploadEasyImage } from './easyimage';
import { checkNsfw, isUrl } from './helpers';
import { uploadLskyPro } from './lsky';
import { uploadPicList } from './piclist';
import { uploadR2 } from './r2';
import { uploadS3 } from './s3';
import { uploadSee } from './see';

export type { R2Env, UploadResult } from './types';

// Top-level dispatch (matches upstream's IMAGE_CDN routing, plus 'r2').
export const uploadImage = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
  env: R2Env,
): Promise<UploadResult> => {
  try {
    const imageService = stringConfig(config, 'IMAGE_CDN') ?? '';

    if (imageService === 's3') {
      if (!stringConfig(config, 'S3_BUCKET') || !stringConfig(config, 'S3_ACCESS_KEY_ID')) {
        throw new Error('未配置 S3 图床参数（S3_BUCKET、S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY）');
      }
    } else if (imageService === 'r2') {
      if (!env.R2 || !env.R2_PUBLIC_URL) {
        throw new Error('R2 binding 或 R2_PUBLIC_URL 未配置');
      }
    } else if (!imageService || !stringConfig(config, 'IMAGE_CDN_TOKEN')) {
      throw new Error('未配置图片上传服务');
    }

    if (stringConfig(config, 'NSFW_API_URL')) {
      const nsfw = await checkNsfw(photo, config);
      if (nsfw.rejected) {
        throw new TwikooError(ResponseCode.NSFW_REJECTED, nsfw.message);
      }
    }

    if (imageService === '7bu') {
      return await uploadLskyPro(photo, fileName, config, 'https://7bu.top');
    }
    if (imageService === 'see') {
      return await uploadSee(photo, fileName, config, 'https://s.ee/api/v1/file/upload');
    }
    if (isUrl(imageService)) {
      return await uploadLskyPro(photo, fileName, config, imageService);
    }
    if (imageService === 'lskypro') {
      return await uploadLskyPro(
        photo,
        fileName,
        config,
        stringConfig(config, 'IMAGE_CDN_URL') ?? '',
      );
    }
    if (imageService === 'piclist') {
      return await uploadPicList(
        photo,
        fileName,
        config,
        stringConfig(config, 'IMAGE_CDN_URL') ?? '',
      );
    }
    if (imageService === 'easyimage') {
      return await uploadEasyImage(photo, fileName, config);
    }
    if (imageService === 'chevereto') {
      return await uploadChevereto(photo, fileName, config);
    }
    if (imageService === 's3') {
      return await uploadS3(photo, fileName, config);
    }
    if (imageService === 'r2') {
      return await uploadR2(photo, fileName, env);
    }
    throw new Error('不支持的图片上传服务');
  } catch (e) {
    // Preserve typed errors (e.g. NSFW_REJECTED); wrap everything else.
    if (e instanceof TwikooError) {
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    throw new TwikooError(ResponseCode.UPLOAD_FAILED, message);
  }
};
