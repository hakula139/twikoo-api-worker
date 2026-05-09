import type { DrizzleD1Database } from 'drizzle-orm/d1';

import type { SQL } from 'drizzle-orm';

import type { CommentId } from '../types';
import type { Bit, Comment, NewComment } from './schema';

import { and, asc, count, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';

import { comment } from './schema';

export type { Bit, Comment, NewComment } from './schema';

export type CommentSort = 'newest' | 'oldest' | 'popular';

// `showAll` lets admin views see every row; otherwise only non-spam OR own comments.
const visibility = (showAll: boolean, uid: string) =>
  showAll ? undefined : or(eq(comment.isSpam, 0), eq(comment.uid, uid));

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

export class CommentDB {
  constructor(private readonly db: DrizzleD1Database) {}

  // ── Reads ──

  async byId(id: CommentId): Promise<Comment | undefined> {
    const [row] = await this.db.select().from(comment).where(eq(comment._id, id)).limit(1);
    return row;
  }

  async count(urls: string[], showAll: boolean, uid: string): Promise<number> {
    if (urls.length === 0) {
      return 0;
    }
    const [row] = await this.db
      .select({ count: count() })
      .from(comment)
      .where(and(inArray(comment.url, urls), eq(comment.rid, ''), visibility(showAll, uid)));
    return row?.count ?? 0;
  }

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
    return this.db
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
  }

  async replies(urls: string[], showAll: boolean, uid: string, rids: string[]): Promise<Comment[]> {
    if (rids.length === 0 || urls.length === 0) {
      return [];
    }
    return this.db
      .select()
      .from(comment)
      .where(and(inArray(comment.url, urls), visibility(showAll, uid), inArray(comment.rid, rids)));
  }

  // Returns a `url → count` map; callers fan out url variants via `getUrlsQuery`
  // and collapse the variant counts back per requested url.
  async countByUrls(urls: string[], includeReply: boolean): Promise<Map<string, number>> {
    if (urls.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ url: comment.url, count: count() })
      .from(comment)
      .where(
        and(
          inArray(comment.url, urls),
          eq(comment.isSpam, 0),
          includeReply ? undefined : eq(comment.rid, ''),
        ),
      )
      .groupBy(comment.url);
    return new Map(rows.map((r) => [r.url, r.count]));
  }

  async recent(
    urls: string[] | undefined,
    includeReply: boolean,
    limit: number,
  ): Promise<Comment[]> {
    return this.db
      .select()
      .from(comment)
      .where(
        and(
          urls?.length ? inArray(comment.url, urls) : undefined,
          eq(comment.isSpam, 0),
          includeReply ? undefined : eq(comment.rid, ''),
        ),
      )
      .orderBy(desc(comment.created))
      .limit(limit);
  }

  async countSince(since: number): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(comment)
      .where(gt(comment.created, since));
    return row?.count ?? 0;
  }

  async countSinceByIp(since: number, ip: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(comment)
      .where(and(gt(comment.created, since), eq(comment.ip, ip)));
    return row?.count ?? 0;
  }

  // ── Writes ──

  async save(c: NewComment): Promise<void> {
    await this.db.insert(comment).values(c);
  }

  // Drizzle binds ~23 placeholders per row. SQLite caps at 999 per statement,
  // so chunk well under that to keep headroom for any future column.
  async saveMany(rows: NewComment[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const CHUNK = 25;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await this.db.insert(comment).values(rows.slice(i, i + CHUNK));
    }
  }

  async delete(id: CommentId): Promise<void> {
    await this.db.delete(comment).where(eq(comment._id, id));
  }

  // Atomic toggle: a fresh `up` retracts any prior `down` (and vice versa);
  // voting the same direction twice retracts that vote. Pure SQL because two
  // concurrent voters racing through read-modify-write would lose each other.
  // Returns false if no row matched.
  async toggleVote(id: CommentId, uid: string, type: 'up' | 'down'): Promise<boolean> {
    const target = type === 'up' ? comment.ups : comment.downs;
    const opposite = type === 'up' ? comment.downs : comment.ups;
    const result = await this.db.run(sql`
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
  }

  async updateSpam(id: CommentId, isSpam: Bit, updated: number): Promise<void> {
    await this.db.update(comment).set({ isSpam, updated }).where(eq(comment._id, id));
  }

  async update(id: CommentId, fields: Partial<NewComment>): Promise<void> {
    await this.db.update(comment).set(fields).where(eq(comment._id, id));
  }

  // ── Admin views & export ──

  async countForAdmin(filter: AdminFilter): Promise<number> {
    const [row] = await this.db.select({ count: count() }).from(comment).where(adminWhere(filter));
    return row?.count ?? 0;
  }

  async listForAdmin(filter: AdminFilter, limit: number, offset: number): Promise<Comment[]> {
    return this.db
      .select()
      .from(comment)
      .where(adminWhere(filter))
      .orderBy(desc(comment.created))
      .limit(limit)
      .offset(offset);
  }

  async exportAll(): Promise<Comment[]> {
    return this.db.select().from(comment);
  }
}

export interface AdminFilter {
  isSpam?: Bit;
  keyword?: string;
}

const adminWhere = (filter: AdminFilter): SQL | undefined =>
  and(
    filter.isSpam !== undefined ? eq(comment.isSpam, filter.isSpam) : undefined,
    filter.keyword ? adminKeywordFilter(filter.keyword) : undefined,
  );

// Single bind across seven LIKE columns; builder chains would re-bind. The
// ESCAPE clause makes `_` `%` `\` literal — admins searching for `foo_bar`
// or `50%` see exact matches instead of wildcard expansions.
const adminKeywordFilter = (
  keyword: string,
): SQL => sql`(${comment.nick} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.mail} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.link} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.ip} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.comment} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.url} LIKE ${keyword} ESCAPE '\\'
  OR ${comment.href} LIKE ${keyword} ESCAPE '\\')`;
