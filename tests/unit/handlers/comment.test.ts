import type { Bit, Comment, NewComment } from '@/db';
import type { JsonString, RequestCtx, TwikooConfig } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  commentDeleteForAdmin,
  commentDeleteForUser,
  commentExportForAdmin,
  commentGet,
  commentGetForAdmin,
  commentLike,
  commentSetForAdmin,
  commentSubmit,
  getCommentsCount,
  getRecentComments,
} from '@/handlers/comment';
import { ResponseCode, TwikooError } from '@/lib/errors';
import * as twikoo from '@/twikoo';
import { md5 } from '@/twikoo';
import { mkCommentId, mkIp, mkUid } from '@/types';
import { buildCtx } from '@tests/helpers/ctx';
import { newComment } from '@tests/helpers/comment-fixture';

const baseRow = newComment({ _id: mkCommentId('c1'), created: 0, updated: 0, href: '' });

interface FakeDb {
  saved: NewComment[];
  perIp: number;
  global: number;
}

const buildSubmitCtx = (config: TwikooConfig, fake: FakeDb): RequestCtx => {
  const db = {
    comment: {
      save: vi.fn((c: NewComment) => {
        fake.saved.push(c);

        return Promise.resolve();
      }),
      countSinceByIp: vi.fn<() => Promise<number>>().mockResolvedValue(fake.perIp),
      countSince: vi.fn<() => Promise<number>>().mockResolvedValue(fake.global),
      byId: vi.fn<() => Promise<Comment | undefined>>().mockResolvedValue(undefined),
      updateSpam: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    },
  };

  return buildCtx({
    ip: mkIp('192.0.2.1'),
    uid: mkUid('guest-uid'),
    config,
    db: db as unknown as RequestCtx['db'],
  });
};

