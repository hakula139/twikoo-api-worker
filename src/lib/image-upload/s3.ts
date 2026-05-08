import type { TwikooConfig } from '@/types';

import type { UploadResult } from './types';

import { stringConfig } from '../config-read';
import { decodePhoto, safeBaseName, stripTrailingSlash } from './helpers';

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

// AWS S3 (also covers R2 / S3-compatible endpoints via S3_ENDPOINT).
export const uploadS3 = async (
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
  let fileUrl: string;
  if (cdnUrl) {
    fileUrl = `${stripTrailingSlash(cdnUrl)}/${key}`;
  } else if (customEndpoint) {
    fileUrl = `${stripTrailingSlash(customEndpoint)}/${bucket}/${key}`;
  } else {
    fileUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }
  return { url: fileUrl };
};
