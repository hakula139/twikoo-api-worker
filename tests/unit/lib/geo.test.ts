import { describe, expect, it } from 'vitest';

import { extractGeo, formatIpRegion } from '../../../src/lib/geo';

describe('formatIpRegion', () => {
  it('drops the ISP placeholder at index 1 and trailing empty parts', () => {
    expect(formatIpRegion('China|0|Beijing||')).toBe('China · Beijing');
  });

  it('joins province and city when both are populated', () => {
    expect(formatIpRegion('China|0|Zhejiang|Hangzhou|')).toBe('China · Zhejiang · Hangzhou');
  });

  it('returns empty string for empty input', () => {
    expect(formatIpRegion('')).toBe('');
  });
});

describe('extractGeo', () => {
  it('reads IP from the CF-Connecting-IP header', () => {
    const request = new Request('https://example.com', {
      headers: { 'CF-Connecting-IP': '203.0.113.42' },
    });
    const { ip } = extractGeo(request);
    expect(ip).toBe('203.0.113.42');
  });

  it('returns an empty IP and region when no headers or cf properties are set', () => {
    const request = new Request('https://example.com');
    const { ip, region } = extractGeo(request);
    expect(ip).toBe('');
    expect(region).toBe('');
  });
});
