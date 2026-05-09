import type { Handler } from '@/types';

import { isAdmin } from '@/lib/auth';
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

// Initial setup is open; once set, only the current admin can rotate.
// Upstream's CloudBase ticket-signing branch is dropped (no Workers equivalent).
export const setPassword: Handler<'SET_PASSWORD'> = async (payload, ctx) => {
  validate(payload, ['password']);

  if (ctx.config.ADMIN_PASS && !isAdmin(ctx.uid, ctx.config)) {
    throw new TwikooError(ResponseCode.PASS_EXIST, '请先登录再修改密码');
  }

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
