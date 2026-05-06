import type { Handler } from '../types';

import { validate } from '../twikoo';

export const counterGet: Handler = async (payload, ctx) => {
  validate(payload, ['url']);
  const url = payload.url as string;
  const title = (payload.title as string | undefined) ?? '';
  await ctx.db.counter.incr(url, title, Date.now());
  return { time: await ctx.db.counter.time(url) };
};
