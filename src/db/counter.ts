import type { D1Result } from '@cloudflare/workers-types';

import { DBBase } from './base';

export interface CounterRow {
  url: string;
  title: string;
  time: number;
  created: number;
  updated: number;
}

export class CounterDB extends DBBase {
  async incr(url: string, title: string, ts: number): Promise<D1Result> {
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

  async time(url: string): Promise<number> {
    return (
      (await this.stmt('counterTime', 'SELECT time FROM counter WHERE url = ?1')
        .bind(url)
        .first<number>('time')) ?? 0
    );
  }
}
