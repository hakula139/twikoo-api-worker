import type { RequestCtx, TwikooConfig } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPasswordStatus, login, setPassword } from '@/handlers/auth';
import { ResponseCode } from '@/lib/errors';
import * as twikoo from '@/twikoo';
import { md5 } from '@/twikoo';
import { mkUid } from '@/types';
import { buildCtx } from '@tests/helpers/ctx';

const buildAuthCtx = (uid: string, config: TwikooConfig) => {
  const writePatch = vi.fn(async () => undefined);
  const ctx = buildCtx({
    uid: mkUid(uid),
    config,
    db: { config: { writePatch } } as unknown as RequestCtx['db'],
  });

  return { ctx, writePatch };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('setPassword', () => {
  it('writes a new admin hash when the caller is the existing admin', async () => {
    const adminUid = 'existing-admin-uid';
    const { ctx, writePatch } = buildAuthCtx(adminUid, { ADMIN_PASS: md5(adminUid) });

    await setPassword({ password: 'rotated' }, ctx);

    expect(writePatch).toHaveBeenCalledWith({ ADMIN_PASS: md5('rotated') });
  });

  it.each<{ label: string; uid: string; config: TwikooConfig }>([
    { label: 'a missing admin identity', uid: 'anyone', config: {} },
    { label: 'an existing admin identity', uid: 'guest', config: { ADMIN_PASS: md5('admin-uid') } },
  ])('rejects a non-admin caller with $label', async ({ uid, config }) => {
    const { ctx, writePatch } = buildAuthCtx(uid, config);

    await expect(setPassword({ password: 'changed' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });

    expect(writePatch).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('returns an empty envelope when the password matches', async () => {
    const ctx = buildCtx({ config: { ADMIN_PASS: md5('correct') } });

    const result = await login({ password: 'correct' }, ctx);

    expect(result).toEqual({});
  });

  it('rejects when no admin password is configured', async () => {
    const ctx = buildCtx({ config: {} });

    await expect(login({ password: 'anything' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.PASS_NOT_EXIST,
    });
  });

  it('rejects when the supplied password does not match the stored hash', async () => {
    const ctx = buildCtx({ config: { ADMIN_PASS: md5('correct') } });

    await expect(login({ password: 'wrong' }, ctx)).rejects.toMatchObject({
      code: ResponseCode.PASS_NOT_MATCH,
    });
  });
});

describe('getPasswordStatus', () => {
  it('forwards config + VERSION to the upstream helper and strips the inner code', async () => {
    vi.mocked(twikoo.getPasswordStatus).mockResolvedValueOnce({
      code: 0,
      status: true,
      credentials: false,
      version: '1.0.0-test',
    });
    const ctx = buildCtx({ config: { ADMIN_PASS: md5('p') } });

    const result = await getPasswordStatus({}, ctx);

    expect(twikoo.getPasswordStatus).toHaveBeenCalledWith(ctx.config, twikoo.VERSION);
    expect(result).toEqual({ status: true, credentials: false, version: '1.0.0-test' });
  });
});
