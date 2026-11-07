import type { Env } from '../../types';

import { drizzle } from 'drizzle-orm/d1';

import { createUploadDb } from '../../db/upload';

export const collectUnusedUploads = async (env: Env, scheduledTime: number) => {
  const uploads = createUploadDb(drizzle(env.DB));
  const keys = await uploads.claimDue(scheduledTime);
  if (keys.length > 0) {
    await env.R2.delete(keys);
    await uploads.complete(keys);
  }

  return { deleted: keys.length };
};
