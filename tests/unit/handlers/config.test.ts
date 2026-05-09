import type { RequestCtx } from '@/types';

import { describe, expect, it, vi } from 'vitest';

import { getConfig, getConfigForAdmin, setConfig } from '@/handlers/config';
import { ResponseCode, TwikooError } from '@/lib/errors';
import * as twikoo from '@/twikoo';
import { md5 } from '@/twikoo';
import { mkUid } from '@/types';
import { buildCtx } from '@tests/helpers/ctx';

describe('getConfig', () => {
  it('strips QQ_API_KEY from the public config response', async () => {
    vi.mocked(twikoo.getConfig).mockResolvedValueOnce({
      code: 0,
      config: { SITE_NAME: 'X', QQ_API_KEY: 'sk-secret' },
    });

    const ctx = buildCtx({ uid: mkUid('') });
    const result = (await getConfig({}, ctx)) as { config: Record<string, unknown> };

    expect(result.config).toEqual({ SITE_NAME: 'X' });
    expect(result.config.QQ_API_KEY).toBeUndefined();
  });

  it('passes isAdmin=false for a guest uid', async () => {
    const ctx = buildCtx({ config: { ADMIN_PASS: md5('admin-uid') }, uid: mkUid('guest') });

    await getConfig({}, ctx);

    expect(twikoo.getConfig).toHaveBeenCalledWith(
      expect.objectContaining({ isAdmin: false, VERSION: twikoo.VERSION }),
    );
  });

  it('passes isAdmin=true when ctx.uid hashes to the stored ADMIN_PASS', async () => {
    const adminUid = 'admin-uid';
    const ctx = buildCtx({ config: { ADMIN_PASS: md5(adminUid) }, uid: mkUid(adminUid) });

    await getConfig({}, ctx);

    expect(twikoo.getConfig).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
  });

  it('handles upstream responses without a `config` key', async () => {
    vi.mocked(twikoo.getConfig).mockResolvedValueOnce({ code: 0 });
    const ctx = buildCtx();

    await expect(getConfig({}, ctx)).resolves.toEqual({ code: 0 });
  });
});

describe('getConfigForAdmin', () => {
  it('rejects a non-admin caller', async () => {
    const ctx = buildCtx({ config: { ADMIN_PASS: md5('admin-uid') }, uid: mkUid('guest') });

    await expect(getConfigForAdmin({}, ctx)).rejects.toMatchObject({
      code: ResponseCode.NEED_LOGIN,
    });
    expect(twikoo.getConfigForAdmin).not.toHaveBeenCalled();
  });

  it('forwards the full config to the upstream helper and strips the inner code', async () => {
    vi.mocked(twikoo.getConfigForAdmin).mockResolvedValueOnce({
      config: { SMTP_PASS: 'secret' },
      code: 0,
    });

    const adminUid = 'admin-uid';
    const ctx = buildCtx({ config: { ADMIN_PASS: md5(adminUid) }, uid: mkUid(adminUid) });

    const result = await getConfigForAdmin({}, ctx);

    expect(twikoo.getConfigForAdmin).toHaveBeenCalledWith({ config: ctx.config, isAdmin: true });
    expect(result).toEqual({ config: { SMTP_PASS: 'secret' } });
  });
});

describe('setConfig', () => {
  const buildSetCtx = (uid: string, adminUid = 'admin-uid') => {
    const writePatch = vi.fn(async () => undefined);
    const ctx = buildCtx({
      config: { ADMIN_PASS: md5(adminUid) },
      uid: mkUid(uid),
      db: { config: { writePatch } } as unknown as RequestCtx['db'],
    });
    return { ctx, writePatch };
  };

  it('rejects a non-admin caller', async () => {
    const { ctx, writePatch } = buildSetCtx('guest');

    await expect(setConfig({ config: { SITE_NAME: 'X' } }, ctx)).rejects.toBeInstanceOf(
      TwikooError,
    );
    expect(writePatch).not.toHaveBeenCalled();
  });

  it('writes the supplied patch when the caller is admin', async () => {
    const adminUid = 'admin-uid';
    const { ctx, writePatch } = buildSetCtx(adminUid, adminUid);

    const result = await setConfig({ config: { SITE_NAME: 'X', SHOW_REGION: 'true' } }, ctx);

    expect(writePatch).toHaveBeenCalledWith({ SITE_NAME: 'X', SHOW_REGION: 'true' });
    expect(result).toEqual({});
  });
});
