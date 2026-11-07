import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { BatchItem } from 'drizzle-orm/batch';

import type { SQL } from 'drizzle-orm';

import type { CommentId } from '../types';
import type { Bit, Comment, NewComment } from './schema';

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  lt,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { ResponseCode, TwikooError } from '../lib/errors';
import { collectUploadReferences } from '../lib/image-upload/references';
import { comment, commentUpload, upload } from './schema';
import { UPLOAD_GRACE_MS } from './upload';

export type CommentSort = 'newest' | 'oldest' | 'popular';

const visibility = (showAll: boolean, uid: string) =>
  showAll ? undefined : or(eq(comment.isSpam, 0), uid ? eq(comment.uid, uid) : undefined);

// Bind each string list once to stay within D1's 100-parameter limit.
const stringListValues = (values: string[]): SQL =>
  sql`(SELECT value FROM json_each(${JSON.stringify(values)}))`;

// `ups` is stored as a JSON array of voter UIDs (not a count), so popular sort
// goes through `json_array_length`. Tiebreak on `created desc` for stability.
const orderClause = (sort: CommentSort): SQL[] => {
  if (sort === 'oldest') {
    return [asc(comment.created)];
  }

  if (sort === 'popular') {
    return [sql`json_array_length(${comment.ups}) desc`, desc(comment.created)];
  }

  return [desc(comment.created)];
};

