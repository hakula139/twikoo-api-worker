import type { RequestCtx } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getQqNick } from '@/handlers/qq';
import { buildCtx } from '@tests/helpers/ctx';

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

    expect(fetchSpy).toHaveBeenCalledWith(`${QQ_NICK_API}?qq=987`, { headers: {} });
  });

  it('forwards the API key as a Bearer token when it is bound on the worker env', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { nick: 'Carol' } }));
    const ctx = buildCtx({
      env: { QQ_API_KEY: 'sk-test' } as RequestCtx['env'],
    });

    await getQqNick({ qq: '10001' }, ctx);

    expect(fetchSpy).toHaveBeenCalledWith(`${QQ_NICK_API}?qq=10001`, {
      headers: { Authorization: 'Bearer sk-test' },
    });
  });

  it.each([
    { name: 'non-2xx HTTP status', response: new Response('boom', { status: 500 }) },
    { name: 'non-success API code', response: jsonResponse({ code: 401 }) },
    { name: 'missing nick', response: jsonResponse({ code: 200, data: {} }) },
    { name: 'network failure', error: new Error('fetch failed') },
  ])('returns null for $name', async (scenario) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    if ('error' in scenario) {
      fetchSpy.mockRejectedValueOnce(scenario.error);
    } else {
      fetchSpy.mockResolvedValueOnce(scenario.response);
    }

    const result = await getQqNick({ qq: '1' }, buildCtx());

    expect(result).toEqual({ nick: null });
  });
});
