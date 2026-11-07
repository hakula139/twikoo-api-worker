import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResponseCode } from '@/lib/errors';
import { logger } from '@/twikoo';
import { applyTestSchema, resetTestDb } from '@tests/helpers/db';
import {
  ADMIN_PASS_PLAINTEXT,
  ADMIN_TOKEN,
  adminAuthHeader,
  fetchComments,
  postEvent,
  seedAdmin,
  seedComment,
  seedConfig,
} from './helpers';

beforeAll(async () => {
  await applyTestSchema();
});

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
});

afterEach(async () => {
  await resetTestDb();
  vi.restoreAllMocks();
});

describe('integration: LOGIN', () => {
  it('returns SUCCESS when md5(password) matches ADMIN_PASS', async () => {
    await seedConfig({ ADMIN_PASS: `md5(${ADMIN_PASS_PLAINTEXT})` });

    const { body } = await postEvent('LOGIN', { password: ADMIN_PASS_PLAINTEXT });

    expect(body.code).toBe(ResponseCode.SUCCESS);
  });

  it('returns PASS_NOT_MATCH on a wrong password', async () => {
    await seedConfig({ ADMIN_PASS: `md5(${ADMIN_PASS_PLAINTEXT})` });

    const { body } = await postEvent('LOGIN', { password: 'not-the-password' });

    expect(body.code).toBe(ResponseCode.PASS_NOT_MATCH);
  });

  it('returns PASS_NOT_EXIST before any password has been seeded', async () => {
    await seedConfig({});

    const { body } = await postEvent('LOGIN', { password: 'password-before-setup' });

    expect(body.code).toBe(ResponseCode.PASS_NOT_EXIST);
  });
});

describe('integration: SET_PASSWORD lockdown', () => {
  it('rejects unauthenticated callers with NEED_LOGIN even on a fresh deploy', async () => {
    await seedConfig({});

    const { body } = await postEvent('SET_PASSWORD', { password: 'attacker-claim' });

    expect(body.code).toBe(ResponseCode.NEED_LOGIN);
  });
});

describe('integration: COMMENT_GET_FOR_ADMIN sort options', () => {
  let ids: { olderPopular: string; newerPopular: string; newestWithoutVotes: string };

  beforeEach(async () => {
    await seedAdmin();
    const t = Date.now() - 60_000;
    const olderPopular = await seedComment({
      url: '/post/',
      comment: 'Older popular comment',
      created: t,
      ups: '["reader-1","reader-2"]',
    });
    const newerPopular = await seedComment({
      url: '/post/',
      comment: 'Newer popular comment',
      created: t + 1_000,
      ups: '["reader-1","reader-2"]',
    });
    const newestWithoutVotes = await seedComment({
      url: '/post/',
      comment: 'Newest comment without votes',
      created: t + 2_000,
      ups: '[]',
    });
    ids = { olderPopular, newerPopular, newestWithoutVotes };
  });

  const fetchAdminList = async (
    sort: string | undefined,
  ): Promise<{ count: number; data: Array<{ _id: string; comment: string }> }> => {
    const { body } = await postEvent(
      'COMMENT_GET_FOR_ADMIN',
      { per: 10, page: 1, ...(sort ? { sort } : {}) },
      adminAuthHeader(),
    );

    expect(body.code).toBe(ResponseCode.SUCCESS);

    return body as unknown as {
      count: number;
      data: Array<{ _id: string; comment: string }>;
    };
  };

  it.each([
    { sort: undefined, order: ['newestWithoutVotes', 'newerPopular', 'olderPopular'] },
    { sort: 'newest', order: ['newestWithoutVotes', 'newerPopular', 'olderPopular'] },
    { sort: 'oldest', order: ['olderPopular', 'newerPopular', 'newestWithoutVotes'] },
    { sort: 'popular', order: ['newerPopular', 'olderPopular', 'newestWithoutVotes'] },
    { sort: 'unsupported-sort', order: ['newestWithoutVotes', 'newerPopular', 'olderPopular'] },
  ] satisfies { sort: string | undefined; order: (keyof typeof ids)[] }[])(
    'returns comments for sort=$sort',
    async ({ sort, order }) => {
      const result = await fetchAdminList(sort);

      expect(result.count).toBe(3);
      expect(result.data.map((row) => row._id)).toEqual(order.map((key) => ids[key]));
    },
  );

  it('non-admin callers get NEED_LOGIN', async () => {
    const { body } = await postEvent('COMMENT_GET_FOR_ADMIN', { per: 10, page: 1 });

    expect(body.code).toBe(ResponseCode.NEED_LOGIN);
  });
});

