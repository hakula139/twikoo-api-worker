import type { ExecutionContext } from '@cloudflare/workers-types';

import type { Env, Handler, RequestCtx, TwikooConfig, TwikooResponse } from './types';

import { DB } from './db';
import { handlers as defaultHandlers } from './handlers';
import { ResponseCode, TwikooError } from './lib/errors';
import { extractGeo } from './lib/geo';
import { corsHeaders, jsonResponse } from './lib/http';
import { logger } from './twikoo';

interface RequestBody {
  event?: string;
  accessToken?: string;
  [key: string]: unknown;
}

export const dispatch = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  registry: Record<string, Handler> = defaultHandlers,
): Promise<Response> => {
  const origin = request.headers.get('Origin');
  const db = new DB(env.DB);

  let body: RequestBody;
  try {
    body = (await request.json<RequestBody>()) ?? {};
  } catch {
    return jsonResponse(
      { code: ResponseCode.FAIL, message: 'Body is not valid JSON.' },
      corsHeaders(origin),
    );
  }

  const configRaw = await db.readConfig();
  const config: TwikooConfig = configRaw ? (JSON.parse(configRaw) as TwikooConfig) : {};

  const headers = corsHeaders(origin, config);
  const event = body.event ?? '';
  const uid = body.accessToken ?? request.headers.get('x-twikoo-recaptcha-v3') ?? '';
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

  const { event: _event, accessToken: _accessToken, ...payload } = body;
  void _event;
  void _accessToken;

  let result: Partial<TwikooResponse>;
  try {
    result = await handler(payload, requestCtx);
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
