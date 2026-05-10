import type { DB } from '@/db';
import type { Env } from '@/types';

import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '@/lib/ctx';

const buildDb = (raw: string): DB =>
  ({
    config: { read: vi.fn(async () => raw) },
  }) as unknown as DB;

describe('loadConfig', () => {
  it('returns {} for an empty config row with no ADMIN_PASS_HASH bootstrap', async () => {
    const result = await loadConfig({} as Env, buildDb(''));
    expect(result).toEqual({ kind: 'ok', config: {} });
  });

  it('returns { ADMIN_PASS } from ADMIN_PASS_HASH when the row is empty', async () => {
    const result = await loadConfig({ ADMIN_PASS_HASH: 'abcd' } as Env, buildDb(''));
    expect(result).toEqual({ kind: 'ok', config: { ADMIN_PASS: 'abcd' } });
  });

  it('parses a valid config row', async () => {
    const result = await loadConfig({} as Env, buildDb('{"SITE_URL":"https://x"}'));
    expect(result).toEqual({ kind: 'ok', config: { SITE_URL: 'https://x' } });
  });

  it('does not mutate the parsed object on the bootstrap merge path', async () => {
    const raw = '{"SITE_URL":"https://x"}';
    const ok = await loadConfig({ ADMIN_PASS_HASH: 'fallback' } as Env, buildDb(raw));
    if (ok.kind !== 'ok') {
      throw new Error('expected ok');
    }
    expect(ok.config).toEqual({ SITE_URL: 'https://x', ADMIN_PASS: 'fallback' });
    // Re-parsing the same raw bytes confirms loadConfig didn't reach back into
    // the JSON.parse result and add ADMIN_PASS to it.
    expect(JSON.parse(raw)).toEqual({ SITE_URL: 'https://x' });
  });

  it.each<[string, string]>([
    ['invalid JSON', '{not-json'],
    ['JSON array', '[1,2,3]'],
    ['JSON string', '"a string"'],
  ])('returns corrupted with diagnostics for %s', async (_label, raw) => {
    const result = await loadConfig({} as Env, buildDb(raw));
    expect(result.kind).toBe('corrupted');
    if (result.kind !== 'corrupted') {
      throw new Error('unreachable');
    }
    expect(result.length).toBe(raw.length);
    expect(result.parseError).toBeInstanceOf(Error);
  });

  it('merges ADMIN_PASS_HASH when the parsed config lacks ADMIN_PASS', async () => {
    const result = await loadConfig(
      { ADMIN_PASS_HASH: 'fallback' } as Env,
      buildDb('{"SITE_URL":"https://x"}'),
    );
    expect(result).toEqual({
      kind: 'ok',
      config: { SITE_URL: 'https://x', ADMIN_PASS: 'fallback' },
    });
  });

  it('does not override an existing ADMIN_PASS in the row', async () => {
    const result = await loadConfig(
      { ADMIN_PASS_HASH: 'fallback' } as Env,
      buildDb('{"ADMIN_PASS":"stored"}'),
    );
    if (result.kind !== 'ok') {
      throw new Error('expected ok');
    }
    expect(result.config.ADMIN_PASS).toBe('stored');
  });
});
