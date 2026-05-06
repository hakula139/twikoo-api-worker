import xss from 'xss';

// Active sanitizer used by `comment.submit` before persisting user HTML.
// `xss` enforces an allowlist that matches what the Twikoo widget renders.
export const sanitizeHtml = (input: string): string => xss(input);

// DOMPurify-shape shim handed to `twikoo-func.setCustomLibs`. Upstream's
// Cloudflare port passes through too — comment HTML is already xss-sanitized
// at write time, so further sanitization inside twikoo-func would be redundant
// and could strip allowlisted tokens.
export const sanitizeShim = {
  sanitize: (input: string): string => input,
};
