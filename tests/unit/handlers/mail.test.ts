import type { RequestCtx } from '@/types';

import { describe, expect, it, vi } from 'vitest';

import { emailTest } from '@/handlers/mail';
import { ResponseCode } from '@/lib/errors';
import * as twikoo from '@/twikoo';
import { md5 } from '@/twikoo';
import { mkUid } from '@/types';
import { buildCtx } from '../../helpers/ctx';

const buildMailCtx = (uid: string, adminUid = 'admin-uid', env: Partial<RequestCtx['env']> = {}) =>
  buildCtx({
    config: { ADMIN_PASS: md5(adminUid) },
    uid: mkUid(uid),
    env: env as RequestCtx['env'],
  });

describe('emailTest', () => {
  it('rejects a non-admin caller before invoking the upstream helper', async () => {
    const ctx = buildMailCtx('guest');

    await expect(emailTest({ mail: 'a@b' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });
    expect(twikoo.emailTest).not.toHaveBeenCalled();
  });

  it('throws when the upstream helper reports an error message', async () => {
    vi.mocked(twikoo.emailTest).mockResolvedValueOnce({ message: 'auth failed' });
    const adminUid = 'admin-uid';
    const ctx = buildMailCtx(adminUid, adminUid);

    await expect(emailTest({ mail: 'a@b' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.FAIL,
      message: 'auth failed',
    });
  });

  it('returns an empty envelope when the upstream helper reports success', async () => {
    vi.mocked(twikoo.emailTest).mockResolvedValueOnce({ result: { sent: true } });
    const adminUid = 'admin-uid';
    const ctx = buildMailCtx(adminUid, adminUid);

    const result = await emailTest({ mail: 'a@b' }, ctx);

    expect(result).toEqual({});
  });

  it('shadows admin-config secrets with env bindings via configWithSecrets', async () => {
    vi.mocked(twikoo.emailTest).mockResolvedValueOnce({});
    const adminUid = 'admin-uid';
    const ctx = buildMailCtx(adminUid, adminUid, {
      SMTP_PASS: 'env-secret',
    });

    await emailTest({ mail: 'a@b' }, ctx);

    expect(twikoo.emailTest).toHaveBeenCalledWith(
      { mail: 'a@b' },
      expect.objectContaining({ SMTP_PASS: 'env-secret' }),
      true,
    );
  });
});
