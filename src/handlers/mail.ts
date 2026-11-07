import type { Handler } from '@/types';

import { requireAdmin } from '@/lib/auth';
import { ResponseCode, TwikooError } from '@/lib/errors';
import { configWithSecrets } from '@/lib/secret';
import { mailShim, withMailConfig } from '@/shims/mail';
import { emailTest as emailTestFn } from '@/twikoo';

// Upstream `emailTest` returns send failures as `{message}`. Expose them as errors.
export const emailTest: Handler<'EMAIL_TEST'> = async (payload, ctx) => {
  requireAdmin(ctx);

  const config = configWithSecrets(ctx);
  const result = await withMailConfig(config, async () => {
    // Invalid configuration must not clear a transport used by pending replies.
    mailShim.createTransport({}).verify();

    return emailTestFn(payload, config, true);
  });
  if (result.message) {
    throw new TwikooError(ResponseCode.FAIL, result.message);
  }

  return {};
};
