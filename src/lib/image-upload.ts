// Port of twikoo-func/utils/image.js to Web APIs (Blob / FormData / fetch /
// Web Crypto for S3 SigV4); upstream uses Node fs / axios / form-data.

import type { Env, TwikooConfig } from '../types';

import { logger } from '../twikoo';
import { ResponseCode, TwikooError } from './errors';

type R2Env = Pick<Env, 'R2' | 'R2_PUBLIC_URL'>;

export interface UploadResult {
  url: string;
  [key: string]: unknown;
}

interface DecodedPhoto {
  blob: Blob;
  bytes: Uint8Array;
  mimeType: string;
}

const decodePhoto = (dataUrl: string): DecodedPhoto => {
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

const isUrl = (s: string): boolean => /^https?:\/\//.test(s);

const stripTrailingSlash = (s: string): string => s.replace(/\/$/, '');

// Strip path separators and parent-dir traversal so a hostile fileName can't
// climb out of the configured prefix or collide with a different tenant.
const safeBaseName = (name: string): string => {
  const base = name.replace(/.*[\\/]/, '').replace(/\.{2,}/g, '.');
  return base || 'upload';
};

const stringConfig = (config: TwikooConfig, key: string): string | undefined => {
  const v = config[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

// ── NSFW pre-check ──

interface NsfwResult {
  rejected: boolean;
  message: string;
}

const checkNsfw = async (photo: string, config: TwikooConfig): Promise<NsfwResult> => {
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

// ── LskyPro (also used for `7bu` and URL-as-IMAGE_CDN) ──

interface LskyProResponse {
  status: boolean;
  message?: string;
  data?: { links?: { url?: string }; [key: string]: unknown };
}

const uploadToLskyPro = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
  imageCdn: string,
): Promise<UploadResult> => {
  const { blob } = decodePhoto(photo);
  const formData = new FormData();
  formData.append('file', blob, fileName);

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

// ── S.EE (former SM.MS) ──

interface SeeResponse {
  success: boolean;
  message?: string;
  data?: { url?: string; [key: string]: unknown };
}

const uploadToSee = async (
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

// ── PicList ──

interface PicListResponse {
  success: boolean;
  message?: string;
  result?: string[];
}

const uploadToPicList = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
  imageCdn: string,
): Promise<UploadResult> => {
  const { blob } = decodePhoto(photo);
  const formData = new FormData();
  formData.append('file', blob, fileName);

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

// ── EasyImage 2.0 ──

interface EasyImageResponse {
  code?: number;
  result?: string;
  url?: string;
  thumb?: string;
  del?: string;
  message?: string;
}

const uploadToEasyImage = async (
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

  const { blob } = decodePhoto(photo);
  const formData = new FormData();
  formData.append('token', token);
  formData.append('image', blob, fileName);

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

// ── Chevereto ──

interface CheveretoResponse {
  status_code?: number;
  image?: { url?: string; thumb?: { url?: string }; delete_url?: string };
  error?: { message?: string };
}

const uploadToChevereto = async (
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

  const { blob } = decodePhoto(photo);
  const formData = new FormData();
  formData.append('key', token);
  formData.append('source', blob, fileName);
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

// ── AWS S3 (also covers R2 / S3-compatible endpoints via S3_ENDPOINT) ──

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const sha256Hex = async (input: BufferSource): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', input);
  return bytesToHex(new Uint8Array(hash));
};

const hmacSha256 = async (key: BufferSource, data: string): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
};

const uploadToS3 = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
): Promise<UploadResult> => {
  const bucket = stringConfig(config, 'S3_BUCKET');
  const accessKeyId = stringConfig(config, 'S3_ACCESS_KEY_ID');
  const secretAccessKey = stringConfig(config, 'S3_SECRET_ACCESS_KEY');
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('未配置 S3 图床参数（S3_BUCKET、S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY）');
  }

  const { mimeType, bytes } = decodePhoto(photo);
  const region = stringConfig(config, 'S3_REGION') ?? 'us-east-1';
  const prefixRaw = stringConfig(config, 'S3_PATH_PREFIX');
  const prefix = prefixRaw ? `${stripTrailingSlash(prefixRaw)}/` : '';
  const key = `${prefix}${Date.now()}-${safeBaseName(fileName)}`;

  const customEndpoint = stringConfig(config, 'S3_ENDPOINT');
  const endpoint = customEndpoint
    ? `${stripTrailingSlash(customEndpoint)}/${bucket}/${key}`
    : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  const endpointUrl = new URL(endpoint);

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = `${now.toISOString().replace(/[:-]/g, '').slice(0, 15)}Z`;

  const payloadHash = await sha256Hex(bytes);
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders =
    [
      `content-type:${mimeType}`,
      `host:${endpointUrl.host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
    ].join('\n') + '\n';
  const canonicalRequest = [
    'PUT',
    endpointUrl.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n');

  const kSecret = new TextEncoder().encode(`AWS4${secretAccessKey}`);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, 's3');
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Authorization': authorization,
    },
    body: bytes,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`S3 上传失败: ${response.status} ${text || response.statusText}`);
  }

  const cdnUrl = stringConfig(config, 'S3_CDN_URL');
  const fileUrl = cdnUrl
    ? `${stripTrailingSlash(cdnUrl)}/${key}`
    : customEndpoint
      ? `${stripTrailingSlash(customEndpoint)}/${bucket}/${key}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  return { url: fileUrl };
};

// ── Cloudflare R2 (native binding, no signing) ──

const uploadToR2 = async (photo: string, fileName: string, env: R2Env): Promise<UploadResult> => {
  if (!env.R2 || !env.R2_PUBLIC_URL) {
    throw new Error('R2 binding 或 R2_PUBLIC_URL 未配置');
  }
  const { mimeType, bytes } = decodePhoto(photo);
  const key = `${Date.now()}-${safeBaseName(fileName)}`;
  await env.R2.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  return { url: `${stripTrailingSlash(env.R2_PUBLIC_URL)}/${key}` };
};

// ── Top-level dispatch (matches upstream's IMAGE_CDN routing, plus 'r2') ──

export const uploadImage = async (
  photo: string,
  fileName: string,
  config: TwikooConfig,
  env: R2Env,
): Promise<UploadResult> => {
  try {
    const imageService = stringConfig(config, 'IMAGE_CDN') ?? '';

    // Each branch validates its own credentials/binding requirements.
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
      return await uploadToLskyPro(photo, fileName, config, 'https://7bu.top');
    }
    if (imageService === 'see') {
      return await uploadToSee(photo, fileName, config, 'https://s.ee/api/v1/file/upload');
    }
    if (isUrl(imageService)) {
      return await uploadToLskyPro(photo, fileName, config, imageService);
    }
    if (imageService === 'lskypro') {
      return await uploadToLskyPro(
        photo,
        fileName,
        config,
        stringConfig(config, 'IMAGE_CDN_URL') ?? '',
      );
    }
    if (imageService === 'piclist') {
      return await uploadToPicList(
        photo,
        fileName,
        config,
        stringConfig(config, 'IMAGE_CDN_URL') ?? '',
      );
    }
    if (imageService === 'easyimage') {
      return await uploadToEasyImage(photo, fileName, config);
    }
    if (imageService === 'chevereto') {
      return await uploadToChevereto(photo, fileName, config);
    }
    if (imageService === 's3') {
      return await uploadToS3(photo, fileName, config);
    }
    if (imageService === 'r2') {
      return await uploadToR2(photo, fileName, env);
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
