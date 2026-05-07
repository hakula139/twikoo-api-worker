import type { DrizzleD1Database } from 'drizzle-orm/d1';

import type { SQL } from 'drizzle-orm';

import { and, asc, count, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';

import { type Bit, type Comment, type NewComment, comment } from './schema';

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

  async byId(id: string): Promise<Comment | undefined> {
    const [row] = await this.db.select().from(comment).where(eq(comment._id, id)).limit(1);
    return row;
  }

  async count(url: string, showAll: boolean, uid: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(comment)
      .where(and(eq(comment.url, url), eq(comment.rid, ''), visibility(showAll, uid)));
    return row?.count ?? 0;
  }

  async list(
    url: string,
    showAll: boolean,
    uid: string,
    before: number,
    top: Bit,
    limit: number,
    sort: CommentSort = 'newest',
  ): Promise<Comment[]> {
    return this.db
      .select()
      .from(comment)
      .where(
        and(
          eq(comment.url, url),
          visibility(showAll, uid),
          lt(comment.created, before),
          eq(comment.top, top),
          eq(comment.rid, ''),
        ),
      )
      .orderBy(...orderClause(sort))
      .limit(limit);
  }

  async replies(url: string, showAll: boolean, uid: string, rids: string[]): Promise<Comment[]> {
    if (rids.length === 0) {
      return [];
    }
    return this.db
      .select()
      .from(comment)
      .where(and(eq(comment.url, url), visibility(showAll, uid), inArray(comment.rid, rids)));
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

  async delete(id: string): Promise<void> {
    await this.db.delete(comment).where(eq(comment._id, id));
  }

  // Caller passes the full ups / downs JSON; this method does not merge.
  async updateVotes(id: string, upsJson: string, downsJson: string): Promise<void> {
    await this.db
      .update(comment)
      .set({ ups: upsJson, downs: downsJson })
      .where(eq(comment._id, id));
  }

  async updateSpam(id: string, isSpam: Bit, updated: number): Promise<void> {
    await this.db.update(comment).set({ isSpam, updated }).where(eq(comment._id, id));
  }

  async update(id: string, fields: Partial<NewComment>): Promise<void> {
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
  // Already wrapped in `%foo%` if a substring match is desired.
  keyword?: string;
}

const adminWhere = (filter: AdminFilter): SQL | undefined =>
  and(
    filter.isSpam !== undefined ? eq(comment.isSpam, filter.isSpam) : undefined,
    filter.keyword ? adminKeywordFilter(filter.keyword) : undefined,
  );

// Single bind across seven LIKE columns; builder chains would re-bind.
const adminKeywordFilter = (keyword: string): SQL => sql`(${comment.nick} LIKE ${keyword}
  OR ${comment.mail} LIKE ${keyword}
  OR ${comment.link} LIKE ${keyword}
  OR ${comment.ip} LIKE ${keyword}
  OR ${comment.comment} LIKE ${keyword}
  OR ${comment.url} LIKE ${keyword}
  OR ${comment.href} LIKE ${keyword})`;
