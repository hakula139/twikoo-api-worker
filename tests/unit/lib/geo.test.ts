import { describe, expect, it } from 'vitest';

import { extractGeo, formatIpRegion } from '@/lib/geo';

describe('extractGeo', () => {
  it('reads IP from the CF-Connecting-IP header', () => {
    const request = new Request('https://example.com', {
      headers: { 'CF-Connecting-IP': '203.0.113.42' },
    });
    const { ip } = extractGeo(request);

    expect(ip).toBe('203.0.113.42');
  });

  it('assembles the region string from request.cf populated by Cloudflare', () => {
    const request = new Request('https://example.com', {
      cf: { country: 'CN', region: 'Zhejiang', city: 'Hangzhou' },
    });
    const { region } = extractGeo(request);

    expect(region).toBe('CN|0|Zhejiang|Hangzhou|');
  });

  it('emits region from country alone when subdivisions are absent', () => {
    const request = new Request('https://example.com', {
      cf: { country: 'CN' },
    });
    const { region } = extractGeo(request);

    expect(region).toBe('CN|0|||');
  });

  it('returns an empty IP and region when no headers or cf properties are set', () => {
    const request = new Request('https://example.com');
    const { ip, region } = extractGeo(request);

    expect(ip).toBe('');
    expect(region).toBe('');
  });
});

describe('formatIpRegion', () => {
  it.each([
    ['China|0|Beijing||', 'China · Beijing'],
    ['China|0|Zhejiang|Hangzhou|', 'China · Zhejiang · Hangzhou'],
    ['', ''],
  ])('formats %s', (input, expected) => {
    const result = formatIpRegion(input);

    expect(result).toBe(expected);
  });
});