describe('integration: COMMENT_SET_FOR_ADMIN boolean flags', () => {
  it.each([
    { field: 'isSpam', value: true, previous: 0, expected: 1 },
    { field: 'isSpam', value: false, previous: 1, expected: 0 },
    { field: 'top', value: true, previous: 0, expected: 1 },
  ] as const)('stores $field=$value as $expected', async ({ field, value, previous, expected }) => {
    await seedAdmin();
    const id = await seedComment({ url: '/post/', [field]: previous });

    const { body } = await postEvent(
      'COMMENT_SET_FOR_ADMIN',
      { id, set: { [field]: value } },
      adminAuthHeader(),
    );

    expect(body.code).toBe(ResponseCode.SUCCESS);
    const rows = await fetchComments('/post/');
    expect(rows[0]?.[field]).toBe(expected);
  });

  it('rejects a non-string `comment` field with FAIL', async () => {
    await seedAdmin();
    const id = await seedComment({ url: '/post/' });

    const { body } = await postEvent(
      'COMMENT_SET_FOR_ADMIN',
      { id, set: { comment: 42 } },
      adminAuthHeader(),
    );

    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/comment/);
  });
});

describe('integration: COMMENT_DELETE_FOR_ADMIN', () => {
  it('removes any row regardless of authorship when the caller is admin', async () => {
    await seedAdmin();
    const id = await seedComment({ url: '/post/', uid: 'someone-else' });

    const { body } = await postEvent('COMMENT_DELETE_FOR_ADMIN', { id }, adminAuthHeader());

    expect(body.code).toBe(ResponseCode.SUCCESS);
    expect(await fetchComments('/post/')).toHaveLength(0);
  });

  it('rejects without admin auth', async () => {
    await seedAdmin();
    const id = await seedComment({ url: '/post/' });

    const { body } = await postEvent('COMMENT_DELETE_FOR_ADMIN', { id });

    expect(body.code).toBe(ResponseCode.NEED_LOGIN);
    expect(await fetchComments('/post/')).toHaveLength(1);
  });
});

describe('integration: COMMENT_EXPORT_FOR_ADMIN', () => {
  it('exports the comment collection for an admin caller', async () => {
    await seedAdmin();
    const id = await seedComment({ url: '/post/', comment: 'export me' });

    const { body } = await postEvent('COMMENT_EXPORT_FOR_ADMIN', {}, adminAuthHeader());

    expect(body.code).toBe(ResponseCode.SUCCESS);
    const data = body.data as Array<{ _id: string }>;

    expect(data.map((r) => r._id)).toContain(id);
  });

  it('exports the config collection with the seeded values round-tripped', async () => {
    await seedAdmin({ NSFW_THRESHOLD: '0.8' });

    const { body } = await postEvent(
      'COMMENT_EXPORT_FOR_ADMIN',
      { collection: 'config' },
      adminAuthHeader(),
    );

    expect(body.code).toBe(ResponseCode.SUCCESS);
    const data = body.data as Array<{ id: number; value: string }>;

    expect(data).toHaveLength(1);
    const parsed = JSON.parse(data[0]?.value ?? '{}') as Record<string, unknown>;

    expect(parsed.NSFW_THRESHOLD).toBe('0.8');
    expect(parsed.ADMIN_PASS).toBe(`md5(${ADMIN_TOKEN})`);
  });

  it('rejects an unsupported collection name', async () => {
    await seedAdmin();

    const { body } = await postEvent(
      'COMMENT_EXPORT_FOR_ADMIN',
      { collection: 'unsupported-collection' },
      adminAuthHeader(),
    );

    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/Unsupported collection/);
  });

  it('rejects without admin auth', async () => {
    await seedAdmin();

    const { body } = await postEvent('COMMENT_EXPORT_FOR_ADMIN', {});

    expect(body.code).toBe(ResponseCode.NEED_LOGIN);
  });
});

describe('integration: GET_CONFIG_FOR_ADMIN', () => {
  it('rejects non-admin callers with NEED_LOGIN', async () => {
    await seedAdmin();

    const { body } = await postEvent('GET_CONFIG_FOR_ADMIN', {});

    expect(body.code).toBe(ResponseCode.NEED_LOGIN);
  });
});
