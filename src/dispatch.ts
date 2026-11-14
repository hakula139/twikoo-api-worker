import type { ExecutionContext } from '@cloudflare/workers-types';

import type { ResponseCodeValue } from './lib/errors';
import type { Env, EventName, Handler, RequestCtx, TwikooResponse } from './types';

import { buildDb } from './db';
import { handlers, isEventName } from './handlers';
import { loadConfig } from './lib/ctx';
import { ResponseCode, TwikooError, redactDatabaseError } from './lib/errors';
import { extractGeo } from './lib/geo';
import { isPlainObject } from './lib/guards';
import { corsHeaders, isOriginAllowed, jsonResponse } from './lib/http';
import { logger } from './twikoo';
import { mkIp, mkUid } from './types';

const stringField = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === 'string' ? body[key] : '';

// Leave room for a 5 MiB image after base64 encoding.
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export const dispatch = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  const startedAt = Date.now();
  let event = '';
  let code: ResponseCodeValue = ResponseCode.SUCCESS;

  const respond = (body: Partial<TwikooResponse>, headers: Record<string, string>): Response => {
    if (body.code !== undefined) {
      code = body.code;
    }

    return jsonResponse(body, headers);
  };

  try {
    const origin = request.headers.get('Origin');
    const db = buildDb(env.DB, env.R2_PUBLIC_URL);

    // Requests without Content-Length rely on the Workers runtime limit.
    const contentLength = request.headers.get('Content-Length');

    if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
      return respond(
        { code: ResponseCode.FAIL, message: 'Request body too large.' },
        corsHeaders(origin),
      );
    }

    let body: Record<string, unknown>;

    try {
      const parsed = await request.json<unknown>();

      if (!isPlainObject(parsed)) {
        return respond(
          { code: ResponseCode.FAIL, message: 'Request body must be a JSON object.' },
          corsHeaders(origin),
        );
      }

      body = parsed;
    } catch {
      logger.error('Request body is not valid JSON.');
      return respond(
        { code: ResponseCode.FAIL, message: 'Body is not valid JSON.' },
        corsHeaders(origin),
      );
    }

    event = stringField(body, 'event');
    const accessToken = stringField(body, 'accessToken');
    const uid = mkUid(accessToken || request.headers.get('x-twikoo-recaptcha-v3') || '');

    const loaded = await loadConfig(env, db);

    if (loaded.kind === 'corrupted') {
      logger.error(
        { length: loaded.length, reason: loaded.reason },
        'Config row is not valid JSON or not an object.',
      );

      return respond(
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

    // Reject before DB writes. Without short-circuit, the browser still drops the response on a
    // CORS miss, but the handler has already persisted state.
    if (!isOriginAllowed(origin, config)) {
      return respond({ code: ResponseCode.FORBIDDEN, message: 'Origin not allowed.' }, headers);
    }

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
      return respond(
        { code: ResponseCode.EVENT_NOT_EXIST, message: `Event "${event}" is not supported.` },
        headers,
      );
    }

    const handler = handlers[event] as Handler<EventName>;

    let result: Partial<TwikooResponse>;

    try {
      result = await handler(body, requestCtx);
    } catch (error) {
      if (error instanceof TwikooError) {
        return respond({ code: error.code, message: error.message }, headers);
      }
      const safeError = redactDatabaseError(error);
      logger.error('Unhandled handler error:', safeError);
      // Preserve upstream errors so the widget can display messages such as '评论内容过长'.
      const message =
        safeError instanceof Error && safeError.message ? safeError.message : 'Internal error.';
      return respond({ code: ResponseCode.FAIL, message }, headers);
    }

    return respond({ code: ResponseCode.SUCCESS, ...result }, headers);
  } catch (error) {
    code = ResponseCode.FAIL;
    throw error;
  } finally {
    logger.info({ event, code, duration_ms: Date.now() - startedAt }, 'request');
  }
};
