import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyTestSchema, dbInstance, resetTestDb } from '@tests/helpers/db';

beforeAll(async () => {
  await applyTestSchema();
});

beforeEach(async () => {
  await resetTestDb();
});

describe('CounterDB.incr', () => {
  it('inserts a new row when the URL has not been seen', async () => {
    const db = dbInstance();
    await db.counter.incr('/post', 'Post', 1000);

    expect(await db.counter.time('/post')).toBe(1);
    const all = await db.counter.exportAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ url: '/post', title: 'Post', time: 1, created: 1000 });
  });

  it('increments time on conflict and refreshes title + updated', async () => {
    const db = dbInstance();
    await db.counter.incr('/post', 'Old Title', 1000);
    await db.counter.incr('/post', 'New Title', 2000);

    expect(await db.counter.time('/post')).toBe(2);
    const [row] = await db.counter.exportAll();
    expect(row).toMatchObject({ title: 'New Title', created: 1000, updated: 2000 });
  });

  it('keeps separate URLs independent', async () => {
    const db = dbInstance();
    await db.counter.incr('/a', 'A', 1000);
    await db.counter.incr('/b', 'B', 1100);
    await db.counter.incr('/a', 'A', 1200);

    expect(await db.counter.time('/a')).toBe(2);
    expect(await db.counter.time('/b')).toBe(1);
  });
});

describe('CounterDB.time', () => {
  it('returns 0 for an unknown URL', async () => {
    const db = dbInstance();
    expect(await db.counter.time('/missing')).toBe(0);
  });
});

describe('CounterDB.exportAll', () => {
  it('returns an empty array when no counters exist', async () => {
    const db = dbInstance();
    expect(await db.counter.exportAll()).toEqual([]);
  });
});
