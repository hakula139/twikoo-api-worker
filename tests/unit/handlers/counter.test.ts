import type { RequestCtx } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { counterGet } from '@/handlers/counter';
import { buildCtx } from '@tests/helpers/ctx';

afterEach(() => {
  vi.useRealTimers();
});

describe('counterGet', () => {
  const buildCounterCtx = (timeValue: number) => {
    const incr = vi.fn(async () => undefined);
    const time = vi.fn(async () => timeValue);
    const ctx = buildCtx({
      db: { counter: { incr, time } } as unknown as RequestCtx['db'],
    });
    return { ctx, incr, time };
  };

  it('increments the counter and returns the latest count', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
    const { ctx, incr, time } = buildCounterCtx(42);

    const result = await counterGet({ url: '/about-me/', title: '关于我' }, ctx);

    expect(incr).toHaveBeenCalledWith('/about-me/', '关于我', Date.now());
    expect(time).toHaveBeenCalledWith('/about-me/');
    expect(result).toEqual({ time: 42 });
  });

  it('defaults title to empty string when omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
    const { ctx, incr } = buildCounterCtx(0);

    await counterGet({ url: '/comments/' }, ctx);

    expect(incr).toHaveBeenCalledWith('/comments/', '', Date.now());
  });
});
