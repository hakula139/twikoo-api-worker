import type { RequestCtx, TwikooConfig } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResponseCode, TwikooError } from '@/lib/errors';
import { enforceFrequencyLimit } from '@/lib/rate-limit';
import { mkIp } from '@/types';
import { buildCtx } from '@tests/helpers/ctx';

interface Counts {
  perIp: number;
  global: number;
}

afterEach(() => {
  vi.useRealTimers();
});

const buildRateCtx = (config: TwikooConfig, counts: Counts, ip = '192.0.2.1'): RequestCtx => {
  const db = {
    comment: {
      countSinceByIp: vi.fn(async () => counts.perIp),
      countSince: vi.fn(async () => counts.global),
    },
  };
  return buildCtx({ ip: mkIp(ip), config, db: db as unknown as RequestCtx['db'] });
};

describe('enforceFrequencyLimit > per-IP cap', () => {
  it('rejects with FAIL when the per-IP count has reached LIMIT_PER_MINUTE', async () => {
    const ctx = buildRateCtx({ LIMIT_PER_MINUTE: '3' }, { perIp: 3, global: 0 });
    try {
      await enforceFrequencyLimit(ctx);
      throw new Error('expected enforceFrequencyLimit to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.FAIL);
    }
  });

  it('accepts while still below the configured cap', async () => {
    const ctx = buildRateCtx({ LIMIT_PER_MINUTE: '3' }, { perIp: 2, global: 0 });
    await expect(enforceFrequencyLimit(ctx)).resolves.toBeUndefined();
  });

  it('falls back to a 10-cap when LIMIT_PER_MINUTE is unset', async () => {
    const ctx = buildRateCtx({}, { perIp: 10, global: 0 });
    await expect(enforceFrequencyLimit(ctx)).rejects.toMatchObject({ code: ResponseCode.FAIL });
  });

  it('queries the request IP over the preceding ten-minute window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
    const counts = { perIp: 0, global: 0 };
    const ctx = buildRateCtx({ LIMIT_PER_MINUTE: '3' }, counts, '198.51.100.10');
    await enforceFrequencyLimit(ctx);
    const db = ctx.db.comment as unknown as {
      countSinceByIp: ReturnType<typeof vi.fn>;
    };
    expect(db.countSinceByIp).toHaveBeenCalledWith(Date.now() - 10 * 60 * 1_000, '198.51.100.10');
  });
});

describe('enforceFrequencyLimit > global cap', () => {
  it('rejects when the global count has reached LIMIT_PER_MINUTE_ALL', async () => {
    const ctx = buildRateCtx(
      { LIMIT_PER_MINUTE: '50', LIMIT_PER_MINUTE_ALL: '100' },
      { perIp: 0, global: 100 },
    );
    await expect(enforceFrequencyLimit(ctx)).rejects.toMatchObject({ code: ResponseCode.FAIL });
  });

  it('skips the global query when LIMIT_PER_MINUTE_ALL=0', async () => {
    const ctx = buildRateCtx(
      { LIMIT_PER_MINUTE: '50', LIMIT_PER_MINUTE_ALL: '0' },
      { perIp: 0, global: 1_000_000 },
    );
    await expect(enforceFrequencyLimit(ctx)).resolves.toBeUndefined();
    const db = ctx.db.comment as unknown as { countSince: ReturnType<typeof vi.fn> };
    expect(db.countSince).not.toHaveBeenCalled();
  });
});
