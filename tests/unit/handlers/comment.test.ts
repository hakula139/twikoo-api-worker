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

const baseRow: Comment = {
  _id: mkCommentId('c1'),
  uid: 'u',
  nick: 'n',
  mail: '',
  mailMd5: '',
  link: '',
  ua: '',
  ip: '',
  ipRegion: '',
  master: 0,
  url: '/post',
  href: '',
  comment: 'hi',
  pid: '',
  rid: '',
  isSpam: 0,
  created: 0,
  updated: 0,
  ups: '[]' as JsonString<string[]>,
  downs: '[]' as JsonString<string[]>,
  top: 0,
  avatar: '',
};

interface FakeDb {
  saved: NewComment[];
  perIp: number;
  global: number;
}

const buildSubmitCtx = (config: TwikooConfig, fake: FakeDb): RequestCtx => {
  const db = {
    comment: {
      save: vi.fn(async (c: NewComment) => {
        fake.saved.push(c);
      }),
      countSinceByIp: vi.fn(async () => fake.perIp),
      countSince: vi.fn(async () => fake.global),
      byId: vi.fn(async () => undefined as Comment | undefined),
      updateSpam: vi.fn(async () => undefined),
    },
  };
  return buildCtx({
    ip: mkIp('1.2.3.4'),
    uid: mkUid('guest-uid'),
    config,
    db: db as unknown as RequestCtx['db'],
  });
};

