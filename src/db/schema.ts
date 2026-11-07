import type { CommentId, JsonString } from '../types';

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

export type Bit = 0 | 1;

export const comment = sqliteTable(
  'comment',
  {
    _id: text('_id').notNull().primaryKey().$type<CommentId>(),
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
    ups: text('ups').notNull().default('[]').$type<JsonString<string[]>>(),
    downs: text('downs').notNull().default('[]').$type<JsonString<string[]>>(),
    top: integer('top').notNull().$type<Bit>(),
    avatar: text('avatar').notNull(),
  },
  (t) => [
    index('idx_comment_url_created').on(t.url, t.created),
    index('idx_comment_created').on(t.created),
    index('idx_comment_ip_created').on(t.ip, t.created),
  ],
);

export const upload = sqliteTable(
  'upload',
  {
    key: text('key').notNull().primaryKey(),
    deleteAfter: integer('delete_after'),
    deleting: integer('deleting').notNull().default(0).$type<Bit>(),
  },
  (t) => [
    unique('upload_key_deleting').on(t.key, t.deleting),
    index('idx_upload_delete_after')
      .on(t.deleteAfter, t.key)
      .where(sql`${t.deleteAfter} IS NOT NULL`),
  ],
);

export const commentUpload = sqliteTable(
  'comment_upload',
  {
    commentId: text('comment_id')
      .notNull()
      .$type<CommentId>()
      .references(() => comment._id, { onDelete: 'cascade' }),
    uploadKey: text('upload_key').notNull(),
    deleting: integer('deleting').notNull().default(0).$type<Bit>(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.uploadKey] }),
    index('idx_comment_upload_key').on(t.uploadKey),
    check('comment_upload_active', sql`${t.deleting} = 0`),
    foreignKey({
      columns: [t.uploadKey, t.deleting],
      foreignColumns: [upload.key, upload.deleting],
    })
      .onUpdate('restrict')
      .onDelete('restrict'),
  ],
);

export const config = sqliteTable('config', {
  id: integer('id').notNull().primaryKey().default(1),
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
