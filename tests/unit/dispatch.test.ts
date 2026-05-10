import type { Env } from '@/types';

import { env as rawEnv } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { dispatch } from '@/dispatch';
import { ResponseCode } from '@/lib/errors';
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

beforeAll(async () => {
  await applyTestSchema();
});

afterEach(async () => {
  await resetTestDb();
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
});
