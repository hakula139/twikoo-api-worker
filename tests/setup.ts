// twikoo-func loads axios / form-data at module init; workerd segfaults.
// Mock the boundary — `vi.fn()` for helpers tests override per call,
// plain arrow fns for pure utilities (md5, validate, ...).

import { vi } from 'vitest';

vi.mock('@/twikoo', () => ({
  VERSION: '0.0.0-test',
  addQQMailSuffix: (m: string) => m,
  commentImportArtalk: vi.fn(async () => []),
  commentImportArtalk2: vi.fn(async () => []),
  commentImportDisqus: vi.fn(async () => []),
  commentImportTwikoo: vi.fn(async () => []),
  commentImportValine: vi.fn(async () => []),
  emailTest: vi.fn(async () => ({})),
  equalsMail: (a: string, b: string) =>
    Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase(),
  getAvatar: () => '',
  getConfig: vi.fn(async () => ({})),
  getConfigForAdmin: vi.fn(async () => ({})),
  getMailMd5: () => '',
  getPasswordStatus: vi.fn(async () => ({})),
  getUrlsQuery: (urls: string[]) => urls,
  isQQ: () => false,
  jsonParse: (s: string): unknown => JSON.parse(s),
  logger: console,
  md5: (s: string) => `md5(${s})`,
  normalizeMail: (m: string) => m.toLowerCase(),
  parseComment: (rows: unknown) => rows,
  preCheckSpam: () => false,
  sendNotice: async () => undefined,
  sha256: (s: string) => `sha256(${s})`,
  stripCode: <T extends { code?: number }>(o: T): Omit<T, 'code'> => {
    const { code: _code, ...rest } = o;
    return rest;
  },
  validate: () => undefined,
}));
