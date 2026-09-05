import type { MockInstance } from 'vitest';

import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  it('GET_FUNC_VERSION returns the upstream version without a config row', async () => {
    const { body } = await postEvent('GET_FUNC_VERSION');
    expect(body).toEqual({ code: ResponseCode.SUCCESS, version: '0.0.0-test' });
  });
});

describe('integration: GET_COMMENTS_COUNT', () => {
  it('returns one entry per requested url', async () => {
    await seedConfig({});
    await seedComment({ url: '/post-a/' });
    await seedComment({ url: '/post-a/' });
    await seedComment({ url: '/post-b/' });

    const { body } = await postEvent('GET_COMMENTS_COUNT', {
      urls: ['/post-a', '/post-b/', '/post-c'],
    });

    expect(body.code).toBe(ResponseCode.SUCCESS);
    expect(body.data).toEqual([
      { url: '/post-a', count: 2 },
      { url: '/post-b/', count: 1 },
      { url: '/post-c', count: 0 },
    ]);
  });

  it('rejects a non-array `urls` payload', async () => {
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
    await seedComment({ url: '/about-me/', comment: 'Oldest comment', created: t0 });
    await seedComment({ url: '/about-me/', comment: 'Middle comment', created: t0 + 1_000 });
    await seedComment({ url: '/about-me/', comment: 'Newest comment', created: t0 + 2_000 });

    const { body } = await postEvent('GET_RECENT_COMMENTS', { urls: ['/about-me'], pageSize: 2 });

    expect(body.code).toBe(ResponseCode.SUCCESS);
    const data = body.data as Array<{ comment: string }>;
    expect(data.map((c) => c.comment)).toEqual(['Newest comment', 'Middle comment']);
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
    const data = body.data as Array<Record<string, unknown> & { id: string }>;
    expect(data.map((c) => c.id)).toEqual([second, first]);
    expect(data[0]).toMatchObject({
      id: second,
      comment: '<p>second</p>',
      ups: 0,
      downs: 0,
      replies: [],
    });
    for (const field of ['uid', 'mail', 'ua', 'ip']) {
      expect(data[0]).not.toHaveProperty(field);
    }
  });

  it('nests replies under their head comment', async () => {
    await seedConfig({});
    const headId = await seedComment({
      url: '/about-me/',
      comment: '这篇文章很有帮助。',
      created: 100,
    });
    const replyId = await seedComment({
      url: '/about-me/',
      comment: '谢谢阅读。',
      rid: headId,
      pid: headId,
      created: 200,
    });

    const { body } = await postEvent('COMMENT_GET', { url: '/about-me/' });

    expect(body.count).toBe(1);
    const data = body.data as Array<{
      id: string;
      replies: Array<{ id: string; ruser: string | null }>;
    }>;
    expect(data).toHaveLength(1);
    expect(data[0]?.id).toBe(headId);
    expect(data[0]?.replies.map((reply) => reply.id)).toEqual([replyId]);
    expect(data[0]?.replies[0]?.ruser).toBe('Reader');
  });

  it('hides spam from anonymous viewers', async () => {
    await seedConfig({});
    // Distinct non-empty authors so the visibility `OR uid = viewer` clause
    // (viewer uid is empty here) doesn't accidentally match either row.
    const visibleId = await seedComment({
      url: '/post/',
      comment: 'Visible comment',
      uid: 'author-1',
    });
    const spamId = await seedComment({
      url: '/post/',
      comment: 'Spam comment',
      uid: 'author-2',
      isSpam: 1,
    });

    const { body } = await postEvent('COMMENT_GET', { url: '/post/' });

    expect(body.count).toBe(1);
    const data = body.data as Array<{ id: string }>;
    expect(data.map((comment) => comment.id)).toEqual([visibleId]);
    expect(data.map((comment) => comment.id)).not.toContain(spamId);
  });
});

describe('integration: COMMENT_SUBMIT', () => {
  it('persists a comment with the upstream {id} response shape', async () => {
    await seedConfig({});

    const { body } = await postEvent(
      'COMMENT_SUBMIT',
      {
        url: '/about-me/',
        ua: 'Mozilla/5.0',
        comment: '感谢分享。',
        nick: 'Reader',
        href: 'https://hakula.xyz/about-me/',
      },
      { 'x-twikoo-recaptcha-v3': 'submitter-1' },
    );

    expect(body.code).toBe(ResponseCode.SUCCESS);
    expect(typeof body.id).toBe('string');

    const rows = await fetchComments('/about-me/');
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe(body.id);
  });

  it('per-request log carries the event, success code, and uid', async () => {
    await seedConfig({});

    await postEvent(
      'COMMENT_SUBMIT',
      { url: '/comments/', ua: 'Mozilla/5.0', comment: '测试评论日志。' },
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

describe('integration: COMMENT_LIKE toggle', () => {
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
    expect(await fetchComments('/post/')).toHaveLength(1);
  });

  it('refuses anonymous deletes (uid empty)', async () => {
    await seedConfig({});
    const id = await seedComment({ url: '/post/', uid: '' });

    const { body } = await postEvent('COMMENT_DELETE_FOR_USER', { id });

    expect(body.code).toBe(ResponseCode.NEED_LOGIN);
    expect(await fetchComments('/post/')).toHaveLength(1);
  });
});

describe('integration: COUNTER_GET', () => {
  it('increments time and updates title via the onConflictDoUpdate clause', async () => {
    await seedConfig({});

    const first = await postEvent('COUNTER_GET', { url: '/about-me/', title: '关于我' });
    expect(first.body.code).toBe(ResponseCode.SUCCESS);
    expect(first.body.time).toBe(1);

    const second = await postEvent('COUNTER_GET', {
      url: '/about-me/',
      title: '关于我 | HAKULA†CHANNEL',
    });
    expect(second.body.time).toBe(2);

    const row = await env.DB.prepare('SELECT title, time FROM counter WHERE url = ?')
      .bind('/about-me/')
      .first<{ title: string; time: number }>();
    expect(row).toEqual({ title: '关于我 | HAKULA†CHANNEL', time: 2 });
  });
});
