import type { D1Database } from '@cloudflare/workers-types';

import { drizzle } from 'drizzle-orm/d1';

import { CommentDB } from './comment';
import { ConfigDB } from './config';
import { CounterDB } from './counter';

export type { Bit, Comment, NewComment } from './comment';
export type { Counter } from './counter';

export class DB {
  readonly comment: CommentDB;
  readonly config: ConfigDB;
  readonly counter: CounterDB;

  constructor(d1: D1Database) {
    // Skip `{ schema }` — we don't use the relational query API
    // (`db.query.*`); subclasses use the core builder which doesn't
    // require schema-typed clients.
    const client = drizzle(d1);
    this.comment = new CommentDB(client);
    this.config = new ConfigDB(client);
    this.counter = new CounterDB(client);
  }
}
