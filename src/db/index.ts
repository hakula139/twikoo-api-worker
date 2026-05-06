import type { D1Database } from '@cloudflare/workers-types';

import { CommentDB } from './comment';
import { ConfigDB } from './config';
import { CounterDB } from './counter';

export type { StoredComment } from './comment';
export type { CounterRow } from './counter';

export class DB {
  readonly comment: CommentDB;
  readonly config: ConfigDB;
  readonly counter: CounterDB;

  constructor(d1: D1Database) {
    this.comment = new CommentDB(d1);
    this.config = new ConfigDB(d1);
    this.counter = new CounterDB(d1);
  }
}
