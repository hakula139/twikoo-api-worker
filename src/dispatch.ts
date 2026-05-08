import type { ExecutionContext } from '@cloudflare/workers-types';

import type {
  Env,
  EventName,
  EventPayloads,
  RequestCtx,
  TwikooConfig,
  TwikooResponse,
} from './types';

import { DB } from './db';
import { handlers, isEventName } from './handlers';
import { ResponseCode, TwikooError } from './lib/errors';
import { extractGeo } from './lib/geo';
import { isPlainObject } from './lib/guards';
import { corsHeaders, isOriginAllowed, jsonResponse } from './lib/http';
import { logger } from './twikoo';

const stringField = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === 'string' ? body[key] : '';

export const dispatch = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  const origin = request.headers.get('Origin');
  const db = new DB(env.DB);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json<unknown>();
    if (!isPlainObject(parsed)) {
      return jsonResponse(
        { code: ResponseCode.FAIL, message: 'Request body must be a JSON object.' },
        corsHeaders(origin),
      );
    }

    body = parsed;
  } catch (error) {
    logger.error('Request body parse failed:', error);
    return jsonResponse(
      { code: ResponseCode.FAIL, message: 'Body is not valid JSON.' },
      corsHeaders(origin),
    );
  }

  const configRaw = await db.config.read();
  let config: TwikooConfig;
  try {
    config = configRaw ? (JSON.parse(configRaw) as TwikooConfig) : {};
  } catch (error) {
    // Avoid logging the raw row — it normally contains ADMIN_PASS and SMTP_PASS.
    logger.error(`Config row is not valid JSON (length=${configRaw.length}):`, error);
    return jsonResponse(
      {
        code: ResponseCode.CONFIG_NOT_EXIST,
        message: 'Configuration is corrupted; please contact the administrator.',
      },
      corsHeaders(origin),
    );
  }
  const headers = corsHeaders(origin, config);

  // Reject before DB writes — without short-circuit, the browser still drops
  // the response on a CORS miss, but the handler has already persisted state.
  if (!isOriginAllowed(origin, config)) {
    return jsonResponse({ code: ResponseCode.FORBIDDEN, message: 'Origin not allowed.' }, headers);
  }

  const event = stringField(body, 'event');
  const accessToken = stringField(body, 'accessToken');
  const uid = accessToken || request.headers.get('x-twikoo-recaptcha-v3') || '';
  const { ip, region } = extractGeo(request);

  const requestCtx: RequestCtx = {
    config,
    db,
    env,
    ip,
    origin,
    region,
    request,
    uid,
    waitUntil: ctx.waitUntil.bind(ctx),
  };

  if (!isEventName(event)) {
    return jsonResponse(
      { code: ResponseCode.EVENT_NOT_EXIST, message: `Event "${event}" is not supported.` },
      headers,
    );
  }
  // Trust the handler's `validate()` for required-field shape checks; this
  // cast lets the typed registry call the handler with its specific payload
  // without per-event runtime narrowing here.
  const handler = handlers[event] as (
    payload: EventPayloads[EventName],
    ctx: RequestCtx,
  ) => Promise<Partial<TwikooResponse>>;

  let result: Partial<TwikooResponse>;
  try {
    result = await handler(body, requestCtx);
  } catch (error) {
    if (error instanceof TwikooError) {
      return jsonResponse({ code: error.code, message: error.message }, headers);
    }
    logger.error('Unhandled handler error:', error);
    // twikoo-func's `validate` and similar helpers throw plain Errors with
    // user-actionable messages (e.g. '评论内容过长'); preserve them so the
    // widget can show the upstream copy instead of a generic 'Internal error.'
    const message = error instanceof Error && error.message ? error.message : 'Internal error.';
    return jsonResponse({ code: ResponseCode.FAIL, message }, headers);
  }

  return jsonResponse({ code: ResponseCode.SUCCESS, ...result }, headers);
};
