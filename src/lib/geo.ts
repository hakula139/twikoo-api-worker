import type { IncomingRequestCfProperties } from '@cloudflare/workers-types';

// `region` mirrors ip2region's `country|0|province|city|isp` shape so
// twikoo-func's display logic can consume it; Cloudflare has no ISP data.
export interface RequestGeo {
  ip: string;
  region: string;
}

export const extractGeo = (request: Request): RequestGeo => {
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const country = cf?.country ?? '';
  const cfRegion = cf?.region ?? '';
  const city = cf?.city ?? '';
  const region = country || cfRegion || city ? `${country}|0|${cfRegion}|${city}|` : '';
  return { ip, region };
};

// "China|0|Beijing||" → "China · Beijing"
export const formatIpRegion = (region: string): string => {
  return region
    .split('|')
    .filter((part, idx) => part && idx !== 1)
    .join(' · ');
};
