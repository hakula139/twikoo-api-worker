import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { and, asc, eq, inArray, isNotNull, lt, notExists, sql } from 'drizzle-orm';

import { commentUpload, upload } from './schema';

export const UPLOAD_GRACE_MS = 3_600_000;

export const createUploadDb = (db: DrizzleD1Database) => ({
  async register(key: string, now: number): Promise<void> {
    await db.insert(upload).values({ key, deleteAfter: now + UPLOAD_GRACE_MS });
  },

  async claimDue(now: number): Promise<string[]> {
    const due = db
      .select({ key: upload.key })
      .from(upload)
      .where(
        and(
          isNotNull(upload.deleteAfter),
          lt(upload.deleteAfter, now),
          notExists(
            db
              .select({ key: commentUpload.uploadKey })
              .from(commentUpload)
              .where(eq(commentUpload.uploadKey, upload.key)),
          ),
        ),
      )
      .orderBy(asc(upload.deleteAfter), asc(upload.key))
      .limit(100);
    const rows = await db
      .update(upload)
      .set({ deleting: 1 })
      .where(inArray(upload.key, due))
      .returning({ key: upload.key });

    return rows.map((row) => row.key);
  },

  async complete(keys: string[]): Promise<void> {
    await db
      .delete(upload)
      .where(
        and(
          eq(upload.deleting, 1),
          inArray(upload.key, sql`(SELECT value FROM json_each(${JSON.stringify(keys)}))`),
        ),
      );
  },
});
