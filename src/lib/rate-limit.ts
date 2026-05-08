import type { RequestCtx } from '@/types';

import { numberConfig } from './config-read';
import { ResponseCode, TwikooError } from './errors';

// 10-minute rolling window. The `LIMIT_PER_MINUTE` config keys cap
// submissions over this window — the name is upstream parity.
const FREQUENCY_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT_PER_IP = 10;

export const enforceFrequencyLimit = async (ctx: RequestCtx): Promise<void> => {
  const since = Date.now() - FREQUENCY_WINDOW_MS;

  const perIp = numberConfig(ctx.config, 'LIMIT_PER_MINUTE', DEFAULT_LIMIT_PER_IP);
  if ((await ctx.db.comment.countSinceByIp(since, ctx.ip)) >= perIp) {
    throw new TwikooError(ResponseCode.FAIL, '发言频率过高');
  }

  const global = numberConfig(ctx.config, 'LIMIT_PER_MINUTE_ALL', 0);
  if (global > 0 && (await ctx.db.comment.countSince(since)) >= global) {
    throw new TwikooError(ResponseCode.FAIL, '评论太火爆啦 >_< 请稍后再试');
  }
};
