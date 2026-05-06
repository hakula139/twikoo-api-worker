import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';

// Shape of a row in the `comment` table — matches schema.sql columns 1:1.
// `ups` / `downs` are JSON-stringified arrays of voter UIDs.
export interface StoredComment {
  _id: string;
  uid: string;
  nick: string;
  mail: string;
  mailMd5: string;
  link: string;
  ua: string;
  ip: string;
  ipRegion: string;
  master: number;
  url: string;
  href: string;
  comment: string;
  pid: string;
  rid: string;
  isSpam: number;
  created: number;
  updated: number;
  ups: string;
  downs: string;
  top: number;
  avatar: string;
}

export interface CounterRow {
  url: string;
  title: string;
  time: number;
  created: number;
  updated: number;
}

const SAVE_COMMENT_SQL = `
INSERT INTO comment (
  _id, uid, nick, mail, mailMd5, link, ua, ip, ipRegion, master,
  url, href, comment, pid, rid, isSpam, created, updated, ups, downs,
  top, avatar
) VALUES (
  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
  ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
  ?21, ?22
)
`.trim();

const REPLY_QUERY_TEMPLATE = `
SELECT * FROM comment
WHERE url = ?1 AND (isSpam != ?2 OR uid = ?3) AND rid IN ({{RIDS}})
`.trim();

const SET_COMMENT_TEMPLATE = `
UPDATE comment SET {{FIELDS}} WHERE _id = ?
`.trim();

// D1 access wrapper. Caches prepared statements inside the instance to amortise
// the per-statement parse cost across calls within a single request.
export class DB {
  private readonly stmts = new Map<string, D1PreparedStatement>();

  constructor(private readonly d1: D1Database) {}

  private stmt(key: string, sql: string): D1PreparedStatement {
    let cached = this.stmts.get(key);
    if (!cached) {
      cached = this.d1.prepare(sql);
      this.stmts.set(key, cached);
    }
    return cached;
  }

  // ── Config (single-row table) ──────────────────────────────────────────────

  async readConfig(): Promise<string> {
    const row = await this.stmt('readConfig', 'SELECT value FROM config LIMIT 1').first<{
      value: string;
    }>();
    return row?.value ?? '';
  }

  async writeConfig(value: string): Promise<void> {
    await this.stmt('writeConfig', 'UPDATE config SET value = ?1').bind(value).run();
  }

  // ── Comment reads ──────────────────────────────────────────────────────────

  async commentById(id: string): Promise<StoredComment | null> {
    return this.stmt('commentById', 'SELECT * FROM comment WHERE _id = ?1')
      .bind(id)
      .first<StoredComment>();
  }

  async commentCount(url: string, hideSpam: number, uid: string): Promise<number> {
    return (
      (await this.stmt(
        'commentCount',
        'SELECT COUNT(*) AS count FROM comment WHERE url = ?1 AND rid = "" AND (isSpam != ?2 OR uid = ?3)',
      )
        .bind(url, hideSpam, uid)
        .first<number>('count')) ?? 0
    );
  }

  async comments(
    url: string,
    hideSpam: number,
    uid: string,
    before: number,
    top: number,
    limit: number,
  ): Promise<StoredComment[]> {
    const { results } = await this.stmt(
      'comments',
      `
SELECT * FROM comment
WHERE url = ?1 AND (isSpam != ?2 OR uid = ?3) AND created < ?4 AND top = ?5 AND rid = ""
ORDER BY created DESC
LIMIT ?6
`.trim(),
    )
      .bind(url, hideSpam, uid, before, top, limit)
      .all<StoredComment>();
    return results;
  }

  async replies(
    url: string,
    hideSpam: number,
    uid: string,
    rids: string[],
  ): Promise<StoredComment[]> {
    if (rids.length === 0) {
      return [];
    }
    const key = `replies:${rids.length}`;
    const placeholders = Array.from({ length: rids.length }, () => '?').join(', ');
    const sql = REPLY_QUERY_TEMPLATE.replace('{{RIDS}}', placeholders);
    const { results } = await this.stmt(key, sql)
      .bind(url, hideSpam, uid, ...rids)
      .all<StoredComment>();
    return results;
  }

  async commentCountByUrl(url: string, includeReply: boolean): Promise<number> {
    return (
      (await this.stmt(
        'commentCountByUrl',
        'SELECT COUNT(*) AS count FROM comment WHERE url = ?1 AND NOT isSpam AND (?2 OR rid = "")',
      )
        .bind(url, includeReply ? 1 : 0)
        .first<number>('count')) ?? 0
    );
  }

  async recentCommentsByUrl(
    urlFilter: { all: boolean; url?: string },
    includeReply: boolean,
    limit: number,
  ): Promise<StoredComment[]> {
    const { results } = await this.stmt(
      'recentCommentsByUrl',
      `
SELECT * FROM comment
WHERE (?1 OR url = ?2) AND NOT isSpam AND (?3 OR rid = "")
LIMIT ?4
`.trim(),
    )
      .bind(urlFilter.all ? 1 : 0, urlFilter.url ?? '', includeReply ? 1 : 0, limit)
      .all<StoredComment>();
    return results;
  }

