import xss from 'xss';

export const sanitizeHtml = (input: string): string => xss(input);

// DOMPurify-shape shim for `twikoo-func.setCustomLibs`. Comment HTML is already
// sanitized at write time, so passing through here avoids stripping allowlist tokens.
export const sanitizeShim = {
  sanitize: (input: string): string => input,
};
