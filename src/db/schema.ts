import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// SQLite has no boolean type; 0/1 columns ride on INTEGER. `Bit` is a
// compile-time refinement so `isSpam: 7` fails before it reaches the DB.
export type Bit = 0 | 1;

// `ups` / `downs` are JSON-stringified arrays of voter UIDs. Keep as `text`
// at the storage boundary; callers parse / serialize.
export const comment = sqliteTable(
  'comment',
  {
    _id: text('_id').notNull(),
    uid: text('uid').notNull(),
    nick: text('nick').notNull(),
    mail: text('mail').notNull(),
    mailMd5: text('mailMd5').notNull(),
    link: text('link').notNull(),
    ua: text('ua').notNull(),
    ip: text('ip').notNull(),
    ipRegion: text('ipRegion').notNull().default(''),
    master: integer('master').notNull().$type<Bit>(),
    url: text('url').notNull(),
    href: text('href').notNull(),
    comment: text('comment').notNull(),
    pid: text('pid').notNull(),
    rid: text('rid').notNull(),
    isSpam: integer('isSpam').notNull().$type<Bit>(),
    created: integer('created').notNull(),
    updated: integer('updated').notNull(),
    ups: text('ups').notNull().default('[]'),
    downs: text('downs').notNull().default('[]'),
    top: integer('top').notNull().$type<Bit>(),
    avatar: text('avatar').notNull(),
  },
  (t) => [
    // Live PK is `(url, created DESC)`; Drizzle's primaryKey helper doesn't
    // express the DESC ordering. Queries that depend on the storage order
    // use `.orderBy(desc(comment.created))` explicitly.
    primaryKey({ columns: [t.url, t.created] }),
    uniqueIndex('idx_comment_id').on(t._id),
    index('idx_comment_created').on(t.created),
    index('idx_comment_ip_created').on(t.ip, t.created),
  ],
);

export const config = sqliteTable('config', {
  value: text('value').notNull().default(''),
});

export const counter = sqliteTable('counter', {
  url: text('url').notNull().primaryKey(),
  title: text('title').notNull(),
  time: integer('time').notNull(),
  created: integer('created').notNull(),
  updated: integer('updated').notNull(),
});

export type Comment = typeof comment.$inferSelect;
export type NewComment = typeof comment.$inferInsert;
export type Config = typeof config.$inferSelect;
export type Counter = typeof counter.$inferSelect;

// Singleton-row guard: `config` is treated as a single-row table; reads
// always return the first row. The `INSERT … WHERE NOT EXISTS` from
// schema.sql is preserved as a runtime no-op via `ensureConfigRow`.
export const ensureConfigRow = sql`INSERT INTO config (value) SELECT '' WHERE NOT EXISTS (SELECT 1 FROM config)`;
