import type { ExecutionContext, ExportedHandler } from '@cloudflare/workers-types';
import type { Env } from './types';

const VERSION = '0.0.1';

const corsHeaders = (origin: string | null): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-twikoo-token',
  'Access-Control-Max-Age': '86400',
});

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET') {
      const response = json({
        code: 100,
        message:
          'Twikoo 云函数运行正常，请参考 https://twikoo.js.org/frontend.html 完成前端的配置',
        version: VERSION,
      });
      for (const [k, v] of Object.entries(corsHeaders(origin))) response.headers.set(k, v);
      return response;
    }

    // Event dispatch lands here. See .claude/plans/comment-system-roadmap.md.
    const response = json({ code: 1001, message: 'Not implemented yet.' }, { status: 501 });
    for (const [k, v] of Object.entries(corsHeaders(origin))) response.headers.set(k, v);
    return response;
  },
} satisfies ExportedHandler<Env>;
