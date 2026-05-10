import type { D1Database } from '@cloudflare/workers-types';

import { drizzle } from 'drizzle-orm/d1';

import { CommentDB } from './comment';
import { ConfigDB } from './config';
import { CounterDB } from './counter';

export type { AdminFilter, CommentSort } from './comment';
export type { Bit, Comment, Config, Counter, NewComment } from './schema';

export class DB {
  readonly comment: CommentDB;
  readonly config: ConfigDB;
  readonly counter: CounterDB;

  constructor(d1: D1Database) {
    const client = drizzle(d1);
    this.comment = new CommentDB(client);
    this.config = new ConfigDB(client);
    this.counter = new CounterDB(client);
  }
}
