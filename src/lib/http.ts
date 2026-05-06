import type { TwikooConfig, TwikooResponse } from '../types';

const ALLOWED_HEADERS =
  'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version';

const LOCALHOST_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{1,5})?$/;

// Match `origin` against `config.CORS_ALLOW_ORIGIN` (comma-separated list).
// Returns the origin if allowed, or '' to deny. Localhost variants are always
// allowed; an empty/unset allowlist is treated as permissive (upstream parity).
const matchAllowedOrigin = (origin: string, config: TwikooConfig): string => {
  if (LOCALHOST_REGEX.test(origin)) {
    return origin;
  }
  const allowed = (config.CORS_ALLOW_ORIGIN ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (allowed.length === 0) {
    return origin;
  }
  return allowed.includes(origin.replace(/\/$/, '')) ? origin : '';
};

export const corsHeaders = (
  origin: string | null,
  config?: TwikooConfig,
): Record<string, string> => {
  if (!origin) {
    return {};
  }
  const allowed = config ? matchAllowedOrigin(origin, config) : origin;
  if (!allowed) {
    return {};
  }
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '600',
  };
};

export const jsonResponse = (
  body: Partial<TwikooResponse>,
  extraHeaders: Record<string, string> = {},
): Response => {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      ...extraHeaders,
    },
  });
};
