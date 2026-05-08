import type { RequestCtx, TwikooConfig } from '@/types';

import { md5 } from '@/twikoo';
import { ResponseCode, TwikooError } from './errors';

export const isAdmin = (uid: string, config: TwikooConfig): boolean =>
  Boolean(config.ADMIN_PASS) && md5(uid) === config.ADMIN_PASS;

export const requireAdmin = (ctx: RequestCtx): void => {
  if (!isAdmin(ctx.uid, ctx.config)) {
    throw new TwikooError(ResponseCode.NEED_LOGIN, '请先登录');
  }
};
