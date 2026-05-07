import type { Handler } from '../types';

import { requireAdmin } from '../lib/auth';
import { ResponseCode, TwikooError } from '../lib/errors';
import { emailTest as emailTestFn } from '../twikoo';

// Upstream `emailTest` resets the cached transporter, re-runs `initMailer`,
// and dispatches a real send. On failure it returns `{message}` (caught
// internally) — convert to a typed throw so the client sees the dispatch
// error envelope instead of a `code: 0` body that hides the failure.
export const emailTest: Handler = async (payload, ctx) => {
  requireAdmin(ctx);

  const result = (await emailTestFn(payload, ctx.config, true)) as {
    result?: unknown;
    message?: string;
  };
  if (result.message) {
    throw new TwikooError(ResponseCode.FAIL, result.message);
  }
  return {};
};
