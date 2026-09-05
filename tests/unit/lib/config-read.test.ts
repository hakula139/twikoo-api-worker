import { describe, expect, it } from 'vitest';

import { boolConfig, numberConfig, stringConfig } from '@/lib/config-read';

describe('stringConfig', () => {
  it('returns the string value when present and non-empty', () => {
    expect(stringConfig({ SITE_NAME: 'HAKULA†CHANNEL' }, 'SITE_NAME')).toBe('HAKULA†CHANNEL');
  });

  it('returns undefined for an empty string', () => {
    expect(stringConfig({ SITE_NAME: '' }, 'SITE_NAME')).toBeUndefined();
  });

  it('returns undefined for missing keys', () => {
    expect(stringConfig({}, 'SITE_NAME')).toBeUndefined();
  });

  it('returns undefined for non-string values', () => {
    expect(stringConfig({ SITE_NAME: 42 }, 'SITE_NAME')).toBeUndefined();
    expect(stringConfig({ SITE_NAME: false }, 'SITE_NAME')).toBeUndefined();
  });
});

describe('numberConfig', () => {
  it('parses a numeric string', () => {
    expect(numberConfig({ COMMENT_PAGE_SIZE: '5' }, 'COMMENT_PAGE_SIZE', 1)).toBe(5);
  });

  it('returns the number directly when stored as number', () => {
    expect(numberConfig({ PAGE_SIZE: 5 }, 'PAGE_SIZE', 1)).toBe(5);
  });

  it('falls back when the value cannot be parsed', () => {
    expect(numberConfig({ COMMENT_PAGE_SIZE: 'not-a-number' }, 'COMMENT_PAGE_SIZE', 7)).toBe(7);
  });

  it('falls back on non-positive values', () => {
    expect(numberConfig({ COMMENT_PAGE_SIZE: '0' }, 'COMMENT_PAGE_SIZE', 7)).toBe(7);
    expect(numberConfig({ COMMENT_PAGE_SIZE: '-3' }, 'COMMENT_PAGE_SIZE', 7)).toBe(7);
  });

  it('falls back on missing keys', () => {
    expect(numberConfig({}, 'COMMENT_PAGE_SIZE', 7)).toBe(7);
  });
});

describe('boolConfig', () => {
  it('returns true for non-empty strings other than "false"', () => {
    expect(boolConfig({ SHOW_REGION: 'true' }, 'SHOW_REGION')).toBe(true);
    expect(boolConfig({ SHOW_REGION: 'yes' }, 'SHOW_REGION')).toBe(true);
  });

  it('returns false for the literal "false" string', () => {
    expect(boolConfig({ SHOW_REGION: 'false' }, 'SHOW_REGION')).toBe(false);
  });

  it('returns the value directly when stored as boolean', () => {
    expect(boolConfig({ SHOW_REGION: true }, 'SHOW_REGION')).toBe(true);
    expect(boolConfig({ SHOW_REGION: false }, 'SHOW_REGION')).toBe(false);
  });

  it('returns false for missing keys or empty strings', () => {
    expect(boolConfig({}, 'SHOW_REGION')).toBe(false);
    expect(boolConfig({ SHOW_REGION: '' }, 'SHOW_REGION')).toBe(false);
  });
});
