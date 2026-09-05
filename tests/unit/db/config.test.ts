import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
});

describe('ConfigDB.exportAll', () => {
  it('returns an empty array when no row exists', async () => {
    const db = dbInstance();
    expect(await db.config.exportAll()).toEqual([]);
  });
});
