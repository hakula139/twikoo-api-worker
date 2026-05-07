import type { Handler } from '../types';

import { isAdmin, requireAdmin } from '../lib/auth';
import {
  VERSION,
  getConfigForAdmin as getConfigForAdminFn,
  getConfig as getConfigFn,
  stripCode,
  validate,
} from '../twikoo';

export const getConfig: Handler = async (_payload, ctx) =>
  getConfigFn({
    config: ctx.config,
    VERSION,
    isAdmin: isAdmin(ctx.uid, ctx.config),
  });

export const getConfigForAdmin: Handler = async (_payload, ctx) => {
  requireAdmin(ctx);
  return stripCode(await getConfigForAdminFn({ config: ctx.config, isAdmin: true }));
};

export const setConfig: Handler = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['config']);

  await ctx.db.config.writePatch(payload.config as Record<string, unknown>);
  return {};
};
