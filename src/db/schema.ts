import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// SQLite booleans ride on INTEGER; `Bit` narrows the surface to 0/1.
export type Bit = 0 | 1;

// `ups` / `downs` store JSON arrays of voter UIDs as text; callers parse.
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
