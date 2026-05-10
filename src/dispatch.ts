import type { ExecutionContext } from '@cloudflare/workers-types';

import type { Env, EventName, EventPayloads, RequestCtx, TwikooResponse } from './types';

import { buildDb } from './db';
import { handlers, isEventName } from './handlers';
import { loadConfig } from './lib/ctx';
import { ResponseCode, TwikooError } from './lib/errors';
import { extractGeo } from './lib/geo';
import { isPlainObject } from './lib/guards';
import { corsHeaders, isOriginAllowed, jsonResponse } from './lib/http';
import { logger } from './twikoo';
import { mkIp, mkUid } from './types';

const stringField = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === 'string' ? body[key] : '';

// Generous enough for base64 image uploads (~5 MB raw → ~6.7 MB encoded)
// and small bulk imports, while still well below the Workers runtime cap.
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export const dispatch = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  const origin = request.headers.get('Origin');
  const db = buildDb(env.DB);

  // Pre-check Content-Length so we never materialize an oversize body. The
  // header may be absent (chunked transfer, some HTTP/2 framing) — that's
  // fine, the runtime cap remains the backstop.
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return jsonResponse(
      { code: ResponseCode.FAIL, message: 'Request body too large.' },
      corsHeaders(origin),
    );
  }

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

  const loaded = await loadConfig(env, db);
  if (loaded.kind === 'corrupted') {
    // Avoid logging the raw row since it normally contains ADMIN_PASS and SMTP_PASS.
    // Length and parse error are safe and the only useful triage signal.
    logger.error(
      { length: loaded.length, parseError: loaded.parseError },
      'Config row is not valid JSON or not an object.',
    );
    return jsonResponse(
      {
        code: ResponseCode.CONFIG_NOT_EXIST,
        message: 'Configuration is corrupted; please contact the administrator.',
      },
      corsHeaders(origin),
    );
  }
  if (loaded.droppedKeys.length > 0) {
    logger.error(
      { droppedKeys: loaded.droppedKeys },
      'Config row had keys with unsupported value types; pruned at the boundary.',
    );
  }
  const config = loaded.config;
  const headers = corsHeaders(origin, config);

  // Reject before DB writes. Without short-circuit, the browser still drops
  // the response on a CORS miss, but the handler has already persisted state.
  if (!isOriginAllowed(origin, config)) {
    return jsonResponse({ code: ResponseCode.FORBIDDEN, message: 'Origin not allowed.' }, headers);
  }

  const event = stringField(body, 'event');
  const accessToken = stringField(body, 'accessToken');
  const uid = mkUid(accessToken || request.headers.get('x-twikoo-recaptcha-v3') || '');
  const { ip, region } = extractGeo(request);

  const requestCtx: RequestCtx = {
    config,
    db,
    env,
    ip: mkIp(ip),
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
  // Cast erases per-event payload narrowing here; each handler's validate()
  // re-checks required fields at runtime.
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
    // Preserve upstream Error messages (e.g. twikoo-func's '评论内容过长')
    // so the widget can show the original copy instead of 'Internal error.'
    const message = error instanceof Error && error.message ? error.message : 'Internal error.';
    return jsonResponse({ code: ResponseCode.FAIL, message }, headers);
  }

  return jsonResponse({ code: ResponseCode.SUCCESS, ...result }, headers);
};