const submitPayload = (overrides: Partial<Record<string, string>> = {}) => ({
  url: '/about-me/',
  ua: 'Mozilla/5.0',
  comment: '感谢分享。',
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const buildGetCtx = (
  rows: Comment[],
  config: TwikooConfig = {},
): { ctx: RequestCtx; list: ReturnType<typeof vi.fn> } => {
  const list = vi
    .fn<(...args: unknown[]) => Promise<Comment[]>>()
    .mockResolvedValueOnce(rows)
    .mockResolvedValue([]);
  const db = {
    comment: {
      count: vi.fn<() => Promise<number>>().mockResolvedValue(rows.length),
      list,
      replies: vi.fn<() => Promise<Comment[]>>().mockResolvedValue([]),
    },
  };

  return {
    ctx: buildCtx({ uid: mkUid('guest-uid'), config, db: db as unknown as RequestCtx['db'] }),
    list,
  };
};

describe('commentGet > malformed votes JSON', () => {
  it('treats malformed ups as zero votes and still returns the comment', async () => {
    const bad: Comment = {
      ...baseRow,
      _id: mkCommentId('bad'),
      ups: '{not-json' as JsonString<string[]>,
    };
    const { ctx } = buildGetCtx([bad]);
    const result = await commentGet({ url: '/post' }, ctx);

    expect(result.count).toBe(1);
    const data = result.data as Array<{ ups?: unknown }>;

    expect(data[0]?.ups).toBe(0);
  });

  it('logs malformed vote diagnostics without exposing voter credentials', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const raw = '["example-admin-token"';
    const bad: Comment = {
      ...baseRow,
      _id: mkCommentId('long'),
      ups: raw as JsonString<string[]>,
    };

    await commentGet({ url: '/post' }, buildGetCtx([bad]).ctx);

    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
      { id: 'long', field: 'ups', length: raw.length },
      'Malformed vote JSON.',
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('example-admin-token');
  });
});

describe('commentGet > config-driven branches', () => {
  it('skips the top-pinned query when TOP_DISABLED=true', async () => {
    const { ctx, list } = buildGetCtx([baseRow], { TOP_DISABLED: 'true' });
    await commentGet({ url: '/post' }, ctx);

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('runs the top-pinned query when TOP_DISABLED is unset and `before` is absent', async () => {
    const { ctx, list } = buildGetCtx([baseRow]);
    await commentGet({ url: '/post' }, ctx);

    expect(list).toHaveBeenCalledTimes(2);
  });

  // Upstream parseComment strips ipRegion unless SHOW_REGION is enabled.
  const stripIpRegion = (rows: readonly unknown[]): unknown[] =>
    rows.map((r) => {
      const { ipRegion: _ipRegion, ...rest } = r as Comment;

      return { ...rest, id: rest._id };
    });

  it('patches ipRegion onto each dto when SHOW_REGION=true', async () => {
    const row: Comment = { ...baseRow, ipRegion: 'Beijing' };
    vi.mocked(twikoo.parseComment).mockImplementationOnce(stripIpRegion);
    const { ctx } = buildGetCtx([row], { SHOW_REGION: 'true' });
    const result = await commentGet({ url: '/post' }, ctx);
    const data = result.data as Array<{ ipRegion?: string }>;

    expect(data[0]?.ipRegion).toBe('Beijing');
  });

  it('does not patch ipRegion when SHOW_REGION is unset', async () => {
    const row: Comment = { ...baseRow, ipRegion: 'Beijing' };
    vi.mocked(twikoo.parseComment).mockImplementationOnce(stripIpRegion);
    const { ctx } = buildGetCtx([row]);
    const result = await commentGet({ url: '/post' }, ctx);
    const data = result.data as Array<{ ipRegion?: string }>;

    expect(data[0]?.ipRegion).toBeUndefined();
  });
});

describe('getCommentsCount > urls validation', () => {
  const buildCountCtx = (): RequestCtx => {
    const db = {
      comment: {
        countByUrls: vi.fn<() => Promise<Map<string, number>>>().mockResolvedValue(new Map()),
      },
    };

    return buildCtx({ db: db as unknown as RequestCtx['db'] });
  };

  it('rejects when urls is a string instead of an array', async () => {
    const ctx = buildCountCtx();

    try {
      await getCommentsCount({ urls: 'https://x' as unknown as string[] }, ctx);
      throw new Error('expected getCommentsCount to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.FAIL);
    }
  });

  it('rejects when urls contains a non-string element', async () => {
    const ctx = buildCountCtx();

    await expect(
      getCommentsCount({ urls: ['/a', 1 as unknown as string] }, ctx),
    ).rejects.toMatchObject({ code: ResponseCode.FAIL });
  });
});

describe('getRecentComments > urls validation', () => {
  const buildRecentCtx = (): { ctx: RequestCtx; recent: ReturnType<typeof vi.fn> } => {
    const recent = vi.fn<() => Promise<Comment[]>>().mockResolvedValue([]);
    const db = {
      comment: {
        recent,
      },
    };

    return { ctx: buildCtx({ db: db as unknown as RequestCtx['db'] }), recent };
  };

  it('accepts an omitted urls field', async () => {
    const { ctx } = buildRecentCtx();
    const result = await getRecentComments({}, ctx);

    expect(result.data).toEqual([]);
  });

  it('rejects when urls is present but not an array of strings', async () => {
    const { ctx } = buildRecentCtx();

    await expect(
      getRecentComments({ urls: 'https://x' as unknown as string[] }, ctx),
    ).rejects.toMatchObject({ code: ResponseCode.FAIL });
  });

  it.each([
    { pageSize: 0, expected: 10 },
    { pageSize: -1, expected: 10 },
    { pageSize: 1.5, expected: 10 },
    { pageSize: 101, expected: 100 },
  ])('normalizes pageSize=$pageSize to $expected', async ({ pageSize, expected }) => {
    const { ctx, recent } = buildRecentCtx();

    await getRecentComments({ pageSize }, ctx);

    expect(recent).toHaveBeenCalledWith(undefined, false, expected);
  });
});

describe('commentLike', () => {
  const buildLikeCtx = (matched: boolean) => {
    const toggleVote = vi.fn<() => Promise<boolean>>().mockResolvedValue(matched);
    const ctx = buildCtx({
      uid: mkUid('voter-uid'),
      db: { comment: { toggleVote } } as unknown as RequestCtx['db'],
    });

    return { ctx, toggleVote };
  };

  it('defaults type to up and forwards id + uid to toggleVote', async () => {
    const { ctx, toggleVote } = buildLikeCtx(true);
    const result = await commentLike({ id: 'c1' }, ctx);

    expect(result).toEqual({ updated: 1 });
    expect(toggleVote).toHaveBeenCalledWith('c1', 'voter-uid', 'up');
  });

  it('rejects an unknown like type', async () => {
    const { ctx, toggleVote } = buildLikeCtx(true);

    await expect(commentLike({ id: 'c1', type: 'sideways' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.FAIL,
    });
    expect(toggleVote).not.toHaveBeenCalled();
  });

  it('throws when the comment is missing (toggleVote returns false)', async () => {
    const { ctx } = buildLikeCtx(false);

    await expect(commentLike({ id: 'missing' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.FAIL,
    });
  });
});

describe('commentSubmit', () => {
  it('saves a row and schedules post-submit work when no guards reject', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const waitUntil = vi.fn();
    const ctx = { ...buildSubmitCtx({}, fake), waitUntil };

    const result = await commentSubmit(submitPayload(), ctx);

    expect(typeof result.id).toBe('string');
    expect(fake.saved).toHaveLength(1);
    expect(fake.saved[0]?._id).toBe(result.id);
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
  });

  it('does not save when the per-IP frequency cap is reached', async () => {
    const fake: FakeDb = { saved: [], perIp: 10, global: 0 };
    const ctx = buildSubmitCtx({}, fake);

    await expect(commentSubmit(submitPayload(), ctx)).rejects.toMatchObject({
      code: ResponseCode.FAIL,
    });
    expect(fake.saved).toHaveLength(0);
  });

  it('does not save when Turnstile is enabled but the token is missing', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const ctx: RequestCtx = {
      ...buildSubmitCtx({ CAPTCHA_PROVIDER: 'Turnstile' }, fake),
      env: { TURNSTILE_SECRET_KEY: 'sk-test' } as RequestCtx['env'],
    };

    await expect(commentSubmit(submitPayload(), ctx)).rejects.toMatchObject({
      code: ResponseCode.CREDENTIALS_INVALID,
    });
    expect(fake.saved).toHaveLength(0);
  });
});

describe('commentGetForAdmin', () => {
  const ADMIN = 'admin-uid';

  const buildAdminCtx = (uid: string, rows: Comment[] = []) => {
    const countForAdmin = vi
      .fn<(...args: unknown[]) => Promise<number>>()
      .mockResolvedValue(rows.length);
    const listForAdmin = vi
      .fn<(...args: unknown[]) => Promise<Comment[]>>()
      .mockResolvedValue(rows);
    const ctx = buildCtx({
      uid: mkUid(uid),
      config: { ADMIN_PASS: md5(ADMIN) },
      db: { comment: { countForAdmin, listForAdmin } } as unknown as RequestCtx['db'],
    });

    return { ctx, countForAdmin, listForAdmin };
  };

  it.each<{ type: string; isSpam: Bit | undefined }>([
    { type: 'HIDDEN', isSpam: 1 },
    { type: 'VISIBLE', isSpam: 0 },
    { type: 'ALL', isSpam: undefined },
  ])('maps payload.type=$type to filter.isSpam=$isSpam', async ({ type, isSpam }) => {
    const { ctx, listForAdmin, countForAdmin } = buildAdminCtx(ADMIN);
    await commentGetForAdmin({ per: 10, page: 1, type }, ctx);

    expect(listForAdmin.mock.calls[0]?.[0]).toMatchObject({ isSpam });
    expect(countForAdmin.mock.calls[0]?.[0]).toMatchObject({ isSpam });
  });

  it('wraps and escapes the LIKE keyword', async () => {
    const { ctx, listForAdmin } = buildAdminCtx(ADMIN);
    await commentGetForAdmin({ per: 10, page: 1, keyword: '50%_off\\' }, ctx);

    expect(listForAdmin.mock.calls[0]?.[0]).toMatchObject({ keyword: '%50\\%\\_off\\\\%' });
  });

  it('passes per/page through as limit/offset and defaults sort to newest', async () => {
    const { ctx, listForAdmin } = buildAdminCtx(ADMIN);
    await commentGetForAdmin({ per: 20, page: 3 }, ctx);

    expect(listForAdmin).toHaveBeenCalledWith(expect.anything(), 20, 40, 'newest');
  });

  it.each<'newest' | 'oldest' | 'popular'>(['newest', 'oldest', 'popular'])(
    'passes sort=%s through to listForAdmin',
    async (sort) => {
      const { ctx, listForAdmin } = buildAdminCtx(ADMIN);
      await commentGetForAdmin({ per: 10, page: 1, sort }, ctx);

      expect(listForAdmin).toHaveBeenCalledWith(expect.anything(), 10, 0, sort);
    },
  );

  it('falls back to newest for an unrecognized sort value', async () => {
    const { ctx, listForAdmin } = buildAdminCtx(ADMIN);
    await commentGetForAdmin({ per: 10, page: 1, sort: 'random' }, ctx);

    expect(listForAdmin).toHaveBeenCalledWith(expect.anything(), 10, 0, 'newest');
  });

  it('reformats stored ipRegion (pipe-delimited → · separated) on the way out', async () => {
    const row: Comment = { ...baseRow, ipRegion: 'China|0|Beijing||' };
    const { ctx } = buildAdminCtx(ADMIN, [row]);
    const result = (await commentGetForAdmin({ per: 10, page: 1 }, ctx)) as {
      data: Array<{ ipRegion: string }>;
    };

    expect(result.data[0]?.ipRegion).toBe('China · Beijing');
  });

  it('rejects a non-admin caller', async () => {
    const { ctx, listForAdmin } = buildAdminCtx('guest');

    await expect(commentGetForAdmin({ per: 10, page: 1 }, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });
    expect(listForAdmin).not.toHaveBeenCalled();
  });
});

describe('commentSetForAdmin', () => {
  const ADMIN = 'admin-uid';

  const buildSetCtx = (uid: string) => {
    const update = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const ctx = buildCtx({
      uid: mkUid(uid),
      config: { ADMIN_PASS: md5(ADMIN) },
      db: { comment: { update } } as unknown as RequestCtx['db'],
    });

    return { ctx, update };
  };

  it('writes only allowlisted fields and stamps `updated`', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
    const { ctx, update } = buildSetCtx(ADMIN);
    await commentSetForAdmin(
      {
        id: 'c1',
        set: { comment: 'edited', isSpam: 1, top: 0, uid: 'spoofed', created: 0 },
      },
      ctx,
    );

    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0];

    if (!call) {
      throw new Error('expected update to have been called');
    }

    const [id, fields] = call as [string, Record<string, unknown> & { updated: number }];

    expect(id).toBe('c1');
    expect(fields).toMatchObject({ comment: 'edited', isSpam: 1, top: 0 });
    expect(fields).not.toHaveProperty('uid');
    expect(fields).not.toHaveProperty('created');
    expect(fields.updated).toBe(Date.now());
  });

  it.each([
    { isSpam: true, top: false, expected: { isSpam: 1, top: 0 } },
    { isSpam: false, top: true, expected: { isSpam: 0, top: 1 } },
  ])('coerces isSpam=$isSpam and top=$top', async ({ isSpam, top, expected }) => {
    const { ctx, update } = buildSetCtx(ADMIN);

    await commentSetForAdmin({ id: 'c1', set: { isSpam, top } }, ctx);

    expect(update.mock.calls[0]?.[1]).toMatchObject(expected);
  });

  it('coerces non-canonical truthy values to 1', async () => {
    const { ctx, update } = buildSetCtx(ADMIN);
    await commentSetForAdmin({ id: 'c1', set: { isSpam: 2 } }, ctx);
    const fields = update.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

    expect(fields?.isSpam).toBe(1);
  });

  it('writes the comment without changing flags', async () => {
    const { ctx, update } = buildSetCtx(ADMIN);
    await commentSetForAdmin({ id: 'c1', set: { comment: 'edited' } }, ctx);
    const fields = update.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

    expect(fields?.comment).toBe('edited');
    expect(fields).not.toHaveProperty('isSpam');
    expect(fields).not.toHaveProperty('top');
  });

  it('rejects a non-admin caller', async () => {
    const { ctx, update } = buildSetCtx('guest');

    await expect(
      commentSetForAdmin({ id: 'c1', set: { comment: 'edited' } }, ctx),
    ).rejects.toMatchObject({ code: ResponseCode.NEED_LOGIN });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects when set is not a plain object', async () => {
    const { ctx } = buildSetCtx(ADMIN);

    await expect(
      commentSetForAdmin(
        { id: 'c1', set: 'not-an-object' as unknown as Record<string, unknown> },
        ctx,
      ),
    ).rejects.toMatchObject({ code: ResponseCode.FAIL });
  });

  it('rejects a non-string comment field', async () => {
    const { ctx } = buildSetCtx(ADMIN);

    await expect(commentSetForAdmin({ id: 'c1', set: { comment: 42 } }, ctx)).rejects.toMatchObject(
      { code: ResponseCode.FAIL },
    );
  });
});

describe('commentDeleteForAdmin', () => {
  const ADMIN = 'admin-uid';

  const buildDelCtx = (uid: string) => {
    const del = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const ctx = buildCtx({
      uid: mkUid(uid),
      config: { ADMIN_PASS: md5(ADMIN) },
      db: { comment: { delete: del } } as unknown as RequestCtx['db'],
    });

    return { ctx, del };
  };

  it('forwards the id and returns deleted:1 when admin', async () => {
    const { ctx, del } = buildDelCtx(ADMIN);
    const result = await commentDeleteForAdmin({ id: 'c1' }, ctx);

    expect(result).toEqual({ deleted: 1 });
    expect(del).toHaveBeenCalledWith('c1');
  });

  it('rejects a non-admin caller', async () => {
    const { ctx, del } = buildDelCtx('guest');

    await expect(commentDeleteForAdmin({ id: 'c1' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });
    expect(del).not.toHaveBeenCalled();
  });
});

describe('commentDeleteForUser', () => {
  const buildOwnerCtx = (uid: string, row?: Comment) => {
    const byId = vi.fn<() => Promise<Comment | undefined>>().mockResolvedValue(row);
    const del = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const ctx = buildCtx({
      uid: mkUid(uid),
      db: { comment: { byId, delete: del } } as unknown as RequestCtx['db'],
    });

    return { ctx, byId, del };
  };

  it('deletes when the caller owns the row', async () => {
    const row: Comment = { ...baseRow, uid: 'owner-uid' };
    const { ctx, del } = buildOwnerCtx('owner-uid', row);
    const result = await commentDeleteForUser({ id: 'c1' }, ctx);

    expect(result).toEqual({ deleted: 1 });
    expect(del).toHaveBeenCalledWith('c1');
  });

  it('rejects an anonymous caller (empty uid)', async () => {
    const { ctx, del } = buildOwnerCtx('');

    await expect(commentDeleteForUser({ id: 'c1' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('rejects when the row is missing', async () => {
    const { ctx, del } = buildOwnerCtx('owner-uid', undefined);

    await expect(commentDeleteForUser({ id: 'c1' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.FAIL,
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('rejects when the caller is not the author', async () => {
    const row: Comment = { ...baseRow, uid: 'other-uid' };
    const { ctx, del } = buildOwnerCtx('owner-uid', row);

    await expect(commentDeleteForUser({ id: 'c1' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.FAIL,
    });
    expect(del).not.toHaveBeenCalled();
  });
});

describe('commentExportForAdmin', () => {
  const ADMIN = 'admin-uid';

  const buildExportCtx = (uid: string) => {
    const commentExport = vi
      .fn<() => Promise<{ kind: string }[]>>()
      .mockResolvedValue([{ kind: 'comment' }]);
    const counterExport = vi
      .fn<() => Promise<{ kind: string }[]>>()
      .mockResolvedValue([{ kind: 'counter' }]);
    const configExport = vi
      .fn<() => Promise<{ kind: string }[]>>()
      .mockResolvedValue([{ kind: 'config' }]);
    const ctx = buildCtx({
      uid: mkUid(uid),
      config: { ADMIN_PASS: md5(ADMIN) },
      db: {
        comment: { exportAll: commentExport },
        counter: { exportAll: counterExport },
        config: { exportAll: configExport },
      } as unknown as RequestCtx['db'],
    });

    return { ctx, commentExport, counterExport, configExport };
  };

  it('defaults to the comment collection', async () => {
    const { ctx, commentExport, counterExport, configExport } = buildExportCtx(ADMIN);
    const result = await commentExportForAdmin({}, ctx);

    expect(commentExport).toHaveBeenCalled();
    expect(counterExport).not.toHaveBeenCalled();
    expect(configExport).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ kind: 'comment' }] });
  });

  it.each(['comment', 'counter', 'config'] as const)(
    'routes collection=%s to the matching DB.exportAll',
    async (collection) => {
      const { ctx, commentExport, counterExport, configExport } = buildExportCtx(ADMIN);
      const result = await commentExportForAdmin({ collection }, ctx);

      expect(result).toEqual({ data: [{ kind: collection }] });
      const map = { comment: commentExport, counter: counterExport, config: configExport };
      for (const [name, spy] of Object.entries(map)) {
        if (name === collection) {
          expect(spy).toHaveBeenCalled();
        } else {
          expect(spy).not.toHaveBeenCalled();
        }
      }
    },
  );

  it('rejects a non-admin caller', async () => {
    const { ctx, commentExport } = buildExportCtx('guest');

    await expect(commentExportForAdmin({}, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });
    expect(commentExport).not.toHaveBeenCalled();
  });

  it('rejects an unsupported collection', async () => {
    const { ctx } = buildExportCtx(ADMIN);

    await expect(commentExportForAdmin({ collection: 'evil' }, ctx)).rejects.toBeInstanceOf(
      TwikooError,
    );
  });
});
