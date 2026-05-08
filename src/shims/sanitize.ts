// DOMPurify-shape passthrough fed to twikoo-func.setCustomLibs. Comment HTML
// is already sanitized by lib/sanitize at write time, so a no-op here avoids
// stripping allowlist tokens twikoo-func re-renders on read.
export const sanitizeShim = {
  sanitize: (input: string): string => input,
};
