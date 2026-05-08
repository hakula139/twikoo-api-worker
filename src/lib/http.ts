import type { TwikooConfig, TwikooResponse } from '@/types';

import { logger } from '@/twikoo';

const ALLOWED_HEADERS =
  'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version';

const LOCALHOST_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{1,5})?$/;

// `*.foo.bar` matches any non-empty subdomain (one or more labels) of `foo.bar`,
// but not `foo.bar` itself. List the apex separately to allow it too.
const hostMatches = (hostname: string, pattern: string): boolean => {
  if (pattern === '*') {
    return true;
  }
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
};

// Each entry is one of:
//   - exact origin (`https://foo.bar`)            — scheme + host must match
//   - bare host or wildcard (`foo.bar`, `*.foo.bar`) — any scheme, host pattern match
//   - `*` — allow any origin
const matchEntry = (originUrl: URL, entry: string): boolean => {
  if (!entry.includes('://')) {
    return hostMatches(originUrl.hostname, entry);
  }
  let entryUrl: URL;
  try {
    entryUrl = new URL(entry);
  } catch {
    return false;
  }
  return (
    originUrl.protocol === entryUrl.protocol && hostMatches(originUrl.hostname, entryUrl.hostname)
  );
};

// Empty / unset allowlist is permissive — upstream parity. Localhost is exempt.
const matchAllowedOrigin = (origin: string, config: TwikooConfig): string => {
  if (LOCALHOST_REGEX.test(origin)) {
    return origin;
  }
  const entries = (config.CORS_ALLOW_ORIGIN ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (entries.length === 0) {
    return origin;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return '';
  }
  return entries.some((entry) => matchEntry(originUrl, entry)) ? origin : '';
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
    logger.warn(`CORS rejected origin: ${origin}`);
    return {};
  }
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
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
