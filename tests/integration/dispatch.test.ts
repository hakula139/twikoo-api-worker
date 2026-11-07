import type { MockInstance } from 'vitest';
import { env } from 'cloudflare:workers';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_BODY_BYTES } from '@/dispatch';
import { ResponseCode } from '@/lib/errors';
import { logger } from '@/twikoo';
import { applyTestSchema, resetTestDb } from '@tests/helpers/db';
import {
  ADMIN_TOKEN,
  adminAuthHeader,
  fetchComments,
  postEvent,
  postRaw,
  seedAdmin,
  seedConfig,
  sendRequest,
} from './helpers';

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
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
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
  it('returns a client-readable error when loading configuration fails', async () => {
    vi.spyOn(env.DB, 'prepare').mockImplementationOnce(() => {
      throw new Error('Database is unavailable.');
    });

    const { body } = await postEvent('UPLOAD_IMAGE', {
      photo: 'data:image/png;base64,iVBORw0KGgo=',
      fileName: 'sample.png',
    });

    expect(body).toEqual({
      code: ResponseCode.FAIL,
      message: 'Internal error.',
      err: 'Internal error.',
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'UPLOAD_IMAGE', code: ResponseCode.FAIL }),
      'request',
    );
  });

  it.each(['NOT_AN_EVENT', 'constructor', 'toString', '__proto__'])(
    'rejects unsupported event %s with EVENT_NOT_EXIST',
    async (event) => {
      await seedConfig({});

      const { body } = await postEvent(event);

      expect(body.code).toBe(ResponseCode.EVENT_NOT_EXIST);
    },
  );

  it.each(['header', 'body'] as const)(
    'authenticates %s credentials without logging them',
    async (via) => {
      await seedAdmin();

      const { body } = await postEvent(
        'GET_CONFIG_FOR_ADMIN',
        via === 'body' ? { accessToken: ADMIN_TOKEN } : {},
        via === 'header' ? adminAuthHeader() : undefined,
      );

      expect(body.code).toBe(ResponseCode.SUCCESS);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(ADMIN_TOKEN);
      expect(infoSpy.mock.calls[0]?.[0]).not.toHaveProperty('uid');
    },
  );

  it('redacts stored configuration and authentication values when a D1 write fails', async () => {
    await seedAdmin({ SMTP_PASS: 'stored-mail-key' });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
      const statement = prepare(query);
      if (query.startsWith('insert into "config"')) {
        vi.spyOn(statement, 'bind').mockImplementationOnce(() => {
          throw new Error('D1 write unavailable.');
        });
      }
      return statement;
    });

    const { body } = await postEvent(
      'SET_CONFIG',
      { config: { SITE_NAME: 'New Site' } },
      adminAuthHeader(),
    );

    expect(body).toEqual({
      code: ResponseCode.FAIL,
      message: 'Database request failed.',
      err: 'Database request failed.',
    });
    const diagnostics = JSON.stringify(
      [infoSpy.mock.calls, errorSpy.mock.calls, body],
      (_key, value: unknown) => (value instanceof Error ? value.message : value),
    );
    expect(diagnostics).not.toContain('stored-mail-key');
    expect(diagnostics).not.toContain(ADMIN_TOKEN);
    expect(diagnostics).not.toContain('insert into');
  });

  it('redacts database diagnostics from the outer Worker error log', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(env.DB, 'prepare').mockImplementationOnce(() => {
      throw new DrizzleQueryError(
        'SELECT config',
        ['stored-mail-key'],
        new Error('D1 unavailable.'),
      );
    });

    const { body } = await postEvent('GET_CONFIG');

    expect(body).toEqual({
      code: ResponseCode.FAIL,
      message: 'Internal error.',
      err: 'Internal error.',
    });
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
      'Unhandled fetch error:',
      new Error('Database request failed.'),
    );
  });

  it('rejects with FAIL + CORS when Content-Length exceeds the cap', async () => {
    const { body, headers } = await postRaw('{}', {
      'Content-Length': String(MAX_BODY_BYTES + 1),
    });

    expect(body.code).toBe(ResponseCode.FAIL);
    expect(body.message).toMatch(/too large/i);
    expect(body.err).toBe(body.message);
    expect(headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  describe('CORS rejection short-circuits writes', () => {
    it('returns FORBIDDEN and skips the handler when Origin is not allowlisted', async () => {
      await seedConfig({ CORS_ALLOW_ORIGIN: 'https://example.com' });

      const { body } = await postEvent(
        'COMMENT_SUBMIT',
        {
          url: '/post/',
          ua: 'Mozilla/5.0',
          comment: 'This rejected comment must not persist.',
        },
        { 'Origin': 'https://attacker.example.com', 'x-twikoo-recaptcha-v3': 'attacker' },
      );

      expect(body.code).toBe(ResponseCode.FORBIDDEN);
      // The origin gate has to fire before handler dispatch. Otherwise the browser drops the
      // response client-side but the row is already saved.
      expect(await fetchComments('/post/')).toHaveLength(0);
    });
  });

  it('emits one {event, code, duration_ms} log per dispatch', async () => {
    await seedConfig({});

    const { body } = await postEvent(
      'COMMENT_LIKE',
      { id: 'does-not-exist' },
      { 'x-twikoo-recaptcha-v3': 'observer-uid' },
    );

    expect(body.code).toBe(ResponseCode.FAIL);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const fields = infoSpy.mock.calls[0]?.[0] as
      | { event: string; code: number; duration_ms: unknown }
      | undefined;
    expect(fields?.event).toBe('COMMENT_LIKE');
    expect(fields?.code).toBe(ResponseCode.FAIL);
    expect(fields).not.toHaveProperty('uid');
    expect(fields?.duration_ms).toBeTypeOf('number');
    expect(infoSpy.mock.calls[0]?.[1]).toBe('request');
  });
});
