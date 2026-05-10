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

const KNOWN_IMAGE_CDNS = [
  '7bu',
  'see',
  'lskypro',
  'piclist',
  'easyimage',
  'chevereto',
  's3',
  'r2',
] as const;
type KnownImageCdn = (typeof KNOWN_IMAGE_CDNS)[number];

const isKnownImageCdn = (s: string): s is KnownImageCdn =>
  (KNOWN_IMAGE_CDNS as readonly string[]).includes(s);

// Matches upstream's IMAGE_CDN routing, plus 'r2'. Per-provider preconditions
// are validated by each provider; this layer catches only unset/unrecognized.
export const uploadImage = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
  env: R2Env,
): Promise<UploadResult> => {
  try {
    const imageService = stringConfig(config, 'IMAGE_CDN') ?? '';
    if (!imageService) {
      throw new Error('未配置图片上传服务');
    }

    // Non-S3 / non-R2 providers historically require IMAGE_CDN_TOKEN to be
    // set. Preserve that contract so a missing token fails fast.
    if (
      imageService !== 's3' &&
      imageService !== 'r2' &&
      !stringConfig(config, 'IMAGE_CDN_TOKEN')
    ) {
      throw new Error('未配置图片上传服务');
    }

    if (stringConfig(config, 'NSFW_API_URL')) {
      const nsfw = await checkNsfw(photo, config);
      if (nsfw.rejected) {
        throw new TwikooError(ResponseCode.NSFW_REJECTED, nsfw.message);
      }
    }

    // Treat any URL-shaped IMAGE_CDN as an LskyPro base URL. Hoisted above the
    // known-CDN switch so the switch can cover its narrow union exhaustively.
    if (isUrl(imageService)) {
      return await uploadLskyPro(photo, fileName, config, imageService);
    }

    if (!isKnownImageCdn(imageService)) {
      throw new Error('不支持的图片上传服务');
    }

    switch (imageService) {
      case '7bu':
        return await uploadLskyPro(photo, fileName, config, 'https://7bu.top');
      case 'see':
        return await uploadSee(photo, fileName, config, 'https://s.ee/api/v1/file/upload');
      case 'lskypro':
        return await uploadLskyPro(
          photo,
          fileName,
          config,
          stringConfig(config, 'IMAGE_CDN_URL') ?? '',
        );
      case 'piclist':
        return await uploadPicList(
          photo,
          fileName,
          config,
          stringConfig(config, 'IMAGE_CDN_URL') ?? '',
        );
      case 'easyimage':
        return await uploadEasyImage(photo, fileName, config);
      case 'chevereto':
        return await uploadChevereto(photo, fileName, config);
      case 's3':
        return await uploadS3(photo, fileName, config);
      case 'r2':
        return await uploadR2(photo, fileName, env);
    }
  } catch (e) {
    // Preserve typed errors (e.g. NSFW_REJECTED); wrap everything else.
    if (e instanceof TwikooError) {
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    throw new TwikooError(ResponseCode.UPLOAD_FAILED, message);
  }
};
