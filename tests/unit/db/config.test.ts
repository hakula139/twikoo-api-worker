import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyTestSchema, dbInstance, resetTestDb } from '../../helpers/db';

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

  it('returns the most recent write', async () => {
    const db = dbInstance();
    await db.config.write('{"a":1}');
    expect(await db.config.read()).toBe('{"a":1}');
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

  it('preserves existing keys not mentioned in the patch', async () => {
    const db = dbInstance();
    await db.config.write(JSON.stringify({ ADMIN_PASS: 'old', SITE_URL: 'https://old.example' }));
    await db.config.writePatch({ ADMIN_PASS: 'new' });

    expect(JSON.parse(await db.config.read())).toEqual({
      ADMIN_PASS: 'new',
      SITE_URL: 'https://old.example',
    });
  });

  it('overwrites keys that appear in the patch', async () => {
    const db = dbInstance();
    await db.config.write(JSON.stringify({ TURNSTILE_SITE_KEY: '0x1' }));
    await db.config.writePatch({ TURNSTILE_SITE_KEY: '0x2' });

    expect(JSON.parse(await db.config.read())).toEqual({ TURNSTILE_SITE_KEY: '0x2' });
  });
});

describe('ConfigDB.exportAll', () => {
  it('returns an empty array when no row exists', async () => {
    const db = dbInstance();
    expect(await db.config.exportAll()).toEqual([]);
  });
});
