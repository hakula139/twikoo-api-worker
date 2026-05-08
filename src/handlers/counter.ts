import type { Handler } from '@/types';

import { validate } from '@/twikoo';

export const counterGet: Handler<'COUNTER_GET'> = async (payload, ctx) => {
  validate(payload, ['url']);
  await ctx.db.counter.incr(payload.url, payload.title ?? '', Date.now());
  return { time: await ctx.db.counter.time(payload.url) };
};
