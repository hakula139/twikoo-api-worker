import type { JsonString } from '@/types';

// Wrapper around JSON.stringify that returns the branded JsonString<T>.
// Use this at every JsonString construction site so the brand stays earned.
export const toJsonString = <T>(value: T): JsonString<T> => JSON.stringify(value) as JsonString<T>;

// Wrapper around JSON.parse that returns undefined on a parse failure
// rather than throwing.
export const parseJsonString = <T>(s: JsonString<T> | string): T | undefined => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
};

// Common sentinel: '[]' as JsonString<string[]>. Cached so callers don't
// re-stringify on every read.
export const EMPTY_STRING_ARRAY_JSON: JsonString<string[]> = toJsonString<string[]>([]);
