import type { TwikooConfig } from '@/types';

import { describe, expect, it } from 'vitest';

import { boolConfig, numberConfig, stringConfig } from '@/lib/config-read';

describe('stringConfig', () => {
  it.each([
    { config: { SITE_NAME: 'Example†Site' }, key: 'SITE_NAME', expected: 'Example†Site' },
    { config: { SITE_NAME: '' }, key: 'SITE_NAME', expected: undefined },
    { config: {}, key: 'SITE_NAME', expected: undefined },
    { config: { PAGE_SIZE: 42 }, key: 'PAGE_SIZE', expected: undefined },
    { config: { SHOW_REGION: false }, key: 'SHOW_REGION', expected: undefined },
  ])('reads $key from $config', ({ config, key, expected }) => {
    const value = stringConfig(config, key);

    expect(value).toBe(expected);
  });
});

describe('numberConfig', () => {
  it.each([
    { value: '5', expected: 5 },
    { value: 5, expected: 5 },
    { value: 'not-a-number', expected: 7 },
    { value: '0', expected: 7 },
    { value: '-3', expected: 7 },
    { value: undefined, expected: 7 },
  ])('reads $value with a fallback of 7', ({ value, expected }) => {
    const result = numberConfig({ PAGE_SIZE: value }, 'PAGE_SIZE', 7);

    expect(result).toBe(expected);
  });
});

describe('boolConfig', () => {
  it.each([
    { value: 'true', expected: true },
    { value: 'yes', expected: true },
    { value: true, expected: true },
    { value: 'false', expected: false },
    { value: false, expected: false },
    { value: '', expected: false },
    { value: undefined, expected: false },
  ] satisfies { value: TwikooConfig[string]; expected: boolean }[])(
    'reads $value',
    ({ value, expected }) => {
      const result = boolConfig({ SHOW_REGION: value }, 'SHOW_REGION');

      expect(result).toBe(expected);
    },
  );
});
