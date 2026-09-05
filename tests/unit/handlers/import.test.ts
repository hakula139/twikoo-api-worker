import type { NewComment } from '@/db';
import type { RequestCtx } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { commentImportForAdmin } from '@/handlers/import';
import { ResponseCode, TwikooError } from '@/lib/errors';
import * as twikoo from '@/twikoo';
import { md5 } from '@/twikoo';
import { mkUid } from '@/types';
import { buildCtx } from '@tests/helpers/ctx';

const ADMIN = 'admin-uid';

const buildImportCtx = (uid: string) => {
  const saveMany = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const ctx = buildCtx({
    uid: mkUid(uid),
    config: { ADMIN_PASS: md5(ADMIN) },
    db: { comment: { saveMany } } as unknown as RequestCtx['db'],
  });
  return { ctx, saveMany };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('commentImportForAdmin', () => {
  it('rejects a non-admin caller', async () => {
    const { ctx, saveMany } = buildImportCtx('guest');
    await expect(
      commentImportForAdmin({ source: 'twikoo', file: '[]' }, ctx),
    ).rejects.toMatchObject({ code: ResponseCode.NEED_LOGIN });
    expect(saveMany).not.toHaveBeenCalled();
  });

  it('rejects an unsupported source', async () => {
    const { ctx, saveMany } = buildImportCtx(ADMIN);
    await expect(
      commentImportForAdmin({ source: 'wordpress', file: '[]' }, ctx),
    ).rejects.toMatchObject({ code: ResponseCode.FAIL });
    expect(saveMany).not.toHaveBeenCalled();
  });

  it('captures JSON parse failures into the log and surfaces them as FAIL', async () => {
    const { ctx, saveMany } = buildImportCtx(ADMIN);
    const err = await commentImportForAdmin({ source: 'twikoo', file: '{not-json' }, ctx).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TwikooError);
    expect((err as TwikooError).code).toBe(ResponseCode.FAIL);
    expect((err as TwikooError).message).toContain('解析失败');
    expect(saveMany).not.toHaveBeenCalled();
  });

  it('reports the empty-result branch when upstream returns no rows', async () => {
    vi.mocked(twikoo.commentImportTwikoo).mockResolvedValueOnce([]);
    const { ctx, saveMany } = buildImportCtx(ADMIN);
    const result = await commentImportForAdmin({ source: 'twikoo', file: '[]' }, ctx);
    expect(saveMany).not.toHaveBeenCalled();
    expect(result.log).toContain('未发现可导入的评论');
  });

  it('dispatches twikoo source to commentImportTwikoo and forwards rows to saveMany', async () => {
    vi.mocked(twikoo.commentImportTwikoo).mockResolvedValueOnce([
      { _id: 'pre-existing', nick: 'Hakula', comment: '感谢分享。' },
    ]);
    const { ctx, saveMany } = buildImportCtx(ADMIN);
    const result = await commentImportForAdmin({ source: 'twikoo', file: '[]' }, ctx);
    expect(saveMany).toHaveBeenCalledTimes(1);
    const rows = saveMany.mock.calls[0]?.[0] as NewComment[] | undefined;
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?._id).toBe('pre-existing');
    expect(rows?.[0]?.nick).toBe('Hakula');
    expect(result.log).toContain('导入成功 1 条评论');
  });

  it('mints a fresh _id when the upstream row is missing one', async () => {
    vi.mocked(twikoo.commentImportTwikoo).mockResolvedValueOnce([{ nick: 'Reader' }]);
    const { ctx, saveMany } = buildImportCtx(ADMIN);
    await commentImportForAdmin({ source: 'twikoo', file: '[]' }, ctx);
    const rows = saveMany.mock.calls[0]?.[0] as NewComment[] | undefined;
    expect(rows?.[0]?._id).toMatch(/^[0-9a-z]+$/i);
    expect(rows?.[0]?._id).not.toBe('');
  });

  it.each([
    ['valine', 'commentImportValine'],
    ['artalk', 'commentImportArtalk'],
    ['artalk2', 'commentImportArtalk2'],
  ] as const)('routes source=%s through %s', async (source, fnName) => {
    const fn = twikoo[fnName];
    vi.mocked(fn).mockResolvedValueOnce([]);
    const { ctx } = buildImportCtx(ADMIN);
    await commentImportForAdmin({ source, file: '[]' }, ctx);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('routes source=disqus through the XML parser into commentImportDisqus', async () => {
    vi.mocked(twikoo.commentImportDisqus).mockResolvedValueOnce([]);
    const { ctx } = buildImportCtx(ADMIN);
    const xml = '<disqus><post id="post-1"><message>Thanks for sharing.</message></post></disqus>';
    await commentImportForAdmin({ source: 'disqus', file: xml }, ctx);
    expect(twikoo.commentImportDisqus).toHaveBeenCalledTimes(1);
    const [parsed] = vi.mocked(twikoo.commentImportDisqus).mock.calls[0] ?? [];
    expect(parsed).toEqual({
      disqus: [
        {
          post: [
            {
              $: { id: 'post-1' },
              message: ['Thanks for sharing.'],
            },
          ],
        },
      ],
    });
  });

  it('coerces missing/wrong fields with safe defaults via normalizeRow', async () => {
    vi.mocked(twikoo.commentImportTwikoo).mockResolvedValueOnce([
      {
        _id: 'r1',
        nick: 42 as unknown as string,
        master: '1',
        isSpam: true,
        ups: 'not-an-array',
        downs: ['u1', 'u2'],
        created: 'not-a-number',
      },
    ]);
    const { ctx, saveMany } = buildImportCtx(ADMIN);
    const result = await commentImportForAdmin({ source: 'twikoo', file: '[]' }, ctx);
    const rows = saveMany.mock.calls[0]?.[0] as NewComment[] | undefined;
    const row = rows?.[0];
    expect(row?.nick).toBe('');
    expect(row?.master).toBe(1);
    expect(row?.isSpam).toBe(1);
    expect(row?.ups).toBe('[]');
    expect(row?.downs).toBe('["u1","u2"]');
    expect(typeof row?.created).toBe('number');
    expect(result.log).toMatch(/row r1 ups dropped/);
  });

  it('keeps a pre-stringified string-array verbatim instead of re-encoding', async () => {
    vi.mocked(twikoo.commentImportTwikoo).mockResolvedValueOnce([
      { _id: 'r1', ups: '["a","b"]', downs: '[123]' },
    ]);
    const { ctx, saveMany } = buildImportCtx(ADMIN);
    const result = await commentImportForAdmin({ source: 'twikoo', file: '[]' }, ctx);
    const row = (saveMany.mock.calls[0]?.[0] as NewComment[] | undefined)?.[0];
    expect(row?.ups).toBe('["a","b"]');
    expect(row?.downs).toBe('[]');
    expect(result.log).toMatch(/row r1 downs dropped/);
    expect(result.log).not.toMatch(/row r1 ups dropped/);
  });

  it('drops a string that parses to a non-array JSON value', async () => {
    vi.mocked(twikoo.commentImportTwikoo).mockResolvedValueOnce([
      { _id: 'r1', ups: '42', downs: '{"a":1}' },
    ]);
    const { ctx, saveMany } = buildImportCtx(ADMIN);
    const result = await commentImportForAdmin({ source: 'twikoo', file: '[]' }, ctx);
    const row = (saveMany.mock.calls[0]?.[0] as NewComment[] | undefined)?.[0];
    expect(row?.ups).toBe('[]');
    expect(row?.downs).toBe('[]');
    expect(result.log).toMatch(/row r1 ups dropped: not a string array/);
    expect(result.log).toMatch(/row r1 downs dropped: not a string array/);
  });

  it('logs how many non-string entries were dropped from a live array', async () => {
    vi.mocked(twikoo.commentImportTwikoo).mockResolvedValueOnce([
      { _id: 'r1', ups: ['a', 1, 'b', null] },
    ]);
    const { ctx, saveMany } = buildImportCtx(ADMIN);
    const result = await commentImportForAdmin({ source: 'twikoo', file: '[]' }, ctx);
    const row = (saveMany.mock.calls[0]?.[0] as NewComment[] | undefined)?.[0];
    expect(row?.ups).toBe('["a","b"]');
    expect(result.log).toMatch(/row r1 ups dropped 2 non-string entries/);
  });
});
