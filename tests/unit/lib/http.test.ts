import type { TwikooConfig } from '../../../src/types';

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/twikoo', () => ({ logger: console }));

import { corsHeaders, jsonResponse } from '../../../src/lib/http';

describe('corsHeaders', () => {
  it('returns an empty object when origin is null', () => {
    expect(corsHeaders(null)).toEqual({});
  });

  it('echoes the origin and emits the standard CORS headers when no config is provided', () => {
    const headers = corsHeaders('https://example.com');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST');
    expect(headers['Vary']).toBe('Origin');
  });

  it('always allows localhost regardless of allowlist', () => {
    const config: TwikooConfig = { CORS_ALLOW_ORIGIN: 'https://prod.example' };
    expect(corsHeaders('http://localhost:5173', config)['Access-Control-Allow-Origin']).toBe(
      'http://localhost:5173',
    );
    expect(corsHeaders('http://127.0.0.1:8787', config)['Access-Control-Allow-Origin']).toBe(
      'http://127.0.0.1:8787',
    );
  });

  it('treats empty allowlist as permissive', () => {
    const config: TwikooConfig = { CORS_ALLOW_ORIGIN: '' };
    expect(corsHeaders('https://anywhere.example', config)['Access-Control-Allow-Origin']).toBe(
      'https://anywhere.example',
    );
  });

  it('matches an exact origin entry', () => {
    const config: TwikooConfig = { CORS_ALLOW_ORIGIN: 'https://blog.example' };
    expect(corsHeaders('https://blog.example', config)['Access-Control-Allow-Origin']).toBe(
      'https://blog.example',
    );
    expect(corsHeaders('https://other.example', config)).toEqual({});
  });

  it('matches a bare hostname entry against either scheme', () => {
    const config: TwikooConfig = { CORS_ALLOW_ORIGIN: 'blog.example' };
    expect(corsHeaders('https://blog.example', config)['Access-Control-Allow-Origin']).toBe(
      'https://blog.example',
    );
    expect(corsHeaders('http://blog.example', config)['Access-Control-Allow-Origin']).toBe(
      'http://blog.example',
    );
  });

  it('matches a wildcard subdomain but not the apex', () => {
    const config: TwikooConfig = { CORS_ALLOW_ORIGIN: '*.example.com' };
    expect(corsHeaders('https://a.example.com', config)['Access-Control-Allow-Origin']).toBe(
      'https://a.example.com',
    );
    expect(corsHeaders('https://example.com', config)).toEqual({});
  });

  it('treats a single "*" entry as allow-any', () => {
    const config: TwikooConfig = { CORS_ALLOW_ORIGIN: '*' };
    expect(corsHeaders('https://random.example', config)['Access-Control-Allow-Origin']).toBe(
      'https://random.example',
    );
  });

  it('rejects a malformed origin against a non-empty allowlist', () => {
    const config: TwikooConfig = { CORS_ALLOW_ORIGIN: 'blog.example' };
    expect(corsHeaders('not-a-url', config)).toEqual({});
  });

  it('trims whitespace and trailing slash from allowlist entries', () => {
    const config: TwikooConfig = { CORS_ALLOW_ORIGIN: '  https://blog.example/  , a.example' };
    expect(corsHeaders('https://blog.example', config)['Access-Control-Allow-Origin']).toBe(
      'https://blog.example',
    );
    expect(corsHeaders('https://a.example', config)['Access-Control-Allow-Origin']).toBe(
      'https://a.example',
    );
  });
});

describe('jsonResponse', () => {
  it('serializes the body as JSON with the standard content type', async () => {
    const res = jsonResponse({ code: 0, data: { hello: 'world' } });
    expect(res.headers.get('Content-Type')).toBe('application/json;charset=UTF-8');
    expect(await res.json()).toEqual({ code: 0, data: { hello: 'world' } });
  });

  it('merges extra headers without dropping the content type', () => {
    const res = jsonResponse({ code: 0 }, { 'X-Custom': 'yes' });
    expect(res.headers.get('X-Custom')).toBe('yes');
    expect(res.headers.get('Content-Type')).toBe('application/json;charset=UTF-8');
  });
});
