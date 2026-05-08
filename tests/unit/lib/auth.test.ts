import type { TwikooConfig } from '@/types';

import { describe, expect, it } from 'vitest';

import { isAdmin, requireAdmin } from '@/lib/auth';
import { ResponseCode, TwikooError } from '@/lib/errors';
import { md5 } from '@/twikoo';
import { buildCtx } from '../../helpers/ctx';

const ctxOf = (uid: string, config: TwikooConfig) => buildCtx({ uid, config });

describe('isAdmin', () => {
  it('matches when md5(uid) equals the stored ADMIN_PASS', () => {
    const uid = 'secret-token';
    const config: TwikooConfig = { ADMIN_PASS: md5(uid) };
    expect(isAdmin(uid, config)).toBe(true);
  });

  it('rejects a uid whose hash does not match', () => {
    const config: TwikooConfig = { ADMIN_PASS: md5('admin') };
    expect(isAdmin('not-admin', config)).toBe(false);
  });

  it('returns false when ADMIN_PASS is unset, even if uid hashes match an empty string', () => {
    expect(isAdmin('', {})).toBe(false);
    expect(isAdmin('anything', { ADMIN_PASS: '' })).toBe(false);
  });
});

describe('requireAdmin', () => {
  it('passes silently for the admin uid', () => {
    const uid = 'admin-uid';
    const ctx = ctxOf(uid, { ADMIN_PASS: md5(uid) });
    expect(() => requireAdmin(ctx)).not.toThrow();
  });

  it('throws NEED_LOGIN when the caller is not the admin', () => {
    const ctx = ctxOf('guest', { ADMIN_PASS: md5('admin') });
    try {
      requireAdmin(ctx);
      throw new Error('expected requireAdmin to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.NEED_LOGIN);
    }
  });
});
