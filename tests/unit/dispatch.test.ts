import type { Env } from '@/types';

import { env as rawEnv } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { dispatch } from '@/dispatch';
import { ResponseCode, TwikooError } from '@/lib/errors';
import * as twikoo from '@/twikoo';
import { logger } from '@/twikoo';
import { applyTestSchema, resetTestDb } from '@tests/helpers/db';

const env = rawEnv as unknown as Env;

const execCtx: ExecutionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
};

const post = (body: string): Request =>
  new Request('https://twikoo.example/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://blog.example' },
    body,
  });

const writeConfigRow = async (raw: string): Promise<void> => {
  await env.DB.prepare('INSERT INTO config (id, value) VALUES (?, ?)').bind(0, raw).run();
};

let infoSpy: MockInstance;

beforeAll(async () => {
  await applyTestSchema();
});

beforeEach(() => {
  // Silence the per-request log line; the per-request log suite below reads
  // back the captured calls.
  infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
});

afterEach(async () => {
  await resetTestDb();
  vi.restoreAllMocks();
});

describe('dispatch', () => {
  it('returns FAIL with a CORS-safe body when the request body is not JSON', async () => {
    const res = await dispatch(post('{not-json'), env, execCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    const body = await res.json<{ code: number; message: string }>();
    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/JSON/);
  });

  it('returns FAIL when the request body parses to a non-object', async () => {
    const res = await dispatch(post('[1,2,3]'), env, execCtx);
    const body = await res.json<{ code: number; message: string }>();
    expect(body.code).toBe(ResponseCode.FAIL);
  });

  it('maps a corrupted config row to CONFIG_NOT_EXIST with CORS headers', async () => {
    await writeConfigRow('{not-json');

    const res = await dispatch(post('{"event":"GET_FUNC_VERSION"}'), env, execCtx);

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    const body = await res.json<{ code: number; message: string }>();
    expect(body.code).toBe(ResponseCode.CONFIG_NOT_EXIST);
    expect(body.message).toMatch(/corrupted/i);
  });

  it('also maps a non-object config row (JSON array) to CONFIG_NOT_EXIST', async () => {
    await writeConfigRow('[1,2,3]');
    const res = await dispatch(post('{"event":"GET_FUNC_VERSION"}'), env, execCtx);
    const body = await res.json<{ code: number; message: string }>();
    expect(body.code).toBe(ResponseCode.CONFIG_NOT_EXIST);
  });

  it('returns EVENT_NOT_EXIST for an unknown event when config is healthy', async () => {
    await writeConfigRow('{}');
    const res = await dispatch(post('{"event":"NOT_A_REAL_EVENT"}'), env, execCtx);
    const body = await res.json<{ code: number; message: string }>();
    expect(body.code).toBe(ResponseCode.EVENT_NOT_EXIST);
  });

  describe('body size cap', () => {
    const MAX_BODY_BYTES = 10 * 1024 * 1024;

    const postWithLength = (body: string, length: number): Request =>
      new Request('https://twikoo.example/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://blog.example',
          'Content-Length': String(length),
        },
        body,
      });

    it('rejects when Content-Length exceeds the cap', async () => {
      const res = await dispatch(postWithLength('{}', MAX_BODY_BYTES + 1), env, execCtx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
      const body = await res.json<{ code: number; message: string }>();
      expect(body.code).toBe(ResponseCode.FAIL);
      expect(body.message).toMatch(/too large/i);
    });

    it('accepts when Content-Length is at the cap', async () => {
      // Real body stays small; we only assert the cap check passes the request
      // through to the parse / dispatch path (which then 404s on event).
      const res = await dispatch(
        postWithLength('{"event":"GET_FUNC_VERSION"}', MAX_BODY_BYTES),
        env,
        execCtx,
      );
      const body = await res.json<{ code: number; message: string }>();
      expect(body.code).not.toBe(ResponseCode.FAIL);
    });

    it('falls through to parse when Content-Length is absent', async () => {
      const res = await dispatch(post('{not-json'), env, execCtx);
      const body = await res.json<{ code: number; message: string }>();
      expect(body.message).toMatch(/JSON/);
    });
  });

  describe('rejection and error paths', () => {
    let errorSpy: MockInstance;

    beforeEach(() => {
      errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    });

    it('logs dropped config keys when the row has values with unsupported types', async () => {
      await writeConfigRow('{"OK":"x","BAD":{"a":1}}');

      await dispatch(post('{"event":"NOT_A_REAL_EVENT"}'), env, execCtx);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ droppedKeys: ['BAD'] }),
        'Config row had keys with unsupported value types; pruned at the boundary.',
      );
    });

    it('returns FORBIDDEN when the origin is not on CORS_ALLOW_ORIGIN', async () => {
      await writeConfigRow('{"CORS_ALLOW_ORIGIN":"https://allowed.example"}');

      const res = await dispatch(post('{"event":"GET_FUNC_VERSION"}'), env, execCtx);

      const body = await res.json<{ code: number; message: string }>();
      expect(body.code).toBe(ResponseCode.FORBIDDEN);
    });

    it('relays a TwikooError thrown by a handler with its original code', async () => {
      await writeConfigRow('{}');
      vi.mocked(twikoo.getFuncVersion).mockImplementationOnce(() => {
        throw new TwikooError(ResponseCode.PASS_NOT_MATCH, '密码错误');
      });

      const res = await dispatch(post('{"event":"GET_FUNC_VERSION"}'), env, execCtx);

      const body = await res.json<{ code: number; message: string }>();
      expect(body.code).toBe(ResponseCode.PASS_NOT_MATCH);
      expect(body.message).toBe('密码错误');
    });

    it('preserves the message of a generic Error thrown by a handler', async () => {
      await writeConfigRow('{}');
      vi.mocked(twikoo.getFuncVersion).mockImplementationOnce(() => {
        throw new Error('upstream timeout');
      });

      const res = await dispatch(post('{"event":"GET_FUNC_VERSION"}'), env, execCtx);

      const body = await res.json<{ code: number; message: string }>();
      expect(body.code).toBe(ResponseCode.FAIL);
      expect(body.message).toBe('upstream timeout');
      const sawUnhandled = errorSpy.mock.calls.some(
        (args) => args[0] === 'Unhandled handler error:',
      );
      expect(sawUnhandled).toBe(true);
    });

    it('falls back to "Internal error." when the thrown Error has no message', async () => {
      await writeConfigRow('{}');
      vi.mocked(twikoo.getFuncVersion).mockImplementationOnce(() => {
        throw new Error('');
      });

      const res = await dispatch(post('{"event":"GET_FUNC_VERSION"}'), env, execCtx);

      const body = await res.json<{ code: number; message: string }>();
      expect(body.code).toBe(ResponseCode.FAIL);
      expect(body.message).toBe('Internal error.');
    });
  });

  describe('per-request log line', () => {
    it('emits one log per request tagged with event, code, uid, and duration_ms', async () => {
      await writeConfigRow('{}');

      await dispatch(post('{"event":"NOT_A_REAL_EVENT"}'), env, execCtx);

      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'NOT_A_REAL_EVENT',
          code: ResponseCode.EVENT_NOT_EXIST,
          uid: '',
        }),
        'request',
      );
      const fields = infoSpy.mock.calls[0]?.[0] as { duration_ms: unknown } | undefined;
      expect(fields?.duration_ms).toBeTypeOf('number');
    });

    it('still logs when the body fails to parse (event and uid stay empty)', async () => {
      await dispatch(post('{not-json'), env, execCtx);

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: '', code: ResponseCode.FAIL, uid: '' }),
        'request',
      );
    });

    it('captures the uid from the request body', async () => {
      await writeConfigRow('{}');

      await dispatch(post('{"event":"NOT_A_REAL_EVENT","accessToken":"user-abc"}'), env, execCtx);

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'NOT_A_REAL_EVENT', uid: 'user-abc' }),
        'request',
      );
    });
  });
});
