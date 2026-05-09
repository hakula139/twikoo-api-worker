import type { Handler } from '@/types';

import { requireAdmin } from '@/lib/auth';
import { ResponseCode, TwikooError } from '@/lib/errors';
import {
  VERSION,
  getPasswordStatus as getPasswordStatusFn,
  md5,
  stripCode,
  validate,
} from '@/twikoo';

export const getPasswordStatus: Handler<'GET_PASSWORD_STATUS'> = async (_payload, ctx) =>
  stripCode(await getPasswordStatusFn(ctx.config, VERSION));

// SET_PASSWORD is admin-only — open bootstrap is intentionally unsupported
// because the deploy → first-call window is a TOCTOU race anyone reaching
// the worker could win. Bootstrap by setting ADMIN_PASS_HASH (md5 of the
// plaintext password) via `wrangler secret put`; dispatch merges it into
// ctx.config.ADMIN_PASS so admin auth works from request one.
export const setPassword: Handler<'SET_PASSWORD'> = async (payload, ctx) => {
  validate(payload, ['password']);
  requireAdmin(ctx);

  await ctx.db.config.writePatch({ ADMIN_PASS: md5(payload.password) });
  return {};
};

// Don't return `ticket` — it routes the widget through tcb signIn (crashes on
// URL envId). isAdmin recovers the role from later accessToken headers.
export const login: Handler<'LOGIN'> = async (payload, ctx) => {
  validate(payload, ['password']);

  if (!ctx.config.ADMIN_PASS) {
    throw new TwikooError(ResponseCode.PASS_NOT_EXIST, '未配置管理密码');
  }
  if (md5(payload.password) !== ctx.config.ADMIN_PASS) {
    throw new TwikooError(ResponseCode.PASS_NOT_MATCH, '密码错误');
  }
  return {};
};
