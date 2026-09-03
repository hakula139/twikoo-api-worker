import type { Comment, NewComment } from '@/db';
import type { RequestCtx, TwikooConfig } from '@/types';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postSubmit } from '@/lib/comment-post-submit';
import * as twikoo from '@/twikoo';
import { mkCommentId } from '@/types';
import { buildCtx } from '@tests/helpers/ctx';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(twikoo.logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface PostSubmitDb {
  byIdRows: Map<string, Comment>;
  updateSpam: ReturnType<typeof vi.fn>;
}

const buildPostCtx = (
  db: PostSubmitDb,
  env: Partial<RequestCtx['env']> = {},
  config: TwikooConfig = {},
): RequestCtx =>
  buildCtx({
    env: env as RequestCtx['env'],
    config,
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
    uid: 'reader-1',
    nick: 'Reader',
    mail: 'reader@example.com',
    mailMd5: '',
    link: '',
    ua: 'Mozilla/5.0',
    ip: '192.0.2.1',
    ipRegion: '',
    master: 0,
    url: '/about-me/',
    href: 'https://hakula.xyz/about-me/',
    comment: '感谢分享。',
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

  it('leaves isSpam=0 and skips updateSpam when Akismet says clean', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('false', { status: 200 }));
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx({ byIdRows: new Map(), updateSpam }, { AKISMET_KEY: 'ak-key' });
    const saved = baseSaved();

    await postSubmit(saved, ctx);

    expect(saved.isSpam).toBe(0);
    expect(updateSpam).not.toHaveBeenCalled();
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
    expect(twikoo.sendNotice).toHaveBeenCalledOnce();
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
      const undef = await getParent({});
      expect(undef).toBeUndefined();
    });
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx({ byIdRows: new Map([['parent-1', parent]]), updateSpam });

    await postSubmit(baseSaved(), ctx);

    expect(captured).toBe(parent);
  });

  it('routes Telegram through the Worker sender and sends both configured mail notices', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const parent = baseSaved({ _id: mkCommentId('parent-1') });
    let capturedParent: unknown;
    vi.mocked(twikoo.noticeReply).mockImplementationOnce(async (current, _config, getParent) => {
      expect(current).toEqual(expect.objectContaining({ _id: 'saved-1', id: 'saved-1' }));
      capturedParent = await getParent({ pid: 'parent-1' });
    });
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx(
      { byIdRows: new Map([['parent-1', parent]]), updateSpam },
      {},
      {
        PUSHOO_CHANNEL: 'telegram',
        PUSHOO_TOKEN: '123456:bot_token#-100123456',
        SC_MAIL_NOTIFY: 'true',
        SITE_NAME: 'Hakula',
      },
    );

    await postSubmit(baseSaved(), ctx);

    expect(twikoo.sendNotice).not.toHaveBeenCalled();
    expect(twikoo.noticeMaster).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'saved-1', id: 'saved-1' }),
      expect.objectContaining({ PUSHOO_CHANNEL: 'telegram' }),
    );
    expect(twikoo.noticeReply).toHaveBeenCalledOnce();
    expect(capturedParent).toBe(parent);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('defaults to Telegram-only master notices while retaining reply emails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx(
      { byIdRows: new Map(), updateSpam },
      {},
      {
        PUSHOO_CHANNEL: 'telegram',
        PUSHOO_TOKEN: '123456:bot_token#-100123456',
        SITE_NAME: 'Hakula',
      },
    );

    await postSubmit(baseSaved(), ctx);

    expect(twikoo.noticeMaster).not.toHaveBeenCalled();
    expect(twikoo.noticeReply).toHaveBeenCalledOnce();
  });

  it('does not notify the blogger about their own comment', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx(
      { byIdRows: new Map(), updateSpam },
      {},
      {
        BLOGGER_EMAIL: ' A@example.com ',
        PUSHOO_CHANNEL: 'telegram',
        PUSHOO_TOKEN: '123456:bot_token#-100123456',
      },
    );

    await postSubmit(baseSaved(), ctx);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(twikoo.noticeReply).toHaveBeenCalledOnce();
  });

  it('uses upstream notices when Telegram has no token', async () => {
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx(
      { byIdRows: new Map(), updateSpam },
      {},
      { PUSHOO_CHANNEL: 'telegram' },
    );

    await postSubmit(baseSaved(), ctx);

    expect(twikoo.sendNotice).toHaveBeenCalledOnce();
    expect(twikoo.noticeMaster).not.toHaveBeenCalled();
    expect(twikoo.noticeReply).not.toHaveBeenCalled();
  });

  it('skips unsupported push adapters while retaining reply emails', async () => {
    const warnSpy = vi.spyOn(twikoo.logger, 'warn').mockImplementation(() => undefined);
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx(
      { byIdRows: new Map(), updateSpam },
      {},
      { PUSHOO_CHANNEL: 'bark', PUSHOO_TOKEN: 'token' },
    );

    await postSubmit(baseSaved(), ctx);

    expect(twikoo.sendNotice).not.toHaveBeenCalled();
    expect(twikoo.noticeMaster).not.toHaveBeenCalled();
    expect(twikoo.noticeReply).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith('Configured instant-push channel is not supported.');
  });

  it('skips all notices for excluded spam', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx(
      { byIdRows: new Map(), updateSpam },
      {},
      {
        PUSHOO_CHANNEL: 'telegram',
        PUSHOO_TOKEN: '123456:bot_token#-100123456',
        NOTIFY_SPAM: 'false',
      },
    );

    await postSubmit(baseSaved({ isSpam: 1 }), ctx);

    expect(twikoo.sendNotice).not.toHaveBeenCalled();
    expect(twikoo.noticeMaster).not.toHaveBeenCalled();
    expect(twikoo.noticeReply).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for mail to settle and swallows native Telegram failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('telegram down'));
    const replyDone = vi.fn();
    vi.mocked(twikoo.noticeReply).mockImplementationOnce(async () => {
      await Promise.resolve();
      replyDone();
    });
    const errorSpy = vi.spyOn(twikoo.logger, 'error').mockImplementation(() => undefined);
    const updateSpam = vi.fn(async () => undefined);
    const ctx = buildPostCtx(
      { byIdRows: new Map(), updateSpam },
      {},
      {
        PUSHOO_CHANNEL: 'telegram',
        PUSHOO_TOKEN: '123456:bot_token#-100123456',
        SITE_NAME: 'Hakula',
      },
    );

    await expect(postSubmit(baseSaved(), ctx)).resolves.toBeUndefined();

    expect(replyDone).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'sendNotice' }),
      'postSubmit failed',
    );
  });
});
