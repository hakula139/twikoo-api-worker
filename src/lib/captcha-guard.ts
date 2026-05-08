import type { EventPayloads, RequestCtx } from '@/types';

import { logger } from '@/twikoo';
import { ResponseCode, TwikooError } from './errors';
import { secret } from './secret';
import { verifyTurnstile } from './turnstile';

export const enforceTurnstile = async (
  payload: EventPayloads['COMMENT_SUBMIT'],
  ctx: RequestCtx,
): Promise<void> => {
  if (ctx.config.CAPTCHA_PROVIDER !== 'Turnstile') {
    return;
  }
  // Only the secret is needed for siteverify; the site key is a frontend-only
  // hint that GET_CONFIG hands to the widget. Guarding the backend on it
  // failed every captcha when the admin left the site-key field blank.
  const turnstileSecret = secret(ctx, 'TURNSTILE_SECRET_KEY');
  if (!turnstileSecret) {
    logger.error('Turnstile is enabled but TURNSTILE_SECRET_KEY is unset.');
    throw new TwikooError(ResponseCode.FAIL, '人机验证未配置完整，请联系管理员');
  }
  const token = payload.turnstileToken ?? '';
  if (!token) {
    throw new TwikooError(ResponseCode.CREDENTIALS_INVALID, '人机验证失败，请刷新页面重试');
  }
  const result = await verifyTurnstile({ secret: turnstileSecret, token, ip: ctx.ip });
  if (!result.success) {
    throw new TwikooError(
      ResponseCode.CREDENTIALS_INVALID,
      `人机验证失败：${result.errorCodes.join(', ')}`,
    );
  }
};
