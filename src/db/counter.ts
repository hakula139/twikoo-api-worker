import type { DrizzleD1Database } from 'drizzle-orm/d1';

import type { Counter } from './schema';

import { eq, sql } from 'drizzle-orm';

import { counter } from './schema';

export const createCounterDb = (db: DrizzleD1Database) => ({
  async incr(url: string, title: string, ts: number): Promise<void> {
    await db
      .insert(counter)
      .values({ url, title, time: 1, created: ts, updated: ts })
      .onConflictDoUpdate({
        target: counter.url,
        set: { time: sql`${counter.time} + 1`, title, updated: ts },
      });
  },

  async time(url: string): Promise<number> {
    const [row] = await db
      .select({ time: counter.time })
      .from(counter)
      .where(eq(counter.url, url))
      .limit(1);
    return row?.time ?? 0;
  },

  async exportAll(): Promise<Counter[]> {
    return db.select().from(counter);
  },
});

export type CounterDB = ReturnType<typeof createCounterDb>;
