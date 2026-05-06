import type { ExecutionContext } from '@cloudflare/workers-types';

import type { Env, Handler, RequestCtx, TwikooConfig, TwikooResponse } from './types';

import { DB } from './db';
import { handlers as defaultHandlers } from './handlers';
import { ResponseCode, TwikooError } from './lib/errors';
import { extractGeo } from './lib/geo';
import { corsHeaders, jsonResponse } from './lib/http';
import { logger } from './twikoo';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const stringField = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === 'string' ? body[key] : '';

export const dispatch = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  registry: Record<string, Handler> = defaultHandlers,
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
  } catch {
    return jsonResponse(
      { code: ResponseCode.FAIL, message: 'Body is not valid JSON.' },
      corsHeaders(origin),
    );
  }

  const configRaw = await db.readConfig();
  const config: TwikooConfig = configRaw ? (JSON.parse(configRaw) as TwikooConfig) : {};

  const headers = corsHeaders(origin, config);
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

  const handler = registry[event];
  if (!handler) {
    return jsonResponse(
      { code: ResponseCode.EVENT_NOT_EXIST, message: `Event "${event}" is not supported.` },
      headers,
    );
  }

  let result: Partial<TwikooResponse>;
  try {
    result = await handler(body, requestCtx);
  } catch (error) {
    if (error instanceof TwikooError) {
      return jsonResponse({ code: error.code, message: error.message }, headers);
    }
    logger.error('Unhandled handler error:', error);
    const message = error instanceof Error ? error.message : 'Internal error.';
    return jsonResponse({ code: ResponseCode.FAIL, message }, headers);
  }

  return jsonResponse({ code: ResponseCode.SUCCESS, ...result }, headers);
};
