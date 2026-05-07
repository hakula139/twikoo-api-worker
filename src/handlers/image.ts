import type { Handler } from '../types';

import { uploadImage } from '../lib/image-upload';
import { validate } from '../twikoo';

export const imageUpload: Handler = async (payload, ctx) => {
  validate(payload, ['photo', 'fileName']);

  const data = await uploadImage(
    payload.photo as string,
    payload.fileName as string,
    ctx.config,
    ctx.env,
  );
  return { data };
};
