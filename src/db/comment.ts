import { DBBase } from './base';

// SQLite has no boolean type; 0/1 columns ride on INTEGER. `Bit` is a
// compile-time refinement so `isSpam: 7` fails before it reaches the DB.
export type Bit = 0 | 1;

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
  master: Bit;
  url: string;
  href: string;
  comment: string;
  pid: string;
  rid: string;
  isSpam: Bit;
  created: number;
  updated: number;
  ups: string;
  downs: string;
  top: Bit;
  avatar: string;
}

const SAVE_SQL = `
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

const REPLIES_TEMPLATE = `
SELECT * FROM comment
WHERE url = ?1 AND (isSpam != ?2 OR uid = ?3) AND rid IN ({{RIDS}})
`.trim();

const UPDATE_TEMPLATE = `
UPDATE comment SET {{FIELDS}} WHERE _id = ?
`.trim();

export class CommentDB extends DBBase {
  // ── Reads ──

  async byId(id: string): Promise<StoredComment | null> {
    return this.stmt('byId', 'SELECT * FROM comment WHERE _id = ?1')
      .bind(id)
      .first<StoredComment>();
  }

  async count(url: string, hideSpam: Bit, uid: string): Promise<number> {
    return (
      (await this.stmt(
        'count',
        'SELECT COUNT(*) AS count FROM comment WHERE url = ?1 AND rid = "" AND (isSpam != ?2 OR uid = ?3)',
      )
        .bind(url, hideSpam, uid)
        .first<number>('count')) ?? 0
    );
  }

  async list(
    url: string,
    hideSpam: Bit,
    uid: string,
    before: number,
    top: Bit,
    limit: number,
  ): Promise<StoredComment[]> {
    const { results } = await this.stmt(
      'list',
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

  async replies(url: string, hideSpam: Bit, uid: string, rids: string[]): Promise<StoredComment[]> {
    if (rids.length === 0) {
      return [];
    }

    const key = `replies:${rids.length}`;
    const placeholders = Array.from({ length: rids.length }, () => '?').join(', ');
    const sql = REPLIES_TEMPLATE.replace('{{RIDS}}', placeholders);

    const { results } = await this.stmt(key, sql)
      .bind(url, hideSpam, uid, ...rids)
      .all<StoredComment>();
    return results;
  }

  async countByUrl(url: string, includeReply: boolean): Promise<number> {
    return (
      (await this.stmt(
        'countByUrl',
        'SELECT COUNT(*) AS count FROM comment WHERE url = ?1 AND NOT isSpam AND (?2 OR rid = "")',
      )
        .bind(url, includeReply ? 1 : 0)
        .first<number>('count')) ?? 0
    );
  }

  async recentByUrl(
    urlFilter: { all: boolean; url?: string },
    includeReply: boolean,
    limit: number,
  ): Promise<StoredComment[]> {
    const { results } = await this.stmt(
      'recentByUrl',
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

  async countSince(since: number): Promise<number> {
    return (
      (await this.stmt('countSince', 'SELECT COUNT(*) AS count FROM comment WHERE created > ?1')
        .bind(since)
        .first<number>('count')) ?? 0
    );
  }

  async countSinceByIp(since: number, ip: string): Promise<number> {
    return (
      (await this.stmt(
        'countSinceByIp',
        'SELECT COUNT(*) AS count FROM comment WHERE created > ?1 AND ip = ?2',
      )
        .bind(since, ip)
        .first<number>('count')) ?? 0
    );
  }

  // ── Writes ──

  async save(c: StoredComment): Promise<void> {
    await this.stmt('save', SAVE_SQL)
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

  async delete(id: string): Promise<void> {
    await this.stmt('delete', 'DELETE FROM comment WHERE _id = ?1').bind(id).run();
  }

  // Caller passes the full ups / downs JSON; this method does not merge.
  async updateVotes(id: string, upsJson: string, downsJson: string): Promise<void> {
    await this.stmt('updateVotes', 'UPDATE comment SET ups = ?2, downs = ?3 WHERE _id = ?1')
      .bind(id, upsJson, downsJson)
      .run();
  }

  async updateSpam(id: string, isSpam: Bit, updated: number): Promise<void> {
    await this.stmt('updateSpam', 'UPDATE comment SET isSpam = ?2, updated = ?3 WHERE _id = ?1')
      .bind(id, isSpam, updated)
      .run();
  }

  // Dynamic-field UPDATE. Cache key mirrors the field order so the cached
  // SQL placeholders line up with the caller's `values` array.
  async update(id: string, fields: readonly string[], values: readonly unknown[]): Promise<void> {
    const key = `update:${fields.join(',')}`;
    const sql = UPDATE_TEMPLATE.replace('{{FIELDS}}', fields.map((f) => `${f} = ?`).join(', '));

    await this.stmt(key, sql)
      .bind(...values, id)
      .run();
  }

  // ── Admin views & export ──

  async countForAdmin(spamFilter: Bit, keyword: string): Promise<number> {
    return (
      (await this.stmt(
        'countForAdmin',
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

  async listForAdmin(
    spamFilter: Bit,
    keyword: string,
    limit: number,
    offset: number,
  ): Promise<StoredComment[]> {
    const { results } = await this.stmt(
      'listForAdmin',
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

  async exportAll(): Promise<StoredComment[]> {
    const { results } = await this.stmt('exportAll', 'SELECT * FROM comment').all<StoredComment>();
    return results;
  }
}
