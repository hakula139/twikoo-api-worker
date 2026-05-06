import type { IncomingRequestCfProperties } from '@cloudflare/workers-types';

// Format mirrors `ip2region` (country|0|province|city|isp), which is what
// `twikoo-func` expects when computing display regions. Cloudflare doesn't
// expose ISP data through `request.cf`, so the trailing slot stays empty.
export interface RequestGeo {
  ip: string;
  region: string;
}

export const extractGeo = (request: Request): RequestGeo => {
  // The augmented `request.cf` is the union `IncomingRequestCfProperties |
  // RequestInitCfProperties`; inside a fetch handler it's always the incoming
  // variant, so the assertion is safe.
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const region = `${cf?.country ?? ''}|0|${cf?.region ?? ''}|${cf?.city ?? ''}|`;
  return { ip, region };
};

// Beautify `country|0|province|city|isp` for display. Empty slots collapse to
// avoid renders like "China||Beijing||" — we want "China · Beijing".
export const formatIpRegion = (region: string): string => {
  return region
    .split('|')
    .filter((part, idx) => part && idx !== 1)
    .join(' · ');
};
