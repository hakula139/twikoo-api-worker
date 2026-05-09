import type { RequestCtx } from '@/types';

import { describe, expect, it, vi } from 'vitest';

import { counterGet } from '@/handlers/counter';
import { buildCtx } from '@tests/helpers/ctx';

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
    const { ctx, incr, time } = buildCounterCtx(42);

    const result = await counterGet({ url: '/post', title: 'Post' }, ctx);

    expect(incr).toHaveBeenCalledWith('/post', 'Post', expect.any(Number));
    expect(time).toHaveBeenCalledWith('/post');
    expect(result).toEqual({ time: 42 });
  });

  it('defaults title to empty string when omitted', async () => {
    const { ctx, incr } = buildCounterCtx(0);

    await counterGet({ url: '/post' }, ctx);

    expect(incr).toHaveBeenCalledWith('/post', '', expect.any(Number));
  });
});
