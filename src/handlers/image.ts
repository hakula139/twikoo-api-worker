import type { Handler } from '../types';

import { ResponseCode, TwikooError } from '../lib/errors';
import { validate } from '../twikoo';

interface PicListResponse {
  success: boolean;
  result?: string[];
  message?: string;
}

// Twikoo widget posts `photo` as a `data:<mime>;base64,<...>` URL. Workers has
// no `fs` / Node `FormData`, so decode to a Web Blob and post via Web FormData.
const dataUrlToBlob = (dataUrl: string): Blob => {
  const [meta, base64] = dataUrl.split(';base64,');
  if (!base64) {
    throw new TwikooError(ResponseCode.UPLOAD_FAILED, 'photo must be a base64 data URL');
  }
  const mimeType = meta.replace(/^data:/, '') || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
};

// PicList proxy. R2 storage is provisioned but unused — see the upload+mail PR
// notes; consolidating to a direct R2 PUT is a future cleanup.
export const imageUpload: Handler = async (payload, ctx) => {
  validate(payload, ['photo', 'fileName']);

  const cdnService = (ctx.config.IMAGE_CDN as string | undefined) ?? '';
  if (cdnService !== 'piclist') {
    throw new TwikooError(
      ResponseCode.UPLOAD_FAILED,
      `IMAGE_CDN="${cdnService}" is not supported (only "piclist" is wired up)`,
    );
  }
  const cdnUrl = ctx.config.IMAGE_CDN_URL as string | undefined;
  if (!cdnUrl) {
    throw new TwikooError(ResponseCode.UPLOAD_FAILED, 'IMAGE_CDN_URL is not configured');
  }
  const cdnToken = ctx.config.IMAGE_CDN_TOKEN as string | undefined;

  const photo = payload.photo as string;
  const fileName = payload.fileName as string;

  const formData = new FormData();
  formData.append('file', dataUrlToBlob(photo), fileName);

  const url = cdnToken
    ? `${cdnUrl}/upload?key=${encodeURIComponent(cdnToken)}`
    : `${cdnUrl}/upload`;
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    throw new TwikooError(
      ResponseCode.UPLOAD_FAILED,
      `PicList returned ${response.status} ${response.statusText}`,
    );
  }

  const data: PicListResponse = await response.json();
  if (!data.success || !data.result?.[0]) {
    throw new TwikooError(ResponseCode.UPLOAD_FAILED, data.message ?? 'PicList upload failed');
  }
  return { data: { ...data, url: data.result[0] } };
};
