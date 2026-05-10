import type { EventPayloads } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildComment } from '@/lib/comment-build';
import { ResponseCode, TwikooError } from '@/lib/errors';
import { md5, sha256 } from '@/twikoo';
import { mkUid } from '@/types';
import { buildCtx } from '@tests/helpers/ctx';

const submitPayload = (
  overrides: Partial<EventPayloads['COMMENT_SUBMIT']> = {},
): EventPayloads['COMMENT_SUBMIT'] => ({
  url: '/post',
  ua: 'Mozilla',
  comment: 'hi',
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildComment', () => {
  it('rejects when a non-admin posts using the blogger email', async () => {
    const ctx = buildCtx({
      uid: mkUid('guest'),
      config: { BLOGGER_EMAIL: 'me@example.com' },
    });

    try {
      await buildComment(submitPayload({ mail: 'ME@example.com' }), ctx);
      throw new Error('expected buildComment to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.NEED_LOGIN);
    }
  });

  it('marks master=1 when the admin posts as the blogger', async () => {
    const adminUid = 'admin-uid';
    const ctx = buildCtx({
      uid: mkUid(adminUid),
      config: { ADMIN_PASS: md5(adminUid), BLOGGER_EMAIL: 'me@example.com' },
    });

    const row = await buildComment(submitPayload({ mail: 'me@example.com' }), ctx);
    expect(row.master).toBe(1);
    expect(row.isSpam).toBe(0);
  });

  it('uses sha256 for mailMd5 by default and md5 when GRAVATAR_CDN=cravatar.cn', async () => {
    const mail = 'user@example.com';

    const sha256Ctx = buildCtx({});
    const sha256Row = await buildComment(submitPayload({ mail }), sha256Ctx);
    expect(sha256Row.mailMd5).toBe(sha256(mail));

    const md5Ctx = buildCtx({ config: { GRAVATAR_CDN: 'cravatar.cn' } });
    const md5Row = await buildComment(submitPayload({ mail }), md5Ctx);
    expect(md5Row.mailMd5).toBe(md5(mail));
  });

  it('sanitizes HTML in the comment body', async () => {
    const ctx = buildCtx({});
    const row = await buildComment(
      submitPayload({ comment: '<script>alert(1)</script><b>ok</b>' }),
      ctx,
    );
    expect(row.comment).not.toContain('<script');
    expect(row.comment).not.toContain('alert(1)');
    expect(row.comment).toContain('<b>ok</b>');
  });

  it('initializes ups/downs to empty JSON arrays and top to 0', async () => {
    const ctx = buildCtx({});
    const row = await buildComment(submitPayload(), ctx);
    expect(row.ups).toBe('[]');
    expect(row.downs).toBe('[]');
    expect(row.top).toBe(0);
  });

  it('derives pid from rid when pid is omitted', async () => {
    const ctx = buildCtx({});
    const row = await buildComment(submitPayload({ rid: 'parent-id' }), ctx);
    expect(row.pid).toBe('parent-id');
    expect(row.rid).toBe('parent-id');
  });
});
