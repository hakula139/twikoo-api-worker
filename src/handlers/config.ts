import type { Handler } from '../types';

import { isAdmin, requireAdmin } from '../lib/auth';
import {
  VERSION,
  getConfigForAdmin as getConfigForAdminFn,
  getConfig as getConfigFn,
  stripCode,
  validate,
} from '../twikoo';

// Public-facing keys that upstream's getConfig surfaces but should never leave
// the worker. QQ_API_KEY is consumed by GET_QQ_NICK on the server.
const PUBLIC_CONFIG_FORBIDDEN: readonly string[] = ['QQ_API_KEY'];

export const getConfig: Handler<'GET_CONFIG'> = async (_payload, ctx) => {
  const result = (await getConfigFn({
    config: ctx.config,
    VERSION,
    isAdmin: isAdmin(ctx.uid, ctx.config),
  })) as { config?: Record<string, unknown> } & Record<string, unknown>;
  if (result.config) {
    for (const key of PUBLIC_CONFIG_FORBIDDEN) {
      delete result.config[key];
    }
  }
  return result;
};

export const getConfigForAdmin: Handler<'GET_CONFIG_FOR_ADMIN'> = async (_payload, ctx) => {
  requireAdmin(ctx);
  return stripCode(await getConfigForAdminFn({ config: ctx.config, isAdmin: true }));
};

export const setConfig: Handler<'SET_CONFIG'> = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['config']);

  await ctx.db.config.writePatch(payload.config);
  return {};
};
