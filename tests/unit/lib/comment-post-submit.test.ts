import type { Comment, NewComment } from '@/db';
import type { RequestCtx } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { postSubmit } from '@/lib/comment-post-submit';
import * as twikoo from '@/twikoo';
import { mkCommentId } from '@/types';
import { buildCtx } from '@tests/helpers/ctx';

afterEach(() => {
  vi.restoreAllMocks();
});

interface PostSubmitDb {
  byIdRows: Map<string, Comment>;
  updateSpam: ReturnType<typeof vi.fn>;
}

const buildPostCtx = (db: PostSubmitDb, env: Partial<RequestCtx['env']> = {}): RequestCtx =>
  buildCtx({
    env: env as RequestCtx['env'],
    db: {
      comment: {
        byId: vi.fn(async (id: string) => db.byIdRows.get(id)),
        updateSpam: db.updateSpam,
      },
    } as unknown as RequestCtx['db'],
  });

const baseSaved = (overrides: Partial<NewComment> = {}): Comment => {
  const row: NewComment = {
    _id: mkCommentId('saved-1'),
    uid: 'u',
    nick: 'n',
    mail: 'a@example.com',
    mailMd5: '',
    link: '',
    ua: 'Mozilla',
    ip: '1.2.3.4',
    ipRegion: '',
    master: 0,
    url: '/post',
    href: 'https://blog.example/post',
    comment: 'hi',
    pid: '',
    rid: '',
    isSpam: 0,
    created: 1,
    updated: 1,
    ups: '[]' as Comment['ups'],
    downs: '[]' as Comment['downs'],
    top: 0,
    avatar: '',
    ...overrides,
  };
  return row as Comment;
};

describe('postSubmit', () => {
  it('flags isSpam=1 and writes back when Akismet says spam', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('true', { status: 200 }));
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx({ byIdRows: new Map(), updateSpam }, { AKISMET_KEY: 'ak-key' });
    const saved = baseSaved();

    await postSubmit(saved, ctx);

    expect(saved.isSpam).toBe(1);
    expect(updateSpam).toHaveBeenCalledTimes(1);
    const [id, isSpam] = updateSpam.mock.calls[0] as unknown as [string, number];
    expect(id).toBe('saved-1');
    expect(isSpam).toBe(1);
  });

  it('skips Akismet when the key is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx({ byIdRows: new Map(), updateSpam });

    await postSubmit(baseSaved(), ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateSpam).not.toHaveBeenCalled();
  });

  it('skips Akismet when the key is the MANUAL_REVIEW sentinel', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx({ byIdRows: new Map(), updateSpam }, { AKISMET_KEY: 'MANUAL_REVIEW' });

    await postSubmit(baseSaved(), ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateSpam).not.toHaveBeenCalled();
  });

  it('swallows Akismet errors so sendNotice still runs', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('akismet down'));
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx({ byIdRows: new Map(), updateSpam }, { AKISMET_KEY: 'ak-key' });

    await expect(postSubmit(baseSaved(), ctx)).resolves.toBeUndefined();
    expect(updateSpam).not.toHaveBeenCalled();
  });

  it('swallows sendNotice errors so postSubmit always resolves', async () => {
    vi.mocked(twikoo.sendNotice).mockRejectedValueOnce(new Error('mailer down'));
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx({ byIdRows: new Map(), updateSpam });

    await expect(postSubmit(baseSaved(), ctx)).resolves.toBeUndefined();
  });

  it('wires sendNotice to look up parent comments via ctx.db.comment.byId', async () => {
    const parent = baseSaved({ _id: mkCommentId('parent-1') });
    let captured: unknown;
    vi.mocked(twikoo.sendNotice).mockImplementationOnce(async (_curr, _config, getParent) => {
      captured = await getParent({ pid: 'parent-1' });
      // Empty pid should short-circuit to undefined without hitting byId.
      const undef = await getParent({});
      expect(undef).toBeUndefined();
    });
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx({ byIdRows: new Map([['parent-1', parent]]), updateSpam });

    await postSubmit(baseSaved(), ctx);

    expect(captured).toBe(parent);
  });
});
