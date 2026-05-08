import { describe, expect, it } from 'vitest';

import { boolConfig, numberConfig, stringConfig } from '@/lib/config-read';

describe('stringConfig', () => {
  it('returns the string value when present and non-empty', () => {
    expect(stringConfig({ A: 'foo' }, 'A')).toBe('foo');
  });

  it('returns undefined for an empty string', () => {
    expect(stringConfig({ A: '' }, 'A')).toBeUndefined();
  });

  it('returns undefined for missing keys', () => {
    expect(stringConfig({}, 'A')).toBeUndefined();
  });

  it('returns undefined for non-string values', () => {
    expect(stringConfig({ A: 42 }, 'A')).toBeUndefined();
    expect(stringConfig({ A: false }, 'A')).toBeUndefined();
  });
});

describe('numberConfig', () => {
  it('parses a numeric string', () => {
    expect(numberConfig({ N: '5' }, 'N', 1)).toBe(5);
  });

  it('returns the number directly when stored as number', () => {
    expect(numberConfig({ N: 5 }, 'N', 1)).toBe(5);
  });

  it('falls back when the value cannot be parsed', () => {
    expect(numberConfig({ N: 'abc' }, 'N', 7)).toBe(7);
  });

  it('falls back on non-positive values', () => {
    expect(numberConfig({ N: '0' }, 'N', 7)).toBe(7);
    expect(numberConfig({ N: '-3' }, 'N', 7)).toBe(7);
  });

  it('falls back on missing keys', () => {
    expect(numberConfig({}, 'N', 7)).toBe(7);
  });
});

describe('boolConfig', () => {
  it('returns true for non-empty strings other than "false"', () => {
    expect(boolConfig({ B: 'true' }, 'B')).toBe(true);
    expect(boolConfig({ B: 'yes' }, 'B')).toBe(true);
  });

  it('returns false for the literal "false" string', () => {
    expect(boolConfig({ B: 'false' }, 'B')).toBe(false);
  });

  it('returns the value directly when stored as boolean', () => {
    expect(boolConfig({ B: true }, 'B')).toBe(true);
    expect(boolConfig({ B: false }, 'B')).toBe(false);
  });

  it('returns false for missing keys or empty strings', () => {
    expect(boolConfig({}, 'B')).toBe(false);
    expect(boolConfig({ B: '' }, 'B')).toBe(false);
  });
});