  async commentCountSince(since: number): Promise<number> {
    return (
      (await this.stmt(
        'commentCountSince',
        'SELECT COUNT(*) AS count FROM comment WHERE created > ?1',
      )
        .bind(since)
        .first<number>('count')) ?? 0
    );
  }

  async commentCountSinceByIp(since: number, ip: string): Promise<number> {
    return (
      (await this.stmt(
        'commentCountSinceByIp',
        'SELECT COUNT(*) AS count FROM comment WHERE created > ?1 AND ip = ?2',
      )
        .bind(since, ip)
        .first<number>('count')) ?? 0
    );
  }

  // ── Comment writes ─────────────────────────────────────────────────────────

  async saveComment(c: StoredComment): Promise<void> {
    await this.stmt('saveComment', SAVE_COMMENT_SQL)
      .bind(
        c._id,
        c.uid,
        c.nick,
        c.mail,
        c.mailMd5,
        c.link,
        c.ua,
        c.ip,
        c.ipRegion,
        c.master,
        c.url,
        c.href,
        c.comment,
        c.pid,
        c.rid,
        c.isSpam,
        c.created,
        c.updated,
        c.ups,
        c.downs,
        c.top,
        c.avatar,
      )
      .run();
  }

  async deleteComment(id: string): Promise<void> {
    await this.stmt('deleteComment', 'DELETE FROM comment WHERE _id = ?1').bind(id).run();
  }

  // A vote always rewrites both arrays — flipping up → down (or vice versa)
  // must remove the user from the opposite array, not just append to the new
  // one.
  async updateVotes(id: string, upsJson: string, downsJson: string): Promise<void> {
    await this.stmt('updateVotes', 'UPDATE comment SET ups = ?2, downs = ?3 WHERE _id = ?1')
      .bind(id, upsJson, downsJson)
      .run();
  }

  async updateIsSpam(id: string, isSpam: number, updated: number): Promise<void> {
    await this.stmt('updateIsSpam', 'UPDATE comment SET isSpam = ?2, updated = ?3 WHERE _id = ?1')
      .bind(id, isSpam, updated)
      .run();
  }

  // Dynamic-field UPDATE. The cache key sorts the field list so callers
  // passing the same fields in different orders share one prepared statement.
  async setCommentFields(
    id: string,
    fields: readonly string[],
    values: readonly unknown[],
  ): Promise<void> {
    const key = `setComment:${[...fields].sort().join(',')}`;
    const sql = SET_COMMENT_TEMPLATE.replace(
      '{{FIELDS}}',
      fields.map((f) => `${f} = ?`).join(', '),
    );
    await this.stmt(key, sql)
      .bind(...values, id)
      .run();
  }

  // ── Admin views & export ───────────────────────────────────────────────────

  async commentCountForAdmin(spamFilter: number, keyword: string): Promise<number> {
    return (
      (await this.stmt(
        'commentCountForAdmin',
        `
SELECT COUNT(*) AS count FROM comment
WHERE isSpam != ?1
  AND (nick LIKE ?2 OR mail LIKE ?2 OR link LIKE ?2 OR ip LIKE ?2
       OR comment LIKE ?2 OR url LIKE ?2 OR href LIKE ?2)
`.trim(),
      )
        .bind(spamFilter, keyword)
        .first<number>('count')) ?? 0
    );
  }

  async commentsForAdmin(
    spamFilter: number,
    keyword: string,
    limit: number,
    offset: number,
  ): Promise<StoredComment[]> {
    const { results } = await this.stmt(
      'commentsForAdmin',
      `
SELECT * FROM comment
WHERE isSpam != ?1
  AND (nick LIKE ?2 OR mail LIKE ?2 OR link LIKE ?2 OR ip LIKE ?2
       OR comment LIKE ?2 OR url LIKE ?2 OR href LIKE ?2)
ORDER BY created DESC
LIMIT ?3 OFFSET ?4
`.trim(),
    )
      .bind(spamFilter, keyword, limit, offset)
      .all<StoredComment>();
    return results;
  }

  async exportComments(): Promise<StoredComment[]> {
    const { results } = await this.stmt(
      'exportComments',
      'SELECT * FROM comment',
    ).all<StoredComment>();
    return results;
  }

  // ── Counter table ──────────────────────────────────────────────────────────

  async incrementCounter(url: string, title: string, ts: number): Promise<D1Result> {
    return this.stmt(
      'incrementCounter',
      `
INSERT INTO counter VALUES (?1, ?2, 1, ?3, ?3)
ON CONFLICT (url) DO UPDATE SET time = time + 1, title = ?2, updated = ?3
`.trim(),
    )
      .bind(url, title, ts)
      .run();
  }

  async counterTime(url: string): Promise<number> {
    return (
      (await this.stmt('counterTime', 'SELECT time FROM counter WHERE url = ?1')
        .bind(url)
        .first<number>('time')) ?? 0
    );
  }
}
