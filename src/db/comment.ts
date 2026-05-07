import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { and, count, desc, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm';

import { type Bit, type Comment, type NewComment, comment } from './schema';

export type { Bit, Comment, NewComment } from './schema';

// `showAll` lets admin views see every row; otherwise only non-spam OR own comments.
const visibility = (showAll: boolean, uid: string) =>
  showAll ? undefined : or(eq(comment.isSpam, 0), eq(comment.uid, uid));

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
      .orderBy(desc(comment.created))
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

  async countByUrl(url: string, includeReply: boolean): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(comment)
      .where(
        and(
          eq(comment.url, url),
          eq(comment.isSpam, 0),
          includeReply ? undefined : eq(comment.rid, ''),
        ),
      );
    return row?.count ?? 0;
  }

  async recentByUrl(
    urlFilter: { all: boolean; url?: string },
    includeReply: boolean,
    limit: number,
  ): Promise<Comment[]> {
    return this.db
      .select()
      .from(comment)
      .where(
        and(
          urlFilter.all ? undefined : eq(comment.url, urlFilter.url ?? ''),
          eq(comment.isSpam, 0),
          includeReply ? undefined : eq(comment.rid, ''),
        ),
      )
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

  async countForAdmin(spamFilter: Bit, keyword: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(comment)
      .where(and(ne(comment.isSpam, spamFilter), this.adminKeywordFilter(keyword)));
    return row?.count ?? 0;
  }

  async listForAdmin(
    spamFilter: Bit,
    keyword: string,
    limit: number,
    offset: number,
  ): Promise<Comment[]> {
    return this.db
      .select()
      .from(comment)
      .where(and(ne(comment.isSpam, spamFilter), this.adminKeywordFilter(keyword)))
      .orderBy(desc(comment.created))
      .limit(limit)
      .offset(offset);
  }

  async exportAll(): Promise<Comment[]> {
    return this.db.select().from(comment);
  }

  // Single bind across seven LIKE columns; builder chains would re-bind.
  private adminKeywordFilter(keyword: string) {
    return sql`(${comment.nick} LIKE ${keyword}
      OR ${comment.mail} LIKE ${keyword}
      OR ${comment.link} LIKE ${keyword}
      OR ${comment.ip} LIKE ${keyword}
      OR ${comment.comment} LIKE ${keyword}
      OR ${comment.url} LIKE ${keyword}
      OR ${comment.href} LIKE ${keyword})`;
  }
}
