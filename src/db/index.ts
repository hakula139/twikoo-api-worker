import type { D1Database } from '@cloudflare/workers-types';

import { drizzle } from 'drizzle-orm/d1';

import { createCommentDb } from './comment';
import { createConfigDb } from './config';
import { createCounterDb } from './counter';

export type { AdminFilter, CommentSort } from './comment';
export type { Bit, Comment, Config, Counter, NewComment } from './schema';

export const buildDb = (d1: D1Database) => {
  const client = drizzle(d1);
  return {
    comment: createCommentDb(client),
    config: createConfigDb(client),
    counter: createCounterDb(client),
  };
};

export type DB = ReturnType<typeof buildDb>;