const submitPayload = (overrides: Partial<Record<string, string>> = {}) => ({
  url: '/post',
  ua: 'Mozilla',
  comment: 'hi',
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('commentGet > malformed votes JSON', () => {
  const buildGetCtx = (rows: Comment[]): RequestCtx => {
    const db = {
      comment: {
        count: vi.fn(async () => rows.length),
        // First call probes head/main; second call (top=1) returns empty.
        list: vi
          .fn<(...args: unknown[]) => Promise<Comment[]>>()
          .mockResolvedValueOnce(rows)
          .mockResolvedValue([]),
        replies: vi.fn(async () => [] as Comment[]),
      },
    };
    return buildCtx({ uid: mkUid('guest-uid'), db: db as unknown as RequestCtx['db'] });
  };

  it('treats malformed ups as empty array and still returns the comment', async () => {
    const bad: Comment = {
      ...baseRow,
      _id: mkCommentId('bad'),
      ups: '{not-json' as JsonString<string[]>,
    };
    const ctx = buildGetCtx([bad]);
    const result = await commentGet({ url: '/post' }, ctx);
    expect(result.count).toBe(1);
    const data = result.data as Array<{ ups?: unknown }>;
    expect(data).toHaveLength(1);
  });

  it('truncates very long malformed JSON in the warning log', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const longBad = '{not-json-'.repeat(20);
    const bad: Comment = {
      ...baseRow,
      _id: mkCommentId('long'),
      ups: longBad as JsonString<string[]>,
    };

    await commentGet({ url: '/post' }, buildGetCtx([bad]));

    const logged = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(logged).toContain('...');
    expect(logged).not.toContain(longBad);
  });
});

describe('commentGet > config-driven branches', () => {
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
        count: vi.fn(async () => rows.length),
        list,
        replies: vi.fn(async () => [] as Comment[]),
      },
    };
    return {
      ctx: buildCtx({ uid: mkUid('guest-uid'), config, db: db as unknown as RequestCtx['db'] }),
      list,
    };
  };

  it('skips the top-pinned query when TOP_DISABLED=true', async () => {
    const { ctx, list } = buildGetCtx([baseRow], { TOP_DISABLED: 'true' });
    await commentGet({ url: '/post' }, ctx);
    // Single call (head/main only); the second call for the top query is suppressed.
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('runs the top-pinned query when TOP_DISABLED is unset and `before` is absent', async () => {
    const { ctx, list } = buildGetCtx([baseRow]);
    await commentGet({ url: '/post' }, ctx);
    expect(list).toHaveBeenCalledTimes(2);
  });

  // Stand in for upstream's strip: when commentGet calls parseComment with
  // SHOW_REGION='false', the real impl drops ipRegion. We mimic that here so
  // the worker's own SHOW_REGION-true patch path becomes observable.
  const stripIpRegion = (rows: readonly unknown[]): unknown[] =>
    rows.map((r) => {
      const { ipRegion: _ipRegion, ...rest } = r as Comment;
      return { ...rest, id: rest._id };
    });

  it('patches ipRegion onto each dto when SHOW_REGION=true', async () => {
    const row: Comment = { ...baseRow, ipRegion: 'Beijing' };
    vi.mocked(twikoo.parseComment).mockImplementation(stripIpRegion);
    const { ctx } = buildGetCtx([row], { SHOW_REGION: 'true' });
    const result = await commentGet({ url: '/post' }, ctx);
    const data = result.data as Array<{ ipRegion?: string }>;
    expect(data[0]?.ipRegion).toBe('Beijing');
  });

  it('does not patch ipRegion when SHOW_REGION is unset', async () => {
    const row: Comment = { ...baseRow, ipRegion: 'Beijing' };
    vi.mocked(twikoo.parseComment).mockImplementation(stripIpRegion);
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
        countByUrls: vi.fn(async () => new Map<string, number>()),
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
  const buildRecentCtx = (): RequestCtx => {
    const db = {
      comment: {
        recent: vi.fn(async () => [] as Comment[]),
      },
    };
    return buildCtx({ db: db as unknown as RequestCtx['db'] });
  };

  it('accepts an omitted urls field', async () => {
    const ctx = buildRecentCtx();
    const result = await getRecentComments({}, ctx);
    expect(result.data).toEqual([]);
  });

  it('rejects when urls is present but not an array of strings', async () => {
    const ctx = buildRecentCtx();
    await expect(
      getRecentComments({ urls: 'https://x' as unknown as string[] }, ctx),
    ).rejects.toMatchObject({ code: ResponseCode.FAIL });
  });
});

describe('commentLike', () => {
  const buildLikeCtx = (matched: boolean) => {
    const toggleVote = vi.fn(async () => matched);
    const ctx = buildCtx({
      uid: mkUid('voter-uid'),
      db: { comment: { toggleVote } } as unknown as RequestCtx['db'],
    });
    return { ctx, toggleVote };
  };

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

  it('defaults type to up and forwards id + uid to toggleVote', async () => {
    const { ctx, toggleVote } = buildLikeCtx(true);
    const result = await commentLike({ id: 'c1' }, ctx);
    expect(result).toEqual({ updated: 1 });
    expect(toggleVote).toHaveBeenCalledWith('c1', 'voter-uid', 'up');
  });
});

// Boundary cases for the guards live in tests/unit/lib/{rate-limit,captcha-guard}.
// These integration smokes pin the wiring: commentSubmit invokes the guards
// before save and the build step before save.
describe('commentSubmit', () => {
  it('saves a row when no guards reject', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const ctx = buildSubmitCtx({}, fake);

    const result = await commentSubmit(submitPayload(), ctx);

    expect(typeof result.id).toBe('string');
    expect(fake.saved).toHaveLength(1);
    expect(fake.saved[0]?._id).toBe(result.id);
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

  it('rejects a non-admin caller', async () => {
    const { ctx, listForAdmin } = buildAdminCtx('guest');
    await expect(commentGetForAdmin({ per: 10, page: 1 }, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });
    expect(listForAdmin).not.toHaveBeenCalled();
  });

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

  it('passes per/page through as limit/offset', async () => {
    const { ctx, listForAdmin } = buildAdminCtx(ADMIN);
    await commentGetForAdmin({ per: 20, page: 3 }, ctx);
    expect(listForAdmin).toHaveBeenCalledWith(expect.anything(), 20, 40);
  });

  it('reformats stored ipRegion (pipe-delimited → · separated) on the way out', async () => {
    const row: Comment = { ...baseRow, ipRegion: 'China|0|Beijing||' };
    const { ctx } = buildAdminCtx(ADMIN, [row]);
    const result = (await commentGetForAdmin({ per: 10, page: 1 }, ctx)) as {
      data: Array<{ ipRegion: string }>;
    };
    expect(result.data[0]?.ipRegion).toBe('China · Beijing');
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

  it('writes only allowlisted fields and stamps `updated`', async () => {
    const { ctx, update } = buildSetCtx(ADMIN);
    const before = Date.now();
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
    expect(fields.updated).toBeGreaterThanOrEqual(before);
  });

  it('hides + un-pins (isSpam: true, top: false) via truthiness', async () => {
    const { ctx, update } = buildSetCtx(ADMIN);
    await commentSetForAdmin({ id: 'c1', set: { isSpam: true, top: false } }, ctx);
    const fields = update.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(fields?.isSpam).toBe(1);
    expect(fields?.top).toBe(0);
  });

  it('un-hides + pins (isSpam: false, top: true) via truthiness', async () => {
    const { ctx, update } = buildSetCtx(ADMIN);
    await commentSetForAdmin({ id: 'c1', set: { isSpam: false, top: true } }, ctx);
    const fields = update.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(fields?.isSpam).toBe(0);
    expect(fields?.top).toBe(1);
  });

  it('coerces non-canonical truthy values to 1 (no longer rejected)', async () => {
    const { ctx, update } = buildSetCtx(ADMIN);
    await commentSetForAdmin({ id: 'c1', set: { isSpam: 2 } }, ctx);
    const fields = update.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(fields?.isSpam).toBe(1);
  });

  it('writes only updated when the set is comment-only (skips isSpam / top branches)', async () => {
    const { ctx, update } = buildSetCtx(ADMIN);
    await commentSetForAdmin({ id: 'c1', set: { comment: 'edited' } }, ctx);
    const fields = update.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(fields?.comment).toBe('edited');
    expect(fields).not.toHaveProperty('isSpam');
    expect(fields).not.toHaveProperty('top');
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
    const del = vi.fn(async () => undefined);
    const ctx = buildCtx({
      uid: mkUid(uid),
      config: { ADMIN_PASS: md5(ADMIN) },
      db: { comment: { delete: del } } as unknown as RequestCtx['db'],
    });
    return { ctx, del };
  };

  it('rejects a non-admin caller', async () => {
    const { ctx, del } = buildDelCtx('guest');
    await expect(commentDeleteForAdmin({ id: 'c1' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('forwards the id and returns deleted:1 when admin', async () => {
    const { ctx, del } = buildDelCtx(ADMIN);
    const result = await commentDeleteForAdmin({ id: 'c1' }, ctx);
    expect(result).toEqual({ deleted: 1 });
    expect(del).toHaveBeenCalledWith('c1');
  });
});

describe('commentDeleteForUser', () => {
  const buildOwnerCtx = (uid: string, row?: Comment) => {
    const byId = vi.fn(async () => row);
    const del = vi.fn(async () => undefined);
    const ctx = buildCtx({
      uid: mkUid(uid),
      db: { comment: { byId, delete: del } } as unknown as RequestCtx['db'],
    });
    return { ctx, byId, del };
  };

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

  it('deletes when the caller owns the row', async () => {
    const row: Comment = { ...baseRow, uid: 'owner-uid' };
    const { ctx, del } = buildOwnerCtx('owner-uid', row);
    const result = await commentDeleteForUser({ id: 'c1' }, ctx);
    expect(result).toEqual({ deleted: 1 });
    expect(del).toHaveBeenCalledWith('c1');
  });
});

describe('commentExportForAdmin', () => {
  const ADMIN = 'admin-uid';

  const buildExportCtx = (uid: string) => {
    const commentExport = vi.fn(async () => [{ kind: 'comment' }]);
    const counterExport = vi.fn(async () => [{ kind: 'counter' }]);
    const configExport = vi.fn(async () => [{ kind: 'config' }]);
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

  it('rejects a non-admin caller', async () => {
    const { ctx, commentExport } = buildExportCtx('guest');
    await expect(commentExportForAdmin({}, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });
    expect(commentExport).not.toHaveBeenCalled();
  });

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
      await commentExportForAdmin({ collection }, ctx);
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

  it('rejects an unsupported collection', async () => {
    const { ctx } = buildExportCtx(ADMIN);
    await expect(commentExportForAdmin({ collection: 'evil' }, ctx)).rejects.toBeInstanceOf(
      TwikooError,
    );
  });
});
