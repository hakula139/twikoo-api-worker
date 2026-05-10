import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { ResponseCode } from '@/lib/errors';
import { logger } from '@/twikoo';
import { applyTestSchema, resetTestDb } from '@tests/helpers/db';
import { fetchComments, postEvent, seedComment, seedConfig } from './helpers';

let infoSpy: MockInstance;

beforeAll(async () => {
  await applyTestSchema();
});

beforeEach(() => {
  infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await resetTestDb();
  vi.restoreAllMocks();
});

describe('integration: smoke probes', () => {
  it('GET_FUNC_VERSION returns SUCCESS without a config row', async () => {
    const { body } = await postEvent('GET_FUNC_VERSION');
    expect(body.code).toBe(ResponseCode.SUCCESS);
  });

  it('GET_PASSWORD_STATUS returns SUCCESS once config exists', async () => {
    await seedConfig({});
    const { body } = await postEvent('GET_PASSWORD_STATUS');
    expect(body.code).toBe(ResponseCode.SUCCESS);
  });

  it('GET_CONFIG returns SUCCESS for any caller', async () => {
    await seedConfig({});
    const { body } = await postEvent('GET_CONFIG');
    expect(body.code).toBe(ResponseCode.SUCCESS);
  });

  it('rejects an unknown event with EVENT_NOT_EXIST', async () => {
    await seedConfig({});
    const { body } = await postEvent('NOT_AN_EVENT');
    expect(body.code).toBe(ResponseCode.EVENT_NOT_EXIST);
  });
});

describe('integration: GET_COMMENTS_COUNT', () => {
  it('returns one entry per requested url', async () => {
    await seedConfig({});
    await seedComment({ url: '/post-a/' });
    await seedComment({ url: '/post-a/' });
    await seedComment({ url: '/post-b/' });

    const { body } = await postEvent('GET_COMMENTS_COUNT', {
      urls: ['/post-a/', '/post-b/', '/post-c/'],
    });

    expect(body.code).toBe(ResponseCode.SUCCESS);
    expect(body.data).toEqual([
      { url: '/post-a/', count: 2 },
      { url: '/post-b/', count: 1 },
      { url: '/post-c/', count: 0 },
    ]);
  });

  it('rejects a non-array `urls` payload (PR #33 guard)', async () => {
    await seedConfig({});
    const { body } = await postEvent('GET_COMMENTS_COUNT', { urls: 'https://x/' });
    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/array of strings/);
  });
});

describe('integration: GET_RECENT_COMMENTS', () => {
  it('returns rows in newest-first order, capped by pageSize', async () => {
    await seedConfig({});
    const t0 = Date.now() - 60_000;
    await seedComment({ url: '/p/', comment: 'oldest', created: t0 });
    await seedComment({ url: '/p/', comment: 'middle', created: t0 + 1_000 });
    await seedComment({ url: '/p/', comment: 'newest', created: t0 + 2_000 });

    const { body } = await postEvent('GET_RECENT_COMMENTS', { urls: ['/p/'], pageSize: 2 });

    expect(body.code).toBe(ResponseCode.SUCCESS);
    const data = body.data as Array<{ comment: string }>;
    expect(data.map((c) => c.comment)).toEqual(['newest', 'middle']);
  });

  it('rejects a non-array `urls` payload when present', async () => {
    await seedConfig({});
    const { body } = await postEvent('GET_RECENT_COMMENTS', { urls: 'https://x/' });
    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/array of strings/);
  });
});

describe('integration: COMMENT_GET', () => {
  it('returns the seeded rows in newest-first order with the right count', async () => {
    await seedConfig({});
    const t = Date.now() - 60_000;
    const first = await seedComment({ url: '/post/', comment: '<p>first</p>', created: t });
    const second = await seedComment({
      url: '/post/',
      comment: '<p>second</p>',
      created: t + 1_000,
    });

    const { body } = await postEvent('COMMENT_GET', { url: '/post/' });

    expect(body.code).toBe(ResponseCode.SUCCESS);
    expect(body.count).toBe(2);
    // Mocked `parseComment` is identity, so rows expose the schema's `_id`.
    const data = body.data as Array<{ _id: string }>;
    expect(data.map((c) => c._id)).toEqual([second, first]);
  });

  it('hides spam from anonymous viewers', async () => {
    await seedConfig({});
    // Distinct non-empty authors so the visibility `OR uid = viewer` clause
    // (viewer uid is empty here) doesn't accidentally match either row.
    await seedComment({ url: '/post/', comment: 'visible', uid: 'author-1' });
    await seedComment({ url: '/post/', comment: 'spam', uid: 'author-2', isSpam: 1 });

    const { body } = await postEvent('COMMENT_GET', { url: '/post/' });

    expect(body.count).toBe(1);
  });
});

