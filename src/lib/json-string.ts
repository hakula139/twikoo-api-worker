import type { JsonString } from '@/types';

export const toJsonString = <T>(value: T): JsonString<T> => JSON.stringify(value) as JsonString<T>;

// Used at trust boundaries where a corrupt blob shouldn't crash the request.
// Returns undefined on parse failure; callers must validate the shape of T.
export const parseJsonString = <T>(s: string): T | undefined => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
};

export const EMPTY_STRING_ARRAY_JSON: JsonString<string[]> = toJsonString<string[]>([]);
