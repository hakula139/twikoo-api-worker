import type { Handler } from '../types';

import { isAdmin } from '../lib/auth';
import { ResponseCode, TwikooError } from '../lib/errors';
import { VERSION, getPasswordStatus as getPasswordStatusFn, md5, validate } from '../twikoo';

export const getPasswordStatus: Handler = async (_payload, ctx) => {
  const { code: _code, ...rest } = await getPasswordStatusFn(ctx.config, VERSION);
  return rest;
};

// Initial setup is open: any caller can set the password if none exists. Once
// set, only the current admin can rotate it. Upstream's `credentials` keyfile
// branch (Tencent CloudBase ticket signing) is dropped — Workers don't have it.
export const setPassword: Handler = async (payload, ctx) => {
  validate(payload, ['password']);

  const password = payload.password as string;
  if (ctx.config.ADMIN_PASS && !isAdmin(ctx.uid, ctx.config)) {
    throw new TwikooError(ResponseCode.PASS_EXIST, '请先登录再修改密码');
  }

  await ctx.db.config.writePatch({ ADMIN_PASS: md5(password) });
  return {};
};

// Verify the password and echo it back as `ticket`. The frontend stashes the
// ticket as `accessToken` for subsequent admin calls; `lib/auth.isAdmin` then
// recovers the role via `md5(uid) === ADMIN_PASS`. No CloudBase ticket needed.
export const login: Handler = async (payload, ctx) => {
  validate(payload, ['password']);

  if (!ctx.config.ADMIN_PASS) {
    throw new TwikooError(ResponseCode.PASS_NOT_EXIST, '未配置管理密码');
  }
  const password = payload.password as string;
  if (md5(password) !== ctx.config.ADMIN_PASS) {
    throw new TwikooError(ResponseCode.PASS_NOT_MATCH, '密码错误');
  }
  return { ticket: password };
};