describe('integration: COMMENT_SUBMIT (PR #43 normal payload)', () => {
  it('persists a comment with the upstream {id} response shape', async () => {
    await seedConfig({});

    const { body } = await postEvent(
      'COMMENT_SUBMIT',
      {
        url: '/post/',
        ua: 'integration-ua',
        comment: 'hello world',
        nick: 'tester',
        href: 'https://blog.example/post/',
      },
      { 'x-twikoo-recaptcha-v3': 'submitter-1' },
    );

    expect(body.code).toBe(ResponseCode.SUCCESS);
    expect(typeof body.id).toBe('string');

    const rows = await fetchComments('/post/');
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe(body.id);
  });

  it('per-request log carries the event, success code, and uid', async () => {
    await seedConfig({});

    await postEvent(
      'COMMENT_SUBMIT',
      { url: '/p/', ua: 'ua', comment: 'one' },
      { 'x-twikoo-recaptcha-v3': 'submitter-2' },
    );

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'COMMENT_SUBMIT',
        code: ResponseCode.SUCCESS,
        uid: 'submitter-2',
      }),
      'request',
    );
  });
});

describe('integration: COMMENT_LIKE toggle (PR #42 vote path)', () => {
  it('adds the uid to ups on first call and removes it on the second', async () => {
    await seedConfig({});
    const id = await seedComment({ url: '/post/' });

    const first = await postEvent('COMMENT_LIKE', { id }, { 'x-twikoo-recaptcha-v3': 'voter-1' });
    expect(first.body.code).toBe(ResponseCode.SUCCESS);

    const after = await env.DB.prepare('SELECT ups FROM comment WHERE _id = ?')
      .bind(id)
      .first<{ ups: string }>();
    expect(JSON.parse(after?.ups ?? '[]')).toEqual(['voter-1']);

    const second = await postEvent('COMMENT_LIKE', { id }, { 'x-twikoo-recaptcha-v3': 'voter-1' });
    expect(second.body.code).toBe(ResponseCode.SUCCESS);

    const back = await env.DB.prepare('SELECT ups FROM comment WHERE _id = ?')
      .bind(id)
      .first<{ ups: string }>();
    expect(JSON.parse(back?.ups ?? '[]')).toEqual([]);
  });

  it('routes type=down through the downs column without touching ups', async () => {
    await seedConfig({});
    const id = await seedComment({ url: '/post/' });

    const { body } = await postEvent(
      'COMMENT_LIKE',
      { id, type: 'down' },
      { 'x-twikoo-recaptcha-v3': 'voter-2' },
    );
    expect(body.code).toBe(ResponseCode.SUCCESS);

    const row = await env.DB.prepare('SELECT ups, downs FROM comment WHERE _id = ?')
      .bind(id)
      .first<{ ups: string; downs: string }>();
    expect(JSON.parse(row?.ups ?? '[]')).toEqual([]);
    expect(JSON.parse(row?.downs ?? '[]')).toEqual(['voter-2']);
  });

  it('rejects an unrecognized vote type with FAIL', async () => {
    await seedConfig({});
    const id = await seedComment({ url: '/post/' });

    const { body } = await postEvent(
      'COMMENT_LIKE',
      { id, type: 'sideways' },
      { 'x-twikoo-recaptcha-v3': 'voter-3' },
    );
    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/Invalid like type/);
  });

  it('rejects with FAIL when the comment does not exist', async () => {
    await seedConfig({});
    const { body } = await postEvent(
      'COMMENT_LIKE',
      { id: 'missing' },
      { 'x-twikoo-recaptcha-v3': 'voter-x' },
    );
    expect(body.code).toBe(ResponseCode.FAIL);
  });
});

describe('integration: COMMENT_DELETE_FOR_USER', () => {
  it('lets a user delete their own comment within session', async () => {
    await seedConfig({});
    const id = await seedComment({ url: '/post/', uid: 'owner-1' });

    const { body } = await postEvent(
      'COMMENT_DELETE_FOR_USER',
      { id },
      { 'x-twikoo-recaptcha-v3': 'owner-1' },
    );

    expect(body.code).toBe(ResponseCode.SUCCESS);
    expect(await fetchComments('/post/')).toHaveLength(0);
  });

  it('blocks deletion when the uid does not match the author', async () => {
    await seedConfig({});
    const id = await seedComment({ url: '/post/', uid: 'owner-1' });

    const { body } = await postEvent(
      'COMMENT_DELETE_FOR_USER',
      { id },
      { 'x-twikoo-recaptcha-v3': 'someone-else' },
    );

    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/自己的评论/);
  });

  it('refuses anonymous deletes (uid empty)', async () => {
    await seedConfig({});
    const id = await seedComment({ url: '/post/', uid: '' });

    const { body } = await postEvent('COMMENT_DELETE_FOR_USER', { id });

    expect(body.code).toBe(ResponseCode.NEED_LOGIN);
  });
});

describe('integration: COUNTER_GET', () => {
  it('increments time and updates title via the onConflictDoUpdate clause', async () => {
    await seedConfig({});

    const first = await postEvent('COUNTER_GET', { url: '/post/', title: 'Hello' });
    expect(first.body.code).toBe(ResponseCode.SUCCESS);
    expect(first.body.time).toBe(1);

    const second = await postEvent('COUNTER_GET', { url: '/post/', title: 'Hello v2' });
    expect(second.body.time).toBe(2);

    const row = await env.DB.prepare('SELECT title, time FROM counter WHERE url = ?')
      .bind('/post/')
      .first<{ title: string; time: number }>();
    expect(row).toEqual({ title: 'Hello v2', time: 2 });
  });
});
