import { describe, expect, it } from 'vitest';

import { isPlainObject, isStringArray } from '@/lib/guards';

describe('isPlainObject', () => {
  it('accepts plain object literals', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it('rejects null, arrays, and primitives', () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject('x')).toBe(false);
    expect(isPlainObject(0)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe('isStringArray', () => {
  it('accepts arrays of strings (including empty)', () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(['a'])).toBe(true);
    expect(isStringArray(['a', 'b', ''])).toBe(true);
  });

  it('rejects non-arrays', () => {
    expect(isStringArray('a')).toBe(false);
    expect(isStringArray(null)).toBe(false);
    expect(isStringArray(undefined)).toBe(false);
    expect(isStringArray({ 0: 'a', length: 1 })).toBe(false);
  });

  it('rejects arrays with any non-string element', () => {
    expect(isStringArray(['a', 1])).toBe(false);
    expect(isStringArray(['a', null])).toBe(false);
    expect(isStringArray([{}])).toBe(false);
  });
});
