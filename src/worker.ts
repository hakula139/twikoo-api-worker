import type { ExecutionContext, ExportedHandler } from '@cloudflare/workers-types';

import type { Env } from './types';

import { dispatch } from './dispatch';
import { ResponseCode } from './errors';
import { corsHeaders, jsonResponse } from './http';
import { VERSION, logger } from './twikoo';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin);

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
      }
      if (request.method === 'GET') {
        return jsonResponse(
          {
            code: ResponseCode.SUCCESS,
            data: { version: VERSION },
            message: 'Twikoo Worker is running.',
          },
          headers,
        );
      }
      if (request.method === 'POST') {
        return await dispatch(request, env, ctx);
      }
      return jsonResponse(
        { code: ResponseCode.FAIL, message: `Method ${request.method} is not allowed.` },
        { ...headers, Allow: 'GET, OPTIONS, POST' },
      );
    } catch (error) {
      logger.error('Unhandled fetch error:', error);
      return jsonResponse({ code: ResponseCode.FAIL, message: 'Internal error.' }, headers);
    }
  },
} satisfies ExportedHandler<Env>;
