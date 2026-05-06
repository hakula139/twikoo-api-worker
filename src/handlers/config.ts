import type { Handler } from '../types';

import { isAdmin } from '../lib/auth';
import { VERSION, getConfig as getConfigFn } from '../twikoo';

export const getConfig: Handler = async (_payload, ctx) => {
  return getConfigFn({
    config: ctx.config,
    VERSION,
    isAdmin: isAdmin(ctx.uid, ctx.config),
  });
};
