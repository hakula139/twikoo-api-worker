import type { RequestCtx } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getQqNick } from '@/handlers/qq';
import { buildCtx } from '../../helpers/ctx';

const QQ_NICK_API = 'https://v1.nsuuu.com/api/qqname';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getQqNick', () => {
  it('returns the nick when the upstream lookup succeeds', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { nick: 'Alice' } }));
    const ctx = buildCtx();

    const result = await getQqNick({ qq: '12345' }, ctx);

    expect(result).toEqual({ nick: 'Alice' });
    expect(fetchSpy).toHaveBeenCalledWith(`${QQ_NICK_API}?qq=12345`, { headers: {} });
  });

  it('strips a trailing @qq.com before forwarding the request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { nick: 'Bob' } }));
    const ctx = buildCtx();

    await getQqNick({ qq: '987@qq.com' }, ctx);

    expect(fetchSpy).toHaveBeenCalledWith(`${QQ_NICK_API}?qq=987`, expect.any(Object));
  });

  it('forwards the API key as a Bearer token when it is bound on the worker env', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { nick: 'Carol' } }));
    const ctx = buildCtx({
      env: { QQ_API_KEY: 'sk-test' } as RequestCtx['env'],
    });

    await getQqNick({ qq: '1' }, ctx);

    expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), {
      headers: { Authorization: 'Bearer sk-test' },
    });
  });

  it('returns null when the upstream returns a non-2xx status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('boom', { status: 500 }));

    await expect(getQqNick({ qq: '1' }, buildCtx())).resolves.toEqual({ nick: null });
  });

  it('returns null when the upstream replies 200 but with a non-success code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ code: 401, message: 'unauthorized' }),
    );

    await expect(getQqNick({ qq: '1' }, buildCtx())).resolves.toEqual({ nick: null });
  });

  it('returns null when fetch rejects (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('TypeError: fetch failed'));

    await expect(getQqNick({ qq: '1' }, buildCtx())).resolves.toEqual({ nick: null });
  });

  it('returns null when the response body is missing the nick field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ code: 200, data: {} }));

    await expect(getQqNick({ qq: '1' }, buildCtx())).resolves.toEqual({ nick: null });
  });
});
