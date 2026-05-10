import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { MAX_BODY_BYTES } from '@/dispatch';
import { ResponseCode } from '@/lib/errors';
import { logger } from '@/twikoo';
import { applyTestSchema, resetTestDb } from '@tests/helpers/db';
import { fetchComments, postEvent, postRaw, seedConfig, sendRequest } from './helpers';

let infoSpy: MockInstance;

beforeAll(async () => {
  await applyTestSchema();
});

beforeEach(() => {
  infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
});

afterEach(async () => {
  await resetTestDb();
  vi.restoreAllMocks();
});

describe('integration: worker entry', () => {
  it('answers OPTIONS preflight with 204 and CORS headers', async () => {
    const res = await sendRequest(
      { method: 'OPTIONS' },
      { 'Access-Control-Request-Method': 'POST' },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://blog.example');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('answers GET / with the version probe', async () => {
    const res = await sendRequest({ method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json<{ code: number; data: { version: string }; message: string }>();
    expect(body.code).toBe(ResponseCode.SUCCESS);
    expect(body.data.version).toBe('0.0.0-test');
    expect(body.message).toMatch(/running/i);
  });

  it('rejects unsupported methods with FAIL and the Allow header', async () => {
    const res = await sendRequest({ method: 'PATCH' });
    const body = await res.json<{ code: number; message: string }>();
    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/PATCH/);
    expect(res.headers.get('Allow')).toBe('GET, OPTIONS, POST');
  });
});

describe('integration: dispatch hardening', () => {
  it('rejects with FAIL + CORS when Content-Length exceeds the cap (PR #43)', async () => {
    const { body, headers } = await postRaw('{}', {
      'Content-Length': String(MAX_BODY_BYTES + 1),
    });
    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/too large/i);
    expect(headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  describe('CORS rejection short-circuits writes', () => {
    it('returns FORBIDDEN and skips the handler when Origin is not allowlisted', async () => {
      await seedConfig({ CORS_ALLOW_ORIGIN: 'https://allowed.example' });

      const { body } = await postEvent(
        'COMMENT_SUBMIT',
        {
          url: '/post/',
          ua: 'integration-ua',
          comment: 'should not persist',
        },
        { 'Origin': 'https://attacker.example', 'x-twikoo-recaptcha-v3': 'attacker' },
      );

      expect(body.code).toBe(ResponseCode.FORBIDDEN);
      // The origin gate has to fire before handler dispatch — otherwise the
      // browser drops the response client-side but the row is already saved.
      expect(await fetchComments('/post/')).toHaveLength(0);
    });
  });

  it('emits one {event, code, uid, duration_ms} log per dispatch (PR #44)', async () => {
    await seedConfig({});

    const { body } = await postEvent(
      'COMMENT_LIKE',
      { id: 'does-not-exist' },
      { 'x-twikoo-recaptcha-v3': 'observer-uid' },
    );

    expect(body.code).toBe(ResponseCode.FAIL);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const fields = infoSpy.mock.calls[0]?.[0] as
      | { event: string; code: number; uid: string; duration_ms: unknown }
      | undefined;
    expect(fields?.event).toBe('COMMENT_LIKE');
    expect(fields?.code).toBe(ResponseCode.FAIL);
    expect(fields?.uid).toBe('observer-uid');
    expect(fields?.duration_ms).toBeTypeOf('number');
    expect(infoSpy.mock.calls[0]?.[1]).toBe('request');
  });
});
