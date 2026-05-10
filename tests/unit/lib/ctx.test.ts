import type { DB } from '@/db';
import type { Env } from '@/types';

import { describe, expect, it, vi } from 'vitest';

import { CONFIG_CORRUPTED, loadConfig } from '@/lib/ctx';

const buildDb = (raw: string): DB =>
  ({
    config: { read: vi.fn(async () => raw) },
  }) as unknown as DB;

describe('loadConfig', () => {
  it('returns {} for an empty config row with no ADMIN_PASS_HASH bootstrap', async () => {
    const result = await loadConfig({} as Env, buildDb(''));
    expect(result).toEqual({});
  });

  it('returns { ADMIN_PASS } from ADMIN_PASS_HASH when the row is empty', async () => {
    const result = await loadConfig({ ADMIN_PASS_HASH: 'abcd' } as Env, buildDb(''));
    expect(result).toEqual({ ADMIN_PASS: 'abcd' });
  });

  it('parses a valid config row', async () => {
    const result = await loadConfig({} as Env, buildDb('{"SITE_URL":"https://x"}'));
    expect(result).toEqual({ SITE_URL: 'https://x' });
  });

  it('returns CONFIG_CORRUPTED for invalid JSON', async () => {
    const result = await loadConfig({} as Env, buildDb('{not-json'));
    expect(result).toBe(CONFIG_CORRUPTED);
  });

  it('returns CONFIG_CORRUPTED when the JSON parses to a non-object (array)', async () => {
    const result = await loadConfig({} as Env, buildDb('[1,2,3]'));
    expect(result).toBe(CONFIG_CORRUPTED);
  });

  it('returns CONFIG_CORRUPTED when the JSON parses to a non-object (string)', async () => {
    const result = await loadConfig({} as Env, buildDb('"a string"'));
    expect(result).toBe(CONFIG_CORRUPTED);
  });

  it('merges ADMIN_PASS_HASH when the parsed config lacks ADMIN_PASS', async () => {
    const result = await loadConfig(
      { ADMIN_PASS_HASH: 'fallback' } as Env,
      buildDb('{"SITE_URL":"https://x"}'),
    );
    expect(result).toEqual({ SITE_URL: 'https://x', ADMIN_PASS: 'fallback' });
  });

  it('does not override an existing ADMIN_PASS in the row', async () => {
    const result = await loadConfig(
      { ADMIN_PASS_HASH: 'fallback' } as Env,
      buildDb('{"ADMIN_PASS":"stored"}'),
    );
    expect(result).toMatchObject({ ADMIN_PASS: 'stored' });
  });
});
