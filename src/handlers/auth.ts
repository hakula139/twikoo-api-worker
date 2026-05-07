import type { Handler } from '../types';

import { isAdmin } from '../lib/auth';
import { ResponseCode, TwikooError } from '../lib/errors';
import {
  VERSION,
  getPasswordStatus as getPasswordStatusFn,
  md5,
  stripCode,
  validate,
} from '../twikoo';

export const getPasswordStatus: Handler = async (_payload, ctx) =>
  stripCode(await getPasswordStatusFn(ctx.config, VERSION));

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

// Verify the password. The widget's HTTP-mode flow auto-saves the password it
// sent as `twikoo-access-token` in localStorage when the response has `code:0`
// and no `ticket`. Returning `ticket` would route the widget through its tcb
// (Tencent CloudBase) signIn path, which crashes when `envId` is a plain URL
// because the tcb client is never initialized. `lib/auth.isAdmin` then
// recovers the role from subsequent `accessToken` headers.
export const login: Handler = async (payload, ctx) => {
  validate(payload, ['password']);

  if (!ctx.config.ADMIN_PASS) {
    throw new TwikooError(ResponseCode.PASS_NOT_EXIST, '未配置管理密码');
  }
  const password = payload.password as string;
  if (md5(password) !== ctx.config.ADMIN_PASS) {
    throw new TwikooError(ResponseCode.PASS_NOT_MATCH, '密码错误');
  }
  return {};
};
