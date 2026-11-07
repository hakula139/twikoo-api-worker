import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '@/db/schema';

import { applyTestSchema, dbInstance, drizzleClient, resetTestDb } from '@tests/helpers/db';

beforeAll(async () => {
  await applyTestSchema();
});

beforeEach(async () => {
  await resetTestDb();
});

describe('ConfigDB.read', () => {
  it('returns empty string before any write', async () => {
    const db = dbInstance();
    expect(await db.config.read()).toBe('');
  });

  it('returns a written value', async () => {
    const db = dbInstance();
    await db.config.write('{"SITE_NAME":"HAKULA†CHANNEL"}');
    expect(await db.config.read()).toBe('{"SITE_NAME":"HAKULA†CHANNEL"}');
  });

  it('ignores rows outside the id = 1 singleton', async () => {
    const client = drizzleClient();
    const db = dbInstance();
    await client.insert(config).values({ id: 0, value: '{"SITE_NAME":"Stale Site"}' });

    expect(await db.config.read()).toBe('');

    await client.insert(config).values({ id: 1, value: '{"SITE_NAME":"HAKULA†CHANNEL"}' });

    expect(await db.config.read()).toBe('{"SITE_NAME":"HAKULA†CHANNEL"}');
  });
});

describe('ConfigDB.write', () => {
  it('upserts the singleton row on conflict (id = 1)', async () => {
    const db = dbInstance();
    await db.config.write('{"first":true}');
    await db.config.write('{"second":true}');

    const all = await db.config.exportAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 1, value: '{"second":true}' });
  });
});

describe('ConfigDB.writePatch', () => {
  it('merges the patch into an empty config', async () => {
    const db = dbInstance();
    await db.config.writePatch({ ADMIN_PASS: 'hash', SITE_URL: 'https://example.com' });

    expect(JSON.parse(await db.config.read())).toEqual({
      ADMIN_PASS: 'hash',
      SITE_URL: 'https://example.com',
    });
  });

  it('preserves existing keys and overwrites keys present in the patch', async () => {
    const db = dbInstance();
    await db.config.write(JSON.stringify({ ADMIN_PASS: 'old', SITE_URL: 'https://old.example' }));
    await db.config.writePatch({ ADMIN_PASS: 'new' });

    expect(JSON.parse(await db.config.read())).toEqual({
      ADMIN_PASS: 'new',
      SITE_URL: 'https://old.example',
    });
  });

  it('preserves a concurrent password rotation when another configuration patch finishes later', async () => {
    const db = dbInstance();
    await db.config.write(
      JSON.stringify({ ADMIN_PASS: 'previous-password', SITE_NAME: 'Old Site' }),
    );
    const read = db.config.read.bind(db.config);
    vi.spyOn(db.config, 'read').mockImplementationOnce(async () => {
      const current = await read();
      await db.config.writePatch({ ADMIN_PASS: 'rotated-password' });
      return current;
    });

    await db.config.writePatch({ SITE_NAME: 'New Site' });

    expect(JSON.parse(await db.config.read())).toEqual({
      ADMIN_PASS: 'rotated-password',
      SITE_NAME: 'New Site',
    });
  });

  it.each([
    {
      label: 'nested objects',
      current: { nested: { first: 1, second: 2 } },
      patch: { nested: { third: 3 } },
      expected: { nested: { third: 3 } },
    },
    {
      label: 'null values',
      current: { optional: 'value', retained: true },
      patch: { optional: null },
      expected: { optional: null, retained: true },
    },
    {
      label: 'literal keys',
      current: { 'field.with.dot': 'previous', 'quoted"key': 'retained' },
      patch: { 'field.with.dot': 'next' },
      expected: { 'field.with.dot': 'next', 'quoted"key': 'retained' },
    },
  ])('preserves shallow patch semantics for $label', async ({ current, patch, expected }) => {
    const db = dbInstance();
    await db.config.write(JSON.stringify(current));

    await db.config.writePatch(patch);

    expect(JSON.parse(await db.config.read())).toEqual(expected);
  });

  it('rejects malformed stored JSON without exposing its contents or replacing it', async () => {
    const db = dbInstance();
    const raw = '{"SMTP_PASS": example-secret}';
    await db.config.write(raw);

    await expect(db.config.writePatch({ SITE_NAME: 'Example Site' })).rejects.toEqual(
      new Error('Configuration is not valid JSON.'),
    );

    expect(await db.config.read()).toBe(raw);
  });
});

describe('ConfigDB.exportAll', () => {
  it('returns an empty array when no row exists', async () => {
    const db = dbInstance();
    expect(await db.config.exportAll()).toEqual([]);
  });
});