export const createCommentDb = (db: DrizzleD1Database, publicUrl: string) => {
  const releaseReferences = (id: CommentId) => {
    const other = alias(commentUpload, 'other_reference');

    return db
      .update(upload)
      .set({ deleteAfter: Date.now() + UPLOAD_GRACE_MS })
      .where(
        and(
          inArray(
            upload.key,
            db
              .select({ key: commentUpload.uploadKey })
              .from(commentUpload)
              .where(eq(commentUpload.commentId, id)),
          ),
          notExists(
            db
              .select({ key: other.uploadKey })
              .from(other)
              .where(and(eq(other.uploadKey, upload.key), ne(other.commentId, id))),
          ),
        ),
      );
  };

  const referenceQueries = (id: CommentId, keys: string[]): BatchItem<'sqlite'>[] => [
    db.insert(commentUpload).select(
      db
        .select({
          commentId: sql<CommentId>`${id}`.as('comment_id'),
          uploadKey: upload.key,
          deleting: sql<Bit>`0`.as('deleting'),
        })
        .from(upload)
        .where(
          and(
            inArray(upload.key, stringListValues(keys)),
            exists(db.select({ id: comment._id }).from(comment).where(eq(comment._id, id))),
          ),
        ),
    ),
    db
      .update(upload)
      .set({ deleteAfter: null })
      .where(
        inArray(
          upload.key,
          db
            .select({ key: commentUpload.uploadKey })
            .from(commentUpload)
            .where(eq(commentUpload.commentId, id)),
        ),
      ),
  ];

  const mutate = async (
    queries: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
    keys: string[],
  ) => {
    try {
      await db.batch(queries);
    } catch (error) {
      let cause: unknown = error;
      while (cause instanceof Error) {
        if (keys.length > 0 && cause.message.includes('FOREIGN KEY constraint failed')) {
          throw new TwikooError(
            ResponseCode.UPLOAD_FAILED,
            'An image has expired. Please upload it again.',
          );
        }

        cause = cause.cause;
      }

      throw error;
    }
  };

  return {
    // ── Reads ──

    async byId(id: CommentId): Promise<Comment | undefined> {
      const [row] = await db.select().from(comment).where(eq(comment._id, id)).limit(1);

      return row;
    },

    async count(urls: string[], showAll: boolean, uid: string): Promise<number> {
      if (urls.length === 0) {
        return 0;
      }

      const [row] = await db
        .select({ count: count() })
        .from(comment)
        .where(and(inArray(comment.url, urls), eq(comment.rid, ''), visibility(showAll, uid)));

      return row?.count ?? 0;
    },

    async list(
      urls: string[],
      showAll: boolean,
      uid: string,
      before: number,
      top: Bit,
      limit: number,
      sort: CommentSort = 'newest',
    ): Promise<Comment[]> {
      if (urls.length === 0) {
        return [];
      }

      return db
        .select()
        .from(comment)
        .where(
          and(
            inArray(comment.url, urls),
            visibility(showAll, uid),
            lt(comment.created, before),
            eq(comment.top, top),
            eq(comment.rid, ''),
          ),
        )
        .orderBy(...orderClause(sort))
        .limit(limit);
    },

    async replies(
      urls: string[],
      showAll: boolean,
      uid: string,
      rids: string[],
    ): Promise<Comment[]> {
      if (rids.length === 0 || urls.length === 0) {
        return [];
      }

      return db
        .select()
        .from(comment)
        .where(
          and(
            inArray(comment.url, urls),
            visibility(showAll, uid),
            inArray(comment.rid, stringListValues(rids)),
          ),
        );
    },

    async countByUrls(urls: string[], includeReply: boolean): Promise<Map<string, number>> {
      if (urls.length === 0) {
        return new Map();
      }

      const rows = await db
        .select({ url: comment.url, count: count() })
        .from(comment)
        .where(
          and(
            inArray(comment.url, stringListValues(urls)),
            eq(comment.isSpam, 0),
            includeReply ? undefined : eq(comment.rid, ''),
          ),
        )
        .groupBy(comment.url);

      return new Map(rows.map((r) => [r.url, r.count]));
    },

    async recent(
      urls: string[] | undefined,
      includeReply: boolean,
      limit: number,
    ): Promise<Comment[]> {
      return db
        .select()
        .from(comment)
        .where(
          and(
            urls?.length ? inArray(comment.url, stringListValues(urls)) : undefined,
            eq(comment.isSpam, 0),
            includeReply ? undefined : eq(comment.rid, ''),
          ),
        )
        .orderBy(desc(comment.created))
        .limit(limit);
    },

    async countSince(since: number): Promise<number> {
      const [row] = await db
        .select({ count: count() })
        .from(comment)
        .where(gt(comment.created, since));

      return row?.count ?? 0;
    },

    async countSinceByIp(since: number, ip: string): Promise<number> {
      const [row] = await db
        .select({ count: count() })
        .from(comment)
        .where(and(gt(comment.created, since), eq(comment.ip, ip)));

      return row?.count ?? 0;
    },

    // ── Writes ──

    async save(c: NewComment): Promise<void> {
      const keys = [...(await collectUploadReferences(c.comment, publicUrl))];
      await mutate([db.insert(comment).values(c), ...referenceQueries(c._id, keys)], keys);
    },

    // D1 caps each statement at 100 bound parameters. Schema currently has
    // 22 columns, so 4 rows per chunk = 88 binds. Bump down to 3 if the row
    // grows past 25 columns or D1 lowers the cap.
    async saveMany(rows: NewComment[]): Promise<void> {
      if (rows.length === 0) {
        return;
      }

      const CHUNK = 4;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const keys = await Promise.all(
          chunk.map(async (row) => [...(await collectUploadReferences(row.comment, publicUrl))]),
        );
        await mutate(
          [
            db.insert(comment).values(chunk),
            ...chunk.flatMap((row, index) => referenceQueries(row._id, keys[index])),
          ],
          keys.flat(),
        );
      }
    },

    async delete(id: CommentId): Promise<void> {
      await db.batch([releaseReferences(id), db.delete(comment).where(eq(comment._id, id))]);
    },

    // Atomic toggle in pure SQL since concurrent voters racing through
    // read-modify-write would lose each other. Returns false if no row matched.
    async toggleVote(id: CommentId, uid: string, type: 'up' | 'down'): Promise<boolean> {
      const target = type === 'up' ? comment.ups : comment.downs;
      const opposite = type === 'up' ? comment.downs : comment.ups;
      const result = await db.run(sql`
      UPDATE ${comment} SET
        ${sql.raw(target.name)} = IIF(
          EXISTS (SELECT 1 FROM json_each(${target}) WHERE value = ${uid}),
          IFNULL((SELECT json_group_array(value) FROM json_each(${target}) WHERE value != ${uid}), '[]'),
          json_insert(${target}, '$[#]', ${uid})
        ),
        ${sql.raw(opposite.name)} = IIF(
          EXISTS (SELECT 1 FROM json_each(${target}) WHERE value = ${uid}),
          ${opposite},
          IFNULL((SELECT json_group_array(value) FROM json_each(${opposite}) WHERE value != ${uid}), '[]')
        )
      WHERE ${comment._id} = ${id}
    `);

      return result.meta.changes > 0;
    },

    async updateSpam(id: CommentId, isSpam: Bit, updated: number): Promise<void> {
      await db.update(comment).set({ isSpam, updated }).where(eq(comment._id, id));
    },

    async update(id: CommentId, fields: Partial<NewComment>): Promise<void> {
      if (fields.comment === undefined) {
        await db.update(comment).set(fields).where(eq(comment._id, id));
        return;
      }

      const keys = [...(await collectUploadReferences(fields.comment, publicUrl))];
      await mutate(
        [
          releaseReferences(id),
          db.update(comment).set(fields).where(eq(comment._id, id)),
          db.delete(commentUpload).where(eq(commentUpload.commentId, id)),
          ...referenceQueries(id, keys),
        ],
        keys,
      );
    },

    // ── Admin views & export ──

    async countForAdmin(filter: AdminFilter): Promise<number> {
      const [row] = await db.select({ count: count() }).from(comment).where(adminWhere(filter));

      return row?.count ?? 0;
    },

    async listForAdmin(
      filter: AdminFilter,
      limit: number,
      offset: number,
      sort: CommentSort = 'newest',
    ): Promise<Comment[]> {
      return db
        .select()
        .from(comment)
        .where(adminWhere(filter))
        .orderBy(...orderClause(sort))
        .limit(limit)
        .offset(offset);
    },

    async exportAll(): Promise<Comment[]> {
      return db.select().from(comment);
    },
  };
};

export type CommentDB = ReturnType<typeof createCommentDb>;

export interface AdminFilter {
  isSpam?: Bit;
  keyword?: string;
}

const adminWhere = (filter: AdminFilter): SQL | undefined =>
  and(
    filter.isSpam !== undefined ? eq(comment.isSpam, filter.isSpam) : undefined,
    filter.keyword ? adminKeywordFilter(filter.keyword) : undefined,
  );

// ESCAPE makes LIKE metacharacters literal in admin search.
const adminKeywordFilter = (
  keyword: string,
): SQL => sql`(${comment.nick} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.mail} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.link} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.ip} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.comment} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.url} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.href} LIKE ${keyword} ESCAPE '\\')`;
