import type { Handler } from '@/types';

import { uploadImage } from '@/lib/image-upload';
import { validate } from '@/twikoo';

export const imageUpload: Handler<'UPLOAD_IMAGE'> = async (payload, ctx) => {
  validate(payload, ['photo', 'fileName']);

  const data = await uploadImage(payload.photo, payload.fileName, ctx.config, ctx.env);
  return { data };
};
