import type { DB } from '@/db';
import type { Env } from '@/types';

import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '@/lib/ctx';

const buildDb = (raw: string): DB =>
  ({
    config: { read: vi.fn<() => Promise<string>>().mockResolvedValue(raw) },
  }) as unknown as DB;

describe('loadConfig', () => {
  it('returns {} for an empty config row with no ADMIN_PASS_HASH bootstrap', async () => {
    const result = await loadConfig({} as Env, buildDb(''));

    expect(result).toEqual({ kind: 'ok', config: {}, droppedKeys: [] });
  });

  it('returns { ADMIN_PASS } from ADMIN_PASS_HASH when the row is empty', async () => {
    const result = await loadConfig({ ADMIN_PASS_HASH: 'abcd' } as Env, buildDb(''));

    expect(result).toEqual({ kind: 'ok', config: { ADMIN_PASS: 'abcd' }, droppedKeys: [] });
  });

  it('parses a valid config row', async () => {
    const result = await loadConfig({} as Env, buildDb('{"SITE_URL":"https://example.com"}'));

    expect(result).toEqual({
      kind: 'ok',
      config: { SITE_URL: 'https://example.com' },
      droppedKeys: [],
    });
  });

  it.each([
    { label: 'invalid JSON', raw: '{"SMTP_PASS": example-secret}', reason: 'invalid-json' },
    { label: 'JSON array', raw: '["example-secret"]', reason: 'invalid-object' },
    { label: 'JSON string', raw: '"example-secret"', reason: 'invalid-object' },
  ])('returns safe diagnostics for $label', async ({ raw, reason }) => {
    const result = await loadConfig({} as Env, buildDb(raw));

    expect(result).toEqual({ kind: 'corrupted', length: raw.length, reason });
  });

  it('merges ADMIN_PASS_HASH when the parsed config lacks ADMIN_PASS', async () => {
    const result = await loadConfig(
      { ADMIN_PASS_HASH: 'fallback-admin-hash' } as Env,
      buildDb('{"SITE_URL":"https://example.com"}'),
    );

    expect(result).toEqual({
      kind: 'ok',
      config: { SITE_URL: 'https://example.com', ADMIN_PASS: 'fallback-admin-hash' },
      droppedKeys: [],
    });
  });

  it('does not override an existing ADMIN_PASS in the row', async () => {
    const result = await loadConfig(
      { ADMIN_PASS_HASH: 'fallback-admin-hash' } as Env,
      buildDb('{"ADMIN_PASS":"stored-admin-hash"}'),
    );

    if (result.kind !== 'ok') {
      throw new Error('expected ok');
    }

    expect(result.config.ADMIN_PASS).toBe('stored-admin-hash');
  });

  it('prunes keys whose values violate the index signature', async () => {
    const raw = JSON.stringify({
      SITE_URL: 'https://example.com',
      COMMENT_PAGE_SIZE: 10,
      SHOW_REGION: true,
      NULL_KEY: null,
      NESTED_OBJ: { theme: 'dark' },
      NESTED_ARR: [1, 2, 3],
    });
    const result = await loadConfig({} as Env, buildDb(raw));

    if (result.kind !== 'ok') {
      throw new Error('expected ok');
    }

    expect(result.config).toEqual({
      SITE_URL: 'https://example.com',
      COMMENT_PAGE_SIZE: 10,
      SHOW_REGION: true,
    });
    expect([...result.droppedKeys].sort()).toEqual(['NESTED_ARR', 'NESTED_OBJ', 'NULL_KEY']);
  });
});
