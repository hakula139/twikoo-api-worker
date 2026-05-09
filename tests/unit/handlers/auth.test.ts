import type { RequestCtx, TwikooConfig } from '@/types';

import { describe, expect, it, vi } from 'vitest';

import { setPassword } from '@/handlers/auth';
import { ResponseCode, TwikooError } from '@/lib/errors';
import { md5 } from '@/twikoo';
import { mkUid } from '@/types';
import { buildCtx } from '../../helpers/ctx';

const buildAuthCtx = (uid: string, config: TwikooConfig) => {
  const writePatch = vi.fn(async () => undefined);
  const ctx = buildCtx({
    uid: mkUid(uid),
    config,
    db: { config: { writePatch } } as unknown as RequestCtx['db'],
  });
  return { ctx, writePatch };
};

describe('setPassword', () => {
  it('writes a new admin hash when the caller is the existing admin', async () => {
    const adminUid = 'existing-admin-uid';
    const { ctx, writePatch } = buildAuthCtx(adminUid, { ADMIN_PASS: md5(adminUid) });

    await setPassword({ password: 'rotated' }, ctx);

    expect(writePatch).toHaveBeenCalledWith({ ADMIN_PASS: md5('rotated') });
  });

  it('rejects an unauthenticated caller when no admin is set anywhere', async () => {
    const { ctx, writePatch } = buildAuthCtx('anyone', {});

    try {
      await setPassword({ password: 'claim' }, ctx);
      throw new Error('expected setPassword to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.NEED_LOGIN);
    }
    expect(writePatch).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller even when an admin already exists', async () => {
    const { ctx, writePatch } = buildAuthCtx('guest', { ADMIN_PASS: md5('admin-uid') });

    try {
      await setPassword({ password: 'takeover' }, ctx);
      throw new Error('expected setPassword to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.NEED_LOGIN);
    }
    expect(writePatch).not.toHaveBeenCalled();
  });
});
